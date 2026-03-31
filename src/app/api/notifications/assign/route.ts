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
import { createChildLogger } from '@/lib/logger'
import { created, err } from '@/lib/api-response'
const log = createChildLogger('notifications-assign')

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
 *   replaceExisting — boolean (optional, release current pager and reassign)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ASSIGN_DEVICE)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { subjectType, subjectId, deviceType = 'pager', providerId, deviceNumber, replaceExisting } = body

    // Validate inputs
    if (!subjectType || !VALID_SUBJECT_TYPES.includes(subjectType)) {
      return err(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)
    }
    if (!subjectId || typeof subjectId !== 'string') {
      return err('subjectId is required')
    }

    // W4: Validate deviceNumber format (1-4 digits only)
    if (deviceNumber && !/^\d{1,4}$/.test(deviceNumber)) {
      return err('Device number must be 1-4 digits')
    }

    // W6: Move pre-check inside the transaction to prevent race conditions
    // Transactional auto-assign with FOR UPDATE SKIP LOCKED
    const result = await db.$transaction(async (tx) => {
      // Check if subject already has an active assignment of this target family (inside tx)
      const existingAssignment: any[] = await tx.$queryRaw`SELECT nta.id, nta."targetValue", nta."targetType"
         FROM "NotificationTargetAssignment" nta
         WHERE nta."locationId" = ${locationId}
           AND nta."subjectType" = ${subjectType}
           AND nta."subjectId" = ${subjectId}
           AND nta.status = 'active'
           AND nta."targetType" IN ('guest_pager', 'staff_pager')`

      if (existingAssignment.length > 0) {
        if (!replaceExisting) {
          return {
            alreadyAssigned: true as const,
            deviceNumber: existingAssignment[0].targetValue,
            assignmentId: existingAssignment[0].id,
          }
        }

        // Release the old pager assignment atomically within this transaction
        const oldDeviceNumber = existingAssignment[0].targetValue

        // 1. Release the target assignment
        await tx.$executeRaw`UPDATE "NotificationTargetAssignment"
           SET status = 'released',
               "releasedAt" = CURRENT_TIMESTAMP,
               "releaseReason" = 'replaced',
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = ${locationId}
             AND "subjectType" = ${subjectType}
             AND "subjectId" = ${subjectId}
             AND status = 'active'
             AND "targetType" IN ('guest_pager', 'staff_pager')`

        // 2. Mark the old device as released
        const oldDevices: any[] = await tx.$queryRaw`UPDATE "NotificationDevice"
           SET status = 'released',
               "releasedAt" = CURRENT_TIMESTAMP,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = ${locationId}
             AND "deviceNumber" = ${oldDeviceNumber}
             AND status = 'assigned'
             AND "assignedToSubjectType" = ${subjectType}
             AND "assignedToSubjectId" = ${subjectId}
             AND "deletedAt" IS NULL
           RETURNING id`

        // 3. Clear pagerNumber cache on the subject
        if (subjectType === 'order') {
          await tx.$executeRaw`UPDATE "Order" SET "pagerNumber" = NULL WHERE id = ${subjectId} AND "locationId" = ${locationId}`
        } else if (subjectType === 'waitlist_entry') {
          await tx.$executeRaw`UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = ${subjectId} AND "locationId" = ${locationId}`
        }

        // 4. Log the release event
        if (oldDevices.length > 0) {
          await tx.$executeRaw`INSERT INTO "NotificationDeviceEvent" (
              id, "deviceId", "locationId", "eventType",
              "subjectType", "subjectId", "employeeId", metadata, "createdAt"
            ) VALUES (
              gen_random_uuid()::text, ${oldDevices[0].id}, ${locationId}, 'released',
              ${subjectType}, ${subjectId}, ${auth.employee.id}, ${JSON.stringify({ reason: 'replaced', oldDeviceNumber, replaceExisting: true })}::jsonb, CURRENT_TIMESTAMP
            )`
        }
      }

      let device: any

      if (deviceNumber) {
        // Specific device requested
        const devices: any[] = await tx.$queryRaw`SELECT id, "deviceNumber", "providerId", "deviceType"
           FROM "NotificationDevice"
           WHERE "locationId" = ${locationId}
             AND "deviceNumber" = ${deviceNumber}
             AND "deviceType" = ${deviceType}
             AND status = 'available'
             AND "deletedAt" IS NULL
           FOR UPDATE SKIP LOCKED
           LIMIT 1`
        device = devices[0]
        if (!device) {
          throw { code: 'DEVICE_UNAVAILABLE', message: `Device ${deviceNumber} is not available` }
        }
      } else {
        // Auto-select lowest-numbered available device
        // Use parameterized query to prevent SQL injection on providerId
        const devices: any[] = providerId
          ? await tx.$queryRaw`SELECT id, "deviceNumber", "providerId", "deviceType"
               FROM "NotificationDevice" d
               WHERE d."locationId" = ${locationId}
                 AND d."deviceType" = ${deviceType}
                 AND d.status = 'available'
                 AND d."deletedAt" IS NULL
                 AND d."providerId" = ${providerId}
               ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1`
          : await tx.$queryRaw`SELECT id, "deviceNumber", "providerId", "deviceType"
               FROM "NotificationDevice" d
               WHERE d."locationId" = ${locationId}
                 AND d."deviceType" = ${deviceType}
                 AND d.status = 'available'
                 AND d."deletedAt" IS NULL
               ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1`
        device = devices[0]
        if (!device) {
          throw { code: 'NO_DEVICES_AVAILABLE', message: `No ${deviceType} devices available` }
        }
      }

      // Update device to assigned
      await tx.$executeRaw`UPDATE "NotificationDevice"
         SET status = 'assigned',
             "assignedToSubjectType" = ${subjectType},
             "assignedToSubjectId" = ${subjectId},
             "assignedAt" = CURRENT_TIMESTAMP,
             "releasedAt" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = ${device.id} AND "locationId" = ${locationId}`

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
        await tx.$executeRaw`UPDATE "NotificationTargetAssignment"
           SET "isPrimary" = false, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = ${locationId}
             AND "subjectType" = ${subjectType}
             AND "subjectId" = ${subjectId}
             AND "targetType" = ANY(${familyTypes}::text[])
             AND status = 'active'
             AND "isPrimary" = true`
      }

      // Create the target assignment
      const assignments: any[] = await tx.$queryRaw`INSERT INTO "NotificationTargetAssignment" (
          id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
          "providerId", priority, "isPrimary", source, status,
          "assignedAt", "createdByEmployeeId", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, ${locationId}, ${subjectType}, ${subjectId}, ${targetType}, ${device.deviceNumber},
          ${device.providerId}, 0, true, 'auto_assign', 'active',
          CURRENT_TIMESTAMP, ${auth.employee.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING id, "targetType", "targetValue", "isPrimary"`

      // Sync pagerNumber cache on the subject
      if (subjectType === 'order') {
        await tx.$executeRaw`UPDATE "Order" SET "pagerNumber" = ${device.deviceNumber} WHERE id = ${subjectId} AND "locationId" = ${locationId}`
      } else if (subjectType === 'waitlist_entry') {
        await tx.$executeRaw`UPDATE "WaitlistEntry" SET "pagerNumber" = ${device.deviceNumber} WHERE id = ${subjectId} AND "locationId" = ${locationId}`
      }

      // Log device event
      await tx.$executeRaw`INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${device.id}, ${locationId}, 'assigned',
          ${subjectType}, ${subjectId}, ${auth.employee.id}, ${JSON.stringify({ autoAssign: true, deviceNumber: device.deviceNumber, replaceExisting: !!replaceExisting })}::jsonb, CURRENT_TIMESTAMP
        )`

      return {
        assignmentId: assignments[0].id,
        deviceId: device.id,
        deviceNumber: device.deviceNumber,
        targetType,
        subjectType,
        subjectId,
        replacedDeviceNumber: existingAssignment.length > 0 ? existingAssignment[0].targetValue : undefined,
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

    // Audit log: notification_device_assigned
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_device_assigned',
        entityType: result.subjectType,
        entityId: result.subjectId,
        details: {
          assignmentId: result.assignmentId,
          deviceId: result.deviceId,
          deviceNumber: result.deviceNumber,
          targetType: result.targetType,
          replaceExisting: !!replaceExisting,
          replacedDeviceNumber: result.replacedDeviceNumber ?? null,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return created(result)
  } catch (error: any) {
    if (error?.code === 'DEVICE_UNAVAILABLE' || error?.code === 'NO_DEVICES_AVAILABLE') {
      return err(error.message, 409)
    }
    console.error('[Notification Assign] POST error:', error)
    return err('Failed to assign device', 500)
  }
})
