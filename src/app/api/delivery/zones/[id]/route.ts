import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-zones')

export const dynamic = 'force-dynamic'

/** Strip HTML tags from user input */
function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * PUT /api/delivery/zones/[id] — Update a delivery zone
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

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_ZONES_MANAGE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Fetch existing zone
    const existing: any[] = await db.$queryRaw`
      SELECT * FROM "DeliveryZone"
      WHERE id = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
    `

    if (!existing.length) {
      return notFound('Delivery zone not found')
    }

    const current = existing[0]
    const body = await request.json()
    const {
      name,
      zoneType,
      deliveryFee,
      minimumOrder,
      estimatedMinutes,
      sortOrder,
      isActive,
      centerLat,
      centerLng,
      radiusMiles,
      polygonJson,
      zipCodes,
    } = body

    // --- Validation ---

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return err('Zone name is required')
      }
      const sanitized = sanitizeHtml(name)
      if (sanitized.length === 0) {
        return err('Zone name is required')
      }
    }

    const resolvedZoneType = zoneType ?? current.zoneType
    const validZoneTypes = ['radius', 'polygon', 'zipcode']
    if (zoneType !== undefined && !validZoneTypes.includes(zoneType)) {
      return err(`zoneType must be one of: ${validZoneTypes.join(', ')}`)
    }

    if (deliveryFee !== undefined) {
      const fee = Number(deliveryFee)
      if (isNaN(fee) || fee < 0) {
        return err('deliveryFee must be >= 0')
      }
    }

    if (minimumOrder !== undefined) {
      const minOrder = Number(minimumOrder)
      if (isNaN(minOrder) || minOrder < 0) {
        return err('minimumOrder must be >= 0')
      }
    }

    if (estimatedMinutes !== undefined) {
      const estMinutes = Number(estimatedMinutes)
      if (isNaN(estMinutes) || estMinutes <= 0) {
        return err('estimatedMinutes must be > 0')
      }
    }

    // Type-specific validation (applies to resolved zone type)
    if (resolvedZoneType === 'radius') {
      const lat = centerLat ?? current.centerLat
      const lng = centerLng ?? current.centerLng
      const radius = radiusMiles ?? current.radiusMiles
      if (lat == null || lng == null || radius == null) {
        return err('Radius zones require centerLat, centerLng, and radiusMiles')
      }
      if (centerLat !== undefined) {
        const v = Number(centerLat)
        if (isNaN(v) || v < -90 || v > 90) {
          return err('centerLat must be between -90 and 90')
        }
      }
      if (centerLng !== undefined) {
        const v = Number(centerLng)
        if (isNaN(v) || v < -180 || v > 180) {
          return err('centerLng must be between -180 and 180')
        }
      }
      if (radiusMiles !== undefined) {
        const v = Number(radiusMiles)
        if (isNaN(v) || v <= 0) {
          return err('radiusMiles must be > 0')
        }
      }
    }

    if (resolvedZoneType === 'polygon') {
      const poly = polygonJson ?? current.polygonJson
      if (!poly || typeof poly !== 'object') {
        return err('Polygon zones require polygonJson (valid GeoJSON)')
      }
      if (polygonJson !== undefined) {
        if (!polygonJson.type || !polygonJson.coordinates || !Array.isArray(polygonJson.coordinates)) {
          return err('polygonJson must be valid GeoJSON with type and coordinates')
        }
      }
    }

    if (resolvedZoneType === 'zipcode') {
      const zips = zipCodes ?? current.zipCodes
      if (!zips || !Array.isArray(zips) || zips.length === 0) {
        return err('Zipcode zones require a non-empty zipCodes array')
      }
      if (zipCodes !== undefined) {
        for (const zip of zipCodes) {
          if (typeof zip !== 'string' || zip.trim().length === 0) {
            return err('Each zipCode must be a non-empty string')
          }
        }
      }
    }

    // --- Build dynamic UPDATE ---

    const updates: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: any[] = []
    let paramIdx = 1

    if (name !== undefined) {
      updates.push(`"name" = $${paramIdx}`)
      updateParams.push(sanitizeHtml(name))
      paramIdx++
    }

    if (zoneType !== undefined) {
      updates.push(`"zoneType" = $${paramIdx}`)
      updateParams.push(zoneType)
      paramIdx++
    }

    if (deliveryFee !== undefined) {
      updates.push(`"deliveryFee" = $${paramIdx}`)
      updateParams.push(Number(deliveryFee))
      paramIdx++
    }

    if (minimumOrder !== undefined) {
      updates.push(`"minimumOrder" = $${paramIdx}`)
      updateParams.push(Number(minimumOrder))
      paramIdx++
    }

    if (estimatedMinutes !== undefined) {
      updates.push(`"estimatedMinutes" = $${paramIdx}`)
      updateParams.push(Number(estimatedMinutes))
      paramIdx++
    }

    if (sortOrder !== undefined) {
      updates.push(`"sortOrder" = $${paramIdx}`)
      updateParams.push(Number(sortOrder))
      paramIdx++
    }

    if (isActive !== undefined) {
      updates.push(`"isActive" = $${paramIdx}`)
      updateParams.push(Boolean(isActive))
      paramIdx++
    }

    if (centerLat !== undefined) {
      updates.push(`"centerLat" = $${paramIdx}`)
      updateParams.push(centerLat != null ? Number(centerLat) : null)
      paramIdx++
    }

    if (centerLng !== undefined) {
      updates.push(`"centerLng" = $${paramIdx}`)
      updateParams.push(centerLng != null ? Number(centerLng) : null)
      paramIdx++
    }

    if (radiusMiles !== undefined) {
      updates.push(`"radiusMiles" = $${paramIdx}`)
      updateParams.push(radiusMiles != null ? Number(radiusMiles) : null)
      paramIdx++
    }

    if (polygonJson !== undefined) {
      updates.push(`"polygonJson" = $${paramIdx}::jsonb`)
      updateParams.push(polygonJson != null ? JSON.stringify(polygonJson) : null)
      paramIdx++
    }

    if (zipCodes !== undefined) {
      updates.push(`"zipCodes" = $${paramIdx}::text[]`)
      updateParams.push(zipCodes != null ? zipCodes : null)
      paramIdx++
    }

    // Add id and locationId params at the end
    const idParamIdx = paramIdx
    const locParamIdx = paramIdx + 1
    updateParams.push(id, locationId)

    const updated: any[] = await db.$queryRaw`
      UPDATE "DeliveryZone"
      SET ${updates.join(', ')}
      WHERE id = $${idParamIdx} AND "locationId" = $${locParamIdx} AND "deletedAt" IS NULL
      RETURNING *
    `

    if (!updated.length) {
      return err('Failed to update delivery zone', 500)
    }

    const zone = updated[0]

    pushUpstream()

    // Fire-and-forget audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'zone_updated',
      employeeId: actor.employeeId ?? 'unknown',
      previousValue: { name: current.name, zoneType: current.zoneType },
      newValue: { id: zone.id, name: zone.name, zoneType: zone.zoneType },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
      zone: {
        ...zone,
        deliveryFee: Number(zone.deliveryFee),
        minimumOrder: Number(zone.minimumOrder),
        radiusMiles: zone.radiusMiles != null ? Number(zone.radiusMiles) : null,
        centerLat: zone.centerLat != null ? Number(zone.centerLat) : null,
        centerLng: zone.centerLng != null ? Number(zone.centerLng) : null,
      },
    })
  } catch (error) {
    console.error('[Delivery/Zones] PUT error:', error)
    return err('Failed to update delivery zone', 500)
  }
})

/**
 * DELETE /api/delivery/zones/[id] — Soft delete a delivery zone
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_ZONES_MANAGE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const deleted: any[] = await db.$queryRaw`
      UPDATE "DeliveryZone"
      SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      RETURNING *
    `

    if (!deleted.length) {
      return notFound('Delivery zone not found')
    }

    const zone = deleted[0]

    pushUpstream()

    // Fire-and-forget audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'zone_deleted',
      employeeId: actor.employeeId ?? 'unknown',
      previousValue: { id: zone.id, name: zone.name, zoneType: zone.zoneType },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true })
  } catch (error) {
    console.error('[Delivery/Zones] DELETE error:', error)
    return err('Failed to delete delivery zone', 500)
  }
})
