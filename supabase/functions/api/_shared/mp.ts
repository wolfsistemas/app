// Integracao com o Mercado Pago (checkout, assinatura, OAuth do vendedor, Pix).
import { env } from './http.ts'
import { sb, findStoreIdByPlanId, fetchStore, patchStore } from './supabase.ts'

export const PLAN_DAYS = 30
export const PLAN_TITLE = 'Plano Loja VitrineZap (30 dias)'
export const PLAN_MONTHLY_TITLE = 'VitrineZap Plano Loja (assinatura mensal)'

export function provider(): string {
  return env('PAYMENT_PROVIDER', 'mp').toLowerCase()
}

export function mpMasterToken(): string {
  return env('MP_ACCESS_TOKEN')
}

export function mpSandbox(): boolean {
  return env('MP_USE_SANDBOX').toLowerCase() === 'true'
}

export function publicApiUrl(): string {
  return env('PUBLIC_API_URL').replace(/\/+$/, '')
}

export function mpRedirectUri(): string {
  return env('MP_REDIRECT_URI') || `${publicApiUrl()}?action=mp_callback`
}

export function isNotFound(err: unknown): boolean {
  const msg = String((err as Error)?.message || err)
  return /404/.test(msg) || /not found/i.test(msg)
}

export async function mpFetch(path: string, token?: string): Promise<any> {
  const auth = token || mpMasterToken()
  if (!auth) throw new Error('MP_ACCESS_TOKEN ausente')
  const res = await fetch('https://api.mercadopago.com' + path, {
    headers: { Authorization: `Bearer ${auth}` }
  })
  const text = await res.text()
  if (res.status >= 300) {
    throw new Error(`GET ${path} falhou (${res.status}): ${text.slice(0, 300)}`)
  }
  return JSON.parse(text || '{}')
}

export function fetchMpPayment(paymentId: string, token?: string) {
  return mpFetch('/v1/payments/' + encodeURIComponent(paymentId), token)
}

export function fetchMpPreapproval(subId: string) {
  return mpFetch('/preapproval/' + encodeURIComponent(subId))
}

export function fetchMpAuthorizedPayment(authId: string) {
  return mpFetch('/authorized_payments/' + encodeURIComponent(authId))
}

export async function fetchStorePayment(storeId: string): Promise<any> {
  const rows = await sb(`/store_payments?store_id=eq.${encodeURIComponent(storeId)}&select=*&limit=1`)
  return rows && rows.length ? rows[0] : null
}

export async function findStoreByMpUser(userId: string): Promise<any> {
  if (!userId) return null
  const rows = await sb(
    `/store_payments?mp_user_id=eq.${encodeURIComponent(String(userId))}&select=store_id,mp_access_token&limit=1`
  )
  return rows && rows.length ? rows[0] : null
}

export async function upsertStorePayment(storeId: string, fields: Record<string, unknown>): Promise<void> {
  const payload: Record<string, unknown> = { ...fields, store_id: storeId, updated_at: new Date().toISOString() }
  await sb('/store_payments', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    payload
  })
}

export async function mpRefreshSellerToken(row: any): Promise<string | null> {
  const clientId = env('MP_CLIENT_ID')
  const clientSecret = env('MP_CLIENT_SECRET')
  if (!clientId || !clientSecret || !row?.mp_refresh_token) return null
  const res = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.mp_refresh_token
    })
  })
  const text = await res.text()
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (res.status >= 300 || !parsed.access_token) return null
  const expiresAt = parsed.expires_in ? new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString() : null
  await upsertStorePayment(row.store_id, {
    mp_access_token: parsed.access_token,
    mp_refresh_token: parsed.refresh_token || row.mp_refresh_token,
    mp_token_expires_at: expiresAt
  })
  return parsed.access_token
}

export async function mpSellerToken(storeId: string): Promise<string | null> {
  const row = await fetchStorePayment(storeId)
  if (!row || !row.mp_access_token) return null
  if (row.mp_token_expires_at) {
    const exp = new Date(row.mp_token_expires_at).getTime()
    if (exp && exp - Date.now() < 3600000) {
      const refreshed = await mpRefreshSellerToken(row)
      if (refreshed) return refreshed
    }
  }
  return row.mp_access_token
}

export function mpPlanCheckoutUrl(plan: any): string {
  if (mpSandbox()) return plan?.sandbox_init_point || plan?.init_point || ''
  return plan?.init_point || plan?.sandbox_init_point || ''
}

export async function mpCreatePlan(token: string, payload: unknown) {
  const res = await fetch('https://api.mercadopago.com/preapproval_plan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return { code: res.status, text: await res.text() }
}

// Garante o plano da loja (reusa o ativo; senao cria um e grava mp_plan_id).
export async function ensureMpPlan(storeId: string, redirectUrl: string): Promise<any> {
  const token = mpMasterToken()
  if (!token) return { error: 'MP_ACCESS_TOKEN ausente' }

  const row = await fetchStore(storeId)
  if (!row) return { error: 'Loja nao encontrada' }

  if (row.mp_plan_id) {
    try {
      const existing = await mpFetch('/preapproval_plan/' + encodeURIComponent(row.mp_plan_id))
      if (existing && String(existing.status || '') === 'active') {
        const url = mpPlanCheckoutUrl(existing)
        if (url) return { plan_id: String(existing.id), url }
      }
    } catch {
      // plano antigo invalido -> cria outro
    }
  }

  const priceCents = Number(env('PLAN_PRICE_CENTS', '990'))
  const unitPrice = priceCents / 100
  const webhook = `${publicApiUrl()}?wh=mp`

  const payload: Record<string, unknown> = {
    reason: PLAN_MONTHLY_TITLE,
    external_reference: 'plan:' + storeId,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: unitPrice,
      currency_id: 'BRL'
    },
    back_url: redirectUrl || '',
    notification_url: webhook
  }

  let res = await mpCreatePlan(token, payload)
  if (res.code >= 300 && res.code < 500 && /notification[_\s]?url/i.test(res.text)) {
    const fallback = { ...payload }
    delete fallback.notification_url
    res = await mpCreatePlan(token, fallback)
  }
  let parsed: any = {}
  try {
    parsed = JSON.parse(res.text)
  } catch {
    parsed = {}
  }
  if (res.code >= 300 || !parsed.id) {
    return { error: parsed.message || parsed.error || 'Mercado Pago recusou o plano', status: res.code }
  }
  const checkoutUrl = mpPlanCheckoutUrl(parsed)
  if (!checkoutUrl) return { error: 'Mercado Pago nao devolveu o link de assinatura', status: res.code }
  await patchStore(storeId, { mp_plan_id: String(parsed.id) })
  return { plan_id: String(parsed.id), url: checkoutUrl }
}

export async function resolveStoreForMp(ext: unknown, planId: unknown, preapprovalId: unknown): Promise<string> {
  const extStr = String(ext || '')
  let storeId = ''
  if (extStr.indexOf('plan:') === 0) {
    storeId = extStr.slice(5)
  } else {
    storeId = extStr ? extStr.split(':')[0] : ''
  }
  if (storeId) return storeId
  if (planId) storeId = await findStoreIdByPlanId(String(planId))
  if (!storeId && preapprovalId) {
    try {
      const pre = await fetchMpPreapproval(String(preapprovalId))
      if (pre?.preapproval_plan_id) storeId = await findStoreIdByPlanId(String(pre.preapproval_plan_id))
    } catch {
      // preapproval nao encontrado
    }
  }
  return storeId
}
