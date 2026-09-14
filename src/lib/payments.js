import { isSupabase, supabase } from './supabase'
import { api } from './api'

async function authToken() {
  if (!isSupabase) return ''
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

// Passo 1 do OAuth: devolve a URL de autorização do Mercado Pago.
export async function connectMp({ storeId, redirectUrl }) {
  const access_token = await authToken()
  const data = await api('mp_connect', { store_id: storeId, redirect_url: redirectUrl || '', access_token })
  if (!data.url) throw new Error(data.message || data.error || 'Não foi possível gerar o link do Mercado Pago.')
  return data.url
}

export async function mpStatus({ storeId }) {
  const access_token = await authToken()
  return api('mp_status', { store_id: storeId, access_token })
}

export async function disconnectMp({ storeId }) {
  const access_token = await authToken()
  return api('mp_disconnect', { store_id: storeId, access_token })
}

// Cria o Pix do pedido na conta do vendedor (dinheiro não passa pelo VitrineZap).
// renew=true gera um QR novo após o vencimento. Requer o public_token do pedido.
export async function createPix({ storeId, orderId, publicToken, payerEmail, renew }) {
  return api('create_pix', {
    store_id: storeId,
    order_id: orderId,
    public_token: publicToken || '',
    payer_email: payerEmail || '',
    renew: Boolean(renew)
  })
}

// Estorna um pedido pago (reembolso sai do saldo do vendedor).
export async function refundPayment({ storeId, orderId }) {
  const access_token = await authToken()
  return api('refund_payment', { store_id: storeId, order_id: orderId, access_token })
}

// Avisa o cliente por e-mail com o link do pedido (envia só uma vez).
export async function notifyOrder({ storeId, orderId, publicToken }) {
  return api('order_notify', { store_id: storeId, order_id: orderId, public_token: publicToken || '' })
}

// Dispara uma notificação push de teste para os aparelhos da loja.
export async function testPush({ storeId }) {
  const access_token = await authToken()
  return api('push_test', { store_id: storeId, access_token })
}

// Exclui a conta e toda a loja (LGPD). As fotos são removidas antes pelo cliente.
export async function deleteAccount({ storeId }) {
  const access_token = await authToken()
  return api('delete_account', { store_id: storeId, access_token })
}

// Lê o pedido pelo token público (RPC anônima, sem expor a tabela orders).
export async function getOrderPublic(token) {
  if (!isSupabase || !token) return null
  const { data, error } = await supabase.rpc('get_order_public', { p_token: token })
  if (error) throw error
  return data && data.length ? data[0] : null
}
