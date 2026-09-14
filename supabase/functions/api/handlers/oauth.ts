// OAuth do Mercado Pago na conta do vendedor (conectar/desconectar/status).
import { json, html, env, bearer } from '../_shared/http.ts'
import { assertStoreOwner, patchStore } from '../_shared/supabase.ts'
import {
  fetchStorePayment,
  mpRedirectUri,
  upsertStorePayment
} from '../_shared/mp.ts'
import { notify } from '../_shared/email.ts'

// Passo 1: devolve a URL de autorizacao do MP. O state carrega a loja e a URL
// de retorno do painel.
export async function mpConnect(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)
  const clientId = env('MP_CLIENT_ID')
  if (!clientId) return json({ ok: false, error: 'MP_CLIENT_ID ausente' })
  const state = storeId + '|' + String(body.redirect_url || '')
  const url =
    'https://auth.mercadopago.com.br/authorization' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&response_type=code' +
    '&platform_id=mp' +
    '&state=' + encodeURIComponent(state) +
    '&redirect_uri=' + encodeURIComponent(mpRedirectUri())
  return json({ ok: true, url })
}

function redirectPage(url: string): Response {
  const safe = String(url || '').replace(/"/g, '&quot;')
  return html(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="0;url=${safe}"></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px">Redirecionando...</body></html>`
  )
}

// Passo 2: o MP volta com ?code&state; trocamos por token e gravamos.
export async function mpCallback(params: URLSearchParams): Promise<Response> {
  const code = String(params.get('code') || '')
  const state = String(params.get('state') || '')
  const parts = state.split('|')
  const storeId = parts[0] || ''
  const front = (parts[1] || '').replace(/\/$/, '')
  const backOk = front ? front + '/painel?mp=connected' : ''
  const backErr = front ? front + '/painel?mp=error' : ''
  if (!code || !storeId) return redirectPage(backErr)

  try {
    const clientId = env('MP_CLIENT_ID')
    const clientSecret = env('MP_CLIENT_SECRET')
    if (!clientId || !clientSecret) throw new Error('MP_CLIENT_ID/MP_CLIENT_SECRET ausentes')
    const res = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: mpRedirectUri()
      })
    })
    const text = await res.text()
    let parsed: any = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {}
    }
    if (res.status >= 300 || !parsed.access_token) {
      await notify(`Falha no OAuth MP (loja ${storeId})`, text.slice(0, 800))
      return redirectPage(backErr)
    }
    const expiresAt = parsed.expires_in
      ? new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString()
      : null
    await upsertStorePayment(storeId, {
      provider: 'mp',
      mp_user_id: String(parsed.user_id || ''),
      mp_access_token: String(parsed.access_token),
      mp_refresh_token: String(parsed.refresh_token || ''),
      mp_public_key: String(parsed.public_key || ''),
      mp_token_expires_at: expiresAt,
      connected_at: new Date().toISOString()
    })
    await patchStore(storeId, { mp_connected: true })
    await notify('Mercado Pago conectado', `Loja ${storeId} conectou a conta MP (user ${parsed.user_id}).`)
    return redirectPage(backOk)
  } catch (err) {
    await notify(`Erro no OAuth MP (loja ${storeId})`, String((err as Error)?.stack || err))
    return redirectPage(backErr)
  }
}

export async function mpStatus(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)
  const row = await fetchStorePayment(storeId)
  return json({ ok: true, connected: Boolean(row && row.mp_access_token), mp_user_id: row ? String(row.mp_user_id || '') : '' })
}

export async function mpDisconnect(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)
  await upsertStorePayment(storeId, {
    mp_access_token: null,
    mp_refresh_token: null,
    mp_user_id: null,
    mp_token_expires_at: null
  })
  await patchStore(storeId, { mp_connected: false })
  return json({ ok: true })
}
