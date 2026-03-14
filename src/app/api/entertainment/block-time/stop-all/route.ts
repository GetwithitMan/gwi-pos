import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged, dispatchEntertainmentUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { calculateCharge, calculateBlockTimeOvertime, getActiveRate, type EntertainmentPricing, type HappyHourConfig, type OvertimeConfig } from '@/lib/entertainment-pricing'
import { recalculatePercentDiscounts } from '@/lib/order-calculations'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// POST - Force-stop all active entertainment sessions (closing time)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, reason, employeeId } = body
    const stopReason = reason || 'closing_time'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Permission check — force-stop-all requires entertainment permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const now = new Date()

    // Find all active entertainment sessions at this location.
    // An active session = MenuItem with entertainmentStatus 'in_use' and a currentOrderItemId
    const activeMenuItems = await db.menuItem.findMany({
      where: {
        locationId,
        entertainmentStatus: 'in_use',
        currentOrderItemId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        price: true,
        timedPricing: true,
        ratePerMinute: true,
        minimumCharge: true,
        incrementMinutes: true,
        graceMinutes: true,
        blockTimeMinutes: true,
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
        currentOrderItemId: true,
        currentOrderId: true,
      },
    })

    if (activeMenuItems.length === 0) {
      return NextResponse.json({ data: {
        success: true,
        sessionsStopped: 0,
        totalCharges: 0,
        waitlistCancelled: 0,
        message: 'No active entertainment sessions to stop.',
      } })
    }

    // Collect order item IDs to fetch them all at once
    const orderItemIds = activeMenuItems.map(mi => mi.currentOrderItemId!).filter(Boolean)

    const orderItems = await db.orderItem.findMany({
      where: { id: { in: orderItemIds } },
      include: {
        order: {
          select: {
            id: true,
            locationId: true,
          },
        },
      },
    })

    // Map orderItemId -> orderItem for quick lookup
    const orderItemMap = new Map(orderItems.map(oi => [oi.id, oi]))

    // Process all sessions in a single transaction for atomicity
    const txResult = await db.$transaction(async (tx) => {
      const results: Array<{
        orderItemId: string
        menuItemId: string
        menuItemName: string
        orderId: string
        actualMinutes: number
        charge: number
      }> = []

      for (const mi of activeMenuItems) {
        const oi = orderItemMap.get(mi.currentOrderItemId!)
        if (!oi) continue

        // Calculate actual minutes used
        const startedAt = oi.blockTimeStartedAt
        const actualMinutes = startedAt
          ? Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
          : 0

        // Calculate charge based on actual usage (up to now, not up to original expiry)
        let calculatedCharge = Number(mi.price || 0)

        // Build overtime config
        const otConfig: OvertimeConfig | undefined = mi.overtimeEnabled
          ? {
              enabled: true,
              mode: (mi.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
              multiplier: mi.overtimeMultiplier ? Number(mi.overtimeMultiplier) : undefined,
              perMinuteRate: mi.overtimePerMinuteRate ? Number(mi.overtimePerMinuteRate) : undefined,
              flatFee: mi.overtimeFlatFee ? Number(mi.overtimeFlatFee) : undefined,
              graceMinutes: mi.overtimeGraceMinutes ?? undefined,
            }
          : undefined

        if (Number(mi.ratePerMinute || 0) > 0) {
          const pricing: EntertainmentPricing = {
            ratePerMinute: Number(mi.ratePerMinute),
            minimumCharge: Number(mi.minimumCharge || 0),
            incrementMinutes: mi.incrementMinutes || 15,
            graceMinutes: mi.graceMinutes || 0,
          }

          let happyHour: HappyHourConfig | undefined
          if (mi.happyHourEnabled) {
            happyHour = {
              enabled: true,
              discount: mi.happyHourDiscount || 0,
              start: mi.happyHourStart || '00:00',
              end: mi.happyHourEnd || '23:59',
              days: (Array.isArray(mi.happyHourDays) ? mi.happyHourDays : []) as string[],
            }
          }

          const sessionStart = startedAt || now
          const { rate: activeRate } = getActiveRate(pricing.ratePerMinute, happyHour, sessionStart)
          const effectivePricing: EntertainmentPricing = {
            ...pricing,
            ratePerMinute: activeRate,
            overtime: otConfig,
          }

          const bookedMinutes = oi.blockTimeMinutes || undefined
          const breakdown = calculateCharge(actualMinutes, effectivePricing, bookedMinutes)
          calculatedCharge = breakdown.totalCharge
        } else if (mi.timedPricing && typeof mi.timedPricing === 'object') {
          const tp = mi.timedPricing as Record<string, unknown>
          const purchasedMinutes = oi.blockTimeMinutes || 0
          if (purchasedMinutes <= 15 && tp.per15Min) {
            calculatedCharge = Number(tp.per15Min)
          } else if (purchasedMinutes <= 30 && tp.per30Min) {
            calculatedCharge = Number(tp.per30Min)
          } else if (purchasedMinutes <= 60 && tp.perHour) {
            calculatedCharge = Number(tp.perHour)
          } else if (tp.perHour) {
            calculatedCharge = (purchasedMinutes / 60) * Number(tp.perHour)
          }

          if (otConfig && purchasedMinutes > 0 && actualMinutes > purchasedMinutes) {
            const tierBaseRate = calculatedCharge / purchasedMinutes
            const incrementMin = mi.incrementMinutes || 15
            const otBreakdown = calculateBlockTimeOvertime(
              actualMinutes,
              purchasedMinutes,
              otConfig,
              tierBaseRate,
              incrementMin
            )
            calculatedCharge += otBreakdown.overtimeCharge
          }
        } else if (otConfig && oi.blockTimeMinutes && actualMinutes > oi.blockTimeMinutes) {
          const flatBaseRate = calculatedCharge / oi.blockTimeMinutes
          const incrementMin = mi.incrementMinutes || 15
          const otBreakdown = calculateBlockTimeOvertime(
            actualMinutes,
            oi.blockTimeMinutes,
            otConfig,
            flatBaseRate,
            incrementMin
          )
          calculatedCharge += otBreakdown.overtimeCharge
        }

        // Update order item — stop session, apply final charge
        await tx.orderItem.update({
          where: { id: oi.id },
          data: {
            blockTimeStartedAt: null,
            blockTimeExpiresAt: now,
            price: calculatedCharge,
            itemTotal: calculatedCharge,
          },
        })

        // Reset menu item status
        await tx.menuItem.update({
          where: { id: mi.id },
          data: {
            entertainmentStatus: 'available',
            currentOrderId: null,
            currentOrderItemId: null,
          },
        })

        results.push({
          orderItemId: oi.id,
          menuItemId: mi.id,
          menuItemName: mi.name,
          orderId: oi.order.id,
          actualMinutes,
          charge: calculatedCharge,
        })
      }

      // Reset all floor plan elements for entertainment items at this location to available
      const menuItemIds = activeMenuItems.map(mi => mi.id)
      await tx.floorPlanElement.updateMany({
        where: {
          linkedMenuItemId: { in: menuItemIds },
          deletedAt: null,
        },
        data: {
          status: 'available',
          currentOrderId: null,
          sessionStartedAt: null,
          sessionExpiresAt: null,
        },
      })

      // Cancel all active waitlist entries for this location
      const cancelledWaitlist = await tx.entertainmentWaitlist.updateMany({
        where: {
          locationId,
          deletedAt: null,
          status: { in: ['waiting', 'notified'] },
        },
        data: {
          status: 'cancelled',
          deletedAt: now,
        },
      })

      return { results, waitlistCancelled: cancelledWaitlist.count }
    })

    const totalCharges = txResult.results.reduce((sum, r) => sum + r.charge, 0)

    // Fire-and-forget: recalculate discounts for each affected order
    const affectedOrderIds = [...new Set(txResult.results.map(r => r.orderId))]
    for (const orderId of affectedOrderIds) {
      void (async () => {
        try {
          const activeItems = await db.orderItem.findMany({
            where: { orderId, status: 'active', deletedAt: null },
            include: { modifiers: true },
          })
          let newSubtotal = 0
          for (const ai of activeItems) {
            const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
            newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
          }
          const newDiscountTotal = await recalculatePercentDiscounts(db, orderId, newSubtotal)
          if (newDiscountTotal > 0) {
            await db.order.update({
              where: { id: orderId },
              data: { subtotal: newSubtotal, discountTotal: Math.min(newDiscountTotal, newSubtotal) },
            })
          }
        } catch (err) {
          console.error(`[stop-all] Failed to recalculate discounts for order ${orderId}:`, err)
        }
      })()
    }

    // Fire-and-forget: emit order events for each stopped session
    for (const r of txResult.results) {
      const oi = orderItemMap.get(r.orderItemId)
      if (!oi) continue

      void emitOrderEvent(locationId, r.orderId, 'ITEM_UPDATED', {
        lineItemId: r.orderItemId,
        price: r.charge,
        blockTimeStartedAt: 'CLEARED',
        blockTimeExpiresAt: now.toISOString(),
        actualMinutesUsed: r.actualMinutes,
        reason: stopReason,
        forceStopAll: true,
      })

      // Dispatch entertainment status changed for each item
      void dispatchEntertainmentStatusChanged(locationId, {
        itemId: r.menuItemId,
        entertainmentStatus: 'available',
        currentOrderId: null,
        expiresAt: null,
      }, { async: true }).catch(() => {})

      // Emit session update for KDS Pit Boss + Android timers
      void dispatchEntertainmentUpdate(locationId, {
        sessionId: r.orderItemId,
        tableId: r.menuItemId,
        tableName: r.menuItemName,
        action: 'force_stopped',
        expiresAt: null,
        startedAt: null,
      }, { async: true }).catch(() => {})
    }

    // Dispatch floor plan update once (covers all elements)
    dispatchFloorPlanUpdate(locationId, { async: true })

    // Audit trail: force stop all
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_force_stop_all',
        entityType: 'location',
        entityId: locationId,
        details: {
          reason: stopReason,
          sessionsStopped: txResult.results.length,
          totalCharges,
          waitlistCancelled: txResult.waitlistCancelled,
          sessions: txResult.results.map(r => ({
            menuItemName: r.menuItemName,
            actualMinutes: r.actualMinutes,
            charge: r.charge,
          })),
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return NextResponse.json({ data: {
      success: true,
      sessionsStopped: txResult.results.length,
      totalCharges,
      waitlistCancelled: txResult.waitlistCancelled,
      sessions: txResult.results.map(r => ({
        menuItemName: r.menuItemName,
        actualMinutes: r.actualMinutes,
        charge: r.charge,
      })),
      message: `Stopped ${txResult.results.length} session${txResult.results.length !== 1 ? 's' : ''}. Total charges: $${totalCharges.toFixed(2)}. ${txResult.waitlistCancelled} waitlist ${txResult.waitlistCancelled !== 1 ? 'entries' : 'entry'} cancelled.`,
    } })
  } catch (error) {
    console.error('Failed to force-stop all sessions:', error)
    return NextResponse.json(
      { error: 'Failed to force-stop all sessions' },
      { status: 500 }
    )
  }
})
