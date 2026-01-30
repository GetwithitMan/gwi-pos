import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'

// Cookie name for device token
const DEVICE_TOKEN_COOKIE = 'kds_device_token'

// POST /api/hardware/kds-screens/pair - Complete pairing with a code
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pairingCode, deviceInfo } = body

    if (!pairingCode) {
      return NextResponse.json({ error: 'Pairing code is required' }, { status: 400 })
    }

    // Find screen with this pairing code
    const screen = await db.kDSScreen.findFirst({
      where: {
        pairingCode,
        pairingCodeExpiresAt: {
          gt: new Date(), // Not expired
        },
      },
    })

    if (!screen) {
      return NextResponse.json(
        { error: 'Invalid or expired pairing code' },
        { status: 400 }
      )
    }

    // Generate a secure device token (64 chars hex = 256 bits)
    const deviceToken = randomBytes(32).toString('hex')

    // Get client IP from request headers
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const lastKnownIp = forwardedFor?.split(',')[0]?.trim() || realIp || null

    // Update screen with pairing info
    await db.kDSScreen.update({
      where: { id: screen.id },
      data: {
        deviceToken,
        isPaired: true,
        pairingCode: null, // Clear the code after successful pairing
        pairingCodeExpiresAt: null,
        lastKnownIp,
        lastSeenAt: new Date(),
        isOnline: true,
        deviceInfo: deviceInfo || null,
      },
    })

    // Create response with httpOnly cookie for security
    const response = NextResponse.json({
      success: true,
      deviceToken, // Also return in body for localStorage fallback
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
      },
    })

    // Set httpOnly cookie - lasts 1 year, cannot be read by JavaScript
    const isProduction = process.env.NODE_ENV === 'production'
    response.cookies.set(DEVICE_TOKEN_COOKIE, deviceToken, {
      httpOnly: true, // Cannot be accessed by JavaScript (XSS protection)
      secure: isProduction, // Only send over HTTPS in production
      sameSite: 'strict', // CSRF protection
      maxAge: 365 * 24 * 60 * 60, // 1 year
      path: '/', // Available on all paths
    })

    return response
  } catch (error) {
    console.error('Failed to complete pairing:', error)
    return NextResponse.json({ error: 'Failed to complete pairing' }, { status: 500 })
  }
}
