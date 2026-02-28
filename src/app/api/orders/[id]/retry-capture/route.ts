import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'

export const POST = withVenue(async function POST(
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
      return NextResponse.json({ error: 'Missing employeeId or retryMode' }, { status: 400 })
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId
    const now = new Date()

    if (retryMode === 'same_card') {
      // Re-attempt capture against authorized cards
      if (order.cards.length === 0) {
        return NextResponse.json({ error: 'No authorized cards on this tab' }, { status: 400 })
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
        await db.order.update({
          where: { id: orderId },
          data: {
            captureRetryCount: { increment: 1 },
            captureDeclinedAt: now,
            lastCaptureError: 'Retry failed - all cards declined',
          },
        })

        // Check walkout threshold
        const locSettings = parseSettings(await getLocationSettings(locationId))
        const updated = await db.order.findUnique({ where: { id: orderId }, select: { captureRetryCount: true } })
        const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 3
        if (locSettings.barTabs?.autoFlagWalkoutAfterDeclines && updated && updated.captureRetryCount >= maxRetries) {
          await db.order.update({
            where: { id: orderId },
            data: { isWalkout: true, walkoutAt: now },
          })
        }

        dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(() => {})

        // Event emission: capture retry failed
        void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
          captureRetryCount: updated?.captureRetryCount || 0,
          lastCaptureError: 'Retry failed - all cards declined',
        }).catch(console.error)

        return NextResponse.json({
          data: { success: false, error: 'All cards declined on retry', retryCount: updated?.captureRetryCount || 0 },
        })
      }

      // Success — close the tab
      // BUG #461 FIX: Create Payment record for same_card retry capture
      await db.$transaction([
        db.orderCard.update({
          where: { id: capturedCard.id },
          data: { status: 'captured', capturedAmount: purchaseAmount, capturedAt: now, tipAmount: 0 },
        }),
        db.order.update({
          where: { id: orderId },
          data: {
            status: 'paid',
            tabStatus: 'closed',
            paidAt: now,
            closedAt: now,
            captureDeclinedAt: null,
            lastCaptureError: null,
          },
        }),
        db.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            amount: purchaseAmount,
            tipAmount: 0,
            totalAmount: purchaseAmount,
            paymentMethod: capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
            cardBrand: capturedCard.cardType || 'unknown',
            cardLast4: capturedCard.cardLast4,
            authCode: captureResponse.authCode || null,
            datacapRecordNo: capturedCard.recordNo,
            status: 'completed',
          },
        }),
        // Void remaining authorized cards
        ...order.cards
          .filter(c => c.id !== capturedCard!.id)
          .map(c => db.orderCard.update({ where: { id: c.id }, data: { status: 'voided' } })),
      ])

      dispatchOpenOrdersChanged(locationId, { trigger: 'paid' as any, orderId }, { async: true }).catch(() => {})
      if (order.tableId) dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

      // Event emission: retry capture succeeded — payment applied + order closed
      void emitOrderEvents(locationId, orderId, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: orderId, // No individual payment ID available from batch tx
            method: capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
            amountCents: Math.round(purchaseAmount * 100),
            tipCents: 0,
            totalCents: Math.round(purchaseAmount * 100),
            cardBrand: capturedCard.cardType || 'unknown',
            cardLast4: capturedCard.cardLast4,
            status: 'completed',
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid', reason: 'Retry capture succeeded' },
        },
      ]).catch(console.error)

      return NextResponse.json({
        data: {
          success: true,
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          amount: purchaseAmount,
        },
      })

    } else if (retryMode === 'cash') {
      // Cash payment — void all preauth cards first
      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          await client.voidSale(card.readerId, { recordNo: card.recordNo })
          await db.orderCard.update({ where: { id: card.id }, data: { status: 'voided' } })
        } catch (err) {
          console.warn(`[Retry Cash] Failed to void card ${card.cardLast4}:`, err)
        }
      }

      // Create cash payment
      const paymentAmount = Number(order.total)
      await db.$transaction([
        db.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            paymentMethod: 'cash',
            amount: paymentAmount,
            totalAmount: paymentAmount,
            tipAmount: Number(order.tipTotal) || 0,
            status: 'completed',
            amountTendered: paymentAmount,
            changeGiven: 0,
          },
        }),
        db.order.update({
          where: { id: orderId },
          data: {
            status: 'paid',
            tabStatus: 'closed',
            paidAt: now,
            closedAt: now,
            captureDeclinedAt: null,
            lastCaptureError: null,
          },
        }),
      ])

      dispatchOpenOrdersChanged(locationId, { trigger: 'paid' as any, orderId }, { async: true }).catch(() => {})
      if (order.tableId) dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

      // Event emission: cash retry payment applied + order closed
      void emitOrderEvents(locationId, orderId, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: orderId,
            method: 'cash',
            amountCents: Math.round(paymentAmount * 100),
            tipCents: Math.round((Number(order.tipTotal) || 0) * 100),
            totalCents: Math.round(paymentAmount * 100),
            status: 'completed',
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid', reason: 'Retry capture — cash fallback' },
        },
      ]).catch(console.error)

      return NextResponse.json({ data: { success: true, paymentMethod: 'cash', amount: paymentAmount } })

    } else if (retryMode === 'manager_void') {
      // Requires manager permission
      const auth = await requireAnyPermission(employeeId, locationId, [PERMISSIONS.MGR_VOID_ORDERS])
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error || 'Manager permission required' }, { status: 403 })
      }

      // Void all authorized cards
      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          await client.voidSale(card.readerId, { recordNo: card.recordNo })
        } catch (err) {
          console.warn(`[Manager Void] Failed to void card ${card.cardLast4}:`, err)
        }
      }

      // Void all cards and the order
      await db.$transaction([
        db.orderCard.updateMany({
          where: { orderId, status: 'authorized' },
          data: { status: 'voided' },
        }),
        db.order.update({
          where: { id: orderId },
          data: {
            status: 'voided',
            tabStatus: 'closed',
            closedAt: now,
            captureDeclinedAt: null,
            lastCaptureError: null,
          },
        }),
      ])

      // Audit log
      await db.auditLog.create({
        data: {
          locationId,
          employeeId,
          action: 'manager_void_declined_tab',
          entityType: 'order',
          entityId: orderId,
          details: { reason: 'Manager voided declined capture tab' },
        },
      })

      dispatchOpenOrdersChanged(locationId, { trigger: 'voided' as any, orderId }, { async: true }).catch(() => {})
      if (order.tableId) dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

      // Event emission: manager voided the declined tab
      void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
        closedStatus: 'voided',
        reason: 'Manager voided declined capture tab',
      }).catch(console.error)

      return NextResponse.json({ data: { success: true, action: 'voided' } })
    }

    return NextResponse.json({ error: 'Invalid retryMode' }, { status: 400 })
  } catch (error) {
    console.error('[Retry Capture] Error:', error)
    return NextResponse.json({ error: 'Failed to retry capture' }, { status: 500 })
  }
})
