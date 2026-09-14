import { onlyDigits } from './format'

// Espelho local de calc_delivery_fee() (o servidor recalcula e é a fonte da verdade).
export function calcDeliveryFee(store, cep, subtotal) {
  const sub = Number(subtotal || 0)
  if (store && store.delivery_enabled === false) {
    return { fee: 0, zone: 'Entrega desativada', covered: true, freeDelivery: false }
  }
  const freeAbove = Number(store?.free_delivery_above || 0)
  if (freeAbove > 0 && sub >= freeAbove) {
    return { fee: 0, zone: 'Frete grátis', covered: true, freeDelivery: true }
  }
  const zones = Array.isArray(store?.delivery_zones) ? store.delivery_zones : []
  if (!zones.length) {
    // Sem zonas configuradas: frete combinado no WhatsApp.
    return { fee: 0, zone: '', covered: true, freeDelivery: false }
  }
  const digits = onlyDigits(cep)
  const cepNum = digits.length === 8 ? Number(digits) : null
  if (cepNum != null) {
    for (const z of zones) {
      const startDigits = onlyDigits(z.cep_start)
      const endDigits = onlyDigits(z.cep_end)
      const start = startDigits ? Number(startDigits) : null
      const end = endDigits ? Number(endDigits) : null
      if ((start == null || cepNum >= start) && (end == null || cepNum <= end)) {
        const fee = Number(z.fee || 0)
        return { fee, zone: z.name || '', covered: true, freeDelivery: fee === 0 }
      }
    }
  }
  return { fee: 0, zone: '', covered: false, freeDelivery: false }
}

// Consulta o CEP no ViaCEP para autopreencher o endereço.
export async function lookupCep(cep) {
  const digits = onlyDigits(cep)
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.erro) return null
    return {
      cep: digits,
      street: data.logradouro || '',
      district: data.bairro || '',
      city: data.localidade || '',
      state: data.uf || ''
    }
  } catch {
    return null
  }
}

export function emptyAddress() {
  return { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' }
}

export function formatAddress(address) {
  if (!address) return ''
  const cep = onlyDigits(address.cep)
  const line1 = [address.street, address.number].filter(Boolean).join(', ')
  const line2 = [address.complement, address.district].filter(Boolean).join(' - ')
  const line3 = [address.city, address.state].filter(Boolean).join('/')
  const cepLabel = cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ''
  return [line1, line2, line3, cepLabel].filter(Boolean).join(' · ')
}
