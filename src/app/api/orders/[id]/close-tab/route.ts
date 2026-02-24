import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchTabClosed } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { getLocationSettings } from '@/lib/location-cache'
import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'

// POST - Close tab by capturing against cards
// Supports: device tip, receipt tip (PrintBlankLine), or tip already included
//
// PAYMENT-SAFETY: Double-capture prevention
// The route checks order status and tabStatus before attempting capture. If the order
// is already 'paid' or tabStatus is 'closed', it returns early with the existing state.
// This prevents double-capture when two terminals close the same tab simultaneously.
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const {
      employeeId,
      tipMode = 'receipt', // 'device' | 'receipt' | 'included'
      tipAmount,           // Pre-set tip amount (for 'included' mode)
      orderCardId,         // Optional: charge a specific card (when multiple cards on tab)
      version,             // Optimistic concurrency control
    } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    // Get order with cards
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        items: {
          where: { deletedAt: null, status: 'active' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // PAYMENT-SAFETY: Double-capture prevention — if order is already paid/closed,
    // return success with existing state instead of attempting another capture.
    if (order.status === 'paid' || order.status === 'closed') {
      return NextResponse.json({
        data: {
          success: true,
          duplicate: true,
          message: 'Tab already closed',
          tabStatus: 'closed',
        },
      })
    }

    // Concurrency check: if client sent a version, verify it matches
    if (version != null && order.version !== version) {
      return NextResponse.json({
        error: 'Tab was modified on another terminal',
        conflict: true,
        currentVersion: order.version,
      }, { status: 409 })
    }

    if (order.cards.length === 0) {
      return NextResponse.json({ error: 'No authorized cards on this tab' }, { status: 400 })
    }

    const locationId = order.locationId

    // Load tip percentages from location settings
    const settings = await getLocationSettings(locationId)
    const locSettings = parseSettings(settings)
    const rawSuggestions = locSettings.tipBank?.tipGuide?.percentages ?? [15, 18, 20, 25]
    const tipSuggestions = rawSuggestions
      .map(Number)
      .filter(pct => Number.isFinite(pct) && pct > 0 && pct <= 100)
      .slice(0, 4)
    if (tipSuggestions.length === 0) tipSuggestions.push(15, 18, 20, 25)

    // Calculate purchase amount from order total
    const purchaseAmount = Number(order.total) - Number(order.tipTotal)
    let gratuityAmount = tipMode === 'included' && tipAmount != null ? Number(tipAmount) : undefined

    // Bottle service auto-gratuity: apply if no explicit tip was provided
    if (
      order.isBottleService &&
      order.bottleServiceTierId &&
      gratuityAmount == null &&
      tipMode !== 'device'
    ) {
      const tier = await db.bottleServiceTier.findUnique({
        where: { id: order.bottleServiceTierId },
        select: { autoGratuityPercent: true, minimumSpend: true },
      })

      if (tier && tier.autoGratuityPercent != null) {
        const autoGratPct = Number(tier.autoGratuityPercent)
        const minSpend = Number(tier.minimumSpend) || 0

        if (autoGratPct > 0 && (minSpend <= 0 || purchaseAmount >= minSpend)) {
          gratuityAmount = Math.round(purchaseAmount * (autoGratPct / 100) * 100) / 100
        }
      }
    }

    // If a specific card was requested, filter to just that card
    let cardsToTry = order.cards
    if (orderCardId) {
      cardsToTry = order.cards.filter(c => c.id === orderCardId)
      if (cardsToTry.length === 0) {
        return NextResponse.json({ error: 'Specified card not found or not authorized' }, { status: 400 })
      }
    }

    // Try capturing against default card first, then others
    let capturedCard = null
    let captureResult = null

    for (const card of cardsToTry) {
      try {
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)

        // If device tip mode, fire GetSuggestiveTip first
        if (tipMode === 'device') {
          try {
            const tipResponse = await client.getSuggestiveTip(card.readerId, tipSuggestions)
            if (tipResponse.gratuityAmount) {
              // Use device-selected tip
              const deviceTip = parseFloat(tipResponse.gratuityAmount) || 0
              const response = await client.preAuthCapture(card.readerId, {
                recordNo: card.recordNo,
                purchaseAmount,
                gratuityAmount: deviceTip,
              })
              captureResult = { response, tipAmount: deviceTip }
              capturedCard = card
              break
            }
          } catch (tipErr) {
            console.warn(`[Tab Close] Device tip prompt failed, falling back:`, tipErr)
          }
        }

        // Standard capture (receipt tip or included tip)
        const response = await client.preAuthCapture(card.readerId, {
          recordNo: card.recordNo,
          purchaseAmount,
          gratuityAmount,
        })

        captureResult = { response, tipAmount: gratuityAmount || 0 }
        capturedCard = card
        break
      } catch (err) {
        // PAYMENT-SAFETY: Capture may have succeeded on the processor but we didn't get
        // the response (timeout/network). The charge is ambiguous — the card may have been
        // debited without our DB reflecting it. Log for reconciliation.
        console.error('[PAYMENT-SAFETY] Ambiguous state', {
          orderId,
          flow: 'close-tab',
          reason: 'capture_error_or_timeout',
          datacapRecordNo: card.recordNo,
          cardLast4: card.cardLast4,
          attemptedAmount: purchaseAmount + (gratuityAmount || 0),
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })

        // PAYMENT-SAFETY: Attempt to void/release the pre-auth so the hold on the
        // customer's card doesn't linger for days. Fire-and-forget — best effort.
        void (async () => {
          try {
            const voidClient = await requireDatacapClient(locationId)
            await voidClient.voidSale(card.readerId, { recordNo: card.recordNo })
            console.info('[PAYMENT-SAFETY] Released pre-auth after capture failure', {
              orderId, cardRecordNo: card.recordNo, cardLast4: card.cardLast4,
            })
          } catch (voidErr) {
            console.error('[PAYMENT-SAFETY] CRITICAL: Failed to release auth after capture failure', {
              orderId,
              cardRecordNo: card.recordNo,
              cardLast4: card.cardLast4,
              captureError: err instanceof Error ? err.message : String(err),
              voidError: voidErr instanceof Error ? voidErr.message : String(voidErr),
            })
          }
        })()

        continue
      }
    }

    if (!capturedCard || !captureResult) {
      // Track the declined capture
      await db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'declined_capture',
          captureDeclinedAt: new Date(),
          captureRetryCount: { increment: 1 },
          lastCaptureError: 'All cards failed to capture',
        },
      })

      // Check if auto-walkout threshold reached
      const updatedOrder = await db.order.findUnique({
        where: { id: orderId },
        select: { captureRetryCount: true },
      })
      const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 5
      const autoWalkout = locSettings.barTabs?.autoFlagWalkoutAfterDeclines ?? false
      if (autoWalkout && updatedOrder && updatedOrder.captureRetryCount >= maxRetries) {
        await db.order.update({
          where: { id: orderId },
          data: { isWalkout: true, walkoutAt: new Date() },
        })
      }

      // Notify all terminals
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(() => {})

      return NextResponse.json({
        data: {
          success: false,
          error: 'All cards failed to capture',
          tabStatus: 'declined_capture',
          retryCount: updatedOrder?.captureRetryCount || 1,
          maxRetries,
        },
      })
    }

    const { response } = captureResult
    const approved = response.cmdStatus === 'Approved'
    const error = parseError(response)

    if (!approved) {
      // Track the declined capture
      await db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'declined_capture',
          captureDeclinedAt: new Date(),
          captureRetryCount: { increment: 1 },
          lastCaptureError: error?.text || 'Capture declined',
        },
      })

      // Check if auto-walkout threshold reached
      const updatedOrder = await db.order.findUnique({
        where: { id: orderId },
        select: { captureRetryCount: true },
      })
      const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 5
      const autoWalkout = locSettings.barTabs?.autoFlagWalkoutAfterDeclines ?? false
      if (autoWalkout && updatedOrder && updatedOrder.captureRetryCount >= maxRetries) {
        await db.order.update({
          where: { id: orderId },
          data: { isWalkout: true, walkoutAt: new Date() },
        })
      }

      // Notify all terminals
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(() => {})

      return NextResponse.json({
        data: {
          success: false,
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          error: error
            ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
            : { code: 'DECLINED', message: 'Capture declined', isRetryable: true },
          tabStatus: 'declined_capture',
          retryCount: updatedOrder?.captureRetryCount || 1,
          maxRetries,
        },
      })
    }

    // Update OrderCard + Order status atomically.
    // PAYMENT-SAFETY: The order transitions to 'paid' ONLY inside this transaction,
    // AFTER the Datacap capture response is confirmed as 'Approved'. Never optimistic.
    // Note: The capture's authCode is returned in the API response but NOT stored in OrderCard
    // (schema has no authCode field). The recordNo is the primary reconciliation token for
    // PreAuthCapture operations — it's stored in OrderCard.recordNo from the initial PreAuth.
    const now = new Date()
    await db.$transaction([
      db.orderCard.update({
        where: { id: capturedCard.id },
        data: {
          status: 'captured',
          capturedAmount: purchaseAmount + (captureResult.tipAmount || 0),
          capturedAt: now,
          tipAmount: captureResult.tipAmount || 0,
        },
      }),
      db.order.update({
        where: { id: orderId },
        data: {
          status: 'paid',
          tabStatus: 'closed',
          paidAt: now,
          closedAt: now,
          tipTotal: captureResult.tipAmount || Number(order.tipTotal),
          total: purchaseAmount + (captureResult.tipAmount || 0),
          version: { increment: 1 },
        },
      }),
      // Void any remaining authorized cards
      ...order.cards
        .filter((c) => c.id !== capturedCard!.id && c.status === 'authorized')
        .map((c) =>
          db.orderCard.update({
            where: { id: c.id },
            data: { status: 'voided' },
          })
        ),
    ])

    // Deduct inventory (food + liquor) — fire-and-forget to not block payment
    void deductInventoryForOrder(orderId, employeeId).catch(err => {
      console.error('Background inventory deduction failed (close-tab):', err)
    })

    // Allocate tips via the tip bank pipeline — fire-and-forget
    if ((captureResult.tipAmount || 0) > 0 && order.employeeId) {
      void allocateTipsForPayment({
        locationId,
        orderId,
        primaryEmployeeId: order.employeeId,
        createdPayments: [{
          id: capturedCard.id,
          paymentMethod: capturedCard.cardType || 'credit',
          tipAmount: captureResult.tipAmount || 0,
        }],
        totalTipsDollars: captureResult.tipAmount || 0,
        tipBankSettings: locSettings.tipBank,
      }).catch(err => {
        console.error('Background tip allocation failed (close-tab):', err)
      })
    }

    // Clean up temporary seats then dispatch floor plan update (chained so snapshot sees cleanup)
    void cleanupTemporarySeats(orderId)
      .then(() => dispatchFloorPlanUpdate(locationId, { async: true }))
      .catch(console.error)

    // Dispatch tab:updated for tab close (fire-and-forget)
    void dispatchTabUpdated(locationId, { orderId, status: 'closed' }).catch(() => {})

    // Dispatch mobile tab:closed for phone sync (fire-and-forget)
    dispatchTabClosed(locationId, {
      orderId,
      total: purchaseAmount + (captureResult.tipAmount || 0),
      tipAmount: captureResult.tipAmount || 0,
    })

    // Dispatch open orders changed so all terminals refresh (fire-and-forget)
    dispatchOpenOrdersChanged(locationId, { trigger: 'paid', orderId, tableId: order.tableId || undefined }, { async: true }).catch(() => {})

    return NextResponse.json({
      data: {
        success: true,
        captured: {
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          purchaseAmount,
          tipAmount: captureResult.tipAmount || 0,
          totalAmount: purchaseAmount + (captureResult.tipAmount || 0),
          authCode: response.authCode,
        },
        tipMode,
        // For receipt tip mode: bartender enters tip later via /api/datacap/adjust
        pendingTipAdjust: tipMode === 'receipt',
        recordNo: capturedCard.recordNo,
      },
    })
  } catch (error) {
    // PAYMENT-SAFETY: Unhandled error during tab close. The capture may or may not have
    // succeeded. Log for reconciliation. The order stays in its current status (not paid).
    console.error('[PAYMENT-SAFETY] Ambiguous state', {
      orderId: 'unknown', // orderId may not be available if params parsing failed
      flow: 'close-tab',
      reason: 'unhandled_error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })
    return NextResponse.json({ error: 'Failed to close tab' }, { status: 500 })
  }
})
