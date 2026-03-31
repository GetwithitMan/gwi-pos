import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { dispatchDriverLocationUpdate } from '@/lib/delivery/dispatch-events'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-driver-location')

export const dynamic = 'force-dynamic'

/** Minimum interval between GPS points (15 seconds) */
const MIN_INTERVAL_MS = 15_000

/**
 * POST /api/delivery/driver/location — GPS ping (batch write)
 *
 * Body: { points: [{ lat, lng, accuracy?, speed?, recordedAt }] }
 *
 * Supports batch GPS uploads from the driver device. Points are deduplicated
 * by enforcing a minimum 15s gap between consecutive recordings.
 * Updates the driver session's last known location and fires a socket event.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverAppProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { points } = body

    if (!Array.isArray(points) || points.length === 0) {
      return err('points array is required and must not be empty')
    }

    if (points.length > 100) {
      return err('Maximum 100 points per batch')
    }

    // Find driver + active session + active run
    const sessionRows: any[] = await db.$queryRaw`
      SELECT ds.id as "sessionId", dd.id as "driverId", dr.id as "runId"
      FROM "DeliveryDriverSession" ds
      JOIN "DeliveryDriver" dd ON dd.id = ds."driverId"
      LEFT JOIN "DeliveryRun" dr
        ON dr."driverId" = dd.id
        AND dr."locationId" = ${locationId}
        AND dr."status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress')
      WHERE dd."employeeId" = ${actor.employeeId}
        AND ds."locationId" = ${locationId}
        AND ds."endedAt" IS NULL
      ORDER BY ds."startedAt" DESC
      LIMIT 1
    `

    if (!sessionRows.length) {
      return notFound('No active driver session found')
    }

    const { sessionId, driverId, runId } = sessionRows[0]

    // Get the last recorded point to enforce minimum interval
    const lastPoints: any[] = await db.$queryRaw`
      SELECT "recordedAt" FROM "DeliveryTracking"
      WHERE "driverId" = ${driverId} AND "locationId" = ${locationId}
      ORDER BY "recordedAt" DESC
      LIMIT 1
    `

    let lastRecordedAt = lastPoints.length
      ? new Date(lastPoints[0].recordedAt).getTime()
      : 0

    // Validate, deduplicate, and sort points by recordedAt
    const validPoints: Array<{
      lat: number
      lng: number
      accuracy: number | null
      speed: number | null
      recordedAt: Date
    }> = []

    const sortedPoints = [...points].sort((a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    )

    for (const point of sortedPoints) {
      if (point.lat == null || point.lng == null || !point.recordedAt) continue

      const lat = Number(point.lat)
      const lng = Number(point.lng)
      if (isNaN(lat) || lat < -90 || lat > 90) continue
      if (isNaN(lng) || lng < -180 || lng > 180) continue

      const recordedAt = new Date(point.recordedAt)
      if (isNaN(recordedAt.getTime())) continue

      // Enforce minimum interval
      if (recordedAt.getTime() - lastRecordedAt < MIN_INTERVAL_MS) continue

      validPoints.push({
        lat,
        lng,
        accuracy: point.accuracy != null ? Number(point.accuracy) : null,
        speed: point.speed != null ? Number(point.speed) : null,
        recordedAt,
      })

      lastRecordedAt = recordedAt.getTime()
    }

    if (validPoints.length === 0) {
      return ok({ accepted: 0 })
    }

    // Bulk insert tracking points
    const valueClauses: string[] = []
    const insertParams: any[] = []
    let paramIdx = 1

    for (const p of validPoints) {
      valueClauses.push(
        `(gen_random_uuid()::text, $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
      )
      insertParams.push(
        locationId,
        driverId,
        runId || null,
        p.lat,
        p.lng,
        p.accuracy,
        p.speed,
        p.recordedAt,
      )
      paramIdx += 8
    }

    await db.$executeRaw`
      INSERT INTO "DeliveryTracking" (
        "id", "locationId", "driverId", "runId",
        "lat", "lng", "accuracy", "speed", "recordedAt"
      ) VALUES ${valueClauses.join(', ')}
    `

    // Update session last location with the most recent point
    const latest = validPoints[validPoints.length - 1]
    await db.$executeRaw`
      UPDATE "DeliveryDriverSession"
      SET "lastLocationLat" = ${latest.lat},
          "lastLocationLng" = ${latest.lng},
          "lastLocationAt" = ${latest.recordedAt},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${sessionId} AND "locationId" = ${locationId}
    `

    pushUpstream()

    // Fire socket event (fire-and-forget)
    void dispatchDriverLocationUpdate(locationId, {
      driverId,
      lat: latest.lat,
      lng: latest.lng,
      accuracy: latest.accuracy ?? undefined,
      speed: latest.speed ?? undefined,
      recordedAt: latest.recordedAt.toISOString(),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ accepted: validPoints.length })
  } catch (error) {
    console.error('[Delivery/Driver/Location] POST error:', error)
    return err('Failed to record GPS data', 500)
  }
})
