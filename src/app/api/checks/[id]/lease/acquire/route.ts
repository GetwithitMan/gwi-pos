import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, AuthenticatedContext } from '@/lib/api-auth-middleware'
import { emitCheckEvent } from '@/lib/check-events'
import { dispatchCheckLeaseChanged } from '@/lib/socket-dispatch/check-dispatch'
import { err, notFound, ok } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('check-lease-acquire')

const LEASE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export const dynamic = 'force-dynamic'

/**
 * POST /api/checks/[id]/lease/acquire — Acquire editing lease on a check.
 *
 * If the lease is free (no terminalId, or heartbeat expired), grants it.
 * If the requester already owns the lease, re-acquires (renews).
 * If another active terminal holds the lease, returns 409 with owner info.
 */
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  const { id: checkId } = await ctx.params
  const body = await request.json()
  const { terminalId, employeeName } = body

  if (!terminalId || typeof terminalId !== 'string') {
    return err('terminalId is required')
  }
  if (!employeeName || typeof employeeName !== 'string') {
    return err('employeeName is required')
  }

  const check = await db.check.findUnique({ where: { id: checkId } })
  if (!check) {
    return notFound('Check not found')
  }

  const now = new Date()

  // Determine if existing lease is still active
  const leaseIsActive =
    check.terminalId != null &&
    check.leaseLastHeartbeatAt != null &&
    now.getTime() - check.leaseLastHeartbeatAt.getTime() < LEASE_TIMEOUT_MS

  // Conflict: another terminal holds an active lease
  if (leaseIsActive && check.terminalId !== terminalId) {
    return err('LEASE_CONFLICT', 409, {
      leaseOwner: check.terminalId,
      employeeName: employeeName, // caller's name — server doesn't track lease holder name yet
      acquiredAt: check.leaseAcquiredAt?.toISOString() ?? null,
    })
  }

  // Grant or re-acquire
  const updated = await db.check.update({
    where: { id: checkId },
    data: {
      terminalId,
      leaseAcquiredAt: leaseIsActive && check.terminalId === terminalId
        ? check.leaseAcquiredAt // keep original acquire time on re-acquire
        : now,
      leaseLastHeartbeatAt: now,
    },
  })

  void emitCheckEvent(check.locationId, checkId, 'CHECK_LEASE_ACQUIRED', {
    terminalId,
    employeeName,
  }).catch(e => log.warn({ err: e }, 'Failed to emit CHECK_LEASE_ACQUIRED'))

  void dispatchCheckLeaseChanged(check.locationId, checkId, {
    terminalId,
    employeeName,
  }).catch(e => log.warn({ err: e }, 'dispatchCheckLeaseChanged failed'))

  return ok({
    id: updated.id,
    terminalId: updated.terminalId,
    leaseAcquiredAt: updated.leaseAcquiredAt?.toISOString() ?? null,
    leaseLastHeartbeatAt: updated.leaseLastHeartbeatAt?.toISOString() ?? null,
  })
}))
