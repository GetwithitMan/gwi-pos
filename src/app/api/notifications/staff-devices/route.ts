/**
 * Staff Device Binding API
 *
 * GET  /api/notifications/staff-devices — List staff device assignments for the location
 * POST /api/notifications/staff-devices — Bind a pager to an employee
 * DELETE /api/notifications/staff-devices — Unbind (release assignment, mark device available)
 *
 * Creates NotificationDevice with deviceType: 'staff_pager'
 * and NotificationTargetAssignment with subjectType: 'staff_task', targetType: 'staff_pager'
 *
 * Permission: notifications.manage_devices
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('notifications-staff-devices')

export const dynamic = 'force-dynamic'

// ─── GET — List staff device assignments ────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Get all staff pager assignments with device + employee info
    const assignments: any[] = await db.$queryRaw`SELECT
        ta.id as "assignmentId",
        ta."subjectId" as "employeeId",
        ta."targetValue" as "deviceNumber",
        ta.status as "assignmentStatus",
        ta."assignedAt",
        ta."releasedAt",
        ta."createdByEmployeeId",
        d.id as "deviceId",
        d."humanLabel",
        d.status as "deviceStatus",
        d."batteryLevel",
        d."lastSeenAt",
        e."firstName",
        e."lastName",
        e.role as "employeeRole"
      FROM "NotificationTargetAssignment" ta
      LEFT JOIN "NotificationDevice" d
        ON d."locationId" = ta."locationId"
        AND d."deviceNumber" = ta."targetValue"
        AND d."deviceType" = 'staff_pager'
        AND d."deletedAt" IS NULL
      LEFT JOIN "Employee" e
        ON e.id = ta."subjectId"
        AND e."locationId" = ta."locationId"
        AND e."deletedAt" IS NULL
      WHERE ta."locationId" = ${locationId}
        AND ta."subjectType" = 'staff_task'
        AND ta."targetType" = 'staff_pager'
      ORDER BY ta.status ASC, ta."assignedAt" DESC`

    // Also get available staff pager devices (not currently assigned)
    const availableDevices: any[] = await db.$queryRaw`SELECT d.id, d."deviceNumber", d."humanLabel", d.status, d."batteryLevel", d."lastSeenAt"
       FROM "NotificationDevice" d
       WHERE d."locationId" = ${locationId}
         AND d."deviceType" = 'staff_pager'
         AND d.status = 'available'
         AND d."deletedAt" IS NULL
       ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC`

    return ok({
        assignments: assignments.map(a => ({
          assignmentId: a.assignmentId,
          employeeId: a.employeeId,
          employeeName: a.firstName && a.lastName
            ? `${a.firstName} ${a.lastName}`
            : a.firstName || a.employeeId,
          employeeRole: a.employeeRole,
          deviceNumber: a.deviceNumber,
          deviceId: a.deviceId,
          humanLabel: a.humanLabel,
          assignmentStatus: a.assignmentStatus,
          deviceStatus: a.deviceStatus,
          batteryLevel: a.batteryLevel,
          lastSeenAt: a.lastSeenAt,
          assignedAt: a.assignedAt,
          releasedAt: a.releasedAt,
          createdByEmployeeId: a.createdByEmployeeId,
        })),
        availableDevices,
      })
  } catch (error) {
    console.error('[Staff Devices] GET error:', error)
    return err('Failed to fetch staff device assignments', 500)
  }
})

// ─── POST — Bind a pager to an employee ─────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { employeeId, deviceNumber, deviceType } = body

    // Validate required fields
    if (!employeeId || typeof employeeId !== 'string') {
      return err('employeeId is required')
    }
    if (!deviceNumber || typeof deviceNumber !== 'string') {
      return err('deviceNumber is required')
    }
    if (deviceType && deviceType !== 'staff_pager') {
      return err('deviceType must be "staff_pager"')
    }

    // Validate employee exists at this location
    const employees: any[] = await db.$queryRaw`SELECT id, "firstName", "lastName", role
       FROM "Employee"
       WHERE id = ${employeeId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL`
    if (employees.length === 0) {
      return notFound('Employee not found')
    }
    const employee = employees[0]

    // Check if employee already has an active staff pager assignment
    const existingAssignment: any[] = await db.$queryRaw`SELECT id, "targetValue"
       FROM "NotificationTargetAssignment"
       WHERE "locationId" = ${locationId}
         AND "subjectType" = 'staff_task'
         AND "subjectId" = ${employeeId}
         AND "targetType" = 'staff_pager'
         AND status = 'active'
       LIMIT 1`
    if (existingAssignment.length > 0) {
      return err(`Employee already has pager ${existingAssignment[0].targetValue} assigned. Unbind first.`, 409)
    }

    // W4: Wrap device update, assignment creation, and event logging in a transaction
    const txResult = await db.$transaction(async (tx) => {
      // Check the device exists and is available
      const devices: any[] = await tx.$queryRaw`SELECT id, status, "deviceType"
         FROM "NotificationDevice"
         WHERE "locationId" = ${locationId}
           AND "deviceNumber" = ${deviceNumber.trim()}
           AND "deletedAt" IS NULL
           AND status NOT IN ('retired', 'disabled')
         LIMIT 1`

      let deviceId: string | null = null

      if (devices.length > 0) {
        const device = devices[0]
        if (device.status !== 'available') {
          throw { code: 'DEVICE_UNAVAILABLE', message: `Device ${deviceNumber} is not available (status: ${device.status})` }
        }
        deviceId = device.id

        // Mark device as assigned
        await tx.$executeRaw`UPDATE "NotificationDevice"
           SET status = 'assigned',
               "assignedToSubjectType" = 'staff_task',
               "assignedToSubjectId" = ${employeeId},
               "assignedAt" = CURRENT_TIMESTAMP,
               "deviceType" = 'staff_pager',
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = ${device.id} AND "locationId" = ${locationId}`
      } else {
        // Auto-create the device as a staff_pager if it doesn't exist
        const providers: any[] = await tx.$queryRaw`SELECT id FROM "NotificationProvider"
           WHERE "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL
           ORDER BY "isDefault" DESC, priority DESC
           LIMIT 1`

        const providerId = providers[0]?.id || 'unlinked'

        const inserted: any[] = await tx.$queryRaw`INSERT INTO "NotificationDevice" (
            id, "locationId", "providerId", "deviceNumber", "deviceType",
            status, "assignedToSubjectType", "assignedToSubjectId", "assignedAt",
            "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text, ${locationId}, ${providerId}, ${deviceNumber.trim()}, 'staff_pager',
            'assigned', 'staff_task', ${employeeId}, CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          ) RETURNING id`
        deviceId = inserted[0]?.id || null
      }

      // Create the NotificationTargetAssignment
      const assignmentResult: any[] = await tx.$queryRaw`INSERT INTO "NotificationTargetAssignment" (
          id, "locationId", "subjectType", "subjectId",
          "targetType", "targetValue", "providerId",
          priority, "isPrimary", source, status,
          "assignedAt", "createdByEmployeeId",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, ${locationId}, 'staff_task', ${employeeId},
          'staff_pager', ${deviceNumber.trim()}, NULL,
          0, true, 'manual', 'active',
          CURRENT_TIMESTAMP, ${auth.employee.id},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING id, "assignedAt"`

      // Log device event
      if (deviceId) {
        const eventMetadata = JSON.stringify({
          action: 'staff_pager_bind',
          deviceNumber: deviceNumber.trim(),
          employeeName: `${employee.firstName} ${employee.lastName}`,
          employeeRole: employee.role,
        })
        await tx.$executeRaw`INSERT INTO "NotificationDeviceEvent" (
            id, "deviceId", "locationId", "eventType",
            "subjectType", "subjectId", "employeeId", metadata, "createdAt"
          ) VALUES (
            gen_random_uuid()::text, ${deviceId}, ${locationId}, 'assigned',
            'staff_task', ${employeeId}, ${auth.employee.id}, ${eventMetadata}::jsonb, CURRENT_TIMESTAMP
          )`
      }

      return { assignmentId: assignmentResult[0]?.id, assignedAt: assignmentResult[0]?.assignedAt, deviceId }
    })

    // W15: AuditLog for staff device bind
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_staff_device_bound',
        entityType: 'notification_device',
        entityId: txResult.deviceId || 'unknown',
        details: {
          employeeId,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          deviceNumber: deviceNumber.trim(),
          assignmentId: txResult.assignmentId,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        assignmentId: txResult.assignmentId,
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeRole: employee.role,
        deviceNumber: deviceNumber.trim(),
        deviceId: txResult.deviceId,
        assignedAt: txResult.assignedAt,
      },
      message: `Pager ${deviceNumber} bound to ${employee.firstName} ${employee.lastName}`,
    }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'DEVICE_UNAVAILABLE') {
      return err(error.message, 409)
    }
    console.error('[Staff Devices] POST error:', error)
    return err('Failed to bind staff device', 500)
  }
})

// ─── DELETE — Unbind (release assignment, mark device available) ─────────────

export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { employeeId, deviceNumber } = body

    if (!employeeId && !deviceNumber) {
      return err('employeeId or deviceNumber is required')
    }

    // Build condition to find the active assignment
    const conditions: string[] = [
      `"locationId" = $1`,
      `"subjectType" = 'staff_task'`,
      `"targetType" = 'staff_pager'`,
      `status = 'active'`,
    ]
    const params: unknown[] = [locationId]
    let paramIndex = 2

    if (employeeId) {
      conditions.push(`"subjectId" = $${paramIndex}`)
      params.push(employeeId)
      paramIndex++
    }
    if (deviceNumber) {
      conditions.push(`"targetValue" = $${paramIndex}`)
      params.push(deviceNumber)
      paramIndex++
    }

    // Find the assignment
    const assignments: any[] = await db.$queryRaw`SELECT id, "subjectId", "targetValue"
       FROM "NotificationTargetAssignment"
       WHERE ${conditions.join(' AND ')}
       LIMIT 1`

    if (assignments.length === 0) {
      return notFound('No active staff pager assignment found')
    }

    const assignment = assignments[0]
    const unboundDeviceNumber = assignment.targetValue
    const unboundEmployeeId = assignment.subjectId

    // Release the assignment
    await db.$executeRaw`UPDATE "NotificationTargetAssignment"
       SET status = 'released',
           "releasedAt" = CURRENT_TIMESTAMP,
           "releaseReason" = 'manual_unbind',
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = ${assignment.id}`

    // W5: Set to 'released' instead of 'available' — staff can confirm return via PATCH
    const deviceRows: any[] = await db.$queryRaw`UPDATE "NotificationDevice"
       SET status = 'released',
           "releasedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "locationId" = ${locationId}
         AND "deviceNumber" = ${unboundDeviceNumber}
         AND "deviceType" = 'staff_pager'
         AND "deletedAt" IS NULL
         AND status = 'assigned'
       RETURNING id`

    // Log device event
    if (deviceRows.length > 0) {
      void db.$executeRaw`INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${deviceRows[0].id}, ${locationId}, 'released',
          'staff_task', ${unboundEmployeeId}, ${auth.employee.id}, ${JSON.stringify({
          action: 'staff_pager_unbind',
          deviceNumber: unboundDeviceNumber,
        })}::jsonb, CURRENT_TIMESTAMP
        )`.catch(err => log.warn({ err }, 'Background task failed'))
    }

    // W16: AuditLog for staff device unbind
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_staff_device_unbound',
        entityType: 'notification_device',
        entityId: deviceRows[0]?.id || 'unknown',
        details: {
          unboundEmployeeId,
          deviceNumber: unboundDeviceNumber,
          assignmentId: assignment.id,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        assignmentId: assignment.id,
        employeeId: unboundEmployeeId,
        deviceNumber: unboundDeviceNumber,
        released: true,
      },
      message: `Pager ${unboundDeviceNumber} unbound from employee`,
    })
  } catch (error) {
    console.error('[Staff Devices] DELETE error:', error)
    return err('Failed to unbind staff device', 500)
  }
})
