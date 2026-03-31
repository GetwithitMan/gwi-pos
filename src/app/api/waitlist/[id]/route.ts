import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('waitlist')

export const dynamic = 'force-dynamic'

/**
 * PUT /api/waitlist/[id] — Update waitlist entry (status change)
 */
export const PUT = withVenue(withAuth('POS_ACCESS', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    const body = await request.json()
    const { status } = body

    const validStatuses = ['waiting', 'notified', 'seated', 'no_show', 'cancelled']
    if (!status || !validStatuses.includes(status)) {
      return err(`Invalid status. Must be one of: ${validStatuses.join(', ')}`)
    }

    // Fetch existing entry
    const existing: any[] = await db.$queryRaw`
      SELECT id, "customerName", "partySize", phone, status, "locationId"
      FROM "WaitlistEntry"
      WHERE id = ${id} AND "locationId" = ${locationId}
    `

    if (!existing.length) {
      return notFound('Waitlist entry not found')
    }

    const entry = existing[0]

    // Build update fields based on new status
    let extraFields = ''
    if (status === 'notified') {
      extraFields = ', "notifiedAt" = CURRENT_TIMESTAMP'
    } else if (status === 'seated') {
      extraFields = ', "seatedAt" = CURRENT_TIMESTAMP'
    }

    // W1: Wrap UPDATE + notifyEvent in a transaction so notification is not lost on crash
    const updatedEntry = await db.$transaction(async (tx) => {
      const updated: any[] = await tx.$queryRaw`
        UPDATE "WaitlistEntry"
        SET status = ${status}, "updatedAt" = CURRENT_TIMESTAMP ${extraFields}
        WHERE id = ${id} AND "locationId" = ${locationId}
        RETURNING id, "customerName", "partySize", phone, notes, status, position,
                  "quotedWaitMinutes", "notifiedAt", "seatedAt", "createdAt", "updatedAt", version
      `

      const entry_ = updated[0]
      if (!entry_) throw new Error('Waitlist entry not found during update')

      // Notification Platform: dispatch waitlist_ready notification (inside transaction)
      if (status === 'notified') {
        // Look up pagerNumber from target assignment (source of truth)
        let assignedPager: string | null = null
        try {
          const pagerAssignment: any[] = await tx.$queryRaw`SELECT "targetValue" FROM "NotificationTargetAssignment"
             WHERE "locationId" = ${locationId}
               AND "subjectType" = 'waitlist_entry'
               AND "subjectId" = ${id}
               AND status = 'active'
               AND "targetType" IN ('guest_pager', 'staff_pager')
             ORDER BY "isPrimary" DESC LIMIT 1`
          assignedPager = pagerAssignment[0]?.targetValue || entry.pagerNumber || null
        } catch { /* non-fatal */ }

        // Try the notification platform first (notifyEvent enqueues a job — fast INSERT, safe in tx)
        try {
          const { notifyEvent } = await import('@/lib/notifications/dispatcher')
          await notifyEvent({
            locationId,
            eventType: 'waitlist_ready',
            subjectType: 'waitlist_entry',
            subjectId: id,
            subjectVersion: 1,
            sourceSystem: 'pos',
            sourceEventId: `waitlist_notify:${id}:${entry_.version || 1}`,
            dispatchOrigin: 'automatic',
            businessStage: 'initial_ready',
            contextSnapshot: {
              customerName: entry.customerName,
              partySize: entry.partySize,
              phone: entry.phone,
              pagerNumber: assignedPager,
            },
          })
        } catch {
          // Dispatcher not available — legacy SMS will be attempted outside tx
        }
      }

      return entry_
    })

    // Legacy fallback: direct Twilio SMS when notification platform is not active (outside tx, best-effort)
    if (status === 'notified' && waitlistConfig.smsNotifications && entry.phone && isTwilioConfigured()) {
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
      await db.$queryRaw`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
          FROM "WaitlistEntry"
          WHERE "locationId" = ${locationId} AND status IN ('waiting', 'notified')
        )
        UPDATE "WaitlistEntry" w
        SET position = r.new_pos
        FROM ranked r
        WHERE w.id = r.id
      `
    }

    pushUpstream()

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: status as any,
      entryId: updatedEntry.id,
      customerName: updatedEntry.customerName,
      partySize: updatedEntry.partySize,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok(updatedEntry)
  } catch (error) {
    console.error('[Waitlist] PUT error:', error)
    return err('Failed to update waitlist entry', 500)
  }
}))

/**
 * DELETE /api/waitlist/[id] — Remove from waitlist (cancel)
 */
export const DELETE = withVenue(withAuth('POS_ACCESS', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Fetch before delete for socket dispatch
    const existing: any[] = await db.$queryRaw`
      SELECT id, "customerName", "partySize"
      FROM "WaitlistEntry"
      WHERE id = ${id} AND "locationId" = ${locationId}
    `

    if (!existing.length) {
      return notFound('Waitlist entry not found')
    }

    const entry = existing[0]

    // Update status to cancelled instead of hard delete
    await db.$queryRaw`
      UPDATE "WaitlistEntry"
      SET status = 'cancelled', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${id} AND "locationId" = ${locationId}
    `

    // Recalculate positions
    await db.$queryRaw`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
        FROM "WaitlistEntry"
        WHERE "locationId" = ${locationId} AND status IN ('waiting', 'notified')
      )
      UPDATE "WaitlistEntry" w
      SET position = r.new_pos
      FROM ranked r
      WHERE w.id = r.id
    `

    pushUpstream()

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'removed',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true })
  } catch (error) {
    console.error('[Waitlist] DELETE error:', error)
    return err('Failed to remove from waitlist', 500)
  }
}))
