import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { sendSMS, formatPhoneE164, isTwilioConfigured } from '@/lib/twilio'

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

    // Send SMS notification when status changes to 'notified'
    if (status === 'notified' && waitlistConfig.smsNotifications && entry.phone && isTwilioConfigured()) {
      // Get venue name for the SMS
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
