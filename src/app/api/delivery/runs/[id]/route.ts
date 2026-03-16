import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceRunStatus, writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { dispatchDeliveryStatusChanged } from '@/lib/delivery/dispatch-events'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/runs/[id] — Get run detail with orders and driver info
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
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Fetch run with driver info
    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT r.*,
             dd."vehicleInfo", dd."isSuspended", dd."employeeId" as "driverEmployeeId",
             e."firstName" as "driverFirstName", e."lastName" as "driverLastName", e."phone" as "driverPhone"
      FROM "DeliveryRun" r
      LEFT JOIN "DeliveryDriver" dd ON dd.id = r."driverId"
      LEFT JOIN "Employee" e ON e.id = dd."employeeId"
      WHERE r.id = $1 AND r."locationId" = $2
    `, id, locationId)

    if (!rows.length) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const run = rows[0]

    // Fetch orders in this run
    const orders: any[] = await db.$queryRawUnsafe(`
      SELECT d.*,
             o."orderNumber", o."guestCount", o."status" as "orderStatus",
             o."total" as "orderTotal"
      FROM "DeliveryOrder" d
      LEFT JOIN "Order" o ON o.id = d."orderId"
      WHERE d."runId" = $1
      ORDER BY d."runSequence" ASC NULLS LAST, d."createdAt" ASC
    `, id)

    const enrichedOrders = orders.map(o => ({
      ...o,
      deliveryFee: Number(o.deliveryFee),
    }))

    return NextResponse.json({
      run: {
        ...run,
        driverName: run.driverFirstName
          ? `${run.driverFirstName} ${run.driverLastName}`.trim()
          : null,
        driver: run.driverFirstName
          ? {
              id: run.driverId,
              employeeId: run.driverEmployeeId,
              name: `${run.driverFirstName} ${run.driverLastName}`.trim(),
              phone: run.driverPhone,
              vehicleInfo: run.vehicleInfo,
              isSuspended: run.isSuspended,
            }
          : null,
        orders: enrichedOrders,
      },
    })
  } catch (error) {
    console.error('[Delivery/Runs/Detail] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch run detail' }, { status: 500 })
  }
})

/**
 * PUT /api/delivery/runs/[id] — Update run (advance status, notes, odometer)
 *
 * Body: { status?, notes?, startOdometer?, endOdometer? }
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
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { status, notes, startOdometer, endOdometer } = body

    // Fetch existing run
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM "DeliveryRun" WHERE id = $1 AND "locationId" = $2`,
      id,
      locationId,
    )

    if (!existing.length) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const currentRun = existing[0]

    // Advance status via state machine if requested
    if (status) {
      const result = await advanceRunStatus({
        runId: id,
        locationId,
        newStatus: status,
        employeeId: actor.employeeId,
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      // If run status changes, cascade to orders where appropriate
      const orderStatusMap: Record<string, string | null> = {
        dispatched: 'dispatched',
        in_progress: 'en_route',
        completed: null, // orders complete individually
        cancelled: 'cancelled_before_dispatch',
      }

      const newOrderStatus = orderStatusMap[status]
      if (newOrderStatus) {
        // Fetch orders in this run that are not in terminal state
        const runOrders: any[] = await db.$queryRawUnsafe(
          `SELECT id, status FROM "DeliveryOrder"
           WHERE "runId" = $1 AND "locationId" = $2
             AND status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')`,
          id,
          locationId,
        )

        for (const order of runOrders) {
          // Only advance if the transition is valid for this order's current state
          const updated: any[] = await db.$queryRawUnsafe(
            `UPDATE "DeliveryOrder"
             SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
             WHERE id = $2 AND "locationId" = $3
             RETURNING *`,
            newOrderStatus,
            order.id,
            locationId,
          )
          if (updated.length > 0) {
            void dispatchDeliveryStatusChanged(locationId, updated[0]).catch(console.error)
          }
        }
      }
    }

    // Build additional field updates (notes, odometer)
    const extraUpdates: string[] = []
    const extraParams: any[] = []
    let paramIdx = 1

    if (notes !== undefined) {
      extraUpdates.push(`"notes" = $${paramIdx}`)
      extraParams.push(notes)
      paramIdx++
    }

    if (startOdometer !== undefined) {
      extraUpdates.push(`"startOdometer" = $${paramIdx}`)
      extraParams.push(Number(startOdometer))
      paramIdx++
    }

    if (endOdometer !== undefined) {
      extraUpdates.push(`"endOdometer" = $${paramIdx}`)
      extraParams.push(Number(endOdometer))
      paramIdx++

      // Calculate miles if both odometers are set
      const startOdo = startOdometer ?? currentRun.startOdometer
      if (startOdo != null) {
        const miles = Math.max(0, Number(endOdometer) - Number(startOdo))
        extraUpdates.push(`"calculatedMiles" = $${paramIdx}`)
        extraParams.push(miles)
        paramIdx++
      }
    }

    if (extraUpdates.length > 0) {
      extraUpdates.push(`"updatedAt" = CURRENT_TIMESTAMP`)
      const idParamIdx = paramIdx
      const locParamIdx = paramIdx + 1
      extraParams.push(id, locationId)

      await db.$queryRawUnsafe(
        `UPDATE "DeliveryRun" SET ${extraUpdates.join(', ')}
         WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx}`,
        ...extraParams,
      )
    }

    // Fetch the updated run
    const updatedRows: any[] = await db.$queryRawUnsafe(
      `SELECT r.*,
              dd."vehicleInfo", dd."isSuspended",
              e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
       FROM "DeliveryRun" r
       LEFT JOIN "DeliveryDriver" dd ON dd.id = r."driverId"
       LEFT JOIN "Employee" e ON e.id = dd."employeeId"
       WHERE r.id = $1 AND r."locationId" = $2`,
      id,
      locationId,
    )

    const updatedRun = updatedRows[0]

    return NextResponse.json({
      run: {
        ...updatedRun,
        driverName: updatedRun.driverFirstName
          ? `${updatedRun.driverFirstName} ${updatedRun.driverLastName}`.trim()
          : null,
      },
      message: status ? `Run status updated to ${status}` : 'Run updated',
    })
  } catch (error) {
    console.error('[Delivery/Runs/Detail] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update run' }, { status: 500 })
  }
})
