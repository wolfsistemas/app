// Acesso ao Supabase com service_role (bypassa RLS) + helpers de loja/pedido.
import { env } from './http.ts'

export const SB_URL = env('SUPABASE_URL')
export const SB_SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')

const PLAN_DAYS = 30

type SbOptions = {
  method?: string
  payload?: unknown
  prefer?: string
}

export async function sb(path: string, options: SbOptions = {}): Promise<any> {
  if (!SB_URL || !SB_SERVICE) throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes')
  const headers: Record<string, string> = {
    apikey: SB_SERVICE,
    Authorization: `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json'
  }
  if (options.prefer) headers.Prefer = options.prefer
  const res = await fetch(SB_URL + '/rest/v1' + path, {
    method: options.method || 'GET',
    headers,
    body: options.payload === undefined ? undefined : JSON.stringify(options.payload)
  })
  const text = await res.text()
  if (res.status >= 300) {
    throw new Error(`Supabase ${options.method || 'GET'} ${path} falhou (${res.status}): ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text || 'null')
  } catch {
    return null
  }
}

export async function fetchStoreOwner(storeId: string): Promise<any> {
  const rows = await sb(`/stores?id=eq.${encodeURIComponent(storeId)}&select=id,owner_id,name&limit=1`)
  return rows && rows.length ? rows[0] : null
}

export async function fetchStore(storeId: string): Promise<any> {
  const rows = await sb(
    `/stores?id=eq.${encodeURIComponent(storeId)}` +
      '&select=id,slug,plan,plan_expires_at,name,mp_subscription_id,mp_subscription_status,mp_plan_id&limit=1'
  )
  return rows && rows.length ? rows[0] : null
}

export async function patchStore(storeId: string, fields: Record<string, unknown>): Promise<void> {
  await sb(`/stores?id=eq.${encodeURIComponent(storeId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    payload: fields
  })
}

export function planExpiresAt(): string {
  return new Date(Date.now() + PLAN_DAYS * 86400000).toISOString()
}

export async function activatePlan(storeId: string): Promise<void> {
  await patchStore(storeId, { plan: 'pro', plan_expires_at: planExpiresAt() })
}

export async function fetchOwnerEmail(ownerId: string): Promise<string> {
  if (!ownerId) return ''
  try {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }
    })
    if (res.status >= 300) return ''
    const user = await res.json()
    return String(user?.email || '')
  } catch {
    return ''
  }
}

export async function getAuthUser(jwt: string): Promise<any | null> {
  if (!jwt) return null
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` }
  })
  if (res.status >= 300) return null
  try {
    const user = await res.json()
    return user?.id ? user : null
  } catch {
    return null
  }
}

// Valida que o JWT do usuario logado e o dono da loja.
export async function assertStoreOwner(storeId: string, jwt: string): Promise<any> {
  const row = await fetchStoreOwner(storeId)
  if (!row) return { ok: false, error: 'Loja nao encontrada' }
  if (!jwt) return { ok: false, error: 'Sessao ausente' }
  const user = await getAuthUser(jwt)
  if (!user) return { ok: false, error: 'Sessao invalida' }
  if (String(user.id || '') !== String(row.owner_id || '')) {
    return { ok: false, error: 'Nao autorizado' }
  }
  return { ok: true, row }
}

// Idempotencia: checa antes; marca somente apos sucesso (permite retry).
export async function isProcessed(key: string): Promise<boolean> {
  const rows = await sb(`/processed_events?key=eq.${encodeURIComponent(key)}&select=key&limit=1`)
  return Boolean(rows && rows.length)
}

export async function markProcessed(key: string): Promise<void> {
  await sb('/processed_events', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=minimal',
    payload: { key }
  })
}

export function resolveStoreFromOrderNsu(orderNsu: string): string {
  let s = String(orderNsu || '')
  if (s.indexOf('sub:') === 0) s = s.slice(4)
  const i = s.indexOf(':')
  if (i > 0) return s.slice(0, i)
  return s
}

export async function findStoreIdByPlanId(planId: string): Promise<string> {
  if (!planId) return ''
  const rows = await sb(`/stores?mp_plan_id=eq.${encodeURIComponent(planId)}&select=id&limit=1`)
  return rows && rows.length ? String(rows[0].id) : ''
}
