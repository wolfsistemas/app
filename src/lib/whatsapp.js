import { money, toWhatsAppNumber } from './format'

export function buildOrderMessage({ store, items, customerName, note, pixKey }) {
  const lines = items.map((item) => {
    const qty = item.qty || 1
    return `${qty}x ${item.name} — ${money(item.price * qty)}`
  })
  const total = items.reduce((sum, item) => sum + Number(item.price) * (item.qty || 1), 0)

  return [
    `*Pedido ${store.name}*`,
    '',
    ...lines,
    '',
    `*Total: ${money(total)}*`,
    customerName ? `Nome: ${customerName}` : null,
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
