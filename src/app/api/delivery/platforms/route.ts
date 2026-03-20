/**
 * Delivery Platforms — Check which third-party platforms are connected and ready
 *
 * GET /api/delivery/platforms?locationId=...&employeeId=...
 *
 * Returns per-platform status: enabled, credentials configured, storeId set, DaaS enabled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'

interface PlatformStatus {
  platform: string
  enabled: boolean
  credentialsConfigured: boolean
  storeIdSet: boolean
  daasEnabled: boolean
  ready: boolean
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Load settings
    const settings = parseSettings(await getLocationSettings(locationId))
    const tpd = settings.thirdPartyDelivery

    const platforms: PlatformStatus[] = []

    // DoorDash
    {
      const enabled = !!tpd?.doordash?.enabled
      const credentialsConfigured = !!tpd?.doordashCredentials?.developerId
      const storeIdSet = !!tpd?.doordash?.storeId
      const daasEnabled = !!tpd?.doordashCredentials?.driveEnabled
      platforms.push({
        platform: 'doordash',
        enabled,
        credentialsConfigured,
        storeIdSet,
        daasEnabled,
        ready: enabled && credentialsConfigured && storeIdSet,
      })
    }

    // UberEats
    {
      const enabled = !!tpd?.ubereats?.enabled
      const credentialsConfigured = !!tpd?.uberEatsCredentials?.clientId
      const storeIdSet = !!tpd?.ubereats?.storeId
      const daasEnabled = !!tpd?.uberEatsCredentials?.directEnabled
      platforms.push({
        platform: 'ubereats',
        enabled,
        credentialsConfigured,
        storeIdSet,
        daasEnabled,
        ready: enabled && credentialsConfigured && storeIdSet,
      })
    }

    // Grubhub
    {
      const enabled = !!tpd?.grubhub?.enabled
      const credentialsConfigured = !!tpd?.grubhubCredentials?.clientId
      const storeIdSet = !!tpd?.grubhub?.storeId
      const daasEnabled = !!tpd?.grubhubCredentials?.connectEnabled
      platforms.push({
        platform: 'grubhub',
        enabled,
        credentialsConfigured,
        storeIdSet,
        daasEnabled,
        ready: enabled && credentialsConfigured && storeIdSet,
      })
    }

    return NextResponse.json({ data: { platforms } })
  } catch (error) {
    console.error('[GET /api/delivery/platforms] Error:', error)
    return NextResponse.json({ error: 'Failed to check platform status' }, { status: 500 })
  }
})
