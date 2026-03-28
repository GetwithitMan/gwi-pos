/**
 * POST /api/notifications/page-staff — Page a staff member
 *
 * Looks up the employee's bound staff pager and dispatches a notification
 * via notifyEvent() with the appropriate event type.
 *
 * Used by:
 * - Table view "Page Server" button
 * - Expo "Page Runner" button
 * - Any staff alerting scenario
 *
 * Permission: notifications.manual_page
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import crypto from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { err, notFound } from '@/lib/api-response'
const log = createChildLogger('notifications-page-staff')

export const dynamic = 'force-dynamic'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.NOTIFICATIONS_MANUAL_PAGE)
    if (!auth.authorized) return err(auth.error, auth.status)

    const body = await request.json()
    const { employeeId, message, eventType } = body

    if (!employeeId || typeof employeeId !== 'string') {
      return err('employeeId is required')
    }

    // Validate employee exists
    const employees: any[] = await db.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", role, phone
       FROM "Employee"
       WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      employeeId,
      locationId
    )
    if (employees.length === 0) {
      return notFound('Employee not found')
    }
    const employee = employees[0]

    // Look up the employee's bound staff pager
    const pagerAssignments: any[] = await db.$queryRawUnsafe(
      `SELECT ta.id, ta."targetValue" as "deviceNumber", ta."providerId"
       FROM "NotificationTargetAssignment" ta
       WHERE ta."locationId" = $1
         AND ta."subjectType" = 'staff_task'
         AND ta."subjectId" = $2
         AND ta."targetType" = 'staff_pager'
         AND ta.status = 'active'
       ORDER BY ta."isPrimary" DESC, ta."createdAt" DESC
       LIMIT 1`,
      locationId,
      employeeId
    )

    const hasPager = pagerAssignments.length > 0
    const pagerNumber = hasPager ? pagerAssignments[0].deviceNumber : null

    // Determine the effective event type
    const resolvedEventType = eventType || 'staff_alert'

    // Validate event type is one of the staff-related types
    const validStaffEvents = ['server_needed', 'staff_alert', 'expo_recall']
    if (!validStaffEvents.includes(resolvedEventType)) {
      return err(`eventType must be one of: ${validStaffEvents.join(', ')}`)
    }

    // Build context
    const context: Record<string, unknown> = {
      staff: {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        role: employee.role,
        phone: employee.phone || null,
      },
      pagerNumber,
      phone: employee.phone || null,
      customMessage: message || null,
      initiatedByEmployeeId: auth.employee.id,
    }

    // Get location name for the message
    const locations: any[] = await db.$queryRawUnsafe(
      `SELECT name FROM "Location" WHERE id = $1`,
      locationId
    )
    if (locations[0]) {
      context.locationName = locations[0].name
    }

    // Generate unique sourceEventId for manual staff page
    const uniqueId = crypto.randomUUID()
    const sourceEventId = `manual_page:staff:${employeeId}:${uniqueId}`

    // Dispatch via notifyEvent
    let dispatched = false
    let dispatchResult: any = null

    try {
      const { notifyEvent } = await import('@/lib/notifications/dispatcher')
      dispatchResult = await notifyEvent({
        locationId,
        eventType: resolvedEventType as any,
        subjectType: 'staff_task',
        subjectId: employeeId,
        subjectVersion: 1,
        sourceSystem: 'pos',
        sourceEventId,
        dispatchOrigin: 'manual_override',
        businessStage: 'initial_ready',
        contextSnapshot: context,
      })
      dispatched = true
    } catch (importErr) {
      console.warn('[Page Staff] Notification dispatcher not available yet:', importErr)
    }

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'notification_page_staff',
        entityType: 'employee',
        entityId: employeeId,
        details: {
          sourceEventId,
          eventType: resolvedEventType,
          targetEmployeeName: `${employee.firstName} ${employee.lastName}`,
          targetRole: employee.role,
          pagerNumber,
          hasPager,
          customMessage: message || null,
          dispatched,
          jobsEnqueued: dispatchResult?.jobsEnqueued ?? 0,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Log device event if we have a pager
    if (hasPager) {
      const deviceRows: any[] = await db.$queryRawUnsafe(
        `SELECT d.id FROM "NotificationDevice" d
         WHERE d."locationId" = $1
           AND d."deviceNumber" = $2
           AND d."deviceType" = 'staff_pager'
           AND d."deletedAt" IS NULL
         LIMIT 1`,
        locationId,
        pagerNumber
      )
      if (deviceRows.length > 0) {
        void db.$executeRawUnsafe(
          `INSERT INTO "NotificationDeviceEvent" (
            id, "deviceId", "locationId", "eventType",
            "subjectType", "subjectId", "employeeId", metadata, "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, 'manual_page',
            'staff_task', $3, $4, $5::jsonb, CURRENT_TIMESTAMP
          )`,
          deviceRows[0].id,
          locationId,
          employeeId,
          auth.employee.id,
          JSON.stringify({
            sourceEventId,
            eventType: resolvedEventType,
            message: message || null,
            dispatched,
          })
        ).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    return NextResponse.json({
      data: {
        sourceEventId,
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeRole: employee.role,
        eventType: resolvedEventType,
        pagerNumber,
        hasPager,
        dispatched,
        jobsEnqueued: dispatchResult?.jobsEnqueued ?? 0,
      },
      message: dispatched
        ? hasPager
          ? `Page sent to ${employee.firstName} (pager ${pagerNumber})`
          : `Page dispatched for ${employee.firstName} (no pager bound — fallback routing applies)`
        : `Page logged for ${employee.firstName} (notification engine not yet active)`,
    })
  } catch (error) {
    console.error('[Page Staff] POST error:', error)
    return err('Failed to page staff member', 500)
  }
})
