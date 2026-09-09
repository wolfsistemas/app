import { PLAN_DURATION_DAYS, PLAN_PRICE, PLAN_PRICE_CENTS } from './format'

export const billingUrl = import.meta.env.VITE_BILLING_URL || ''

let mpAvailablePromise = null
// Consulta o doGet do GAS (GET) para saber se o provedor é o Mercado Pago,
// pois a assinatura recorrente (hospedada com plano) só existe com provider=mp.
export function mpBillingAvailable() {
  if (!billingUrl) return Promise.resolve(false)
  if (!mpAvailablePromise) {
    mpAvailablePromise = fetch(billingUrl)
      .then((res) => res.json().catch(() => ({})))
      .then((d) => d && String(d.provider || '').toLowerCase() === 'mp')
      .catch(() => false)
  }
  return mpAvailablePromise
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

// Cria o checkout avulso (1x) no servidor (GAS/Edge). O valor é fixado lá (R$ 9,90/30 dias).
export async function createCheckout({ storeId, email, name }) {
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  const data = await postBilling({
    action: 'checkout',
    store_id: storeId,
    email: email || '',
    name: name || '',
    redirect_url: redirectUrl
  })
  if (!data.url) throw new Error(data.message || 'Não foi possível gerar o link de pagamento.')
  return data.url
}

// Assinatura mensal recorrente (Mercado Pago, modelo HOSPEDADO com plano).
// O GAS cria/pega o "preapproval_plan" da loja e devolve a url do init_point —
// a 1ª cobrança acontece na página do Mercado Pago (sem tokenizar cartão aqui).
export async function createSubscription({ storeId }) {
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  const data = await postBilling({
    action: 'subscribe',
    store_id: storeId,
    redirect_url: redirectUrl
  })
  if (!data.url) throw new Error(data.message || 'Não foi possível gerar o link de assinatura.')
  return data.url
}

// Cancela a assinatura recorrente. O plano segue válido até a data já paga.
export async function cancelSubscription({ storeId }) {
  return postBilling({
    action: 'cancel_subscription',
    store_id: storeId
  })
}

export const INFINITEPAY_DEFAULTS = {
  priceCents: PLAN_PRICE_CENTS,
  priceLabel: PLAN_PRICE,
  durationDays: PLAN_DURATION_DAYS
}
