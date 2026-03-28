import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { dispatchExceptionEvent } from '@/lib/delivery/dispatch-events'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-exceptions')

export const dynamic = 'force-dynamic'

function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

// ── Valid Status Transitions ────────────────────────────────────────────────

const VALID_EXCEPTION_TRANSITIONS: Record<string, string[]> = {
  open: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: [], // terminal
}

/**
 * PUT /api/delivery/exceptions/[id] — Resolve or acknowledge an exception
 *
 * Body: { status: 'acknowledged' | 'resolved', resolution?, resolvedBy? }
 */
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'exceptionsQueueProvisioned' })
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_EXCEPTIONS)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { status, resolution, resolvedBy } = body

    // Validate status
    if (!status || !['acknowledged', 'resolved'].includes(status)) {
      return err('Status must be "acknowledged" or "resolved"')
    }

    // Fetch existing exception
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM "DeliveryException" WHERE id = $1 AND "locationId" = $2`,
      id, locationId,
    )

    if (!existing.length) {
      return notFound('Exception not found')
    }

    const current = existing[0]

    // Validate status transition
    const allowedNext = VALID_EXCEPTION_TRANSITIONS[current.status] || []
    if (!allowedNext.includes(status)) {
      return err(`Cannot transition from '${current.status}' to '${status}'. Allowed: ${allowedNext.join(', ') || 'none (terminal)'}`)
    }

    // Build update
    const updates: string[] = [
      `"status" = $1`,
      `"updatedAt" = CURRENT_TIMESTAMP`,
    ]
    const updateParams: any[] = [status]
    let paramIdx = 2

    if (resolution !== undefined) {
      updates.push(`"resolution" = $${paramIdx}`)
      updateParams.push(resolution ? sanitizeHtml(resolution) : null)
      paramIdx++
    }

    if (resolvedBy !== undefined) {
      updates.push(`"resolvedBy" = $${paramIdx}`)
      updateParams.push(resolvedBy)
      paramIdx++
    } else if (status === 'resolved' || status === 'acknowledged') {
      // Default resolvedBy to the current actor
      updates.push(`"resolvedBy" = $${paramIdx}`)
      updateParams.push(auth.employee.id)
      paramIdx++
    }

    if (status === 'resolved') {
      updates.push(`"resolvedAt" = CURRENT_TIMESTAMP`)
    }

    if (status === 'acknowledged') {
      updates.push(`"acknowledgedAt" = CURRENT_TIMESTAMP`)
    }

    // Add id and locationId params at the end
    const idParamIdx = paramIdx
    const locParamIdx = paramIdx + 1
    updateParams.push(id, locationId)

    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryException"
      SET ${updates.join(', ')}
      WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx}
      RETURNING *
    `, ...updateParams)

    if (!updated.length) {
      return err('Failed to update exception', 500)
    }

    const exception = updated[0]

    pushUpstream()

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'exception_resolved',
      deliveryOrderId: exception.deliveryOrderId || undefined,
      runId: exception.runId || undefined,
      driverId: exception.driverId || undefined,
      employeeId: auth.employee.id,
      previousValue: { status: current.status },
      newValue: { status, resolution: resolution || null },
      reason: resolution || undefined,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Fire socket event
    void dispatchExceptionEvent(locationId, 'delivery:exception_resolved', exception).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ exception })
  } catch (error) {
    console.error('[Delivery/Exceptions] PUT error:', error)
    return err('Failed to update delivery exception', 500)
  }
})
