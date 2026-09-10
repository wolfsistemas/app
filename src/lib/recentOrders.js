const KEY = 'vitrinezap:recent-orders'
const LIMIT = 8

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function rememberOrder(entry) {
  if (!entry?.token || !entry?.slug) return
  const next = [entry, ...read().filter((o) => o.token !== entry.token)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // armazenamento indisponível (modo privado)
  }
}

export function recentOrders(slug) {
  return read().filter((o) => o.slug === slug)
}
