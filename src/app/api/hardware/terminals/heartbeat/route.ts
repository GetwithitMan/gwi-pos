import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getClientIp } from '@/lib/get-client-ip'
// POST terminal heartbeat - updates online status
// NO withAuth — this route does its own token validation via terminal_token cookie.
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Get token from httpOnly cookie
    const terminalToken = request.cookies.get('terminal_token')?.value

    if (!terminalToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get client IP
    const clientIp = getClientIp(request)

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
      // Token is invalid - clear the cookie
      const response = NextResponse.json({ error: 'Invalid terminal token' }, { status: 401 })
      response.cookies.delete('terminal_token')
      return response
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
            lastMutatedBy: 'local',
          },
        })

        void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
        void pushUpstream()

        const response = NextResponse.json(
          {
            error: 'IP mismatch - terminal must be re-paired',
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
        response.cookies.delete('terminal_token')
        return response
      }
    }

    // Update last seen
    await db.terminal.update({
      where: { id: terminal.id },
      data: {
        isOnline: true,
        lastSeenAt: new Date(),
        lastKnownIp: clientIp,
        lastMutatedBy: 'local',
      },
    })

    void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

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
    console.error('Terminal heartbeat failed:', error)
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 })
  }
})
