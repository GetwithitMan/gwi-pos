import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/drivers/[id] — Get driver detail with documents and stats
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

    // Fetch driver with employee info
    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT dd.*,
             e."firstName" as "employeeFirstName",
             e."lastName" as "employeeLastName",
             e."displayName" as "employeeDisplayName",
             e."phone" as "employeePhone",
             e."email" as "employeeEmail"
      FROM "DeliveryDriver" dd
      LEFT JOIN "Employee" e ON e.id = dd."employeeId"
      WHERE dd.id = $1 AND dd."locationId" = $2 AND dd."deletedAt" IS NULL
    `, id, locationId)

    if (!rows.length) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    const row = rows[0]

    // Count total deliveries completed by this driver
    const deliveryCounts: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as "totalDeliveries"
      FROM "DeliveryOrder"
      WHERE "driverId" = $1 AND "locationId" = $2 AND "status" = 'delivered'
    `, row.employeeId, locationId)

    // Get active session if any
    const activeSessions: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriverSession"
      WHERE "driverId" = $1 AND "locationId" = $2 AND "endedAt" IS NULL
      LIMIT 1
    `, id, locationId)

    // Get documents
    const documents: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriverDocument"
      WHERE "driverId" = $1 AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `, id)

    const driver = {
      ...row,
      mileageRateOverride: row.mileageRateOverride != null ? Number(row.mileageRateOverride) : null,
      employeeName: row.employeeFirstName
        ? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
        : null,
      employeeDisplayName: row.employeeDisplayName,
      employeePhone: row.employeePhone,
      employeeEmail: row.employeeEmail,
      totalDeliveries: deliveryCounts[0]?.totalDeliveries ?? 0,
      activeSession: activeSessions.length ? activeSessions[0] : null,
      documents,
    }

    return NextResponse.json({ driver })
  } catch (error) {
    console.error('[Delivery/Drivers/Detail] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch driver' }, { status: 500 })
  }
})

/**
 * PUT /api/delivery/drivers/[id] — Update driver profile (including suspend/unsuspend)
 *
 * Body: { vehicleType?, vehicleMake?, vehicleModel?, vehicleColor?, licensePlate?,
 *         mileageRateOverride?, preferredZoneIds?, isActive?, isSuspended?, suspendedReason? }
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
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DRIVERS_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const {
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleColor,
      licensePlate,
      mileageRateOverride,
      preferredZoneIds,
      isActive,
      isSuspended,
      suspendedReason,
    } = body

    // Validate vehicleType if provided
    const VALID_VEHICLE_TYPES = ['car', 'bike', 'scooter', 'other'] as const
    if (vehicleType != null && vehicleType !== '' && !(VALID_VEHICLE_TYPES as readonly string[]).includes(vehicleType)) {
      return NextResponse.json({ error: 'vehicleType must be one of: car, bike, scooter, other' }, { status: 400 })
    }

    // Fetch existing driver
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriver"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    const current = existing[0]

    // Build update fields
    const updates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: any[] = []
    let paramIdx = 1

    if (vehicleType !== undefined) {
      updates.push(`"vehicleType" = $${paramIdx}`)
      updateParams.push(vehicleType?.trim() || null)
      paramIdx++
    }

    if (vehicleMake !== undefined) {
      updates.push(`"vehicleMake" = $${paramIdx}`)
      updateParams.push(vehicleMake?.trim() || null)
      paramIdx++
    }

    if (vehicleModel !== undefined) {
      updates.push(`"vehicleModel" = $${paramIdx}`)
      updateParams.push(vehicleModel?.trim() || null)
      paramIdx++
    }

    if (vehicleColor !== undefined) {
      updates.push(`"vehicleColor" = $${paramIdx}`)
      updateParams.push(vehicleColor?.trim() || null)
      paramIdx++
    }

    if (licensePlate !== undefined) {
      updates.push(`"licensePlate" = $${paramIdx}`)
      updateParams.push(licensePlate?.trim() || null)
      paramIdx++
    }

    if (mileageRateOverride !== undefined) {
      updates.push(`"mileageRateOverride" = $${paramIdx}`)
      updateParams.push(mileageRateOverride != null ? Number(mileageRateOverride) : null)
      paramIdx++
    }

    if (preferredZoneIds !== undefined) {
      updates.push(`"preferredZoneIds" = $${paramIdx}::text[]`)
      updateParams.push(preferredZoneIds?.length ? `{${preferredZoneIds.join(',')}}` : null)
      paramIdx++
    }

    if (isActive !== undefined) {
      updates.push(`"isActive" = $${paramIdx}`)
      updateParams.push(!!isActive)
      paramIdx++
    }

    // Handle suspend/unsuspend
    if (isSuspended !== undefined) {
      const wasSuspended = current.isSuspended

      if (isSuspended && !wasSuspended) {
        // Suspending
        updates.push(`"isSuspended" = true`)
        updates.push(`"suspendedAt" = CURRENT_TIMESTAMP`)
        updates.push(`"suspendedReason" = $${paramIdx}`)
        updateParams.push(suspendedReason?.trim() || null)
        paramIdx++
      } else if (!isSuspended && wasSuspended) {
        // Unsuspending
        updates.push(`"isSuspended" = false`)
        updates.push(`"suspendedAt" = NULL`)
        updates.push(`"suspendedReason" = NULL`)
      }
    }

    // Add id and locationId params at the end
    const idParamIdx = paramIdx
    const locParamIdx = paramIdx + 1
    updateParams.push(id, locationId)

    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryDriver"
      SET ${updates.join(', ')}
      WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx}
      RETURNING *
    `, ...updateParams)

    if (!updated.length) {
      return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 })
    }

    // Write audit log for suspend/unsuspend actions
    if (isSuspended !== undefined && isSuspended !== current.isSuspended) {
      const action = isSuspended ? 'driver_suspended' : 'driver_unsuspended'
      void writeDeliveryAuditLog({
        locationId,
        action,
        driverId: id,
        employeeId: auth.authorized ? auth.employee.id : '',
        previousValue: { isSuspended: current.isSuspended, suspendedReason: current.suspendedReason },
        newValue: { isSuspended: !!isSuspended, suspendedReason: suspendedReason || null },
        reason: suspendedReason || undefined,
      }).catch(console.error)
    }

    return NextResponse.json({
      driver: {
        ...updated[0],
        mileageRateOverride: updated[0].mileageRateOverride != null ? Number(updated[0].mileageRateOverride) : null,
      },
    })
  } catch (error) {
    console.error('[Delivery/Drivers/Detail] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 })
  }
})
