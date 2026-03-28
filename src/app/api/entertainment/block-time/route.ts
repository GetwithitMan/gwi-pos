import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged, dispatchEntertainmentUpdate, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import type { OvertimeConfig } from '@/lib/entertainment-pricing'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

import { recalculateOrderTotals } from '@/lib/domain/order-items'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('entertainment-block-time')
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

/**
 * BUG-L1 FIX: Recalculate full order totals (subtotal, tax, total) after
 * entertainment price changes. Previously only discounts were recalculated,
 * leaving taxTotal and total stale after block-time start/stop/extend/override.
 */
async function recalculateOrderAfterPriceChange(
  orderId: string,
  locationId: string
): Promise<void> {
  try {
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      location: { select: { settings: true } },
    })
    if (!order) return

    const totals = await recalculateOrderTotals(
      db,
      orderId,
      (order as any).location.settings,
      Number(order.tipTotal) || 0,
      order.isTaxExempt
    )

    await OrderRepository.updateOrder(orderId, locationId, {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      taxFromInclusive: totals.taxFromInclusive,
      taxFromExclusive: totals.taxFromExclusive,
      total: totals.total,
      commissionTotal: totals.commissionTotal,
      itemCount: totals.itemCount,
    })

    // Dispatch real-time totals update so all terminals see the corrected tax
    void dispatchOrderTotalsUpdate(locationId, orderId, {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      tipTotal: Number(order.tipTotal) || 0,
      discountTotal: Number(order.discountTotal) || 0,
      total: totals.total,
      commissionTotal: totals.commissionTotal,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
  } catch (err) {
    console.error('[block-time] Failed to recalculate order totals after price change:', err)
  }
}

import {
  validateStartRequest,
  validateSessionStart,
  validateExtendRequest,
  validateExtension,
  validateTimeOverrideRequest,
  validateTimeOverride,
  validateStopRequest,
  validateStopSession,
  calculateInitialBlockPrice,
  calculateTimeOverridePrice,
  buildOvertimeConfig,
  startSession,
  stopSession,
  extendSession,
  overrideSessionTime,
} from '@/lib/domain/entertainment'

// POST - Start block time for an order item
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, minutes, locationId, employeeId } = body

    const validationError = validateStartRequest({ orderItemId, locationId, minutes })
    if (validationError) {
      return err(validationError)
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Get the order item and verify it's an entertainment item
    const orderItem = await OrderItemRepository.getItemByIdWithInclude(orderItemId, locationId, {
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
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    const sessionError = validateSessionStart({
      itemType: orderItem.menuItem.itemType,
      orderStatus: orderItem.order.status,
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
    })
    if (sessionError) {
      const status = sessionError === 'Location ID mismatch' ? 403 : 400
      return NextResponse.json({ error: sessionError }, { status })
    }

    // Calculate expiration time
    const now = new Date()
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)

    // Build overtime config from MenuItem fields (included in response so client knows pricing)
    const overtimeConfig: OvertimeConfig | undefined = buildOvertimeConfig(orderItem.menuItem)

    // Calculate initial block price based on selected duration
    const initialPrice = calculateInitialBlockPrice(minutes, orderItem.menuItem)

    // Wrap all writes in a transaction with FOR UPDATE lock to prevent double-booking
    const result = await db.$transaction(async (tx) => {
      return startSession(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        orderId: orderItem.orderId,
        locationId,
        minutes,
        initialPrice,
        now,
        expiresAt,
      })
    })

    if (result.conflict) {
      return err('This entertainment item is already in use', 409)
    }

    if (result.waitlistConflict) {
      return err(`A waitlisted customer${result.notifiedCustomer ? ` (${result.notifiedCustomer})` : ''} has been notified for this item. Seat them first or cancel their waitlist entry.`, 409)
    }

    const updatedItem = result.updatedItem!

    // Sync: notify cloud of bidirectional OrderItem changes
    void notifyDataChanged({ locationId, domain: 'events', action: 'created', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: recalculate full order totals (subtotal, tax, total)
    void recalculateOrderAfterPriceChange(orderItem.orderId, orderItem.order.locationId)

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
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Emit session update for KDS Pit Boss + Android timers (includes startedAt)
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: updatedItem.name || '',
      action: 'started',
      expiresAt: expiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

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

    return ok({
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      overtime: overtimeConfig || null,
      message: `Started ${minutes} minute block time, expires at ${expiresAt.toLocaleTimeString()}`,
    })
  } catch (error) {
    console.error('Failed to start block time:', error)
    return err('Failed to start block time', 500)
  }
})

// PATCH - Extend block time
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, additionalMinutes, locationId, employeeId, finishGameCharge } = body

    const validationError = validateExtendRequest({ orderItemId, locationId, additionalMinutes })
    if (validationError) {
      return err(validationError)
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Get the order item with menuItem for tier-based price recalculation
    const orderItem = await OrderItemRepository.getItemByIdWithInclude(orderItemId, locationId, {
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
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    const extendError = validateExtension({
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
      orderStatus: orderItem.order.status,
      hasActiveBlockTime: !!orderItem.blockTimeExpiresAt,
    })
    if (extendError) {
      const status = extendError === 'Location ID mismatch' ? 403 : 400
      return NextResponse.json({ error: extendError }, { status })
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
          return err('Cannot extend — customers are waiting. Finish your session so the next person can play.', 409)
        }
      }
    }

    // Wrap extend in a transaction with FOR UPDATE to prevent concurrent extends
    const txResult = await db.$transaction(async (tx) => {
      return extendSession(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        additionalMinutes,
        menuItem: orderItem.menuItem,
      })
    })

    if ('error' in txResult) {
      return err(txResult.error)
    }

    const { updatedItem, newExpiresAt, newTotalMinutes, newPrice: tieredPrice } = txResult

    // Apply flat Finish Game surcharge on top of the tiered extension charge
    const flatFee = (typeof finishGameCharge === 'number' && finishGameCharge > 0) ? finishGameCharge : 0
    const newPrice = tieredPrice + flatFee

    if (flatFee > 0) {
      // Persist the surcharge to the OrderItem price in DB
      await db.orderItem.update({
        where: { id: orderItemId },
        data: { price: newPrice, itemTotal: newPrice },
      })
    }

    // Sync: notify cloud of bidirectional OrderItem changes
    void notifyDataChanged({ locationId, domain: 'events', action: 'updated', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: recalculate full order totals (subtotal, tax, total)
    void recalculateOrderAfterPriceChange(orderItem.orderId, orderItem.order.locationId)

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
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Emit session update for KDS Pit Boss + Android timers (includes startedAt)
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: updatedItem.name || '',
      action: 'extended',
      expiresAt: newExpiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
      addedMinutes: additionalMinutes,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

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
          finishGameCharge: flatFee > 0 ? flatFee : undefined,
          newExpiresAt: newExpiresAt.toISOString(),
          orderId: orderItem.orderId,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return ok({
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      message: `Extended by ${additionalMinutes} minutes, new expiration at ${newExpiresAt.toLocaleTimeString()}`,
    })
  } catch (error) {
    console.error('Failed to extend block time:', error)
    return err('Failed to extend block time', 500)
  }
})

// PUT - Manual time override (manager sets exact remaining time)
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, newExpiresAt, reason, locationId, employeeId } = body

    const validationError = validateTimeOverrideRequest({ orderItemId, locationId, newExpiresAt })
    if (validationError) {
      return err(validationError)
    }

    // Permission check — manager override requires entertainment permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    const parsedExpiresAt = new Date(newExpiresAt)

    // Get the order item with menuItem for price recalculation
    const orderItem = await OrderItemRepository.getItemByIdWithInclude(orderItemId, locationId, {
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
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    const overrideError = validateTimeOverride({
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
      orderStatus: orderItem.order.status,
      hasStartedAt: !!orderItem.blockTimeStartedAt,
      parsedExpiresAt,
    })
    if (overrideError) {
      const status = overrideError === 'Location ID mismatch' ? 403 : 400
      return NextResponse.json({ error: overrideError }, { status })
    }

    const startedAt = orderItem.blockTimeStartedAt!
    const newDurationMinutes = Math.max(1, Math.ceil((parsedExpiresAt.getTime() - startedAt.getTime()) / 1000 / 60))

    // Recalculate price based on new duration
    const newPrice = calculateTimeOverridePrice(newDurationMinutes, orderItem.menuItem as any)

    const oldExpiresAt = orderItem.blockTimeExpiresAt
    const oldMinutes = orderItem.blockTimeMinutes

    // Wrap in transaction
    const txResult = await db.$transaction(async (tx) => {
      return overrideSessionTime(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        parsedExpiresAt,
        startedAt,
        newPrice,
      })
    })

    // Sync: notify cloud of bidirectional OrderItem changes
    void notifyDataChanged({ locationId, domain: 'events', action: 'updated', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: recalculate full order totals (subtotal, tax, total)
    void recalculateOrderAfterPriceChange(orderItem.orderId, orderItem.order.locationId)

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
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Emit session update for KDS Pit Boss + Android timers
    void dispatchEntertainmentUpdate(orderItem.order.locationId, {
      sessionId: orderItemId,
      tableId: orderItem.menuItemId,
      tableName: txResult.name || '',
      action: 'time_override',
      expiresAt: parsedExpiresAt.toISOString(),
      startedAt: txResult.blockTimeStartedAt?.toISOString() ?? null,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

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

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to override block time:', error)
    return err('Failed to override block time', 500)
  }
})

// DELETE - Stop block time early (supports reason: 'normal' | 'comp' | 'void' | 'force')
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderItemIdParam = searchParams.get('orderItemId')
    const locationIdParam = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const reason = (searchParams.get('reason') || 'normal') as 'normal' | 'comp' | 'void' | 'force'

    const validationError = validateStopRequest({ orderItemId: orderItemIdParam, locationId: locationIdParam })
    if (validationError) {
      return err(validationError)
    }

    // After validation, these are guaranteed non-null
    const orderItemId = orderItemIdParam!
    const locationId = locationIdParam!

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Get the order item
    const orderItem = await OrderItemRepository.getItemByIdWithInclude(orderItemId, locationId, {
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
    })

    if (!orderItem) {
      return notFound('Order item not found')
    }

    const stopError = validateStopSession({
      orderLocationId: orderItem.order.locationId,
      requestLocationId: locationId,
    })
    if (stopError) {
      return forbidden(stopError)
    }

    // Use an interactive transaction with FOR UPDATE to prevent race conditions
    const now = new Date()
    const menuItem = orderItem.menuItem
    const itemName = menuItem.name

    const txResult = await db.$transaction(async (tx) => {
      return stopSession(tx, {
        orderItemId,
        menuItemId: orderItem.menuItemId,
        reason,
        now,
        menuItem: menuItem as any,
      })
    })

    // If already processed by cron or another terminal, return idempotent success
    if (txResult.alreadyProcessed) {
      return ok({
        success: true,
        alreadyProcessed: true,
        message: 'Session was already stopped',
      })
    }

    const { actualMinutes, calculatedCharge, breakdown, overtimeBreakdown, updatedMenuItem } = txResult

    // Sync: notify cloud of bidirectional OrderItem changes
    void notifyDataChanged({ locationId, domain: 'events', action: 'updated', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: recalculate full order totals (subtotal, tax, total)
    void recalculateOrderAfterPriceChange(orderItem.orderId, orderItem.order.locationId)

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
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

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
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Auto-notify next waitlist entry for this entertainment item
    void notifyNextWaitlistEntry(orderItem.order.locationId, orderItem.menuItemId, itemName).catch(err => log.warn({ err }, 'Socket dispatch failed'))

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

    return ok({
      success: true,
      reason,
      actualMinutesUsed: actualMinutes,
      charge: calculatedCharge,
      chargeBreakdown: breakdown || null,
      overtimeBreakdown: overtimeBreakdown || null,
      message,
      menuItem: updatedMenuItem,
    })
  } catch (error) {
    console.error('Failed to stop block time:', error)
    return err('Failed to stop block time', 500)
  }
})
