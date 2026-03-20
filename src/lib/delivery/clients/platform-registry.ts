// ---------------------------------------------------------------------------
// Platform Client Registry
//
// Orchestrator that creates the correct platform client based on the
// location's ThirdPartyDeliverySettings. Uses lazy require() so the bundler
// doesn't pull all platform SDKs when only one is needed.
// ---------------------------------------------------------------------------

import type { IPlatformClient, DeliveryPlatformId } from './types'
import type { LocationSettings } from '@/lib/settings/types'

/**
 * Get the active client for a single platform, using credentials from settings.
 * Returns null if the platform is not enabled or credentials are missing.
 */
export function getPlatformClient(
  platform: DeliveryPlatformId,
  settings: LocationSettings,
  onTokenRefresh?: (token: string, expiresAt: number) => void,
): IPlatformClient | null {
  const tpd = settings.thirdPartyDelivery
  if (!tpd) return null

  switch (platform) {
    case 'doordash': {
      if (!tpd.doordash?.enabled || !tpd.doordashCredentials?.developerId) return null
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createDoorDashClient } = require('./doordash')
      return createDoorDashClient(tpd.doordashCredentials, tpd.doordash.storeId)
    }
    case 'ubereats': {
      if (!tpd.ubereats?.enabled || !tpd.uberEatsCredentials?.clientId) return null
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createUberEatsClient } = require('./ubereats')
      return createUberEatsClient(tpd.uberEatsCredentials, tpd.ubereats.storeId, onTokenRefresh)
    }
    case 'grubhub': {
      if (!tpd.grubhub?.enabled || !tpd.grubhubCredentials?.clientId) return null
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createGrubhubClient } = require('./grubhub')
      return createGrubhubClient(tpd.grubhubCredentials, tpd.grubhub.storeId)
    }
    default:
      return null
  }
}

/**
 * Get all active platform clients for a location.
 * Iterates known platforms and returns those that are enabled with valid credentials.
 */
export function getActivePlatformClients(
  settings: LocationSettings,
): Array<{ platform: DeliveryPlatformId; client: IPlatformClient }> {
  const platforms: DeliveryPlatformId[] = ['doordash', 'ubereats', 'grubhub']
  const active: Array<{ platform: DeliveryPlatformId; client: IPlatformClient }> = []

  for (const p of platforms) {
    const client = getPlatformClient(p, settings)
    if (client) active.push({ platform: p, client })
  }
  return active
}
