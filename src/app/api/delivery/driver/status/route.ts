import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDriverSessionStatus } from '@/lib/delivery/state-machine'
import { dispatchDriverLocationUpdate } from '@/lib/delivery/dispatch-events'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('delivery-driver-status')

export const dynamic = 'force-dynamic'

/**
 * PUT /api/delivery/driver/status — Update driver status + GPS
 *
 * Body: { status?, lat?, lng?, accuracy?, speed? }
 *
 * If status is provided, advances the driver session through the state machine.
 * If GPS data is provided, updates the session's last known location.
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverAppProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { status, lat, lng, accuracy, speed } = body

    if (!status && lat == null && lng == null) {
      return NextResponse.json({ error: 'Provide status and/or GPS data (lat, lng)' }, { status: 400 })
    }

    // Find driver's active session
    const sessions: any[] = await db.$queryRawUnsafe(`
      SELECT ds.* FROM "DeliveryDriverSession" ds
      JOIN "DeliveryDriver" dd ON dd.id = ds."driverId"
      WHERE dd."employeeId" = $1
        AND ds."locationId" = $2
        AND ds."endedAt" IS NULL
      ORDER BY ds."startedAt" DESC
      LIMIT 1
    `, actor.employeeId, locationId)

    if (!sessions.length) {
      return NextResponse.json({ error: 'No active driver session found' }, { status: 404 })
    }

    let session = sessions[0]

    // Advance status through state machine if requested
    if (status) {
      const result = await advanceDriverSessionStatus(
        session.id,
        locationId,
        status,
        actor.employeeId ?? 'unknown',
      )
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      session = result.session
    }

    // Update GPS data if provided
    if (lat != null && lng != null) {
      const latNum = Number(lat)
      const lngNum = Number(lng)
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return NextResponse.json({ error: 'lat must be between -90 and 90' }, { status: 400 })
      }
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        return NextResponse.json({ error: 'lng must be between -180 and 180' }, { status: 400 })
      }

      const updated: any[] = await db.$queryRawUnsafe(`
        UPDATE "DeliveryDriverSession"
        SET "lastLocationLat" = $1,
            "lastLocationLng" = $2,
            "lastLocationAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $3 AND "locationId" = $4
        RETURNING *
      `, latNum, lngNum, session.id, locationId)

      if (updated.length) {
        session = updated[0]

        // Fire socket event for real-time map tracking
        void dispatchDriverLocationUpdate(locationId, {
          driverId: session.driverId,
          lat: latNum,
          lng: lngNum,
          recordedAt: new Date().toISOString(),
        }).catch(err => log.warn({ err }, 'GPS location dispatch failed'))
      }
    }

    return NextResponse.json({
      session: {
        id: session.id,
        driverId: session.driverId,
        status: session.status,
        lastLocationLat: session.lastLocationLat != null ? Number(session.lastLocationLat) : null,
        lastLocationLng: session.lastLocationLng != null ? Number(session.lastLocationLng) : null,
        lastLocationAt: session.lastLocationAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        updatedAt: session.updatedAt,
      },
    })
  } catch (error) {
    console.error('[Delivery/Driver/Status] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 })
  }
})
