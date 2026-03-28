import { NextRequest } from 'next/server'
import { OrderRepository } from '@/lib/repositories'
import {
  dispatchFloorPlanUpdate,
  dispatchEntertainmentStatusChanged,
  dispatchEntertainmentUpdate,
  dispatchOrderTotalsUpdate,
} from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { notifyNuc } from '@/lib/cron-nuc-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { ok } from '@/lib/api-response'

import { expireSession } from '@/lib/domain/entertainment'
import { recalculateOrderTotals } from '@/lib/domain/order-items'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('cron-entertainment-expiry')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── Route Handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allProcessed: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    let expiredSessionCount = 0
    let expiredWaitlistCount = 0
    let staleNotifiedCount = 0

    // ── Step 1: Find expired entertainment sessions ──────────────
    // Query uses venueDb (not adminDb) so it is correctly scoped to the
    // current venue's database on both NUC and Vercel multi-tenant mode.
    const expiredItems = await venueDb.orderItem.findMany({
      where: {
        blockTimeExpiresAt: { not: null },
        blockTimeStartedAt: { not: null },
        menuItem: {
          itemType: 'timed_rental',
          entertainmentStatus: 'in_use',
        },
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            ratePerMinute: true,
            minimumCharge: true,
            incrementMinutes: true,
            graceMinutes: true,
            timedPricing: true,
            happyHourEnabled: true,
            happyHourDiscount: true,
            happyHourStart: true,
            happyHourEnd: true,
            happyHourDays: true,
            overtimeEnabled: true,
            overtimeMode: true,
            overtimeMultiplier: true,
            overtimePerMinuteRate: true,
            overtimeFlatFee: true,
            overtimeGraceMinutes: true,
          },
        },
        order: {
          select: {
            id: true,
            locationId: true,
            status: true,
          },
        },
      },
    })

    // ── Step 1b: Filter out sessions still within their grace period ──
    // If a MenuItem has graceMinutes, the session only truly expires at
    // blockTimeExpiresAt + graceMinutes. This gives customers a buffer
    // before auto-expiry kicks in.
    const trulyExpiredItems = expiredItems.filter((item) => {
      const expiresAt = item.blockTimeExpiresAt!
      const graceMinutes = item.menuItem.graceMinutes ?? 0
      const effectiveExpiry = new Date(expiresAt.getTime() + graceMinutes * 60_000)
      return effectiveExpiry < now
    })

    // ── Step 2: Process each expired session sequentially ─────────
    const locationIdsToRefresh = new Set<string>()

    for (const item of trulyExpiredItems) {
      try {
        const result = await venueDb.$transaction(async (tx: any) => {
          return expireSession(tx, {
            id: item.id,
            menuItemId: item.menuItem.id,
            orderStatus: item.order.status,
            menuItemPrice: item.menuItem.price,
            menuItemRatePerMinute: item.menuItem.ratePerMinute,
            menuItemMinimumCharge: item.menuItem.minimumCharge,
            menuItemIncrementMinutes: item.menuItem.incrementMinutes,
            menuItemGraceMinutes: item.menuItem.graceMinutes,
            menuItemTimedPricing: item.menuItem.timedPricing,
            menuItemHappyHourEnabled: item.menuItem.happyHourEnabled,
            menuItemHappyHourDiscount: item.menuItem.happyHourDiscount,
            menuItemHappyHourStart: item.menuItem.happyHourStart,
            menuItemHappyHourEnd: item.menuItem.happyHourEnd,
            menuItemHappyHourDays: item.menuItem.happyHourDays,
            menuItemOvertimeEnabled: item.menuItem.overtimeEnabled,
            menuItemOvertimeMode: item.menuItem.overtimeMode,
            menuItemOvertimeMultiplier: item.menuItem.overtimeMultiplier,
            menuItemOvertimePerMinuteRate: item.menuItem.overtimePerMinuteRate,
            menuItemOvertimeFlatFee: item.menuItem.overtimeFlatFee,
            menuItemOvertimeGraceMinutes: item.menuItem.overtimeGraceMinutes,
          }, now)
        })

        if (result.skipped) continue

        locationIdsToRefresh.add(item.order.locationId)

        // Sync: push upstream after entertainment session mutations
        void pushUpstream()

        // Audit trail: auto-expired session
        void venueDb.auditLog.create({
          data: {
            locationId: item.order.locationId,
            employeeId: null,
            action: 'entertainment_session_auto_expired',
            entityType: 'order_item',
            entityId: item.id,
            details: {
              menuItemId: item.menuItem.id,
              itemName: item.menuItem.name,
              orderId: item.order.id,
              graceMinutes: item.menuItem.graceMinutes ?? 0,
              blockTimeExpiresAt: item.blockTimeExpiresAt?.toISOString() ?? null,
              finalCharge: result.closedOrder ? 0 : result.newPrice,
              closedOrder: result.closedOrder,
              triggeredBy: 'cron:entertainment-expiry',
            },
          },
        }).catch(err => log.warn({ err }, 'Audit log failed for auto-expired session'))

        // BUG-L1 FIX: Recalculate order totals after entertainment price change
        if (!result.closedOrder) {
          void (async () => {
            try {
              const order = await OrderRepository.getOrderByIdWithInclude(
                item.order.id,
                item.order.locationId,
                { location: { select: { settings: true } } },
              )
              if (!order) return
              const totals = await recalculateOrderTotals(
                venueDb, item.order.id, (order as any).location.settings,
                Number(order.tipTotal) || 0, order.isTaxExempt
              )
              await OrderRepository.updateOrder(item.order.id, item.order.locationId, {
                subtotal: totals.subtotal,
                taxTotal: totals.taxTotal,
                taxFromInclusive: totals.taxFromInclusive,
                taxFromExclusive: totals.taxFromExclusive,
                total: totals.total,
                commissionTotal: totals.commissionTotal,
                itemCount: totals.itemCount,
              })
              // Socket dispatch — works on NUC, falls back to NUC notification on Vercel
              if (process.env.VERCEL) {
                void notifyNuc(slug, 'ORDER_TOTALS_UPDATE', {
                  locationId: item.order.locationId,
                  orderId: item.order.id,
                  subtotal: totals.subtotal,
                  taxTotal: totals.taxTotal,
                  tipTotal: Number(order.tipTotal) || 0,
                  discountTotal: 0,
                  total: totals.total,
                  commissionTotal: totals.commissionTotal,
                }).catch(err => log.warn({ err }, 'Background task failed'))
              } else {
                void dispatchOrderTotalsUpdate(item.order.locationId, item.order.id, {
                  subtotal: totals.subtotal,
                  taxTotal: totals.taxTotal,
                  tipTotal: Number(order.tipTotal) || 0,
                  discountTotal: 0,
                  total: totals.total,
                  commissionTotal: totals.commissionTotal,
                }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
              }
            } catch (err) {
              console.error('[cron:entertainment-expiry] Failed to recalculate order totals:', err)
            }
          })()
        }

        // Fire-and-forget socket events (outside transaction)
        if (process.env.VERCEL) {
          void notifyNuc(slug, 'ENTERTAINMENT_STATUS_CHANGED', {
            locationId: item.order.locationId,
            itemId: item.menuItem.id,
            entertainmentStatus: 'available',
            currentOrderId: null,
            expiresAt: null,
          }).catch(err => log.warn({ err }, 'Background task failed'))
        } else {
          void dispatchEntertainmentStatusChanged(item.order.locationId, {
            itemId: item.menuItem.id,
            entertainmentStatus: 'available',
            currentOrderId: null,
            expiresAt: null,
          }).catch(err => log.warn({ err }, 'Background task failed'))
        }

        void notifyNextWaitlistEntry(item.order.locationId, item.menuItem.id, item.menuItem.name).catch(err => log.warn({ err }, 'Background task failed'))

        if (!result.closedOrder) {
          if (process.env.VERCEL) {
            void notifyNuc(slug, 'ENTERTAINMENT_UPDATE', {
              locationId: item.order.locationId,
              sessionId: item.id,
              tableId: item.menuItem.id,
              tableName: item.menuItem.name,
              action: 'stopped',
              expiresAt: null,
              startedAt: null,
            }).catch(err => log.warn({ err }, 'Background task failed'))
          } else {
            void dispatchEntertainmentUpdate(item.order.locationId, {
              sessionId: item.id,
              tableId: item.menuItem.id,
              tableName: item.menuItem.name,
              action: 'stopped',
              expiresAt: null,
              startedAt: null,
            }).catch(err => log.warn({ err }, 'Background task failed'))
          }

          void emitOrderEvent(
            item.order.locationId,
            item.order.id,
            'ITEM_UPDATED',
            {
              lineItemId: item.id,
              priceCents: Math.round(result.newPrice * 100),
              reason: 'block_time_expired',
            },
            { deviceId: 'cron-entertainment-expiry' }
          ).catch(err => log.warn({ err }, 'Background task failed'))

          expiredSessionCount++
        }
      } catch (itemErr) {
        console.error(
          `[cron:entertainment-expiry] Venue ${slug}: Failed to process expired session for OrderItem ${item.id}:`,
          itemErr
        )
      }
    }

    // Dispatch floor plan updates grouped by location
    for (const locationId of locationIdsToRefresh) {
      if (process.env.VERCEL) {
        void notifyNuc(slug, 'FLOOR_PLAN_UPDATE', { locationId }).catch(err => log.warn({ err }, 'Background task failed'))
      } else {
        void dispatchFloorPlanUpdate(locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // ── Step 3: Expire stale waitlist entries ────────────────────

    // 3a: Waiting entries past their expiresAt
    const expiredWaitlist = await venueDb.entertainmentWaitlist.findMany({
      where: {
        expiresAt: { lt: now },
        status: 'waiting',
        deletedAt: null,
      },
    })

    for (const entry of expiredWaitlist) {
      try {
        await venueDb.entertainmentWaitlist.update({
          where: { id: entry.id },
          data: { status: 'expired' },
        })

        // Decrement positions of entries after this one
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
      } catch (waitlistErr) {
        console.error(
          `[cron:entertainment-expiry] Venue ${slug}: Failed to expire waitlist entry ${entry.id}:`,
          waitlistErr
        )
      }
    }
    expiredWaitlistCount = expiredWaitlist.length

    // 3b: Notified entries that haven't been seated within 10 minutes
    const staleNotified = await venueDb.entertainmentWaitlist.findMany({
      where: {
        status: 'notified',
        notifiedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
        deletedAt: null,
      },
      include: {
        element: {
          select: { id: true, linkedMenuItemId: true, name: true },
        },
      },
    })

    for (const entry of staleNotified) {
      try {
        await venueDb.entertainmentWaitlist.update({
          where: { id: entry.id },
          data: {
            status: 'expired',
            notes: 'Auto-expired -- no response within 10 minutes',
          },
        })

        // Decrement positions of entries after this one
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

        // Auto-notify the next waiting entry for this item
        if (entry.element?.linkedMenuItemId) {
          void notifyNextWaitlistEntry(
            entry.locationId,
            entry.element.linkedMenuItemId,
            entry.element.name || undefined
          ).catch(err => log.warn({ err }, 'Background task failed'))
        }
      } catch (notifiedErr) {
        console.error(
          `[cron:entertainment-expiry] Venue ${slug}: Failed to expire stale notified entry ${entry.id}:`,
          notifiedErr
        )
      }
    }
    staleNotifiedCount = staleNotified.length

    allProcessed[slug] = {
      expiredSessions: expiredSessionCount,
      expiredWaitlist: expiredWaitlistCount,
      staleNotified: staleNotifiedCount,
    }
  }, { label: 'cron:entertainment-expiry' })

  return ok({
    ...summary,
    processed: allProcessed,
    timestamp: now.toISOString(),
  })
}
