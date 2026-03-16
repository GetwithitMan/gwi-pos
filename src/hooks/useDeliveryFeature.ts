'use client'

/**
 * Hook for conditionally rendering delivery UI.
 * When MC flag is off or venue delivery disabled, returns false.
 * Components should use this to REMOVE delivery UI from DOM (not disable -- absent).
 *
 * Follows the same pattern as useOrderSettings / usePOSDisplay:
 * fetches from /api/settings with module-level caching + TTL.
 */

import { useState, useEffect } from 'react'
import {
  isDeliveryFeatureActive,
  isFeatureConfigStale,
  isEmergencyDisabled,
  type DeliveryFeatureFlags,
} from '@/lib/delivery/feature-check'

type SubfeatureKey = keyof Omit<DeliveryFeatureFlags, 'deliveryModuleEnabled' | 'disableMode' | 'lastSyncedAt' | 'lastSyncedVersion'>

// Module-level cache -- shared across all useDeliveryFeature() consumers
interface DeliverySettingsCache {
  delivery?: { enabled?: boolean }
  deliveryFeatures?: Partial<DeliveryFeatureFlags>
}

let cachedSettings: DeliverySettingsCache | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let inflight: Promise<DeliverySettingsCache | null> | null = null

async function fetchDeliverySettings(): Promise<DeliverySettingsCache | null> {
  // Check module cache
  if (cachedSettings && Date.now() - cacheTime < CACHE_TTL) {
    return cachedSettings
  }

  // Deduplicate concurrent fetches
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        const settings = data.settings || data
        const result: DeliverySettingsCache = {
          delivery: settings.delivery,
          deliveryFeatures: settings.deliveryFeatures,
        }
        cachedSettings = result
        cacheTime = Date.now()
        return result
      }
    } catch (error) {
      console.error('[useDeliveryFeature] Failed to load settings:', error)
    } finally {
      inflight = null
    }
    return null
  })()

  inflight = promise
  return promise
}

export function useDeliveryFeature(subfeature?: SubfeatureKey): boolean {
  const [active, setActive] = useState(() => {
    if (!cachedSettings) return false
    return isDeliveryFeatureActive(cachedSettings, subfeature)
  })

  useEffect(() => {
    let cancelled = false
    void fetchDeliverySettings().then((settings) => {
      if (cancelled || !settings) return
      setActive(isDeliveryFeatureActive(settings, subfeature))
    })
    return () => { cancelled = true }
  }, [subfeature])

  return active
}

export function useDeliveryFeatureStale(): boolean {
  const [stale, setStale] = useState(() => {
    if (!cachedSettings) return false
    return isFeatureConfigStale(cachedSettings)
  })

  useEffect(() => {
    let cancelled = false
    void fetchDeliverySettings().then((settings) => {
      if (cancelled || !settings) return
      setStale(isFeatureConfigStale(settings))
    })
    return () => { cancelled = true }
  }, [])

  return stale
}

export function useDeliveryEmergencyDisabled(): boolean {
  const [emergency, setEmergency] = useState(() => {
    if (!cachedSettings) return false
    return isEmergencyDisabled(cachedSettings)
  })

  useEffect(() => {
    let cancelled = false
    void fetchDeliverySettings().then((settings) => {
      if (cancelled || !settings) return
      setEmergency(isEmergencyDisabled(settings))
    })
    return () => { cancelled = true }
  }, [])

  return emergency
}
