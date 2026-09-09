/**
 * VitrineZap — Apps Script "tudo em um" (OPÇÃO PROJETO ÚNICO).
 *
 * Se preferir UM projeto GAS só (uma URL de deploy servindo upload,
 * checkout e webhook), cole APENAS este arquivo (gas/all-in-one.js)
 * num projeto novo e use a mesma .../exec no VITE_UPLOAD_URL e no
 * VITE_BILLING_URL.
 *
 * Se preferir DOIS projetos separados, use gas/upload.js e
 * gas/billing-webhook.js (cada um com sua própria URL).
 *
 * Roteamento automático:
 *   POST { action: "checkout", ... } -> gera link InfinitePay
 *   POST { image, ... }             -> upload ImgBB
 *   POST evento da InfinitePay       -> ativa/renova o plano no Supabase
 *
 * Configuração (Project Settings > Script properties):
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE   service_role (fica SÓ aqui, nunca no front)
 *   IMGBB_API_KEY           chave ImgBB
 *   UPLOAD_TOKEN            token opcional de upload (igual ao VITE_UPLOAD_TOKEN)
 *   INFINITEPAY_HANDLE      handle do checkout InfinitePay
 *   INFINITEPAY_SECRET      assinatura do webhook (opcional)
 *
 * Deploy: New deployment > Web app > Execute as: Me / Who has access: Anyone.
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
  var body = {}
  try {
    body = JSON.parse(raw)
  } catch (err) {
    body = {}
  }
  body.__raw = raw
  return body
}

/* ---------------- UPLOAD ImgBB ---------------- */

function handleUpload(body) {
  var key = props().getProperty('IMGBB_API_KEY')
  if (!key) return { error: 'IMGBB_API_KEY ausente' }

  var token = props().getProperty('UPLOAD_TOKEN')
  if (token && body.token !== token) return { error: 'Não autorizado' }
  if (!body.image) return { error: 'Imagem ausente' }

  var payload = {
    key: key,
    image: body.image,
    name: body.name || 'vitrinezap'
  }
  var res = UrlFetchApp.fetch('https://api.imgbb.com/1/upload', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  })
  var parsed = JSON.parse(res.getContentText() || '{}')
  var url = parsed.data && (parsed.data.display_url || parsed.data.url)
  if (!url) {
    return { error: (parsed.error && parsed.error.message) || 'ImgBB recusou o upload' }
  }
  return {
    url: url,
    thumb: parsed.data.thumb && parsed.data.thumb.url
  }
}

/* ---------------- CHECKOUT InfinitePay ---------------- */

function handleCheckout(body) {
  var handle = props().getProperty('INFINITEPAY_HANDLE')
  if (!handle) return { ok: false, error: 'INFINITEPAY_HANDLE ausente no GAS' }

  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }

  var priceCents = Number(body.price_cents || body.amount_cents || 1990)
  var payload = {
    plan: 'pro',
    price_cents: priceCents,
    quantity: 1,
    store_id: storeId,
    email: body.email || '',
    name: body.name || ''
  }

  var res = UrlFetchApp.fetch(INFINITEPAY_API, {
    method: 'post',
    contentType: 'application/json',
    headers: { handle: handle },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  var checkoutUrl =
    parsed.url ||
    parsed.checkout_url ||
    (parsed.data && (parsed.data.url || parsed.data.checkout_url))
  if (res.getResponseCode() >= 300 || !checkoutUrl) {
    return {
      ok: false,
      error: parsed.message || parsed.error || 'InfinitePay recusou',
      status: res.getResponseCode()
    }
  }
  return { ok: true, url: checkoutUrl }
}

/* ---------------- WEBHOOK de pagamento ---------------- */

function extractStoreId(body) {
  var obj = body.data || body.object || body
  var candidates = [
    obj.store_id,
    obj.reference_id,
    obj.client_id,
    obj.client && obj.client.id,
    body.store_id,
    body.reference_id,
    body.client_id,
    body.metadata && body.metadata.store_id
  ]
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i]
    if (typeof v === 'string' && v && v.indexOf('store_') !== -1) return v
  }
  for (var j = 0; j < candidates.length; j++) {
    if (typeof candidates[j] === 'string' && candidates[j]) return candidates[j]
  }
  return ''
}

function signatureOk(body) {
  var secret = props().getProperty('INFINITEPAY_SECRET')
  if (!secret) return true
  var sent = body.__sig || ''
  if (!sent) return false
  var expected = Utilities.computeHmacSha256Signature(body.__raw || '', secret)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2) })
    .join('')
  var a = String(sent).toLowerCase()
  var b = expected.toLowerCase()
  var ok = a.length === b.length
  for (var i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) ok = false
  }
  return ok
}

function activatePlan(storeId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) {
    return { ok: false, error: 'SUPABASE_URL/SERVICE_ROLE ausentes' }
  }
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
  return { ok: res.getResponseCode() < 300, status: res.getResponseCode() }
}

function handleWebhook(e, body) {
  if (body.action === 'upload') return jsonOut(handleUpload(body))
  var sig = (e.parameter && e.parameter['x-infinitepay-signature']) || (e.parameter && e.parameter.signature) || ''
  body.__sig = sig
  if (!signatureOk(body)) {
    return { ok: false, error: 'Assinatura inválida' }
  }
  var status = String(body.event || (body.data && body.data.status) || '')
  var approved =
    status.indexOf('approved') !== -1 ||
    status.indexOf('paid') !== -1 ||
    status.indexOf('confirmed') !== -1
  if (!approved) {
    return { ok: true, ignored: true }
  }
  var storeId = extractStoreId(body)
  if (!storeId) return { ok: false, error: 'Loja não identificada no webhook' }
  return { ok: activatePlan(storeId).ok }
}

/* ---------------- ROTEADOR ---------------- */

function doPost(e) {
  var body = parseBody(e)
  var result

  if (body.action === 'checkout') {
    result = handleCheckout(body)
  } else if (body.action === 'upload' || body.image) {
    result = handleUpload(body)
  } else {
    result = handleWebhook(e, body)
  }
  return jsonOut(result)
}

function doGet() {
  return jsonOut({
    ok: true,
    service: 'vitrinezap',
    routes: ['checkout', 'upload', 'webhook de pagamento']
  })
}
