import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
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
      SELECT w.id, w."customerName", w."partySize", w.phone, w.notes, w.status, w.position,
             w."quotedWaitMinutes", w."notifiedAt", w."seatedAt", w."createdAt", w."updatedAt",
             w."pagerNumber",
             nta."targetValue" as "assignedPagerNumber"
      FROM "WaitlistEntry" w
      LEFT JOIN "NotificationTargetAssignment" nta
        ON nta."subjectType" = 'waitlist_entry'
        AND nta."subjectId" = w.id
        AND nta.status = 'active'
        AND nta."targetType" IN ('guest_pager', 'staff_pager')
        AND nta."isPrimary" = true
      WHERE w."locationId" = $1
        AND w.status IN ('waiting', 'notified')
      ORDER BY w.position ASC, w."createdAt" ASC
    `, locationId)

    // Calculate live wait estimates
    const now = new Date()
    const enriched = entries.map((entry, index) => {
      const waitingSince = new Date(entry.createdAt)
      const elapsedMinutes = Math.round((now.getTime() - waitingSince.getTime()) / 60000)
      const estimatedWaitMinutes = index * waitlistConfig.estimateMinutesPerTurn

      return {
        ...entry,
        // Prefer target assignment pagerNumber over cache field (source of truth hierarchy)
        pagerNumber: entry.assignedPagerNumber || entry.pagerNumber || null,
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
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
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
    const { customerName, partySize, phone, notes, assignPager } = body

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

    // Auto-assign pager if requested
    let pagerNumber: string | null = null
    if (assignPager) {
      try {
        const assignResult: any[] = await db.$queryRawUnsafe(
          `WITH device AS (
            SELECT id, "deviceNumber", "providerId"
            FROM "NotificationDevice"
            WHERE "locationId" = $1
              AND "deviceType" = 'pager'
              AND status = 'available'
              AND "deletedAt" IS NULL
            ORDER BY "deviceNumber"::int ASC NULLS LAST, "deviceNumber" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          ), updated_device AS (
            UPDATE "NotificationDevice" d
            SET status = 'assigned',
                "assignedToSubjectType" = 'waitlist_entry',
                "assignedToSubjectId" = $2,
                "assignedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM device
            WHERE d.id = device.id
            RETURNING d.id, d."deviceNumber", d."providerId"
          )
          SELECT * FROM updated_device`,
          locationId,
          entry.id
        )

        if (assignResult.length > 0) {
          pagerNumber = assignResult[0].deviceNumber

          // Create target assignment
          void db.$executeRawUnsafe(
            `INSERT INTO "NotificationTargetAssignment" (
              id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
              "providerId", "isPrimary", source, status,
              "assignedAt", "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid()::text, $1, 'waitlist_entry', $2, 'guest_pager', $3,
              $4, true, 'auto_assign', 'active',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`,
            locationId, entry.id, pagerNumber, assignResult[0].providerId
          ).catch(console.error)

          // Sync pagerNumber cache
          void db.$executeRawUnsafe(
            `UPDATE "WaitlistEntry" SET "pagerNumber" = $2 WHERE id = $1`,
            entry.id, pagerNumber
          ).catch(console.error)

          // Log device event
          void db.$executeRawUnsafe(
            `INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "subjectType", "subjectId", metadata, "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, 'assigned', 'waitlist_entry', $3, '{"autoAssign":true}'::jsonb, CURRENT_TIMESTAMP)`,
            assignResult[0].id, locationId, entry.id
          ).catch(console.error)
        }
      } catch (pagerErr) {
        // Non-fatal: pager assignment is best-effort
        console.warn('[Waitlist] Auto-assign pager failed:', pagerErr)
      }
    }

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'added',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(console.error)

    return NextResponse.json({
      data: { ...entry, pagerNumber },
      message: `Added to waitlist at position ${position}. Estimated wait: ~${quotedWaitMinutes} minutes.${pagerNumber ? ` Pager ${pagerNumber} assigned.` : ''}`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Waitlist] POST error:', error)
    return NextResponse.json({ error: 'Failed to add to waitlist' }, { status: 500 })
  }
}))
