import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// Cookie name for device token
const DEVICE_TOKEN_COOKIE = 'kds_device_token'

// POST heartbeat from KDS screen
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Try to get token from httpOnly cookie first (most secure), then header (fallback)
    const cookieToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value
    const headerToken = request.headers.get('x-device-token')
    const deviceToken = cookieToken || headerToken

    const screen = await db.kDSScreen.findUnique({
      where: { id },
    })

    if (!screen) {
      return NextResponse.json({ error: 'KDS screen not found' }, { status: 404 })
    }

    // If screen is paired, verify the device token
    if (screen.isPaired && screen.deviceToken) {
      if (deviceToken !== screen.deviceToken) {
        return NextResponse.json(
          { error: 'Invalid device token', requiresPairing: true },
          { status: 401 }
        )
      }
    }

    // Get client IP for troubleshooting
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const lastKnownIp = forwardedFor?.split(',')[0]?.trim() || realIp || null

    // Static IP enforcement (for UniFi/private networks)
    if (screen.enforceStaticIp && screen.staticIp) {
      if (lastKnownIp !== screen.staticIp) {
        return NextResponse.json(
          {
            error: 'IP address not authorized',
            expectedIp: screen.staticIp,
            actualIp: lastKnownIp,
          },
          { status: 403 }
        )
      }
    }

    // Extract browser/Chrome version from User-Agent
    const userAgent = request.headers.get('user-agent') || ''
    const chromeMatch = userAgent.match(/Chrome\/(\d+\.\d+)/)
    let chromeVersion: string | null = null
    let browserSummary: string | null = null
    if (chromeMatch) {
      chromeVersion = chromeMatch[1]
      browserSummary = `Chrome ${chromeVersion}`
    } else if (userAgent) {
      // Fallback: extract main browser name from UA string
      const browserMatch = userAgent.match(/(\w+)\/[\d.]+\s*$/) ||
        userAgent.match(/(Firefox|Safari|Edge|OPR|Opera)\/[\d.]+/)
      browserSummary = browserMatch ? browserMatch[1] : 'Unknown'
    }

    // Merge new device info with any existing data
    const existingDeviceInfo = (screen.deviceInfo && typeof screen.deviceInfo === 'object' && !Array.isArray(screen.deviceInfo))
      ? screen.deviceInfo as Record<string, unknown>
      : {}
    const updatedDeviceInfo = {
      ...existingDeviceInfo,
      ...(chromeVersion !== null && { chromeVersion }),
      ...(browserSummary !== null && { userAgent: browserSummary }),
    }

    // Update last seen time, IP, and device info
    await db.kDSScreen.update({
      where: { id },
      data: {
        lastSeenAt: new Date(),
        isOnline: true,
        ...(lastKnownIp && { lastKnownIp }),
        deviceInfo: updatedDeviceInfo,
      },
    })

    return NextResponse.json({ data: {
      success: true,
      screen: {
        id: screen.id,
        name: screen.name,
        slug: screen.slug,
        columns: screen.columns,
        fontSize: screen.fontSize,
        colorScheme: screen.colorScheme,
        agingWarning: screen.agingWarning,
        lateWarning: screen.lateWarning,
        playSound: screen.playSound,
        flashOnNew: screen.flashOnNew,
      },
    } })
  } catch (error) {
    console.error('Failed to update KDS screen heartbeat:', error)
    return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 })
  }
})
