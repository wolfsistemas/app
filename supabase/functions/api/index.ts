// VitrineZap — API unica em Supabase Edge Function (substitui o Apps Script).
// Deploy: supabase functions deploy api --no-verify-jwt
// Secrets: ver README (SUPABASE_URL/SERVICE_ROLE auto-injetados).
import { cors, json, readBody } from './_shared/http.ts'
import { provider } from './_shared/mp.ts'
import { notify } from './_shared/email.ts'
import { mpConnect, mpCallback, mpStatus, mpDisconnect } from './handlers/oauth.ts'
import { createPix, orderNotify, refundOrder } from './handlers/orders.ts'
import { checkout, subscribe, cancelSubscription, syncSubscription } from './handlers/billing.ts'
import { mpWebhook, infiniteWebhook, isMpWebhook } from './handlers/webhooks.ts'
import { pushTest, deleteAccount } from './handlers/account.ts'
import { upload } from './handlers/upload.ts'

const ROUTES = [
  'checkout',
  'subscribe',
  'cancel_subscription',
  'sync_subscription',
  'mp_connect',
  'mp_callback',
  'mp_status',
  'mp_disconnect',
  'create_pix',
  'refund_payment',
  'order_notify',
  'push_test',
  'delete_account',
  'upload'
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)

  try {
    // GET: callback OAuth do MP ou ping.
    if (req.method === 'GET') {
      if (url.searchParams.get('code') && url.searchParams.get('state')) {
        return await mpCallback(url.searchParams)
      }
      return json({ ok: true, service: 'vitrinezap-api', provider: provider(), routes: ROUTES })
    }

    const body = await readBody(req)
    const params = url.searchParams
    const action = String(body.action || params.get('action') || '')

    if (action) {
      switch (action) {
        case 'checkout':
          return await checkout(req, body)
        case 'subscribe':
          return await subscribe(req, body)
        case 'cancel_subscription':
          return await cancelSubscription(req, body)
        case 'sync_subscription':
          return await syncSubscription(req, body)
        case 'mp_connect':
          return await mpConnect(req, body)
        case 'mp_status':
          return await mpStatus(req, body)
        case 'mp_disconnect':
          return await mpDisconnect(req, body)
        case 'create_pix':
          return await createPix(req, body)
        case 'refund_payment':
          return await refundOrder(req, body)
        case 'order_notify':
          return await orderNotify(req, body)
        case 'push_test':
          return await pushTest(req, body)
        case 'delete_account':
          return await deleteAccount(req, body)
        case 'upload':
          return await upload(req, body)
        default:
          return json({ ok: false, error: 'action desconhecida: ' + action })
      }
    }

    if (body.image) return await upload(req, body)

    // Sem action: webhooks.
    if (params.get('wh') === 'mp' || isMpWebhook(params, body)) {
      return json(await mpWebhook(params, body))
    }
    return json(await infiniteWebhook(body))
  } catch (err) {
    const message = String((err as Error)?.message || err)
    console.error('api erro', message, (err as Error)?.stack)
    await notify('Erro na api', `${message}\n${(err as Error)?.stack || ''}`)
    // 500 -> provedores de webhook reenviam.
    return json({ ok: false, error: message }, 500)
  }
})
