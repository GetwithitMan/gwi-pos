/**
 * Health Check API
 *
 * Used by Docker healthcheck and monitoring systems to verify
 * the application is running and database is connected.
 *
 * GET /api/health
 */

import { NextResponse } from 'next/server'
import { db, getVenueClientCount } from '@/lib/db'
import { CONNECTION_BUDGET } from '@/lib/db-connection-budget'
import { withVenue } from '@/lib/with-venue'
import { dispatchFailoverActive, dispatchFailoverResolved } from '@/lib/socket-dispatch'
import { getLocalLeaseExpiry } from '@/lib/ha-lease-state'
import { getDownstreamSyncMetrics } from '@/lib/sync/downstream-sync-worker'
import { getUpstreamSyncMetrics, isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { getUpdateAgentStatus } from '@/lib/update-agent'
import { getSchemaVerificationResult, isSchemaVerified } from '@/lib/schema-verify'
import { getReadinessState, type ReadinessLevel } from '@/lib/readiness'
import { APP_VERSION } from '@/lib/version-contract'

export const dynamic = 'force-dynamic'

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded'
  timestamp: string
  version: string
  uptime: number
  database: 'connected' | 'disconnected' | 'error'
  checks: {
    database: boolean
    memory: boolean
  }
  pgRole: 'primary' | 'standby' | 'unknown'
  stationRole: string
  virtualIp: string | null
  replicationLag: number | null
  isVipOwner: boolean | null
  /** True when this node is a backup that has been promoted to primary */
  isPromotedBackup: boolean
  /** ISO timestamp when the MC primary lease expires (null if no lease held or not primary) */
  primaryLeaseExpiry: string | null
  /** Whether this node currently holds a valid MC primary lease */
  holdsMcLease: boolean
  /** Count of stale open orders that may have orphaned offline payments */
  pendingReconciliation: number
  /** Downstream sync metrics (Neon → NUC). Null if worker not initialized. */
  downstreamSync: {
    running: boolean
    lastSyncAt: string | null
    rowsSyncedTotal: number
    conflictCount: number
  } | null
  /** Upstream sync metrics (NUC → Neon). Null if worker not initialized. */
  upstreamSync: {
    running: boolean
    lastSyncAt: string | null
    pendingCount: number
    rowsSyncedTotal: number
    errorCount: number
    inOutage: boolean
  } | null
  /** Update agent status */
  updateAgent: {
    currentVersion: string
    isUpdating: boolean
    lockFileExists: boolean
  }
  /** Schema verification result from startup. Null if verification hasn't run yet. */
  schemaVerification: {
    passed: boolean
    missing: Array<{ table: string; column?: string }>
    checked: number
    error?: string
  } | null
  /** True when schema verification has run AND passed. False otherwise. */
  schemaVerified: boolean
  /** Whether sync workers (upstream/downstream) are registered and running. */
  syncWorkersRunning: boolean
  /** Canonical readiness state — ONE source of truth for venue readiness. */
  readiness: {
    level: ReadinessLevel
    syncContractReady: boolean
    initialSyncComplete: boolean
    degradedReasons: string[]
  } | null
  /** Connection pool utilization (NUC only, null on Vercel) */
  connectionPool: {
    /** Active connections from this application (from pg_stat_activity) */
    activeConnections: number
    /** PG max_connections setting */
    maxConnections: number
    /** Budget allocated to this process (sum of all pools) */
    budgetTotal: number
    /** Number of cached venue PrismaClients */
    venueCacheSize: number
    /** Max venue cache capacity */
    venueCacheMax: number
  } | null
  error?: string
}

// Track server start time for uptime
const startTime = Date.now()

/** Track failover state to emit socket events on transitions */
let lastKnownPromotedBackup = false
let failoverSince: string | null = null

export const GET = withVenue(async function GET(): Promise<NextResponse<{ data: HealthResponse }>> {
  const timestamp = new Date().toISOString()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const version = APP_VERSION

  // Check database connection + PG recovery state
  let databaseStatus: HealthResponse['database'] = 'disconnected'
  let databaseCheck = false
  let pgRole: HealthResponse['pgRole'] = 'unknown'
  let replicationLag: number | null = null

  try {
    // Verify database is accessible and check recovery state
    const [recoveryResult] = await db.$queryRaw<[{ pg_is_in_recovery: boolean }]>`SELECT pg_is_in_recovery()`
    databaseStatus = 'connected'
    databaseCheck = true
    pgRole = recoveryResult.pg_is_in_recovery ? 'standby' : 'primary'

    // On standby, measure replication lag
    if (pgRole === 'standby') {
      try {
        const [lagResult] = await db.$queryRaw<[{ lag: number | null }]>`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag`
        replicationLag = lagResult.lag != null ? Math.round(lagResult.lag * 100) / 100 : null
      } catch {
        // Non-critical — lag unavailable
      }
    }
  } catch (error) {
    databaseStatus = 'error'
    console.error('[Health] Database check failed:', error)
  }

  // Check memory usage
  const memoryUsage = process.memoryUsage()
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024)
  const memoryCheck = heapUsedMB < heapTotalMB * 0.9 // Less than 90% heap used

  // Determine overall status
  let status: HealthResponse['status'] = 'healthy'

  if (!databaseCheck) {
    status = 'unhealthy'
  } else if (!memoryCheck) {
    status = 'degraded'
  }

  // Schema verification failure degrades health — sync workers won't be running
  const schemaState = getSchemaVerificationResult()
  if (schemaState && !schemaState.passed && status === 'healthy') {
    status = 'degraded'
  }

  // Canonical readiness: FAILED → unhealthy, DEGRADED → degraded
  const readinessState = getReadinessState()
  if (readinessState) {
    if (readinessState.level === 'FAILED' && status !== 'unhealthy') {
      status = 'unhealthy'
    } else if (readinessState.level === 'DEGRADED' && status === 'healthy') {
      status = 'degraded'
    }
  }

  const stationRole = process.env.STATION_ROLE || 'unknown'
  const virtualIp = process.env.VIRTUAL_IP || null

  // Detect promoted backup: STATION_ROLE is 'backup' but PG is running as primary
  // This happens after promote.sh runs on the backup node
  const isPromotedBackup = stationRole === 'backup' && pgRole === 'primary'

  // Emit socket events on failover state transitions
  // We need a locationId — try to extract from DB or env
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
  if (locationId) {
    if (isPromotedBackup && !lastKnownPromotedBackup) {
      // Transition: normal -> promoted backup
      failoverSince = timestamp
      void dispatchFailoverActive(locationId, {
        message: 'Backup server active',
        since: failoverSince,
      }).catch(console.error)
      console.warn('[Health] Failover detected — backup promoted to primary. Emitting server:failover-active.')
    } else if (!isPromotedBackup && lastKnownPromotedBackup) {
      // Transition: promoted backup -> back to normal (primary restored)
      failoverSince = null
      void dispatchFailoverResolved(locationId).catch(console.error)
      console.info('[Health] Failover resolved — original primary restored. Emitting server:failover-resolved.')
    }
  }
  lastKnownPromotedBackup = isPromotedBackup

  // MC primary lease status
  const leaseExpiry = getLocalLeaseExpiry()
  const now = new Date()
  const holdsMcLease = leaseExpiry !== null && leaseExpiry > now
  const primaryLeaseExpiry = leaseExpiry ? leaseExpiry.toISOString() : null

  // Count stale open orders that may have orphaned offline payments
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
      // Non-critical — don't fail health check for this
    }
  }

  // Collect sync worker metrics (safe — returns null if workers aren't initialized)
  let downstreamSync: HealthResponse['downstreamSync'] = null
  try {
    const dm = getDownstreamSyncMetrics()
    downstreamSync = {
      running: dm.running,
      lastSyncAt: dm.lastSyncAt ? dm.lastSyncAt.toISOString() : null,
      rowsSyncedTotal: dm.rowsSyncedTotal,
      conflictCount: dm.conflictCount,
    }
  } catch {
    // Worker not initialized — leave null
  }

  let upstreamSync: HealthResponse['upstreamSync'] = null
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
    // Worker not initialized — leave null
  }

  // Connection pool utilization — query pg_stat_activity for live connection counts.
  // Only meaningful on NUC (long-running process); skip on Vercel (1-conn ephemeral).
  let connectionPool: HealthResponse['connectionPool'] = null
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
      // Non-critical — pool stats unavailable
    }
  }

  const response: HealthResponse = {
    status,
    timestamp,
    // Omit version and uptime in production to avoid leaking server info
    version: process.env.NODE_ENV === 'production' ? 'ok' : version,
    uptime: process.env.NODE_ENV === 'production' ? 0 : uptime,
    database: databaseStatus,
    checks: {
      database: databaseCheck,
      memory: memoryCheck,
    },
    pgRole,
    stationRole,
    virtualIp,
    replicationLag,
    isVipOwner: virtualIp ? stationRole === 'server' : null,
    isPromotedBackup,
    primaryLeaseExpiry,
    holdsMcLease,
    pendingReconciliation,
    downstreamSync,
    upstreamSync,
    updateAgent: getUpdateAgentStatus(),
    schemaVerification: getSchemaVerificationResult(),
    schemaVerified: isSchemaVerified(),
    syncWorkersRunning: (() => {
      // Read running state directly from worker metrics (not registry flag, which can go stale
      // when the 5-min schema recheck unblocks sync but the registry flag isn't updated).
      const ds = downstreamSync
      const us = upstreamSync
      return (ds?.running ?? false) && (us?.running ?? false)
    })(),
    readiness: (() => {
      const rs = getReadinessState()
      if (!rs) return null
      return {
        level: rs.level,
        syncContractReady: rs.syncContractReady,
        initialSyncComplete: rs.initialSyncComplete,
        degradedReasons: rs.degradedReasons,
      }
    })(),
    connectionPool,
  }

  // Return appropriate HTTP status
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503

  return NextResponse.json({ data: response }, { status: httpStatus })
})
