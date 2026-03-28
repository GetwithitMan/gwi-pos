import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/online-order-timeout
 *
 * Detects online orders stuck in "received" status — indicating the NUC
 * dispatch worker never picked them up. Two tiers:
 *
 *  1. 30+ minutes in "received": create AuditLog warning (online_order_stale)
 *  2. 60+ minutes in "received": cancel the order (status → cancelled) +
 *     AuditLog entry (online_order_timeout_cancelled)
 *
 * Runs every 5 minutes via Vercel Cron. Idempotent — already-cancelled orders
 * are excluded by the WHERE clause.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const locations = await venueDb.location.findMany({
      where: { deletedAt: null },
      select: { id: true },
    })

    for (const loc of locations) {
      try {
        // ── 1. Find stale orders (30+ min in "received") ─────────────────
        const staleOrders = await venueDb.$queryRaw<
          { id: string; orderNumber: number; createdAt: Date; source: string | null; minutesStale: number }[]
        >(Prisma.sql`
          SELECT
            id,
            "orderNumber",
            "createdAt",
            source,
            EXTRACT(EPOCH FROM (NOW() - "createdAt"))::int / 60 AS "minutesStale"
          FROM "Order"
          WHERE "locationId" = ${loc.id}
            AND "status" = 'received'
            AND "source" = 'online'
            AND "deletedAt" IS NULL
            AND "createdAt" < NOW() - INTERVAL '30 minutes'
          ORDER BY "createdAt" ASC
        `)

        if (staleOrders.length === 0) {
          allResults.push({ slug, locationId: loc.id, staleCount: 0, cancelledCount: 0 })
          continue
        }

        let cancelledCount = 0

        for (const order of staleOrders) {
          const minutesStale = Number(order.minutesStale)

          if (minutesStale >= 60) {
            // ── 2a. 60+ minutes: cancel the order ──────────────────────
            await venueDb.order.update({
              where: { id: order.id },
              data: {
                status: 'cancelled',
                lastMutatedBy: 'cloud',
                metadata: {
                  ...(typeof (order as any).metadata === 'object' && (order as any).metadata !== null
                    ? (order as any).metadata
                    : {}),
                  cancelledReason: 'timeout',
                  cancelledAt: now.toISOString(),
                  cancelledBy: 'cron:online-order-timeout',
                },
              },
            })

            // AuditLog for cancellation
            await venueDb.auditLog.create({
              data: {
                locationId: loc.id,
                action: 'online_order_timeout_cancelled',
                entityType: 'order',
                entityId: order.id,
                details: {
                  orderNumber: order.orderNumber,
                  minutesStale,
                  originalStatus: 'received',
                  newStatus: 'cancelled',
                  reason: 'Online order stuck in received status for 60+ minutes — auto-cancelled by timeout cron',
                },
              },
            })

            cancelledCount++
            console.warn(
              `[cron:online-order-timeout] Venue ${slug} location ${loc.id}: ` +
              `CANCELLED order #${order.orderNumber} (${order.id}) — ${minutesStale} min stale`
            )
          } else {
            // ── 2b. 30–59 minutes: warning audit log only ──────────────
            // Idempotent: check if we already logged a stale warning for this order today
            const existingWarning = await venueDb.auditLog.findFirst({
              where: {
                locationId: loc.id,
                action: 'online_order_stale',
                entityId: order.id,
                createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
              },
              select: { id: true },
            })

            if (!existingWarning) {
              await venueDb.auditLog.create({
                data: {
                  locationId: loc.id,
                  action: 'online_order_stale',
                  entityType: 'order',
                  entityId: order.id,
                  details: {
                    orderNumber: order.orderNumber,
                    minutesStale,
                    status: 'received',
                    warning: 'Online order has been in received status for 30+ minutes — NUC dispatch may be down',
                  },
                },
              })
            }

            console.warn(
              `[cron:online-order-timeout] Venue ${slug} location ${loc.id}: ` +
              `STALE order #${order.orderNumber} (${order.id}) — ${minutesStale} min in received status`
            )
          }
        }

        allResults.push({
          slug,
          locationId: loc.id,
          staleCount: staleOrders.length,
          cancelledCount,
          warnedCount: staleOrders.length - cancelledCount,
        })
      } catch (locErr) {
        console.error(`[cron:online-order-timeout] Venue ${slug} location ${loc.id} error:`, locErr)
        allResults.push({
          slug,
          locationId: loc.id,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
      }
    }
  }, { label: 'cron:online-order-timeout' })

  return ok({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}
