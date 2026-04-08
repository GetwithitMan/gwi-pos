import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('chargebacks')

const VALID_STATUSES = ['open', 'responded', 'won', 'lost'] as const

// GET - Fetch a single chargeback case by ID
export const GET = withVenue(async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const chargebackCase = await db.chargebackCase.findUnique({
      where: { id },
    })

    if (!chargebackCase || chargebackCase.deletedAt) {
      return notFound('Chargeback case not found')
    }

    return ok({
      id: chargebackCase.id,
      locationId: chargebackCase.locationId,
      orderId: chargebackCase.orderId,
      paymentId: chargebackCase.paymentId,
      cardLast4: chargebackCase.cardLast4,
      cardBrand: chargebackCase.cardBrand,
      amount: Number(chargebackCase.amount),
      chargebackDate: chargebackCase.chargebackDate.toISOString(),
      reason: chargebackCase.reason,
      reasonCode: chargebackCase.reasonCode,
      responseDeadline: chargebackCase.responseDeadline?.toISOString(),
      status: chargebackCase.status,
      notes: chargebackCase.notes,
      responseNotes: chargebackCase.responseNotes,
      respondedAt: chargebackCase.respondedAt?.toISOString(),
      respondedBy: chargebackCase.respondedBy,
      resolvedAt: chargebackCase.resolvedAt?.toISOString(),
      createdAt: chargebackCase.createdAt.toISOString(),
      updatedAt: chargebackCase.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to fetch chargeback case:', error)
    return err('Failed to fetch chargeback case', 500)
  }
})

export const PUT = withVenue(withAuth('MGR_VOID_PAYMENTS', async function PUT(
  request: NextRequest,
  ctx: { auth: { employeeId: string | null }; params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const body = await request.json()
    const { status, notes, resolution, respondedBy, resolvedAmount, resolvedAt } = body
    const authEmployeeId = ctx.auth.employeeId

    // Find the case first to get locationId
    const existing = await db.chargebackCase.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Chargeback case not found')
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.includes(status)) {
      return err(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`)
    }

    // Validate status transitions (optional but recommended)
    if (status && status !== existing.status) {
      const validTransitions: Record<string, string[]> = {
        open: ['responded', 'won', 'lost'],
        responded: ['won', 'lost', 'open'],
        won: [],
        lost: [],
      }
      if (!validTransitions[existing.status].includes(status)) {
        return err(`Invalid transition from '${existing.status}' to '${status}'`)
      }
    }

    // Build update data
    const data: Record<string, unknown> = { updatedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
    if (status) data.status = status
    if (notes !== undefined) data.notes = notes
    if (resolution !== undefined) data.responseNotes = resolution

    // If status is 'won' or 'lost', set resolvedAt
    if (status === 'won' || status === 'lost') {
      data.resolvedAt = resolvedAt ? new Date(resolvedAt) : new Date()
    }

    // If status is 'responded', set respondedAt and respondedBy
    if (status === 'responded') {
      data.respondedAt = new Date()
      data.respondedBy = respondedBy || authEmployeeId || null
    }

    // Atomic transaction: update chargeback + create audit log
    const updated = await db.$transaction(async (tx) => {
      // Update the chargeback case
      const updatedCase = await tx.chargebackCase.update({
        where: { id },
        data,
      })

      // If transitioning to won/lost and there's a linked payment, update its needsReconciliation
      if (existing.paymentId && (status === 'won' || status === 'lost')) {
        await tx.payment.update({
          where: { id: existing.paymentId },
          data: {
            needsReconciliation: status === 'won' ? false : true, // won = resolved, lost = needs review
            updatedAt: new Date(),
          },
        })
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId: existing.locationId,
          employeeId: authEmployeeId || null,
          action: 'chargeback_updated',
          entityType: 'chargeback',
          entityId: id,
          details: {
            chargebackCaseId: id,
            previousStatus: existing.status,
            newStatus: status || existing.status,
            amount: Number(existing.amount),
            cardLast4: existing.cardLast4,
            resolution: resolution || null,
            notes: notes || null,
            resolvedAmount: resolvedAmount || null,
            linkedPaymentId: existing.paymentId || null,
          },
        },
      })

      return updatedCase
    })

    pushUpstream()

    // Emit socket event (fire-and-forget)
    void emitToLocation(existing.locationId, 'chargeback:updated', {
      id: updated.id,
      status: updated.status,
      ...(existing.paymentId ? { paymentId: existing.paymentId } : {}),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        id: updated.id,
        locationId: updated.locationId,
        orderId: updated.orderId,
        paymentId: updated.paymentId,
        cardLast4: updated.cardLast4,
        cardBrand: updated.cardBrand,
        amount: Number(updated.amount),
        chargebackDate: updated.chargebackDate.toISOString(),
        reason: updated.reason,
        reasonCode: updated.reasonCode,
        responseDeadline: updated.responseDeadline?.toISOString(),
        status: updated.status,
        notes: updated.notes,
        responseNotes: updated.responseNotes,
        respondedAt: updated.respondedAt?.toISOString(),
        respondedBy: updated.respondedBy,
        resolvedAt: updated.resolvedAt?.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      })
  } catch (error) {
    console.error('Failed to update chargeback case:', error)
    return err('Failed to update chargeback case', 500)
  }
}))
