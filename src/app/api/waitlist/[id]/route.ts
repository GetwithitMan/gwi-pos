import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/waitlist/[id] — Update waitlist entry (status change)
 */
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    const body = await request.json()
    const { status } = body

    const validStatuses = ['waiting', 'notified', 'seated', 'no_show', 'cancelled']
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch existing entry
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT id, "customerName", "partySize", phone, status, "locationId"
      FROM "WaitlistEntry"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    const entry = existing[0]

    // Build update fields based on new status
    let extraFields = ''
    if (status === 'notified') {
      extraFields = ', "notifiedAt" = CURRENT_TIMESTAMP'
    } else if (status === 'seated') {
      extraFields = ', "seatedAt" = CURRENT_TIMESTAMP'
    }

    const updated: any[] = await db.$queryRawUnsafe(`
      UPDATE "WaitlistEntry"
      SET status = $1, "updatedAt" = CURRENT_TIMESTAMP ${extraFields}
      WHERE id = $2 AND "locationId" = $3
      RETURNING id, "customerName", "partySize", phone, notes, status, position,
                "quotedWaitMinutes", "notifiedAt", "seatedAt", "createdAt", "updatedAt"
    `, status, id, locationId)

    const updatedEntry = updated[0]

    // Notification Platform: dispatch waitlist_ready notification
    if (status === 'notified') {
      // Look up pagerNumber from target assignment (source of truth)
      let assignedPager: string | null = null
      try {
        const pagerAssignment: any[] = await db.$queryRawUnsafe(
          `SELECT "targetValue" FROM "NotificationTargetAssignment"
           WHERE "locationId" = $1
             AND "subjectType" = 'waitlist_entry'
             AND "subjectId" = $2
             AND status = 'active'
             AND "targetType" IN ('guest_pager', 'staff_pager')
           ORDER BY "isPrimary" DESC LIMIT 1`,
          locationId, id
        )
        assignedPager = pagerAssignment[0]?.targetValue || entry.pagerNumber || null
      } catch { /* non-fatal */ }

      // Try the notification platform first
      let usedNotificationPlatform = false
      try {
        const { notifyEvent } = await import('@/lib/notifications/dispatcher')
        await notifyEvent({
          locationId,
          eventType: 'waitlist_ready',
          subjectType: 'waitlist_entry',
          subjectId: id,
          subjectVersion: 1,
          sourceSystem: 'pos',
          sourceEventId: `waitlist_notify:${id}:${updatedEntry.updatedAt}`,
          dispatchOrigin: 'automatic',
          businessStage: 'initial_ready',
          contextSnapshot: {
            customerName: entry.customerName,
            partySize: entry.partySize,
            phone: entry.phone,
            pagerNumber: assignedPager,
          },
        })
        usedNotificationPlatform = true
      } catch {
        // Dispatcher not available — fall back to direct Twilio SMS (legacy path)
      }

      // Legacy fallback: direct Twilio SMS when notification platform is not active
      if (!usedNotificationPlatform && waitlistConfig.smsNotifications && entry.phone && isTwilioConfigured()) {
        const location = await db.location.findFirst({
          where: { id: locationId },
          select: { name: true },
        })
        const venueName = location?.name || 'the restaurant'

        void sendSMS({
          to: entry.phone,
          body: `Hi ${entry.customerName}, your table is ready at ${venueName}! Please check in within ${waitlistConfig.autoRemoveAfterMinutes} minutes.`,
        }).catch(err => console.error('[Waitlist] SMS send failed:', err))
      }
    }

    // Auto-release pager when waitlist entry is seated, cancelled, or no_show
    if (status === 'seated' || status === 'cancelled' || status === 'no_show') {
      void (async () => {
        try {
          const { releaseAssignmentsForSubject } = await import('@/lib/notifications/release-assignments')
          await releaseAssignmentsForSubject(locationId, 'waitlist_entry', id, `waitlist_${status}`)
        } catch (releaseErr) {
          console.warn('[Waitlist] Failed to release pager assignments:', releaseErr)
        }
      })()
    }

    // Recalculate positions for remaining active entries
    if (status === 'seated' || status === 'cancelled' || status === 'no_show') {
      await db.$queryRawUnsafe(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
          FROM "WaitlistEntry"
          WHERE "locationId" = $1 AND status IN ('waiting', 'notified')
        )
        UPDATE "WaitlistEntry" w
        SET position = r.new_pos
        FROM ranked r
        WHERE w.id = r.id
      `, locationId)
    }

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: status as any,
      entryId: updatedEntry.id,
      customerName: updatedEntry.customerName,
      partySize: updatedEntry.partySize,
    }).catch(console.error)

    return NextResponse.json({ data: updatedEntry })
  } catch (error) {
    console.error('[Waitlist] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update waitlist entry' }, { status: 500 })
  }
})

/**
 * DELETE /api/waitlist/[id] — Remove from waitlist (cancel)
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

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Fetch before delete for socket dispatch
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT id, "customerName", "partySize"
      FROM "WaitlistEntry"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!existing.length) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    const entry = existing[0]

    // Update status to cancelled instead of hard delete
    await db.$queryRawUnsafe(`
      UPDATE "WaitlistEntry"
      SET status = 'cancelled', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    // Recalculate positions
    await db.$queryRawUnsafe(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
        FROM "WaitlistEntry"
        WHERE "locationId" = $1 AND status IN ('waiting', 'notified')
      )
      UPDATE "WaitlistEntry" w
      SET position = r.new_pos
      FROM ranked r
      WHERE w.id = r.id
    `, locationId)

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'removed',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(console.error)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Waitlist] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove from waitlist' }, { status: 500 })
  }
})
