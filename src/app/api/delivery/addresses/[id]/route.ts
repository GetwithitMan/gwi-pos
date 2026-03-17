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
 * PUT /api/delivery/addresses/[id] — Update address (edit, flag, restrict)
 *
 * Body: partial address fields + isFlagged?, flagReason?, isRestricted?
 *
 * If address fields (address, city, state, zipCode) are changed, re-runs
 * zone lookup by zipcode. Writes audit log when flagging or restricting.
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
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Fetch existing
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryAddress"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    const current = existing[0]
    const body = await request.json()
    const {
      label,
      address,
      addressLine2,
      city,
      state,
      zipCode,
      phone,
      deliveryNotes,
      latitude,
      longitude,
      isDefault,
      isFlagged,
      flagReason,
      isRestricted,
    } = body

    // Build dynamic SET clauses
    const updates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: any[] = []
    let paramIdx = 1

    if (label !== undefined) {
      updates.push(`"label" = $${paramIdx}`)
      updateParams.push(label?.trim() || null)
      paramIdx++
    }

    if (address !== undefined) {
      updates.push(`"address" = $${paramIdx}`)
      updateParams.push(address?.trim() || null)
      paramIdx++
    }

    if (addressLine2 !== undefined) {
      updates.push(`"addressLine2" = $${paramIdx}`)
      updateParams.push(addressLine2?.trim() || null)
      paramIdx++
    }

    if (city !== undefined) {
      updates.push(`"city" = $${paramIdx}`)
      updateParams.push(city?.trim() || null)
      paramIdx++
    }

    if (state !== undefined) {
      updates.push(`"state" = $${paramIdx}`)
      updateParams.push(state?.trim() || null)
      paramIdx++
    }

    if (zipCode !== undefined) {
      updates.push(`"zipCode" = $${paramIdx}`)
      updateParams.push(zipCode?.trim() || null)
      paramIdx++
    }

    if (phone !== undefined) {
      updates.push(`"phone" = $${paramIdx}`)
      updateParams.push(phone?.trim() || null)
      paramIdx++
    }

    if (deliveryNotes !== undefined) {
      updates.push(`"deliveryNotes" = $${paramIdx}`)
      updateParams.push(deliveryNotes?.trim() || null)
      paramIdx++
    }

    if (latitude !== undefined) {
      updates.push(`"latitude" = $${paramIdx}`)
      updateParams.push(latitude != null ? Number(latitude) : null)
      paramIdx++
    }

    if (longitude !== undefined) {
      updates.push(`"longitude" = $${paramIdx}`)
      updateParams.push(longitude != null ? Number(longitude) : null)
      paramIdx++
    }

    if (isDefault !== undefined) {
      updates.push(`"isDefault" = $${paramIdx}`)
      updateParams.push(isDefault === true)
      paramIdx++

      // Clear other defaults for this customer
      if (isDefault && current.customerId) {
        await db.$executeRawUnsafe(`
          UPDATE "DeliveryAddress"
          SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "locationId" = $1 AND "customerId" = $2 AND id != $3 AND "isDefault" = true AND "deletedAt" IS NULL
        `, locationId, current.customerId, id)
      }
    }

    if (isFlagged !== undefined) {
      updates.push(`"isFlagged" = $${paramIdx}`)
      updateParams.push(isFlagged === true)
      paramIdx++
    }

    if (flagReason !== undefined) {
      updates.push(`"flagReason" = $${paramIdx}`)
      updateParams.push(flagReason?.trim() || null)
      paramIdx++
    }

    if (isRestricted !== undefined) {
      updates.push(`"isRestricted" = $${paramIdx}`)
      updateParams.push(isRestricted === true)
      paramIdx++
    }

    // Re-run zone lookup if address fields changed
    const addressChanged = address !== undefined || zipCode !== undefined || city !== undefined || state !== undefined
    if (addressChanged) {
      const effectiveZip = (zipCode?.trim() || current.zipCode || '').trim()
      if (effectiveZip) {
        const zones: any[] = await db.$queryRawUnsafe(`
          SELECT id FROM "DeliveryZone"
          WHERE "locationId" = $1
            AND "deletedAt" IS NULL
            AND "isActive" = true
            AND "zoneType" = 'zipcode'
            AND $2 = ANY("zipCodes")
          LIMIT 1
        `, locationId, effectiveZip)

        updates.push(`"zoneId" = $${paramIdx}`)
        updateParams.push(zones.length ? zones[0].id : null)
        paramIdx++
      }
    }

    // Add id and locationId params at the end
    const idIdx = paramIdx
    const locIdx = paramIdx + 1
    updateParams.push(id, locationId)

    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "DeliveryAddress"
      SET ${updates.join(', ')}
      WHERE id = $${idIdx} AND "locationId" = $${locIdx} AND "deletedAt" IS NULL
      RETURNING *
    `, ...updateParams)

    if (!updated.length) {
      return NextResponse.json({ error: 'Failed to update address' }, { status: 500 })
    }

    // Write audit log for flagging/restricting
    if (isFlagged !== undefined || isRestricted !== undefined) {
      void writeDeliveryAuditLog({
        locationId,
        action: isFlagged !== undefined ? 'address_flagged' : 'address_restricted',
        employeeId: actor.employeeId ?? 'unknown',
        previousValue: {
          isFlagged: current.isFlagged,
          isRestricted: current.isRestricted,
        },
        newValue: {
          isFlagged: isFlagged ?? current.isFlagged,
          isRestricted: isRestricted ?? current.isRestricted,
          flagReason: flagReason ?? current.flagReason,
        },
        reason: flagReason || undefined,
      }).catch(console.error)
    }

    const saved = updated[0]

    return NextResponse.json({
      address: {
        ...saved,
        latitude: saved.latitude != null ? Number(saved.latitude) : null,
        longitude: saved.longitude != null ? Number(saved.longitude) : null,
      },
    })
  } catch (error) {
    console.error('[Delivery/Addresses] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update address' }, { status: 500 })
  }
})

/**
 * DELETE /api/delivery/addresses/[id] — Soft delete an address
 */
export const DELETE = withVenue(async function DELETE(
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
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const result = await db.$executeRawUnsafe(`
      UPDATE "DeliveryAddress"
      SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
    `, id, locationId)

    if (result === 0) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Delivery/Addresses] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete address' }, { status: 500 })
  }
})
