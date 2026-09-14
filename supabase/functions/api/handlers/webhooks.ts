// Webhooks do Mercado Pago e InfinitePay + ativacao/renovacao do plano.
import { formatBrl } from '../_shared/http.ts'
import {
  sb,
  fetchStore,
  fetchStoreOwner,
  fetchOwnerEmail,
  patchStore,
  activatePlan,
  isProcessed,
  markProcessed,
  resolveStoreFromOrderNsu
} from '../_shared/supabase.ts'
import {
  fetchMpPayment,
  fetchMpPreapproval,
  fetchMpAuthorizedPayment,
  findStoreByMpUser,
  resolveStoreForMp,
  isNotFound
} from '../_shared/mp.ts'
import { notify, sendEmail, orderPublicLink, sendOrderKindEmail } from '../_shared/email.ts'
import { sendPush } from '../_shared/misc.ts'

const MP_ORDER_STATUS: Record<string, string> = {
  approved: 'paid',
  pending: 'pending',
  in_process: 'pending',
  authorized: 'pending',
  rejected: 'failed',
  cancelled: 'failed',
  refunded: 'refunded',
  charged_back: 'refunded'
}

async function updateOrderPayment(orderId: string, payment: any): Promise<string> {
  const st = MP_ORDER_STATUS[String(payment.status || '')] || 'pending'
  const fields: Record<string, unknown> = { payment_status: st }
  if (st === 'paid') fields.paid_at = new Date().toISOString()
  await sb(`/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    payload: fields
  })
  return st
}

async function notifyOrderPaid(order: any, payment: any): Promise<void> {
  const amount = Number(payment.transaction_amount || order.total || 0)
  const store = await fetchStoreOwner(order.store_id)
  const storeName = store && store.name ? store.name : order.store_id
  const link = orderPublicLink(order)
  const phone = String(order.customer_phone || '').replace(/\D/g, '')
  const lines = [
    `Pedido ${order.code ? '#' + order.code : order.id} PAGO`,
    '',
    `Valor: ${formatBrl(amount)}`,
    `Cliente: ${order.customer_name || '-'}`,
    `Fone: ${order.customer_phone || '-'}`,
    `Loja: ${storeName}`
  ]
  if (phone) lines.push('WhatsApp do cliente: https://wa.me/' + phone)
  if (link) lines.push('', 'Abra o pedido: ' + link)

  await sendPush(
    order.store_id,
    `Pedido ${order.code ? '#' + order.code : ''} pago`,
    `${formatBrl(amount)} - ${order.customer_name || 'Cliente'}`,
    link
  )
  const to = await fetchOwnerEmail(store && store.owner_id)
  if (!to) {
    await notify('Pedido pago (sem e-mail do lojista)', lines.join('\n'))
    return
  }
  await sendEmail({
    to,
    subject: `[VitrineZap] Pedido ${order.code ? '#' + order.code + ' ' : ''}pago - ${formatBrl(amount)}`,
    text: lines.join('\n')
  })
}

async function confirmPlan(storeId: string, orderNsu: string, body: any, capture: string, amount: unknown, receipt: string) {
  await activatePlan(storeId)
  const row = await fetchStore(storeId)
  if (!row || row.plan !== 'pro') {
    await notify('ATENCAO: plano nao confirmado como pro', `order_nsu=${orderNsu}\nstoreId=${storeId}\nrow=${JSON.stringify(row)}`)
    throw new Error('Plano nao confirmado como pro')
  }
  await notify(
    'Pagamento recebido - plano ativado',
    `Venda efetuada e paga!\n\nLoja: ${row.name || row.slug || row.id}\nPlano: Loja\nValidade: ${row.plan_expires_at}\n` +
      `order_nsu: ${orderNsu}\ntransaction: ${String(body.transaction_nsu || body.payment_id || body.id || '-')}\n` +
      `capture_method: ${capture}\namount: ${amount}\nreceipt: ${receipt || '-'}`
  )
}

async function handleMpOrderPayment(paymentId: string, payment: any): Promise<any> {
  if (await isProcessed('order-pay:' + paymentId)) return { success: true, message: null, already: true }
  const orderId = String(payment.external_reference || '').slice(6)
  if (!orderId) return { success: true, message: null, status: 'no-order' }
  const rows = await sb(`/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`)
  const order = rows && rows.length ? rows[0] : null
  if (!order) {
    await notify('Webhook MP pago sem pedido', `payment=${paymentId} order=${orderId}`)
    return { success: true, message: null, status: 'no-order' }
  }
  const st = await updateOrderPayment(orderId, payment)
  if (st === 'paid') {
    order.payment_status = 'paid'
    const store = await fetchStoreOwner(order.store_id)
    await sendOrderKindEmail(order, store && store.name, 'paid')
  }
  await notifyOrderPaid(order, payment)
  await markProcessed('order-pay:' + paymentId)
  return { success: true, message: null }
}

async function handleMpApprovedPayment(paymentId: string, payment: any): Promise<any> {
  if (await isProcessed('pay:' + paymentId)) return { success: true, message: null, already: true }
  const orderNsu = String(payment.external_reference || '')
  const storeId = await resolveStoreForMp(orderNsu, payment.preapproval_plan_id, payment.preapproval_id)
  if (!storeId) {
    await notify('Webhook MP aprovado sem loja (aguardando vinculo?)', JSON.stringify(payment, null, 2))
    return { success: true, message: null, status: 'no-store' }
  }
  const amount = payment.transaction_amount || (payment.transaction_details && payment.transaction_details.total_paid_amount)
  const capture = payment.payment_method_id || payment.payment_type_id || '-'
  const receipt = (payment.transaction_details && payment.transaction_details.external_resource_url) || ''
  await confirmPlan(storeId, orderNsu, { payment_id: paymentId }, capture, amount, receipt)
  await markProcessed('pay:' + paymentId)
  return { success: true, message: null }
}

async function handleMpPaymentWebhook(paymentId: string, userId: string): Promise<any> {
  const seller = await findStoreByMpUser(userId)
  const token = seller && seller.mp_access_token ? seller.mp_access_token : undefined
  let payment: any
  try {
    payment = await fetchMpPayment(paymentId, token)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  const status = String(payment.status || '')
  const ext = String(payment.external_reference || '')
  const isOrder = ext.indexOf('order:') === 0
  if (status !== 'approved') {
    if (isOrder) {
      try {
        await updateOrderPayment(ext.slice(6), payment)
      } catch (err) {
        await notify('Falha ao atualizar status do pedido', String(err))
      }
    }
    return { success: true, message: null, status }
  }
  if (isOrder) return handleMpOrderPayment(paymentId, payment)
  return handleMpApprovedPayment(paymentId, payment)
}

async function handleMpPreapprovalWebhook(subId: string): Promise<any> {
  if (!subId) throw new Error('Webhook preapproval sem id')
  let pre: any
  try {
    pre = await fetchMpPreapproval(subId)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  const status = String(pre.status || '')
  const storeId = await resolveStoreForMp(String(pre.external_reference || ''), pre.preapproval_plan_id, subId)
  if (!storeId) {
    await notify('Webhook MP preapproval sem loja', JSON.stringify(pre, null, 2))
    throw new Error('Loja nao identificada no preapproval')
  }
  if (status === 'canceled' || status === 'paused') {
    await patchStore(storeId, { mp_subscription_status: status })
    return { success: true, message: null, status }
  }
  if (status === 'authorized') {
    if (await isProcessed('sub:' + subId)) return { success: true, message: null, already: true }
    await patchStore(storeId, { mp_subscription_id: subId, mp_subscription_status: 'authorized' })
    await activatePlan(storeId)
    const row = await fetchStore(storeId)
    if (!row || row.plan !== 'pro') {
      await notify('ATENCAO: assinatura ativada mas plano nao confirmado', `sub=${subId}\nstoreId=${storeId}`)
      throw new Error('Plano nao confirmado como pro')
    }
    await notify(
      'Assinatura ativada - plano liberado',
      `Loja: ${row.name || row.slug || row.id}\nSubscription MP: ${subId}\nStatus: ${status}\nValidade: ${row.plan_expires_at}`
    )
    await markProcessed('sub:' + subId)
  }
  return { success: true, message: null, status }
}

async function handleMpAuthorizedPaymentWebhook(authId: string): Promise<any> {
  if (!authId) throw new Error('Webhook authorized_payment sem id')
  let auth: any
  try {
    auth = await fetchMpAuthorizedPayment(authId)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  const ext = String(auth.external_reference || '')
  const storeId = await resolveStoreForMp(ext, auth.preapproval_plan_id, auth.preapproval_id)
  if (!storeId) {
    await notify('Webhook MP authorized_payment sem loja', JSON.stringify(auth, null, 2))
    throw new Error('Loja nao identificada no authorized_payment')
  }
  const amount = auth.transaction_amount || auth.amount || '-'
  await handleMpApprovedPayment('ap:' + authId, {
    external_reference: ext || storeId + ':' + authId,
    status: 'approved',
    transaction_amount: amount,
    payment_method_id: auth.payment_method_id || '-'
  })
  return { success: true, message: null }
}

function isMpWebhook(params: URLSearchParams, body: any): boolean {
  if (params.get('wh') === 'mp') return true
  const type = String(body.type || params.get('topic') || '')
  const subTopics = ['preapproval', 'subscription_preapproval', 'subscription_authorized_payment', 'subscription_preapproval_plan', 'merchant_order']
  if (type === 'payment' || subTopics.indexOf(type) !== -1) return true
  if (body.data && body.data.id) return true
  return false
}

export async function mpWebhook(params: URLSearchParams, body: any): Promise<any> {
  const type = String(body.type || params.get('topic') || 'payment')
  const dataId = String((body.data && body.data.id) || params.get('id') || '')
  const userId = String(body.user_id || params.get('user_id') || '')

  if (type === 'preapproval' || type === 'subscription_preapproval') return handleMpPreapprovalWebhook(dataId)
  if (type === 'subscription_authorized_payment') return handleMpAuthorizedPaymentWebhook(dataId)
  if (type === 'merchant_order' || type === 'subscription_preapproval_plan') return { success: true, message: null, ignored: type }
  return handleMpPaymentWebhook(dataId, userId)
}

export async function infiniteWebhook(body: any): Promise<any> {
  const orderNsu = String(body.order_nsu || '')
  const storeId = resolveStoreFromOrderNsu(orderNsu) || String(body.store_id || '')
  if (!storeId) {
    await notify('Webhook sem loja identificada', JSON.stringify(body, null, 2))
    throw new Error('Loja nao identificada no webhook')
  }
  await confirmPlan(storeId, orderNsu, body, body.capture_method || '-', body.amount || '-', body.receipt_url)
  return { success: true, message: null }
}

export { isMpWebhook }
