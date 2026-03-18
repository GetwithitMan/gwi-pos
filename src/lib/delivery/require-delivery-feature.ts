import { NextResponse } from 'next/server'
import { getLocationSettings } from '@/lib/location-cache'
import { createChildLogger } from '@/lib/logger'
import { isDeliveryFeatureActive, type DeliveryFeatureFlags } from './feature-check'

const log = createChildLogger('delivery')

type SubfeatureKey = keyof Omit<DeliveryFeatureFlags, 'deliveryModuleEnabled' | 'disableMode' | 'lastSyncedAt' | 'lastSyncedVersion'>

interface FeatureGateOptions {
  subfeature?: SubfeatureKey
  operation?: 'new_order' | 'active_operation' | 'tracking'
  isPublic?: boolean // true = 404 on disabled (no info leak), false = 403 with message
}

/**
 * Middleware for delivery API routes. Call as first line in every /api/delivery/* handler.
 *
 * Uses getLocationSettings() from location-cache (same pattern as waitlist, time-clock,
 * shift-close, etc.) for cached settings access.
 *
 * @returns null if feature is active (proceed), or NextResponse (return immediately)
 */
export async function requireDeliveryFeature(
  locationId: string,
  options: FeatureGateOptions = {}
): Promise<NextResponse | null> {
  const { subfeature, operation = 'active_operation', isPublic = false } = options

  try {
    const settings = await getLocationSettings(locationId)

    if (!settings) {
      return isPublic
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    if (!isDeliveryFeatureActive(settings as { delivery?: { enabled?: boolean }; deliveryFeatures?: Partial<DeliveryFeatureFlags> }, subfeature, operation)) {
      if (isPublic) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Feature not provisioned by administrator' },
        { status: 403 }
      )
    }

    return null // Feature is active, proceed
  } catch (error) {
    log.error({ err: error }, '[requireDeliveryFeature] Error checking feature gate:')
    // Fail closed -- if we can't check, deny access
    return isPublic
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : NextResponse.json({ error: 'Feature check failed' }, { status: 500 })
  }
}
