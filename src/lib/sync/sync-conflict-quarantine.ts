/**
 * Money/Order Conflict Quarantine (v1)
 *
 * Detects conflicts on bidirectional models with money impact
 * by comparing incoming downstream timestamps against a per-venue
 * sync watermark.
 *
 * v1: Log-only mode (quarantine record created, sync still applies neon-wins).
 * Promote to blocking after 7 days in staging/limited prod with no
 * unexplained false positives.
 *
 * Timestamp-based detection is v1 only. Final conflict handling should
 * move to explicit row versions or sync watermarks.
 */

import { masterClient } from '../db'
import { parseBool } from '../env-parse'

// ── Mode ─────────────────────────────────────────────────────────────────────
// SYNC_QUARANTINE_MODE controls behavior when a conflict is detected:
//   'log-only' (default) — record conflict, still apply neon-wins
//   'blocking' — record conflict, skip upsert (quarantine the row)
export type QuarantineMode = 'log-only' | 'blocking'

function getQuarantineMode(): QuarantineMode {
  const raw = process.env.SYNC_QUARANTINE_MODE
  if (raw === 'blocking') return 'blocking'
  return 'log-only'
}

// ── Protected models ─────────────────────────────────────────────────────────
// All bidirectional models with money impact

export const QUARANTINE_PROTECTED_MODELS = new Set([
  'Order', 'OrderItem', 'Payment', 'OrderDiscount', 'OrderCard',
  'OrderItemModifier', 'GiftCardTransaction', 'HouseAccountTransaction',
])

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuarantineRecord {
  model: string
  recordId: string
  localUpdatedAt: Date
  cloudUpdatedAt: Date
  localData: Record<string, unknown>
  cloudData: Record<string, unknown>
}

export type QuarantineDecision = 'apply' | 'quarantine'

// ── Watermark ────────────────────────────────────────────────────────────────

/**
 * In-memory cache of the last acknowledged downstream timestamp per venue.
 * Populated from the SyncWatermark table at worker start.
 */
const watermarkCache = new Map<string, Date>()

/**
 * Load watermarks from the SyncWatermark table into memory.
 * Call once at downstream sync worker start.
 */
export async function loadWatermarks(): Promise<void> {
  try {
    const rows = await masterClient.$queryRawUnsafe<Array<{
      locationId: string
      lastAcknowledgedDownstreamAt: Date
    }>>(
      `SELECT "locationId", "lastAcknowledgedDownstreamAt" FROM "SyncWatermark"`
    )
    for (const row of rows) {
      watermarkCache.set(row.locationId, row.lastAcknowledgedDownstreamAt)
    }
    console.log(`[SyncQuarantine] Loaded ${watermarkCache.size} watermark(s)`)
  } catch {
    // Table may not exist yet — will be created by migration 075
  }
}

/**
 * Update the downstream watermark after a successful sync cycle.
 */
export async function updateDownstreamWatermark(locationId: string, acknowledgedAt: Date): Promise<void> {
  watermarkCache.set(locationId, acknowledgedAt)
  try {
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "SyncWatermark" (id, "locationId", "lastAcknowledgedDownstreamAt", "lastAcknowledgedUpstreamAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       ON CONFLICT ("locationId") DO UPDATE SET "lastAcknowledgedDownstreamAt" = $2, "updatedAt" = NOW()`,
      locationId,
      acknowledgedAt.toISOString(),
    )
  } catch (err) {
    console.error('[SyncQuarantine] Failed to persist watermark:', err instanceof Error ? err.message : err)
  }
}

// ── Quarantine Decision ──────────────────────────────────────────────────────

/**
 * Decide whether a downstream row should be quarantined.
 *
 * Version-based detection (preferred, when syncVersion columns exist):
 *   Quarantine when: localSyncVersion > incomingSyncVersion AND local row was locally mutated
 *   Otherwise: apply
 *
 * Timestamp-based detection (fallback when versions not available):
 *   Quarantine when ALL are true:
 *   1. Model is in the protected set
 *   2. Incoming change is downstream/cloud-originated
 *   3. Local row's updatedAt > venue's lastAcknowledgedDownstreamAt
 *   4. Incoming updatedAt <= local updatedAt
 *
 * v1: Always returns 'apply' but logs and records the quarantine.
 */
export async function checkQuarantine(
  model: string,
  recordId: string,
  incomingUpdatedAt: Date,
  localUpdatedAt: Date | null,
  locationId: string,
  localData: Record<string, unknown>,
  cloudData: Record<string, unknown>,
  incomingSyncVersion?: number | null,
  localSyncVersion?: number | null,
): Promise<QuarantineDecision> {
  // Not a protected model — always apply
  if (!QUARANTINE_PROTECTED_MODELS.has(model)) return 'apply'

  // No local row — no conflict
  if (!localUpdatedAt) return 'apply'

  // ── Version-based detection (deterministic, no NTP drift) ────────────
  // If both versions are available (non-null), use version comparison
  // instead of timestamp comparison. This is the preferred path once
  // migration 077 has run.
  if (incomingSyncVersion != null && localSyncVersion != null) {
    // Local version is higher than incoming → local was mutated after last sync
    // AND the local row must have been locally mutated (lastMutatedBy != 'cloud')
    const locallyMutated = localData.lastMutatedBy != null && localData.lastMutatedBy !== 'cloud'
    if (localSyncVersion > incomingSyncVersion && locallyMutated) {
      // Fall through to conflict handling below
    } else {
      // No version conflict — apply the incoming row
      return 'apply'
    }
  } else {
    // ── Timestamp-based detection (fallback for pre-migration rows) ─────
    const watermark = watermarkCache.get(locationId) ?? new Date('1970-01-01T00:00:00Z')

    // Local row hasn't changed since last sync ack — no conflict
    if (localUpdatedAt <= watermark) return 'apply'

    // Cloud version is strictly newer — no conflict
    if (incomingUpdatedAt > localUpdatedAt) return 'apply'
  }

  // ── CONFLICT DETECTED ──────────────────────────────────────────────────
  // Local row changed since last sync, and cloud version is not newer.

  const mode = getQuarantineMode()

  const watermark = watermarkCache.get(locationId) ?? new Date('1970-01-01T00:00:00Z')

  console.warn(JSON.stringify({
    event: 'sync_conflict_quarantine',
    model,
    recordId,
    locationId,
    localUpdatedAt: localUpdatedAt.toISOString(),
    cloudUpdatedAt: incomingUpdatedAt.toISOString(),
    watermark: watermark.toISOString(),
    ...(localSyncVersion != null ? { localSyncVersion } : {}),
    ...(incomingSyncVersion != null ? { incomingSyncVersion } : {}),
    detectionMethod: (incomingSyncVersion != null && localSyncVersion != null) ? 'version' : 'timestamp',
    mode,
    timestamp: new Date().toISOString(),
  }))

  // Persist quarantine record
  try {
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "SyncConflict" (id, model, "recordId", "localVersion", "cloudVersion", "localData", "cloudData", "detectedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
      model,
      recordId,
      localUpdatedAt.toISOString(),
      incomingUpdatedAt.toISOString(),
      JSON.stringify(localData),
      JSON.stringify(cloudData),
    )
  } catch (err) {
    // Non-fatal — table may not exist yet
    console.error('[SyncQuarantine] Failed to persist conflict record:', err instanceof Error ? err.message : err)
  }

  // In blocking mode, skip the downstream upsert — row is quarantined.
  // In log-only mode, record the conflict but still apply neon-wins.
  return mode === 'blocking' ? 'quarantine' : 'apply'
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/**
 * Get quarantine metrics for monitoring.
 */
export async function getQuarantineMetrics(): Promise<{
  totalConflicts: number
  unresolvedConflicts: number
  recentConflicts: number
}> {
  try {
    const [total] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "SyncConflict"`
    )
    const [unresolved] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "SyncConflict" WHERE "resolvedAt" IS NULL`
    )
    const [recent] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "SyncConflict" WHERE "detectedAt" > NOW() - INTERVAL '24 hours'`
    )
    return {
      totalConflicts: Number(total.count),
      unresolvedConflicts: Number(unresolved.count),
      recentConflicts: Number(recent.count),
    }
  } catch {
    return { totalConflicts: 0, unresolvedConflicts: 0, recentConflicts: 0 }
  }
}
