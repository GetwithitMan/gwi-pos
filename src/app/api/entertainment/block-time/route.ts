import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged, dispatchEntertainmentUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { calculateCharge, calculateBlockTimeOvertime, getActiveRate, type EntertainmentPricing, type HappyHourConfig, type ChargeBreakdown, type OvertimeConfig } from '@/lib/entertainment-pricing'

import { recalculatePercentDiscounts } from '@/lib/order-calculations'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

// POST - Start block time for an order item
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, minutes, locationId, employeeId } = body

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    if (!minutes || minutes < 1) {
      return NextResponse.json(
        { error: 'Minutes must be a positive number' },
        { status: 400 }
      )
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Get the order item and verify it's an entertainment item
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            itemType: true,
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
            prepaidPackages: true,
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
            status: true,
            locationId: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Verify locationId matches
    if (orderItem.order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Location ID mismatch' },
        { status: 403 }
      )
    }

    if (orderItem.menuItem.itemType !== 'timed_rental') {
      return NextResponse.json(
        { error: 'This item is not an entertainment rental' },
        { status: 400 }
      )
    }

    if (orderItem.order.status === 'paid' || orderItem.order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify a paid or closed order' },
        { status: 400 }
      )
    }

    // Calculate expiration time
    const now = new Date()
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)

    // Build overtime config from MenuItem fields (included in response so client knows pricing)
    const overtimeConfig: OvertimeConfig | undefined = orderItem.menuItem.overtimeEnabled
      ? {
          enabled: true,
          mode: (orderItem.menuItem.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
          multiplier: orderItem.menuItem.overtimeMultiplier ? Number(orderItem.menuItem.overtimeMultiplier) : undefined,
          perMinuteRate: orderItem.menuItem.overtimePerMinuteRate ? Number(orderItem.menuItem.overtimePerMinuteRate) : undefined,
          flatFee: orderItem.menuItem.overtimeFlatFee ? Number(orderItem.menuItem.overtimeFlatFee) : undefined,
          graceMinutes: orderItem.menuItem.overtimeGraceMinutes ?? undefined,
        }
      : undefined

    // Calculate initial block price based on selected duration
    const mi = orderItem.menuItem
    let initialPrice = Number(mi.price || 0)

    // Check timedPricing JSON tiers first
    if (mi.timedPricing && typeof mi.timedPricing === 'object') {
      const tp = mi.timedPricing as Record<string, unknown>
      if (minutes <= 15 && tp.per15Min) {
        initialPrice = Number(tp.per15Min)
      } else if (minutes <= 30 && tp.per30Min) {
        initialPrice = Number(tp.per30Min)
      } else if (minutes <= 60 && tp.perHour) {
        initialPrice = Number(tp.perHour)
      } else if (tp.perHour) {
        // Proportional for durations > 60 min
        initialPrice = (minutes / 60) * Number(tp.perHour)
      }
    } else if (Number(mi.ratePerMinute || 0) > 0) {
      // Per-minute pricing: calculate expected charge for the block duration
      const pricing: EntertainmentPricing = {
        ratePerMinute: Number(mi.ratePerMinute),
        minimumCharge: Number(mi.minimumCharge || 0),
        incrementMinutes: mi.incrementMinutes || 15,
        graceMinutes: mi.graceMinutes || 0,
      }
      const breakdown = calculateCharge(minutes, pricing)
      initialPrice = breakdown.totalCharge
    }
    // Otherwise keep MenuItem.price as fallback

    // Wrap all writes in a transaction with FOR UPDATE lock to prevent double-booking
    const result = await db.$transaction(async (tx) => {
      // Lock the MenuItem row and check status
      const [lockedItem] = await tx.$queryRaw<Array<{ entertainmentStatus: string | null }>>`
        SELECT "entertainmentStatus" FROM "MenuItem" WHERE "id" = ${orderItem.menuItemId} FOR UPDATE
      `

      if (lockedItem?.entertainmentStatus === 'in_use') {
        return { conflict: true as const, waitlistConflict: false as const, updatedItem: null, notifiedCustomer: null }
      }

      // Check if a waitlisted customer has been notified for this item
      const floorPlanElement = await tx.floorPlanElement.findFirst({
        where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
        select: { id: true, visualType: true },
      })

      if (floorPlanElement) {
        const notifiedEntry = await tx.entertainmentWaitlist.findFirst({
          where: {
            deletedAt: null,
            status: 'notified',
            OR: [
              { elementId: floorPlanElement.id },
              { visualType: floorPlanElement.visualType },
            ],
          },
          select: { id: true, customerName: true },
        })

        if (notifiedEntry) {
          return { conflict: false as const, waitlistConflict: true as const, updatedItem: null, notifiedCustomer: notifiedEntry.customerName }
        }
      }

      // 1. Update the order item with block time info and initial price
      const updatedItem = await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          blockTimeMinutes: minutes,
          blockTimeStartedAt: now,
          blockTimeExpiresAt: expiresAt,
          price: initialPrice,
          itemTotal: initialPrice,
        },
        select: {
          id: true,
          name: true,
          blockTimeMinutes: true,
          blockTimeStartedAt: true,
          blockTimeExpiresAt: true,
          menuItemId: true,
        },
      })

      // 2. Update the menu item status to in_use
      await tx.menuItem.update({
        where: { id: orderItem.menuItemId },
        data: {
          entertainmentStatus: 'in_use',
          currentOrderId: orderItem.orderId,
          currentOrderItemId: orderItemId,
        },
      })

      // 3. Update floor plan element if exists
      if (orderItem.menuItem.id) {
        await tx.floorPlanElement.updateMany({
          where: {
            linkedMenuItemId: orderItem.menuItem.id,
            deletedAt: null,
          },
          data: {
            status: 'in_use',
            currentOrderId: orderItem.orderId,
            sessionStartedAt: now,
            sessionExpiresAt: expiresAt,
          },
        })
      }

      return { conflict: false as const, waitlistConflict: false as const, updatedItem, notifiedCustomer: null }
    })

    if (result.conflict) {
      return NextResponse.json(
        { error: 'This entertainment item is already in use' },
        { status: 409 }
      )
    }

    if (result.waitlistConflict) {
      return NextResponse.json(
        { error: `A waitlisted customer${result.notifiedCustomer ? ` (${result.notifiedCustomer})` : ''} has been notified for this item. Seat them first or cancel their waitlist entry.` },
        { status: 409 }
      )
    }

    const updatedItem = result.updatedItem!

    // Fire-and-forget discount recalculation (price changed from default to initial block price)
    void (async () => {
      try {
        const activeItems = await db.orderItem.findMany({
          where: { orderId: orderItem.orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }
        const newDiscountTotal = await recalculatePercentDiscounts(db, orderItem.orderId, newSubtotal)
        if (newDiscountTotal > 0) {
          await db.order.update({
            where: { id: orderItem.orderId },
            data: { subtotal: newSubtotal, discountTotal: Math.min(newDiscountTotal, newSubtotal) },
          })
        }
      } catch (err) {
        console.error('[block-time] Failed to recalculate discounts after start:', err)
      }
    })()

    // Fire-and-forget: emit ITEM_UPDATED for event-sourced sync
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: initialPrice,
      blockTimeMinutes: minutes,
      blockTimeStartedAt: now.toISOString(),
      blockTimeExpiresAt: expiresAt.toISOString(),
    })

    // Dispatch socket updates (fire-and-forget)
    dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })
    dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'in_use',
      currentOrderId: orderItem.orderId,
      expiresAt: expiresAt.toISOString(),
    }, { async: true }).catch(() => {})

    // Emit session update for KDS Pit Boss + Android timers (includes startedAt)
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: updatedItem.name || '',
      action: 'started',
      expiresAt: expiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
    }, { async: true }).catch(() => {})

    // Audit trail: session started
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_session_started',
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName: orderItem.menuItem.name,
          minutes,
          initialPrice: initialPrice,
          expiresAt: expiresAt.toISOString(),
          orderId: orderItem.orderId,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return NextResponse.json({ data: {
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      overtime: overtimeConfig || null,
      message: `Started ${minutes} minute block time, expires at ${expiresAt.toLocaleTimeString()}`,
    } })
  } catch (error) {
    console.error('Failed to start block time:', error)
    return NextResponse.json(
      { error: 'Failed to start block time' },
      { status: 500 }
    )
  }
})

// PATCH - Extend block time
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, additionalMinutes, locationId, employeeId } = body

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    if (!additionalMinutes || additionalMinutes < 1) {
      return NextResponse.json(
        { error: 'Additional minutes must be a positive number' },
        { status: 400 }
      )
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Get the order item with menuItem for tier-based price recalculation
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
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
            prepaidPackages: true,
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
            status: true,
            locationId: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Verify locationId matches
    if (orderItem.order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Location ID mismatch' },
        { status: 403 }
      )
    }

    if (orderItem.order.status === 'paid' || orderItem.order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify a paid or closed order' },
        { status: 400 }
      )
    }

    if (!orderItem.blockTimeExpiresAt) {
      return NextResponse.json(
        { error: 'This item does not have active block time' },
        { status: 400 }
      )
    }

    // Check if extending is blocked when customers are on the waitlist
    const locSettings = parseSettings(await getLocationSettings(locationId))
    if (locSettings.entertainment?.allowExtendWithWaitlist === false) {
      // Look up the FloorPlanElement linked to this menu item
      const fpe = await db.floorPlanElement.findFirst({
        where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
        select: { id: true, visualType: true },
      })
      if (fpe) {
        const activeWaitlistEntry = await db.entertainmentWaitlist.findFirst({
          where: {
            deletedAt: null,
            status: { in: ['waiting', 'notified'] },
            OR: [
              { elementId: fpe.id },
              { visualType: fpe.visualType },
            ],
          },
          select: { id: true },
        })
        if (activeWaitlistEntry) {
          return NextResponse.json(
            { error: 'Cannot extend — customers are waiting. Finish your session so the next person can play.' },
            { status: 409 }
          )
        }
      }
    }

    // Wrap extend in a transaction with FOR UPDATE to prevent concurrent extends
    const mi = orderItem.menuItem
    const txResult = await db.$transaction(async (tx) => {
      // Lock the OrderItem row to prevent concurrent extends from clobbering each other
      const [lockedRow] = await tx.$queryRaw<Array<{
        blockTimeExpiresAt: Date | null
        blockTimeMinutes: number | null
        price: unknown
      }>>`
        SELECT "blockTimeExpiresAt", "blockTimeMinutes", "price"
        FROM "OrderItem"
        WHERE "id" = ${orderItemId}
        FOR UPDATE
      `

      if (!lockedRow?.blockTimeExpiresAt) {
        return { error: 'This item does not have active block time' } as const
      }

      const now = new Date()
      const currentExpires = new Date(lockedRow.blockTimeExpiresAt)
      const oldMinutes = lockedRow.blockTimeMinutes || 0
      const oldPrice = Number(lockedRow.price || 0)

      // If already expired, extend from now; otherwise extend from current expiration
      const baseTime = currentExpires > now ? currentExpires : now
      const newExpiresAt = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000)
      const newTotalMinutes = oldMinutes + additionalMinutes

      // Calculate the INCREMENTAL charge for the extension only (not total reprice).
      // This preserves any discounts, comps, or happy hour rates on the original block.
      let additionalCharge = 0

      if (mi.timedPricing && typeof mi.timedPricing === 'object') {
        const tp = mi.timedPricing as Record<string, unknown>
        // Calculate what the new total WOULD cost and what the old total WOULD cost at tier rates,
        // then charge the difference as the incremental extension cost
        const calcTierPrice = (mins: number): number => {
          if (mins <= 15 && tp.per15Min) return Number(tp.per15Min)
          if (mins <= 30 && tp.per30Min) return Number(tp.per30Min)
          if (mins <= 60 && tp.perHour) return Number(tp.perHour)
          if (tp.perHour) return (mins / 60) * Number(tp.perHour)
          return Number(mi.price || 0)
        }
        const newTotalTierPrice = calcTierPrice(newTotalMinutes)
        const oldTotalTierPrice = calcTierPrice(oldMinutes)
        additionalCharge = Math.max(0, newTotalTierPrice - oldTotalTierPrice)
      } else if (Number(mi.ratePerMinute || 0) > 0) {
        // Per-minute pricing: calculate charge for ONLY the additional minutes
        const pricing: EntertainmentPricing = {
          ratePerMinute: Number(mi.ratePerMinute),
          minimumCharge: 0, // No minimum for extensions — already past minimum
          incrementMinutes: mi.incrementMinutes || 15,
          graceMinutes: 0, // No grace for extensions
        }
        const breakdown = calculateCharge(additionalMinutes, pricing)
        additionalCharge = breakdown.totalCharge
      } else {
        // Flat-rate fallback: proportional extension based on MenuItem base duration
        const basePrice = Number(mi.price || 0)
        const baseMinutes = mi.blockTimeMinutes || 60
        additionalCharge = (additionalMinutes / baseMinutes) * basePrice
      }

      const newPrice = oldPrice + additionalCharge

      // Update the order item with new duration and incremental price
      const updatedItem = await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          blockTimeMinutes: newTotalMinutes,
          blockTimeExpiresAt: newExpiresAt,
          price: newPrice,
          itemTotal: newPrice,
        },
        select: {
          id: true,
          name: true,
          blockTimeMinutes: true,
          blockTimeStartedAt: true,
          blockTimeExpiresAt: true,
        },
      })

      // Update FloorPlanElement expiration to match (keeps dispatchEntertainmentStatusChanged in sync)
      await tx.floorPlanElement.updateMany({
        where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
        data: { sessionExpiresAt: newExpiresAt },
      })

      return { updatedItem, newExpiresAt, newTotalMinutes, newPrice } as const
    })

    if ('error' in txResult) {
      return NextResponse.json(
        { error: txResult.error },
        { status: 400 }
      )
    }

    const { updatedItem, newExpiresAt, newTotalMinutes, newPrice } = txResult

    // Recalculate percent-based discounts if price changed (extension changes subtotal)
    void (async () => {
      try {
        const activeItems = await db.orderItem.findMany({
          where: { orderId: orderItem.orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }
        const newDiscountTotal = await recalculatePercentDiscounts(db, orderItem.orderId, newSubtotal)
        if (newDiscountTotal > 0) {
          await db.order.update({
            where: { id: orderItem.orderId },
            data: { subtotal: newSubtotal, discountTotal: Math.min(newDiscountTotal, newSubtotal) },
          })
        }
      } catch (err) {
        console.error('[block-time] Failed to recalculate discounts after extend:', err)
      }
    })()

    // Fire-and-forget: emit ITEM_UPDATED for event-sourced sync (extend)
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: newPrice,
      blockTimeMinutes: newTotalMinutes,
      blockTimeExpiresAt: newExpiresAt.toISOString(),
    })

    // Dispatch socket updates (fire-and-forget)
    dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })
    dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'in_use',
      currentOrderId: orderItem.orderId,
      expiresAt: newExpiresAt.toISOString(),
    }, { async: true }).catch(() => {})

    // Emit session update for KDS Pit Boss + Android timers (includes startedAt)
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: updatedItem.name || '',
      action: 'extended',
      expiresAt: newExpiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
      addedMinutes: additionalMinutes,
    }, { async: true }).catch(() => {})

    // Audit trail: session extended
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_session_extended',
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName: orderItem.menuItem.name,
          additionalMinutes,
          newTotalMinutes,
          newPrice,
          newExpiresAt: newExpiresAt.toISOString(),
          orderId: orderItem.orderId,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return NextResponse.json({ data: {
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      message: `Extended by ${additionalMinutes} minutes, new expiration at ${newExpiresAt.toLocaleTimeString()}`,
    } })
  } catch (error) {
    console.error('Failed to extend block time:', error)
    return NextResponse.json(
      { error: 'Failed to extend block time' },
      { status: 500 }
    )
  }
})

// PUT - Manual time override (manager sets exact remaining time)
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, newExpiresAt, reason, locationId, employeeId } = body

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    if (!newExpiresAt) {
      return NextResponse.json(
        { error: 'New expiration time is required' },
        { status: 400 }
      )
    }

    // Permission check — manager override requires entertainment permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const parsedExpiresAt = new Date(newExpiresAt)
    if (isNaN(parsedExpiresAt.getTime())) {
      return NextResponse.json(
        { error: 'Invalid expiration time format' },
        { status: 400 }
      )
    }

    // Get the order item with menuItem for price recalculation
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
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
          },
        },
        order: {
          select: {
            id: true,
            status: true,
            locationId: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    if (orderItem.order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Location ID mismatch' },
        { status: 403 }
      )
    }

    if (orderItem.order.status === 'paid' || orderItem.order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify a paid or closed order' },
        { status: 400 }
      )
    }

    if (!orderItem.blockTimeStartedAt) {
      return NextResponse.json(
        { error: 'This item does not have active block time' },
        { status: 400 }
      )
    }

    const startedAt = orderItem.blockTimeStartedAt
    const newDurationMinutes = Math.max(1, Math.ceil((parsedExpiresAt.getTime() - startedAt.getTime()) / 1000 / 60))

    // Recalculate price based on new duration
    const mi = orderItem.menuItem
    let newPrice = Number(mi.price || 0)

    if (mi.timedPricing && typeof mi.timedPricing === 'object') {
      const tp = mi.timedPricing as Record<string, unknown>
      if (newDurationMinutes <= 15 && tp.per15Min) {
        newPrice = Number(tp.per15Min)
      } else if (newDurationMinutes <= 30 && tp.per30Min) {
        newPrice = Number(tp.per30Min)
      } else if (newDurationMinutes <= 60 && tp.perHour) {
        newPrice = Number(tp.perHour)
      } else if (tp.perHour) {
        newPrice = (newDurationMinutes / 60) * Number(tp.perHour)
      }
    } else if (Number(mi.ratePerMinute || 0) > 0) {
      const pricing: EntertainmentPricing = {
        ratePerMinute: Number(mi.ratePerMinute),
        minimumCharge: Number(mi.minimumCharge || 0),
        incrementMinutes: mi.incrementMinutes || 15,
        graceMinutes: mi.graceMinutes || 0,
      }
      const breakdown = calculateCharge(newDurationMinutes, pricing)
      newPrice = breakdown.totalCharge
    }
    // Otherwise keep MenuItem.price as flat-rate fallback

    const oldExpiresAt = orderItem.blockTimeExpiresAt
    const oldMinutes = orderItem.blockTimeMinutes

    // Wrap in transaction
    const txResult = await db.$transaction(async (tx) => {
      const updatedItem = await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          blockTimeMinutes: newDurationMinutes,
          blockTimeExpiresAt: parsedExpiresAt,
          price: newPrice,
          itemTotal: newPrice,
        },
        select: {
          id: true,
          name: true,
          blockTimeMinutes: true,
          blockTimeStartedAt: true,
          blockTimeExpiresAt: true,
          menuItemId: true,
        },
      })

      // Update FloorPlanElement expiration
      await tx.floorPlanElement.updateMany({
        where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
        data: { sessionExpiresAt: parsedExpiresAt },
      })

      return updatedItem
    })

    // Fire-and-forget discount recalculation
    void (async () => {
      try {
        const activeItems = await db.orderItem.findMany({
          where: { orderId: orderItem.orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }
        const newDiscountTotal = await recalculatePercentDiscounts(db, orderItem.orderId, newSubtotal)
        if (newDiscountTotal > 0) {
          await db.order.update({
            where: { id: orderItem.orderId },
            data: { subtotal: newSubtotal, discountTotal: Math.min(newDiscountTotal, newSubtotal) },
          })
        }
      } catch (err) {
        console.error('[block-time] Failed to recalculate discounts after time override:', err)
      }
    })()

    // Fire-and-forget: emit ITEM_UPDATED for event-sourced sync
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: newPrice,
      blockTimeMinutes: newDurationMinutes,
      blockTimeExpiresAt: parsedExpiresAt.toISOString(),
      managerOverride: true,
      reason: reason || 'time_override',
    })

    // Dispatch socket updates (fire-and-forget)
    dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })
    dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'in_use',
      currentOrderId: orderItem.orderId,
      expiresAt: parsedExpiresAt.toISOString(),
    }, { async: true }).catch(() => {})

    // Emit session update for KDS Pit Boss + Android timers
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: txResult.name || '',
      action: 'time_override',
      expiresAt: parsedExpiresAt.toISOString(),
      startedAt: txResult.blockTimeStartedAt?.toISOString() ?? null,
    }, { async: true }).catch(() => {})

    // Audit trail: management time override
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_time_override',
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName: orderItem.menuItem.name,
          oldExpiresAt: oldExpiresAt?.toISOString() || null,
          newExpiresAt: parsedExpiresAt.toISOString(),
          oldMinutes: oldMinutes,
          newMinutes: newDurationMinutes,
          oldPrice: Number(orderItem.price),
          newPrice,
          reason: reason || 'time_override',
          orderId: orderItem.orderId,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return NextResponse.json({ data: {
      orderItem: {
        id: txResult.id,
        name: txResult.name,
        blockTimeMinutes: txResult.blockTimeMinutes,
        startedAt: txResult.blockTimeStartedAt?.toISOString(),
        expiresAt: txResult.blockTimeExpiresAt?.toISOString(),
      },
      oldExpiresAt: oldExpiresAt?.toISOString() || null,
      newPrice,
      message: `Time overridden. New duration: ${newDurationMinutes} minutes, expires at ${parsedExpiresAt.toLocaleTimeString()}. Charge: $${newPrice.toFixed(2)}`,
    } })
  } catch (error) {
    console.error('Failed to override block time:', error)
    return NextResponse.json(
      { error: 'Failed to override block time' },
      { status: 500 }
    )
  }
})

// DELETE - Stop block time early (supports reason: 'normal' | 'comp' | 'void' | 'force')
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderItemId = searchParams.get('orderItemId')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const reason = (searchParams.get('reason') || 'normal') as 'normal' | 'comp' | 'void' | 'force'

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Get the order item
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
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
            prepaidPackages: true,
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
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Verify locationId matches
    if (orderItem.order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Location ID mismatch' },
        { status: 403 }
      )
    }

    // Use an interactive transaction with FOR UPDATE to prevent race conditions
    // with the cron expiry job. Both cron and manual stop compete for the same
    // OrderItem + MenuItem rows — the loser sees "already available" and returns idempotent success.
    const now = new Date()
    const menuItem = orderItem.menuItem
    const itemName = menuItem.name

    const txResult = await db.$transaction(async (tx) => {
      // Lock the OrderItem row to prevent concurrent modification
      const [lockedRow] = await tx.$queryRaw<Array<{
        blockTimeStartedAt: Date | null
        blockTimeMinutes: number | null
      }>>`
        SELECT "blockTimeStartedAt", "blockTimeMinutes"
        FROM "OrderItem"
        WHERE "id" = ${orderItemId}
        FOR UPDATE
      `

      // Lock the MenuItem row
      const [lockedMenuItem] = await tx.$queryRaw<Array<{
        entertainmentStatus: string | null
        currentOrderItemId: string | null
      }>>`
        SELECT "entertainmentStatus", "currentOrderItemId"
        FROM "MenuItem"
        WHERE "id" = ${orderItem.menuItemId}
        FOR UPDATE
      `

      // Idempotency: if already stopped (cron won the race), return success without re-charging
      // For 'force' reason, skip idempotency — force-stop should always proceed
      if (reason !== 'force') {
        if (!lockedRow?.blockTimeStartedAt ||
            lockedMenuItem?.entertainmentStatus === 'available' ||
            (lockedMenuItem?.currentOrderItemId && lockedMenuItem.currentOrderItemId !== orderItemId)) {
          return { alreadyProcessed: true as const }
        }
      }

      // Calculate actual minutes used
      const startedAt = lockedRow?.blockTimeStartedAt
      const actualMinutes = startedAt
        ? Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
        : 0

      // Calculate the charge based on actual usage and reason
      let calculatedCharge = Number(menuItem.price || 0)
      let breakdown: ChargeBreakdown | null = null
      let overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null = null

      // For comp and void: charge is zero
      if (reason === 'comp' || reason === 'void') {
        calculatedCharge = 0
      } else {
        // Normal or force: calculate based on actual usage
        // Build overtime config from MenuItem fields
        const deleteOvertimeConfig: OvertimeConfig | undefined = menuItem.overtimeEnabled
          ? {
              enabled: true,
              mode: (menuItem.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
              multiplier: menuItem.overtimeMultiplier ? Number(menuItem.overtimeMultiplier) : undefined,
              perMinuteRate: menuItem.overtimePerMinuteRate ? Number(menuItem.overtimePerMinuteRate) : undefined,
              flatFee: menuItem.overtimeFlatFee ? Number(menuItem.overtimeFlatFee) : undefined,
              graceMinutes: menuItem.overtimeGraceMinutes ?? undefined,
            }
          : undefined

        if (Number(menuItem.ratePerMinute || 0) > 0) {
          // Per-minute pricing engine
          const pricing: EntertainmentPricing = {
            ratePerMinute: Number(menuItem.ratePerMinute),
            minimumCharge: Number(menuItem.minimumCharge || 0),
            incrementMinutes: menuItem.incrementMinutes || 15,
            graceMinutes: menuItem.graceMinutes || 0,
          }

          // Check happy hour
          let happyHour: HappyHourConfig | undefined
          if (menuItem.happyHourEnabled) {
            happyHour = {
              enabled: true,
              discount: menuItem.happyHourDiscount || 0,
              start: menuItem.happyHourStart || '00:00',
              end: menuItem.happyHourEnd || '23:59',
              days: (Array.isArray(menuItem.happyHourDays) ? menuItem.happyHourDays : []) as string[],
            }
          }

          // Apply happy hour rate if active (use session start time for consistency)
          const sessionStart = startedAt || now
          const { rate: activeRate } = getActiveRate(pricing.ratePerMinute, happyHour, sessionStart)
          const effectivePricing: EntertainmentPricing = {
            ...pricing,
            ratePerMinute: activeRate,
            overtime: deleteOvertimeConfig,
          }

          // Pass bookedMinutes so calculateCharge applies overtime if session exceeded booked time
          const bookedMinutes = lockedRow?.blockTimeMinutes || undefined
          breakdown = calculateCharge(actualMinutes, effectivePricing, bookedMinutes)
          calculatedCharge = breakdown.totalCharge
          if (breakdown.overtimeMinutes > 0) {
            overtimeBreakdown = { overtimeMinutes: breakdown.overtimeMinutes, overtimeCharge: breakdown.overtimeCharge }
          }
        } else if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
          // Tier-based pricing from timedPricing JSON
          const tp = menuItem.timedPricing as Record<string, unknown>
          const purchasedMinutes = lockedRow?.blockTimeMinutes || 0
          if (purchasedMinutes <= 15 && tp.per15Min) {
            calculatedCharge = Number(tp.per15Min)
          } else if (purchasedMinutes <= 30 && tp.per30Min) {
            calculatedCharge = Number(tp.per30Min)
          } else if (purchasedMinutes <= 60 && tp.perHour) {
            calculatedCharge = Number(tp.perHour)
          } else if (tp.perHour) {
            calculatedCharge = (purchasedMinutes / 60) * Number(tp.perHour)
          }

          // Apply overtime for tier-based pricing if session exceeded booked duration
          if (deleteOvertimeConfig && purchasedMinutes > 0 && actualMinutes > purchasedMinutes) {
            const tierBaseRate = calculatedCharge / purchasedMinutes
            const incrementMin = menuItem.incrementMinutes || 15
            overtimeBreakdown = calculateBlockTimeOvertime(
              actualMinutes,
              purchasedMinutes,
              deleteOvertimeConfig,
              tierBaseRate,
              incrementMin
            )
            calculatedCharge += overtimeBreakdown.overtimeCharge
          }
        } else if (deleteOvertimeConfig && lockedRow?.blockTimeMinutes && actualMinutes > lockedRow.blockTimeMinutes) {
          // Flat-rate fallback with overtime
          const flatBaseRate = calculatedCharge / lockedRow.blockTimeMinutes
          const incrementMin = menuItem.incrementMinutes || 15
          overtimeBreakdown = calculateBlockTimeOvertime(
            actualMinutes,
            lockedRow.blockTimeMinutes,
            deleteOvertimeConfig,
            flatBaseRate,
            incrementMin
          )
          calculatedCharge += overtimeBreakdown.overtimeCharge
        }
      }

      // Build order item update data based on reason
      const orderItemData: Record<string, unknown> = {
        blockTimeStartedAt: null,
        blockTimeExpiresAt: now,
        price: calculatedCharge,
        itemTotal: calculatedCharge,
      }

      if (reason === 'comp') {
        orderItemData.status = 'comped'
        orderItemData.voidReason = 'Entertainment session comped by manager'
      } else if (reason === 'void') {
        orderItemData.status = 'voided'
        orderItemData.voidReason = 'Entertainment session voided by manager'
      }

      // Update the order item - clear startedAt, set expiration to now, apply calculated charge
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: orderItemData,
      })

      // Reset the menu item status
      const updatedMenuItem = await tx.menuItem.update({
        where: { id: orderItem.menuItemId },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
        select: {
          id: true,
          name: true,
          entertainmentStatus: true,
          currentOrderId: true,
          currentOrderItemId: true,
        },
      })

      // Reset floor plan element
      await tx.floorPlanElement.updateMany({
        where: {
          linkedMenuItemId: orderItem.menuItemId,
          deletedAt: null,
        },
        data: {
          status: 'available',
          currentOrderId: null,
          sessionStartedAt: null,
          sessionExpiresAt: null,
        },
      })

      return {
        alreadyProcessed: false as const,
        actualMinutes,
        calculatedCharge,
        breakdown,
        overtimeBreakdown,
        updatedMenuItem,
      }
    })

    // If already processed by cron or another terminal, return idempotent success
    if (txResult.alreadyProcessed) {
      return NextResponse.json({ data: {
        success: true,
        alreadyProcessed: true,
        message: 'Session was already stopped',
      } })
    }

    const { actualMinutes, calculatedCharge, breakdown, overtimeBreakdown, updatedMenuItem } = txResult

    // Fire-and-forget discount recalculation (price changed to final charge)
    void (async () => {
      try {
        const activeItems = await db.orderItem.findMany({
          where: { orderId: orderItem.orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }
        const newDiscountTotal = await recalculatePercentDiscounts(db, orderItem.orderId, newSubtotal)
        if (newDiscountTotal > 0) {
          await db.order.update({
            where: { id: orderItem.orderId },
            data: { subtotal: newSubtotal, discountTotal: Math.min(newDiscountTotal, newSubtotal) },
          })
        }
      } catch (err) {
        console.error('[block-time] Failed to recalculate discounts after stop:', err)
      }
    })()

    // Determine event type based on reason
    const eventType = (reason === 'void' || reason === 'comp') ? 'COMP_VOID_APPLIED' as const : 'ITEM_UPDATED' as const

    // Fire-and-forget: emit order event for event-sourced sync (stop) with new price
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, eventType, {
      lineItemId: orderItemId,
      price: calculatedCharge,
      blockTimeMinutes: orderItem.blockTimeMinutes,
      blockTimeStartedAt: 'CLEARED',
      blockTimeExpiresAt: now.toISOString(),
      actualMinutesUsed: actualMinutes,
      reason,
      ...(reason === 'comp' ? { status: 'comped' } : {}),
      ...(reason === 'void' ? { status: 'voided' } : {}),
    })

    // Dispatch socket updates (fire-and-forget)
    dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })
    dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'available',
      currentOrderId: null,
      expiresAt: null,
    }, { async: true }).catch(() => {})

    // Emit session update for KDS Pit Boss + Android timers
    const socketAction = reason === 'comp' ? 'comped' as const
      : reason === 'void' ? 'voided' as const
      : reason === 'force' ? 'force_stopped' as const
      : 'stopped' as const

    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: itemName || '',
      action: socketAction,
      expiresAt: null,
      startedAt: null,
    }, { async: true }).catch(() => {})

    // Auto-notify next waitlist entry for this entertainment item
    void notifyNextWaitlistEntry(orderItem.order.locationId, orderItem.menuItemId, itemName).catch(() => {})

    // Audit trail: management override action
    const auditAction = reason === 'comp' ? 'entertainment_session_comped'
      : reason === 'void' ? 'entertainment_session_voided'
      : reason === 'force' ? 'entertainment_session_force_stopped'
      : 'entertainment_session_stopped'

    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: auditAction,
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId: orderItem.menuItemId,
          itemName,
          reason,
          actualMinutesUsed: actualMinutes,
          bookedMinutes: orderItem.blockTimeMinutes,
          finalCharge: calculatedCharge,
          originalPrice: Number(orderItem.price),
          overtimeCharge: overtimeBreakdown?.overtimeCharge || 0,
          overtimeMinutes: overtimeBreakdown?.overtimeMinutes || 0,
          orderId: orderItem.orderId,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    // Build response message based on reason
    let message = ''
    if (reason === 'comp') {
      message = `Session comped. ${actualMinutes} minutes used. No charge applied.`
    } else if (reason === 'void') {
      message = `Session voided. ${actualMinutes} minutes used. Item removed from order.`
    } else if (reason === 'force') {
      message = `Session force-stopped. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}`
    } else {
      message = `Stopped session. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}${overtimeBreakdown ? ` (includes $${overtimeBreakdown.overtimeCharge.toFixed(2)} overtime for ${overtimeBreakdown.overtimeMinutes} min)` : ''}`
    }

    return NextResponse.json({ data: {
      success: true,
      reason,
      actualMinutesUsed: actualMinutes,
      charge: calculatedCharge,
      chargeBreakdown: breakdown || null,
      overtimeBreakdown: overtimeBreakdown || null,
      message,
      menuItem: updatedMenuItem,
    } })
  } catch (error) {
    console.error('Failed to stop block time:', error)
    return NextResponse.json(
      { error: 'Failed to stop block time' },
      { status: 500 }
    )
  }
})
