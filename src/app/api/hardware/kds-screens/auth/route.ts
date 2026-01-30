import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Cookie name for device token
const DEVICE_TOKEN_COOKIE = 'kds_device_token'

// GET /api/hardware/kds-screens/auth - Verify device token and get screen info
export async function GET(request: NextRequest) {
  try {
    // Try to get token from httpOnly cookie first (most secure), then header (fallback)
    const cookieToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value
    const headerToken = request.headers.get('x-device-token')
    const deviceToken = cookieToken || headerToken

    const slug = request.nextUrl.searchParams.get('slug')
    const screenId = request.nextUrl.searchParams.get('screenId')

    if (!deviceToken && !slug && !screenId) {
      return NextResponse.json(
        { error: 'Device token, slug, or screenId is required' },
        { status: 400 }
      )
    }

    let screen

    if (deviceToken) {
      // Auth by device token (most secure)
      screen = await db.kDSScreen.findUnique({
        where: { deviceToken },
        include: {
          stations: {
            include: {
              station: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
    } else if (screenId) {
      // Auth by screen ID (for URL parameter approach)
      screen = await db.kDSScreen.findUnique({
        where: { id: screenId },
        include: {
          stations: {
            include: {
              station: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
    } else if (slug) {
      // Auth by slug (for URL approach, e.g., /kds?screen=kitchen-main)
      // Need to find by slug across all locations (or require locationId)
      screen = await db.kDSScreen.findFirst({
        where: { slug },
        include: {
          stations: {
            include: {
              station: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
    }

    if (!screen) {
      return NextResponse.json(
        { error: 'KDS screen not found or invalid token' },
        { status: 404 }
      )
    }

    // If screen requires pairing and request has no valid token
    if (screen.isPaired && deviceToken !== screen.deviceToken) {
      return NextResponse.json(
        {
          error: 'Device not paired',
          requiresPairing: true,
          screenId: screen.id,
          screenName: screen.name,
        },
        { status: 401 }
      )
    }

    // Static IP enforcement (for UniFi/private networks)
    if (screen.enforceStaticIp && screen.staticIp) {
      const forwardedFor = request.headers.get('x-forwarded-for')
      const realIp = request.headers.get('x-real-ip')
      const clientIp = forwardedFor?.split(',')[0]?.trim() || realIp || null

      if (clientIp !== screen.staticIp) {
        return NextResponse.json(
          {
            error: 'IP address not authorized',
            expectedIp: screen.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    return NextResponse.json({
      authenticated: true,
      screen: {
        id: screen.id,
        name: screen.name,
        slug: screen.slug,
        screenType: screen.screenType,
        locationId: screen.locationId,
        columns: screen.columns,
        fontSize: screen.fontSize,
        colorScheme: screen.colorScheme,
        agingWarning: screen.agingWarning,
        lateWarning: screen.lateWarning,
        playSound: screen.playSound,
        flashOnNew: screen.flashOnNew,
        isPaired: screen.isPaired,
        stations: screen.stations.map((ss) => ({
          id: ss.station.id,
          name: ss.station.name,
          displayName: ss.station.displayName,
          stationType: ss.station.stationType,
          color: ss.station.color,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to authenticate KDS:', error)
    return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 })
  }
}
