import { isSupabase, supabase } from './supabase'
import { billingUrl } from './billing'

async function authToken() {
  if (!isSupabase) return ''
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

async function postBilling(payload) {
  if (!billingUrl) throw new Error('Pagamento ainda não configurado neste ambiente.')
  const res = await fetch(billingUrl, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || 'Falha na comunicação com o servidor de pagamento.')
  }
  return data
}

// Passo 1 do OAuth: devolve a URL de autorização do Mercado Pago.
export async function connectMp({ storeId, redirectUrl }) {
  const access_token = await authToken()
  const data = await postBilling({
    action: 'mp_connect',
    store_id: storeId,
    redirect_url: redirectUrl || '',
    access_token
  })
  if (!data.url) throw new Error(data.message || data.error || 'Não foi possível gerar o link do Mercado Pago.')
  return data.url
}

export async function mpStatus({ storeId }) {
  const access_token = await authToken()
  return postBilling({ action: 'mp_status', store_id: storeId, access_token })
}

export async function disconnectMp({ storeId }) {
  const access_token = await authToken()
  return postBilling({ action: 'mp_disconnect', store_id: storeId, access_token })
}

// Cria o Pix do pedido na conta do vendedor (dinheiro não passa pelo VitrineZap).
// renew=true gera um QR novo após o vencimento.
export async function createPix({ storeId, orderId, payerEmail, renew }) {
  return postBilling({
    action: 'create_pix',
    store_id: storeId,
    order_id: orderId,
    payer_email: payerEmail || '',
    renew: Boolean(renew)
  })
}

// Estorna um pedido pago (reembolso sai do saldo do vendedor).
export async function refundPayment({ storeId, orderId }) {
  const access_token = await authToken()
  return postBilling({
    action: 'refund_payment',
    store_id: storeId,
    order_id: orderId,
    access_token
  })
}

// Avisa o cliente por e-mail com o link do pedido (envia só uma vez).
export async function notifyOrder({ storeId, orderId }) {
  return postBilling({
    action: 'order_notify',
    store_id: storeId,
    order_id: orderId
  })
}

// Lê o pedido pelo token público (RPC anônima, sem expor a tabela orders).
export async function getOrderPublic(token) {
  if (!isSupabase || !token) return null
  const { data, error } = await supabase.rpc('get_order_public', { p_token: token })
  if (error) throw error
  return data && data.length ? data[0] : null
}
