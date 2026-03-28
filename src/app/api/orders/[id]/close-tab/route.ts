import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchTabClosed, dispatchTabStatusUpdate, dispatchOrderClosed, dispatchEntertainmentStatusChanged, dispatchPaymentProcessed } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { getLocationSettings } from '@/lib/location-cache'
import { processNextDeduction } from '@/lib/deduction-processor'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { roundToCents } from '@/lib/pricing'
import {
  validateTabForClose,
  parseTipSuggestions,
  computePurchaseAmount,
  resolveCardsToCharge,
  resolveAutoGratuity,
  recordZeroTabResult,
  buildZeroTabResponse,
  recordCaptureFailure,
  recordCaptureSuccess,
} from '@/lib/domain/tab-close'
import type { ZeroTabReleaseResult, BottleServiceTier } from '@/lib/domain/tab-close'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { checkOrderClaim } from '@/lib/order-claim'
import { isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream, queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { OrderRepository, PaymentRepository } from '@/lib/repositories'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-close-tab')

// POST - Close tab by capturing against cards
// Supports: device tip, receipt tip (PrintBlankLine), or tip already included
//
// PAYMENT-SAFETY: Double-capture prevention
// The route checks order status and tabStatus before attempting capture. If the order
// is already 'paid' or tabStatus is 'closed', it returns early with the existing state.
// This prevents double-capture when two terminals close the same tab simultaneously.
//
// PERFORMANCE: Three-phase locking
// Phase 1: Short transaction with FOR UPDATE — validate + mark 'closing'
// Phase 2: Datacap API calls OUTSIDE any transaction (500-3000ms)
// Phase 3: Short transaction with FOR UPDATE — record capture result
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
      return err('Missing required field: employeeId')
    }

    // Permission check — closing a tab is a card payment operation
    const orderForAuth = await db.order.findUnique({ where: { id: orderId }, select: { locationId: true } })
    if (!orderForAuth) {
      return notFound('Order not found')
    }
    const auth = await requirePermission(employeeId, orderForAuth.locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Order claim check — block if another employee has an active claim
    const terminalId = request.headers.get('x-terminal-id')
    const claimBlock = await checkOrderClaim(db, orderId, employeeId, terminalId)
    if (claimBlock) {
      return NextResponse.json(
        { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
        { status: claimBlock.status }
      )
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Read + Validate (short transaction with FOR UPDATE)
    // Acquires the row lock briefly to atomically check status and mark the order
    // as 'closing' to prevent concurrent close-tab attempts. Releases quickly.
    // ═══════════════════════════════════════════════════════════════════════════
    const phase1Result = await db.$transaction(async (tx) => {
      return validateTabForClose(tx, { orderId, employeeId, tipMode, tipAmount, orderCardId, version })
    })

    // If Phase 1 validation failed, return the appropriate error response
    if (!phase1Result.valid) {
      // For the duplicate/already-closed case, return the extra data as the response body
      if (phase1Result.extra && phase1Result.extra.success != null) {
        return NextResponse.json({ data: phase1Result.extra }, { status: phase1Result.status })
      }
      // For other failures with extra context (tabStatus, conflict, etc.)
      if (phase1Result.extra) {
        return err(phase1Result.error, phase1Result.status)
      }
      return err(phase1Result.error, phase1Result.status)
    }

    const { order, versionBeforeClose } = phase1Result

    // ═══════════════════════════════════════════════════════════════════════════
    // BETWEEN PHASES: Compute values that don't need a lock
    // ═══════════════════════════════════════════════════════════════════════════
    const locationId = order.locationId

    // Load location settings
    const settings = await getLocationSettings(locationId)
    const locSettings = parseSettings(settings)

    // Parse tip percentages from location settings (pure)
    const tipSuggestions = parseTipSuggestions(locSettings)

    // Calculate purchase amount — applies dual pricing card surcharge if enabled (pure)
    const { purchaseAmount } = computePurchaseAmount(order, locSettings.dualPricing)
    const initialGratuity = tipMode === 'included' && tipAmount != null ? Number(tipAmount) : undefined

    // ═══════════════════════════════════════════════════════════════════════════
    // BUG 5: Zero-tab handling — release pre-auth instead of $0 capture
    // Datacap calls happen OUTSIDE any transaction lock.
    // C6 FIX: Track per-card release status. On partial failure, mark released cards
    // as 'released' and only leave failed cards as 'authorized'. Return 207 partial
    // success so the client knows which cards still need manual voiding. Never revert
    // the entire tab to OPEN when some cards are already released (prevents orphaned holds).
    // ═══════════════════════════════════════════════════════════════════════════
    if (purchaseAmount <= 0) {
      // Release all authorized cards via voidSale (per card, sequential — infrastructure)
      const releaseResults: ZeroTabReleaseResult[] = []
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

      // Short transaction to record the zero-tab result (orchestration)
      await db.$transaction(async (tx) => {
        await recordZeroTabResult(tx, orderId, releaseResults, locationId)
      })

      // C6 FIX: Log warning for partial failures so ops can investigate
      const failedCards = releaseResults.filter(r => !r.released)
      const anyReleased = releaseResults.some(r => r.released)
      if (failedCards.length > 0 && anyReleased) {
        console.warn('[Tab Close] Partial $0 tab release — some cards could not be released', {
          orderId,
          releasedCount: releaseResults.filter(r => r.released).length,
          failedCount: failedCards.length,
          failedCards: failedCards.map(f => ({ cardLast4: f.cardLast4, error: f.error })),
        })
      }

      // Build response from release results (pure)
      const zeroTabResp = buildZeroTabResponse(releaseResults)
      return NextResponse.json({ data: zeroTabResp.data }, { status: zeroTabResp.httpStatus })
    }

    // Resolve auto-gratuity (bottle service tier lookup stays in route — needs DB)
    let bottleServiceTier: BottleServiceTier | null = null
    if (order.isBottleService && order.bottleServiceTierId) {
      bottleServiceTier = await db.bottleServiceTier.findUnique({
        where: { id: order.bottleServiceTierId },
        select: { autoGratuityPercent: true, minimumSpend: true },
      })
    }

    // Resolve auto-gratuity (pure)
    const autoGratResult = resolveAutoGratuity({
      isBottleService: order.isBottleService,
      bottleServiceTier,
      guestCount: order.guestCount,
      purchaseAmount,
      tipMode,
      existingGratuity: initialGratuity,
      autoGratuitySettings: locSettings.autoGratuity,
    })
    const gratuityAmount = autoGratResult.gratuityAmount
    const isAutoGratuity = autoGratResult.isAutoGratuity

    if (isAutoGratuity && !order.isBottleService && locSettings.autoGratuity) {
      console.info(`[Tab Close] Auto-gratuity applied (${locSettings.autoGratuity.percent}% for party of ${order.guestCount})`, {
        orderId, guestCount: order.guestCount, gratuityAmount,
      })
    }

    // Resolve which card(s) to charge (pure)
    const cardResolution = resolveCardsToCharge(order.cards, orderCardId)
    if (!cardResolution.valid) {
      // Revert tabStatus from 'closing' so the tab can be retried
      await OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'open', version: { increment: 1 } })
      const errorPayload: Record<string, unknown> = { error: cardResolution.error }
      if (cardResolution.code) errorPayload.code = cardResolution.code
      if (cardResolution.cards) errorPayload.cards = cardResolution.cards
      return NextResponse.json(errorPayload, { status: 400 })
    }
    const cardsToTry = cardResolution.cards

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: External Datacap API calls (NO database lock held)
    // This is the slow part (500-3000ms). No other terminal is blocked.
    // ═══════════════════════════════════════════════════════════════════════════

    // PAYMENT-SAFETY: Create a durable pending-capture record BEFORE calling Datacap.
    // If Datacap capture succeeds but the Phase 3 DB write fails, this record remains
    // with status='pending' for manual reconciliation. Updated to 'completed' after Phase 3.
    const pendingCaptureId = crypto.randomUUID()
    const primaryCard = cardsToTry[0]
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "_pending_captures" ("id", "orderId", "locationId", "cardRecordNo", "cardLast4", "purchaseAmount", "tipAmount", "totalAmount", "status", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
         ON CONFLICT ("id") DO NOTHING`,
        pendingCaptureId,
        orderId,
        locationId,
        primaryCard.recordNo,
        primaryCard.cardLast4 || '',
        purchaseAmount,
        gratuityAmount || 0,
        purchaseAmount + (gratuityAmount || 0)
      )
    } catch (pcErr) {
      // Non-fatal: if the safety-net table doesn't exist yet or insert fails,
      // proceed with capture anyway — this is a safety net, not a gate.
      console.warn('[PAYMENT-SAFETY] Failed to insert pending capture record', {
        orderId, error: pcErr instanceof Error ? pcErr.message : String(pcErr),
      })
    }

    let capturedCard = null
    let captureResult = null

    for (const card of cardsToTry) {
      try {
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)

        // If device tip mode, fire GetSuggestiveTip first
        // H6 FIX: configurable timeout prevents tab stuck in "closing" forever if reader is unresponsive
        if (tipMode === 'device') {
          try {
            const tipTimeoutMs = (locSettings.payments.cfdTipTimeoutSeconds ?? 8) * 1000
            const tipAbort = AbortSignal.timeout(tipTimeoutMs)
            const tipPromise = client.getSuggestiveTip(card.readerId, tipSuggestions)
            // Race the tip prompt against the configured deadline
            const tipResponse = await Promise.race([
              tipPromise,
              new Promise<never>((_, reject) => {
                tipAbort.addEventListener('abort', () =>
                  reject(new Error(`Device tip prompt timed out after ${locSettings.payments.cfdTipTimeoutSeconds ?? 8}s`))
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
        return recordCaptureFailure(tx, orderId, 'All cards failed to capture', {
          maxCaptureRetries: locSettings.barTabs?.maxCaptureRetries,
          autoFlagWalkoutAfterDeclines: locSettings.barTabs?.autoFlagWalkoutAfterDeclines,
        }, locationId, employeeId)
      })

      // Notify all terminals
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))

      return ok({
          success: false,
          error: 'All cards failed to capture',
          tabStatus: 'declined_capture',
          retryCount: failResult.retryCount,
          maxRetries: failResult.maxRetries,
        })
    }

    // Check if capture was approved
    const { response } = captureResult
    const approved = response.cmdStatus === 'Approved'
    const error = parseError(response)

    if (!approved) {
      // Capture was declined — record in a short transaction
      const declineResult = await db.$transaction(async (tx) => {
        return recordCaptureFailure(tx, orderId, error?.text || 'Capture declined', {
          maxCaptureRetries: locSettings.barTabs?.maxCaptureRetries,
          autoFlagWalkoutAfterDeclines: locSettings.barTabs?.autoFlagWalkoutAfterDeclines,
        }, locationId, employeeId)
      })

      // Notify all terminals
      dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any, orderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))

      return ok({
          success: false,
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          error: error
            ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
            : { code: 'DECLINED', message: 'Capture declined', isRetryable: true },
          tabStatus: 'declined_capture',
          retryCount: declineResult.retryCount,
          maxRetries: declineResult.maxRetries,
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

    const createdPaymentId = await db.$transaction(async (tx) => {
      return recordCaptureSuccess(tx, {
        orderId,
        locationId,
        employeeId,
        sellingEmployeeId: order.employeeId,
        capturedCard,
        purchaseAmount,
        tipAmount: finalTipAmount,
        totalCaptured,
        authCode: response.authCode || null,
        cardType: capturedCard.cardType,
        allCards: order.cards,
        datacapResponse: response,
        now,
      })
    })

    // PAYMENT-SAFETY: Phase 3 DB write succeeded — mark the pending capture as completed.
    // Fire-and-forget: if this update fails, the record stays 'pending' which is safe
    // (ops can see it was captured via authCode + Datacap settlement report).
    void db.$executeRawUnsafe(
      `UPDATE "_pending_captures" SET "status" = 'completed', "completedAt" = NOW(), "authCode" = $2, "tipAmount" = $3, "totalAmount" = $4 WHERE "id" = $1`,
      pendingCaptureId,
      response.authCode || '',
      finalTipAmount,
      totalCaptured
    ).catch((pcErr) => {
      console.warn('[PAYMENT-SAFETY] Failed to mark pending capture as completed', {
        pendingCaptureId, orderId, error: pcErr instanceof Error ? pcErr.message : String(pcErr),
      })
    })

    // Queue outage writes if in outage mode (fail-hard — payment data loss is unacceptable)
    if (isInOutageMode()) {
      // Flag payment processed during outage for reconciliation
      void PaymentRepository.updatePayment(createdPaymentId, locationId, { needsReconciliation: true }).catch(err => log.warn({ err }, 'Background task failed'))

      try {
        const fullPayment = await PaymentRepository.getPaymentById(createdPaymentId, locationId)
        if (fullPayment) await queueIfOutageOrFail('Payment', locationId, createdPaymentId, 'INSERT', fullPayment as unknown as Record<string, unknown>)
        const fullOrder = await OrderRepository.getOrderById(orderId, locationId)
        if (fullOrder) await queueIfOutageOrFail('Order', locationId, orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>)
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return NextResponse.json(
            { error: 'Payment captured but outage queue is full — manual reconciliation required', critical: true },
            { status: 507 }
          )
        }
        throw err
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-TRANSACTION: Fire-and-forget side effects (infrastructure)
    // ═══════════════════════════════════════════════════════════════════════════

    // Release order claim after successful close (fire-and-forget)
    void db.$executeRawUnsafe(
      `UPDATE "Order" SET "claimedByEmployeeId" = NULL, "claimedByTerminalId" = NULL, "claimedAt" = NULL WHERE id = $1`,
      orderId
    ).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.close-tab'))
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
      // TODO: Add MenuItemRepository.findByCurrentOrder() and FloorPlanElementRepository once those repositories exist
      const entertainmentItems = await db.menuItem.findMany({
        where: { currentOrderId: orderId, itemType: 'timed_rental' },
        select: { id: true },
      })

      if (entertainmentItems.length > 0) {
        // Clear blockTimeStartedAt on order items so Android stops showing timers
        await db.orderItem.updateMany({
          where: { orderId, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
          data: { blockTimeStartedAt: null },
        })

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

        void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
        for (const item of entertainmentItems) {
          void dispatchEntertainmentStatusChanged(locationId, {
            itemId: item.id,
            entertainmentStatus: 'available',
            currentOrderId: null,
            expiresAt: null,
          }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.close-tab'))
          void notifyNextWaitlistEntry(locationId, item.id).catch(err => log.warn({ err }, 'waitlist notify failed'))
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
    void processNextDeduction().catch(err => log.warn({ err }, 'Background task failed'))
    if (finalTipAmount > 0 && order.employeeId) {
      const tipAllocParams = {
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
        kind: isAutoGratuity ? 'auto_gratuity' : 'tip',
      }
      try {
        await allocateTipsForPayment(tipAllocParams)
      } catch (tipErr) {
        // TIP DURABILITY: Tip was captured on the card but allocation to the ledger failed.
        // Create a durable recovery record so a retry job or manager can re-run allocation.
        console.error('[PAYMENT-SAFETY] Tip allocation failed (close-tab) — creating recovery record', {
          orderId, tipAmount: finalTipAmount, error: tipErr instanceof Error ? tipErr.message : String(tipErr),
        })
        try {
          await db.auditLog.create({
            data: {
              locationId,
              action: 'tip_allocation_failed',
              entityType: 'order',
              entityId: orderId,
              details: {
                flow: 'close-tab',
                tipAmount: finalTipAmount,
                primaryEmployeeId: order.employeeId,
                paymentId: capturedCard.id,
                paymentMethod: capturedCard.cardType || 'credit',
                kind: isAutoGratuity ? 'auto_gratuity' : 'tip',
                error: tipErr instanceof Error ? tipErr.message : String(tipErr),
                retryParams: JSON.parse(JSON.stringify(tipAllocParams)),
              },
            },
          })
        } catch (auditErr) {
          // Last resort: if even the audit log fails, log everything needed for manual recovery
          console.error('[PAYMENT-SAFETY] CRITICAL: Both tip allocation AND recovery record failed (close-tab)', {
            orderId, locationId, tipAmount: finalTipAmount, employeeId: order.employeeId,
            paymentId: capturedCard.id, paymentMethod: capturedCard.cardType || 'credit',
            kind: isAutoGratuity ? 'auto_gratuity' : 'tip',
            tipError: tipErr instanceof Error ? tipErr.message : String(tipErr),
            auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
          })
        }
      }
    }

    // Clean up temporary seats then dispatch floor plan update (chained so snapshot sees cleanup)
    void cleanupTemporarySeats(orderId)
      .then(() => dispatchFloorPlanUpdate(locationId, { async: true }))
      .catch(err => log.warn({ err }, 'Background task failed'))
    // Parallel socket emissions: all independent fire-and-forget dispatches run concurrently (-10ms)
    dispatchTabStatusUpdate(locationId, { orderId, status: 'closed' })
    dispatchTabClosed(locationId, { orderId, total: totalCaptured, tipAmount: finalTipAmount })
    void Promise.all([
      dispatchPaymentProcessed(locationId, {
        orderId,
        paymentId: createdPaymentId,
        status: 'completed',
        method: capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
        amount: purchaseAmount,
        tipAmount: finalTipAmount,
        totalAmount: totalCaptured,
        employeeId: order.employeeId || null,
        isClosed: true,
        cardBrand: capturedCard.cardType || null,
        cardLast4: capturedCard.cardLast4 || null,
      }),
      dispatchTabUpdated(locationId, { orderId, status: 'closed' }),
      dispatchOpenOrdersChanged(locationId, { trigger: 'paid', orderId, tableId: order.tableId || undefined }, { async: true }),
      dispatchOrderClosed(locationId, {
        orderId,
        status: 'paid',
        closedAt: now.toISOString(),
        closedByEmployeeId: employeeId,
        locationId,
      }, { async: true }),
    ]).catch(err => log.warn({ err }, 'Parallel socket dispatch failed in close-tab'))
    void (async () => {
      try {
        // Fetch the order's customer for loyalty check
        const orderForLoyalty = await db.order.findUnique({
          where: { id: orderId },
          select: {
            customerId: true, orderNumber: true, subtotal: true, total: true,
            customer: {
              select: { id: true, loyaltyPoints: true, lifetimePoints: true, loyaltyTierId: true, loyaltyProgramId: true, totalSpent: true, totalOrders: true },
            },
          },
        })
        if (!orderForLoyalty?.customer) return
        if (!locSettings.loyalty.enabled) return

        const customer = orderForLoyalty.customer
        let loyaltyEarningBase = locSettings.loyalty.earnOnSubtotal
          ? Number(orderForLoyalty.subtotal ?? 0)
          : Number(orderForLoyalty.total ?? 0)
        if (locSettings.loyalty.earnOnTips) {
          loyaltyEarningBase += finalTipAmount
        }

        // Check for tier multiplier
        let tierMultiplier = 1.0
        if (customer.loyaltyTierId) {
          try {
            const tierRows = await db.$queryRawUnsafe<Array<{ pointsMultiplier: unknown }>>(
              `SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = $1 AND "deletedAt" IS NULL`,
              customer.loyaltyTierId,
            )
            if (tierRows.length > 0) {
              tierMultiplier = Number(tierRows[0].pointsMultiplier) || 1.0
            }
          } catch { /* table may not exist yet */ }
        }

        if (loyaltyEarningBase < locSettings.loyalty.minimumEarnAmount) return

        const pointsEarned = Math.round(loyaltyEarningBase * locSettings.loyalty.pointsPerDollar * tierMultiplier)
        if (pointsEarned <= 0) return

        // Update customer: loyalty points + stats
        const currentTotalSpent = Number(customer.totalSpent ?? 0)
        const currentTotalOrders = Number(customer.totalOrders ?? 0)
        const orderTotal = Number(orderForLoyalty.total ?? 0)
        const newTotalSpent = currentTotalSpent + orderTotal
        const newTotalOrders = currentTotalOrders + 1
        const newAverageTicket = Math.round((newTotalSpent / newTotalOrders) * 100) / 100

        await db.customer.update({
          where: { id: customer.id },
          data: {
            loyaltyPoints: { increment: pointsEarned },
            lifetimePoints: { increment: pointsEarned },
            totalSpent: { increment: orderTotal },
            totalOrders: { increment: 1 },
            lastVisit: new Date(),
            averageTicket: newAverageTicket,
          },
        })

        // Create LoyaltyTransaction record
        const currentPoints = Number(customer.loyaltyPoints ?? 0)
        const currentLifetime = Number(customer.lifetimePoints ?? 0)
        const txnId = crypto.randomUUID()
        await db.$executeRawUnsafe(
          `INSERT INTO "LoyaltyTransaction" (
            "id", "customerId", "locationId", "orderId", "type", "points",
            "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
          ) VALUES ($1, $2, $3, $4, 'earn', $5, $6, $7, $8, $9, NOW())`,
          txnId, customer.id, locationId, orderId, pointsEarned,
          currentPoints, currentPoints + pointsEarned,
          `Earned ${pointsEarned} points on tab #${orderForLoyalty.orderNumber}${tierMultiplier > 1 ? ` (${tierMultiplier}x tier)` : ''}`,
          employeeId || null,
        )

        // Check tier promotion
        const newLifetime = currentLifetime + pointsEarned
        if (customer.loyaltyProgramId) {
          const tiers = await db.$queryRawUnsafe<Array<{ id: string; name: string; minimumPoints: number }>>(
            `SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
             WHERE "programId" = $1 AND "deletedAt" IS NULL ORDER BY "minimumPoints" DESC`,
            customer.loyaltyProgramId,
          )
          for (const tier of tiers) {
            if (newLifetime >= Number(tier.minimumPoints)) {
              if (tier.id !== customer.loyaltyTierId) {
                await db.$executeRawUnsafe(
                  `UPDATE "Customer" SET "loyaltyTierId" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
                  customer.id, tier.id,
                )
              }
              break
            }
          }
        }
      } catch (err) {
        console.error('[close-tab] Loyalty points earning failed:', err)
      }
    })()

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    return ok({
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
    return err('Failed to close tab', 500)
  }
})
