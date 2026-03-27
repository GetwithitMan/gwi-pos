import { NextResponse } from 'next/server'
import { getLocationSettings } from '@/lib/location-cache'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cake-orders')

/**
 * Middleware for cake ordering API routes. Call as first line in every /api/cake-orders/* handler.
 *
 * Checks:
 * 1. Location settings exist (fail-closed)
 * 2. License includes 'cake_ordering' (MC PRO+ tier)
 * 3. Venue toggle cakeOrdering.enabled is true
 *
 * @returns null if feature is active (proceed), or NextResponse (return immediately)
 */
export async function requireCakeFeature(
  locationId: string,
  options: { isPublic?: boolean } = {}
): Promise<NextResponse | null> {
  const { isPublic = false } = options

  try {
    const settings = await getLocationSettings(locationId) as Record<string, any> | null

    if (!settings) {
      return isPublic
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // 1. License check (MC PRO+ tier)
    const licenseFeatures: string[] = settings.licenseFeatures ?? []
    if (!licenseFeatures.includes('cake_ordering')) {
      return isPublic
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : NextResponse.json({ error: 'Feature not provisioned by administrator' }, { status: 403 })
    }

    // 2. Venue operational toggle
    if (!settings.cakeOrdering?.enabled) {
      return isPublic
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : NextResponse.json({ error: 'Cake ordering is not enabled' }, { status: 403 })
    }

    return null // Feature is active, proceed
  } catch (error) {
    log.error({ err: error }, '[requireCakeFeature] Error checking feature gate:')
    // Fail closed -- if we can't check, deny access
    return isPublic
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : NextResponse.json({ error: 'Feature check failed' }, { status: 500 })
  }
}
