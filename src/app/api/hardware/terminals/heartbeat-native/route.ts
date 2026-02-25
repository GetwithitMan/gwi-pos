import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST terminal heartbeat for native apps (Android/iOS) - Bearer token auth
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Get token from Authorization header instead of cookie
    const authHeader = request.headers.get('authorization')
    const terminalToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!terminalToken) {
      return NextResponse.json({ error: 'Not authenticated. Provide Authorization: Bearer {token}' }, { status: 401 })
    }

    // Parse optional body for version info
    let appVersion: string | undefined
    try {
      const body = await request.json()
      appVersion = body?.appVersion
    } catch {
      // No body or invalid JSON — fine, heartbeat still works
    }

    // Get client IP
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // Find terminal by token
    const terminal = await db.terminal.findFirst({
      where: {
        deviceToken: terminalToken,
        deletedAt: null,
      },
      include: {
        receiptPrinter: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
          },
        },
      },
    })

    if (!terminal) {
      return NextResponse.json({ error: 'Invalid terminal token' }, { status: 401 })
    }

    // IP affinity check for fixed stations
    if (terminal.category === 'FIXED_STATION' && terminal.staticIp) {
      if (clientIp !== terminal.staticIp && clientIp !== 'unknown') {
        // IP mismatch on fixed station - force re-pair
        await db.terminal.update({
          where: { id: terminal.id },
          data: {
            isPaired: false,
            isOnline: false,
            deviceToken: null,
          },
        })

        return NextResponse.json(
          {
            error: 'IP mismatch - terminal must be re-paired',
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    // Update last seen
    await db.terminal.update({
      where: { id: terminal.id },
      data: {
        isOnline: true,
        lastSeenAt: new Date(),
        lastKnownIp: clientIp,
        ...(appVersion ? { appVersion } : {}),
      },
    })

    return NextResponse.json({ data: {
      success: true,
      terminal: {
        id: terminal.id,
        name: terminal.name,
        category: terminal.category,
        roleSkipRules: terminal.roleSkipRules,
        forceAllPrints: terminal.forceAllPrints,
        receiptPrinter: terminal.receiptPrinter,
      },
    } })
  } catch (error) {
    console.error('Terminal heartbeat (native) failed:', error)
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 })
  }
})
