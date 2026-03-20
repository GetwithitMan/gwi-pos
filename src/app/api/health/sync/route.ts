/**
 * Sync Health API — Comprehensive Fleet Observability Endpoint
 *
 * Returns a detailed sync health report for MC consumption.
 * Covers upstream, downstream, outage queue, schema state,
 * reconciliation drift, and readiness level.
 *
 * GET /api/health/sync
 */

import { NextResponse } from 'next/server'
import { getUpstreamSyncMetrics, isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { getDownstreamSyncMetrics } from '@/lib/sync/downstream-sync-worker'
import { getOutageReplayMetrics } from '@/lib/sync/outage-replay-worker'
import { getSchemaVerificationResult } from '@/lib/schema-verify'
import { getBootstrapResult } from '@/lib/venue-bootstrap'
import { getReconciliationResult } from '@/lib/sync/reconciliation-check'
import { masterClient } from '@/lib/db'
import { EXPECTED_SCHEMA_VERSION } from '@/lib/version-contract'

export const dynamic = 'force-dynamic'

type ReadinessLevel = 'BOOT' | 'SYNC' | 'ORDERS' | 'DEGRADED'
type SchemaStatus = 'match' | 'ahead' | 'behind' | 'unknown'

interface SyncHealthResponse {
  venueId: string
  readiness: ReadinessLevel
  upstream: {
    lastSyncAt: string | null
    rowsSynced: number
    pendingCount: number
    errorCount: number
    outageMode: boolean
  }
  downstream: {
    lastSyncAt: string | null
    rowsSynced: number
    errorCount: number
    tableCount: number
  }
  outageQueue: {
    depth: number
    oldestEntryAge: number | null
    deadLetterCount: number
  }
  schema: {
    local: string
    neon: string | null
    status: SchemaStatus
  }
  reconciliation: {
    lastCheckAt: string | null
    modelsChecked: number
    driftedModels: Array<{
      model: string
      localCount: number
      neonCount: number
      diffPercent: number
      direction: 'local_ahead' | 'neon_ahead'
    }>
    error: string | null
  } | null
  timestamp: string
}

/**
 * Derive a readiness level from the current system state.
 *
 * BOOT     — system is starting, sync workers not yet running
 * SYNC     — sync workers running, but no orders synced yet (initial catch-up)
 * ORDERS   — fully operational, orders flowing
 * DEGRADED — sync errors, outage mode, schema mismatch, or drift detected
 */
function deriveReadiness(
  upstreamRunning: boolean,
  downstreamRunning: boolean,
  upstreamLastSync: Date | null,
  downstreamLastSync: Date | null,
  outageMode: boolean,
  errorCount: number,
  schemaStatus: SchemaStatus,
  driftCount: number,
): ReadinessLevel {
  // Schema behind is always degraded — sync may produce corrupt data
  if (schemaStatus === 'behind') return 'DEGRADED'

  // Outage mode is degraded — Neon unreachable
  if (outageMode) return 'DEGRADED'

  // High error count (>50 cumulative) is degraded
  if (errorCount > 50) return 'DEGRADED'

  // Significant drift is degraded
  if (driftCount > 3) return 'DEGRADED'

  // Neither worker running — still booting
  if (!upstreamRunning && !downstreamRunning) return 'BOOT'

  // Workers running but no sync has completed yet — initial sync phase
  if (!upstreamLastSync && !downstreamLastSync) return 'SYNC'

  // At least one direction has synced — operational
  return 'ORDERS'
}

export async function GET() {
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''

  // ── Upstream metrics ────────────────────────────────────────────────────
  let upstreamRunning = false
  let upstreamLastSync: Date | null = null
  let upstreamPending = 0
  let upstreamRowsSynced = 0
  let upstreamErrors = 0
  let outageMode = false

  try {
    const um = getUpstreamSyncMetrics()
    upstreamRunning = um.running
    upstreamLastSync = um.lastSyncAt
    upstreamPending = um.pendingCount
    upstreamRowsSynced = um.rowsSyncedTotal
    upstreamErrors = um.errorCount
    outageMode = isInOutageMode()
  } catch {
    // Worker not initialized
  }

  // ── Downstream metrics ──────────────────────────────────────────────────
  let downstreamRunning = false
  let downstreamLastSync: Date | null = null
  let downstreamRowsSynced = 0
  let downstreamConflicts = 0
  let downstreamTableCount = 0

  try {
    const dm = getDownstreamSyncMetrics()
    downstreamRunning = dm.running
    downstreamLastSync = dm.lastSyncAt
    downstreamRowsSynced = dm.rowsSyncedTotal
    downstreamConflicts = dm.conflictCount
  } catch {
    // Worker not initialized
  }

  // Count downstream tables from sync config (static, no DB query needed)
  try {
    const { getDownstreamModels } = await import('@/lib/sync/sync-config')
    downstreamTableCount = getDownstreamModels().length
  } catch {
    // sync-config not available
  }

  // ── Outage queue metrics ────────────────────────────────────────────────
  let queueDepth = 0
  let oldestEntryAge: number | null = null
  let deadLetterCount = 0

  try {
    const [depthResult] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "OutageQueueEntry" WHERE status = 'pending'`
    )
    queueDepth = Number(depthResult.count)

    if (queueDepth > 0) {
      const [oldestResult] = await masterClient.$queryRawUnsafe<[{ age_seconds: number }]>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MIN("createdAt")))::int as age_seconds FROM "OutageQueueEntry" WHERE status = 'pending'`
      )
      oldestEntryAge = oldestResult.age_seconds
    }

    const [dlResult] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "OutageQueueEntry" WHERE status = 'dead_letter'`
    )
    deadLetterCount = Number(dlResult.count)
  } catch {
    // OutageQueueEntry table may not exist
  }

  // ── Schema state ────────────────────────────────────────────────────────
  let neonSchemaVersion: string | null = null
  let schemaStatus: SchemaStatus = 'unknown'
  const localSchemaVersion = EXPECTED_SCHEMA_VERSION

  try {
    const bootstrap = getBootstrapResult()
    const nr = bootstrap?.neonSchemaReady
    if (nr) {
      neonSchemaVersion = nr.schemaVersion
      if (nr.schemaVersionMatch) schemaStatus = 'match'
      else if (nr.schemaVersionAhead) schemaStatus = 'ahead'
      else if (nr.schemaVersionBehind) schemaStatus = 'behind'
    }
  } catch {
    // Bootstrap not available
  }

  // If bootstrap didn't give us schema status, check schema verification result
  if (schemaStatus === 'unknown') {
    const sv = getSchemaVerificationResult()
    if (sv && sv.passed) {
      schemaStatus = 'match' // Verification passed, assume match
    }
  }

  // ── Reconciliation ──────────────────────────────────────────────────────
  const reconResult = getReconciliationResult()
  const reconciliation = reconResult
    ? {
        lastCheckAt: reconResult.checkedAt.toISOString(),
        modelsChecked: reconResult.modelsChecked,
        driftedModels: reconResult.driftedModels,
        error: reconResult.error,
      }
    : null

  // ── Outage replay metrics ───────────────────────────────────────────────
  let outageReplayedCount = 0
  let outageConflictCount = 0
  let outageFailedCount = 0

  try {
    const om = getOutageReplayMetrics()
    outageReplayedCount = om.replayedCount
    outageConflictCount = om.conflictCount
    outageFailedCount = om.failedCount
  } catch {
    // Worker not initialized
  }

  // ── Derive readiness ───────────────────────────────────────────────────
  const totalErrors = upstreamErrors + downstreamConflicts + outageFailedCount
  const driftCount = reconResult?.driftedModels.length ?? 0

  const readiness = deriveReadiness(
    upstreamRunning,
    downstreamRunning,
    upstreamLastSync,
    downstreamLastSync,
    outageMode,
    totalErrors,
    schemaStatus,
    driftCount,
  )

  const response: SyncHealthResponse = {
    venueId: locationId,
    readiness,
    upstream: {
      lastSyncAt: upstreamLastSync?.toISOString() ?? null,
      rowsSynced: upstreamRowsSynced,
      pendingCount: upstreamPending,
      errorCount: upstreamErrors,
      outageMode,
    },
    downstream: {
      lastSyncAt: downstreamLastSync?.toISOString() ?? null,
      rowsSynced: downstreamRowsSynced,
      errorCount: downstreamConflicts,
      tableCount: downstreamTableCount,
    },
    outageQueue: {
      depth: queueDepth,
      oldestEntryAge,
      deadLetterCount,
    },
    schema: {
      local: localSchemaVersion,
      neon: neonSchemaVersion,
      status: schemaStatus,
    },
    reconciliation,
    timestamp: new Date().toISOString(),
  }

  // HTTP status: 200 for ORDERS/SYNC, 503 for BOOT, 200 for DEGRADED (data still valid)
  const httpStatus = readiness === 'BOOT' ? 503 : 200

  return NextResponse.json({ data: response }, { status: httpStatus })
}
