/**
 * POST /api/notifications/page — Manual page (order ready notification)
 *
 * Generates unique sourceEventId (manual_page:{subjectId}:{uuid}).
 * Calls notifyEvent() with dispatchOrigin: 'manual_override'.
 * Manual overrides always bypass workflow dedup.
 *
 * Permission: POS_ACCESS
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/page
 *
 * Body:
 *   orderId — string (required)
 *   message — string (optional, custom message override)
 *   waitlistEntryId — string (optional, for waitlist paging instead of order)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { orderId, waitlistEntryId, message } = body

    if (!orderId && !waitlistEntryId) {
      return NextResponse.json({ error: 'orderId or waitlistEntryId is required' }, { status: 400 })
    }

    // Determine subject type and validate subject exists
    let subjectType: string
    let subjectId: string
    let eventType: string
    let context: Record<string, unknown> = {}

    if (orderId) {
      subjectType = 'order'
      subjectId = orderId
      eventType = 'order_ready'

      const orders: any[] = await db.$queryRawUnsafe(
        `SELECT id, "orderNumber", "tabName", "pagerNumber", status, "customerName"
         FROM "Order"
         WHERE id = $1 AND "locationId" = $2`,
        orderId,
        locationId
      )
      if (orders.length === 0) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      const order = orders[0]

      // Look up pagerNumber from active assignment (source of truth)
      const assignments: any[] = await db.$queryRawUnsafe(
        `SELECT "targetValue", "targetType"
         FROM "NotificationTargetAssignment"
         WHERE "locationId" = $1
           AND "subjectType" = 'order'
           AND "subjectId" = $2
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')
         ORDER BY "isPrimary" DESC, "createdAt" DESC
         LIMIT 1`,
        locationId,
        orderId
      )

      context = {
        orderNumber: order.orderNumber,
        tabName: order.tabName,
        pagerNumber: assignments[0]?.targetValue || order.pagerNumber || null,
        orderStatus: order.status,
        customerName: order.customerName || null,
      }
    } else {
      subjectType = 'waitlist_entry'
      subjectId = waitlistEntryId
      eventType = 'waitlist_ready'

      const entries: any[] = await db.$queryRawUnsafe(
        `SELECT id, "customerName", "partySize", phone, "pagerNumber", status
         FROM "WaitlistEntry"
         WHERE id = $1 AND "locationId" = $2`,
        waitlistEntryId,
        locationId
      )
      if (entries.length === 0) {
        return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
      }
      const entry = entries[0]

      // Look up pagerNumber from active assignment
      const assignments: any[] = await db.$queryRawUnsafe(
        `SELECT "targetValue", "targetType"
         FROM "NotificationTargetAssignment"
         WHERE "locationId" = $1
           AND "subjectType" = 'waitlist_entry'
           AND "subjectId" = $2
           AND status = 'active'
           AND "targetType" IN ('guest_pager', 'staff_pager')
         ORDER BY "isPrimary" DESC, "createdAt" DESC
         LIMIT 1`,
        locationId,
        waitlistEntryId
      )

      context = {
        customerName: entry.customerName,
        partySize: entry.partySize,
        phone: entry.phone,
        pagerNumber: assignments[0]?.targetValue || entry.pagerNumber || null,
        entryStatus: entry.status,
      }
    }

    // Generate unique sourceEventId for manual page
    const uniqueId = crypto.randomUUID()
    const sourceEventId = `manual_page:${subjectId}:${uniqueId}`

    if (message) {
      context.customMessage = message
    }

    // Try to call notifyEvent from the dispatcher (Phase 1 delivers this)
    let dispatched = false
    try {
      const { notifyEvent } = await import('@/lib/notifications/dispatcher')
      await notifyEvent({
        locationId,
        eventType: eventType as any,
        subjectType: subjectType as any,
        subjectId,
        subjectVersion: 1,
        sourceSystem: 'pos',
        sourceEventId,
        dispatchOrigin: 'manual_override',
        businessStage: 'initial_ready',
        contextSnapshot: {
          ...context,
          employeeId: auth.employee.id,
        },
      })
      dispatched = true
    } catch (importErr) {
      // Dispatcher not yet available (Phase 1 still building) — log and return success anyway
      console.warn('[Manual Page] Notification dispatcher not available yet, logging event only:', importErr)
    }

    // Always log the manual page event in audit trail regardless of dispatcher availability
    void db.$executeRawUnsafe(
      `INSERT INTO "NotificationDeviceEvent" (
        id, "deviceId", "locationId", "eventType",
        "subjectType", "subjectId", "employeeId", metadata, "createdAt"
      )
      SELECT gen_random_uuid()::text,
             COALESCE(
               (SELECT d.id FROM "NotificationDevice" d
                WHERE d."locationId" = $1 AND d."deviceNumber" = $5 AND d."deletedAt" IS NULL LIMIT 1),
               'manual-page-no-device'
             ),
             $1, 'manual_page', $2, $3, $4, $6::jsonb, CURRENT_TIMESTAMP`,
      locationId,
      subjectType,
      subjectId,
      auth.employee.id,
      (context.pagerNumber as string) || 'none',
      JSON.stringify({
        sourceEventId,
        eventType,
        message: message || null,
        dispatched,
        context,
      })
    ).catch(console.error)

    return NextResponse.json({
      data: {
        sourceEventId,
        subjectType,
        subjectId,
        eventType,
        pagerNumber: context.pagerNumber || null,
        dispatched,
      },
      message: dispatched
        ? 'Page dispatched successfully'
        : 'Page logged (notification engine not yet active)',
    })
  } catch (error) {
    console.error('[Manual Page] POST error:', error)
    return NextResponse.json({ error: 'Failed to send page' }, { status: 500 })
  }
})
