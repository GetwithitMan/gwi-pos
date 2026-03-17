'use client'

/**
 * Hook for conditionally rendering cake ordering UI.
 * Returns true only when:
 * 1. Venue license includes 'cake_ordering' feature (MC PRO+ tier)
 * 2. settings.cakeOrdering.enabled is true
 *
 * Components should use this to REMOVE cake UI from DOM when inactive.
 * Follows useDeliveryFeature pattern: /api/settings fetch with module-level caching.
 */

import { useState, useEffect } from 'react'

interface CakeSettingsCache {
  cakeOrdering?: { enabled?: boolean }
  licenseFeatures?: string[]
}

let cachedSettings: CakeSettingsCache | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let inflight: Promise<CakeSettingsCache | null> | null = null

async function fetchCakeSettings(): Promise<CakeSettingsCache | null> {
  if (cachedSettings && Date.now() - cacheTime < CACHE_TTL) {
    return cachedSettings
  }

  if (inflight) return inflight

  const promise = (async () => {
    try {
      const response = await fetch('/api/settings', { credentials: 'include' })
      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        const settings = data.settings || data
        const result: CakeSettingsCache = {
          cakeOrdering: settings.cakeOrdering,
          licenseFeatures: data.licenseFeatures || data.features || [],
        }
        cachedSettings = result
        cacheTime = Date.now()
        return result
      }
    } catch {
      // Silent — fetch may fail during SSR/compilation
    } finally {
      inflight = null
    }
    return null
  })()

  inflight = promise
  return promise
}

/**
 * Returns true if cake ordering is fully enabled (licensed + venue toggle on).
 * Use for operational pages (order list, production, calendar).
 */
export function useCakeFeature(): boolean {
  const [active, setActive] = useState(() => {
    if (!cachedSettings) return false
    return isCakeActive(cachedSettings)
  })

  useEffect(() => {
    let cancelled = false
    void fetchCakeSettings().then((settings) => {
      if (cancelled || !settings) return
      setActive(isCakeActive(settings))
    })
    return () => { cancelled = true }
  }, [])

  return active
}

/**
 * Returns true if venue is licensed for cake ordering (PRO+ tier).
 * Use for settings/config page (visible when licensed, even if not enabled).
 */
export function useCakeLicensed(): boolean {
  const [licensed, setLicensed] = useState(() => {
    if (!cachedSettings) return false
    return isCakeLicensed(cachedSettings)
  })

  useEffect(() => {
    let cancelled = false
    void fetchCakeSettings().then((settings) => {
      if (cancelled || !settings) return
      setLicensed(isCakeLicensed(settings))
    })
    return () => { cancelled = true }
  }, [])

  return licensed
}

function isCakeActive(settings: CakeSettingsCache): boolean {
  return isCakeLicensed(settings) && settings.cakeOrdering?.enabled === true
}

function isCakeLicensed(settings: CakeSettingsCache): boolean {
  return settings.licenseFeatures?.includes('cake_ordering') ?? false
}
