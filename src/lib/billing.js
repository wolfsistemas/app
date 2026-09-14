import { PLAN_DURATION_DAYS, PLAN_PRICE, PLAN_PRICE_CENTS } from './format'
import { api, apiUrl } from './api'

// Mantido por compatibilidade com o painel (antes apontava para o GAS).
export const billingUrl = apiUrl

let mpAvailablePromise = null
// Consulta a API (GET) para saber se o provedor é o Mercado Pago, pois a
// assinatura recorrente (hospedada com plano) só existe com provider=mp.
export function mpBillingAvailable() {
  if (!apiUrl) return Promise.resolve(false)
  if (!mpAvailablePromise) {
    mpAvailablePromise = fetch(apiUrl)
      .then((res) => res.json().catch(() => ({})))
      .then((d) => d && String(d.provider || '').toLowerCase() === 'mp')
      .catch(() => false)
  }
  return mpAvailablePromise
}

// Cria o checkout avulso (1x). O valor é fixado no servidor (R$ 9,90/30 dias).
export async function createCheckout({ storeId, email, name }) {
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  const data = await api('checkout', {
    store_id: storeId,
    email: email || '',
    name: name || '',
    redirect_url: redirectUrl
  })
  if (!data.url) throw new Error(data.message || 'Não foi possível gerar o link de pagamento.')
  return data.url
}

// Assinatura mensal recorrente (Mercado Pago, modelo HOSPEDADO com plano).
export async function createSubscription({ storeId }) {
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  const data = await api('subscribe', { store_id: storeId, redirect_url: redirectUrl })
  if (!data.url) throw new Error(data.message || 'Não foi possível gerar o link de assinatura.')
  return data.url
}

// Cancela a assinatura recorrente. O plano segue válido até a data já paga.
export async function cancelSubscription({ storeId }) {
  return api('cancel_subscription', { store_id: storeId })
}

// Rede de segurança: ao voltar do checkout MP (?plano=ok), busca a assinatura
// autorizada no MP e ativa a loja — sem depender do webhook.
export async function syncSubscription({ storeId }) {
  return api('sync_subscription', { store_id: storeId })
}

export const INFINITEPAY_DEFAULTS = {
  priceCents: PLAN_PRICE_CENTS,
  priceLabel: PLAN_PRICE,
  durationDays: PLAN_DURATION_DAYS
}
