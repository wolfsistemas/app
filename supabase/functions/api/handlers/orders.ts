// Pedidos: Pix na conta do vendedor, aviso ao cliente e estorno.
import { json, bearer } from '../_shared/http.ts'
import {
  assertStoreOwner,
  fetchStoreOwner,
  sb
} from '../_shared/supabase.ts'
import { mpSellerToken, publicApiUrl } from '../_shared/mp.ts'
import { notify, sendCustomerOrderEmail } from '../_shared/email.ts'

function orderTotal(order: any): number {
  const items = Array.isArray(order?.items) ? order.items : []
  let sum = 0
  for (const it of items) sum += Number(it?.price || 0) * Number(it?.qty || 1)
  if (sum > 0) return sum
  return Number(order?.total || 0)
}

async function fetchOrder(orderId: string): Promise<any> {
  const rows = await sb(`/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`)
  return rows && rows.length ? rows[0] : null
}

function tokenOk(order: any, provided: unknown): boolean {
  return Boolean(order?.public_token) && String(order.public_token) === String(provided || '')
}

// Cria o Pix do pedido com o token do vendedor (dinheiro vai direto pra ele).
export async function createPix(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  const orderId = String(body.order_id || '')
  if (!storeId || !orderId) return json({ ok: false, error: 'store_id/order_id ausentes' })

  const order = await fetchOrder(orderId)
  if (!order) return json({ ok: false, error: 'Pedido nao encontrado' })
  if (String(order.store_id) !== storeId) return json({ ok: false, error: 'Pedido nao pertence a loja' })
  if (!tokenOk(order, body.public_token)) return json({ ok: false, error: 'Pedido nao autorizado' })
  if (String(order.payment_status || '') === 'paid') {
    return json({ ok: true, already: true, payment_status: 'paid' })
  }

  const token = await mpSellerToken(storeId)
  if (!token) return json({ ok: false, error: 'Loja sem Mercado Pago conectado' })

  const amount = orderTotal(order)
  if (!(amount > 0)) return json({ ok: false, error: 'Pedido sem valor' })

  const store = await fetchStoreOwner(storeId)
  const payload = {
    transaction_amount: Number(amount.toFixed(2)),
    description:
      'Pedido ' + (order.code ? '#' + order.code + ' ' : '') + (store && store.name ? '- ' + store.name : ''),
    payment_method_id: 'pix',
    external_reference: 'order:' + orderId,
    notification_url: `${publicApiUrl()}?wh=mp`,
    payer: {
      email: String(body.payer_email || 'comprador@vitrinezap.com.br'),
      first_name: String(order.customer_name || 'Cliente').slice(0, 60)
    }
  }

  const keySuffix = body.renew ? 'renew-' + (order.mp_payment_id || 'x') : order.mp_payment_id || 'first'

  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'vitrinezap-order-' + orderId + '-' + keySuffix
    },
    body: JSON.stringify(payload)
  })
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (res.status >= 300 || !parsed.id) {
    await notify(`Falha ao criar Pix (pedido ${orderId})`, text.slice(0, 800))
    return json({ ok: false, error: parsed.message || parsed.error || 'Mercado Pago recusou o Pix', status: res.status })
  }

  const td = parsed.point_of_interaction?.transaction_data
  const qr = (td && td.qr_code) || ''
  const qrBase64 = (td && td.qr_code_base64) || ''
  let expiresAt: string | null = parsed.date_of_expiration || null
  if (expiresAt) {
    try {
      expiresAt = new Date(expiresAt).toISOString()
    } catch {
      expiresAt = null
    }
  }

  await sb(`/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    payload: {
      payment_status: 'pending',
      payment_method: 'pix',
      payment_code: qr,
      payment_qr: qrBase64,
      payment_expires_at: expiresAt,
      mp_payment_id: String(parsed.id)
    }
  })

  order.payment_status = 'pending'
  order.payment_method = 'pix'
  await sendCustomerOrderEmail(order, store && store.name)

  return json({
    ok: true,
    payment_id: String(parsed.id),
    code: qr,
    qr_base64: qrBase64,
    ticket_url: (td && td.ticket_url) || '',
    expires_at: expiresAt
  })
}

// Aviso publico do pedido (apos criar). So envia ao e-mail gravado no pedido.
export async function orderNotify(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  const orderId = String(body.order_id || '')
  if (!storeId || !orderId) return json({ ok: false, error: 'store_id/order_id ausentes' })
  const order = await fetchOrder(orderId)
  if (!order) return json({ ok: false, error: 'Pedido nao encontrado' })
  if (String(order.store_id) !== storeId) return json({ ok: false, error: 'Pedido nao pertence a loja' })
  if (!tokenOk(order, body.public_token)) return json({ ok: false, error: 'Pedido nao autorizado' })
  const store = await fetchStoreOwner(storeId)
  return json({ ok: true, sent: await sendCustomerOrderEmail(order, store && store.name) })
}

// Reembolsa um pedido pago na conta do vendedor (estorno sai do saldo dele).
export async function refundOrder(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  const orderId = String(body.order_id || '')
  if (!storeId || !orderId) return json({ ok: false, error: 'store_id/order_id ausentes' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)

  const order = await fetchOrder(orderId)
  if (!order) return json({ ok: false, error: 'Pedido nao encontrado' })
  if (String(order.store_id) !== storeId) return json({ ok: false, error: 'Pedido nao pertence a loja' })
  if (String(order.payment_status || '') === 'refunded') {
    return json({ ok: true, already: true, payment_status: 'refunded' })
  }
  if (String(order.payment_status || '') !== 'paid' || !order.mp_payment_id) {
    return json({ ok: false, error: 'Pedido nao esta pago' })
  }

  const token = await mpSellerToken(storeId)
  if (!token) return json({ ok: false, error: 'Loja sem Mercado Pago conectado' })

  const res = await fetch(
    'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(order.mp_payment_id) + '/refunds',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Idempotency-Key': 'vitrinezap-refund-' + orderId },
      body: JSON.stringify({})
    }
  )
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (res.status >= 300 || !parsed.id) {
    await notify(`Falha ao estornar pedido ${orderId}`, text.slice(0, 800))
    return json({ ok: false, error: parsed.message || parsed.error || 'Mercado Pago recusou o estorno', status: res.status })
  }

  await sb(`/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    payload: { payment_status: 'refunded', status: 'cancelado' }
  })
  await notify(`Pedido ${orderId} estornado`, `Pedido ${order.code ? '#' + order.code : orderId} · refund ${parsed.id}`)
  return json({ ok: true, refund_id: String(parsed.id) })
}
