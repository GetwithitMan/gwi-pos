import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, AuthenticatedContext } from '@/lib/api-auth-middleware'
import { emitCheckEvent } from '@/lib/check-events'
import { dispatchCheckLeaseChanged } from '@/lib/socket-dispatch/check-dispatch'
import { err, notFound, ok } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('check-lease-release')

export const dynamic = 'force-dynamic'

const VALID_REASONS = ['handoff', 'done', 'admin'] as const
type ReleaseReason = (typeof VALID_REASONS)[number]

/**
 * POST /api/checks/[id]/lease/release — Explicit lease release.
 *
 * The owning terminal calls this when navigating away, handing off,
 * or completing the check. Admin reason bypasses ownership validation.
 */
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  const { id: checkId } = await ctx.params
  const body = await request.json()
  const { terminalId, reason } = body as { terminalId: string; reason: ReleaseReason }

  if (!terminalId || typeof terminalId !== 'string') {
    return err('terminalId is required')
  }
  if (!reason || !VALID_REASONS.includes(reason)) {
    return err(`reason must be one of: ${VALID_REASONS.join(', ')}`)
  }

  const check = await db.check.findUnique({ where: { id: checkId } })
  if (!check) {
    return notFound('Check not found')
  }

  // Validate ownership — admin override allowed
  if (reason !== 'admin' && check.terminalId != null && check.terminalId !== terminalId) {
    return err('Cannot release a lease owned by another terminal', 403)
  }

  await db.check.update({
    where: { id: checkId },
    data: {
      terminalId: null,
      leaseAcquiredAt: null,
      leaseLastHeartbeatAt: null,
    },
  })

  void emitCheckEvent(check.locationId, checkId, 'CHECK_LEASE_RELEASED', {
    terminalId,
    reason,
  }).catch(e => log.warn({ err: e }, 'Failed to emit CHECK_LEASE_RELEASED'))

  void dispatchCheckLeaseChanged(check.locationId, checkId, {
    terminalId: null,
    reason,
  }).catch(e => log.warn({ err: e }, 'dispatchCheckLeaseChanged failed'))

  return ok({ released: true })
}))
