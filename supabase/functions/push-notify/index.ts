// VitrineZap — Edge Function de notificações push (PWA)
// Deploy: supabase functions deploy push-notify --no-verify-jwt
// Secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com
//   supabase secrets set PUSH_SECRET=um-segredo-forte
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.

import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)

  const secret = (req.headers.get('x-push-secret') || '').trim()
  const expected = (Deno.env.get('PUSH_SECRET') || '').trim()
  if (!expected || secret !== expected) {
    console.error('push unauthorized', {
      hasExpected: Boolean(expected),
      expectedLen: expected.length,
      secretLen: secret.length,
      match: secret === expected
    })
    return json(
      {
        ok: false,
        error: 'unauthorized',
        detail: !expected ? 'PUSH_SECRET nao configurado no Supabase' : 'PUSH_SECRET diferente do GAS'
      },
      401
    )
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:contato@vitrinezap.com'
  if (!publicKey || !privateKey) return json({ ok: false, error: 'vapid ausente' }, 500)

  webpush.setVapidDetails(subject, publicKey, privateKey)

  let body: Record<string, string> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'supabase env ausente' }, 500)

  const rest = `${supabaseUrl}/rest/v1/push_subscriptions?store_id=eq.${encodeURIComponent(storeId)}&select=id,endpoint,p256dh,auth`
  const listRes = await fetch(rest, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  })
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => '')
    return json({ ok: false, error: 'supabase ' + listRes.status, detail: text.slice(0, 300) }, 500)
  }
  const rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = await listRes.json()
  console.log('push send', { storeId, subs: rows.length })
  if (!rows.length) return json({ ok: true, sent: 0, removed: 0, note: 'sem assinaturas' })

  const payload = JSON.stringify({
    title: String(body.title || 'VitrineZap'),
    body: String(body.body || ''),
    url: String(body.url || ''),
    tag: String(body.tag || 'vz-order')
  })

  let sent = 0
  let removed = 0
  const dead: string[] = []

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload
        )
        sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        console.error('push falhou', { status, body: String((err as { body?: string })?.body || '').slice(0, 200) })
        if (status === 404 || status === 410) {
          dead.push(row.endpoint)
          removed += 1
        }
      }
    })
  )

  if (dead.length) {
    await Promise.all(
      dead.map((endpoint) =>
        fetch(
          `${supabaseUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
          {
            method: 'DELETE',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
          }
        ).catch(() => {})
      )
    )
  }

  return json({ ok: true, sent, removed })
})
