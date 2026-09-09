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
 *   POST { action: "checkout", ... }         -> link de pagamento avulso (1x)
 *   POST { action: "subscribe", ... }        -> assinatura recorrente MP (cartão)
 *   POST { action: "cancel_subscription" }   -> cancela a assinatura MP da loja
 *   POST { image, ... }                      -> upload ImgBB
 *   POST evento de pagamento                 -> ativa/renova o plano no Supabase
 *
 * PROVEDOR DE PAGAMENTO (troque sem mexer no app):
 *   PAYMENT_PROVIDER = infinitepay  (padrão atual, InfinitePay)
 *   PAYMENT_PROVIDER = mp           (Mercado Pago, Checkout Pro)
 *
 * ASSINATURA RECORRENTE (provider mp):
 *   O front tokeniza o cartão com o CardPayment Brick e envia o card_token.
 *   Aqui criamos um preapproval (status "authorized") que cobra R$ 9,90/mês
 *   automaticamente. O plano é ativado na criação (cartão já validado pelo MP)
 *   e renovado +30d a cada cobrança recorrente (webhook de pagamento).
 *
 * Configuração (Project Settings > Script properties):
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE   service_role (fica SÓ aqui, nunca no front)
 *   IMGBB_API_KEY           chave ImgBB
 *   UPLOAD_TOKEN            token opcional de upload (igual ao VITE_UPLOAD_TOKEN)
 *
 *   PAYMENT_PROVIDER        infinitepay | mp
 *   INFINITEPAY_HANDLE      sua InfiniteTag (ex.: maiconvss, sem o $)  [provider infinitepay]
 *   MP_ACCESS_TOKEN         Access Token do Mercado Pago               [provider mp]
 *   MP_USE_SANDBOX          true para usar sandbox_init_point          [provider mp, opcional]
 *   MP_PUBLIC_KEY           chave pública do MP (vai no .env do front, NÃO aqui) — veja README
 *
 *   EMAIL_LOG               e-mail que recebe os logs (padrão: wolfsaasbr@gmail.com)
 *
 * Deploy: New deployment > Web app > Execute as: Me / Who has access: Anyone.
 * O webhook de pagamento aponta para a própria URL deste Web App (o GAS usa
 * ScriptApp.getService().getUrl() como notification/webhook_url).
 */

var PLAN_DAYS = 30
var PLAN_TITLE = 'Plano Loja VitrineZap (30 dias)'
var PLAN_MONTHLY_TITLE = 'VitrineZap Plano Loja (assinatura mensal)'
var DEFAULT_LOG_EMAIL = 'wolfsaasbr@gmail.com'

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function props() {
  return PropertiesService.getScriptProperties()
}

function provider() {
  return String(props().getProperty('PAYMENT_PROVIDER') || 'infinitepay').toLowerCase().trim()
}

function planExpiresAt() {
  return new Date(Date.now() + PLAN_DAYS * 86400000).toISOString()
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
    out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
  })
  return out
}

function parseBody(e) {
  var raw = (e.postData && e.postData.contents) || ''
  var body = {}
  try {
    body = JSON.parse(raw)
  } catch (err) {
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

function handleCheckoutInfinite(body) {
  var handle = props().getProperty('INFINITEPAY_HANDLE')
  if (!handle) {
    return { ok: false, error: 'INFINITEPAY_HANDLE ausente no GAS' }
  }

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
        description: PLAN_TITLE
      }
    ]
  }
  if (body.name || body.email) {
    payload.customer = {
      name: String(body.name || ''),
      email: String(body.email || '')
    }
  }

  var res = UrlFetchApp.fetch('https://api.checkout.infinitepay.io/links', {
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

/* ---------------- CHECKOUT Mercado Pago (Checkout Pro) ---------------- */

function handleCheckoutMp(body) {
  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) {
    return { ok: false, error: 'MP_ACCESS_TOKEN ausente no GAS' }
  }

  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }

  var priceCents = Number(body.price_cents || body.amount_cents || 990)
  var unitPrice = priceCents / 100 // MP usa reais (float), não centavos
  var orderNsu = storeId + ':' + Date.now()
  var redirect = body.redirect_url || ''
  var webhook = ScriptApp.getService().getUrl()

  var payload = {
    items: [
      {
        title: PLAN_TITLE,
        quantity: 1,
        unit_price: unitPrice,
        currency_id: 'BRL'
      }
    ],
    external_reference: orderNsu,
    notification_url: webhook,
    back_urls: {
      success: redirect,
      pending: redirect,
      failure: redirect
    },
    auto_return: 'approved',
    statement_descriptor: 'VITRINEZAP'
  }
  if (body.name || body.email) {
    payload.payer = {
      name: String(body.name || ''),
      email: String(body.email || ''),
      identification: {}
    }
  }

  var res = UrlFetchApp.fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  var sandbox = String(props().getProperty('MP_USE_SANDBOX') || '').toLowerCase() === 'true'
  var checkoutUrl = sandbox ? parsed.sandbox_init_point : (parsed.init_point || parsed.sandbox_init_point)
  if (res.getResponseCode() >= 300 || !checkoutUrl) {
    notify('Falha ao gerar checkout MP (loja ' + storeId + ')', text)
    return {
      ok: false,
      error: parsed.message || parsed.error || 'Mercado Pago recusou',
      status: res.getResponseCode()
    }
  }
  return { ok: true, url: checkoutUrl, order_nsu: orderNsu }
}

function handleCheckout(body) {
  if (provider() === 'mp') return handleCheckoutMp(body)
  return handleCheckoutInfinite(body)
}

/* ---------------- ASSINATURA Mercado Pago (recorrente, cartão) ---------------- */

function mpCreatePreapproval(token, payload) {
  var res = UrlFetchApp.fetch('https://api.mercadopago.com/preapproval', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  return { code: res.getResponseCode(), text: res.getContentText() }
}

function handleSubscribeMp(body) {
  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) {
    return { ok: false, error: 'MP_ACCESS_TOKEN ausente no GAS' }
  }

  var storeId = String(body.store_id || '')
  var cardToken = String(body.card_token || '')
  var email = String(body.email || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  if (!cardToken) return { ok: false, error: 'card_token ausente (tokenize o cartão no front)' }
  if (!email) return { ok: false, error: 'e-mail do assinante ausente' }

  var priceCents = Number(body.price_cents || body.amount_cents || 990)
  var unitPrice = priceCents / 100 // MP usa reais (float)
  var external = 'sub:' + storeId + ':' + Date.now()
  var webhook = ScriptApp.getService().getUrl()

  var payload = {
    reason: PLAN_MONTHLY_TITLE,
    external_reference: external,
    payer_email: email,
    card_token_id: cardToken,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: unitPrice,
      currency_id: 'BRL'
    },
    back_url: body.redirect_url || '',
    notification_url: webhook,
    status: 'authorized'
  }

  // Alguns parâmetros (ex.: notification_url) podem ser rejeitados conforme a conta.
  // Se der 4xx, tenta UMA vez sem esse campo antes de devolver o erro.
  var res = mpCreatePreapproval(token, payload)
  if (res.code >= 300 && res.code < 500 && payload.notification_url) {
    var fallback = JSON.parse(JSON.stringify(payload))
    delete fallback.notification_url
    res = mpCreatePreapproval(token, fallback)
  }
  var text = res.text
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  if (res.code >= 300 || !parsed.id) {
    notify('Falha ao criar assinatura MP (loja ' + storeId + ')', text)
    return {
      ok: false,
      error: parsed.message || parsed.error || 'Mercado Pago recusou a assinatura',
      status: res.code
    }
  }

  // MP só autoriza com cartão válido: libera o plano já na criação.
  // As cobranças seguintes renovam +30d via webhook de pagamento.
  patchStore(storeId, {
    plan: 'pro',
    plan_expires_at: planExpiresAt(),
    mp_subscription_id: String(parsed.id),
    mp_subscription_status: 'authorized'
  })
  var row = fetchStore(storeId)
  if (!row || row.plan !== 'pro') {
    notify('ATENÇÃO: assinatura criada mas plano não confirmado como pro', 'sub=' + parsed.id + '\nstoreId=' + storeId)
    throw new Error('Plano não confirmado como pro')
  }
  notify(
    'Assinatura criada - plano ativado',
    'Loja: ' + (row.name || row.slug || row.id) + '\n' +
      'Subscription MP: ' + parsed.id + '\n' +
      'Status: ' + parsed.status + '\n' +
      'Valor: R$ ' + unitPrice.toFixed(2) + '/mês\n' +
      'Validade: ' + row.plan_expires_at
  )
  return { ok: true, subscription_id: parsed.id, status: parsed.status || 'authorized' }
}

function handleCancelSubscriptionMp(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var row = fetchStore(storeId)
  if (!row) return { ok: false, error: 'Loja não encontrada' }

  var subId = String(row.mp_subscription_id || '')
  if (!subId) {
    return { ok: false, error: 'Esta loja não possui assinatura registrada (mp_subscription_id vazio)' }
  }

  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) return { ok: false, error: 'MP_ACCESS_TOKEN ausente no GAS' }

  var res = UrlFetchApp.fetch('https://api.mercadopago.com/preapproval/' + encodeURIComponent(subId), {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ status: 'canceled' }),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  if (res.getResponseCode() >= 300) {
    notify('Falha ao cancelar assinatura (loja ' + storeId + ', sub ' + subId + ')', text)
    return {
      ok: false,
      error: parsed.message || parsed.error || 'Mercado Pago recusou o cancelamento',
      status: res.getResponseCode()
    }
  }

  // O plano NÃO é revogado na hora: o cliente mantém acesso até a validade paga.
  patchStore(storeId, { mp_subscription_status: 'canceled' })
  notify('Assinatura cancelada', 'Loja: ' + (row.name || row.slug || row.id) + '\nSubscription MP: ' + subId)
  return { ok: true, subscription_id: subId }
}

function handleSubscribe(body) {
  if (provider() !== 'mp') {
    return { ok: false, error: 'Assinatura recorrente exige PAYMENT_PROVIDER=mp no GAS' }
  }
  return handleSubscribeMp(body)
}

function handleCancelSubscription(body) {
  if (provider() !== 'mp') {
    return { ok: false, error: 'Cancelamento de assinatura exige PAYMENT_PROVIDER=mp no GAS' }
  }
  return handleCancelSubscriptionMp(body)
}

/* ---------------- ATIVAÇÃO do plano ---------------- */

function fetchStore(storeId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes no GAS')
  }
  var res = UrlFetchApp.fetch(
    url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId) + '&select=id,slug,plan,plan_expires_at,name,mp_subscription_id,mp_subscription_status',
    {
      method: 'get',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
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

function patchStore(storeId, fields) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes no GAS')
  }
  var res = UrlFetchApp.fetch(url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId), {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify(fields),
    muteHttpExceptions: true
  })
  if (res.getResponseCode() >= 300) {
    throw new Error('PATCH stores falhou (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 500))
  }
}

function activatePlan(storeId) {
  patchStore(storeId, {
    plan: 'pro',
    plan_expires_at: planExpiresAt()
  })
}

function resolveStoreFromOrderNsu(orderNsu) {
  var s = String(orderNsu || '')
  if (s.indexOf('sub:') === 0) s = s.slice(4) // assinatura MP: sub:<store>:<ts>
  var i = s.indexOf(':')
  if (i > 0) return s.slice(0, i)
  return s
}

function confirmPlan(storeId, orderNsu, body, capture, amount, receipt) {
  activatePlan(storeId)
  var row = fetchStore(storeId)
  if (!row || row.plan !== 'pro') {
    notify('ATENÇÃO: plano não confirmado como pro', 'order_nsu=' + orderNsu + '\nstoreId=' + storeId + '\nrow=' + JSON.stringify(row))
    throw new Error('Plano não confirmado como pro')
  }
  notify(
    'Pagamento recebido - plano ativado',
    'Venda efetuada e paga!\n\n' +
      'Loja: ' + (row.name || row.slug || row.id) + '\n' +
      'Plano: Loja\n' +
      'Validade: ' + row.plan_expires_at + '\n' +
      'order_nsu: ' + orderNsu + '\n' +
      'transaction: ' + String(body.transaction_nsu || body.payment_id || body.id || '-') + '\n' +
      'capture_method: ' + capture + '\n' +
      'amount: ' + amount + '\n' +
      'receipt: ' + (receipt || '-')
  )
}

/* ---------------- WEBHOOK InfinitePay ---------------- */

function handleInfiniteWebhook(body) {
  var orderNsu = String(body.order_nsu || '')
  var storeId = resolveStoreFromOrderNsu(orderNsu) || String(body.store_id || '')
  if (!storeId) {
    notify('Webhook sem loja identificada', JSON.stringify(body, null, 2))
    throw new Error('Loja não identificada no webhook')
  }
  confirmPlan(storeId, orderNsu, body, body.capture_method || '-', body.amount || '-', body.receipt_url)
  return { success: true, message: null }
}

/* ---------------- WEBHOOK Mercado Pago ---------------- */

var MP_SUB_TOPICS = ['preapproval', 'subscription_preapproval', 'subscription_authorized_payment', 'subscription_preapproval_plan', 'merchant_order']

function isMpWebhook(e, body) {
  var type = String(body.type || (e.parameter && e.parameter.topic) || '')
  if (type === 'payment' || MP_SUB_TOPICS.indexOf(type) !== -1) return true
  if (body.data && body.data.id) return true
  return false
}

function mpProcessed(id) {
  var KEY = 'MP_PROCESSED'
  var list = []
  try {
    list = JSON.parse(props().getProperty(KEY) || '[]')
  } catch (err) { list = [] }
  if (list.indexOf(id) !== -1) return true
  list.push(id)
  if (list.length > 80) list = list.slice(-80)
  props().setProperty(KEY, JSON.stringify(list))
  return false
}

function mpFetch(path) {
  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) throw new Error('MP_ACCESS_TOKEN ausente no GAS')
  var res = UrlFetchApp.fetch('https://api.mercadopago.com' + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  if (res.getResponseCode() >= 300) {
    throw new Error('GET ' + path + ' falhou (' + res.getResponseCode() + '): ' + text.slice(0, 300))
  }
  return JSON.parse(text || '{}')
}

function fetchMpPayment(paymentId) {
  return mpFetch('/v1/payments/' + encodeURIComponent(paymentId))
}

function fetchMpPreapproval(subId) {
  return mpFetch('/preapproval/' + encodeURIComponent(subId))
}

function fetchMpAuthorizedPayment(authId) {
  return mpFetch('/authorized_payments/' + encodeURIComponent(authId))
}

// Cobrança pontual aprovada (1x ou mensalidade da assinatura): ativa/renova +30d.
function handleMpApprovedPayment(paymentId, payment) {
  if (mpProcessed('pay:' + paymentId)) {
    return { success: true, message: null, already: true }
  }
  var orderNsu = String(payment.external_reference || '')
  var storeId = resolveStoreFromOrderNsu(orderNsu)
  if (!storeId) {
    notify('Webhook MP aprovado sem loja', JSON.stringify(payment, null, 2))
    throw new Error('Loja não identificada no pagamento aprovado')
  }
  var amount = (payment.transaction_amount || payment.transaction_details && payment.transaction_details.total_paid_amount)
  var capture = payment.payment_method_id || payment.payment_type_id || '-'
  var receipt = (payment.transaction_details && payment.transaction_details.external_resource_url) || ''
  confirmPlan(storeId, orderNsu, { payment_id: paymentId }, capture, amount, receipt)
  return { success: true, message: null }
}

function handleMpPaymentWebhook(paymentId) {
  var payment = fetchMpPayment(paymentId)
  var status = String(payment.status || '')
  if (status !== 'approved') {
    // Pagamento ainda não aprovado (created/pending/rejected): ack silencioso.
    return { success: true, message: null, status: status }
  }
  return handleMpApprovedPayment(paymentId, payment)
}

// Evento de assinatura (criada, cancelada, pausada). Não mexe no plano por aqui:
// a liberação acontece na criação (authorized) e nas cobranças aprovadas.
function handleMpPreapprovalWebhook(subId) {
  if (!subId) {
    notify('Webhook MP preapproval sem id', '')
    throw new Error('Webhook preapproval sem id')
  }
  var pre = fetchMpPreapproval(subId)
  var status = String(pre.status || '')
  var ext = String(pre.external_reference || '')
  var storeId = resolveStoreFromOrderNsu(ext)
  if (!storeId) {
    notify('Webhook MP preapproval sem loja', JSON.stringify(pre, null, 2))
    throw new Error('Loja não identificada no preapproval')
  }
  if (mpProcessed('sub:' + subId)) {
    return { success: true, message: null, already: true }
  }
  if (status === 'canceled' || status === 'paused') {
    patchStore(storeId, { mp_subscription_status: status })
    return { success: true, message: null, status: status }
  }
  if (status === 'authorized') {
    // Garante o vínculo loja <-> assinatura caso a criação não tenha persistido.
    var row = fetchStore(storeId)
    if (row && (!row.mp_subscription_id || !row.mp_subscription_status)) {
      patchStore(storeId, { mp_subscription_id: subId, mp_subscription_status: 'authorized' })
    }
  }
  return { success: true, message: null, status: status }
}

// Mensalidade recorrente paga: renova o plano por mais 30 dias.
function handleMpAuthorizedPaymentWebhook(authId) {
  if (!authId) {
    notify('Webhook MP authorized_payment sem id', '')
    throw new Error('Webhook authorized_payment sem id')
  }
  var auth = fetchMpAuthorizedPayment(authId)
  var ext = String(auth.external_reference || '')
  var storeId = resolveStoreFromOrderNsu(ext)
  if (!storeId && auth.preapproval_id) {
    try {
      var pre = fetchMpPreapproval(auth.preapproval_id)
      storeId = resolveStoreFromOrderNsu(String(pre.external_reference || ''))
    } catch (err) { /* preapproval não encontrado */ }
  }
  if (!storeId) {
    notify('Webhook MP authorized_payment sem loja', JSON.stringify(auth, null, 2))
    throw new Error('Loja não identificada no authorized_payment')
  }
  var amount = auth.transaction_amount || auth.amount || '-'
  handleMpApprovedPayment('ap:' + authId, {
    external_reference: ext || (storeId + ':' + authId),
    status: 'approved',
    transaction_amount: amount,
    payment_method_id: auth.payment_method_id || '-'
  })
  return { success: true, message: null }
}

function handleMpWebhook(e, body) {
  var type = String(body.type || (e.parameter && e.parameter.topic) || 'payment')
  var dataId = String((body.data && body.data.id) || (e.parameter && e.parameter.id) || '')

  if (type === 'preapproval' || type === 'subscription_preapproval') {
    return handleMpPreapprovalWebhook(dataId)
  }
  if (type === 'subscription_authorized_payment') {
    return handleMpAuthorizedPaymentWebhook(dataId)
  }
  if (type === 'merchant_order' || type === 'subscription_preapproval_plan') {
    // Acompanham o fluxo; o pagamento em si chega como outro evento. Ack silencioso.
    return { success: true, message: null, ignored: type }
  }
  // type === 'payment' (ou tópico via query string)
  return handleMpPaymentWebhook(dataId)
}

/* ---------------- ROTEADOR ---------------- */

function doPost(e) {
  var body = parseBody(e)
  var log = {
    at: new Date().toISOString(),
    action: 'desconhecida',
    provider: provider(),
    keys: Object.keys(body).slice(0, 25)
  }
  try {
    var result
    if (body.action === 'checkout') {
      log.action = 'checkout'
      result = handleCheckout(body)
    } else if (body.action === 'subscribe') {
      log.action = 'subscribe'
      result = handleSubscribe(body)
    } else if (body.action === 'cancel_subscription') {
      log.action = 'cancel_subscription'
      result = handleCancelSubscription(body)
    } else if (body.action === 'upload' || body.image) {
      log.action = 'upload'
      result = handleUpload(body)
    } else if (isMpWebhook(e, body)) {
      log.action = 'webhook_mp'
      result = handleMpWebhook(e, body)
    } else {
      log.action = 'webhook_infinitepay'
      result = handleInfiniteWebhook(body)
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
    // HTTP 500 (erro real no Apps Script) -> provedor tenta reenviar o webhook
    throw err
  }
}

function doGet() {
  return jsonOut({
    ok: true,
    service: 'vitrinezap',
    provider: provider(),
    routes: ['checkout', 'subscribe', 'cancel_subscription', 'upload', 'webhook de pagamento']
  })
}
