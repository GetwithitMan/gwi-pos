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

export const dynamic = 'force-dynamic'

// ─── GET — List staff device assignments ────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_VIEW_LOG)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Get all staff pager assignments with device + employee info
    const assignments: any[] = await db.$queryRawUnsafe(
      `SELECT
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
      WHERE ta."locationId" = $1
        AND ta."subjectType" = 'staff_task'
        AND ta."targetType" = 'staff_pager'
      ORDER BY ta.status ASC, ta."assignedAt" DESC`,
      locationId
    )

    // Also get available staff pager devices (not currently assigned)
    const availableDevices: any[] = await db.$queryRawUnsafe(
      `SELECT d.id, d."deviceNumber", d."humanLabel", d.status, d."batteryLevel", d."lastSeenAt"
       FROM "NotificationDevice" d
       WHERE d."locationId" = $1
         AND d."deviceType" = 'staff_pager'
         AND d.status = 'available'
         AND d."deletedAt" IS NULL
       ORDER BY d."deviceNumber"::int ASC NULLS LAST, d."deviceNumber" ASC`,
      locationId
    )

    return NextResponse.json({
      data: {
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
      },
    })
  } catch (error) {
    console.error('[Staff Devices] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch staff device assignments' }, { status: 500 })
  }
})

// ─── POST — Bind a pager to an employee ─────────────────────────────────────

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
    const { employeeId, deviceNumber, deviceType } = body

    // Validate required fields
    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }
    if (!deviceNumber || typeof deviceNumber !== 'string') {
      return NextResponse.json({ error: 'deviceNumber is required' }, { status: 400 })
    }
    if (deviceType && deviceType !== 'staff_pager') {
      return NextResponse.json({ error: 'deviceType must be "staff_pager"' }, { status: 400 })
    }

    // Validate employee exists at this location
    const employees: any[] = await db.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", role
       FROM "Employee"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      employeeId,
      locationId
    )
    if (employees.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }
    const employee = employees[0]

    // Check if employee already has an active staff pager assignment
    const existingAssignment: any[] = await db.$queryRawUnsafe(
      `SELECT id, "targetValue"
       FROM "NotificationTargetAssignment"
       WHERE "locationId" = $1
         AND "subjectType" = 'staff_task'
         AND "subjectId" = $2
         AND "targetType" = 'staff_pager'
         AND status = 'active'
       LIMIT 1`,
      locationId,
      employeeId
    )
    if (existingAssignment.length > 0) {
      return NextResponse.json(
        { error: `Employee already has pager ${existingAssignment[0].targetValue} assigned. Unbind first.` },
        { status: 409 }
      )
    }

    // W4: Wrap device update, assignment creation, and event logging in a transaction
    const txResult = await db.$transaction(async (tx) => {
      // Check the device exists and is available
      const devices: any[] = await tx.$queryRawUnsafe(
        `SELECT id, status, "deviceType"
         FROM "NotificationDevice"
         WHERE "locationId" = $1
           AND "deviceNumber" = $2
           AND "deletedAt" IS NULL
           AND status NOT IN ('retired', 'disabled')
         LIMIT 1`,
        locationId,
        deviceNumber.trim()
      )

      let deviceId: string | null = null

      if (devices.length > 0) {
        const device = devices[0]
        if (device.status !== 'available') {
          throw { code: 'DEVICE_UNAVAILABLE', message: `Device ${deviceNumber} is not available (status: ${device.status})` }
        }
        deviceId = device.id

        // Mark device as assigned
        await tx.$executeRawUnsafe(
          `UPDATE "NotificationDevice"
           SET status = 'assigned',
               "assignedToSubjectType" = 'staff_task',
               "assignedToSubjectId" = $3,
               "assignedAt" = CURRENT_TIMESTAMP,
               "deviceType" = 'staff_pager',
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $1 AND "locationId" = $2`,
          device.id,
          locationId,
          employeeId
        )
      } else {
        // Auto-create the device as a staff_pager if it doesn't exist
        const providers: any[] = await tx.$queryRawUnsafe(
          `SELECT id FROM "NotificationProvider"
           WHERE "locationId" = $1 AND "isActive" = true AND "deletedAt" IS NULL
           ORDER BY "isDefault" DESC, priority DESC
           LIMIT 1`,
          locationId
        )

        const providerId = providers[0]?.id || 'unlinked'

        const inserted: any[] = await tx.$queryRawUnsafe(
          `INSERT INTO "NotificationDevice" (
            id, "locationId", "providerId", "deviceNumber", "deviceType",
            status, "assignedToSubjectType", "assignedToSubjectId", "assignedAt",
            "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, 'staff_pager',
            'assigned', 'staff_task', $4, CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          ) RETURNING id`,
          locationId,
          providerId,
          deviceNumber.trim(),
          employeeId
        )
        deviceId = inserted[0]?.id || null
      }

      // Create the NotificationTargetAssignment
      const assignmentResult: any[] = await tx.$queryRawUnsafe(
        `INSERT INTO "NotificationTargetAssignment" (
          id, "locationId", "subjectType", "subjectId",
          "targetType", "targetValue", "providerId",
          priority, "isPrimary", source, status,
          "assignedAt", "createdByEmployeeId",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, 'staff_task', $2,
          'staff_pager', $3, NULL,
          0, true, 'manual', 'active',
          CURRENT_TIMESTAMP, $4,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING id, "assignedAt"`,
        locationId,
        employeeId,
        deviceNumber.trim(),
        auth.employee.id
      )

      // Log device event
      if (deviceId) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "NotificationDeviceEvent" (
            id, "deviceId", "locationId", "eventType",
            "subjectType", "subjectId", "employeeId", metadata, "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, 'assigned',
            'staff_task', $3, $4, $5::jsonb, CURRENT_TIMESTAMP
          )`,
          deviceId,
          locationId,
          employeeId,
          auth.employee.id,
          JSON.stringify({
            action: 'staff_pager_bind',
            deviceNumber: deviceNumber.trim(),
            employeeName: `${employee.firstName} ${employee.lastName}`,
            employeeRole: employee.role,
          })
        )
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
    }).catch(console.error)

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
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[Staff Devices] POST error:', error)
    return NextResponse.json({ error: 'Failed to bind staff device' }, { status: 500 })
  }
})

// ─── DELETE — Unbind (release assignment, mark device available) ─────────────

export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { employeeId, deviceNumber } = body

    if (!employeeId && !deviceNumber) {
      return NextResponse.json({ error: 'employeeId or deviceNumber is required' }, { status: 400 })
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
    const assignments: any[] = await db.$queryRawUnsafe(
      `SELECT id, "subjectId", "targetValue"
       FROM "NotificationTargetAssignment"
       WHERE ${conditions.join(' AND ')}
       LIMIT 1`,
      ...params
    )

    if (assignments.length === 0) {
      return NextResponse.json({ error: 'No active staff pager assignment found' }, { status: 404 })
    }

    const assignment = assignments[0]
    const unboundDeviceNumber = assignment.targetValue
    const unboundEmployeeId = assignment.subjectId

    // Release the assignment
    await db.$executeRawUnsafe(
      `UPDATE "NotificationTargetAssignment"
       SET status = 'released',
           "releasedAt" = CURRENT_TIMESTAMP,
           "releaseReason" = 'manual_unbind',
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1`,
      assignment.id
    )

    // W5: Set to 'released' instead of 'available' — staff can confirm return via PATCH
    const deviceRows: any[] = await db.$queryRawUnsafe(
      `UPDATE "NotificationDevice"
       SET status = 'released',
           "releasedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "locationId" = $1
         AND "deviceNumber" = $2
         AND "deviceType" = 'staff_pager'
         AND "deletedAt" IS NULL
         AND status = 'assigned'
       RETURNING id`,
      locationId,
      unboundDeviceNumber
    )

    // Log device event
    if (deviceRows.length > 0) {
      void db.$executeRawUnsafe(
        `INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, 'released',
          'staff_task', $3, $4, $5::jsonb, CURRENT_TIMESTAMP
        )`,
        deviceRows[0].id,
        locationId,
        unboundEmployeeId,
        auth.employee.id,
        JSON.stringify({
          action: 'staff_pager_unbind',
          deviceNumber: unboundDeviceNumber,
        })
      ).catch(console.error)
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
    }).catch(console.error)

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
    return NextResponse.json({ error: 'Failed to unbind staff device' }, { status: 500 })
  }
})
