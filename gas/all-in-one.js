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
 *   POST { action: "subscribe", ... }        -> assinatura mensal MP HOSPEDADA (plano + init_point)
 *   POST { action: "cancel_subscription" }   -> cancela a assinatura MP da loja
 *   POST { image, ... }                      -> upload ImgBB
 *   POST evento de pagamento                 -> ativa/renova o plano no Supabase
 *
 * PROVEDOR DE PAGAMENTO (troque sem mexer no app):
 *   PAYMENT_PROVIDER = infinitepay  (padrão atual, InfinitePay)
 *   PAYMENT_PROVIDER = mp           (Mercado Pago, Checkout Pro)
 *
 * ASSINATURA RECORRENTE MP — MODELO HOSPEDADO COM PLANO (sandbox-friendly):
 *   O front NÃO tokeniza cartão. Aqui criamos um "preapproval_plan" por loja
 *   (POST /preapproval_plan, SEM card_token_id e SEM payer_email) e devolvemos
 *   o init_point: a 1ª cobrança acontece na PÁGINA DO MERCADO PAGO. No sandbox o
 *   comprador entra como usuário de teste e paga com cartão de teste — sem gastar
 *   e sem o erro "Both payer and collector must be real or test users", que era o
 *   que travava o modelo anterior (preapproval server-side com card_token).
 *
 *   O vínculo loja <-> assinatura usa o mp_plan_id (gravado na loja): quando o MP
 *   cria a assinatura, o webhook traz o preapproval_plan_id e o GAS localiza a
 *   loja por mp_plan_id. A ativação do plano acontece quando a 1ª cobrança é
 *   aprovada (webhook payment/subscription_authorized_payment/subscription_preapproval
 *   com status authorized).
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
 *   MP_USE_SANDBOX          true -> usa sandbox_init_point / página de teste  [provider mp, opcional]
 *
 *   A1 (Pix na conta do vendedor via OAuth) [provider mp]:
 *   MP_CLIENT_ID            Client ID da aplicacao MP (Checkout Transparente > API Pagamentos)
 *   MP_CLIENT_SECRET        Client Secret do app (SO aqui, nunca no front)
 *   MP_REDIRECT_URI         Mesma URL de redirecionamento cadastrada no app do MP
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

/* ---------------- ASSINATURA Mercado Pago (HOSPEDADA, com plano) ----------------
 * Modelo escolhido para destravar o sandbox: criamos um "preapproval_plan" por
 * loja (POST /preapproval_plan, SEM card_token_id e SEM payer_email) e devolvemos
 * o init_point. A 1ª cobrança acontece na página do Mercado Pago; no sandbox o
 * comprador entra com usuário de teste e paga com cartão de teste (sem gastar e
 * sem o erro "Both payer and collector must be real or test users").
 * O vínculo loja<->assinatura é via mp_plan_id gravado na loja: nos webhooks o MP
 * manda o preapproval_plan_id da assinatura e localizamos a loja por mp_plan_id.
 * A ATIVAÇÃO do plano ocorre quando a 1ª cobrança é aprovada (webhook).
 */

function mpCreatePlan(token, payload) {
  var res = UrlFetchApp.fetch('https://api.mercadopago.com/preapproval_plan', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  return { code: res.getResponseCode(), text: res.getContentText() }
}

// URL pública da página de assinatura (a 1ª cobrança acontece lá, no MP).
function mpPlanCheckoutUrl(plan) {
  var sandbox = String(props().getProperty('MP_USE_SANDBOX') || '').toLowerCase() === 'true'
  if (sandbox) return plan.sandbox_init_point || plan.init_point || ''
  return plan.init_point || plan.sandbox_init_point || ''
}

// Garante o plano da loja (reusa o ativo; senão cria um e grava mp_plan_id).
function ensureMpPlan(storeId, redirectUrl) {
  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) return { error: 'MP_ACCESS_TOKEN ausente no GAS' }

  var row = fetchStore(storeId)
  if (!row) return { error: 'Loja não encontrada' }

  if (row.mp_plan_id) {
    try {
      var existing = mpFetch('/preapproval_plan/' + encodeURIComponent(row.mp_plan_id))
      if (existing && String(existing.status || '') === 'active') {
        var url = mpPlanCheckoutUrl(existing)
        if (url) return { plan_id: String(existing.id), url: url }
      }
    } catch (err) { /* plano antigo inválido -> cria outro */ }
  }

  var priceCents = Number(props().getProperty('PLAN_PRICE_CENTS') || 990)
  var unitPrice = priceCents / 100 // MP usa reais (float)
  var webhook = ScriptApp.getService().getUrl()

  var payload = {
    reason: PLAN_MONTHLY_TITLE,
    external_reference: 'plan:' + storeId,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: unitPrice,
      currency_id: 'BRL'
    },
    back_url: redirectUrl || '',
    notification_url: webhook
  }

  var res = mpCreatePlan(token, payload)
  var text = res.text
  // notification_url pode ser rejeitado em algumas contas: tenta sem ele nesse caso.
  if (
    res.code >= 300 && res.code < 500 &&
    payload.notification_url &&
    /notification[_\s]?url/i.test(text)
  ) {
    notify('MP recusou notification_url; plano sera criado SEM webhook', text.slice(0, 600))
    var fallback = JSON.parse(JSON.stringify(payload))
    delete fallback.notification_url
    res = mpCreatePlan(token, fallback)
    text = res.text
  }
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { /* resposta não-JSON */ }

  if (res.code >= 300 || !parsed.id) {
    var errMsg = parsed.message || parsed.error || 'Mercado Pago recusou o plano'
    notify('Falha ao criar plano MP (loja ' + storeId + ')', text)
    return { error: errMsg, status: res.code }
  }
  var checkoutUrl = mpPlanCheckoutUrl(parsed)
  if (!checkoutUrl) {
    notify('Plano MP criado sem init_point (loja ' + storeId + ')', text)
    return { error: 'Mercado Pago não devolveu o link de assinatura', status: res.code }
  }
  patchStore(storeId, { mp_plan_id: String(parsed.id) })
  return { plan_id: String(parsed.id), url: checkoutUrl }
}

function handleSubscribeMp(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var redirectUrl = String(body.redirect_url || '')
  var plan = ensureMpPlan(storeId, redirectUrl)
  if (plan.error) return { ok: false, error: plan.error, status: plan.status }
  return { ok: true, url: plan.url, plan_id: plan.plan_id }
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

// Rede de segurança: após o usuário voltar do checkout MP (?plano=ok), o front
// chama este action para ativar a loja SEM depender do webhook. O GAS busca na
// API do MP a assinatura autorizada vinculada ao mp_plan_id da loja.
function handleSyncSubscription(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var token = props().getProperty('MP_ACCESS_TOKEN')
  if (!token) return { ok: false, error: 'MP_ACCESS_TOKEN ausente no GAS' }

  var row = fetchStore(storeId)
  if (!row) return { ok: false, error: 'Loja não encontrada' }
  if (row.plan === 'pro') return { ok: true, status: 'already-active', plan_expires_at: row.plan_expires_at }

  var planId = String(row.mp_plan_id || '')
  if (!planId) return { ok: false, error: 'mp_plan_id vazio (assine primeiro)' }

  // Busca assinaturas do plano: authorized => 1ª cobrança paga, pode liberar.
  var res = UrlFetchApp.fetch(
    'https://api.mercadopago.com/preapproval/search?preapproval_plan_id=' +
      encodeURIComponent(planId) + '&status=authorized&limit=1',
    {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    }
  )
  var text = res.getContentText()
  if (res.getResponseCode() >= 300) {
    notify('Sync assinatura falhou (loja ' + storeId + ')', text.slice(0, 600))
    return { ok: false, error: 'Mercado Pago recusou a consulta', status: res.getResponseCode() }
  }
  var data = JSON.parse(text || '{}')
  var results = data.results || []
  var found = results.length ? results[0] : null
  if (!found) {
    return { ok: false, status: 'no-subscription', error: 'Nenhuma assinatura autorizada encontrada no MP' }
  }

  var subId = String(found.id)
  patchStore(storeId, {
    mp_subscription_id: subId,
    mp_subscription_status: 'authorized'
  })
  activatePlan(storeId)
  var row2 = fetchStore(storeId)
  notify(
    'Assinatura ativada (sync) - plano liberado',
    'Loja: ' + (row2 && (row2.name || row2.slug || row2.id)) + '\n' +
      'Subscription MP: ' + subId + '\n' +
      'Validade: ' + (row2 && row2.plan_expires_at)
  )
  return { ok: true, status: 'activated', subscription_id: subId, plan_expires_at: row2 && row2.plan_expires_at }
}

function handleCancelSubscription(body) {
  if (provider() !== 'mp') {
    return { ok: false, error: 'Cancelamento de assinatura exige PAYMENT_PROVIDER=mp no GAS' }
  }
  return handleCancelSubscriptionMp(body)
}

/* ---------------- A1: Pix na conta do vendedor (OAuth) ----------------
 * O lojista autoriza o app no Mercado Pago (OAuth). O GAS troca o code pelo
 * access_token DA CONTA DELE e guarda em store_payments (tabela privada, so o
 * service_role le). O Pix do pedido e criado com esse token: o dinheiro cai
 * direto na conta do vendedor, sem custodia. Confirmacao chega pelo webhook.
 */

// Helpers de acesso REST ao Supabase (service_role).
function sbBase() {
  var url = props().getProperty('SUPABASE_URL')
  var key = props().getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !key) throw new Error('SUPABASE_URL/SERVICE_ROLE ausentes no GAS')
  return { url: url, key: key }
}

function sbFetch(path, options) {
  var cfg = sbBase()
  var opts = options || {}
  var headers = {
    apikey: cfg.key,
    Authorization: 'Bearer ' + cfg.key,
    'Content-Type': 'application/json'
  }
  if (opts.prefer) headers.Prefer = opts.prefer
  var fetchOpts = {
    method: opts.method || 'get',
    headers: headers,
    muteHttpExceptions: true
  }
  if (opts.payload) fetchOpts.payload = JSON.stringify(opts.payload)
  var res = UrlFetchApp.fetch(cfg.url + '/rest/v1' + path, fetchOpts)
  var text = res.getContentText()
  if (res.getResponseCode() >= 300) {
    throw new Error('Supabase ' + (opts.method || 'get') + ' ' + path + ' falhou (' + res.getResponseCode() + '): ' + text.slice(0, 300))
  }
  try {
    return JSON.parse(text || 'null')
  } catch (err) {
    return null
  }
}

function fetchStoreOwner(storeId) {
  var rows = sbFetch('/stores?id=eq.' + encodeURIComponent(storeId) + '&select=id,owner_id,name&limit=1')
  return rows && rows.length ? rows[0] : null
}

function fetchOwnerEmail(ownerId) {
  if (!ownerId) return ''
  try {
    var cfg = sbBase()
    var res = UrlFetchApp.fetch(cfg.url + '/auth/v1/admin/users/' + encodeURIComponent(ownerId), {
      method: 'get',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
      muteHttpExceptions: true
    })
    if (res.getResponseCode() >= 300) return ''
    var u = JSON.parse(res.getContentText() || '{}')
    return String(u.email || '')
  } catch (err) {
    return ''
  }
}

// URL base do site (para montar links nos e-mails).
function appUrl() {
  return String(props().getProperty('APP_URL') || '').trim().replace(/\/+$/, '')
}

function orderPublicLink(order) {
  var base = appUrl()
  if (!base || !order || !order.public_token) return ''
  return base + '/pedido/' + order.public_token
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim())
}

function formatBrl(value) {
  return 'R$ ' + Number(value || 0).toFixed(2).replace('.', ',')
}

function pushConfigured() {
  return Boolean(
    String(props().getProperty('PUSH_FUNCTION_URL') || '').trim() &&
      String(props().getProperty('PUSH_SECRET') || '').trim()
  )
}

// Envia uma notificacao push (PWA) para os aparelhos da loja via Edge Function.
function sendPush(storeId, title, body, url) {
  var fnUrl = String(props().getProperty('PUSH_FUNCTION_URL') || '').trim()
  var secret = String(props().getProperty('PUSH_SECRET') || '').trim()
  if (!fnUrl || !secret) return { ok: false, error: 'push nao configurado' }
  try {
    var res = UrlFetchApp.fetch(fnUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-push-secret': secret },
      payload: JSON.stringify({
        action: 'send',
        store_id: storeId,
        title: title,
        body: body,
        url: url || ''
      }),
      muteHttpExceptions: true
    })
    if (res.getResponseCode() >= 300) {
      notify('Falha ao enviar push (loja ' + storeId + ')', res.getContentText().slice(0, 400))
      var detail = ''
      try { detail = JSON.parse(res.getContentText()).detail || JSON.parse(res.getContentText()).error || '' } catch (e) {}
      return { ok: false, error: 'push http ' + res.getResponseCode() + (detail ? ': ' + detail : '') }
    }
    return { ok: true }
  } catch (err) {
    notify('Erro ao enviar push', String(err))
    return { ok: false, error: String(err) }
  }
}

// Avisa o cliente com o link do pedido (uma vez). Evita spam: so envia para o
// e-mail gravado no proprio pedido e marca customer_notified_at.
function sendCustomerOrderEmail(order, storeName) {
  var to = String(order.customer_email || '').trim()
  if (!isEmail(to)) return false
  if (order.customer_notified_at) return false
  var code = order.code ? '#' + order.code : order.id
  var link = orderPublicLink(order)
  var lines = [
    'Ola' + (order.customer_name ? ' ' + order.customer_name : '') + '!',
    '',
    'Seu pedido ' + code + (storeName ? ' na ' + storeName : '') + ' foi registrado.',
    'Total: ' + formatBrl(order.total),
    ''
  ]
  if (order.payment_status === 'pending' && order.payment_method === 'pix') {
    lines.push('Falta concluir o pagamento por Pix.')
    lines.push('Abra o pedido pelo link e pague na hora:')
  } else {
    lines.push('Acompanhe o andamento do pedido pelo link:')
  }
  if (link) {
    lines.push(link)
  } else {
    lines.push('(Peca o link do pedido para a loja.)')
  }
  lines.push('')
  lines.push('Qualquer duvida, fale com a loja pelo WhatsApp.')
  var body = lines.join('\n')
  try {
    MailApp.sendEmail(to, '[VitrineZap] Pedido ' + code + (storeName ? ' - ' + storeName : ''), body)
  } catch (err) {
    notify('Falha ao enviar e-mail do pedido ao cliente', String(err) + '\n' + body)
    return false
  }
  try {
    sbFetch('/orders?id=eq.' + encodeURIComponent(order.id), {
      method: 'patch',
      prefer: 'return=minimal',
      payload: { customer_notified_at: new Date().toISOString() }
    })
  } catch (err) { /* nao critico */ }
  return true
}

// Aviso publico do pedido (apos criar). So envia ao e-mail ja gravado no pedido.
function handleOrderNotify(body) {
  var storeId = String(body.store_id || '')
  var orderId = String(body.order_id || '')
  if (!storeId || !orderId) return { ok: false, error: 'store_id/order_id ausentes' }
  var orders = sbFetch('/orders?id=eq.' + encodeURIComponent(orderId) + '&select=*&limit=1')
  var order = orders && orders.length ? orders[0] : null
  if (!order) return { ok: false, error: 'Pedido nao encontrado' }
  if (String(order.store_id) !== storeId) return { ok: false, error: 'Pedido nao pertence a loja' }
  var store = fetchStoreOwner(storeId)
  return { ok: true, sent: sendCustomerOrderEmail(order, store && store.name) }
}

// Dispara um push de teste (so o dono da loja). Usado pelo botao "Enviar teste".
function handlePushTest(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var check = assertStoreOwner(storeId, body.access_token)
  if (!check.ok) return check
  if (!pushConfigured()) return { ok: false, error: 'Push nao configurado no servidor' }
  var base = appUrl()
  return sendPush(storeId, 'VitrineZap', 'Teste de alerta. Se voce recebeu, esta funcionando!', base ? base + '/painel' : '')
}

// Valida que o JWT do usuario logado e o dono da loja (evita sequestrar a loja).
function assertStoreOwner(storeId, jwt) {
  var row = fetchStoreOwner(storeId)
  if (!row) return { ok: false, error: 'Loja nao encontrada' }
  if (!jwt) return { ok: false, error: 'Sessao ausente' }
  var cfg = sbBase()
  var res = UrlFetchApp.fetch(cfg.url + '/auth/v1/user', {
    method: 'get',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + jwt },
    muteHttpExceptions: true
  })
  if (res.getResponseCode() >= 300) return { ok: false, error: 'Sessao invalida' }
  var user = {}
  try {
    user = JSON.parse(res.getContentText() || '{}')
  } catch (err) { user = {} }
  if (String(user.id || '') !== String(row.owner_id || '')) {
    return { ok: false, error: 'Nao autorizado' }
  }
  return { ok: true, row: row }
}

function fetchStorePayment(storeId) {
  var rows = sbFetch('/store_payments?store_id=eq.' + encodeURIComponent(storeId) + '&select=*&limit=1')
  return rows && rows.length ? rows[0] : null
}

// Loja cujo vendedor tem o user_id do MP (vem no webhook como body.user_id).
function findStoreByMpUser(userId) {
  if (!userId) return null
  var rows = sbFetch('/store_payments?mp_user_id=eq.' + encodeURIComponent(String(userId)) + '&select=store_id,mp_access_token&limit=1')
  return rows && rows.length ? rows[0] : null
}

function upsertStorePayment(storeId, fields) {
  var payload = {}
  for (var k in fields) payload[k] = fields[k]
  payload.store_id = storeId
  payload.updated_at = new Date().toISOString()
  sbFetch('/store_payments?on_conflict=store_id', {
    method: 'post',
    prefer: 'resolution=merge-duplicates,return=minimal',
    payload: payload
  })
}

function mpRedirectUri() {
  return String(props().getProperty('MP_REDIRECT_URI') || ScriptApp.getService().getUrl())
}

// Passo 1 do OAuth: devolve a URL de autorizacao do MP. O state carrega a loja
// e a URL de retorno do painel (para voltarmos ao front apos autorizar).
function handleMpConnect(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var check = assertStoreOwner(storeId, body.access_token)
  if (!check.ok) return check
  var clientId = props().getProperty('MP_CLIENT_ID')
  if (!clientId) return { ok: false, error: 'MP_CLIENT_ID ausente no GAS' }
  var state = storeId + '|' + String(body.redirect_url || '')
  var url =
    'https://auth.mercadopago.com.br/authorization' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&response_type=code' +
    '&platform_id=mp' +
    '&state=' + encodeURIComponent(state) +
    '&redirect_uri=' + encodeURIComponent(mpRedirectUri())
  return { ok: true, url: url }
}

function mpRedirectHtml(url) {
  var safe = String(url || '').replace(/"/g, '&quot;')
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0;url=' + safe + '">' +
      '</head><body>Redirecionando...</body></html>'
  )
}

// Passo 2: o MP volta com ?code&state; trocamos por token e gravamos.
function handleMpCallback(e) {
  var p = (e && e.parameter) || {}
  var code = String(p.code || '')
  var state = String(p.state || '')
  var parts = state.split('|')
  var storeId = parts[0] || ''
  var front = (parts[1] || '').replace(/\/$/, '')
  var backOk = front ? front + '/painel?mp=connected' : ''
  var backErr = front ? front + '/painel?mp=error' : ''
  if (!code || !storeId) return mpRedirectHtml(backErr)

  try {
    var clientId = props().getProperty('MP_CLIENT_ID')
    var clientSecret = props().getProperty('MP_CLIENT_SECRET')
    if (!clientId || !clientSecret) throw new Error('MP_CLIENT_ID/MP_CLIENT_SECRET ausentes no GAS')
    var res = UrlFetchApp.fetch('https://api.mercadopago.com/oauth/token', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: mpRedirectUri()
      }),
      muteHttpExceptions: true
    })
    var text = res.getContentText()
    var parsed = {}
    try {
      parsed = JSON.parse(text)
    } catch (err) { parsed = {} }
    if (res.getResponseCode() >= 300 || !parsed.access_token) {
      notify('Falha no OAuth MP (loja ' + storeId + ')', text.slice(0, 800))
      return mpRedirectHtml(backErr)
    }
    var expiresAt = parsed.expires_in
      ? new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString()
      : null
    upsertStorePayment(storeId, {
      provider: 'mp',
      mp_user_id: String(parsed.user_id || ''),
      mp_access_token: String(parsed.access_token),
      mp_refresh_token: String(parsed.refresh_token || ''),
      mp_public_key: String(parsed.public_key || ''),
      mp_token_expires_at: expiresAt,
      connected_at: new Date().toISOString()
    })
    patchStore(storeId, { mp_connected: true })
    notify('Mercado Pago conectado', 'Loja ' + storeId + ' conectou a conta MP (user ' + parsed.user_id + ').')
    return mpRedirectHtml(backOk)
  } catch (err) {
    notify('Erro no OAuth MP (loja ' + storeId + ')', String((err && err.stack) || err))
    return mpRedirectHtml(backErr)
  }
}

function handleMpStatus(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var check = assertStoreOwner(storeId, body.access_token)
  if (!check.ok) return check
  var row = fetchStorePayment(storeId)
  var connected = !!(row && row.mp_access_token)
  return { ok: true, connected: connected, mp_user_id: row ? String(row.mp_user_id || '') : '' }
}

function handleMpDisconnect(body) {
  var storeId = String(body.store_id || '')
  if (!storeId) return { ok: false, error: 'store_id ausente' }
  var check = assertStoreOwner(storeId, body.access_token)
  if (!check.ok) return check
  // Limpa os tokens sem apagar a linha.
  upsertStorePayment(storeId, {
    mp_access_token: null,
    mp_refresh_token: null,
    mp_user_id: null,
    mp_token_expires_at: null
  })
  patchStore(storeId, { mp_connected: false })
  return { ok: true }
}

function mpRefreshSellerToken(row) {
  var clientId = props().getProperty('MP_CLIENT_ID')
  var clientSecret = props().getProperty('MP_CLIENT_SECRET')
  if (!clientId || !clientSecret || !row.mp_refresh_token) return null
  var res = UrlFetchApp.fetch('https://api.mercadopago.com/oauth/token', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.mp_refresh_token
    }),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { parsed = {} }
  if (res.getResponseCode() >= 300 || !parsed.access_token) {
    notify('Falha ao renovar token MP (loja ' + row.store_id + ')', text.slice(0, 500))
    return null
  }
  var expiresAt = parsed.expires_in
    ? new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString()
    : null
  upsertStorePayment(row.store_id, {
    mp_access_token: parsed.access_token,
    mp_refresh_token: parsed.refresh_token || row.mp_refresh_token,
    mp_token_expires_at: expiresAt
  })
  return parsed.access_token
}

// Token valido do vendedor (renova se estiver perto de expirar).
function mpSellerToken(storeId) {
  var row = fetchStorePayment(storeId)
  if (!row || !row.mp_access_token) return null
  if (row.mp_token_expires_at) {
    var exp = new Date(row.mp_token_expires_at).getTime()
    if (exp && exp - Date.now() < 3600000) {
      var refreshed = mpRefreshSellerToken(row)
      if (refreshed) return refreshed
    }
  }
  return row.mp_access_token
}

function orderTotal(order) {
  var items = order.items || []
  var sum = 0
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {}
    sum += Number(it.price || 0) * Number(it.qty || 1)
  }
  if (sum > 0) return sum
  return Number(order.total || 0)
}

// Cria o Pix do pedido com o token do vendedor (dinheiro vai direto pra ele).
function handleCreatePix(body) {
  var storeId = String(body.store_id || '')
  var orderId = String(body.order_id || '')
  if (!storeId || !orderId) return { ok: false, error: 'store_id/order_id ausentes' }

  var orders = sbFetch('/orders?id=eq.' + encodeURIComponent(orderId) + '&select=*&limit=1')
  var order = orders && orders.length ? orders[0] : null
  if (!order) return { ok: false, error: 'Pedido nao encontrado' }
  if (String(order.store_id) !== storeId) return { ok: false, error: 'Pedido nao pertence a loja' }
  if (String(order.payment_status || '') === 'paid') {
    return { ok: true, already: true, payment_status: 'paid' }
  }

  var token = mpSellerToken(storeId)
  if (!token) return { ok: false, error: 'Loja sem Mercado Pago conectado' }

  var amount = orderTotal(order)
  if (!(amount > 0)) return { ok: false, error: 'Pedido sem valor' }

  var store = fetchStoreOwner(storeId)
  var payload = {
    transaction_amount: Number(amount.toFixed(2)),
    description: 'Pedido ' + (order.code ? '#' + order.code + ' ' : '') + (store && store.name ? '- ' + store.name : ''),
    payment_method_id: 'pix',
    external_reference: 'order:' + orderId,
    notification_url: ScriptApp.getService().getUrl(),
    payer: {
      email: String(body.payer_email || 'comprador@vitrinezap.com.br'),
      first_name: String(order.customer_name || 'Cliente').slice(0, 60)
    }
  }

  // Chave de idempotencia: estavel para o mesmo Pix, nova a cada renovacao
  // (renew) para permitir gerar um QR novo apos o vencimento.
  var keySuffix = body.renew
    ? 'renew-' + (order.mp_payment_id || 'x')
    : (order.mp_payment_id || 'first')

  var res = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      // Obrigatorio na API de Pagamentos; evita cobranca dupla.
      'X-Idempotency-Key': 'vitrinezap-order-' + orderId + '-' + keySuffix
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  var text = res.getContentText()
  var parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch (err) { parsed = {} }
  if (res.getResponseCode() >= 300 || !parsed.id) {
    notify('Falha ao criar Pix (pedido ' + orderId + ')', text.slice(0, 800))
    return {
      ok: false,
      error: parsed.message || parsed.error || 'Mercado Pago recusou o Pix',
      status: res.getResponseCode()
    }
  }

  var td = parsed.point_of_interaction && parsed.point_of_interaction.transaction_data
  var qr = (td && td.qr_code) || ''
  var qrBase64 = (td && td.qr_code_base64) || ''
  var expiresAt = parsed.date_of_expiration || null
  if (expiresAt) {
    try {
      expiresAt = new Date(expiresAt).toISOString()
    } catch (err) { expiresAt = null }
  }

  sbFetch('/orders?id=eq.' + encodeURIComponent(orderId), {
    method: 'patch',
    prefer: 'return=minimal',
    payload: {
      payment_status: 'pending',
      payment_method: 'pix',
      payment_code: qr,
      payment_qr: qrBase64,
      payment_expires_at: expiresAt,
      mp_payment_id: String(parsed.id)
    }
  })

  // Avisa o cliente com o link (uma vez), ja com o Pix pronto.
  order.payment_status = 'pending'
  order.payment_method = 'pix'
  sendCustomerOrderEmail(order, store && store.name)

  return {
    ok: true,
    payment_id: String(parsed.id),
    code: qr,
    qr_base64: qrBase64,
    ticket_url: (td && td.ticket_url) || '',
    expires_at: expiresAt
  }
}

// Reembolsa um pedido pago na conta do vendedor (estorno sai do saldo dele).
function handleRefundOrder(body) {
  var storeId = String(body.store_id || '')
  var orderId = String(body.order_id || '')
  if (!storeId || !orderId) return { ok: false, error: 'store_id/order_id ausentes' }
  var check = assertStoreOwner(storeId, body.access_token)
  if (!check.ok) return check

  var orders = sbFetch('/orders?id=eq.' + encodeURIComponent(orderId) + '&select=*&limit=1')
  var order = orders && orders.length ? orders[0] : null
  if (!order) return { ok: false, error: 'Pedido nao encontrado' }
  if (String(order.store_id) !== storeId) return { ok: false, error: 'Pedido nao pertence a loja' }
  if (String(order.payment_status || '') === 'refunded') {
    return { ok: true, already: true, payment_status: 'refunded' }
  }
  if (String(order.payment_status || '') !== 'paid' || !order.mp_payment_id) {
    return { ok: false, error: 'Pedido nao esta pago' }
  }

  var token = mpSellerToken(storeId)
  if (!token) return { ok: false, error: 'Loja sem Mercado Pago conectado' }

  var res = UrlFetchApp.fetch(
    'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(order.mp_payment_id) + '/refunds',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Idempotency-Key': 'vitrinezap-refund-' + orderId
      },
      payload: JSON.stringify({}),
      muteHttpExceptions: true
    }
  )
  var text = res.getContentText()
  var parsed = {}
  try { parsed = JSON.parse(text) } catch (err) { parsed = {} }
  if (res.getResponseCode() >= 300 || !parsed.id) {
    notify('Falha ao estornar pedido ' + orderId, text.slice(0, 800))
    return {
      ok: false,
      error: parsed.message || parsed.error || 'Mercado Pago recusou o estorno',
      status: res.getResponseCode()
    }
  }

  sbFetch('/orders?id=eq.' + encodeURIComponent(orderId), {
    method: 'patch',
    prefer: 'return=minimal',
    payload: { payment_status: 'refunded', status: 'cancelado' }
  })
  notify(
    'Pedido ' + orderId + ' estornado',
    'Pedido ' + (order.code ? '#' + order.code : orderId) + ' · refund ' + parsed.id
  )
  return { ok: true, refund_id: String(parsed.id) }
}

var MP_ORDER_STATUS = {
  approved: 'paid',
  pending: 'pending',
  in_process: 'pending',
  authorized: 'pending',
  rejected: 'failed',
  cancelled: 'failed',
  refunded: 'refunded',
  charged_back: 'refunded'
}

function updateOrderPayment(orderId, payment) {
  var st = MP_ORDER_STATUS[String(payment.status || '')] || 'pending'
  var fields = { payment_status: st }
  if (st === 'paid') fields.paid_at = new Date().toISOString()
  sbFetch('/orders?id=eq.' + encodeURIComponent(orderId), {
    method: 'patch',
    prefer: 'return=minimal',
    payload: fields
  })
}

function notifyOrderPaid(order, payment) {
  var amount = Number(payment.transaction_amount || order.total || 0)
  var store = fetchStoreOwner(order.store_id)
  var storeName = store && store.name ? store.name : order.store_id
  var link = orderPublicLink(order)
  var phone = String(order.customer_phone || '').replace(/\D/g, '')
  var lines = [
    'Pedido ' + (order.code ? '#' + order.code : order.id) + ' PAGO',
    '',
    'Valor: ' + formatBrl(amount),
    'Cliente: ' + (order.customer_name || '-'),
    'Fone: ' + (order.customer_phone || '-'),
    'Loja: ' + storeName
  ]
  if (phone) lines.push('WhatsApp do cliente: https://wa.me/' + phone)
  if (link) {
    lines.push('')
    lines.push('Abra o pedido: ' + link)
  }
  var body = lines.join('\n')
  sendPush(
    order.store_id,
    'Pedido ' + (order.code ? '#' + order.code : '') + ' pago',
    formatBrl(amount) + ' - ' + (order.customer_name || 'Cliente'),
    link
  )
  var to = fetchOwnerEmail(store && store.owner_id)
  if (!to) {
    notify('Pedido pago (sem e-mail do lojista)', body)
    return
  }
  try {
    MailApp.sendEmail(to, '[VitrineZap] Pedido ' + (order.code ? '#' + order.code + ' ' : '') + 'pago - ' + formatBrl(amount), body)
  } catch (err) {
    notify('Falha ao avisar lojista de pedido pago', String(err) + '\n' + body)
  }
}

// Pedido pago: marca como pago + avisa o lojista. Idempotente.
function handleMpOrderPayment(paymentId, payment) {
  if (mpIsProcessed('order-pay:' + paymentId)) {
    return { success: true, message: null, already: true }
  }
  var orderId = String(payment.external_reference || '').slice(6)
  if (!orderId) return { success: true, message: null, status: 'no-order' }
  var orders = sbFetch('/orders?id=eq.' + encodeURIComponent(orderId) + '&select=*&limit=1')
  var order = orders && orders.length ? orders[0] : null
  if (!order) {
    notify('Webhook MP pago sem pedido', 'payment=' + paymentId + ' order=' + orderId)
    return { success: true, message: null, status: 'no-order' }
  }
  updateOrderPayment(orderId, payment)
  notifyOrderPaid(order, payment)
  mpMarkProcessed('order-pay:' + paymentId)
  return { success: true, message: null }
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
    url + '/rest/v1/stores?id=eq.' + encodeURIComponent(storeId) + '&select=id,slug,plan,plan_expires_at,name,mp_subscription_id,mp_subscription_status,mp_plan_id',
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

// Localiza a loja que tem mp_plan_id = <planId>. Usada nos webhooks do modelo
// hospedado: a assinatura criada pelo MP traz o preapproval_plan_id e achamos a
// loja por essa coluna. Retorna o id da loja ou '' se não achar.
function findStoreIdByPlanId(planId) {
  var p = props()
  var url = p.getProperty('SUPABASE_URL')
  var serviceKey = p.getProperty('SUPABASE_SERVICE_ROLE')
  if (!url || !serviceKey || !planId) return ''
  var res = UrlFetchApp.fetch(
    url + '/rest/v1/stores?mp_plan_id=eq.' + encodeURIComponent(planId) + '&select=id&limit=1',
    {
      method: 'get',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      muteHttpExceptions: true
    }
  )
  if (res.getResponseCode() >= 300) return ''
  var rows = JSON.parse(res.getContentText() || '[]')
  return rows && rows.length ? String(rows[0].id) : ''
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

// Checa se o evento já foi processado com sucesso (dedupe). Ler não marca: só
// mpMarkProcessed grava. Assim, se a ativação falhar (ex.: Supabase fora) o
// evento NÃO fica marcado e o retry do MP reprocessa em vez de engolir.
function mpIsProcessed(id) {
  var list = []
  try {
    list = JSON.parse(props().getProperty('MP_PROCESSED') || '[]')
  } catch (err) { list = [] }
  return list.indexOf(id) !== -1
}

function mpMarkProcessed(id) {
  var KEY = 'MP_PROCESSED'
  var list = []
  try {
    list = JSON.parse(props().getProperty(KEY) || '[]')
  } catch (err) { list = [] }
  if (list.indexOf(id) === -1) list.push(id)
  if (list.length > 80) list = list.slice(-80)
  props().setProperty(KEY, JSON.stringify(list))
}

function mpFetch(path, token) {
  token = token || props().getProperty('MP_ACCESS_TOKEN')
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

function fetchMpPayment(paymentId, token) {
  return mpFetch('/v1/payments/' + encodeURIComponent(paymentId), token)
}

function fetchMpPreapproval(subId) {
  return mpFetch('/preapproval/' + encodeURIComponent(subId))
}

function fetchMpAuthorizedPayment(authId) {
  return mpFetch('/authorized_payments/' + encodeURIComponent(authId))
}

// Recurso notificado nao existe (404) — evento de simulacao do painel do MP ou
// objeto apagado/antigo. Nao e pagamento real nosso: ack 200 silencioso (sem
// e-mail de erro e sem retry em loop). Retorna true quando deve ser ignorado.
function isNotFound(err) {
  var msg = String((err && err.message) || err)
  return /404/.test(msg) || /not found/i.test(msg)
}

// Resolve a loja de um evento MP. Ordem: external_reference (avulso/1x e
// assinatura: gravamos 'plan:' + <store UUID> no plano e o MP ecoa esse valor
// nas cobranças da assinatura) -> preapproval_plan_id -> preapproval.
function resolveStoreForMp(ext, planId, preapprovalId) {
  var extStr = String(ext || '')
  var storeId = ''
  if (extStr.indexOf('plan:') === 0) {
    storeId = extStr.slice(5)
  } else {
    storeId = resolveStoreFromOrderNsu(extStr)
  }
  if (storeId) return storeId
  if (planId) storeId = findStoreIdByPlanId(String(planId))
  if (!storeId && preapprovalId) {
    try {
      var pre = fetchMpPreapproval(String(preapprovalId))
      if (pre && pre.preapproval_plan_id) storeId = findStoreIdByPlanId(String(pre.preapproval_plan_id))
    } catch (err) { /* preapproval não encontrado */ }
  }
  return storeId
}

// Cobrança pontual aprovada (1x ou mensalidade da assinatura): ativa/renova +30d.
function handleMpApprovedPayment(paymentId, payment) {
  if (mpIsProcessed('pay:' + paymentId)) {
    return { success: true, message: null, already: true }
  }
  var orderNsu = String(payment.external_reference || '')
  var storeId = resolveStoreForMp(orderNsu, payment.preapproval_plan_id, payment.preapproval_id)
  if (!storeId) {
    // Sem external_reference nem vínculo de plano: provável 1ª cobrança de assinatura
    // que ainda não teve a subscription criada/linkada. Não damos 500 (evita retry em
    // loop); registramos no log — a ativação chega pelo subscription_preapproval.
    notify('Webhook MP aprovado sem loja (aguardando vínculo?)', JSON.stringify(payment, null, 2))
    return { success: true, message: null, status: 'no-store' }
  }
  var amount = (payment.transaction_amount || payment.transaction_details && payment.transaction_details.total_paid_amount)
  var capture = payment.payment_method_id || payment.payment_type_id || '-'
  var receipt = (payment.transaction_details && payment.transaction_details.external_resource_url) || ''
  confirmPlan(storeId, orderNsu, { payment_id: paymentId }, capture, amount, receipt)
  mpMarkProcessed('pay:' + paymentId)
  return { success: true, message: null }
}

function handleMpPaymentWebhook(paymentId, userId) {
  // Pagamento do vendedor: o webhook traz body.user_id; localizamos a loja por
  // ele e usamos o token do vendedor para ler o pagamento. Sem isso (nosso
  // proprio pagamento/assinatura), cai no token master.
  var seller = findStoreByMpUser(userId)
  var token = seller && seller.mp_access_token ? seller.mp_access_token : null
  var payment
  try {
    payment = fetchMpPayment(paymentId, token)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  var status = String(payment.status || '')
  var ext = String(payment.external_reference || '')
  var isOrder = ext.indexOf('order:') === 0
  if (status !== 'approved') {
    // Pedido ainda não aprovado (pending/rejected/refunded): espelha o status.
    if (isOrder) {
      try {
        updateOrderPayment(ext.slice(6), payment)
      } catch (err) {
        notify('Falha ao atualizar status do pedido', String(err))
      }
    }
    return { success: true, message: null, status: status }
  }
  if (isOrder) return handleMpOrderPayment(paymentId, payment)
  return handleMpApprovedPayment(paymentId, payment)
}

// Evento de assinatura (criada, paga, cancelada, pausada). No modelo hospedado o
// MP cria a assinatura (preapproval) SÓ depois da 1ª cobrança aprovada na página
// dele. Por isso, aqui com status "authorized" liberamos o plano +30d e gravamos
// o vínculo loja <-> subscription; renewals seguintes chegam como
// subscription_authorized_payment e renovam +30d.
function handleMpPreapprovalWebhook(subId) {
  if (!subId) {
    notify('Webhook MP preapproval sem id', '')
    throw new Error('Webhook preapproval sem id')
  }
  var pre
  try {
    pre = fetchMpPreapproval(subId)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  var status = String(pre.status || '')
  var storeId = resolveStoreForMp(String(pre.external_reference || ''), pre.preapproval_plan_id, subId)
  if (!storeId) {
    notify('Webhook MP preapproval sem loja', JSON.stringify(pre, null, 2))
    throw new Error('Loja não identificada no preapproval')
  }
  if (status === 'canceled' || status === 'paused') {
    patchStore(storeId, { mp_subscription_status: status })
    return { success: true, message: null, status: status }
  }
  if (status === 'authorized') {
    if (mpIsProcessed('sub:' + subId)) {
      return { success: true, message: null, already: true }
    }
    // 1ª cobrança paga: ativa o plano e guarda o vínculo loja <-> subscription.
    patchStore(storeId, { mp_subscription_id: subId, mp_subscription_status: 'authorized' })
    activatePlan(storeId)
    var row = fetchStore(storeId)
    if (!row || row.plan !== 'pro') {
      notify('ATENÇÃO: assinatura ativada mas plano não confirmado como pro', 'sub=' + subId + '\nstoreId=' + storeId)
      throw new Error('Plano não confirmado como pro')
    }
    notify(
      'Assinatura ativada - plano liberado',
      'Loja: ' + (row.name || row.slug || row.id) + '\n' +
        'Subscription MP: ' + subId + '\n' +
        'Status: ' + status + '\n' +
        'Validade: ' + row.plan_expires_at
    )
    mpMarkProcessed('sub:' + subId)
  }
  return { success: true, message: null, status: status }
}

// Mensalidade recorrente paga: renova o plano por mais 30 dias.
function handleMpAuthorizedPaymentWebhook(authId) {
  if (!authId) {
    notify('Webhook MP authorized_payment sem id', '')
    throw new Error('Webhook authorized_payment sem id')
  }
  var auth
  try {
    auth = fetchMpAuthorizedPayment(authId)
  } catch (err) {
    if (isNotFound(err)) return { success: true, message: null, status: 'not-found' }
    throw err
  }
  var ext = String(auth.external_reference || '')
  var storeId = resolveStoreForMp(ext, auth.preapproval_plan_id, auth.preapproval_id)
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
  var userId = String(body.user_id || (e.parameter && e.parameter.user_id) || '')

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
  return handleMpPaymentWebhook(dataId, userId)
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
    } else if (body.action === 'sync_subscription') {
      log.action = 'sync_subscription'
      result = handleSyncSubscription(body)
    } else if (body.action === 'mp_connect') {
      log.action = 'mp_connect'
      result = handleMpConnect(body)
    } else if (body.action === 'mp_status') {
      log.action = 'mp_status'
      result = handleMpStatus(body)
    } else if (body.action === 'mp_disconnect') {
      log.action = 'mp_disconnect'
      result = handleMpDisconnect(body)
    } else if (body.action === 'create_pix') {
      log.action = 'create_pix'
      result = handleCreatePix(body)
    } else if (body.action === 'refund_payment') {
      log.action = 'refund_payment'
      result = handleRefundOrder(body)
    } else if (body.action === 'order_notify') {
      log.action = 'order_notify'
      result = handleOrderNotify(body)
    } else if (body.action === 'push_test') {
      log.action = 'push_test'
      result = handlePushTest(body)
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

    if (result && result.ok === false && log.action !== 'upload' && log.action !== 'mp_status') {
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

function doGet(e) {
  var params = (e && e.parameter) || {}
  // Callback do OAuth: o Mercado Pago volta com ?code&state.
  if (params.code || params.state) {
    return handleMpCallback(e)
  }
  return jsonOut({
    ok: true,
    service: 'vitrinezap',
    provider: provider(),
    routes: [
      'checkout',
      'subscribe',
      'cancel_subscription',
      'sync_subscription',
      'mp_connect',
      'mp_status',
      'mp_disconnect',
      'create_pix',
      'upload',
      'webhook de pagamento'
    ]
  })
}
