/**
 * GET /api/notifications/analytics — Notification analytics
 *
 * Query params:
 *   startDate — ISO date string (required)
 *   endDate   — ISO date string (required)
 *   locationId — override (optional, defaults to session location)
 *
 * Returns:
 * - Total jobs processed, success rate, avg latency
 * - Per-provider breakdown: attempts, success %, avg latency, timeout %, fallback %
 * - Per-event-type breakdown: count, success %
 * - Dead-letter rate
 * - Device utilization: assigned %, avg assignment duration, lost count
 *
 * Permission: notifications.view_log
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

export const dynamic = 'force-dynamic'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    // Run all analytics queries in parallel
    const [
      overallRows,
      perProviderRows,
      perEventTypeRows,
      deadLetterRows,
      fallbackRows,
      deviceRows,
      deviceLostRows,
    ] = await Promise.all([
      // Overall: total processed, success count, avg latency
      db.$queryRawUnsafe<[{
        total: bigint
        succeeded: bigint
        avg_latency: number | null
      }]>(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE "terminalResult" = 'delivered' OR "terminalResult" = 'fallback_delivered') as succeeded,
           AVG(a.avg_lat) as avg_latency
         FROM "NotificationJob" j
         LEFT JOIN (
           SELECT "jobId", AVG("latencyMs") as avg_lat
           FROM "NotificationAttempt"
           WHERE "startedAt" >= $2 AND "startedAt" < $3
           GROUP BY "jobId"
         ) a ON a."jobId" = j.id
         WHERE j."locationId" = $1
           AND j."createdAt" >= $2
           AND j."createdAt" < $3
           AND j.status IN ('completed', 'failed', 'dead_letter', 'cancelled', 'suppressed')`,
        locationId, start, end
      ),

      // Per-provider breakdown
      db.$queryRawUnsafe<Array<{
        providerId: string
        providerType: string | null
        total_attempts: bigint
        succeeded: bigint
        avg_latency: number | null
        timed_out: bigint
      }>>(
        `SELECT
           a."providerId",
           MAX(a."providerType") as "providerType",
           COUNT(*) as total_attempts,
           COUNT(*) FILTER (WHERE a.result = 'success') as succeeded,
           AVG(a."latencyMs") as avg_latency,
           COUNT(*) FILTER (WHERE a.result = 'timeout_unknown_delivery') as timed_out
         FROM "NotificationAttempt" a
         JOIN "NotificationJob" j ON j.id = a."jobId"
         WHERE j."locationId" = $1
           AND a."startedAt" >= $2
           AND a."startedAt" < $3
         GROUP BY a."providerId"`,
        locationId, start, end
      ),

      // Per-event-type breakdown
      db.$queryRawUnsafe<Array<{
        eventType: string
        total: bigint
        succeeded: bigint
      }>>(
        `SELECT
           "eventType",
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE "terminalResult" = 'delivered' OR "terminalResult" = 'fallback_delivered') as succeeded
         FROM "NotificationJob"
         WHERE "locationId" = $1
           AND "createdAt" >= $2
           AND "createdAt" < $3
           AND status IN ('completed', 'failed', 'dead_letter', 'cancelled', 'suppressed')
         GROUP BY "eventType"`,
        locationId, start, end
      ),

      // Dead-letter count in period
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1
           AND "createdAt" >= $2
           AND "createdAt" < $3
           AND status = 'dead_letter'`,
        locationId, start, end
      ),

      // Fallback count in period
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1
           AND "createdAt" >= $2
           AND "createdAt" < $3
           AND "terminalResult" = 'fallback_delivered'`,
        locationId, start, end
      ),

      // Device utilization
      db.$queryRawUnsafe<[{
        total_devices: bigint
        assigned: bigint
        avg_duration_sec: number | null
      }]>(
        `SELECT
           COUNT(*) as total_devices,
           COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
           AVG(EXTRACT(EPOCH FROM (COALESCE("releasedAt", NOW()) - "assignedAt")))
             FILTER (WHERE "assignedAt" IS NOT NULL) as avg_duration_sec
         FROM "NotificationDevice"
         WHERE "locationId" = $1 AND "deletedAt" IS NULL`,
        locationId
      ),

      // Lost devices count
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count
         FROM "NotificationDevice"
         WHERE "locationId" = $1 AND status = 'missing' AND "deletedAt" IS NULL`,
        locationId
      ),
    ])

    const totalProcessed = Number(overallRows[0]?.total ?? 0)
    const totalSucceeded = Number(overallRows[0]?.succeeded ?? 0)
    const avgLatencyMs = overallRows[0]?.avg_latency ? Math.round(overallRows[0].avg_latency) : null
    const successRate = totalProcessed > 0 ? Math.round((totalSucceeded / totalProcessed) * 10000) / 100 : 0
    const deadLetterCount = Number(deadLetterRows[0]?.count ?? 0)
    const deadLetterRate = totalProcessed > 0 ? Math.round((deadLetterCount / totalProcessed) * 10000) / 100 : 0
    const fallbackCount = Number(fallbackRows[0]?.count ?? 0)

    const perProvider = perProviderRows.map(r => {
      const total = Number(r.total_attempts)
      const succeeded = Number(r.succeeded)
      const timedOut = Number(r.timed_out)
      return {
        providerId: r.providerId,
        providerType: r.providerType,
        totalAttempts: total,
        successRate: total > 0 ? Math.round((succeeded / total) * 10000) / 100 : 0,
        avgLatencyMs: r.avg_latency ? Math.round(r.avg_latency) : null,
        timeoutRate: total > 0 ? Math.round((timedOut / total) * 10000) / 100 : 0,
      }
    })

    const perEventType = perEventTypeRows.map(r => {
      const total = Number(r.total)
      const succeeded = Number(r.succeeded)
      return {
        eventType: r.eventType,
        count: total,
        successRate: total > 0 ? Math.round((succeeded / total) * 10000) / 100 : 0,
      }
    })

    const totalDevices = Number(deviceRows[0]?.total_devices ?? 0)
    const assignedDevices = Number(deviceRows[0]?.assigned ?? 0)
    const deviceUtilization = {
      totalDevices,
      assignedCount: assignedDevices,
      assignedPercent: totalDevices > 0 ? Math.round((assignedDevices / totalDevices) * 10000) / 100 : 0,
      avgAssignmentDurationSec: deviceRows[0]?.avg_duration_sec ? Math.round(deviceRows[0].avg_duration_sec) : null,
      lostCount: Number(deviceLostRows[0]?.count ?? 0),
    }

    return NextResponse.json({
      data: {
        period: { startDate: start.toISOString(), endDate: end.toISOString() },
        overall: {
          totalProcessed,
          totalSucceeded,
          successRate,
          avgLatencyMs,
          deadLetterCount,
          deadLetterRate,
          fallbackCount,
          fallbackRate: totalProcessed > 0 ? Math.round((fallbackCount / totalProcessed) * 10000) / 100 : 0,
        },
        perProvider,
        perEventType,
        deviceUtilization,
      },
    })
  } catch (error) {
    console.error('[Notification Analytics] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch notification analytics' }, { status: 500 })
  }
})
