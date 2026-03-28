import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

// Cookie name for device token
const DEVICE_TOKEN_COOKIE = 'kds_device_token'

// ── IP-based rate limiting for device token guessing (5 attempts / 60s) ──
const KDS_AUTH_MAX_FAILURES = 5
const KDS_AUTH_LOCKOUT_MS = 60 * 1000
const kdsAuthIpMap = new Map<string, { failures: number; lockedUntil: number | null; lastFailure: number }>()

function checkKdsAuthRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  const now = Date.now()
  let entry = kdsAuthIpMap.get(ip)
  if (!entry) {
    entry = { failures: 0, lockedUntil: null, lastFailure: 0 }
    kdsAuthIpMap.set(ip, entry)
  }
  if (entry.lockedUntil && now < entry.lockedUntil) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000)
    return { allowed: false, retryAfterSeconds, reason: `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.` }
  }
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    entry.failures = 0
    entry.lockedUntil = null
  }
  return { allowed: true }
}

function recordKdsAuthFailure(ip: string): void {
  const now = Date.now()
  let entry = kdsAuthIpMap.get(ip)
  if (!entry) {
    entry = { failures: 0, lockedUntil: null, lastFailure: 0 }
    kdsAuthIpMap.set(ip, entry)
  }
  entry.failures++
  entry.lastFailure = now
  if (entry.failures >= KDS_AUTH_MAX_FAILURES) {
    entry.lockedUntil = now + KDS_AUTH_LOCKOUT_MS
  }
}

// GET /api/hardware/kds-screens/auth - Verify device token and get screen info
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    // ── Rate limiting (5 attempts / minute) ────────────────────
    const ip = getClientIp(request)

    const rateCheck = checkKdsAuthRateLimit(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason },
        {
          status: 429,
          headers: rateCheck.retryAfterSeconds
            ? { 'Retry-After': String(rateCheck.retryAfterSeconds) }
            : undefined,
        }
      )
    }
    // Try to get token from httpOnly cookie first (most secure), then header (fallback)
    const cookieToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value
    const headerToken = request.headers.get('x-device-token')
    const deviceToken = cookieToken || headerToken

    const slug = request.nextUrl.searchParams.get('slug')
    const screenId = request.nextUrl.searchParams.get('screenId')

    if (!deviceToken && !slug && !screenId) {
      return err('Device token, slug, or screenId is required')
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
      recordKdsAuthFailure(ip)
      return notFound('KDS screen not found or invalid token')
    }

    // If screen requires pairing and request has no valid token
    if (screen.isPaired && deviceToken !== screen.deviceToken) {
      recordKdsAuthFailure(ip)
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

    // Fetch source links for screen communication
    const sourceLinks = await db.kDSScreenLink.findMany({
      where: {
        sourceScreenId: screen.id,
        isActive: true,
        deletedAt: null,
      },
      include: {
        targetScreen: { select: { id: true, name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return ok({
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
        // KDS Overhaul: new fields
        displayMode: screen.displayMode,
        transitionTimes: screen.transitionTimes,
        orderBehavior: screen.orderBehavior,
        orderTypeFilters: screen.orderTypeFilters,
        sourceLinks: sourceLinks.map(sl => ({
          id: sl.id,
          targetScreenId: sl.targetScreenId,
          targetScreenName: sl.targetScreen.name,
          linkType: sl.linkType,
          bumpAction: sl.bumpAction,
          resetStrikethroughsOnSend: sl.resetStrikethroughsOnSend,
        })),
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
    return err('Failed to authenticate', 500)
  }
})
