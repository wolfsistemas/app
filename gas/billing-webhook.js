/**
 * Google Apps Script — webhook de pagamento (InfinitePay / genérico).
 *
 * Fluxo de assinatura:
 *   1. O app pede um "link de pagamento" ao GAS (doPost com body { action: "checkout" }).
 *   2. O GAS chama a InfinitePay (POST /links) com o handle da conta e devolve a url.
 *   3. Ao confirmar, a InfinitePay chama ESTE webhook; o GAS marca a loja
 *      plan = "pro" e plan_expires_at = agora + 30 dias via REST do Supabase.
 *
 * Configuração:
 *   1. Cole este arquivo num projeto GAS (pode ser o mesmo do upload).
 *   2. Deploy > Web app, executa como você, acesso: qualquer um.
 *   3. Script properties:
 *        SUPABASE_URL            https://xxxx.supabase.co
 *        SUPABASE_SERVICE_ROLE   service_role (fica SÓ aqui)
 *        INFINITEPAY_HANDLE      handle do checkout (opcional: usado para /links)
 *        INFINITEPAY_SECRET      assinatura do webhook (opcional)
 *   4. No painel da InfinitePay, configure o webhook com a URL: .../exec
 *   5. No .env do app:
 *        VITE_BILLING_URL=https://script.google.com/macros/s/.../exec
 *
 * Campos do link de pagamento (ajuste se a InfinitePay pedir nomes diferentes):
 *   { action: "checkout", store_id, email, name, plan: "pro" }
 */

var PLAN_DAYS = 30

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function parseBody(e) {
  try {
    var raw = (e.postData && e.postData.contents) || '{}'
    var json = JSON.parse(raw)
    json.__raw = raw
    return json
  } catch (err) {
    return {}
  }
}

function props() {
  return PropertiesService.getScriptProperties()
}

function extractStoreId(body) {
  var obj = body.data || body.object || body
  var candidates = [
    obj.store_id,
    obj.reference_id,
    obj.client_id,
    obj.client && obj.client.id,
    body.store_id,
    body.reference_id,
    body.client_id
  ]
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i]
    if (typeof v === 'string' && v && v.indexOf('store_') !== -1) return v
    if (typeof v === 'string' && v && v.indexOf('@') !== -1 && v.indexOf('-') !== -1) return v
  }
  for (var j = 0; j < candidates.length; j++) {
    if (typeof candidates[j] === 'string' && candidates[j]) return candidates[j]
  }
  return ''
}

function signatureOk(e, body) {
  var secret = props().getProperty('INFINITEPAY_SECRET')
  if (!secret) return true
  var sent = e.parameter['x-infinitepay-signature'] || e.parameter['signature'] || ''
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
  if (!url || !serviceKey) return { ok: false, error: 'SUPABASE_URL/SERVICE_ROLE ausentes' }
  var expires = new Date(Date.now() + PLAN_DAYS * 86400000).toISOString()
  var res = UrlFetchApp.fetch(url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId), {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({ plan: 'pro', plan_expires_at: expires, updated_at: new Date().toISOString() }),
    muteHttpExceptions: true
  })
  return { ok: res.getResponseCode() < 300, status: res.getResponseCode() }
}

function handleCheckout(body) {
  var p = props()
  var handle = p.getProperty('INFINITEPAY_HANDLE')
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

  var res = UrlFetchApp.fetch('https://api.checkout.infinitepay.io/links', {
    method: 'post',
    contentType: 'application/json',
    headers: { handle: handle },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try { parsed = JSON.parse(text) } catch (err) { /* resposta não-JSON */ }
  var checkoutUrl = (parsed.url) || (parsed.checkout_url) || (parsed.data && (parsed.data.url || parsed.data.checkout_url))
  if (res.getResponseCode() >= 300 || !checkoutUrl) {
    return { ok: false, error: (parsed.message || parsed.error || 'InfinitePay recusou'), status: res.getResponseCode() }
  }
  return { ok: true, url: checkoutUrl }
}

function doPost(e) {
  var body = parseBody(e)
  if (body.action === 'checkout') {
    return jsonOut(handleCheckout(body))
  }
  // Fluxo de webhook (aviso de pagamento aprovado)
  if (!signatureOk(e, body)) {
    return jsonOut({ ok: false, error: 'Assinatura inválida' })
  }
  var status = String(body.event || (body.data && body.data.status) || '')
  var approved =
    status.indexOf('approved') !== -1 ||
    status.indexOf('paid') !== -1 ||
    status.indexOf('confirmed') !== -1 ||
    status === 'pro'
  if (!approved) {
    return jsonOut({ ok: true, ignored: true })
  }
  var storeId = extractStoreId(body)
  if (!storeId) return jsonOut({ ok: false, error: 'Loja não identificada no webhook' })
  var result = activatePlan(storeId)
  return jsonOut({ ok: result.ok })
}

function doGet() {
  return jsonOut({ ok: true, service: 'vitrinezap-billing', help: 'Configure o webhook da InfinitePay para esta URL.' })
}
