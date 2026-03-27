import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { dispatchEntertainmentWaitlistChanged } from '@/lib/socket-dispatch'
import { notifyNuc } from '@/lib/cron-nuc-notify'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cron-entertainment-waitlist-expiry')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** How long a notified entry can go without being seated before auto-expiring */
const NO_SHOW_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

/**
 * GET /api/cron/entertainment-waitlist-expiry -- Every 5 minutes
 *
 * Expires entertainment waitlist entries that were notified but never showed up.
 * When status='notified' and notifiedAt is older than 15 minutes:
 *   1. Mark as 'expired' (no_show)
 *   2. Auto-notify the next waiting entry for the same element/type
 *   3. Emit socket events so UIs refresh
 *   4. Create AuditLog for traceability
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const cutoff = new Date(now.getTime() - NO_SHOW_TIMEOUT_MS)
  const allProcessed: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    let expiredCount = 0

    // Find notified entries that have exceeded the no-show timeout
    const staleNotified = await venueDb.entertainmentWaitlist.findMany({
      where: {
        status: 'notified',
        notifiedAt: { lt: cutoff },
        deletedAt: null,
      },
      include: {
        element: {
          select: {
            id: true,
            linkedMenuItemId: true,
            name: true,
            visualType: true,
          },
        },
      },
    })

    for (const entry of staleNotified) {
      try {
        // ---- 1. Mark as expired (no-show) ----
        await venueDb.entertainmentWaitlist.update({
          where: { id: entry.id },
          data: {
            status: 'expired',
            notes: entry.notes
              ? `${entry.notes} | Auto-expired: no-show after 15 minutes`
              : 'Auto-expired: no-show after 15 minutes',
          },
        })

        // ---- 2. Decrement positions of entries after this one ----
        await venueDb.entertainmentWaitlist.updateMany({
          where: {
            locationId: entry.locationId,
            status: 'waiting',
            deletedAt: null,
            position: { gt: entry.position },
            ...(entry.elementId
              ? { elementId: entry.elementId }
              : { visualType: entry.visualType }),
          },
          data: { position: { decrement: 1 } },
        })

        // ---- 3. Auto-notify next waiting entry ----
        if (entry.element?.linkedMenuItemId) {
          void notifyNextWaitlistEntry(
            entry.locationId,
            entry.element.linkedMenuItemId,
            entry.element.name || undefined,
          ).catch(err => log.warn({ err }, 'notifyNextWaitlistEntry failed'))
        }

        // ---- 4. Emit socket events ----
        // Get remaining waitlist count for the element/type
        const remainingCount = await venueDb.entertainmentWaitlist.count({
          where: {
            locationId: entry.locationId,
            status: 'waiting',
            deletedAt: null,
            ...(entry.elementId
              ? { elementId: entry.elementId }
              : { visualType: entry.visualType }),
          },
        })

        const itemId = entry.element?.linkedMenuItemId || entry.elementId || entry.visualType || ''

        if (process.env.VERCEL) {
          void notifyNuc(slug, 'entertainment:waitlist-changed', {
            locationId: entry.locationId,
            itemId,
            waitlistCount: remainingCount,
          }).catch(err => log.warn({ err }, 'notifyNuc waitlist-changed failed'))
        } else {
          void dispatchEntertainmentWaitlistChanged(entry.locationId, {
            itemId,
            waitlistCount: remainingCount,
          }, { async: true }).catch(err => log.warn({ err }, 'dispatchEntertainmentWaitlistChanged failed'))
        }

        // ---- 5. Create AuditLog ----
        void venueDb.auditLog.create({
          data: {
            locationId: entry.locationId,
            action: 'entertainment_waitlist_no_show',
            entityType: 'entertainment_waitlist',
            entityId: entry.id,
            details: {
              customerName: entry.customerName,
              phone: entry.phone,
              elementId: entry.elementId,
              visualType: entry.visualType,
              notifiedAt: entry.notifiedAt?.toISOString(),
              expiredAt: now.toISOString(),
              minutesSinceNotified: entry.notifiedAt
                ? Math.round((now.getTime() - entry.notifiedAt.getTime()) / 60_000)
                : null,
            },
          },
        }).catch(err => log.warn({ err }, 'AuditLog create failed'))

        expiredCount++
      } catch (entryErr) {
        log.error(
          { err: entryErr, entryId: entry.id },
          `Venue ${slug}: Failed to expire stale notified waitlist entry`
        )
      }
    }

    allProcessed[slug] = {
      staleNotifiedFound: staleNotified.length,
      expired: expiredCount,
    }
  }, { label: 'cron:entertainment-waitlist-expiry' })

  return NextResponse.json({
    ...summary,
    processed: allProcessed,
    timestamp: now.toISOString(),
  })
}
