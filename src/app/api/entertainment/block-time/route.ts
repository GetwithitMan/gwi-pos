import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { calculateCharge, calculateBlockTimeOvertime, getActiveRate, type EntertainmentPricing, type HappyHourConfig, type ChargeBreakdown, type OvertimeConfig } from '@/lib/entertainment-pricing'
import { emitToLocation } from '@/lib/socket-server'
import { recalculatePercentDiscounts } from '@/lib/order-calculations'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'

// POST - Start block time for an order item
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, minutes, locationId } = body

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
        return { conflict: true as const }
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

      return { conflict: false as const, updatedItem }
    })

    if (result.conflict) {
      return NextResponse.json(
        { error: 'This entertainment item is already in use' },
        { status: 409 }
      )
    }

    const updatedItem = result.updatedItem

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
    const { orderItemId, additionalMinutes, locationId } = body

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

    // Calculate new expiration
    const currentExpires = new Date(orderItem.blockTimeExpiresAt)
    const now = new Date()

    // If already expired, extend from now; otherwise extend from current expiration
    const baseTime = currentExpires > now ? currentExpires : now
    const newExpiresAt = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000)
    const newTotalMinutes = (orderItem.blockTimeMinutes || 0) + additionalMinutes

    // Recalculate price for the new total duration using tier-based pricing
    const mi = orderItem.menuItem
    let newPrice = Number(mi.price || 0)

    if (mi.timedPricing && typeof mi.timedPricing === 'object') {
      const tp = mi.timedPricing as Record<string, unknown>
      if (newTotalMinutes <= 15 && tp.per15Min) {
        newPrice = Number(tp.per15Min)
      } else if (newTotalMinutes <= 30 && tp.per30Min) {
        newPrice = Number(tp.per30Min)
      } else if (newTotalMinutes <= 60 && tp.perHour) {
        newPrice = Number(tp.perHour)
      } else if (tp.perHour) {
        // Proportional for durations > 60 min
        newPrice = (newTotalMinutes / 60) * Number(tp.perHour)
      }
    } else if (Number(mi.ratePerMinute || 0) > 0) {
      // Per-minute pricing: recalculate for new total duration
      const pricing: EntertainmentPricing = {
        ratePerMinute: Number(mi.ratePerMinute),
        minimumCharge: Number(mi.minimumCharge || 0),
        incrementMinutes: mi.incrementMinutes || 15,
        graceMinutes: mi.graceMinutes || 0,
      }
      const breakdown = calculateCharge(newTotalMinutes, pricing)
      newPrice = breakdown.totalCharge
    }

    // Update the order item with new duration and recalculated price
    const updatedItem = await db.orderItem.update({
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
    await db.floorPlanElement.updateMany({
      where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
      data: { sessionExpiresAt: newExpiresAt },
    })

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

    // Emit session update for KDS Pit Boss
    void emitToLocation(orderItem.order.locationId, 'entertainment:session-update', {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: orderItem.name || '',
      action: 'extended',
      expiresAt: newExpiresAt.toISOString(),
      totalMinutes: newTotalMinutes,
    }).catch(() => {})

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

// DELETE - Stop block time early
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderItemId = searchParams.get('orderItemId')
    const locationId = searchParams.get('locationId')

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

    // Idempotency guard — check if already processed (cron + manual stop race)
    const currentMenuItem = await db.menuItem.findUnique({
      where: { id: orderItem.menuItemId },
      select: { entertainmentStatus: true, currentOrderItemId: true },
    })

    if (currentMenuItem?.entertainmentStatus === 'available' ||
        (currentMenuItem?.currentOrderItemId && currentMenuItem.currentOrderItemId !== orderItemId)) {
      // Already processed (by cron or another terminal) — return success without re-charging
      return NextResponse.json({ data: {
        success: true,
        alreadyProcessed: true,
        message: 'Session was already stopped',
      } })
    }

    // Calculate actual minutes used
    const startedAt = orderItem.blockTimeStartedAt
    const now = new Date()
    let actualMinutes = 0

    if (startedAt) {
      actualMinutes = Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
    }

    // Calculate the charge based on actual usage
    const itemName = orderItem.menuItem.name
    const menuItem = orderItem.menuItem
    let calculatedCharge = Number(menuItem.price || 0)
    let breakdown: ChargeBreakdown | null = null
    let overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null = null

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
      const sessionStart = orderItem.blockTimeStartedAt || now
      const { rate: activeRate } = getActiveRate(pricing.ratePerMinute, happyHour, sessionStart)
      const effectivePricing: EntertainmentPricing = {
        ...pricing,
        ratePerMinute: activeRate,
        overtime: deleteOvertimeConfig,
      }

      // Pass bookedMinutes so calculateCharge applies overtime if session exceeded booked time
      const bookedMinutes = orderItem.blockTimeMinutes || undefined
      breakdown = calculateCharge(actualMinutes, effectivePricing, bookedMinutes)
      calculatedCharge = breakdown.totalCharge
      if (breakdown.overtimeMinutes > 0) {
        overtimeBreakdown = { overtimeMinutes: breakdown.overtimeMinutes, overtimeCharge: breakdown.overtimeCharge }
      }
    } else if (menuItem.timedPricing && typeof menuItem.timedPricing === 'object') {
      // Tier-based pricing from timedPricing JSON
      const tp = menuItem.timedPricing as Record<string, unknown>
      const purchasedMinutes = orderItem.blockTimeMinutes || 0
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
        // Use the tier-based rate per minute as base for overtime calculation
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
    } else if (deleteOvertimeConfig && orderItem.blockTimeMinutes && actualMinutes > orderItem.blockTimeMinutes) {
      // Flat-rate fallback with overtime: derive a base rate from the flat price / booked minutes
      const flatBaseRate = calculatedCharge / orderItem.blockTimeMinutes
      const incrementMin = menuItem.incrementMinutes || 15
      overtimeBreakdown = calculateBlockTimeOvertime(
        actualMinutes,
        orderItem.blockTimeMinutes,
        deleteOvertimeConfig,
        flatBaseRate,
        incrementMin
      )
      calculatedCharge += overtimeBreakdown.overtimeCharge
    }
    // Otherwise keep MenuItem.price as flat-rate fallback

    // Update the order item - clear startedAt (so Android filter excludes it),
    // set expiration to now, and apply calculated charge
    await db.orderItem.update({
      where: { id: orderItemId },
      data: {
        blockTimeStartedAt: null,
        blockTimeExpiresAt: now,
        price: calculatedCharge,
        itemTotal: calculatedCharge,
      },
    })

    // Reset the menu item status
    const updatedMenuItem = await db.menuItem.update({
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
    await db.floorPlanElement.updateMany({
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

    // Fire-and-forget: emit ITEM_UPDATED for event-sourced sync (stop) with new price
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: calculatedCharge,
      blockTimeMinutes: orderItem.blockTimeMinutes,
      blockTimeStartedAt: 'CLEARED',
      blockTimeExpiresAt: now.toISOString(),
      actualMinutesUsed: actualMinutes,
    })

    // Dispatch socket updates (fire-and-forget)
    dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })
    dispatchEntertainmentStatusChanged(orderItem.order.locationId, {
      itemId: orderItem.menuItemId,
      entertainmentStatus: 'available',
      currentOrderId: null,
      expiresAt: null,
    }, { async: true }).catch(() => {})

    // Auto-notify next waitlist entry for this entertainment item
    void notifyNextWaitlistEntry(orderItem.order.locationId, orderItem.menuItemId, itemName).catch(() => {})

    return NextResponse.json({ data: {
      success: true,
      actualMinutesUsed: actualMinutes,
      charge: calculatedCharge,
      chargeBreakdown: breakdown || null,
      overtimeBreakdown: overtimeBreakdown || null,
      message: `Stopped session. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}${overtimeBreakdown ? ` (includes $${overtimeBreakdown.overtimeCharge.toFixed(2)} overtime for ${overtimeBreakdown.overtimeMinutes} min)` : ''}`,
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
