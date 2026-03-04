'use client'

import { useEffect } from 'react'

// Bump this when sw.js changes to force all browsers to get the new version.
const CURRENT_CACHE = 'gwi-pos-v2'
const STALE_CACHES = ['gwi-pos-v1']

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    async function init() {
      // If any stale cache exists, the old SW is still (or was recently) active.
      // Unregister all SWs and reload so the fresh SW takes control before API
      // calls are made. The reload will land here again with no stale caches.
      const staleExists = (
        await Promise.all(STALE_CACHES.map(name => caches.has(name)))
      ).some(Boolean)

      if (staleExists) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map(r => r.unregister()))
        await Promise.all(STALE_CACHES.map(name => caches.delete(name)))
        window.location.reload()
        return
      }

      // Normal path: register (or re-register) current sw.js
      await navigator.serviceWorker.register('/sw.js').catch(console.error)
    }

    void init()
  }, [])

  return null
}

// Keep the current cache name accessible for any other module that needs it.
export { CURRENT_CACHE }
