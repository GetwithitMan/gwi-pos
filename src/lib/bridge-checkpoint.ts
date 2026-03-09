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

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_ID = process.env.NUC_NODE_ID || 'primary'
const LOCATION_ID = process.env.POS_LOCATION_ID
const LEASE_DURATION = 90_000 // 90s
const HEARTBEAT_INTERVAL = 30_000 // 30s

// ── State ─────────────────────────────────────────────────────────────────────

let checkpointTimer: ReturnType<typeof setInterval> | null = null

// ── Lease Management ──────────────────────────────────────────────────────────

/**
 * Renew this node's lease in the BridgeCheckpoint table.
 * Uses upsert so the first heartbeat creates the row.
 */
async function renewLease(): Promise<void> {
  if (!LOCATION_ID) return

  const role = process.env.NUC_ROLE || 'primary'
  const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION).toISOString()
  const now = new Date().toISOString()

  try {
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "BridgeCheckpoint" ("locationId", "nodeId", role, "leaseExpiresAt", "lastHeartbeat")
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       ON CONFLICT ("locationId", "nodeId")
       DO UPDATE SET
         "leaseExpiresAt" = $4::timestamptz,
         "lastHeartbeat" = $5::timestamptz,
         role = $3`,
      LOCATION_ID,
      NODE_ID,
      role,
      leaseExpiresAt,
      now,
    )
  } catch (err) {
    console.error('[BridgeCheckpoint] Failed to renew lease:', err instanceof Error ? err.message : err)
  }
}

/**
 * Check if this node's lease is currently active.
 */
export async function isLeaseActive(): Promise<boolean> {
  if (!LOCATION_ID) return false

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
    console.log('[BridgeCheckpoint] No POS_LOCATION_ID — checkpoint disabled')
    return
  }

  // Renew immediately on start
  void renewLease().catch(console.error)

  checkpointTimer = setInterval(() => {
    void renewLease().catch(console.error)
  }, HEARTBEAT_INTERVAL)
  checkpointTimer.unref()

  console.log(`[BridgeCheckpoint] Started (node: ${NODE_ID}, lease: ${LEASE_DURATION}ms, heartbeat: ${HEARTBEAT_INTERVAL}ms)`)
}

export function stopBridgeCheckpoint(): void {
  if (checkpointTimer) {
    clearInterval(checkpointTimer)
    checkpointTimer = null
    console.log('[BridgeCheckpoint] Stopped')
  }
}
