/**
 * POST /api/notifications/unassign — Release all active pager assignments for a subject
 *
 * Releases target assignments, marks devices as released, clears pagerNumber cache.
 * Inverse of the assign route.
 *
 * Permission: pos.assign_device
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('notifications-unassign')

export const dynamic = 'force-dynamic'

const VALID_SUBJECT_TYPES = ['order', 'waitlist_entry', 'reservation', 'staff_task']

/**
 * POST /api/notifications/unassign
 *
 * Body:
 *   subjectType — 'order' | 'waitlist_entry' | 'reservation' | 'staff_task' (required)
 *   subjectId — string (required)
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
    const { subjectType, subjectId } = body

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

    // Wrap all DB operations in a transaction to prevent orphaned state
    const result = await db.$transaction(async (tx) => {
      // Find all active pager assignments for this subject
      const activeAssignments: any[] = await tx.$queryRawUnsafe(
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

      if (activeAssignments.length === 0) {
        return { released: 0, deviceNumbers: [] as string[], releasedDevices: [] as any[], assignmentCount: 0 }
      }

      // Release all active target assignments
      await tx.$executeRawUnsafe(
        `UPDATE "NotificationTargetAssignment"
         SET status = 'released',
             "releasedAt" = CURRENT_TIMESTAMP,
             "releaseReason" = 'manual_unassign',
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = $1
           AND "subjectType" = $2
           AND "subjectId" = $3
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')`,
        locationId,
        subjectType,
        subjectId
      )

      // Release all devices assigned to this subject
      const deviceNumbers = activeAssignments.map((a: any) => a.targetValue)
      const releasedDevices: any[] = await tx.$queryRawUnsafe(
        `UPDATE "NotificationDevice"
         SET status = 'released',
             "releasedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = $1
           AND "assignedToSubjectType" = $2
           AND "assignedToSubjectId" = $3
           AND status = 'assigned'
           AND "deletedAt" IS NULL
         RETURNING id, "deviceNumber"`,
        locationId,
        subjectType,
        subjectId
      )

      // Clear pagerNumber cache on the subject
      if (subjectType === 'order') {
        await tx.$executeRawUnsafe(
          `UPDATE "Order" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
          subjectId,
          locationId
        )
      } else if (subjectType === 'waitlist_entry') {
        await tx.$executeRawUnsafe(
          `UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
          subjectId,
          locationId
        )
      }

      return {
        released: releasedDevices.length,
        deviceNumbers,
        releasedDevices,
        assignmentCount: activeAssignments.length,
      }
    })

    if (result.released === 0) {
      return NextResponse.json({ data: { released: 0 }, message: 'No active pager assignments found' })
    }

    // Log device events for each released device (fire-and-forget, outside tx)
    for (const device of result.releasedDevices) {
      void db.$executeRawUnsafe(
        `INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, 'released',
          $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP
        )`,
        device.id,
        locationId,
        subjectType,
        subjectId,
        auth.employee.id,
        JSON.stringify({ reason: 'manual_unassign', deviceNumber: device.deviceNumber })
      ).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Audit log (fire-and-forget, outside tx)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_device_unassigned',
        entityType: subjectType,
        entityId: subjectId,
        details: {
          deviceNumbers: result.deviceNumbers,
          releasedCount: result.released,
          assignmentCount: result.assignmentCount,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        released: result.released,
        deviceNumbers: result.deviceNumbers,
        subjectType,
        subjectId,
      },
      message: `Released ${result.released} pager(s)`,
    })
  } catch (error) {
    console.error('[Notification Unassign] POST error:', error)
    return NextResponse.json({ error: 'Failed to unassign device' }, { status: 500 })
  }
})
