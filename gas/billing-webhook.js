/**
 * Google Apps Script opcional.
 * Use só se o webhook de pagamento não for uma Edge Function do Supabase.
 *
 * 1. Cole este arquivo num projeto GAS.
 * 2. Deploy como Web App (executa como você, acesso: qualquer um).
 * 3. No Mercado Pago / Stripe, aponte o webhook para a URL do GAS.
 * 4. O GAS chama o Supabase REST e marca a loja como plan = pro.
 *
 * Propriedades do script:
 * SUPABASE_URL
 * SUPABASE_SERVICE_ROLE
 */

function doPost(e) {
  const props = PropertiesService.getScriptProperties()
  const supabaseUrl = props.getProperty('SUPABASE_URL')
  const serviceKey = props.getProperty('SUPABASE_SERVICE_ROLE')
  const body = JSON.parse(e.postData.contents || '{}')
  const storeId = body.data && (body.data.store_id || body.data.external_reference)

  if (!storeId) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false })).setMimeType(ContentService.MimeType.JSON)
  }

  UrlFetchApp.fetch(supabaseUrl + '/rest/v1/stores?id=eq.' + storeId, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({ plan: 'pro' }),
    muteHttpExceptions: true
  })

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}
