// Cobranca do plano: checkout avulso, assinatura recorrente MP e cancelamento.
import { json, env } from '../_shared/http.ts'
import { fetchStore, patchStore, activatePlan } from '../_shared/supabase.ts'
import {
  provider,
  mpMasterToken,
  mpSandbox,
  publicApiUrl,
  ensureMpPlan
} from '../_shared/mp.ts'
import { notify } from '../_shared/email.ts'

const PLAN_TITLE = 'Plano Loja VitrineZap (30 dias)'

async function checkoutInfinite(body: Record<string, unknown>) {
  const handle = env('INFINITEPAY_HANDLE')
  if (!handle) return { ok: false, error: 'INFINITEPAY_HANDLE ausente' }
  const storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  const priceCents = Number(body.price_cents || body.amount_cents || 990)
  const orderNsu = storeId + ':' + Date.now()
  const payload: Record<string, unknown> = {
    handle,
    order_nsu: orderNsu,
    redirect_url: body.redirect_url || '',
    webhook_url: `${publicApiUrl()}?wh=infinitepay`,
    items: [{ quantity: 1, price: priceCents, description: PLAN_TITLE }]
  }
  if (body.name || body.email) {
    payload.customer = { name: String(body.name || ''), email: String(body.email || '') }
  }
  const res = await fetch('https://api.checkout.infinitepay.io/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  const url = parsed.url || parsed.checkout_url || parsed?.data?.url || parsed?.data?.checkout_url
  if (res.status >= 300 || !url) {
    await notify(`Falha ao gerar checkout (loja ${storeId})`, text)
    return { ok: false, error: parsed.message || parsed.error || 'InfinitePay recusou', status: res.status }
  }
  return { ok: true, url, order_nsu: orderNsu }
}

async function checkoutMp(body: Record<string, unknown>) {
  const token = mpMasterToken()
  if (!token) return { ok: false, error: 'MP_ACCESS_TOKEN ausente' }
  const storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  const priceCents = Number(body.price_cents || body.amount_cents || 990)
  const orderNsu = storeId + ':' + Date.now()
  const redirect = String(body.redirect_url || '')
  const payload: Record<string, unknown> = {
    items: [{ title: PLAN_TITLE, quantity: 1, unit_price: priceCents / 100, currency_id: 'BRL' }],
    external_reference: orderNsu,
    notification_url: `${publicApiUrl()}?wh=mp`,
    back_urls: { success: redirect, pending: redirect, failure: redirect },
    auto_return: 'approved',
    statement_descriptor: 'VITRINEZAP'
  }
  if (body.name || body.email) {
    payload.payer = { name: String(body.name || ''), email: String(body.email || ''), identification: {} }
  }
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  const url = mpSandbox() ? parsed.sandbox_init_point : parsed.init_point || parsed.sandbox_init_point
  if (res.status >= 300 || !url) {
    await notify(`Falha ao gerar checkout MP (loja ${storeId})`, text)
    return { ok: false, error: parsed.message || parsed.error || 'Mercado Pago recusou', status: res.status }
  }
  return { ok: true, url, order_nsu: orderNsu }
}

export async function checkout(_req: Request, body: Record<string, unknown>) {
  const result = provider() === 'mp' ? await checkoutMp(body) : await checkoutInfinite(body)
  return json(result)
}

export async function subscribe(_req: Request, body: Record<string, unknown>) {
  if (provider() !== 'mp') return json({ ok: false, error: 'Assinatura recorrente exige PAYMENT_PROVIDER=mp' })
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const plan = await ensureMpPlan(storeId, String(body.redirect_url || ''))
  if (plan.error) return json({ ok: false, error: plan.error, status: plan.status })
  return json({ ok: true, url: plan.url, plan_id: plan.plan_id })
}

export async function cancelSubscription(_req: Request, body: Record<string, unknown>) {
  if (provider() !== 'mp') return json({ ok: false, error: 'Cancelamento exige PAYMENT_PROVIDER=mp' })
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const row = await fetchStore(storeId)
  if (!row) return json({ ok: false, error: 'Loja nao encontrada' })
  const subId = String(row.mp_subscription_id || '')
  if (!subId) return json({ ok: false, error: 'Esta loja nao possui assinatura registrada' })
  const token = mpMasterToken()
  if (!token) return json({ ok: false, error: 'MP_ACCESS_TOKEN ausente' })

  const res = await fetch('https://api.mercadopago.com/preapproval/' + encodeURIComponent(subId), {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'canceled' })
  })
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (res.status >= 300) {
    await notify(`Falha ao cancelar assinatura (loja ${storeId}, sub ${subId})`, text)
    return json({ ok: false, error: parsed.message || parsed.error || 'Mercado Pago recusou o cancelamento', status: res.status })
  }
  await patchStore(storeId, { mp_subscription_status: 'canceled' })
  await notify('Assinatura cancelada', `Loja: ${row.name || row.slug || row.id}\nSubscription MP: ${subId}`)
  return json({ ok: true, subscription_id: subId })
}

// Rede de seguranca apos voltar do checkout MP (?plano=ok): ativa sem depender do webhook.
export async function syncSubscription(_req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const token = mpMasterToken()
  if (!token) return json({ ok: false, error: 'MP_ACCESS_TOKEN ausente' })
  const row = await fetchStore(storeId)
  if (!row) return json({ ok: false, error: 'Loja nao encontrada' })
  if (row.plan === 'pro') return json({ ok: true, status: 'already-active', plan_expires_at: row.plan_expires_at })
  const planId = String(row.mp_plan_id || '')
  if (!planId) return json({ ok: false, error: 'mp_plan_id vazio (assine primeiro)' })

  const res = await fetch(
    'https://api.mercadopago.com/preapproval/search?preapproval_plan_id=' + encodeURIComponent(planId) + '&status=authorized&limit=1',
    { headers: { Authorization: 'Bearer ' + token } }
  )
  const text = await res.text()
  if (res.status >= 300) {
    await notify(`Sync assinatura falhou (loja ${storeId})`, text.slice(0, 600))
    return json({ ok: false, error: 'Mercado Pago recusou a consulta', status: res.status })
  }
  let data: any = {}
  try {
    data = JSON.parse(text || '{}')
  } catch {
    data = {}
  }
  const found = (data.results || [])[0]
  if (!found) return json({ ok: false, status: 'no-subscription', error: 'Nenhuma assinatura autorizada encontrada no MP' })

  const subId = String(found.id)
  await patchStore(storeId, { mp_subscription_id: subId, mp_subscription_status: 'authorized' })
  await activatePlan(storeId)
  const row2 = await fetchStore(storeId)
  await notify(
    'Assinatura ativada (sync) - plano liberado',
    `Loja: ${row2?.name || row2?.slug || row2?.id}\nSubscription MP: ${subId}\nValidade: ${row2?.plan_expires_at}`
  )
  return json({ ok: true, status: 'activated', subscription_id: subId, plan_expires_at: row2 && row2.plan_expires_at })
}
