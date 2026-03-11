const CACHE_NAME = 'gwi-pos-v3'
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

  // Never intercept API calls, socket paths, or HMR — they must always hit the network
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/__nextjs')
  ) {
    return
  }

  // Only cache GET requests (POST/PUT/DELETE are not cacheable)
  if (event.request.method !== 'GET') {
    return
  }

  // Network-first: try server, fall back to cache only if offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with fresh response
        const clone = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        return response
      })
      .catch(() => caches.match(event.request).then(cached => cached || new Response('Offline', { status: 503 })))
  )
})
