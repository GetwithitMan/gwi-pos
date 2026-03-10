import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  dispatchFloorPlanUpdate,
  dispatchEntertainmentStatusChanged,
  dispatchEntertainmentUpdate,
} from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import {
  calculateCharge,
  getActiveRate,
  type EntertainmentPricing,
} from '@/lib/entertainment-pricing'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── Helpers ────────────────────────────────────────────────────────

function buildPricing(menuItem: {
  ratePerMinute: any
  minimumCharge: any
  incrementMinutes: any
  graceMinutes: any
  happyHourEnabled: any
  happyHourDiscount: any
  happyHourStart: any
  happyHourEnd: any
  happyHourDays: any
}): EntertainmentPricing {
  return {
    ratePerMinute: Number(menuItem.ratePerMinute) || 0,
    minimumCharge: Number(menuItem.minimumCharge) || 0,
    incrementMinutes: menuItem.incrementMinutes || 15,
    graceMinutes: menuItem.graceMinutes || 0,
    happyHour: menuItem.happyHourEnabled
      ? {
          enabled: true,
          discount: menuItem.happyHourDiscount || 0,
          start: menuItem.happyHourStart || '00:00',
          end: menuItem.happyHourEnd || '23:59',
          days: (menuItem.happyHourDays as string[]) || [],
        }
      : undefined,
  }
}

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
    // Group locationIds that need floor plan refresh
    const locationIdsToRefresh = new Set<string>()

    for (const item of expiredItems) {
      // Skip items on already-paid/closed orders
      if (['paid', 'closed', 'voided', 'cancelled'].includes(item.order.status)) {
        // Still reset the MenuItem so it doesn't stay in_use forever
        await db.menuItem.update({
          where: { id: item.menuItem.id },
          data: {
            entertainmentStatus: 'available',
            currentOrderId: null,
            currentOrderItemId: null,
          },
        })

        // Reset linked FloorPlanElements
        await db.floorPlanElement.updateMany({
          where: {
            linkedMenuItemId: item.menuItem.id,
            status: 'in_use',
          },
          data: {
            status: 'available',
            currentOrderId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
          },
        })

        locationIdsToRefresh.add(item.order.locationId)

        void dispatchEntertainmentStatusChanged(item.order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }).catch(console.error)

        void notifyNextWaitlistEntry(item.order.locationId, item.menuItem.id, item.menuItem.name).catch(console.error)

        continue
      }

      try {
        // Calculate elapsed minutes
        const startedAt = item.blockTimeStartedAt!
        const elapsedMs = now.getTime() - startedAt.getTime()
        const elapsedMinutes = Math.ceil(elapsedMs / (1000 * 60))

        // Calculate charge using pricing engine
        let newPrice: number

        if (item.menuItem.ratePerMinute != null && Number(item.menuItem.ratePerMinute) > 0) {
          // Per-minute pricing available
          const pricing = buildPricing(item.menuItem)
          const { rate: activeRate } = getActiveRate(
            pricing.ratePerMinute,
            pricing.happyHour,
            startedAt
          )
          const adjustedPricing: EntertainmentPricing = {
            ...pricing,
            ratePerMinute: activeRate,
          }
          const breakdown = calculateCharge(elapsedMinutes, adjustedPricing)
          newPrice = breakdown.totalCharge
        } else {
          // No per-minute config -- fall back to MenuItem.price
          newPrice = Number(item.menuItem.price) || 0
        }

        // Update the OrderItem price with the calculated charge
        await db.orderItem.update({
          where: { id: item.id },
          data: {
            price: newPrice,
            itemTotal: newPrice,
          },
        })

        // Reset MenuItem to available
        await db.menuItem.update({
          where: { id: item.menuItem.id },
          data: {
            entertainmentStatus: 'available',
            currentOrderId: null,
            currentOrderItemId: null,
          },
        })

        // Reset linked FloorPlanElements
        await db.floorPlanElement.updateMany({
          where: {
            linkedMenuItemId: item.menuItem.id,
            status: 'in_use',
          },
          data: {
            status: 'available',
            currentOrderId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
          },
        })

        locationIdsToRefresh.add(item.order.locationId)

        // Emit socket events
        void dispatchEntertainmentUpdate(item.order.locationId, {
          sessionId: item.id,
          tableId: item.menuItem.id,
          tableName: item.menuItem.name,
          action: 'stopped',
          expiresAt: null,
        }).catch(console.error)

        void dispatchEntertainmentStatusChanged(item.order.locationId, {
          itemId: item.menuItem.id,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }).catch(console.error)

        void notifyNextWaitlistEntry(item.order.locationId, item.menuItem.id, item.menuItem.name).catch(console.error)

        // Emit ITEM_UPDATED order event for the price change
        void emitOrderEvent(
          item.order.locationId,
          item.order.id,
          'ITEM_UPDATED',
          {
            lineItemId: item.id,
            priceCents: Math.round(newPrice * 100),
            reason: 'block_time_expired',
          },
          { deviceId: 'cron-entertainment-expiry' }
        ).catch(console.error)

        expiredSessionCount++
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
    })

    for (const entry of staleNotified) {
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
      } catch (notifiedErr) {
        console.error(
          `[entertainment-expiry] Failed to expire stale notified entry ${entry.id}:`,
          notifiedErr
        )
      }
    }
    staleNotifiedCount = staleNotified.length

    // ── Step 4: Log and return summary ───────────────────────────
    console.log(
      `[entertainment-expiry] Processed ${expiredSessionCount} sessions, ${expiredWaitlistCount} waitlist entries, ${staleNotifiedCount} stale notified`
    )

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
