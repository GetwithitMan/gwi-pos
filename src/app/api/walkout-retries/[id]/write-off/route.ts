import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { getRequestLocationId } from '@/lib/request-context'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('walkout-write-off')

/**
 * POST /api/walkout-retries/[id]/write-off
 *
 * Formally writes off an exhausted or failed walkout retry as bad debt.
 * Requires manager void or refund permission.
 *
 * Body: { reason: string, notes?: string, employeeId?: string, locationId?: string }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: walkoutRetryId } = await params

    let body: { reason?: string; notes?: string; employeeId?: string; locationId?: string }
    try {
      body = await request.json()
    } catch {
      return err('Invalid JSON request body')
    }

    const { reason, notes, employeeId } = body

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return err('Missing or empty reason')
    }

    // Resolve locationId from request context or body
    let locationId = getRequestLocationId() || body.locationId
    if (!locationId) {
      // Fallback: look up from the walkout retry itself
      const retryLookup = await db.walkoutRetry.findFirst({
        where: { id: walkoutRetryId, deletedAt: null },
        select: { locationId: true },
      })
      if (!retryLookup) {
        return notFound('Walkout retry not found')
      }
      locationId = retryLookup.locationId
    }

    // Require manager void or refund permission
    const auth = await requireAnyPermission(employeeId, locationId, [
      PERMISSIONS.MGR_VOID_PAYMENTS,
      PERMISSIONS.MGR_REFUNDS,
    ])
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    const managerId = auth.employee.id

    // Load the walkout retry and validate status
    const retry = await db.walkoutRetry.findFirst({
      where: { id: walkoutRetryId, locationId, deletedAt: null },
      include: {
        order: {
          select: { id: true, orderNumber: true, total: true, status: true },
        },
        orderCard: {
          select: { id: true, cardType: true, cardLast4: true, cardholderName: true },
        },
      },
    })

    if (!retry) {
      return notFound('Walkout retry not found')
    }

    if (retry.status !== 'exhausted') {
      return err(
        `Cannot write off a walkout retry with status "${retry.status}". Only exhausted retries can be written off.`
      )
    }

    // Perform write-off in a transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Update WalkoutRetry to written_off with DB-generated timestamp
      await tx.$executeRaw`UPDATE "WalkoutRetry"
         SET status = 'written_off', "writtenOffAt" = NOW(), "writtenOffBy" = ${managerId}, "updatedAt" = NOW()
         WHERE id = ${walkoutRetryId} AND status = 'exhausted'`

      // 2. Add a note to the related order about the write-off
      const writeOffNote = `[WALKOUT WRITE-OFF] $${Number(retry.amount).toFixed(2)} written off as bad debt by ${auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`}. Reason: ${reason.trim()}${notes ? `. Notes: ${notes.trim()}` : ''}`

      // Append to order notes (preserve existing)
      await tx.$executeRaw`UPDATE "Order"
         SET notes = CASE
           WHEN notes IS NULL OR notes = '' THEN ${writeOffNote}
           ELSE notes || E'\n' || ${writeOffNote}
         END,
         "updatedAt" = NOW()
         WHERE id = ${retry.orderId}`

      // 3. Create audit log entry
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: managerId,
          action: 'walkout_written_off',
          entityType: 'walkout_retry',
          entityId: walkoutRetryId,
          details: {
            orderId: retry.orderId,
            orderNumber: retry.order.orderNumber,
            amount: Number(retry.amount),
            retryCount: retry.retryCount,
            maxRetries: retry.maxRetries,
            previousStatus: retry.status,
            reason: reason.trim(),
            notes: notes?.trim() || null,
            cardLast4: retry.orderCard.cardLast4,
            cardType: retry.orderCard.cardType,
            cardholderName: retry.orderCard.cardholderName,
          },
          ipAddress: request.headers.get('x-forwarded-for'),
          userAgent: request.headers.get('user-agent'),
        },
      })

      // Read back the updated record
      const updated = await tx.walkoutRetry.findUniqueOrThrow({
        where: { id: walkoutRetryId },
        include: {
          order: {
            select: { id: true, orderNumber: true, total: true, status: true },
          },
          orderCard: {
            select: { id: true, cardType: true, cardLast4: true, cardholderName: true },
          },
        },
      })

      return updated
    }, { timeout: 10000 })

    // Trigger upstream sync
    pushUpstream()

    // Emit socket event for real-time sync (fire-and-forget)
    void dispatchOpenOrdersChanged(locationId, {
      trigger: 'updated',
      orderId: retry.orderId,
    }, { async: true }).catch(e => log.warn({ err: e }, 'fire-and-forget socket dispatch failed'))

    log.info(
      { walkoutRetryId, orderId: retry.orderId, managerId, amount: Number(retry.amount) },
      'Walkout retry written off as bad debt'
    )

    return ok({
      id: result.id,
      orderId: result.orderId,
      amount: Number(result.amount),
      status: result.status,
      retryCount: result.retryCount,
      maxRetries: result.maxRetries,
      writtenOffAt: result.writtenOffAt?.toISOString(),
      writtenOffBy: result.writtenOffBy,
      lastRetryAt: result.lastRetryAt?.toISOString(),
      lastRetryError: result.lastRetryError,
      createdAt: result.createdAt.toISOString(),
      order: {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        total: Number(result.order.total),
        status: result.order.status,
      },
      card: {
        cardType: result.orderCard.cardType,
        cardLast4: result.orderCard.cardLast4,
        cardholderName: result.orderCard.cardholderName,
      },
    })
  } catch (error) {
    log.error({ err: error }, 'Failed to write off walkout retry')
    return err('Failed to write off walkout retry', 500)
  }
})
