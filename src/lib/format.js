export const FREE_PRODUCT_LIMIT = 8

export const RESERVED_SLUGS = [
  'entrar',
  'criar',
  'comecar',
  'painel',
  'api',
  'admin',
  'app',
  'login',
  'signup',
  'pricing',
  'preco',
  'demo'
]

export function money(value) {
  const n = Number(value || 0)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

export function formatPhone(value) {
  const d = onlyDigits(value)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

export function toWhatsAppNumber(value) {
  const d = onlyDigits(value)
  if (!d) return ''
  if (d.startsWith('55')) return d
  return `55${d}`
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
}

export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

export function publicUrl(slug) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  if (typeof window === 'undefined') return `${base}/${slug}`
  return `${window.location.origin}${base}/${slug}`
}
