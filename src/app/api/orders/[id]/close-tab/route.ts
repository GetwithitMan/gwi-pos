import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchTabClosed, dispatchTabStatusUpdate, dispatchOrderClosed, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { getLocationSettings } from '@/lib/location-cache'
import { processNextDeduction } from '@/lib/deduction-processor'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { roundToCents, calculateCardPrice } from '@/lib/pricing'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { enableSyncReplication } from '@/lib/db-helpers'

// POST - Close tab by capturing against cards
// Supports: device tip, receipt tip (PrintBlankLine), or tip already included
//
// PAYMENT-SAFETY: Double-capture prevention
// The route checks order status and tabStatus before attempting capture. If the order
// is already 'paid' or tabStatus is 'closed', it returns early with the existing state.
// This prevents double-capture when two terminals close the same tab simultaneously.
//
// PERFORMANCE: Two-phase locking
// Phase 1: Short read-only fetch + validation (no FOR UPDATE lock)
// Phase 2: Datacap API calls OUTSIDE any transaction (500-3000ms)
// Phase 3: Short write transaction with FOR UPDATE to record results
// This prevents Datacap network latency from holding a row lock that blocks other terminals.
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Read + Validate (short transaction with FOR UPDATE)
    // Acquires the row lock briefly to atomically check status and mark the order
    // as 'closing' to prevent concurrent close-tab attempts. Releases quickly.
    // ═══════════════════════════════════════════════════════════════════════════
    const phase1Result = await db.$transaction(async (tx) => {
      // Acquire row lock — blocks concurrent close-tab requests for this order
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // Get order with cards
      const order = await tx.order.findFirst({
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
        return { earlyReturn: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }
      }

      // PAYMENT-SAFETY: Double-capture prevention — if order is already paid/closed,
      // return success with existing state instead of attempting another capture.
      if (order.status === 'paid' || order.status === 'closed') {
        return {
          earlyReturn: NextResponse.json({
            data: {
              success: true,
              duplicate: true,
              message: 'Tab already closed',
              tabStatus: 'closed',
            },
          }),
        }
      }

      // EDGE-7: Reject orders stuck in pending_auth — card authorization is incomplete
      if (order.tabStatus === 'pending_auth') {
        return {
          earlyReturn: NextResponse.json({
            error: 'Cannot close tab while card authorization is in progress. Please wait or retry opening the tab.',
            tabStatus: 'pending_auth',
          }, { status: 400 }),
        }
      }

      // H6 FIX: Recover zombie "closing" state — if tab has been stuck in 'closing' for >60s,
      // the previous close attempt likely hung (e.g., device tip timeout). Reset to 'open' and
      // allow this retry instead of permanently blocking the tab.
      if (order.tabStatus === 'closing') {
        const lastUpdated = order.updatedAt ? new Date(order.updatedAt).getTime() : 0
        const stuckThresholdMs = 60_000 // 60 seconds
        const isZombie = Date.now() - lastUpdated > stuckThresholdMs

        if (isZombie) {
          console.warn('[Tab Close] Recovering zombie closing state', {
            orderId,
            lastUpdated: order.updatedAt,
            stuckForMs: Date.now() - lastUpdated,
          })
          // Reset to open — fall through to normal close flow below
          await tx.order.update({
            where: { id: orderId },
            data: {
              tabStatus: 'open',
              version: { increment: 1 },
            },
          })
          // Re-read the order so downstream sees 'open' status
          order.tabStatus = 'open'
        } else {
          return {
            earlyReturn: NextResponse.json({
              error: 'Tab is already being closed by another terminal',
              tabStatus: 'closing',
            }, { status: 409 }),
          }
        }
      }

      // Concurrency check: if client sent a version, verify it matches
      if (version != null && order.version !== version) {
        return {
          earlyReturn: NextResponse.json({
            error: 'Tab was modified on another terminal',
            conflict: true,
            currentVersion: order.version,
          }, { status: 409 }),
        }
      }

      if (order.cards.length === 0) {
        return { earlyReturn: NextResponse.json({ error: 'No authorized cards on this tab' }, { status: 400 }) }
      }

      // Mark tab as 'closing' to prevent concurrent close-tab from another terminal.
      // This is the idempotency gate — only one request gets past this point.
      const versionBeforeClose = order.version
      await tx.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'closing',
          version: { increment: 1 },
        },
      })

      return { order, versionBeforeClose }
    })

    // If Phase 1 returned an early response, send it
    if ('earlyReturn' in phase1Result) {
      return phase1Result.earlyReturn as NextResponse
    }

    const { order, versionBeforeClose } = phase1Result

    // ═══════════════════════════════════════════════════════════════════════════
    // BETWEEN PHASES: Compute values that don't need a lock
    // ═══════════════════════════════════════════════════════════════════════════
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

    // Calculate purchase amount from order total.
    // Tab closes are always card payments (pre-auth capture), so if dual pricing is
    // enabled we must capture the card price, not the stored cash price.
    // Pricing model: stored order.total = cash price; card price = cash price × (1 + cashDiscountPercent/100)
    const cashBaseAmount = Number(order.total) - Number(order.tipTotal)
    const dualPricing = locSettings.dualPricing
    const purchaseAmount = dualPricing?.enabled
      ? calculateCardPrice(cashBaseAmount, dualPricing.cashDiscountPercent ?? 4.0)
      : cashBaseAmount
    let gratuityAmount = tipMode === 'included' && tipAmount != null ? Number(tipAmount) : undefined

    // ═══════════════════════════════════════════════════════════════════════════
    // BUG 5: Zero-tab handling — release pre-auth instead of $0 capture
    // Datacap calls happen OUTSIDE any transaction lock.
    // C6 FIX: Track per-card release status. On partial failure, mark released cards
    // as 'released' and only leave failed cards as 'authorized'. Return 207 partial
    // success so the client knows which cards still need manual voiding. Never revert
    // the entire tab to OPEN when some cards are already released (prevents orphaned holds).
    // ═══════════════════════════════════════════════════════════════════════════
    if (purchaseAmount <= 0) {
      // Release all authorized cards via voidSale (per card, sequential)
      const releaseResults: Array<{ cardId: string; cardLast4: string; released: boolean; error?: string }> = []
      for (const card of order.cards) {
        try {
          await validateReader(card.readerId, locationId)
          const client = await requireDatacapClient(locationId)
          const voidResp = await client.voidSale(card.readerId, { recordNo: card.recordNo })
          const released = voidResp.cmdStatus === 'Approved' || voidResp.cmdStatus === 'Success'
          releaseResults.push({ cardId: card.id, cardLast4: card.cardLast4, released })
        } catch (releaseErr) {
          releaseResults.push({
            cardId: card.id,
            cardLast4: card.cardLast4,
            released: false,
            error: releaseErr instanceof Error ? releaseErr.message : 'Release failed',
          })
        }
      }

      // Short transaction to record the zero-tab result
      const allReleased = releaseResults.every(r => r.released)
      const anyReleased = releaseResults.some(r => r.released)
      const failedCards = releaseResults.filter(r => !r.released)

      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`
        await enableSyncReplication(tx)

        // C6 FIX: Update each card individually based on its release result
        for (const result of releaseResults) {
          if (result.released) {
            await tx.orderCard.update({
              where: { id: result.cardId },
              data: { status: 'released' },
            })
          }
          // Failed cards stay as 'authorized' — they can be retried or manually voided
        }

        if (allReleased) {
          // All cards released — close the tab completely
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'voided',
              tabStatus: 'closed',
              paidAt: new Date(),
              closedAt: new Date(),
              version: { increment: 1 },
            },
          })
        } else if (anyReleased) {
          // C6 FIX: Partial release — do NOT revert to 'open' because released cards are
          // already gone. Move to 'open' so the tab can be retried, but the already-released
          // cards won't be re-fetched (query filters status: 'authorized' only).
          await tx.order.update({
            where: { id: orderId },
            data: {
              tabStatus: 'open',
              version: { increment: 1 },
            },
          })
        } else {
          // No cards released at all — safe to revert to open for full retry
          await tx.order.update({
            where: { id: orderId },
            data: {
              tabStatus: 'open',
              version: { increment: 1 },
            },
          })
        }
      })

      // C6 FIX: Log warning for partial failures so ops can investigate
      if (failedCards.length > 0 && anyReleased) {
        console.warn('[Tab Close] Partial $0 tab release — some cards could not be released', {
          orderId,
          releasedCount: releaseResults.filter(r => r.released).length,
          failedCount: failedCards.length,
          failedCards: failedCards.map(f => ({ cardLast4: f.cardLast4, error: f.error })),
        })
      }

      // C6 FIX: Return 207 Multi-Status for partial success so client knows exactly what happened
      const httpStatus = allReleased ? 200 : (anyReleased ? 207 : 400)
      return NextResponse.json({
        data: {
          success: allReleased,
          partialSuccess: anyReleased && !allReleased,
          zeroTab: true,
          message: allReleased
            ? 'Tab had no charges. Pre-auth released.'
            : anyReleased
              ? 'Tab had no charges. Some cards released, others failed — void remaining cards manually.'
              : 'Tab had no charges. All card releases failed — void the tab manually.',
          releaseResults,
        },
      }, { status: httpStatus })
    }

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
        // Revert tabStatus from 'closing' so the tab can be retried
        await db.order.update({
          where: { id: orderId },
          data: { tabStatus: 'open', version: { increment: 1 } },
        })
        return NextResponse.json({ error: 'Specified card not found or not authorized' }, { status: 400 })
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: External Datacap API calls (NO database lock held)
    // This is the slow part (500-3000ms). No other terminal is blocked.
    // ═══════════════════════════════════════════════════════════════════════════
    let capturedCard = null
    let captureResult = null

    for (const card of cardsToTry) {
      try {
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)

        // If device tip mode, fire GetSuggestiveTip first
        // H6 FIX: 30s timeout prevents tab stuck in "closing" forever if reader is unresponsive
        if (tipMode === 'device') {
          try {
            const tipAbort = AbortSignal.timeout(30_000)
            const tipPromise = client.getSuggestiveTip(card.readerId, tipSuggestions)
            // Race the tip prompt against a 30s deadline
            const tipResponse = await Promise.race([
              tipPromise,
              new Promise<never>((_, reject) => {
                tipAbort.addEventListener('abort', () =>
                  reject(new Error('Device tip prompt timed out after 30s'))
                )
              }),
            ])
            if (tipResponse.gratuityAmount) {
              // Use device-selected tip
              const deviceTip = roundToCents(parseFloat(tipResponse.gratuityAmount) || 0)
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
            // H6 FIX: On timeout or any device error, fall back to $0 tip and proceed with capture
            // instead of hanging forever. The bartender can adjust tip later via /api/datacap/adjust.
            console.warn(`[Tab Close] Device tip prompt failed or timed out, falling back to $0 tip:`, tipErr)
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: Record result (short transaction with FOR UPDATE)
    // Re-verify the order, then write the capture result atomically.
    // ═══════════════════════════════════════════════════════════════════════════

    // Handle capture failure (all cards failed)
    if (!capturedCard || !captureResult) {
      const failResult = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

        // Track the declined capture
        await tx.order.update({
          where: { id: orderId },
          data: {
            tabStatus: 'declined_capture',
            captureDeclinedAt: new Date(),
            captureRetryCount: { increment: 1 },
            lastCaptureError: 'All cards failed to capture',
          },
        })

        // Check if auto-walkout threshold reached
        const updatedOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: { captureRetryCount: true },
        })
        const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 5
        const autoWalkout = locSettings.barTabs?.autoFlagWalkoutAfterDeclines ?? false
        if (autoWalkout && updatedOrder && updatedOrder.captureRetryCount >= maxRetries) {
          await tx.order.update({
            where: { id: orderId },
            data: { isWalkout: true, walkoutAt: new Date() },
          })
        }

        return { retryCount: updatedOrder?.captureRetryCount || 1, maxRetries }
      })

      // Notify all terminals
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(() => {})

      return NextResponse.json({
        data: {
          success: false,
          error: 'All cards failed to capture',
          tabStatus: 'declined_capture',
          retryCount: failResult.retryCount,
          maxRetries: failResult.maxRetries,
        },
      })
    }

    // Check if capture was approved
    const { response } = captureResult
    const approved = response.cmdStatus === 'Approved'
    const error = parseError(response)

    if (!approved) {
      // Capture was declined — record in a short transaction
      const declineResult = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

        await tx.order.update({
          where: { id: orderId },
          data: {
            tabStatus: 'declined_capture',
            captureDeclinedAt: new Date(),
            captureRetryCount: { increment: 1 },
            lastCaptureError: error?.text || 'Capture declined',
          },
        })

        const updatedOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: { captureRetryCount: true },
        })
        const maxRetries = locSettings.barTabs?.maxCaptureRetries ?? 5
        const autoWalkout = locSettings.barTabs?.autoFlagWalkoutAfterDeclines ?? false
        if (autoWalkout && updatedOrder && updatedOrder.captureRetryCount >= maxRetries) {
          await tx.order.update({
            where: { id: orderId },
            data: { isWalkout: true, walkoutAt: new Date() },
          })
        }

        return { retryCount: updatedOrder?.captureRetryCount || 1, maxRetries }
      })

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
          retryCount: declineResult.retryCount,
          maxRetries: declineResult.maxRetries,
        },
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Capture APPROVED — record the payment atomically
    // PAYMENT-SAFETY: The Datacap capture succeeded. We MUST record it in the DB.
    // If this transaction fails, the capture result is logged above for reconciliation.
    // ═══════════════════════════════════════════════════════════════════════════
    const now = new Date()
    const finalTipAmount = captureResult.tipAmount ?? 0
    const totalCaptured = purchaseAmount + finalTipAmount

    // Log the capture result BEFORE the DB write, so it's recoverable even if Phase 3 fails
    console.info('[PAYMENT-SAFETY] Datacap capture approved, recording in DB', {
      orderId,
      flow: 'close-tab',
      cardLast4: capturedCard.cardLast4,
      recordNo: capturedCard.recordNo,
      authCode: response.authCode,
      purchaseAmount,
      tipAmount: finalTipAmount,
      totalCaptured,
      timestamp: now.toISOString(),
    })

    await db.$transaction(async (tx) => {
      // Acquire row lock for the write phase
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // PAYMENT-SAFETY: Synchronous replication for tab capture durability.
      // Guarantees the standby has applied this transaction's WAL before commit returns.
      // Prevents payment loss during HA failover (card captured but DB record lost).
      await enableSyncReplication(tx)

      // Re-verify order hasn't been closed by another path while we were calling Datacap.
      // The 'closing' status we set in Phase 1 should still be there.
      const currentOrder = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { status: true, tabStatus: true },
      })

      if (!currentOrder) {
        throw new Error('Order disappeared between Phase 1 and Phase 3')
      }

      // If order was already paid/closed (shouldn't happen due to 'closing' guard, but safety net)
      if (currentOrder.status === 'paid' || currentOrder.status === 'closed') {
        // Capture already recorded by another path — the Datacap charge happened but
        // someone else closed the tab. Log for reconciliation (possible double-capture).
        console.error('[PAYMENT-SAFETY] Order already closed when recording capture', {
          orderId,
          currentStatus: currentOrder.status,
          capturedAmount: totalCaptured,
          authCode: response.authCode,
          recordNo: capturedCard.recordNo,
        })
        throw new Error('Order was already closed — capture recorded for reconciliation')
      }

      // Update OrderCard + Order status + Payment record atomically.
      // PAYMENT-SAFETY: The order transitions to 'paid' ONLY inside this transaction,
      // AFTER the Datacap capture response is confirmed as 'Approved'. Never optimistic.
      // BUG #455 FIX: Create a Payment record so close-tab payments appear in reports/reconciliation.
      // BUG #456 FIX: Use explicit conditional for tipTotal — 0 is a valid tip amount, not falsy.
      await tx.orderCard.update({
        where: { id: capturedCard.id },
        data: {
          status: 'captured',
          capturedAmount: totalCaptured,
          capturedAt: now,
          tipAmount: finalTipAmount,
        },
      })
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'paid',
          tabStatus: 'closed',
          paidAt: now,
          closedAt: now,
          tipTotal: finalTipAmount,
          total: totalCaptured,
          version: { increment: 1 },
        },
      })
      // BUG #455: Create Payment record for close-tab capture
      // Use order.employeeId (the selling employee) for sale credit, not the
      // request body's employeeId (the person who physically closed the tab).
      await tx.payment.create({
        data: {
          locationId,
          orderId,
          employeeId: order.employeeId || employeeId,
          amount: purchaseAmount,
          tipAmount: finalTipAmount,
          totalAmount: totalCaptured,
          paymentMethod: capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
          cardBrand: capturedCard.cardType || 'unknown',
          cardLast4: capturedCard.cardLast4,
          authCode: response.authCode || null,
          datacapRecordNo: capturedCard.recordNo,
          entryMethod: 'Chip', // Tab was opened with card present
          status: 'completed',
        },
      })
      // Void any remaining authorized cards
      for (const c of order.cards.filter((c) => c.id !== capturedCard!.id && c.status === 'authorized')) {
        await tx.orderCard.update({
          where: { id: c.id },
          data: { status: 'voided' },
        })
      }
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-TRANSACTION: Fire-and-forget side effects (unchanged from original)
    // ═══════════════════════════════════════════════════════════════════════════

    // Emit order events for tab close (fire-and-forget)
    void emitOrderEvent(locationId, orderId, 'TAB_CLOSED', {
      employeeId,
      tipCents: Math.round(finalTipAmount * 100),
      adjustedAmountCents: Math.round(totalCaptured * 100),
    })
    void emitOrderEvent(locationId, orderId, 'PAYMENT_APPLIED', {
      paymentId: capturedCard.id,
      method: capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
      amountCents: Math.round(purchaseAmount * 100),
      tipCents: Math.round(finalTipAmount * 100),
      totalCents: Math.round(totalCaptured * 100),
      cardBrand: capturedCard.cardType || null,
      cardLast4: capturedCard.cardLast4 || null,
      status: 'approved',
    })
    void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
      closedStatus: 'paid',
    })

    // Clean up entertainment items after tab close
    try {
      const entertainmentItems = await db.menuItem.findMany({
        where: { currentOrderId: orderId, itemType: 'timed_rental' },
        select: { id: true },
      })

      if (entertainmentItems.length > 0) {
        await db.menuItem.updateMany({
          where: { currentOrderId: orderId, itemType: 'timed_rental' },
          data: {
            entertainmentStatus: 'available',
            currentOrderId: null,
            currentOrderItemId: null,
          },
        })

        for (const item of entertainmentItems) {
          await db.floorPlanElement.updateMany({
            where: { linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
            data: {
              status: 'available',
              currentOrderId: null,
              sessionStartedAt: null,
              sessionExpiresAt: null,
            },
          })
        }

        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
        for (const item of entertainmentItems) {
          void dispatchEntertainmentStatusChanged(locationId, {
            itemId: item.id,
            entertainmentStatus: 'available',
            currentOrderId: null,
            expiresAt: null,
          }, { async: true }).catch(() => {})
        }
      }
    } catch (cleanupErr) {
      console.error('[Close Tab] Failed to reset entertainment items:', cleanupErr)
    }

    // Deduct inventory via PendingDeduction outbox (retryable, with exponential backoff)
    await db.pendingDeduction.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        locationId: locationId,
        status: 'pending',
        attempts: 0,
        maxAttempts: 5,
      },
      update: {}
    })
    void processNextDeduction().catch(console.error)

    // Allocate tips via the tip bank pipeline — fire-and-forget
    if (finalTipAmount > 0 && order.employeeId) {
      void allocateTipsForPayment({
        locationId,
        orderId,
        primaryEmployeeId: order.employeeId,
        createdPayments: [{
          id: capturedCard.id,
          paymentMethod: capturedCard.cardType || 'credit',
          tipAmount: finalTipAmount,
        }],
        totalTipsDollars: finalTipAmount,
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

    // Dispatch mobile tab:status-update for phone sync (fire-and-forget)
    dispatchTabStatusUpdate(locationId, { orderId, status: 'closed' })

    // Dispatch mobile tab:closed for phone sync (fire-and-forget)
    dispatchTabClosed(locationId, {
      orderId,
      total: totalCaptured,
      tipAmount: finalTipAmount,
    })

    // Dispatch open orders changed so all terminals refresh (fire-and-forget)
    dispatchOpenOrdersChanged(locationId, { trigger: 'paid', orderId, tableId: order.tableId || undefined }, { async: true }).catch(() => {})

    // Dispatch order:closed for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderClosed(locationId, {
      orderId,
      status: 'paid',
      closedAt: now.toISOString(),
      closedByEmployeeId: employeeId,
      locationId,
    }, { async: true }).catch(() => {})

    return NextResponse.json({
      data: {
        success: true,
        captured: {
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          purchaseAmount,
          tipAmount: finalTipAmount,
          totalAmount: totalCaptured,
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
