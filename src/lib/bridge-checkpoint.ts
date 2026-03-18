/**
 * Bridge Checkpoint — Lease-Based Failover Coordination
 *
 * Each NUC node (primary or backup) periodically renews a lease in the
 * BridgeCheckpoint table. When a node's lease expires (missed heartbeats),
 * the other node can claim the bridge role and begin processing
 * FulfillmentEvents.
 *
 * This prevents split-brain hardware dispatch: only the node holding an
 * active lease should run the FulfillmentBridge worker.
 *
 * Lease timing:
 * - Heartbeat interval: 30s
 * - Lease duration: 90s (3 missed heartbeats = expired)
 *
 * Only runs when SYNC_ENABLED=true (NUC mode).
 */

import { masterClient } from './db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('bridge-checkpoint')

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_ID = process.env.NUC_NODE_ID || 'primary'
const LOCATION_ID = process.env.POS_LOCATION_ID
const LEASE_DURATION = 90_000 // 90s
const HEARTBEAT_INTERVAL = 30_000 // 30s

// ── State ─────────────────────────────────────────────────────────────────────

let checkpointTimer: ReturnType<typeof setInterval> | null = null

/** Whether the BridgeCheckpoint table exists (cached after first check to avoid log spam) */
let _bridgeTableExists: boolean | null = null

// ── Lease Management ──────────────────────────────────────────────────────────

/**
 * Renew this node's lease in the BridgeCheckpoint table.
 * Uses upsert so the first heartbeat creates the row.
 */
async function renewLease(): Promise<void> {
  if (!LOCATION_ID) return

  // Check table existence once — avoids "relation does not exist" error spam
  // every 30s on NUCs where migration 045 hasn't run yet.
  if (_bridgeTableExists === null) {
    try {
      const result = await masterClient.$queryRawUnsafe<Array<{ exists: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'BridgeCheckpoint') as exists`
      )
      _bridgeTableExists = result[0]?.exists ?? false
      if (!_bridgeTableExists) {
        log.warn('Table does not exist — lease management disabled until migration runs')
      }
    } catch {
      _bridgeTableExists = false
    }
  }
  if (!_bridgeTableExists) return

  const role = process.env.NUC_ROLE || 'primary'
  const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION).toISOString()
  const now = new Date().toISOString()

  try {
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "BridgeCheckpoint" ("id", "locationId", "nodeId", role, "leaseExpiresAt", "lastHeartbeat", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::timestamptz, $5::timestamptz, $5::timestamptz)
       ON CONFLICT ("locationId", "nodeId")
       DO UPDATE SET
         "leaseExpiresAt" = $4::timestamptz,
         "lastHeartbeat" = $5::timestamptz,
         "updatedAt" = $5::timestamptz,
         role = $3`,
      LOCATION_ID,
      NODE_ID,
      role,
      leaseExpiresAt,
      now,
    )

    // NTP drift detection: compare Node.js Date.now() against DB NOW()
    // If drift exceeds 5s, lease expiry calculations and sync HWMs are unreliable
    const [dbTimeRow] = await masterClient.$queryRawUnsafe<[{ now: Date }]>(
      `SELECT NOW() as now`
    )
    if (dbTimeRow) {
      const dbNow = dbTimeRow.now instanceof Date ? dbTimeRow.now.getTime() : new Date(dbTimeRow.now as unknown as string).getTime()
      const drift = Math.abs(Date.now() - dbNow)
      if (drift > 5000) {
        log.warn({ driftMs: drift }, 'NTP drift detected between Node.js and PostgreSQL — lease expiry and sync timestamps may be unreliable')
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to renew lease')
  }
}

/**
 * Check if this node's lease is currently active.
 */
export async function isLeaseActive(): Promise<boolean> {
  if (!LOCATION_ID) return false
  if (_bridgeTableExists === false) return false

  try {
    const rows = await masterClient.$queryRawUnsafe<Array<{ leaseExpiresAt: Date }>>(
      `SELECT "leaseExpiresAt" FROM "BridgeCheckpoint"
       WHERE "locationId" = $1 AND "nodeId" = $2
       LIMIT 1`,
      LOCATION_ID,
      NODE_ID,
    )

    if (rows.length === 0) return false

    const expiresAt = rows[0].leaseExpiresAt instanceof Date
      ? rows[0].leaseExpiresAt
      : new Date(rows[0].leaseExpiresAt as unknown as string)

    return expiresAt > new Date()
  } catch {
    return false
  }
}

/**
 * Check if this node should claim the bridge role.
 * Returns true if no other node has an active lease for this location.
 */
export async function shouldClaimBridge(): Promise<boolean> {
  if (!LOCATION_ID) return false
  if (_bridgeTableExists === false) return false

  try {
    const activeLeases = await masterClient.$queryRawUnsafe<Array<{ nodeId: string }>>(
      `SELECT "nodeId" FROM "BridgeCheckpoint"
       WHERE "locationId" = $1
         AND "nodeId" != $2
         AND "leaseExpiresAt" > NOW()`,
      LOCATION_ID,
      NODE_ID,
    )

    // If no other node has an active lease, this node should claim
    return activeLeases.length === 0
  } catch {
    // On error, be conservative — don't claim
    return false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startBridgeCheckpoint(): void {
  if (checkpointTimer) return
  if (!LOCATION_ID) {
    log.info('No POS_LOCATION_ID — checkpoint disabled')
    return
  }

  // Renew immediately on start
  void renewLease().catch((err) => log.error({ err }, 'initial lease renewal failed'))

  checkpointTimer = setInterval(() => {
    void renewLease().catch((err) => log.error({ err }, 'lease renewal failed'))
  }, HEARTBEAT_INTERVAL)
  checkpointTimer.unref()

  log.info({ nodeId: NODE_ID, leaseDurationMs: LEASE_DURATION, heartbeatIntervalMs: HEARTBEAT_INTERVAL }, 'Started')
}

export async function stopBridgeCheckpoint(): Promise<void> {
  if (checkpointTimer) {
    clearInterval(checkpointTimer)
    checkpointTimer = null
  }

  // Gracefully release the lease so backup can claim immediately
  // instead of waiting 90s for the lease to expire
  if (LOCATION_ID) {
    try {
      await masterClient.$executeRawUnsafe(
        `UPDATE "BridgeCheckpoint"
         SET "leaseExpiresAt" = NOW()
         WHERE "locationId" = $1 AND "nodeId" = $2`,
        LOCATION_ID,
        NODE_ID,
      )
      log.info('Stopped (lease released)')
    } catch (err) {
      // Best-effort — if DB is unreachable, the lease will expire naturally in 90s
      log.warn({ err }, 'Stopped (lease release failed, will expire in ≤90s)')
    }
  } else {
    log.info('Stopped')
  }
}
