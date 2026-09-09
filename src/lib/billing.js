import { PLAN_DURATION_DAYS, PLAN_PRICE, PLAN_PRICE_CENTS } from './format'

export const billingUrl = import.meta.env.VITE_BILLING_URL || ''
// Chave PÚBLICA do Mercado Pago (segura para ficar no front). Quando presente,
// o painel oferece assinatura recorrente via CardPayment Brick + preapproval.
export const mpPublicKey = import.meta.env.VITE_MP_PUBLIC_KEY || ''

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

// Assinatura recorrente (Mercado Pago). O cartão já foi tokenizado no front
// (CardPayment Brick) e chega aqui como cardToken. O GAS cria o preapproval
// (status authorized) e ativa o plano.
export async function createSubscription({ storeId, email, name, cardToken }) {
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  return postBilling({
    action: 'subscribe',
    store_id: storeId,
    email: email || '',
    name: name || '',
    card_token: cardToken,
    redirect_url: redirectUrl
  })
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
