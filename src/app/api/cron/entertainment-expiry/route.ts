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
  calculateBlockTimeOvertime,
  getActiveRate,
  type EntertainmentPricing,
  type OvertimeConfig,
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
  overtimeEnabled?: any
  overtimeMode?: any
  overtimeMultiplier?: any
  overtimePerMinuteRate?: any
  overtimeFlatFee?: any
  overtimeGraceMinutes?: any
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
    overtime: menuItem.overtimeEnabled
      ? {
          enabled: true,
          mode: (menuItem.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
          multiplier: menuItem.overtimeMultiplier ? Number(menuItem.overtimeMultiplier) : undefined,
          perMinuteRate: menuItem.overtimePerMinuteRate ? Number(menuItem.overtimePerMinuteRate) : undefined,
          flatFee: menuItem.overtimeFlatFee ? Number(menuItem.overtimeFlatFee) : undefined,
          graceMinutes: menuItem.overtimeGraceMinutes ?? undefined,
        }
      : undefined,
  }
}

function buildOvertimeConfig(menuItem: {
  overtimeEnabled?: any
  overtimeMode?: any
  overtimeMultiplier?: any
  overtimePerMinuteRate?: any
  overtimeFlatFee?: any
  overtimeGraceMinutes?: any
}): OvertimeConfig | undefined {
  if (!menuItem.overtimeEnabled) return undefined
  return {
    enabled: true,
    mode: (menuItem.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
    multiplier: menuItem.overtimeMultiplier ? Number(menuItem.overtimeMultiplier) : undefined,
    perMinuteRate: menuItem.overtimePerMinuteRate ? Number(menuItem.overtimePerMinuteRate) : undefined,
    flatFee: menuItem.overtimeFlatFee ? Number(menuItem.overtimeFlatFee) : undefined,
    graceMinutes: menuItem.overtimeGraceMinutes ?? undefined,
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
    // Each session is processed inside an interactive transaction with FOR UPDATE
    // to prevent race conditions with manual stop (DELETE /api/entertainment/block-time).
    const locationIdsToRefresh = new Set<string>()

    for (const item of expiredItems) {
      try {
        const result = await db.$transaction(async (tx) => {
          // Lock the OrderItem row to prevent concurrent modification by manual stop
          const [lockedItem] = await tx.$queryRaw<Array<{
            blockTimeStartedAt: Date | null
            blockTimeExpiresAt: Date | null
            blockTimeMinutes: number | null
          }>>`
            SELECT "blockTimeStartedAt", "blockTimeExpiresAt", "blockTimeMinutes"
            FROM "OrderItem"
            WHERE "id" = ${item.id}
            FOR UPDATE
          `

          // If already stopped (manual stop won the race), skip silently
          if (!lockedItem?.blockTimeStartedAt) {
            return { skipped: true as const }
          }

          // Also lock and check MenuItem — if already available, another process handled it
          const [lockedMenuItem] = await tx.$queryRaw<Array<{
            entertainmentStatus: string | null
          }>>`
            SELECT "entertainmentStatus" FROM "MenuItem"
            WHERE "id" = ${item.menuItem.id}
            FOR UPDATE
          `

          if (lockedMenuItem?.entertainmentStatus !== 'in_use') {
            return { skipped: true as const }
          }

          // Skip items on already-paid/closed orders — but still reset MenuItem/FloorPlan
          if (['paid', 'closed', 'voided', 'cancelled'].includes(item.order.status)) {
            await tx.menuItem.update({
              where: { id: item.menuItem.id },
              data: {
                entertainmentStatus: 'available',
                currentOrderId: null,
                currentOrderItemId: null,
              },
            })

            await tx.floorPlanElement.updateMany({
              where: { linkedMenuItemId: item.menuItem.id, status: 'in_use' },
              data: {
                status: 'available',
                currentOrderId: null,
                sessionStartedAt: null,
                sessionExpiresAt: null,
              },
            })

            return { skipped: false as const, closedOrder: true as const, newPrice: 0 }
          }

          // Calculate elapsed minutes
          const startedAt = lockedItem.blockTimeStartedAt!
          const elapsedMs = now.getTime() - startedAt.getTime()
          const elapsedMinutes = Math.ceil(elapsedMs / (1000 * 60))

          // Calculate charge using pricing engine
          let newPrice: number
          const bookedMinutes = lockedItem.blockTimeMinutes || undefined

          if (item.menuItem.ratePerMinute != null && Number(item.menuItem.ratePerMinute) > 0) {
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
            const breakdown = calculateCharge(elapsedMinutes, adjustedPricing, bookedMinutes)
            newPrice = breakdown.totalCharge
          } else {
            newPrice = Number(item.menuItem.price) || 0

            const otConfig = buildOvertimeConfig(item.menuItem)
            if (otConfig && bookedMinutes && elapsedMinutes > bookedMinutes) {
              const baseRate = newPrice / bookedMinutes
              const incrementMin = item.menuItem.incrementMinutes || 15
              const otResult = calculateBlockTimeOvertime(
                elapsedMinutes,
                bookedMinutes,
                otConfig,
                baseRate,
                incrementMin
              )
              newPrice += otResult.overtimeCharge
            }
          }

          // Update OrderItem price and clear startedAt
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              blockTimeStartedAt: null,
              price: newPrice,
              itemTotal: newPrice,
            },
          })

          // Reset MenuItem to available
          await tx.menuItem.update({
            where: { id: item.menuItem.id },
            data: {
              entertainmentStatus: 'available',
              currentOrderId: null,
              currentOrderItemId: null,
            },
          })

          // Reset linked FloorPlanElements
          await tx.floorPlanElement.updateMany({
            where: { linkedMenuItemId: item.menuItem.id, status: 'in_use' },
            data: {
              status: 'available',
              currentOrderId: null,
              sessionStartedAt: null,
              sessionExpiresAt: null,
            },
          })

          return { skipped: false as const, closedOrder: false as const, newPrice }
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
