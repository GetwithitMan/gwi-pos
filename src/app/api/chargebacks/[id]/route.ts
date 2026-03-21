import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitToLocation } from '@/lib/socket-server'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

const VALID_STATUSES = ['open', 'responded', 'won', 'lost'] as const

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, notes, resolution, respondedBy, employeeId } = body

    // Find the case first to get locationId
    const existing = await db.chargebackCase.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Chargeback case not found' }, { status: 404 })
    }

    // Auth: resolve employee from cookie or body, require manager.void_payments permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, existing.locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Build update data
    const data: Record<string, unknown> = { updatedAt: new Date() }
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
      data.respondedBy = respondedBy || resolvedEmployeeId || null
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
          employeeId: resolvedEmployeeId || null,
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
    }).catch(console.error)

    return NextResponse.json({
      data: {
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
      },
    })
  } catch (error) {
    console.error('Failed to update chargeback case:', error)
    return NextResponse.json({ error: 'Failed to update chargeback case' }, { status: 500 })
  }
})
