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
import { getReadinessState } from '@/lib/readiness'
import { APP_VERSION } from '@/lib/version-contract'
import { readFileSync } from 'fs'
import path from 'path'
import { ok } from '@/lib/api-response'
export const dynamic = 'force-dynamic'

// Track server start time for uptime calculation
const startTime = Date.now()

// No auth required — this is a local-only endpoint consumed by the NUC Dashboard
// (Tauri app). The Dashboard makes unauthenticated HTTP requests to localhost:3005.
// The endpoint is not exposed to the internet (NUC firewall blocks external access).
export const GET = withVenue(async function GET(): Promise<NextResponse> {
  const generatedAt = new Date().toISOString()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  // Read version from running-version.json (canonical), falling back to package.json
  let version = APP_VERSION
  try {
    const rv = JSON.parse(readFileSync('/opt/gwi-pos/shared/state/running-version.json', 'utf8'))
    if (rv.version) version = rv.version
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
      version = pkg.version || APP_VERSION
    } catch { /* fallback to build-time version */ }
  }

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
      // eslint-disable-next-line no-restricted-syntax -- dashboard aggregate count not suited for repository pattern
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

  // Venue name for dashboard display
  let venueName = ''
  if (databaseCheck && locationId) {
    try {
      const location = await db.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { name: true },
      })
      venueName = location?.name ?? ''
    } catch {
      // Non-critical
    }
  }

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

  // Sync workers running — read directly from worker metrics (not registry flag, which can go stale
  // when the 5-min schema recheck unblocks sync but the registry flag isn't updated).
  const syncWorkersRunning = (downstreamSync?.running ?? false) && (upstreamSync?.running ?? false)

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

      // eslint-disable-next-line no-restricted-syntax -- dashboard aggregate count not suited for repository pattern
      const openOrderCount = await db.order.count({
        where: {
          deletedAt: null,
          status: { notIn: ['paid', 'closed', 'voided', 'merged'] },
        },
      })

      // eslint-disable-next-line no-restricted-syntax -- dashboard aggregate count not suited for repository pattern
      const unadjustedTipCount = await db.payment.count({
        where: {
          deletedAt: null,
          paymentMethod: { in: ['credit', 'debit'] },
          status: 'completed',
          tipAmount: { lte: 0 },
          ...(lastBatchClosedAt ? { createdAt: { gte: lastBatchClosedAt } } : {}),
        },
      })

      // eslint-disable-next-line no-restricted-syntax -- dashboard aggregate sum not suited for repository pattern
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

  // ── Last update state ─────────────────────────────────────────────────────
  // Priority: deploy-state.json (written by deploy-release.sh) > last-update.json (sync-agent)
  let lastUpdate: {
    attemptedAt: string
    targetVersion: string
    previousVersion: string
    status: string
    error?: string
    durationMs: number
  } | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // Try deploy-state.json first (canonical, written by deploy-release.sh)
    try {
      const dsRaw = fs.readFileSync('/opt/gwi-pos/shared/state/deploy-state.json', 'utf-8')
      const ds = JSON.parse(dsRaw)
      if (ds.releaseId) {
        const rvVersion = (() => { try { return JSON.parse(fs.readFileSync('/opt/gwi-pos/shared/state/running-version.json', 'utf-8')).version } catch { return ds.releaseId } })()
        lastUpdate = {
          attemptedAt: ds.updatedAt ?? '',
          targetVersion: rvVersion,
          previousVersion: ds.previousReleaseId ?? '',
          status: ds.state === 'healthy' ? 'COMPLETED' : ds.state === 'rollback_failed' ? 'RECOVERY_UNKNOWN' : ds.state?.toUpperCase() ?? 'unknown',
          durationMs: 0,
        }
      }
    } catch { /* no deploy-state */ }
    // Overlay with last-update.json if it has a more recent attempt
    try {
      const raw = fs.readFileSync('/opt/gwi-pos/state/last-update.json', 'utf-8')
      const state = JSON.parse(raw)
      if (state.attemptedAt && (!lastUpdate?.attemptedAt || state.attemptedAt > lastUpdate.attemptedAt)) {
        lastUpdate = {
          attemptedAt: state.attemptedAt ?? '',
          targetVersion: state.targetVersion ?? state.version ?? '',
          previousVersion: state.previousVersion ?? '',
          status: state.status ?? 'unknown',
          error: state.error,
          durationMs: state.duration ?? 0,
        }
      }
    } catch { /* no last-update */ }
  } catch {
    // File doesn't exist or parse error — that's fine
  }

  // ── Readiness data ──────────────────────────────────────────────────────────
  // Use LIVE Neon connectivity from sync workers instead of stale bootstrap flag
  const readiness = (() => {
    const rs = getReadinessState()
    if (!rs) return null
    let degradedReasons = rs.degradedReasons
    // If sync workers report Neon is reachable (not in outage), filter out stale neon warnings
    if (!isInOutageMode() && downstreamSync?.running) {
      degradedReasons = degradedReasons.filter(r =>
        r !== 'neon-unreachable' &&
        r !== 'neon-schema-version-incompatible' &&
        r !== 'neon-core-tables-missing' &&
        r !== 'neon-required-enums-missing' &&
        r !== 'base-seed-missing'
      )
    }
    return {
      level: rs.level,
      syncContractReady: rs.syncContractReady,
      initialSyncComplete: rs.initialSyncComplete,
      degradedReasons,
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

  // ── Docker container status (replaces legacy systemd service checks) ────────
  const containers: Array<{
    name: string
    type: 'container' | 'service'
    status: string
    image?: string
    healthy?: boolean
  }> = []

  try {
    const { execSync } = await import('child_process')

    // Check Docker containers
    for (const cname of ['gwi-pos', 'gwi-agent']) {
      try {
        const info = JSON.parse(
          execSync(`docker inspect ${cname} --format='{{json .}}'`, { encoding: 'utf-8', timeout: 5000 }).trim()
        )
        containers.push({
          name: cname,
          type: 'container',
          status: info.State?.Running ? 'running' : info.State?.Status || 'stopped',
          image: info.Config?.Image || 'unknown',
          healthy: info.State?.Health?.Status === 'healthy',
        })
      } catch {
        containers.push({ name: cname, type: 'container', status: 'not found' })
      }
    }

    // Check gwi-node.service
    try {
      const nodeStatus = execSync('systemctl is-active gwi-node.service 2>/dev/null || echo inactive', { encoding: 'utf-8', timeout: 3000 }).trim()
      containers.push({
        name: 'gwi-node',
        type: 'service',
        status: nodeStatus,
      })
    } catch {
      containers.push({ name: 'gwi-node', type: 'service', status: 'unknown' })
    }
  } catch {
    // Docker not available (e.g., running on Vercel)
  }

  // ── Assemble response ───────────────────────────────────────────────────────
  return ok({
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
        venueName,
      },
      readiness,
      connectionPool,
      lastUpdate,
      containers,
    })
})
