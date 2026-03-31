import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('waitlist')

export const dynamic = 'force-dynamic'

/**
 * GET /api/waitlist — List current waitlist entries
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return err('Waitlist is not enabled')
    }

    const entries: any[] = await db.$queryRaw`
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
      WHERE w."locationId" = ${locationId}
        AND w.status IN ('waiting', 'notified')
      ORDER BY w.position ASC, w."createdAt" ASC
    `

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

    return ok(enriched)
  } catch (error) {
    console.error('[Waitlist] GET error:', error)
    return err('Failed to fetch waitlist', 500)
  }
})

/**
 * POST /api/waitlist — Add entry to waitlist
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return err('Waitlist is not enabled')
    }

    const body = await request.json()
    const { customerName, partySize, phone, notes, assignPager } = body

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return err('Customer name is required')
    }

    const size = Number(partySize)
    if (!size || size < 1 || size > waitlistConfig.maxPartySize) {
      return err(`Party size must be between 1 and ${waitlistConfig.maxPartySize}`)
    }

    // Check waitlist capacity
    const countResult: any[] = await db.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM "WaitlistEntry"
      WHERE "locationId" = ${locationId}
        AND status IN ('waiting', 'notified')
    `

    const currentCount = countResult[0]?.count ?? 0
    if (currentCount >= waitlistConfig.maxWaitlistSize) {
      return err('Waitlist is currently full. Please try again later.', 409)
    }

    // Calculate position (next after current active entries)
    const position = currentCount + 1
    const quotedWaitMinutes = (position - 1) * waitlistConfig.estimateMinutesPerTurn

    const inserted: any[] = await db.$queryRaw`
      INSERT INTO "WaitlistEntry" ("locationId", "customerName", "partySize", phone, notes, status, position, "quotedWaitMinutes")
      VALUES (${locationId}, ${customerName.trim()}, ${size}, ${phone?.trim() || null}, ${notes?.trim() || null}, 'waiting', ${position}, ${quotedWaitMinutes})
      RETURNING id, "customerName", "partySize", phone, notes, status, position, "quotedWaitMinutes", "createdAt"
    `

    const entry = inserted[0]

    // Auto-assign pager if requested
    let pagerNumber: string | null = null
    if (assignPager) {
      try {
        const assignResult: any[] = await db.$queryRaw`WITH device AS (
            SELECT id, "deviceNumber", "providerId"
            FROM "NotificationDevice"
            WHERE "locationId" = ${locationId}
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
                "assignedToSubjectId" = ${entry.id},
                "assignedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM device
            WHERE d.id = device.id
            RETURNING d.id, d."deviceNumber", d."providerId"
          )
          SELECT * FROM updated_device`

        if (assignResult.length > 0) {
          pagerNumber = assignResult[0].deviceNumber

          // Create target assignment
          void db.$executeRaw`INSERT INTO "NotificationTargetAssignment" (
              id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
              "providerId", "isPrimary", source, status,
              "assignedAt", "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid()::text, ${locationId}, 'waitlist_entry', ${entry.id}, 'guest_pager', ${pagerNumber},
              ${assignResult[0].providerId}, true, 'auto_assign', 'active',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`.catch(err => log.warn({ err }, 'Background task failed'))

          // Sync pagerNumber cache
          void db.$executeRaw`UPDATE "WaitlistEntry" SET "pagerNumber" = ${pagerNumber} WHERE id = ${entry.id} AND "locationId" = ${locationId}`.catch(err => log.warn({ err }, 'Background task failed'))

          // Log device event
          void db.$executeRaw`INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "subjectType", "subjectId", metadata, "createdAt")
             VALUES (gen_random_uuid()::text, ${assignResult[0].id}, ${locationId}, 'assigned', 'waitlist_entry', ${entry.id}, '{"autoAssign":true}'::jsonb, CURRENT_TIMESTAMP)`.catch(err => log.warn({ err }, 'Background task failed'))
        }
      } catch (pagerErr) {
        // Non-fatal: pager assignment is best-effort
        console.warn('[Waitlist] Auto-assign pager failed:', pagerErr)
      }
    }

    pushUpstream()

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'added',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: { ...entry, pagerNumber },
      message: `Added to waitlist at position ${position}. Estimated wait: ~${quotedWaitMinutes} minutes.${pagerNumber ? ` Pager ${pagerNumber} assigned.` : ''}`,
    }, { status: 201 })
  } catch (error) {
    console.error('[Waitlist] POST error:', error)
    return err('Failed to add to waitlist', 500)
  }
}))
