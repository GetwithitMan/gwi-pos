import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { emitCheckEvent } from '@/lib/check-events'
import {
  dispatchCheckLeaseChanged,
  dispatchCheckAbandoned,
  dispatchChecksListChanged,
} from '@/lib/socket-dispatch/check-dispatch'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cron-check-cleanup')

const LEASE_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes — configurable per location later
const DRAFT_TTL_MS = 30 * 60 * 1000      // 30 minutes — configurable per location later

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/check-cleanup
 *
 * Runs every 5 minutes (configured externally via cron scheduler).
 *
 * Step 1: Release stale leases — terminals that crashed without clean disconnect.
 * Step 2: Abandon stale draft checks — drafts with no active editor for > 30 min.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const leaseThreshold = new Date(now.getTime() - LEASE_TIMEOUT_MS)
  const draftThreshold = new Date(now.getTime() - DRAFT_TTL_MS)

  // ── Step 1: Release stale leases ──────────────────────────────────────
  const staleLeases = await db.check.findMany({
    where: {
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
  const pruneThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000)
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

  return NextResponse.json({
    releasedLeases: staleLeases.length,
    abandonedDrafts: staleDrafts.length,
    prunedCommands,
    timestamp: now.toISOString(),
  })
}
