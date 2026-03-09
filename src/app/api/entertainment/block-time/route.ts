import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { calculateCharge, getActiveRate, type EntertainmentPricing, type HappyHourConfig, type ChargeBreakdown } from '@/lib/entertainment-pricing'
import { emitToLocation } from '@/lib/socket-server'

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
      },
      select: {
        id: true,
        name: true,
        blockTimeMinutes: true,
        blockTimeStartedAt: true,
        blockTimeExpiresAt: true,
      },
    })

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
      const effectivePricing: EntertainmentPricing = { ...pricing, ratePerMinute: activeRate }

      breakdown = calculateCharge(actualMinutes, effectivePricing)
      calculatedCharge = breakdown.totalCharge
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
    }
    // Otherwise keep MenuItem.price as flat-rate fallback

    // Update the order item - set expiration to now and apply calculated charge
    await db.orderItem.update({
      where: { id: orderItemId },
      data: {
        blockTimeExpiresAt: now,
        price: calculatedCharge,
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

    // Fire-and-forget: emit ITEM_UPDATED for event-sourced sync (stop) with new price
    void emitOrderEvent(orderItem.order.locationId, orderItem.order.id, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: calculatedCharge,
      blockTimeMinutes: orderItem.blockTimeMinutes,
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
    void (async () => {
      try {
        const floorPlanElement = await db.floorPlanElement.findFirst({
          where: { linkedMenuItemId: orderItem.menuItemId, deletedAt: null },
          select: { id: true, visualType: true },
        })

        if (floorPlanElement) {
          const nextWaiting = await db.entertainmentWaitlist.findFirst({
            where: {
              locationId: orderItem.order.locationId,
              deletedAt: null,
              status: 'waiting',
              OR: [
                { elementId: floorPlanElement.id },
                { visualType: floorPlanElement.visualType },
              ],
            },
            orderBy: { position: 'asc' },
          })

          if (nextWaiting) {
            await db.entertainmentWaitlist.update({
              where: { id: nextWaiting.id },
              data: { status: 'notified', notifiedAt: new Date() },
            })

            // Emit waitlist notification to all terminals
            void emitToLocation(orderItem.order.locationId, 'entertainment:waitlist-notify', {
              entryId: nextWaiting.id,
              customerName: nextWaiting.customerName,
              elementId: floorPlanElement.id,
              elementName: floorPlanElement.visualType,
              message: `${nextWaiting.customerName || 'Next customer'} — your ${itemName || 'entertainment item'} is now available!`,
            }).catch(() => {})
          }
        }
      } catch (err) {
        console.error('Failed to auto-notify waitlist:', err)
      }
    })()

    return NextResponse.json({ data: {
      success: true,
      actualMinutesUsed: actualMinutes,
      charge: calculatedCharge,
      chargeBreakdown: breakdown || null,
      message: `Stopped session. ${actualMinutes} minutes used. Charge: $${calculatedCharge.toFixed(2)}`,
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
