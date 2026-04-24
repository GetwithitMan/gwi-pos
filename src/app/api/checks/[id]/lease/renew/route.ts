import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, AuthenticatedContext } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

const LEASE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export const dynamic = 'force-dynamic'

/**
 * POST /api/checks/[id]/lease/renew — Heartbeat renewal.
 *
 * Real server-side validation: the requester must currently own the lease.
 * If the lease was released (timeout, admin, disconnect), returns 409 LEASE_LOST
 * so the terminal can show an appropriate message.
 *
 * Called every ~30 seconds by active terminals.
 */
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  const { id: checkId } = await ctx.params
  const body = await request.json()
  const { terminalId } = body

  if (!terminalId || typeof terminalId !== 'string') {
    return err('terminalId is required')
  }

  const check = await db.check.findUnique({ where: { id: checkId } })
  if (!check) {
    return notFound('Check not found')
  }

  // Lease was released or taken by another terminal
  if (check.terminalId == null) {
    return err('LEASE_LOST', 409, { reason: 'timeout' })
  }
  if (check.terminalId !== terminalId) {
    return err('LEASE_LOST', 409, { reason: 'admin_release' })
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + LEASE_TIMEOUT_MS)

  await db.check.update({
    where: { id: checkId },
    data: { leaseLastHeartbeatAt: now },
  })

  return ok({
    renewed: true,
    expiresAt: expiresAt.toISOString(),
  })
}))
