const VERSION = 'vz-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || /\.(png|svg|webmanifest|ico)(\?|$)/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req))
    return
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
  }
})

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req)
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone()
        caches.open(VERSION).then((cache) => cache.put(req, copy))
      }
      return res
    })
    .catch(() => cached)
  return cached || network
}

async function networkFirst(req) {
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      const copy = res.clone()
      const cache = await caches.open(VERSION)
      cache.put('./index.html', copy)
    }
    return res
  } catch {
    const cached = await caches.match('./index.html')
    if (cached) return cached
    const fallback = await caches.match('./')
    return fallback || Response.error()
  }
}
