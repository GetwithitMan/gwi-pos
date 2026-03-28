import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { execSync } from 'child_process'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId') || ''
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    const devices = await db.bergDevice.findMany({
      where: { locationId, isActive: true },
    })

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const deviceStats = await Promise.all(
      devices.map(async (device) => {
        const [totalEvents, ackEvents, nakEvents, badLrcEvents, latencyAgg] = await Promise.all([
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: { gte: since24h } } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: { gte: since24h }, status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'] } } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: { gte: since24h }, status: { in: ['NAK', 'NAK_TIMEOUT'] } } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: { gte: since24h }, lrcValid: false } }),
          db.bergDispenseEvent.aggregate({ where: { deviceId: device.id, receivedAt: { gte: since24h }, ackLatencyMs: { not: null } }, _avg: { ackLatencyMs: true }, _max: { ackLatencyMs: true } }),
        ])

        const errorRate = totalEvents > 0 ? Math.round((nakEvents / totalEvents) * 100 * 10) / 10 : 0
        const lrcErrorRate = totalEvents > 0 ? Math.round((badLrcEvents / totalEvents) * 100 * 10) / 10 : 0

        // Idempotency dedup rate (events with same idempotency key within window)
        const dedupedCount = await db.bergDispenseEvent.count({
          where: { deviceId: device.id, receivedAt: { gte: since24h }, errorReason: 'IDEMPOTENT_DUPLICATE' },
        })
        const dedupRate = totalEvents > 0 ? Math.round((dedupedCount / totalEvents) * 100 * 10) / 10 : 0
        const dedupAlert = dedupRate > 5

        const { bridgeSecretHash: _, ...deviceData } = device
        return {
          ...deviceData,
          stats24h: {
            totalEvents,
            ackEvents,
            nakEvents,
            badLrcEvents,
            errorRate,
            lrcErrorRate,
            avgAckLatencyMs: latencyAgg._avg.ackLatencyMs ? Math.round(Number(latencyAgg._avg.ackLatencyMs)) : null,
            maxAckLatencyMs: latencyAgg._max.ackLatencyMs ? Math.round(Number(latencyAgg._max.ackLatencyMs)) : null,
            dedupedCount,
            dedupRate,
            dedupAlert: dedupAlert ? 'Possible ECU retry loop — check hardware (>5% dedup rate)' : null,
          },
        }
      })
    )

    // NTP sync check
    let timeSyncWarning = false
    try {
      const timedatectl = execSync('timedatectl status 2>/dev/null', { timeout: 2000 }).toString()
      timeSyncWarning = !timedatectl.includes('NTP synchronized: yes')
    } catch {
      // Not on Linux / timedatectl not available — skip
    }

    return ok({ devices: deviceStats, timeSyncWarning })
  } catch (caughtErr) {
    console.error('[berg/status GET]', err)
    return err('Failed to get Berg status', 500)
  }
})
