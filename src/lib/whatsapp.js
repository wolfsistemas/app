import { money, toWhatsAppNumber } from './format'
import { formatAddress } from './delivery'

export function buildOrderMessage({
  store,
  items,
  customerName,
  customerPhone,
  note,
  pixKey,
  code,
  deliveryType,
  deliveryFee,
  deliveryZone,
  address
}) {
  const lines = items.map((item) => {
    const qty = item.qty || 1
    return `${qty}x ${item.name} — ${money(item.price * qty)}`
  })
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * (item.qty || 1), 0)
  const fee = Number(deliveryFee || 0)
  const total = subtotal + fee
  const isPickup = deliveryType === 'retirada'
  const addressLine = formatAddress(address)

  return [
    `*Pedido ${store.name}${code ? ` · nº ${String(code).padStart(3, '0')}` : ''}*`,
    '',
    ...lines,
    '',
    `Subtotal: ${money(subtotal)}`,
    isPickup ? 'Entrega: retirada na loja' : `Entrega: ${fee > 0 ? money(fee) : 'a combinar'}${deliveryZone && fee > 0 ? ` (${deliveryZone})` : ''}`,
    `*Total: ${money(total)}*`,
    customerName ? `Nome: ${customerName}` : null,
    customerPhone ? `Fone: ${customerPhone}` : null,
    !isPickup && addressLine ? `Endereço: ${addressLine}` : null,
    isPickup && store.pickup_address ? `Retirada em: ${store.pickup_address}` : null,
    note ? `Obs: ${note}` : null,
    pixKey ? `PIX: ${pixKey}` : null,
    '',
    'Pedido feito pelo catálogo'
  ]
    .filter(Boolean)
    .join('\n')
}

export function whatsappUrl(phone, text) {
  const number = toWhatsAppNumber(phone)
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(phone, text) {
  window.open(whatsappUrl(phone, text), '_blank', 'noopener,noreferrer')
}
