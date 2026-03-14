import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  dispatchFloorPlanUpdate,
  dispatchEntertainmentStatusChanged,
  dispatchEntertainmentUpdate,
} from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'

import { expireSession } from '@/lib/domain/entertainment'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── Route Handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let expiredSessionCount = 0
  let expiredWaitlistCount = 0
  let staleNotifiedCount = 0

  try {
    // ── Step 1: Find expired entertainment sessions ──────────────
    const expiredItems = await db.orderItem.findMany({
      where: {
        blockTimeExpiresAt: { lt: now },
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

    // ── Step 2: Process each expired session sequentially ─────────
    const locationIdsToRefresh = new Set<string>()

    for (const item of expiredItems) {
      try {
        const result = await db.$transaction(async (tx) => {
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

        // Fire-and-forget socket events (outside transaction)
        void dispatchEntertainmentStatusChanged(item.order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }).catch(console.error)

        void notifyNextWaitlistEntry(item.order.locationId, item.menuItem.id, item.menuItem.name).catch(console.error)

        if (!result.closedOrder) {
          void dispatchEntertainmentUpdate(item.order.locationId, {
            sessionId: item.id,
            tableId: item.menuItem.id,
            tableName: item.menuItem.name,
            action: 'stopped',
            expiresAt: null,
            startedAt: null,
          }).catch(console.error)

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
          ).catch(console.error)

          expiredSessionCount++
        }
      } catch (itemErr) {
        console.error(
          `[entertainment-expiry] Failed to process expired session for OrderItem ${item.id}:`,
          itemErr
        )
      }
    }

    // Dispatch floor plan updates grouped by location
    for (const locationId of locationIdsToRefresh) {
      void dispatchFloorPlanUpdate(locationId).catch(console.error)
    }

    // ── Step 3: Expire stale waitlist entries ────────────────────

    // 3a: Waiting entries past their expiresAt
    const expiredWaitlist = await db.entertainmentWaitlist.findMany({
      where: {
        expiresAt: { lt: now },
        status: 'waiting',
        deletedAt: null,
      },
    })

    for (const entry of expiredWaitlist) {
      try {
        await db.entertainmentWaitlist.update({
          where: { id: entry.id },
          data: { status: 'expired' },
        })

        // Decrement positions of entries after this one
        await db.entertainmentWaitlist.updateMany({
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
          `[entertainment-expiry] Failed to expire waitlist entry ${entry.id}:`,
          waitlistErr
        )
      }
    }
    expiredWaitlistCount = expiredWaitlist.length

    // 3b: Notified entries that haven't been seated within 10 minutes
    const staleNotified = await db.entertainmentWaitlist.findMany({
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
        await db.entertainmentWaitlist.update({
          where: { id: entry.id },
          data: {
            status: 'expired',
            notes: 'Auto-expired — no response within 10 minutes',
          },
        })

        // Decrement positions of entries after this one
        await db.entertainmentWaitlist.updateMany({
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
          ).catch(console.error)
        }
      } catch (notifiedErr) {
        console.error(
          `[entertainment-expiry] Failed to expire stale notified entry ${entry.id}:`,
          notifiedErr
        )
      }
    }
    staleNotifiedCount = staleNotified.length

    // ── Step 4: Log and return summary ───────────────────────────
    return NextResponse.json({
      ok: true,
      processed: {
        expiredSessions: expiredSessionCount,
        expiredWaitlist: expiredWaitlistCount,
        staleNotified: staleNotifiedCount,
      },
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('[entertainment-expiry] Fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
