import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'

const VALID_PLATFORMS = ['BROWSER', 'ANDROID', 'IOS'] as const

// POST complete terminal pairing for native apps (Android/iOS)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pairingCode, deviceFingerprint, deviceInfo, appVersion, osVersion, pushToken } = body
    const platform = VALID_PLATFORMS.includes(body.platform) ? body.platform : 'ANDROID'

    if (!pairingCode) {
      return NextResponse.json({ error: 'Pairing code is required' }, { status: 400 })
    }

    // Find terminal by pairing code — locationId is derived from the terminal record
    // (no need for the client to send locationId separately)
    const terminal = await db.terminal.findFirst({
      where: {
        pairingCode,
        deletedAt: null,
      },
    })

    if (!terminal) {
      return NextResponse.json({ error: 'Invalid pairing code' }, { status: 400 })
    }

    // Check if code is expired
    if (terminal.pairingCodeExpiresAt && terminal.pairingCodeExpiresAt < new Date()) {
      return NextResponse.json({ error: 'Pairing code has expired' }, { status: 400 })
    }

    // Hardware limit check — count active paired terminals for this location
    const locationId = terminal.locationId
    const activeTerminalCount = await db.terminal.count({
      where: {
        locationId,
        isPaired: true,
        deletedAt: null,
      },
    })

    // Default limit: 20 terminals per location (Mission Control subscriptionLimits can override)
    const TERMINAL_LIMIT = 20
    if (activeTerminalCount >= TERMINAL_LIMIT) {
      return NextResponse.json(
        {
          error: 'Hardware limit reached. Maximum number of terminals for this location has been exceeded.',
          code: 'LIMIT_EXCEEDED',
          current: activeTerminalCount,
          limit: TERMINAL_LIMIT,
        },
        { status: 403 }
      )
    }

    // Get client IP
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // IP affinity is NOT checked during pairing — the pairing code is the
    // authentication. Static IP enforcement happens on subsequent heartbeats
    // and API requests after the device is paired.

    // Generate secure device token
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Complete pairing with native app fields
    const updated = await db.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceToken,
        deviceFingerprint: deviceFingerprint || null,
        deviceInfo: deviceInfo || null,
        platform,
        appVersion: appVersion || null,
        osVersion: osVersion || null,
        pushToken: pushToken || null,
        lastKnownIp: clientIp,
        lastSeenAt: new Date(),
        isPaired: true,
        isOnline: true,
        // Clear pairing code after successful pair
        pairingCode: null,
        pairingCodeExpiresAt: null,
      },
      include: {
        receiptPrinter: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            printerRole: true,
          },
        },
      },
    })

    // Return token in JSON body (native apps use Bearer token auth, no httpOnly cookie)
    return NextResponse.json({ data: {
      token: deviceToken,
      terminal: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        platform: updated.platform,
        roleSkipRules: updated.roleSkipRules,
        forceAllPrints: updated.forceAllPrints,
        receiptPrinter: updated.receiptPrinter,
      },
      location: { id: terminal.locationId },
    } })
  } catch (error) {
    console.error('Failed to pair native terminal:', error)
    return NextResponse.json({ error: 'Failed to pair terminal' }, { status: 500 })
  }
})
