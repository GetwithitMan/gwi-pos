/**
 * GET /api/notifications/devices — List notification devices with status, assignment info, filtering
 * POST /api/notifications/devices — Add a new device to inventory
 *
 * Permission: GET = notifications.view_log, POST = notifications.manage_devices
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('notifications-devices')

export const dynamic = 'force-dynamic'

/**
 * GET /api/notifications/devices
 *
 * Query params:
 *   status — filter by device status (comma-separated)
 *   deviceType — filter by device type (e.g. 'pager', 'table_tracker')
 *   providerId — filter by provider
 *   assignedOnly — 'true' to show only assigned devices
 *   availableOnly — 'true' to show only available devices
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const searchParams = request.nextUrl.searchParams
    const statusFilter = searchParams.get('status')
    const deviceType = searchParams.get('deviceType')
    const providerId = searchParams.get('providerId')
    const assignedOnly = searchParams.get('assignedOnly') === 'true'
    const availableOnly = searchParams.get('availableOnly') === 'true'

    // Build dynamic WHERE clauses
    const conditions: string[] = [
      `d."locationId" = $1`,
      `d."deletedAt" IS NULL`,
    ]
    const params: unknown[] = [locationId]
    let paramIndex = 2

    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length > 0) {
        conditions.push(`d.status = ANY($${paramIndex}::text[])`)
        params.push(statuses)
        paramIndex++
      }
    }

    if (deviceType) {
      conditions.push(`d."deviceType" = $${paramIndex}`)
      params.push(deviceType)
      paramIndex++
    }

    if (providerId) {
      conditions.push(`d."providerId" = $${paramIndex}`)
      params.push(providerId)
      paramIndex++
    }

    if (assignedOnly) {
      conditions.push(`d.status = 'assigned'`)
    }

    if (availableOnly) {
      conditions.push(`d.status = 'available'`)
    }

    const whereClause = conditions.join(' AND ')

    const devices: any[] = await db.$queryRawUnsafe(
      `SELECT d.id, d."deviceNumber", d."humanLabel", d."deviceType", d.status,
              d."providerId", d."assignedToSubjectType", d."assignedToSubjectId",
              d."assignedAt", d."releasedAt", d."returnedAt",
              d."batteryLevel", d."lastSeenAt", d."lastSignalState",
              d."capcode", d."firmwareVersion", d."dockId", d."dockSlot",
              d.metadata, d."createdAt", d."updatedAt",
              p.name as "providerName", p."providerType"
       FROM "NotificationDevice" d
       LEFT JOIN "NotificationProvider" p ON p.id = d."providerId" AND p."deletedAt" IS NULL
       WHERE ${whereClause}
       ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC`,
      ...params
    )

    // Enrich assigned devices with subject info
    const enriched = await Promise.all(
      devices.map(async (device) => {
        let subjectInfo = null
        if (device.status === 'assigned' && device.assignedToSubjectType && device.assignedToSubjectId) {
          try {
            if (device.assignedToSubjectType === 'order') {
              const orders: any[] = await db.$queryRawUnsafe(
                `SELECT "orderNumber", "tabName", status FROM "Order" WHERE id = $1 AND "locationId" = $2`,
                device.assignedToSubjectId,
                locationId
              )
              if (orders[0]) {
                subjectInfo = {
                  type: 'order',
                  orderNumber: orders[0].orderNumber,
                  tabName: orders[0].tabName,
                  status: orders[0].status,
                }
              }
            } else if (device.assignedToSubjectType === 'waitlist_entry') {
              const entries: any[] = await db.$queryRawUnsafe(
                `SELECT "customerName", "partySize", status FROM "WaitlistEntry" WHERE id = $1 AND "locationId" = $2`,
                device.assignedToSubjectId,
                locationId
              )
              if (entries[0]) {
                subjectInfo = {
                  type: 'waitlist_entry',
                  customerName: entries[0].customerName,
                  partySize: entries[0].partySize,
                  status: entries[0].status,
                }
              }
            }
          } catch {
            // Non-fatal: subject may have been deleted
          }
        }
        return { ...device, subjectInfo }
      })
    )

    // Summary counts
    const countResult: any[] = await db.$queryRawUnsafe(
      `SELECT status, COUNT(*)::int as count
       FROM "NotificationDevice"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
       GROUP BY status`,
      locationId
    )

    const counts: Record<string, number> = {}
    for (const row of countResult) {
      counts[row.status] = row.count
    }

    return NextResponse.json({
      data: enriched,
      counts,
      total: enriched.length,
    })
  } catch (error) {
    console.error('[Notification Devices] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch devices' }, { status: 500 })
  }
})

/**
 * POST /api/notifications/devices
 *
 * Body:
 *   deviceNumber — string (required, e.g. "1", "42")
 *   deviceType — string (required, e.g. 'pager', 'table_tracker')
 *   providerId — string (required, must reference active provider)
 *   humanLabel — string (optional, e.g. "Red Pager #5")
 *   capcode — string (optional, POCSAG capcode for JTECH/LRS)
 *   metadata — object (optional)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { deviceNumber, deviceType, providerId, humanLabel, capcode, metadata } = body

    // Validate required fields
    if (!deviceNumber || typeof deviceNumber !== 'string' || deviceNumber.trim().length === 0) {
      return NextResponse.json({ error: 'deviceNumber is required' }, { status: 400 })
    }
    // W4: Validate deviceNumber format (1-4 digits only)
    if (!/^\d{1,4}$/.test(deviceNumber.trim())) {
      return NextResponse.json({ error: 'Device number must be 1-4 digits' }, { status: 400 })
    }
    if (!deviceType || typeof deviceType !== 'string') {
      return NextResponse.json({ error: 'deviceType is required' }, { status: 400 })
    }
    if (!providerId || typeof providerId !== 'string') {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 })
    }

    // Validate provider exists and is active
    const providers: any[] = await db.$queryRawUnsafe(
      `SELECT id, "providerType", name FROM "NotificationProvider"
       WHERE id = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
      providerId,
      locationId
    )
    if (providers.length === 0) {
      return NextResponse.json({ error: 'Provider not found or inactive' }, { status: 404 })
    }

    // Check for duplicate device number (active, non-retired/disabled)
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id FROM "NotificationDevice"
       WHERE "locationId" = $1
         AND "deviceNumber" = $2
         AND "deletedAt" IS NULL
         AND status NOT IN ('retired', 'disabled')`,
      locationId,
      deviceNumber.trim()
    )
    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Device number ${deviceNumber} already exists and is active` },
        { status: 409 }
      )
    }

    // Create the device
    const inserted: any[] = await db.$queryRawUnsafe(
      `INSERT INTO "NotificationDevice" (
        id, "locationId", "providerId", "deviceNumber", "humanLabel", "deviceType",
        status, capcode, metadata, "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5,
        'available', $6, $7::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, "deviceNumber", "humanLabel", "deviceType", status, "providerId",
                capcode, metadata, "createdAt"`,
      locationId,
      providerId,
      deviceNumber.trim(),
      humanLabel?.trim() || null,
      deviceType,
      capcode?.trim() || null,
      metadata ? JSON.stringify(metadata) : null
    )

    const device = inserted[0]

    // Log creation event
    void db.$executeRawUnsafe(
      `INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "employeeId", metadata, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'created', $3, $4::jsonb, CURRENT_TIMESTAMP)`,
      device.id,
      locationId,
      auth.employee.id,
      JSON.stringify({ deviceNumber: device.deviceNumber, deviceType, providerId })
    ).catch(err => log.warn({ err }, 'Background task failed'))

    // W13: AuditLog for device creation
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_device_created',
        entityType: 'notification_device',
        entityId: device.id,
        details: {
          deviceNumber: device.deviceNumber,
          deviceType,
          providerId,
          humanLabel: humanLabel?.trim() || null,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({ data: device }, { status: 201 })
  } catch (error) {
    console.error('[Notification Devices] POST error:', error)
    return NextResponse.json({ error: 'Failed to add device' }, { status: 500 })
  }
})
