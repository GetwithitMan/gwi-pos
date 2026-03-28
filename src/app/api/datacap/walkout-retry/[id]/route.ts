import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { logger } from '@/lib/logger'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// PUT - Write off a walkout retry (mark as unrecoverable)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let body: { action?: string; reason?: string; employeeId?: string; locationId?: string }
    try {
      body = await request.json()
    } catch {
      return err('Invalid JSON request body')
    }

    if (body.action !== 'write-off') {
      return err('Invalid action. Expected "write-off"')
    }

    const { reason, locationId } = body

    if (!locationId) {
      return err('Missing locationId')
    }

    if (!reason || !reason.trim()) {
      return err('Missing reason for write-off')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    // Find the retry record
    const retry = await db.walkoutRetry.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!retry) {
      return notFound('Walkout retry not found')
    }

    if (retry.writtenOffAt) {
      return err('Already written off', 409)
    }

    if (retry.status === 'collected') {
      return err('Cannot write off a collected retry', 409)
    }

    const now = new Date()

    // Atomic transaction: update walkout retry + create audit log
    const [updated] = await db.$transaction([
      db.walkoutRetry.update({
        where: { id },
        data: {
          writtenOffAt: now,
          writtenOffBy: resolvedEmployeeId || null,
          status: 'written_off',
          lastRetryError: `Written off: ${reason.trim()}`,
        },
      }),
      db.auditLog.create({
        data: {
          locationId,
          employeeId: resolvedEmployeeId || null,
          action: 'walkout_written_off',
          entityType: 'walkout_retry',
          entityId: id,
          details: {
            walkoutRetryId: id,
            orderId: retry.orderId,
            amount: Number(retry.amount),
            reason: reason.trim(),
            retryCount: retry.retryCount,
          },
        },
      }),
    ])
    pushUpstream()

    return ok({
        id: updated.id,
        orderId: updated.orderId,
        amount: Number(updated.amount),
        status: updated.status,
        writtenOffAt: updated.writtenOffAt?.toISOString(),
        writtenOffBy: updated.writtenOffBy,
        reason: reason.trim(),
      })
  } catch (error) {
    logger.error('datacap', 'Failed to write off walkout retry', error)
    return err('Failed to write off walkout retry', 500)
  }
})
