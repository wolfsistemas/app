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
 *   INFINITEPAY_HANDLE      sua InfiniteTag (ex.: maiconvss, sem o $)
 *   EMAIL_LOG               e-mail que recebe os logs (padrão: wolfsaasbr@gmail.com)
 *
 * Deploy: New deployment > Web app > Execute as: Me / Who has access: Anyone.
 * O webhook do pagamento aponta para a própria URL deste Web App (o GAS usa
 * ScriptApp.getService().getUrl() como webhook_url no checkout).
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

/* ---------------- LOG por e-mail ---------------- */

function notify(subject, body) {
  try {
    var email = props().getProperty('EMAIL_LOG') || DEFAULT_LOG_EMAIL
    MailApp.sendEmail(email, '[VitrineZap] ' + subject, String(body).slice(0, 3000))
  } catch (err) {
    console.log('Falha ao enviar e-mail de log: ' + err)
  }
}

function safeLog(obj) {
  try {
    console.log(JSON.stringify(obj))
  } catch (err) {
    console.log('Erro ao gerar log: ' + err)
  }
}

/* ---------------- Parse defensivo ---------------- */

function parseQueryString(qs) {
  var out = {}
  if (!qs) return out
  qs.split('&').forEach(function (pair) {
    var i = pair.indexOf('=')
    if (i < 0) return
    var key = decodeURIComponent(pair.slice(0, i))
    var val = decodeURIComponent(pair.slice(i + 1))
    out[key] = val
  })
  return out
}

function parseBody(e) {
  var raw = (e.postData && e.postData.contents) || ''
  var body = {}
  try {
    body = JSON.parse(raw)
  } catch (err) {
    // Se não for JSON, tenta como formulário (por garantia)
    body = parseQueryString(raw)
    body.__parsed_as = 'query'
  }
  body.__raw = String(raw).slice(0, 2000)
  return body
}

/* ---------------- UPLOAD ImgBB ---------------- */

function handleUpload(body) {
  var key = props().getProperty('IMGBB_API_KEY')
  if (!key) return { ok: false, error: 'IMGBB_API_KEY ausente' }

  var token = props().getProperty('UPLOAD_TOKEN')
  if (token && body.token !== token) return { ok: false, error: 'Não autorizado' }
  if (!body.image) return { ok: false, error: 'Imagem ausente' }

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
    return { ok: false, error: (parsed.error && parsed.error.message) || 'ImgBB recusou o upload' }
  }
  return { ok: true, url: url, thumb: parsed.data.thumb && parsed.data.thumb.url }
}

/* ---------------- CHECKOUT InfinitePay ---------------- */

function handleCheckout(body) {
  var handle = props().getProperty('INFINITEPAY_HANDLE')
  if (!handle) {
    return { ok: false, error: 'INFINITEPAY_HANDLE ausente no GAS' }
  }

  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }

  // Preço SEMPRE em centavos. R$ 9,90 = 990.
  var priceCents = Number(body.price_cents || body.amount_cents || 990)
  // order_nsu identifica o pedido no nosso sistema; prefixo com a loja
  // para o webhook saber quem ativar. Timestamp garante unicidade.
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

  var checkoutUrl =
    parsed.url ||
    parsed.checkout_url ||
    (parsed.data && (parsed.data.url || parsed.data.checkout_url))
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

/* ---------------- ATIVAÇÃO do plano ---------------- */

function restHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey
  }
}

function fetchStore(storeId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes no GAS')
  }
  var res = UrlFetchApp.fetch(
    url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId) + '&select=id,slug,plan,plan_expires_at,name',
    {
      method: 'get',
      headers: restHeaders(serviceKey),
      muteHttpExceptions: true
    }
  )
  var text = res.getContentText()
  if (res.getResponseCode() >= 300) {
    throw new Error('GET stores falhou (' + res.getResponseCode() + '): ' + text.slice(0, 300))
  }
  var rows = JSON.parse(text || '[]')
  return rows && rows.length ? rows[0] : null
}

function activatePlan(storeId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes no GAS')
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
      plan_expires_at: expires
    }),
    muteHttpExceptions: true
  })
  var code = res.getResponseCode()
  if (code >= 300) {
    var text = res.getContentText()
    throw new Error('PATCH stores falhou (' + code + '): ' + text.slice(0, 500))
  }
  return expires
}

function resolveStoreFromOrderNsu(orderNsu) {
  var s = String(orderNsu || '')
  if (s.indexOf(':') > 0) return s.split(':')[0]
  return s
}

/* ---------------- WEBHOOK de pagamento ---------------- */

function handleWebhook(body) {
  // Payload real da InfinitePay (sem evento/status no corpo):
  // { invoice_slug, amount, paid_amount, installments, capture_method,
  //   transaction_nsu, order_nsu, receipt_url, items }
  var orderNsu = String(body.order_nsu || '')
  var storeId = resolveStoreFromOrderNsu(orderNsu) || String(body.store_id || '')

  if (!storeId) {
    notify('Webhook sem loja identificada', JSON.stringify(body, null, 2))
    throw new Error('Loja não identificada no webhook')
  }

  // Ativa e confirma com uma nova leitura (se falhar, lança 500 -> InfinitePay reenvia)
  var expires = activatePlan(storeId)
  var row = fetchStore(storeId)
  if (!row || row.plan !== 'pro') {
    var dump = 'order_nsu=' + orderNsu + '\nstoreId=' + storeId + '\nrow=' + JSON.stringify(row)
    notify('ATENÇÃO: plano não confirmado como pro', dump)
    throw new Error('Plano não confirmado como pro')
  }

  notify(
    'Pagamento recebido - plano ativado',
    'Venda efetuada e paga!\n\n' +
      'Loja: ' + (row.name || row.slug || row.id) + '\n' +
      'Plano: Loja\n' +
      'Validade: ' + row.plan_expires_at + '\n' +
      'order_nsu: ' + orderNsu + '\n' +
      'transaction_nsu: ' + (body.transaction_nsu || '-') + '\n' +
      'capture_method: ' + (body.capture_method || '-') + '\n' +
      'amount: ' + (body.amount || '-') + '\n' +
      'receipt_url: ' + (body.receipt_url || '-')
  )

  return { success: true, message: null }
}

/* ---------------- ROTEADOR ---------------- */

function doPost(e) {
  var body = parseBody(e)
  var log = {
    at: new Date().toISOString(),
    action: 'desconhecida',
    keys: Object.keys(body).slice(0, 25)
  }
  try {
    var result
    if (body.action === 'checkout') {
      log.action = 'checkout'
      result = handleCheckout(body)
    } else if (body.action === 'upload' || body.image) {
      log.action = 'upload'
      result = handleUpload(body)
    } else {
      log.action = 'webhook'
      result = handleWebhook(body)
    }
    log.result = result
    safeLog(log)

    if (result && result.ok === false && log.action !== 'upload') {
      notify('Falha em ' + log.action, JSON.stringify(log, null, 2))
    }
    return jsonOut(result)
  } catch (err) {
    log.error = String((err && err.stack) || err)
    safeLog(log)
    notify('Erro em ' + log.action + ' - ' + String((err && err.message) || err), JSON.stringify(log, null, 2))
    // HTTP 500 (erro real no Apps Script) -> InfinitePay tenta reenviar o webhook
    throw err
  }
}

function doGet() {
  return jsonOut({
    ok: true,
    service: 'vitrinezap',
    routes: ['checkout', 'upload', 'webhook de pagamento']
  })
}
