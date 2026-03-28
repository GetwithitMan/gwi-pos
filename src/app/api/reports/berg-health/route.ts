import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { execSync } from 'child_process'
import { err, ok } from '@/lib/api-response'

/**
 * GET /api/reports/berg-health
 * Bridge health: per-device stats for uptime, latency, LRC errors, NAK rate.
 * Defaults to last 24h. Supports date range.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return err(auth.error, auth.status)

    const dateRange: { gte?: Date; lte?: Date } = {}
    if (startDate) dateRange.gte = new Date(startDate)
    else dateRange.gte = new Date(Date.now() - 24 * 60 * 60 * 1000) // default 24h
    if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')

    const devices = await db.bergDevice.findMany({
      where: { locationId, isActive: true },
    })

    const deviceStats = await Promise.all(
      devices.map(async (device) => {
        const [total, ackCount, nakCount, badLrc, badPacket, overflow, latencyAgg, dedupedCount, exceededLatencyCount] = await Promise.all([
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'] } } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, status: { in: ['NAK', 'NAK_TIMEOUT'] } } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, parseStatus: 'BAD_LRC' } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, parseStatus: 'BAD_PACKET' } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, parseStatus: 'OVERFLOW' } }),
          db.bergDispenseEvent.aggregate({
            where: { deviceId: device.id, receivedAt: dateRange, ackLatencyMs: { not: null } },
            _avg: { ackLatencyMs: true },
            _max: { ackLatencyMs: true },
          }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, errorReason: 'IDEMPOTENT_DUPLICATE' } }),
          db.bergDispenseEvent.count({ where: { deviceId: device.id, receivedAt: dateRange, ackLatencyMs: { gt: 3000 } } }),
        ])

        const nakRate = total > 0 ? Math.round((nakCount / total) * 100 * 10) / 10 : 0
        const lrcErrorRate = total > 0 ? Math.round((badLrc / total) * 100 * 10) / 10 : 0
        const dedupRate = total > 0 ? Math.round((dedupedCount / total) * 100 * 10) / 10 : 0

        // FIX 8: Compute p95 on filtered set (non-null latency only)
        let p95LatencyMs: number | null = null
        if (total > 0) {
          const latencyRecords = await db.bergDispenseEvent.findMany({
            where: {
              deviceId: device.id,
              receivedAt: dateRange,
              ackLatencyMs: { not: null },
            },
            select: { ackLatencyMs: true },
            orderBy: { ackLatencyMs: 'asc' },
          })
          if (latencyRecords.length > 0) {
            const p95Index = Math.min(
              Math.floor(latencyRecords.length * 0.95),
              latencyRecords.length - 1
            )
            p95LatencyMs = latencyRecords[p95Index]?.ackLatencyMs ?? null
          }
        }

        const alerts: string[] = []
        if (nakRate > 10) alerts.push(`High NAK rate: ${nakRate}%`)
        if (lrcErrorRate > 2) alerts.push(`High LRC error rate: ${lrcErrorRate}%`)
        if (dedupRate > 5) alerts.push(`Possible ECU retry loop — check hardware (${dedupRate}% dedup rate)`)
        const latencyMs = latencyAgg._max.ackLatencyMs ? Number(latencyAgg._max.ackLatencyMs) : 0
        if (latencyMs > 3000) alerts.push(`ACK latency exceeded 3s (max: ${latencyMs}ms)`)

        const minutesSinceLastSeen = device.lastSeenAt
          ? Math.round((Date.now() - device.lastSeenAt.getTime()) / 60000)
          : null

        const { bridgeSecretHash: _, ...deviceData } = device
        return {
          ...deviceData,
          minutesSinceLastSeen,
          stats: {
            total,
            ackCount,
            nakCount,
            badLrc,
            badPacket,
            overflow,
            nakRate,
            lrcErrorRate,
            dedupedCount,
            dedupRate,
            avgAckLatencyMs: latencyAgg._avg.ackLatencyMs ? Math.round(Number(latencyAgg._avg.ackLatencyMs)) : null,
            maxAckLatencyMs: latencyMs || null,
            p95LatencyMs,
            exceededLatencyCount,
          },
          alerts,
        }
      })
    )

    const overallAlerts = deviceStats.flatMap(d => d.alerts.map(a => `[${d.name}] ${a}`))

    // NTP sync check — same logic as /api/berg/status
    let timeSyncWarning = false
    try {
      const timedatectl = execSync('timedatectl status 2>/dev/null', { timeout: 2000 }).toString()
      timeSyncWarning = !timedatectl.includes('NTP synchronized: yes')
    } catch {
      // Not on Linux / timedatectl not available — skip
    }

    return ok({
      period: { start: dateRange.gte, end: dateRange.lte },
      devices: deviceStats,
      overallAlerts,
      timeSyncWarning,
    })
  } catch (caughtErr) {
    console.error('[reports/berg-health]', err)
    return err('Failed to load health report', 500)
  }
})
