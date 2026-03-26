import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { dispatchExceptionEvent } from '@/lib/delivery/dispatch-events'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * POST /api/delivery/exceptions/[id]/resolve — Resolve a delivery exception
 *
 * Body: { resolution: string }
 *
 * Transitions exception from 'open' or 'acknowledged' to 'resolved',
 * sets resolvedAt and resolution text, writes audit log, fires socket event.
 *
 * Designed for the Delivery KDS Android app.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { resolution } = body

    if (!resolution || typeof resolution !== 'string' || resolution.trim().length === 0) {
      return NextResponse.json({ error: 'resolution is required' }, { status: 400 })
    }

    // Fetch existing exception
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM "DeliveryException" WHERE id = $1 AND "locationId" = $2`,
      id, locationId,
    )

    if (!existing.length) {
      return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
    }

    const current = existing[0]

    // Validate status transition — only open or acknowledged can be resolved
    if (current.status === 'resolved') {
      return NextResponse.json(
        { error: 'Exception is already resolved' },
        { status: 409 },
      )
    }

    if (!['open', 'acknowledged'].includes(current.status)) {
      return NextResponse.json(
        { error: `Cannot resolve exception in '${current.status}' status` },
        { status: 400 },
      )
    }

    // Update exception to resolved
    const sanitizedResolution = sanitizeHtml(resolution)
    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryException"
      SET "status" = 'resolved',
          "resolution" = $1,
          "resolvedAt" = CURRENT_TIMESTAMP,
          "resolvedBy" = $2,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $3 AND "locationId" = $4
      RETURNING *
    `, sanitizedResolution, auth.employee.id, id, locationId)

    if (!updated.length) {
      return NextResponse.json({ error: 'Failed to resolve exception' }, { status: 500 })
    }

    const exception = updated[0]

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'exception_resolved',
      deliveryOrderId: exception.deliveryOrderId || undefined,
      runId: exception.runId || undefined,
      driverId: exception.driverId || undefined,
      employeeId: auth.employee.id,
      previousValue: { status: current.status },
      newValue: { status: 'resolved', resolution: sanitizedResolution },
      reason: sanitizedResolution,
    }).catch(console.error)

    // Fire socket event
    void dispatchExceptionEvent(locationId, 'delivery:exception_resolved', exception).catch(console.error)

    return NextResponse.json({
      data: exception,
      message: 'Exception resolved',
    })
  } catch (error) {
    console.error('[Delivery/Exceptions/Resolve] POST error:', error)
    return NextResponse.json({ error: 'Failed to resolve delivery exception' }, { status: 500 })
  }
})
