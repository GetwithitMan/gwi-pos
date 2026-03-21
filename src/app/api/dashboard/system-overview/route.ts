/**
 * GET /api/dashboard/system-overview
 *
 * Composite endpoint for the NUC Dashboard app. Combines health, batch,
 * sync, and system data into a single call to minimize polling overhead.
 *
 * Unlike /api/health (which redacts version/uptime in production), this
 * endpoint always returns them — the dashboard needs them.
 */

import { NextResponse } from 'next/server'
import { db, getVenueClientCount } from '@/lib/db'
import { CONNECTION_BUDGET } from '@/lib/db-connection-budget'
import { withVenue } from '@/lib/with-venue'
import { getLocalLeaseExpiry } from '@/lib/ha-lease-state'
import { getDownstreamSyncMetrics } from '@/lib/sync/downstream-sync-worker'
import { getUpstreamSyncMetrics, isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { getSchemaVerificationResult, isSchemaVerified } from '@/lib/schema-verify'
import { getWorkerHealth } from '@/lib/worker-registry'
import { getReadinessState } from '@/lib/readiness'

export const dynamic = 'force-dynamic'

// Track server start time for uptime calculation
const startTime = Date.now()

export const GET = withVenue(async function GET(): Promise<NextResponse> {
  const generatedAt = new Date().toISOString()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const version = process.env.npm_package_version || '1.0.0'

  // ── Health data ─────────────────────────────────────────────────────────────
  let databaseStatus: 'connected' | 'disconnected' | 'error' = 'disconnected'
  let databaseCheck = false
  let pgRole: 'primary' | 'standby' | 'unknown' = 'unknown'
  let replicationLag: number | null = null

  try {
    const [recoveryResult] = await db.$queryRaw<[{ pg_is_in_recovery: boolean }]>`SELECT pg_is_in_recovery()`
    databaseStatus = 'connected'
    databaseCheck = true
    pgRole = recoveryResult.pg_is_in_recovery ? 'standby' : 'primary'

    if (pgRole === 'standby') {
      try {
        const [lagResult] = await db.$queryRaw<[{ lag: number | null }]>`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag`
        replicationLag = lagResult.lag != null ? Math.round(lagResult.lag * 100) / 100 : null
      } catch {
        // Non-critical
      }
    }
  } catch (error) {
    databaseStatus = 'error'
    console.error('[dashboard/system-overview] Database check failed:', error)
  }

  // Memory check
  const memoryUsage = process.memoryUsage()
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024)
  const memoryCheck = heapUsedMB < heapTotalMB * 0.9

  // Overall health status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
  if (!databaseCheck) {
    status = 'unhealthy'
  } else if (!memoryCheck) {
    status = 'degraded'
  }

  const schemaState = getSchemaVerificationResult()
  if (schemaState && !schemaState.passed && status === 'healthy') {
    status = 'degraded'
  }

  const readinessState = getReadinessState()
  if (readinessState) {
    if (readinessState.level === 'FAILED' && status !== 'unhealthy') {
      status = 'unhealthy'
    } else if (readinessState.level === 'DEGRADED' && status === 'healthy') {
      status = 'degraded'
    }
  }

  const stationRole = process.env.STATION_ROLE || 'unknown'
  const isPromotedBackup = stationRole === 'backup' && pgRole === 'primary'

  // MC lease
  const leaseExpiry = getLocalLeaseExpiry()
  const now = new Date()
  const holdsMcLease = leaseExpiry !== null && leaseExpiry > now

  // Pending reconciliation
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
  let pendingReconciliation = 0
  if (databaseCheck && locationId) {
    try {
      pendingReconciliation = await db.order.count({
        where: {
          locationId,
          status: { in: ['open', 'sent', 'in_progress'] },
          updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
          deletedAt: null,
        },
      })
    } catch {
      // Non-critical
    }
  }

  // Schema verified flag
  const schemaVerified = isSchemaVerified()

  // Sync workers running
  const syncWorkersRunning = (() => {
    const workers = getWorkerHealth()
    const syncWorkerNames = ['upstreamSync', 'downstreamSync']
    const syncWorkers = workers.filter(w => syncWorkerNames.includes(w.name))
    return syncWorkers.length > 0 && syncWorkers.every(w => w.running)
  })()

  // ── Sync data ───────────────────────────────────────────────────────────────
  let downstreamSync: {
    running: boolean
    lastSyncAt: string | null
    rowsSyncedTotal: number
    conflictCount: number
  } | null = null
  try {
    const dm = getDownstreamSyncMetrics()
    downstreamSync = {
      running: dm.running,
      lastSyncAt: dm.lastSyncAt ? dm.lastSyncAt.toISOString() : null,
      rowsSyncedTotal: dm.rowsSyncedTotal,
      conflictCount: dm.conflictCount,
    }
  } catch {
    // Worker not initialized
  }

  let upstreamSync: {
    running: boolean
    lastSyncAt: string | null
    pendingCount: number
    rowsSyncedTotal: number
    errorCount: number
    inOutage: boolean
  } | null = null
  try {
    const um = getUpstreamSyncMetrics()
    upstreamSync = {
      running: um.running,
      lastSyncAt: um.lastSyncAt ? um.lastSyncAt.toISOString() : null,
      pendingCount: um.pendingCount,
      rowsSyncedTotal: um.rowsSyncedTotal,
      errorCount: um.errorCount,
      inOutage: isInOutageMode(),
    }
  } catch {
    // Worker not initialized
  }

  // ── Batch data ──────────────────────────────────────────────────────────────
  let batch: {
    openOrderCount: number | null
    unadjustedTipCount: number | null
    currentBatchTotal: number | null
    lastBatchClosedAt: string | null
  } = {
    openOrderCount: null,
    unadjustedTipCount: null,
    currentBatchTotal: null,
    lastBatchClosedAt: null,
  }

  if (databaseCheck) {
    try {
      // Read last batch closed time from the file written by datacap batch close
      let lastBatchClosedAt: Date | null = null
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs')
        const raw = fs.readFileSync('/opt/gwi-pos/last-batch.json', 'utf-8')
        const info = JSON.parse(raw)
        if (info.closedAt) {
          lastBatchClosedAt = new Date(info.closedAt)
        }
      } catch {
        // File doesn't exist — that's fine
      }

      const openOrderCount = await db.order.count({
        where: {
          deletedAt: null,
          status: { notIn: ['paid', 'closed', 'voided', 'merged'] },
        },
      })

      const unadjustedTipCount = await db.payment.count({
        where: {
          deletedAt: null,
          paymentMethod: { in: ['credit', 'debit'] },
          status: 'completed',
          tipAmount: { lte: 0 },
          ...(lastBatchClosedAt ? { createdAt: { gte: lastBatchClosedAt } } : {}),
        },
      })

      const batchAgg = await db.payment.aggregate({
        where: {
          deletedAt: null,
          paymentMethod: { in: ['credit', 'debit'] },
          status: 'completed',
          ...(lastBatchClosedAt ? { createdAt: { gte: lastBatchClosedAt } } : {}),
        },
        _sum: { amount: true },
      })

      batch = {
        openOrderCount,
        unadjustedTipCount,
        currentBatchTotal: Number(batchAgg._sum.amount ?? 0),
        lastBatchClosedAt: lastBatchClosedAt?.toISOString() ?? null,
      }
    } catch (e) {
      console.error('[dashboard/system-overview] Batch data failed:', e)
      // Leave batch as nulls — partial data is better than 500
    }
  }

  // ── Readiness data ──────────────────────────────────────────────────────────
  const readiness = (() => {
    const rs = getReadinessState()
    if (!rs) return null
    return {
      level: rs.level,
      syncContractReady: rs.syncContractReady,
      initialSyncComplete: rs.initialSyncComplete,
      degradedReasons: rs.degradedReasons,
    }
  })()

  // ── Connection pool data ────────────────────────────────────────────────────
  let connectionPool: {
    activeConnections: number
    maxConnections: number
    budgetTotal: number
    venueCacheSize: number
    venueCacheMax: number
  } | null = null

  if (databaseCheck && !process.env.VERCEL) {
    try {
      const [poolStats] = await db.$queryRaw<[{ active: bigint; max_conn: number }]>`
        SELECT
          (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid()) AS active,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      `
      connectionPool = {
        activeConnections: Number(poolStats.active),
        maxConnections: poolStats.max_conn,
        budgetTotal: CONNECTION_BUDGET.LOCAL_TOTAL,
        venueCacheSize: getVenueClientCount(),
        venueCacheMax: CONNECTION_BUDGET.VENUE_CACHE_MAX,
      }
    } catch {
      // Non-critical
    }
  }

  // ── Assemble response ───────────────────────────────────────────────────────
  return NextResponse.json({
    data: {
      generatedAt,
      health: {
        status,
        database: databaseStatus,
        pgRole,
        replicationLag,
        checks: {
          database: databaseCheck,
          memory: memoryCheck,
        },
        isPromotedBackup,
        holdsMcLease,
        pendingReconciliation,
        schemaVerified,
        syncWorkersRunning,
      },
      sync: {
        downstream: downstreamSync,
        upstream: upstreamSync,
      },
      batch,
      system: {
        version,
        uptime,
        stationRole,
        nodeEnv: process.env.NODE_ENV || 'development',
      },
      readiness,
      connectionPool,
    },
  })
})
