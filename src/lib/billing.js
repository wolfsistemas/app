import { PLAN_DURATION_DAYS, PLAN_PRICE, PLAN_PRICE_CENTS } from './format'

export const billingUrl = import.meta.env.VITE_BILLING_URL || ''

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    throw new Error(data.message || data.error || 'Falha ao gerar o link de pagamento.')
  }
  return data
}

// Cria o checkout no servidor (GAS/Edge). O valor é fixado lá (R$ 9,90/30 dias).
export async function createCheckout({ storeId, email, name }) {
  if (!billingUrl) throw new Error('Pagamento ainda não configurado neste ambiente.')
  const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}painel?plano=ok`
  const data = await postJson(billingUrl, {
    action: 'checkout',
    store_id: storeId,
    email: email || '',
    name: name || '',
    redirect_url: redirectUrl
  })
  return data.url
}

export const INFINITEPAY_DEFAULTS = {
  priceCents: PLAN_PRICE_CENTS,
  priceLabel: PLAN_PRICE,
  durationDays: PLAN_DURATION_DAYS
}
