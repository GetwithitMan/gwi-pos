import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok, notFound } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchEntertainmentUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import {
  validateStartRequest,
  calculateInitialBlockPrice,
  buildOvertimeConfig,
  startSession,
} from '@/lib/domain/entertainment'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

const log = createChildLogger('entertainment-sessions-start')

/**
 * POST /api/entertainment/sessions/start
 *
 * Start a new entertainment session.
 * Body: { menuItemId, orderId, blockTimeMinutes?, employeeId }
 * Returns: session details + initial charge + expiry time
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { menuItemId, orderId, blockTimeMinutes, employeeId, locationId } = body

    // Validate required fields
    const validationError = validateStartRequest({
      orderItemId: null, // Not needed for this variant
      locationId,
      minutes: blockTimeMinutes || 0,
    })
    if (validationError && blockTimeMinutes === undefined) {
      return err('blockTimeMinutes is required', 400)
    }

    const minutes = blockTimeMinutes || 0
    if (!menuItemId || !orderId) {
      return err('menuItemId and orderId are required', 400)
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Fetch the menu item to verify it's entertainment
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
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
    })

    if (!menuItem) {
      return notFound('Menu item not found')
    }

    if (menuItem.itemType !== 'timed_rental') {
      return err('Item is not an entertainment item', 400)
    }

    // Fetch the order to verify it exists and is in the right location
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        locationId: true,
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    if (order.locationId !== locationId) {
      return err('Location ID mismatch', 403)
    }

    if (!['open', 'in_progress'].includes(order.status)) {
      return err(`Cannot start entertainment session on ${order.status} order`, 400)
    }

    // Create an order item if one doesn't exist for this menu item in this order
    let orderItemId: string
    const existingItem = await db.orderItem.findFirst({
      where: {
        orderId,
        menuItemId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (existingItem) {
      orderItemId = existingItem.id
    } else {
      // Create a new order item for this entertainment item
      const now = new Date()
      const initialPrice = calculateInitialBlockPrice(minutes, menuItem as any)

      const created = await db.orderItem.create({
        data: {
          id: `oi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          orderId,
          menuItemId,
          name: menuItem.name,
          price: initialPrice,
          itemTotal: initialPrice,
          status: 'active',
          quantity: 1,
          locationId,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
      orderItemId = created.id
    }

    // Calculate expiration time
    const now = new Date()
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)

    // Build overtime config
    const overtimeConfig = buildOvertimeConfig(menuItem as any)

    // Calculate initial price
    const initialPrice = calculateInitialBlockPrice(minutes, menuItem as any)

    // Start the session in a transaction with FOR UPDATE lock
    const result = await db.$transaction(async (tx) => {
      return startSession(tx, {
        orderItemId,
        menuItemId,
        orderId,
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
      return err(
        `A waitlisted customer${result.notifiedCustomer ? ` (${result.notifiedCustomer})` : ''} has been notified for this item`,
        409
      )
    }

    const updatedItem = result.updatedItem!

    // Fire-and-forget: sync to cloud
    void notifyDataChanged({ locationId, domain: 'events', action: 'created', entityId: orderItemId })
    void pushUpstream()

    // Fire-and-forget: emit order event
    void emitOrderEvent(locationId, orderId, 'ITEM_UPDATED', {
      lineItemId: orderItemId,
      price: initialPrice,
      blockTimeMinutes: minutes,
      blockTimeStartedAt: now.toISOString(),
      blockTimeExpiresAt: expiresAt.toISOString(),
    })

    // Fire-and-forget: socket updates
    void dispatchEntertainmentStatusChanged(locationId, {
      itemId: menuItemId,
      entertainmentStatus: 'in_use',
      currentOrderId: orderId,
      expiresAt: expiresAt.toISOString(),
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    void dispatchEntertainmentUpdate(locationId, {
      sessionId: orderItemId,
      tableId: menuItemId,
      tableName: updatedItem.name || '',
      action: 'started',
      expiresAt: expiresAt.toISOString(),
      startedAt: updatedItem.blockTimeStartedAt?.toISOString() ?? null,
    }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_session_started',
        entityType: 'order_item',
        entityId: orderItemId,
        details: {
          menuItemId,
          itemName: menuItem.name,
          minutes,
          initialPrice,
          orderId,
        },
      },
    }).catch(err => console.error('[entertainment-sessions] Audit log failed:', err))

    return ok({
      session: {
        sessionId: orderItemId,
        sessionName: updatedItem.name,
        orderId,
        menuItemId,
        initialCharge: initialPrice,
        bookedMinutes: minutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      overtime: overtimeConfig || null,
    })
  } catch (error) {
    console.error('[entertainment-sessions-start] Error:', error)
    return err('Failed to start session', 500)
  }
})
