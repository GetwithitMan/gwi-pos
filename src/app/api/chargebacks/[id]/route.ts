import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { emitToLocation } from '@/lib/socket-server'

const VALID_STATUSES = ['open', 'responded', 'won', 'lost'] as const

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, notes, respondedBy } = body

    // Find the case first to get locationId
    const existing = await db.chargebackCase.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Chargeback case not found' }, { status: 404 })
    }

    // Auth: require manager.void_payments permission
    const employeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(employeeId, existing.locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
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

    // If status is 'won' or 'lost', set resolvedAt
    if (status === 'won' || status === 'lost') {
      data.resolvedAt = new Date()
    }

    // If status is 'responded', set respondedAt and respondedBy
    if (status === 'responded') {
      data.respondedAt = new Date()
      data.respondedBy = respondedBy || auth.employee.id
    }

    const updated = await db.chargebackCase.update({
      where: { id },
      data,
    })

    // Emit socket event
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
