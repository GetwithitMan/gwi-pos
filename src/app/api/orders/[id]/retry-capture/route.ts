import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { PAYMENT_STATES } from '@/lib/domain/payment/payment-state-machine'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type {
  PaymentProcessedPayload,
  OrderClosedPayload,
  OrdersListChangedPayload,
} from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-retry-capture')

export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { employeeId, retryMode } = body as {
      employeeId: string
      retryMode: 'same_card' | 'cash' | 'manager_void'
    }

    if (!employeeId || !retryMode) {
      return err('Missing employeeId or retryMode')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const orderCheck = await db.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, locationId: true },
      })
      if (!orderCheck) {
        return notFound('Order not found')
      }
      locationId = orderCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      cards: {
        where: { deletedAt: null, status: 'authorized' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    })

    if (!order) {
      return notFound('Order not found')
    }
    const now = new Date()

    if (retryMode === 'same_card') {
      // Re-attempt capture against authorized cards
      if (order.cards.length === 0) {
        return err('No authorized cards on this tab')
      }

      const purchaseAmount = Number(order.total) - Number(order.tipTotal)
      let capturedCard = null
      let captureResponse = null

      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          const response = await client.preAuthCapture(card.readerId, {
            recordNo: card.recordNo,
            purchaseAmount,
          })
          if (response.cmdStatus === 'Approved') {
            capturedCard = card
            captureResponse = response
            break
          }
        } catch (err) {
          console.warn(`[Retry Capture] Card ${card.cardLast4} failed:`, err)
          continue
        }
      }

      if (!capturedCard || !captureResponse) {
        // Still declined — increment retry count
        await OrderRepository.updateOrder(orderId, locationId, {
          captureRetryCount: { increment: 1 },
          captureDeclinedAt: now,
          lastCaptureError: 'Retry failed - all cards declined',
        })

        // Check walkout threshold
        const locSettings = parseSettings(await getLocationSettings(locationId))
        const updated = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, { captureRetryCount: true })
        const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 3
        if (locSettings.barTabs?.autoFlagWalkoutAfterDeclines && updated && updated.captureRetryCount >= maxRetries) {
          await OrderRepository.updateOrder(orderId, locationId, { isWalkout: true, walkoutAt: now })
        }

        // Queue socket event inside a lightweight transaction for crash safety
        await db.$transaction(async (tx) => {
          const listPayload: OrdersListChangedPayload = { trigger: 'updated', orderId }
          await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
        })
        flushOutboxSafe(locationId)

        // Event emission: capture retry failed
        void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
          captureRetryCount: updated?.captureRetryCount || 0,
          lastCaptureError: 'Retry failed - all cards declined',
        }).catch(err => log.warn({ err }, 'Background task failed'))

        return ok({ success: false, error: 'All cards declined on retry', retryCount: updated?.captureRetryCount || 0 })
      }

      // Success — close the tab with FSM-validated payment status
      // BUG #461 FIX: Create Payment record for same_card retry capture
      const paymentMethod = capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit'
      await db.$transaction(async (tx) => {
        // Row-level lock to prevent concurrent retry captures
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

        await tx.orderCard.update({
          where: { id: capturedCard!.id },
          data: { status: 'captured', capturedAmount: purchaseAmount, capturedAt: now, tipAmount: 0, lastMutatedBy: 'cloud' },
        })
        await OrderRepository.updateOrder(orderId, locationId, {
          status: 'paid',
          tabStatus: 'closed',
          paidAt: now,
          closedAt: now,
          captureDeclinedAt: null,
          lastCaptureError: null,
        }, tx)
        // TX-KEEP: CREATE — payment record for same_card retry capture; no repo create method that accepts tx
        await tx.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            amount: purchaseAmount,
            tipAmount: 0,
            totalAmount: purchaseAmount,
            paymentMethod,
            cardBrand: capturedCard!.cardType || 'unknown',
            cardLast4: capturedCard!.cardLast4,
            authCode: captureResponse!.authCode || null,
            datacapRecordNo: capturedCard!.recordNo,
            status: PAYMENT_STATES.COMPLETED,
            lastMutatedBy: 'cloud',
          },
        })
        // Void remaining authorized cards
        for (const c of order.cards.filter(c => c.id !== capturedCard!.id)) {
          await tx.orderCard.update({ where: { id: c.id }, data: { status: PAYMENT_STATES.VOIDED, lastMutatedBy: 'cloud' } })
        }

        // Queue critical socket events inside transaction for crash safety
        const paymentPayload: PaymentProcessedPayload = {
          orderId,
          status: PAYMENT_STATES.COMPLETED,
          method: paymentMethod,
          amount: purchaseAmount,
          tipAmount: 0,
          totalAmount: purchaseAmount,
          employeeId,
          isClosed: true,
          cardBrand: capturedCard!.cardType || null,
          cardLast4: capturedCard!.cardLast4 || null,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.PAYMENT_PROCESSED, paymentPayload)

        const closedPayload: OrderClosedPayload = {
          orderId,
          status: 'paid',
          closedAt: now.toISOString(),
          closedByEmployeeId: employeeId,
          locationId,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_CLOSED, closedPayload)

        const listPayload: OrdersListChangedPayload = { trigger: 'paid', orderId }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
      })

      // Flush outbox after commit
      flushOutboxSafe(locationId)

      // Floor plan update is non-critical UI — fire-and-forget
      if (order.tableId) void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      void emitOrderEvents(locationId, orderId, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: orderId, // No individual payment ID available from batch tx
            method: paymentMethod,
            amountCents: Math.round(purchaseAmount * 100),
            tipCents: 0,
            totalCents: Math.round(purchaseAmount * 100),
            cardBrand: capturedCard.cardType || 'unknown',
            cardLast4: capturedCard.cardLast4,
            status: PAYMENT_STATES.COMPLETED,
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid', reason: 'Retry capture succeeded' },
        },
      ]).catch(err => log.warn({ err }, 'Background task failed'))

      return ok({
          success: true,
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          amount: purchaseAmount,
        })

    } else if (retryMode === 'cash') {
      // Cash payment — void all preauth cards first
      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          await client.voidSale(card.readerId, { recordNo: card.recordNo })
          await db.orderCard.update({ where: { id: card.id }, data: { status: PAYMENT_STATES.VOIDED, lastMutatedBy: 'cloud' } })
        } catch (err) {
          console.warn(`[Retry Cash] Failed to void card ${card.cardLast4}:`, err)
        }
      }

      // Create cash payment with FSM-validated status + queue socket events atomically
      const tipAmount = Number(order.tipTotal) || 0
      const paymentAmount = Number(order.total) - tipAmount
      await db.$transaction(async (tx) => {
        // Row-level lock to prevent concurrent retry captures
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

        // TX-KEEP: CREATE — cash fallback payment record for retry capture; no repo create method that accepts tx
        await tx.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            paymentMethod: 'cash',
            amount: paymentAmount,
            totalAmount: paymentAmount + tipAmount,
            tipAmount,
            status: PAYMENT_STATES.COMPLETED,
            amountTendered: paymentAmount + tipAmount,
            changeGiven: 0,
            lastMutatedBy: 'cloud',
          },
        })
        await OrderRepository.updateOrder(orderId, locationId, {
          status: 'paid',
          tabStatus: 'closed',
          paidAt: now,
          closedAt: now,
          captureDeclinedAt: null,
          lastCaptureError: null,
        }, tx)

        // Queue critical socket events inside transaction for crash safety
        const paymentPayload: PaymentProcessedPayload = {
          orderId,
          status: PAYMENT_STATES.COMPLETED,
          method: 'cash',
          amount: paymentAmount,
          tipAmount,
          totalAmount: paymentAmount,
          employeeId,
          isClosed: true,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.PAYMENT_PROCESSED, paymentPayload)

        const closedPayload: OrderClosedPayload = {
          orderId,
          status: 'paid',
          closedAt: now.toISOString(),
          closedByEmployeeId: employeeId,
          locationId,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_CLOSED, closedPayload)

        const listPayload: OrdersListChangedPayload = { trigger: 'paid', orderId }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
      })

      // Flush outbox after commit
      flushOutboxSafe(locationId)

      // Floor plan update is non-critical UI — fire-and-forget
      if (order.tableId) void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      void emitOrderEvents(locationId, orderId, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: orderId,
            method: 'cash',
            amountCents: Math.round(paymentAmount * 100),
            tipCents: Math.round(tipAmount * 100),
            totalCents: Math.round(paymentAmount * 100),
            status: PAYMENT_STATES.COMPLETED,
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid', reason: 'Retry capture — cash fallback' },
        },
      ]).catch(err => log.warn({ err }, 'Background task failed'))

      pushUpstream()

      return ok({ success: true, paymentMethod: 'cash', amount: paymentAmount })

    } else if (retryMode === 'manager_void') {
      // Requires manager permission
      const auth = await requireAnyPermission(employeeId, locationId, [PERMISSIONS.MGR_VOID_ORDERS])
      if (!auth.authorized) {
        return forbidden(auth.error || 'Manager permission required')
      }

      // Void all authorized cards at Datacap (outside DB transaction)
      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          await client.voidSale(card.readerId, { recordNo: card.recordNo })
        } catch (err) {
          console.warn(`[Manager Void] Failed to void card ${card.cardLast4}:`, err)
        }
      }

      // Void all cards, close order, audit log, and queue socket events atomically
      await db.$transaction(async (tx) => {
        // Row-level lock to prevent concurrent retry captures
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

        await tx.orderCard.updateMany({
          where: { orderId, status: 'authorized' },
          data: { status: PAYMENT_STATES.VOIDED, lastMutatedBy: 'cloud' },
        })
        await OrderRepository.updateOrder(orderId, locationId, {
          status: PAYMENT_STATES.VOIDED,
          tabStatus: 'closed',
          closedAt: now,
          captureDeclinedAt: null,
          lastCaptureError: null,
        }, tx)

        // Audit log inside transaction
        await tx.auditLog.create({
          data: {
            locationId,
            employeeId,
            action: 'manager_void_declined_tab',
            entityType: 'order',
            entityId: orderId,
            details: { reason: 'Manager voided declined capture tab' },
          },
        })

        // Queue critical socket events inside transaction for crash safety
        const closedPayload: OrderClosedPayload = {
          orderId,
          status: PAYMENT_STATES.VOIDED,
          closedAt: now.toISOString(),
          closedByEmployeeId: employeeId,
          locationId,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_CLOSED, closedPayload)

        const listPayload: OrdersListChangedPayload = { trigger: 'voided', orderId }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
      })

      // Flush outbox after commit
      flushOutboxSafe(locationId)

      // Floor plan update is non-critical UI — fire-and-forget
      if (order.tableId) void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
        closedStatus: PAYMENT_STATES.VOIDED,
        reason: 'Manager voided declined capture tab',
      }).catch(err => log.warn({ err }, 'Background task failed'))

      pushUpstream()

      return ok({ success: true, action: PAYMENT_STATES.VOIDED })
    }

    return err('Invalid retryMode')
  } catch (error) {
    console.error('[Retry Capture] Error:', error)
    return err('Failed to retry capture', 500)
  }
}))
