/**
 * PATCH /api/notifications/devices/[id] — Update device status (return, mark lost, retire, maintenance)
 * DELETE /api/notifications/devices/[id] — Soft-delete a device
 *
 * Enforces v1 state machine transitions.
 * Logs NotificationDeviceEvent on every status change.
 * Permission: PATCH/DELETE = notifications.manage_devices
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  validateDeviceTransition,
  statusChangeToEventType,
  type DeviceStatus,
} from '@/lib/notifications/device-state-machine'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/notifications/devices/[id]
 *
 * Body:
 *   status — new device status (required)
 *   force — boolean (optional, required for override transitions)
 *   humanLabel — string (optional, update display label)
 *   metadata — object (optional, merge with existing)
 */
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { status: newStatus, force, humanLabel, metadata } = body as {
      status?: string
      force?: boolean
      humanLabel?: string
      metadata?: Record<string, unknown>
    }

    // Fetch existing device
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, "deviceNumber", "deviceType", status, "providerId",
              "assignedToSubjectType", "assignedToSubjectId", "humanLabel", metadata
       FROM "NotificationDevice"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    const device = existing[0]
    const updateFields: string[] = [`"updatedAt" = CURRENT_TIMESTAMP`]
    const updateParams: unknown[] = []
    let paramIndex = 3 // $1 = id, $2 = locationId

    // Status change with state machine validation
    if (newStatus && newStatus !== device.status) {
      const transition = validateDeviceTransition(
        device.status as DeviceStatus,
        newStatus as DeviceStatus
      )

      if (!transition.valid) {
        if (!force) {
          return NextResponse.json(
            { error: transition.error, hint: 'Use force: true to override (requires audit trail)' },
            { status: 400 }
          )
        }
        // Force override allowed — log it specially
        console.warn(`[Notification Device] Force override: ${device.status} → ${newStatus} for device ${id} by ${auth.employee.id}`)
      }

      updateFields.push(`status = $${paramIndex}`)
      updateParams.push(newStatus)
      paramIndex++

      // Clear assignment fields when releasing or returning
      if (newStatus === 'released' || newStatus === 'returned_pending') {
        updateFields.push(`"releasedAt" = CURRENT_TIMESTAMP`)
      }

      if (newStatus === 'available') {
        updateFields.push(`"returnedAt" = CURRENT_TIMESTAMP`)
        updateFields.push(`"assignedToSubjectType" = NULL`)
        updateFields.push(`"assignedToSubjectId" = NULL`)
        updateFields.push(`"assignedAt" = NULL`)
        updateFields.push(`"releasedAt" = NULL`)
      }

      // When device goes to missing or disabled, clear assignment
      if (newStatus === 'missing' || newStatus === 'disabled') {
        updateFields.push(`"assignedToSubjectType" = NULL`)
        updateFields.push(`"assignedToSubjectId" = NULL`)
      }
    }

    // Optional field updates
    if (humanLabel !== undefined) {
      updateFields.push(`"humanLabel" = $${paramIndex}`)
      updateParams.push(humanLabel?.trim() || null)
      paramIndex++
    }

    if (metadata !== undefined) {
      updateFields.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIndex}::jsonb`)
      updateParams.push(JSON.stringify(metadata))
      paramIndex++
    }

    if (updateFields.length === 1) {
      // Only updatedAt — nothing to change
      return NextResponse.json({ data: device, message: 'No changes' })
    }

    // Execute update
    const updated: any[] = await db.$queryRawUnsafe(
      `UPDATE "NotificationDevice"
       SET ${updateFields.join(', ')}
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       RETURNING id, "deviceNumber", "humanLabel", "deviceType", status,
                 "providerId", "assignedToSubjectType", "assignedToSubjectId",
                 "assignedAt", "releasedAt", "returnedAt",
                 "batteryLevel", "lastSeenAt", metadata, "updatedAt"`,
      id,
      locationId,
      ...updateParams
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    // Log device event for status change
    if (newStatus && newStatus !== device.status) {
      const eventType = force
        ? 'force_override'
        : statusChangeToEventType(device.status as DeviceStatus, newStatus as DeviceStatus)

      void db.$executeRawUnsafe(
        `INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3,
          $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP
        )`,
        id,
        locationId,
        eventType,
        device.assignedToSubjectType || null,
        device.assignedToSubjectId || null,
        auth.employee.id,
        JSON.stringify({
          previousStatus: device.status,
          newStatus,
          force: force || false,
        })
      ).catch(console.error)

      // Audit log: notification_device_override
      void db.auditLog.create({
        data: {
          locationId,
          employeeId: auth.employee.id,
          action: 'notification_device_override',
          entityType: 'notification_device',
          entityId: id,
          details: {
            deviceNumber: device.deviceNumber,
            previousStatus: device.status,
            newStatus,
            force: force || false,
            assignedToSubjectType: device.assignedToSubjectType,
            assignedToSubjectId: device.assignedToSubjectId,
          },
        },
      }).catch(console.error)

      // If releasing or disabling a device that was assigned, also release the corresponding target assignment
      // and clear pagerNumber cache on the subject
      if ((newStatus === 'released' || newStatus === 'disabled') && device.assignedToSubjectId) {
        const releaseReason = newStatus === 'disabled' ? 'device_disabled' : 'device_returned'

        void db.$executeRawUnsafe(
          `UPDATE "NotificationTargetAssignment"
           SET status = 'released',
               "releasedAt" = CURRENT_TIMESTAMP,
               "releaseReason" = $5,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = $1
             AND "subjectType" = $2
             AND "subjectId" = $3
             AND "targetValue" = $4
             AND status = 'active'`,
          locationId,
          device.assignedToSubjectType,
          device.assignedToSubjectId,
          device.deviceNumber,
          releaseReason
        ).catch(console.error)

        // Clear pagerNumber cache on the subject
        if (device.assignedToSubjectType === 'order') {
          void db.$executeRawUnsafe(
            `UPDATE "Order" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
            device.assignedToSubjectId,
            locationId
          ).catch(console.error)
        } else if (device.assignedToSubjectType === 'waitlist_entry') {
          void db.$executeRawUnsafe(
            `UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
            device.assignedToSubjectId,
            locationId
          ).catch(console.error)
        }
      }
    }

    return NextResponse.json({ data: updated[0] })
  } catch (error) {
    console.error('[Notification Devices] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update device' }, { status: 500 })
  }
})

/**
 * DELETE /api/notifications/devices/[id] — Soft-delete a device
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

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANAGE_DEVICES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Check device exists and is not currently assigned
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id, status, "deviceNumber" FROM "NotificationDevice"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId
    )

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }

    if (existing[0].status === 'assigned') {
      return NextResponse.json(
        { error: 'Cannot delete an assigned device. Release it first.' },
        { status: 409 }
      )
    }

    // Soft delete + set status to retired
    await db.$executeRawUnsafe(
      `UPDATE "NotificationDevice"
       SET "deletedAt" = CURRENT_TIMESTAMP, status = 'retired', "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "locationId" = $2`,
      id,
      locationId
    )

    // Log event
    void db.$executeRawUnsafe(
      `INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "employeeId", metadata, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'retired', $3, $4::jsonb, CURRENT_TIMESTAMP)`,
      id,
      locationId,
      auth.employee.id,
      JSON.stringify({ action: 'soft_delete', deviceNumber: existing[0].deviceNumber })
    ).catch(console.error)

    // W14: AuditLog for device deletion
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_device_deleted',
        entityType: 'notification_device',
        entityId: id,
        details: {
          deviceNumber: existing[0].deviceNumber,
          previousStatus: existing[0].status,
        },
      },
    }).catch(console.error)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notification Devices] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete device' }, { status: 500 })
  }
})
