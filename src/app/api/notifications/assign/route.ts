/**
 * POST /api/notifications/assign — Auto-assign a notification device to a subject
 *
 * Transactional with FOR UPDATE SKIP LOCKED to prevent double-assign.
 * Creates NotificationTargetAssignment, updates device status, syncs cache fields.
 *
 * Permission: pos.assign_device
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getTargetFamily } from '@/lib/notifications/device-state-machine'

export const dynamic = 'force-dynamic'

const VALID_SUBJECT_TYPES = ['order', 'waitlist_entry', 'reservation', 'staff_task']

/**
 * POST /api/notifications/assign
 *
 * Body:
 *   subjectType — 'order' | 'waitlist_entry' | 'reservation' | 'staff_task' (required)
 *   subjectId — string (required)
 *   deviceType — string (optional, default 'pager')
 *   providerId — string (optional, use specific provider)
 *   deviceNumber — string (optional, request specific device number)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ASSIGN_DEVICE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { subjectType, subjectId, deviceType = 'pager', providerId, deviceNumber } = body

    // Validate inputs
    if (!subjectType || !VALID_SUBJECT_TYPES.includes(subjectType)) {
      return NextResponse.json(
        { error: `subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!subjectId || typeof subjectId !== 'string') {
      return NextResponse.json({ error: 'subjectId is required' }, { status: 400 })
    }

    // W6: Move pre-check inside the transaction to prevent race conditions
    // Transactional auto-assign with FOR UPDATE SKIP LOCKED
    const result = await db.$transaction(async (tx) => {
      // Check if subject already has an active assignment of this target family (inside tx)
      const existingAssignment: any[] = await tx.$queryRawUnsafe(
        `SELECT id, "targetValue", "targetType"
         FROM "NotificationTargetAssignment"
         WHERE "locationId" = $1
           AND "subjectType" = $2
           AND "subjectId" = $3
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')`,
        locationId,
        subjectType,
        subjectId
      )

      if (existingAssignment.length > 0) {
        return {
          alreadyAssigned: true as const,
          deviceNumber: existingAssignment[0].targetValue,
          assignmentId: existingAssignment[0].id,
        }
      }
      let device: any

      if (deviceNumber) {
        // Specific device requested
        const devices: any[] = await tx.$queryRawUnsafe(
          `SELECT id, "deviceNumber", "providerId", "deviceType"
           FROM "NotificationDevice"
           WHERE "locationId" = $1
             AND "deviceNumber" = $2
             AND "deviceType" = $3
             AND status = 'available'
             AND "deletedAt" IS NULL
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          locationId,
          deviceNumber,
          deviceType
        )
        device = devices[0]
        if (!device) {
          throw { code: 'DEVICE_UNAVAILABLE', message: `Device ${deviceNumber} is not available` }
        }
      } else {
        // Auto-select lowest-numbered available device
        // Use parameterized query to prevent SQL injection on providerId
        const devices: any[] = providerId
          ? await tx.$queryRawUnsafe(
              `SELECT id, "deviceNumber", "providerId", "deviceType"
               FROM "NotificationDevice" d
               WHERE d."locationId" = $1
                 AND d."deviceType" = $2
                 AND d.status = 'available'
                 AND d."deletedAt" IS NULL
                 AND d."providerId" = $3
               ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1`,
              locationId,
              deviceType,
              providerId
            )
          : await tx.$queryRawUnsafe(
              `SELECT id, "deviceNumber", "providerId", "deviceType"
               FROM "NotificationDevice" d
               WHERE d."locationId" = $1
                 AND d."deviceType" = $2
                 AND d.status = 'available'
                 AND d."deletedAt" IS NULL
               ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1`,
              locationId,
              deviceType
            )
        device = devices[0]
        if (!device) {
          throw { code: 'NO_DEVICES_AVAILABLE', message: `No ${deviceType} devices available` }
        }
      }

      // Update device to assigned
      await tx.$executeRawUnsafe(
        `UPDATE "NotificationDevice"
         SET status = 'assigned',
             "assignedToSubjectType" = $3,
             "assignedToSubjectId" = $4,
             "assignedAt" = CURRENT_TIMESTAMP,
             "releasedAt" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND "locationId" = $2`,
        device.id,
        locationId,
        subjectType,
        subjectId
      )

      // Determine target type based on subject type
      const targetType = subjectType === 'staff_task' ? 'staff_pager' : 'guest_pager'

      // Unset any existing primary in the same family for this subject
      const family = getTargetFamily(targetType)
      const familyTypes = Object.entries(
        { guest_pager: 'pager', staff_pager: 'pager', phone_sms: 'phone', phone_voice: 'phone', order_screen: 'display', table_locator: 'location' }
      )
        .filter(([, f]) => f === family)
        .map(([t]) => t)

      if (familyTypes.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE "NotificationTargetAssignment"
           SET "isPrimary" = false, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = $1
             AND "subjectType" = $2
             AND "subjectId" = $3
             AND "targetType" = ANY($4::text[])
             AND status = 'active'
             AND "isPrimary" = true`,
          locationId,
          subjectType,
          subjectId,
          familyTypes
        )
      }

      // Create the target assignment
      const assignments: any[] = await tx.$queryRawUnsafe(
        `INSERT INTO "NotificationTargetAssignment" (
          id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
          "providerId", priority, "isPrimary", source, status,
          "assignedAt", "createdByEmployeeId", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5,
          $6, 0, true, 'auto_assign', 'active',
          CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING id, "targetType", "targetValue", "isPrimary"`,
        locationId,
        subjectType,
        subjectId,
        targetType,
        device.deviceNumber,
        device.providerId,
        auth.employee.id
      )

      // Sync pagerNumber cache on the subject
      if (subjectType === 'order') {
        await tx.$executeRawUnsafe(
          `UPDATE "Order" SET "pagerNumber" = $2 WHERE id = $1 AND "locationId" = $3`,
          subjectId,
          device.deviceNumber,
          locationId
        )
      } else if (subjectType === 'waitlist_entry') {
        await tx.$executeRawUnsafe(
          `UPDATE "WaitlistEntry" SET "pagerNumber" = $2 WHERE id = $1 AND "locationId" = $3`,
          subjectId,
          device.deviceNumber,
          locationId
        )
      }

      // Log device event
      await tx.$executeRawUnsafe(
        `INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, 'assigned',
          $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP
        )`,
        device.id,
        locationId,
        subjectType,
        subjectId,
        auth.employee.id,
        JSON.stringify({ autoAssign: true, deviceNumber: device.deviceNumber })
      )

      return {
        assignmentId: assignments[0].id,
        deviceId: device.id,
        deviceNumber: device.deviceNumber,
        targetType,
        subjectType,
        subjectId,
      }
    })

    // Handle alreadyAssigned case from inside the transaction
    if ('alreadyAssigned' in result && result.alreadyAssigned) {
      return NextResponse.json({
        data: {
          alreadyAssigned: true,
          deviceNumber: result.deviceNumber,
          assignmentId: result.assignmentId,
        },
        warning: `Subject already has pager ${result.deviceNumber} assigned`,
      })
    }

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'DEVICE_UNAVAILABLE' || error?.code === 'NO_DEVICES_AVAILABLE') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[Notification Assign] POST error:', error)
    return NextResponse.json({ error: 'Failed to assign device' }, { status: 500 })
  }
})
