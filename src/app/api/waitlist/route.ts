import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/waitlist — List current waitlist entries
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return NextResponse.json({ error: 'Waitlist is not enabled' }, { status: 400 })
    }

    const entries: any[] = await db.$queryRawUnsafe(`
      SELECT id, "customerName", "partySize", phone, notes, status, position,
             "quotedWaitMinutes", "notifiedAt", "seatedAt", "createdAt", "updatedAt"
      FROM "WaitlistEntry"
      WHERE "locationId" = $1
        AND status IN ('waiting', 'notified')
      ORDER BY position ASC, "createdAt" ASC
    `, locationId)

    // Calculate live wait estimates
    const now = new Date()
    const enriched = entries.map((entry, index) => {
      const waitingSince = new Date(entry.createdAt)
      const elapsedMinutes = Math.round((now.getTime() - waitingSince.getTime()) / 60000)
      const estimatedWaitMinutes = index * waitlistConfig.estimateMinutesPerTurn

      return {
        ...entry,
        position: index + 1,
        elapsedMinutes,
        estimatedWaitMinutes,
      }
    })

    return NextResponse.json({ data: enriched })
  } catch (error) {
    console.error('[Waitlist] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 })
  }
})

/**
 * POST /api/waitlist — Add entry to waitlist
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return NextResponse.json({ error: 'Waitlist is not enabled' }, { status: 400 })
    }

    const body = await request.json()
    const { customerName, partySize, phone, notes } = body

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }

    const size = Number(partySize)
    if (!size || size < 1 || size > waitlistConfig.maxPartySize) {
      return NextResponse.json(
        { error: `Party size must be between 1 and ${waitlistConfig.maxPartySize}` },
        { status: 400 }
      )
    }

    // Check waitlist capacity
    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "WaitlistEntry"
      WHERE "locationId" = $1
        AND status IN ('waiting', 'notified')
    `, locationId)

    const currentCount = countResult[0]?.count ?? 0
    if (currentCount >= waitlistConfig.maxWaitlistSize) {
      return NextResponse.json(
        { error: 'Waitlist is currently full. Please try again later.' },
        { status: 409 }
      )
    }

    // Calculate position (next after current active entries)
    const position = currentCount + 1
    const quotedWaitMinutes = (position - 1) * waitlistConfig.estimateMinutesPerTurn

    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "WaitlistEntry" ("locationId", "customerName", "partySize", phone, notes, status, position, "quotedWaitMinutes")
      VALUES ($1, $2, $3, $4, $5, 'waiting', $6, $7)
      RETURNING id, "customerName", "partySize", phone, notes, status, position, "quotedWaitMinutes", "createdAt"
    `, locationId, customerName.trim(), size, phone?.trim() || null, notes?.trim() || null, position, quotedWaitMinutes)

    const entry = inserted[0]

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'added',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(console.error)

    return NextResponse.json({
      data: entry,
      message: `Added to waitlist at position ${position}. Estimated wait: ~${quotedWaitMinutes} minutes.`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Waitlist] POST error:', error)
    return NextResponse.json({ error: 'Failed to add to waitlist' }, { status: 500 })
  }
})
