import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { db } from '@/lib/db'
import { getDeviceCounts } from '@/lib/device-limits'

// GET current device counts and limits for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Get current counts
    const counts = await getDeviceCounts(locationId)

    // Get limits from settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const limits = settings.hardwareLimits

    return NextResponse.json({
      data: {
        counts,
        limits: limits
          ? {
              maxPOSTerminals: limits.maxPOSTerminals,
              maxHandhelds: limits.maxHandhelds,
              maxCellularDevices: limits.maxCellularDevices,
              maxKDSScreens: limits.maxKDSScreens,
              maxPrinters: limits.maxPrinters,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch device counts:', error)
    return NextResponse.json({ error: 'Failed to fetch device counts' }, { status: 500 })
  }
})
