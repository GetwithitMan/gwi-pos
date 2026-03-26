import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDeliveryStatus, writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { getMaxOrdersPerDriver } from '@/lib/delivery/dispatch-policy'
import { dispatchDeliveryStatusChanged, dispatchDriverAssigned } from '@/lib/delivery/dispatch-events'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('delivery')

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/[id] — Get delivery order detail
 */
export const GET = withVenue(async function GET(
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
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT d.*,
             o."orderNumber", o."guestCount", o."status" as "orderStatus",
             e."firstName" as "driverFirstName", e."lastName" as "driverLastName",
             ce."firstName" as "creatorFirstName", ce."lastName" as "creatorLastName"
      FROM "DeliveryOrder" d
      LEFT JOIN "Order" o ON o.id = d."orderId"
      LEFT JOIN "Employee" e ON e.id = d."driverId"
      LEFT JOIN "Employee" ce ON ce.id = d."employeeId"
      WHERE d.id = $1 AND d."locationId" = $2
    `, id, locationId)

    if (!rows.length) {
      return NextResponse.json({ error: 'Delivery order not found' }, { status: 404 })
    }

    const row = rows[0]

    // Get order items if linked
    let items: any[] = []
    if (row.orderId) {
      items = await db.$queryRawUnsafe(`
        SELECT oi.id, oi.name, oi.price, oi.quantity,
               oi."specialInstructions"
        FROM "OrderItem" oi
        WHERE oi."orderId" = $1 AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
        ORDER BY oi."createdAt" ASC
      `, row.orderId)
    }

    return NextResponse.json({
      data: {
        ...row,
        deliveryFee: Number(row.deliveryFee),
        driverName: row.driverFirstName ? `${row.driverFirstName} ${row.driverLastName}`.trim() : null,
        creatorName: row.creatorFirstName ? `${row.creatorFirstName} ${row.creatorLastName}`.trim() : null,
        items,
      },
    })
  } catch (error) {
    console.error('[Delivery/Detail] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch delivery order' }, { status: 500 })
  }
})

/**
 * PUT /api/delivery/[id] — Update delivery order (status, driver, ETA)
 *
 * Payload: { status?, driverId?, estimatedMinutes?, notes?, cancelReason? }
 *
 * If `status` is provided, uses the state machine (advanceDeliveryStatus) for validated
 * transitions, audit logging, and socket events. Other field updates (driverId, notes, etc.)
 * are applied directly and also audit-logged.
 */
export const PUT = withVenue(async function PUT(
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
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { status, driverId, estimatedMinutes, notes, cancelReason } = body

    // ── Status change via state machine ─────────────────────────────────
    if (status) {
      const result = await advanceDeliveryStatus({
        deliveryOrderId: id,
        locationId,
        newStatus: status,
        employeeId: auth.employee.id,
        cancelReason,
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      let delivery = result.deliveryOrder

      // If there are also non-status field updates, apply them after the status change
      const hasFieldUpdates = driverId !== undefined || estimatedMinutes !== undefined || notes !== undefined
      if (hasFieldUpdates) {
        const fieldUpdates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
        const fieldParams: any[] = []
        let paramIdx = 1

        if (driverId !== undefined) {
          fieldUpdates.push(`"driverId" = $${paramIdx}`)
          fieldParams.push(driverId || null)
          paramIdx++
        }

        if (estimatedMinutes !== undefined) {
          fieldUpdates.push(`"estimatedMinutes" = $${paramIdx}`)
          fieldParams.push(Number(estimatedMinutes))
          paramIdx++
        }

        if (notes !== undefined) {
          fieldUpdates.push(`"notes" = $${paramIdx}`)
          fieldParams.push(notes)
          paramIdx++
        }

        const idParamIdx = paramIdx
        const locParamIdx = paramIdx + 1
        fieldParams.push(id, locationId)

        const updated: any[] = await db.$queryRawUnsafe(`
          UPDATE "DeliveryOrder"
          SET ${fieldUpdates.join(', ')}
          WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx}
          RETURNING *
        `, ...fieldParams)

        if (updated.length) {
          delivery = updated[0]
        }

        // Audit log for field changes
        void writeDeliveryAuditLog({
          locationId,
          action: 'field_update',
          deliveryOrderId: id,
          employeeId: auth.employee.id,
          newValue: {
            ...(driverId !== undefined ? { driverId } : {}),
            ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
            ...(notes !== undefined ? { notes } : {}),
          },
        }).catch(err => log.warn({ err }, 'Background task failed'))
      }

      pushUpstream()

      return NextResponse.json({
        data: {
          ...delivery,
          deliveryFee: Number(delivery.deliveryFee),
        },
        message: `Delivery status updated to ${status}`,
      })
    }

    // ── Non-status field updates only ───────────────────────────────────

    // Fetch existing for audit diff
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryOrder"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Delivery order not found' }, { status: 404 })
    }

    const current = existing[0]

    // ── Driver capacity check (FOR UPDATE lock + maxOrdersPerDriver) ──
    if (driverId && driverId !== current.driverId) {
      const rawSettings = await getLocationSettings(locationId)
      const settings = mergeWithDefaults(rawSettings as any)
      const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
      const policy = deliveryConfig.dispatchPolicy

      const loc = await db.$queryRawUnsafe<{ timezone: string }[]>(
        'SELECT "timezone" FROM "Location" WHERE "id" = $1',
        locationId,
      )
      const timezone = loc[0]?.timezone ?? 'America/New_York'
      const maxPerDriver = getMaxOrdersPerDriver(policy, deliveryConfig.peakHours ?? [], timezone)

      // Lock the driver row and count active deliveries
      const driverRows: any[] = await db.$queryRawUnsafe(
        `SELECT * FROM "DeliveryDriver" WHERE "id" = $1 AND "locationId" = $2 FOR UPDATE`,
        driverId,
        locationId,
      )
      if (!driverRows.length) {
        return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
      }

      const activeCount: any[] = await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int as count FROM "DeliveryOrder"
         WHERE "driverId" = $1 AND "locationId" = $2
           AND status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
           AND id != $3`,
        driverId,
        locationId,
        id,
      )
      const currentDriverOrders = activeCount[0]?.count ?? 0
      if (currentDriverOrders >= maxPerDriver) {
        return NextResponse.json(
          { error: `Driver at capacity (${currentDriverOrders}/${maxPerDriver} active orders)` },
          { status: 409 }
        )
      }
    }

    const updates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: any[] = []
    let paramIdx = 1
    const changes: Record<string, any> = {}
    const previousValues: Record<string, any> = {}

    if (driverId !== undefined) {
      updates.push(`"driverId" = $${paramIdx}`)
      updateParams.push(driverId || null)
      paramIdx++
      changes.driverId = driverId || null
      previousValues.driverId = current.driverId
    }

    if (estimatedMinutes !== undefined) {
      updates.push(`"estimatedMinutes" = $${paramIdx}`)
      updateParams.push(Number(estimatedMinutes))
      paramIdx++
      changes.estimatedMinutes = Number(estimatedMinutes)
      previousValues.estimatedMinutes = current.estimatedMinutes
    }

    if (notes !== undefined) {
      updates.push(`"notes" = $${paramIdx}`)
      updateParams.push(notes)
      paramIdx++
      changes.notes = notes
      previousValues.notes = current.notes
    }

    if (updateParams.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Add id and locationId params at the end
    const idParamIdx = paramIdx
    const locParamIdx = paramIdx + 1
    updateParams.push(id, locationId)

    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryOrder"
      SET ${updates.join(', ')}
      WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx}
      RETURNING *
    `, ...updateParams)

    if (!updated.length) {
      return NextResponse.json({ error: 'Failed to update delivery order' }, { status: 500 })
    }

    const delivery = updated[0]

    // Audit log for field changes
    void writeDeliveryAuditLog({
      locationId,
      action: 'field_update',
      deliveryOrderId: id,
      employeeId: auth.employee.id,
      previousValue: previousValues,
      newValue: changes,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    pushUpstream()

    // Fire-and-forget socket dispatch
    void emitToLocation(locationId, 'delivery:updated', {
      action: 'updated',
      deliveryId: delivery.id,
      status: delivery.status,
      driverId: delivery.driverId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Emit driver_assigned event when driver changes
    if (driverId && driverId !== previousValues.driverId) {
      void dispatchDeliveryStatusChanged(locationId, delivery).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchDriverAssigned(locationId, {
        deliveryOrderId: id,
        orderId: delivery.orderId,
        driverId: delivery.driverId,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    return NextResponse.json({
      data: {
        ...delivery,
        deliveryFee: Number(delivery.deliveryFee),
      },
      message: 'Delivery order updated',
    })
  } catch (error) {
    console.error('[Delivery/Detail] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update delivery order' }, { status: 500 })
  }
})
