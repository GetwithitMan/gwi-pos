/**
 * GET /api/notifications/health — Queue depth + health monitoring
 *
 * Returns current notification subsystem status:
 * - Pending job count (by provider, by event type)
 * - Dead-letter count
 * - Per-provider health status (healthy/degraded/circuit_open)
 * - Per-provider consecutive failures
 * - Worker last heartbeat (if trackable)
 * - Overall notification subsystem health
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

interface ProviderHealthEntry {
  providerId: string
  providerName: string
  providerType: string
  healthStatus: string
  consecutiveFailures: number
  circuitBreakerOpenUntil: string | null
  lastHealthCheckAt: string | null
  isActive: boolean
}

interface PendingByProvider {
  providerId: string
  count: number
}

interface PendingByEventType {
  eventType: string
  count: number
}

type SubsystemHealth = 'healthy' | 'degraded' | 'down'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Gather all metrics in parallel
    const [
      pendingByProviderRows,
      pendingByEventTypeRows,
      deadLetterCountRows,
      totalPendingRows,
      providerRows,
      workerHeartbeatRows,
    ] = await Promise.all([
      // Pending jobs by provider
      db.$queryRawUnsafe<Array<{ providerId: string; count: bigint }>>(
        `SELECT "providerId", COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1 AND status IN ('pending', 'claimed', 'processing', 'waiting_retry')
         GROUP BY "providerId"`,
        locationId
      ),
      // Pending jobs by event type
      db.$queryRawUnsafe<Array<{ eventType: string; count: bigint }>>(
        `SELECT "eventType", COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1 AND status IN ('pending', 'claimed', 'processing', 'waiting_retry')
         GROUP BY "eventType"`,
        locationId
      ),
      // Dead-letter count
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1 AND status = 'dead_letter'`,
        locationId
      ),
      // Total pending
      db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count
         FROM "NotificationJob"
         WHERE "locationId" = $1 AND status IN ('pending', 'claimed', 'processing', 'waiting_retry')`,
        locationId
      ),
      // Provider health
      db.$queryRawUnsafe<Array<{
        id: string
        name: string
        providerType: string
        healthStatus: string
        consecutiveFailures: number
        circuitBreakerOpenUntil: Date | null
        lastHealthCheckAt: Date | null
        isActive: boolean
      }>>(
        `SELECT id, name, "providerType", "healthStatus", "consecutiveFailures",
                "circuitBreakerOpenUntil", "lastHealthCheckAt", "isActive"
         FROM "NotificationProvider"
         WHERE "locationId" = $1 AND "deletedAt" IS NULL`,
        locationId
      ),
      // Worker last heartbeat — approximate via most recent job claim
      db.$queryRawUnsafe<Array<{ claimedByWorkerId: string; lastClaim: Date }>>(
        `SELECT "claimedByWorkerId", MAX("claimedAt") as "lastClaim"
         FROM "NotificationJob"
         WHERE "locationId" = $1 AND "claimedByWorkerId" IS NOT NULL AND "claimedAt" IS NOT NULL
         GROUP BY "claimedByWorkerId"
         ORDER BY "lastClaim" DESC
         LIMIT 5`,
        locationId
      ),
    ])

    const totalPending = Number(totalPendingRows[0]?.count ?? 0)
    const deadLetterCount = Number(deadLetterCountRows[0]?.count ?? 0)

    const pendingByProvider: PendingByProvider[] = pendingByProviderRows.map(r => ({
      providerId: r.providerId,
      count: Number(r.count),
    }))

    const pendingByEventType: PendingByEventType[] = pendingByEventTypeRows.map(r => ({
      eventType: r.eventType,
      count: Number(r.count),
    }))

    const providers: ProviderHealthEntry[] = providerRows.map(p => ({
      providerId: p.id,
      providerName: p.name,
      providerType: p.providerType,
      healthStatus: p.healthStatus,
      consecutiveFailures: p.consecutiveFailures,
      circuitBreakerOpenUntil: p.circuitBreakerOpenUntil?.toISOString() ?? null,
      lastHealthCheckAt: p.lastHealthCheckAt?.toISOString() ?? null,
      isActive: p.isActive,
    }))

    const workerHeartbeats = workerHeartbeatRows.map(w => ({
      workerId: w.claimedByWorkerId,
      lastHeartbeat: w.lastClaim?.toISOString() ?? null,
    }))

    // Determine overall health
    const activeProviders = providers.filter(p => p.isActive)
    const healthyProviders = activeProviders.filter(p => p.healthStatus === 'healthy')
    const circuitOpenProviders = activeProviders.filter(p => {
      if (!p.circuitBreakerOpenUntil) return false
      return new Date(p.circuitBreakerOpenUntil) > new Date()
    })

    let overallHealth: SubsystemHealth = 'healthy'
    if (activeProviders.length === 0 || circuitOpenProviders.length === activeProviders.length) {
      overallHealth = 'down'
    } else if (totalPending > 100 || deadLetterCount > 10) {
      overallHealth = 'degraded'
    } else if (healthyProviders.length < activeProviders.length) {
      overallHealth = 'degraded'
    }

    return NextResponse.json({
      data: {
        overallHealth,
        totalPending,
        deadLetterCount,
        pendingByProvider,
        pendingByEventType,
        providers,
        workerHeartbeats,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[Notification Health] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch notification health' }, { status: 500 })
  }
})
