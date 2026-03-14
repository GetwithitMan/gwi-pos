import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

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
 * Status transitions: pending -> preparing -> ready_for_pickup -> out_for_delivery -> delivered
 *                     Any status -> cancelled
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

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { status, driverId, estimatedMinutes, notes, cancelReason } = body

    // Fetch existing
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryOrder"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Delivery order not found' }, { status: 404 })
    }

    const current = existing[0]

    // Build update fields
    const updates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: any[] = []
    let paramIdx = 1

    if (status) {
      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        pending: ['preparing', 'cancelled'],
        preparing: ['ready_for_pickup', 'cancelled'],
        ready_for_pickup: ['out_for_delivery', 'cancelled'],
        out_for_delivery: ['delivered', 'cancelled'],
        delivered: [],
        cancelled: [],
      }

      const allowed = validTransitions[current.status] || []
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `Cannot transition from '${current.status}' to '${status}'` },
          { status: 400 }
        )
      }

      updates.push(`"status" = $${paramIdx}`)
      updateParams.push(status)
      paramIdx++

      // Set timestamp fields based on status
      if (status === 'preparing') {
        updates.push(`"preparedAt" = CURRENT_TIMESTAMP`)
      } else if (status === 'ready_for_pickup') {
        updates.push(`"readyAt" = CURRENT_TIMESTAMP`)
      } else if (status === 'out_for_delivery') {
        updates.push(`"dispatchedAt" = CURRENT_TIMESTAMP`)
      } else if (status === 'delivered') {
        updates.push(`"deliveredAt" = CURRENT_TIMESTAMP`)
      } else if (status === 'cancelled') {
        updates.push(`"cancelledAt" = CURRENT_TIMESTAMP`)
        if (cancelReason) {
          updates.push(`"cancelReason" = $${paramIdx}`)
          updateParams.push(cancelReason)
          paramIdx++
        }
      }
    }

    if (driverId !== undefined) {
      updates.push(`"driverId" = $${paramIdx}`)
      updateParams.push(driverId || null)
      paramIdx++
    }

    if (estimatedMinutes !== undefined) {
      updates.push(`"estimatedMinutes" = $${paramIdx}`)
      updateParams.push(Number(estimatedMinutes))
      paramIdx++
    }

    if (notes !== undefined) {
      updates.push(`"notes" = $${paramIdx}`)
      updateParams.push(notes)
      paramIdx++
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

    // Fire-and-forget socket dispatch
    void emitToLocation(locationId, 'delivery:updated', {
      action: status ? `status_${status}` : 'updated',
      deliveryId: delivery.id,
      status: delivery.status,
      driverId: delivery.driverId,
    }).catch(console.error)

    return NextResponse.json({
      data: {
        ...delivery,
        deliveryFee: Number(delivery.deliveryFee),
      },
      message: status ? `Delivery status updated to ${status}` : 'Delivery order updated',
    })
  } catch (error) {
    console.error('[Delivery/Detail] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update delivery order' }, { status: 500 })
  }
})
