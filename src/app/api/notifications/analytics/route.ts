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

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return err(auth.error, auth.status)

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return err('startDate and endDate are required')
    }

    const start = new Date(startDate)
    const end = new Date(endDate)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return err('Invalid date format')
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
      db.$queryRaw<[{
        total: bigint
        succeeded: bigint
        avg_latency: number | null
      }]>`SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE "terminalResult" = 'delivered' OR "terminalResult" = 'fallback_delivered') as succeeded,
           AVG(a.avg_lat) as avg_latency
         FROM "NotificationJob" j
         LEFT JOIN (
           SELECT "jobId", AVG("latencyMs") as avg_lat
           FROM "NotificationAttempt"
           WHERE "startedAt" >= ${start} AND "startedAt" < ${end}
           GROUP BY "jobId"
         ) a ON a."jobId" = j.id
         WHERE j."locationId" = ${locationId}
           AND j."createdAt" >= ${start}
           AND j."createdAt" < ${end}
           AND j.status IN ('completed', 'failed', 'dead_letter', 'cancelled', 'suppressed')`,

      // Per-provider breakdown
      db.$queryRaw<Array<{
        providerId: string
        providerType: string | null
        total_attempts: bigint
        succeeded: bigint
        avg_latency: number | null
        timed_out: bigint
      }>>`SELECT
           a."providerId",
           MAX(a."providerType") as "providerType",
           COUNT(*) as total_attempts,
           COUNT(*) FILTER (WHERE a.result = 'success') as succeeded,
           AVG(a."latencyMs") as avg_latency,
           COUNT(*) FILTER (WHERE a.result = 'timeout_unknown_delivery') as timed_out
         FROM "NotificationAttempt" a
         JOIN "NotificationJob" j ON j.id = a."jobId"
         WHERE j."locationId" = ${locationId}
           AND a."startedAt" >= ${start}
           AND a."startedAt" < ${end}
         GROUP BY a."providerId"`,

      // Per-event-type breakdown
      db.$queryRaw<Array<{
        eventType: string
        total: bigint
        succeeded: bigint
      }>>`SELECT
           "eventType",
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE "terminalResult" = 'delivered' OR "terminalResult" = 'fallback_delivered') as succeeded
         FROM "NotificationJob"
         WHERE "locationId" = ${locationId}
           AND "createdAt" >= ${start}
           AND "createdAt" < ${end}
           AND status IN ('completed', 'failed', 'dead_letter', 'cancelled', 'suppressed')
         GROUP BY "eventType"`,

      // Dead-letter count in period
      db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = ${locationId}
           AND "createdAt" >= ${start}
           AND "createdAt" < ${end}
           AND status = 'dead_letter'`,

      // Fallback count in period
      db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = ${locationId}
           AND "createdAt" >= ${start}
           AND "createdAt" < ${end}
           AND "terminalResult" = 'fallback_delivered'`,

      // Device utilization
      db.$queryRaw<[{
        total_devices: bigint
        assigned: bigint
        avg_duration_sec: number | null
      }]>`SELECT
           COUNT(*) as total_devices,
           COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
           AVG(EXTRACT(EPOCH FROM (COALESCE("releasedAt", NOW()) - "assignedAt")))
             FILTER (WHERE "assignedAt" IS NOT NULL) as avg_duration_sec
         FROM "NotificationDevice"
         WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL`,

      // Lost devices count
      db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count
         FROM "NotificationDevice"
         WHERE "locationId" = ${locationId} AND status = 'missing' AND "deletedAt" IS NULL`,
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

    return ok({
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
      })
  } catch (error) {
    console.error('[Notification Analytics] GET error:', error)
    return err('Failed to fetch notification analytics', 500)
  }
})
