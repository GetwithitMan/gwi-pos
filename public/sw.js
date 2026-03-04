const CACHE_NAME = 'gwi-pos-v2'
const STATIC_ASSETS = ['/', '/login', '/orders']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept API calls — they must always hit the network.
  // Intercepting API calls with a cache fallback causes TypeError: Failed to fetch
  // when the fallback returns undefined (API responses are never cached).
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  )
})
