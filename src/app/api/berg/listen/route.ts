import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

const MAX_LIMIT = 50

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId') || ''
    const requestingEmployeeId = searchParams.get('employeeId') || ''
    const deviceId = searchParams.get('deviceId') || undefined
    const since = searchParams.get('since') ? new Date(searchParams.get('since')!) : undefined
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), MAX_LIMIT)

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    const events = await db.bergDispenseEvent.findMany({
      where: {
        locationId,
        ...(deviceId ? { deviceId } : {}),
        ...(since ? { receivedAt: { gt: since } } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        receivedAt: true,
        deviceId: true,
        pluNumber: true,
        rawPacket: true,
        modifierBytes: true,
        parseStatus: true,
        lrcReceived: true,
        lrcCalculated: true,
        lrcValid: true,
        status: true,
        unmatchedType: true,
        ackLatencyMs: true,
        orderId: true,
        pluMapping: { select: { description: true } },
        device: { select: { name: true } },
      },
    })

    return ok({ events: events.reverse() }) // oldest-first for display
  } catch (caughtErr) {
    console.error('[berg/listen GET]', err)
    return err('Failed to load events', 500)
  }
})
