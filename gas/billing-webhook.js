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
 *      o GAS ativa a loja (plan=pro, plan_expires_at=+30d) via Supabase REST e
 *      CONFIRMA com uma nova leitura antes de responder success.
 *
 * Configuração (Project Settings > Script properties):
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE   service_role
 *   INFINITEPAY_HANDLE      sua InfiniteTag (ex.: maiconvss, sem $)
 *   EMAIL_LOG               e-mail dos logs (padrão: wolfsaasbr@gmail.com)
 */

var PLAN_DAYS = 30
var INFINITEPAY_API = 'https://api.checkout.infinitepay.io/links'
var DEFAULT_LOG_EMAIL = 'wolfsaasbr@gmail.com'

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function props() {
  return PropertiesService.getScriptProperties()
}

function notify(subject, body) {
  try {
    var email = props().getProperty('EMAIL_LOG') || DEFAULT_LOG_EMAIL
    MailApp.sendEmail(email, '[VitrineZap] ' + subject, String(body).slice(0, 3000))
  } catch (err) {
    console.log('Falha ao enviar e-mail de log: ' + err)
  }
}

function parseBody(e) {
  var raw = (e.postData && e.postData.contents) || ''
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
    notify('Falha ao gerar checkout (loja ' + storeId + ')', text)
    return {
      ok: false,
      error: parsed.message || parsed.error || 'InfinitePay recusou',
      status: res.getResponseCode()
    }
  }
  return { ok: true, url: checkoutUrl, order_nsu: orderNsu }
}

function fetchStore(storeId) {
  var p = props()
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  var res = UrlFetchApp.fetch(
    p.getProperty('SUPABASE_URL') +
      '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId) +
      '&select=id,slug,plan,plan_expires_at,name',
    {
      method: 'get',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      muteHttpExceptions: true
    }
  )
  if (res.getResponseCode() >= 300) throw new Error('GET stores falhou')
  var rows = JSON.parse(res.getContentText() || '[]')
  return rows && rows.length ? rows[0] : null
}

function activatePlan(storeId) {
  var p = props()
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  var expires = new Date(Date.now() + PLAN_DAYS * 86400000).toISOString()
  var res = UrlFetchApp.fetch(
    p.getProperty('SUPABASE_URL') + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId),
    {
      method: 'patch',
      contentType: 'application/json',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({
        plan: 'pro',
        plan_expires_at: expires
      }),
      muteHttpExceptions: true
    }
  )
  if (res.getResponseCode() >= 300) {
    throw new Error('PATCH stores falhou (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300))
  }
  return expires
}

function doPost(e) {
  var body = parseBody(e)
  try {
    if (body.action === 'checkout') {
      return jsonOut(handleCheckout(body))
    }
    // Webhook: venda confirmada pela InfinitePay.
    var orderNsu = String(body.order_nsu || '')
    var storeId = (orderNsu.indexOf(':') > 0 ? orderNsu.split(':')[0] : orderNsu) || String(body.store_id || '')
    if (!storeId) {
      notify('Webhook sem loja identificada', JSON.stringify(body))
      throw new Error('Loja não identificada no webhook')
    }
    activatePlan(storeId)
    var row = fetchStore(storeId)
    if (!row || row.plan !== 'pro') {
      notify('ATENÇÃO: plano não confirmado como pro', JSON.stringify(body))
      throw new Error('Plano não confirmado como pro')
    }
    notify(
      'Pagamento recebido - plano ativado',
      'Venda efetuada e paga!\nLoja: ' + (row.name || row.slug || row.id) +
        '\nValidade: ' + row.plan_expires_at +
        '\norder_nsu: ' + orderNsu +
        '\ntransaction_nsu: ' + (body.transaction_nsu || '-') +
        '\ncapture_method: ' + (body.capture_method || '-') +
        '\namount: ' + (body.amount || '-') +
        '\nreceipt_url: ' + (body.receipt_url || '-')
    )
    return jsonOut({ success: true, message: null })
  } catch (err) {
    notify('Erro no webhook - ' + String((err && err.message) || err), JSON.stringify(body))
    // HTTP 500 -> InfinitePay reenvia
    throw err
  }
}

function doGet() {
  return jsonOut({ ok: true, service: 'vitrinezap-billing' })
}
