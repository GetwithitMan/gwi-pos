/**
 * Check Cleanup — shared implementation
 *
 * Two callers, one implementation:
 *   - `/api/cron/check-cleanup` — cloud/Vercel cron (fleet-wide, unscoped)
 *   - `draftCleanup` worker in `server.ts` — NUC in-process, scoped to POS_LOCATION_ID
 *
 * Replaces the pre-Check-Aggregate `cleanupStaleOrders`, which swept stale draft
 * Orders. Drafts are Checks now, so the sweep moved with them.
 */

import { db } from '@/lib/db'
import { emitCheckEvent } from './emitter'
import {
  dispatchCheckLeaseChanged,
  dispatchCheckAbandoned,
  dispatchChecksListChanged,
} from '@/lib/socket-dispatch/check-dispatch'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('check-cleanup')

export const LEASE_TIMEOUT_MS = 10 * 60 * 1000       // 10 min — configurable per location later
export const DRAFT_TTL_MS = 30 * 60 * 1000           // 30 min — configurable per location later
const PROCESSED_COMMAND_TTL_MS = 24 * 60 * 60 * 1000 // 24h

export interface CheckCleanupResult {
  releasedLeases: number
  abandonedDrafts: number
  prunedCommands: number
  timestamp: string
}

/**
 * Release stale leases, abandon stale drafts, prune old processed commands.
 *
 * @param locationId - Scope the sweep to one location. Omit for fleet-wide (cloud cron).
 */
export async function runCheckCleanup(
  { locationId }: { locationId?: string } = {}
): Promise<CheckCleanupResult> {
  const now = new Date()
  const leaseThreshold = new Date(now.getTime() - LEASE_TIMEOUT_MS)
  const draftThreshold = new Date(now.getTime() - DRAFT_TTL_MS)
  const scope = locationId ? { locationId } : {}

  // ── Step 1: Release stale leases ──────────────────────────────────────
  // Terminals that crashed without a clean disconnect still hold their lease.
  const staleLeases = await db.check.findMany({
    where: {
      ...scope,
      terminalId: { not: null },
      leaseLastHeartbeatAt: { lt: leaseThreshold },
      status: { in: ['draft', 'committed'] },
    },
  })

  for (const check of staleLeases) {
    try {
      await db.check.update({
        where: { id: check.id },
        data: {
          terminalId: null,
          leaseAcquiredAt: null,
          leaseLastHeartbeatAt: null,
        },
      })

      void emitCheckEvent(check.locationId, check.id, 'CHECK_LEASE_RELEASED', {
        terminalId: check.terminalId,
        reason: 'timeout',
      }).catch(e => log.warn({ err: e }, 'emit CHECK_LEASE_RELEASED failed'))

      void dispatchCheckLeaseChanged(check.locationId, check.id, {
        terminalId: null,
        reason: 'timeout',
      }).catch(e => log.warn({ err: e }, 'dispatchCheckLeaseChanged failed'))
    } catch (e) {
      log.error({ err: e, checkId: check.id }, 'Failed to release stale lease')
    }
  }

  // ── Step 2: Abandon stale draft checks ────────────────────────────────
  // Only abandon drafts with no active editor (terminalId is null)
  const staleDrafts = await db.check.findMany({
    where: {
      ...scope,
      status: 'draft',
      updatedAt: { lt: draftThreshold },
      terminalId: null,
    },
  })

  for (const check of staleDrafts) {
    try {
      await db.check.update({
        where: { id: check.id },
        data: { status: 'abandoned' },
      })

      void emitCheckEvent(check.locationId, check.id, 'CHECK_ABANDONED', {
        reason: 'stale_cleanup',
      }).catch(e => log.warn({ err: e }, 'emit CHECK_ABANDONED failed'))

      void dispatchCheckAbandoned(check.locationId, check.id)
        .catch(e => log.warn({ err: e }, 'dispatchCheckAbandoned failed'))

      void dispatchChecksListChanged(check.locationId)
        .catch(e => log.warn({ err: e }, 'dispatchChecksListChanged failed'))
    } catch (e) {
      log.error({ err: e, checkId: check.id }, 'Failed to abandon stale draft')
    }
  }

  // ── Step 3: Prune stale processed commands (>24h) ────────────────────
  // ProcessedCommand is a global idempotency ledger with no locationId — the
  // TTL prune is unscoped by design.
  const pruneThreshold = new Date(now.getTime() - PROCESSED_COMMAND_TTL_MS)
  let prunedCommands = 0
  try {
    const pruned = await db.processedCommand.deleteMany({
      where: { createdAt: { lt: pruneThreshold } },
    })
    prunedCommands = pruned.count
    if (prunedCommands > 0) {
      log.info({ prunedCommands }, 'pruned stale processed commands')
    }
  } catch (e) {
    log.error({ err: e }, 'Failed to prune processed commands')
  }

  return {
    releasedLeases: staleLeases.length,
    abandonedDrafts: staleDrafts.length,
    prunedCommands,
    timestamp: now.toISOString(),
  }
}
