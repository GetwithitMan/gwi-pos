import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'

// POST complete terminal pairing with code
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pairingCode, deviceFingerprint, deviceInfo } = body
    const locationId = body.locationId
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (!pairingCode) {
      return NextResponse.json({ error: 'Pairing code is required' }, { status: 400 })
    }

    // Find terminal with this pairing code
    const terminal = await db.terminal.findFirst({
      where: {
        locationId,
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

    // Get client IP
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // IP affinity check for fixed stations
    // If a static IP is configured, the pairing device must match
    if (terminal.category === 'FIXED_STATION' && terminal.staticIp) {
      if (clientIp !== terminal.staticIp && clientIp !== 'unknown') {
        return NextResponse.json(
          {
            error: `This terminal is configured for IP ${terminal.staticIp}. Your device IP (${clientIp}) does not match.`,
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    // Generate secure device token
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Complete pairing
    const updated = await db.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceToken,
        deviceFingerprint: deviceFingerprint || null,
        deviceInfo: deviceInfo || null,
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

    // Create response with httpOnly cookie for the token
    const response = NextResponse.json({ data: {
      success: true,
      terminal: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        roleSkipRules: updated.roleSkipRules,
        forceAllPrints: updated.forceAllPrints,
        receiptPrinter: updated.receiptPrinter,
      },
    } })

    // Set httpOnly cookie for security (1 year expiry)
    response.cookies.set('terminal_token', deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 365 * 24 * 60 * 60, // 1 year
    })

    return response
  } catch (error) {
    console.error('Failed to pair terminal:', error)
    return NextResponse.json({ error: 'Failed to pair terminal' }, { status: 500 })
  }
})
