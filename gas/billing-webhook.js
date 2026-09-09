/**
 * Google Apps Script — cobrança InfinitePay (OPÇÃO DOIS PROJETOS).
 *
 * Use este arquivo apenas se preferir um GAS separado do upload.
 * Para projeto único, use gas/all-in-one.js.
 *
 * Fluxo:
 *   1. App chama POST { action: "checkout", store_id, email, name, redirect_url }
 *   2. Este GAS chama a InfinitePay (POST /links) e devolve { url }.
 *   3. Ao confirmar o pagamento, a InfinitePay chama a própria URL deste Web App;
 *      o GAS ativa a loja (plan=pro, plan_expires_at=+30d) via Supabase REST.
 *
 * Configuração (Project Settings > Script properties):
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE   service_role
 *   INFINITEPAY_HANDLE      sua InfiniteTag (ex.: maiconvss, sem $)
 */

var PLAN_DAYS = 30
var INFINITEPAY_API = 'https://api.checkout.infinitepay.io/links'

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function props() {
  return PropertiesService.getScriptProperties()
}

function parseBody(e) {
  var raw = (e.postData && e.postData.contents) || '{}'
  try {
    return JSON.parse(raw)
  } catch (err) {
    return {}
  }
}

function handleCheckout(body) {
  var handle = props().getProperty('INFINITEPAY_HANDLE')
  if (!handle) return { ok: false, error: 'INFINITEPAY_HANDLE ausente no GAS' }

  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }

  var priceCents = Number(body.price_cents || body.amount_cents || 990)
  var orderNsu = storeId + ':' + Date.now()

  var payload = {
    handle: handle,
    order_nsu: orderNsu,
    redirect_url: body.redirect_url || '',
    webhook_url: ScriptApp.getService().getUrl(),
    items: [
      {
        quantity: 1,
        price: priceCents,
        description: 'Plano Loja VitrineZap (30 dias)'
      }
    ]
  }
  if (body.name || body.email) {
    payload.customer = {
      name: String(body.name || ''),
      email: String(body.email || '')
    }
  }

  var res = UrlFetchApp.fetch(INFINITEPAY_API, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  var checkoutUrl = parsed.url || (parsed.data && parsed.data.url)
  if (res.getResponseCode() >= 300 || !checkoutUrl) {
    return {
      ok: false,
      error: parsed.message || parsed.error || 'InfinitePay recusou',
      status: res.getResponseCode()
    }
  }
  return { ok: true, url: checkoutUrl }
}

function activatePlan(storeId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) return { ok: false }
  var expires = new Date(Date.now() + PLAN_DAYS * 86400000).toISOString()
  var res = UrlFetchApp.fetch(url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId), {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({
      plan: 'pro',
      plan_expires_at: expires,
      updated_at: new Date().toISOString()
    }),
    muteHttpExceptions: true
  })
  return { ok: res.getResponseCode() < 300 }
}

function doPost(e) {
  var body = parseBody(e)
  if (body.action === 'checkout') {
    return jsonOut(handleCheckout(body))
  }
  // Webhook: a InfinitePay avisa quando a venda foi confirmada.
  var storeId = ''
  var orderNsu = String(body.order_nsu || '')
  if (orderNsu.indexOf(':') > 0) storeId = orderNsu.split(':')[0]
  if (!storeId) storeId = String(body.store_id || '')
  if (!storeId) {
    return jsonOut({ success: false, message: 'Loja não identificada no webhook' })
  }
  var result = activatePlan(storeId)
  return jsonOut({
    success: result.ok,
    message: result.ok ? null : 'Falha ao ativar o plano'
  })
}

function doGet() {
  return jsonOut({ ok: true, service: 'vitrinezap-billing' })
}
