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
import { err } from '@/lib/api-response'
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
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ASSIGN_DEVICE)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { subjectType, subjectId } = body

    // Validate inputs
    if (!subjectType || !VALID_SUBJECT_TYPES.includes(subjectType)) {
      return err(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(', ')}`)
    }
    if (!subjectId || typeof subjectId !== 'string') {
      return err('subjectId is required')
    }

    // Wrap all DB operations in a transaction to prevent orphaned state
    const result = await db.$transaction(async (tx) => {
      // Find all active pager assignments for this subject
      const activeAssignments: any[] = await tx.$queryRaw`SELECT id, "targetValue", "targetType"
         FROM "NotificationTargetAssignment"
         WHERE "locationId" = ${locationId}
           AND "subjectType" = ${subjectType}
           AND "subjectId" = ${subjectId}
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')`

      if (activeAssignments.length === 0) {
        return { released: 0, deviceNumbers: [] as string[], releasedDevices: [] as any[], assignmentCount: 0 }
      }

      // Release all active target assignments
      await tx.$executeRaw`UPDATE "NotificationTargetAssignment"
         SET status = 'released',
             "releasedAt" = CURRENT_TIMESTAMP,
             "releaseReason" = 'manual_unassign',
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = ${locationId}
           AND "subjectType" = ${subjectType}
           AND "subjectId" = ${subjectId}
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')`

      // Release all devices assigned to this subject
      const deviceNumbers = activeAssignments.map((a: any) => a.targetValue)
      const releasedDevices: any[] = await tx.$queryRaw`UPDATE "NotificationDevice"
         SET status = 'released',
             "releasedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "locationId" = ${locationId}
           AND "assignedToSubjectType" = ${subjectType}
           AND "assignedToSubjectId" = ${subjectId}
           AND status = 'assigned'
           AND "deletedAt" IS NULL
         RETURNING id, "deviceNumber"`

      // Clear pagerNumber cache on the subject
      if (subjectType === 'order') {
        await tx.$executeRaw`UPDATE "Order" SET "pagerNumber" = NULL WHERE id = ${subjectId} AND "locationId" = ${locationId}`
      } else if (subjectType === 'waitlist_entry') {
        await tx.$executeRaw`UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = ${subjectId} AND "locationId" = ${locationId}`
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
      void db.$executeRaw`INSERT INTO "NotificationDeviceEvent" (
          id, "deviceId", "locationId", "eventType",
          "subjectType", "subjectId", "employeeId", metadata, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${device.id}, ${locationId}, 'released',
          ${subjectType}, ${subjectId}, ${auth.employee.id}, ${JSON.stringify({ reason: 'manual_unassign', deviceNumber: device.deviceNumber })}::jsonb, CURRENT_TIMESTAMP
        )`.catch(err => log.warn({ err }, 'Background task failed'))
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
    return err('Failed to unassign device', 500)
  }
})
