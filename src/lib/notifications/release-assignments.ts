/**
 * Notification Target Assignment Release Helper
 *
 * Releases all active NotificationTargetAssignments for a subject (order, waitlist entry).
 * Also marks associated devices as 'released' and clears the cache field on the subject.
 *
 * Used by:
 *   - Order close/void/cancel auto-release
 *   - Waitlist seated/cancelled/expired auto-release
 *   - Manual device return
 */

import { db } from '@/lib/db'

export interface ReleaseResult {
  releasedAssignments: number
  releasedDevices: number
  clearedPagerNumber: boolean
}

/**
 * Release all active notification assignments for a given subject.
 * Fire-and-forget safe — logs errors but never throws.
 */
export async function releaseAssignmentsForSubject(
  locationId: string,
  subjectType: 'order' | 'waitlist_entry',
  subjectId: string,
  reason: string = 'subject_closed',
  employeeId?: string
): Promise<ReleaseResult> {
  const result: ReleaseResult = {
    releasedAssignments: 0,
    releasedDevices: 0,
    clearedPagerNumber: false,
  }

  try {
    // 1. Find all active assignments for this subject
    const assignments: Array<{
      id: string
      targetType: string
      targetValue: string
      providerId: string | null
    }> = await db.$queryRawUnsafe(
      `SELECT id, "targetType", "targetValue", "providerId"
       FROM "NotificationTargetAssignment"
       WHERE "locationId" = $1
         AND "subjectType" = $2
         AND "subjectId" = $3
         AND status = 'active'`,
      locationId,
      subjectType,
      subjectId
    )

    if (assignments.length === 0) return result

    // 2. Release all assignments
    const releasedCount: number = await db.$executeRawUnsafe(
      `UPDATE "NotificationTargetAssignment"
       SET status = 'released',
           "releasedAt" = CURRENT_TIMESTAMP,
           "releaseReason" = $4,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "locationId" = $1
         AND "subjectType" = $2
         AND "subjectId" = $3
         AND status = 'active'`,
      locationId,
      subjectType,
      subjectId,
      reason
    )
    result.releasedAssignments = releasedCount

    // 3. Mark associated devices as 'released' (only pager-type assignments)
    const pagerAssignments = assignments.filter(
      a => a.targetType === 'guest_pager' || a.targetType === 'staff_pager'
    )

    for (const assignment of pagerAssignments) {
      try {
        const deviceReleased: number = await db.$executeRawUnsafe(
          `UPDATE "NotificationDevice"
           SET status = 'released',
               "releasedAt" = CURRENT_TIMESTAMP,
               "assignedToSubjectType" = NULL,
               "assignedToSubjectId" = NULL,
               "updatedAt" = CURRENT_TIMESTAMP
           WHERE "locationId" = $1
             AND "deviceNumber" = $2
             AND status = 'assigned'
             AND "assignedToSubjectId" = $3
             AND "deletedAt" IS NULL`,
          locationId,
          assignment.targetValue,
          subjectId
        )
        result.releasedDevices += deviceReleased

        // Log device event
        if (deviceReleased > 0) {
          await db.$executeRawUnsafe(
            `INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "subjectType", "subjectId", "employeeId", metadata, "createdAt")
             SELECT gen_random_uuid()::text, d.id, $1, 'released', $2, $3, $5, $6::jsonb, CURRENT_TIMESTAMP
             FROM "NotificationDevice" d
             WHERE d."locationId" = $1 AND d."deviceNumber" = $4 AND d."deletedAt" IS NULL
             LIMIT 1`,
            locationId,
            subjectType,
            subjectId,
            assignment.targetValue,
            employeeId || null,
            JSON.stringify({ reason, autoRelease: true })
          )
        }
      } catch (deviceErr) {
        console.error(`[notification-release] Failed to release device ${assignment.targetValue}:`, deviceErr)
      }
    }

    // 4. Clear the pagerNumber cache field on the subject
    try {
      if (subjectType === 'order') {
        await db.$executeRawUnsafe(
          `UPDATE "Order" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
          subjectId,
          locationId
        )
        result.clearedPagerNumber = true
      } else if (subjectType === 'waitlist_entry') {
        await db.$executeRawUnsafe(
          `UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
          subjectId,
          locationId
        )
        result.clearedPagerNumber = true
      }
    } catch (cacheErr) {
      // Non-fatal: pagerNumber is cache-only
      console.warn(`[notification-release] Failed to clear pagerNumber cache for ${subjectType}/${subjectId}:`, cacheErr)
    }
  } catch (err) {
    console.error(`[notification-release] Failed to release assignments for ${subjectType}/${subjectId}:`, err)
  }

  return result
}
