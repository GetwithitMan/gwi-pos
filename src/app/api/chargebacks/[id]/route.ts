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

export const PUT = withVenue(withAuth('MGR_VOID_PAYMENTS', async function PUT(
  request: NextRequest,
  ctx: { auth: { employeeId: string | null }; params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params
    const body = await request.json()
    const { status, notes, resolution, respondedBy } = body
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

    // Build update data
    const data: Record<string, unknown> = { updatedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
    if (status) data.status = status
    if (notes !== undefined) data.notes = notes
    if (resolution !== undefined) data.responseNotes = resolution

    // If status is 'won' or 'lost', set resolvedAt
    if (status === 'won' || status === 'lost') {
      data.resolvedAt = new Date()
    }

    // If status is 'responded', set respondedAt and respondedBy
    if (status === 'responded') {
      data.respondedAt = new Date()
      data.respondedBy = respondedBy || authEmployeeId || null
    }

    // Atomic transaction: update chargeback + create audit log
    const [updated] = await db.$transaction([
      db.chargebackCase.update({
        where: { id },
        data,
      }),
      db.auditLog.create({
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
          },
        },
      }),
    ])

    pushUpstream()

    // Emit socket event (fire-and-forget)
    void emitToLocation(existing.locationId, 'chargeback:updated', {
      id: updated.id,
      status: updated.status,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        id: updated.id,
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
      })
  } catch (error) {
    console.error('Failed to update chargeback case:', error)
    return err('Failed to update chargeback case', 500)
  }
}))
