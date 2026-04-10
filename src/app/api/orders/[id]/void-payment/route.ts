import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { dispatchPaymentProcessed, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate, dispatchOpenOrdersChanged, dispatchOrderClosed, dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { getPayApiClient, isPayApiSuccess } from '@/lib/datacap/payapi-client'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { restoreInventoryForOrder } from '@/lib/inventory/void-waste'
import { enableSyncReplication } from '@/lib/db-helpers'
import { dispatchAlert } from '@/lib/alert-service'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream, queueIfOutageOrFail } from '@/lib/sync/outage-safe-write'
import { getRequestLocationId } from '@/lib/request-context'
import { validateManagerReauthFromHeaders, validateCellularOrderAccess, CellularAuthError } from '@/lib/cellular-validation'
import { validateMutationApproval } from '@/lib/approval-tokens'
import { isClosed } from '@/lib/domain/order-status'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-void-payment')

class VoidValidationError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Voids a payment — handles both Datacap (card) and DB in a single atomic flow.
 *
 * For card payments:
 *   1. Calls Datacap voidSale to reverse the charge at the processor
 *   2. If Datacap succeeds, updates the DB
 *   3. If Datacap fails, returns error without modifying DB
 *   4. If Datacap succeeds but DB fails, logs a CRITICAL safety warning
 *
 * For cash payments:
 *   Skips Datacap and directly updates the DB.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { paymentId, reason, notes, managerId, readerId, managerPinHash, approvalToken } = body as {
      paymentId?: string; reason?: string; notes?: string; managerId?: string; readerId?: string; managerPinHash?: string; approvalToken?: string
    }

    // Validate inputs
    if (!paymentId || !reason || !managerId) {
      return err('Missing required fields')
    }

    // Validate mutation-bound approval token (if present)
    const tokenCheck = validateMutationApproval({ approvalToken, approvedById: managerId, routeName: 'void-payment' })
    if (!tokenCheck.valid) {
      return err(tokenCheck.error, tokenCheck.status)
    }

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularVoidPayment = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularVoidPayment ? 'cloud' : 'local'

    // Cellular terminal: require manager PIN re-authentication for void
    try {
      await validateManagerReauthFromHeaders(request, managerId, managerPinHash, db)
    } catch (caughtErr) {
      if (caughtErr instanceof CellularAuthError) {
        return err(caughtErr.message, caughtErr.status)
      }
      throw caughtErr
    }

    // Cellular ownership gating — block void on locally-owned orders
    const isCellularVoid = request.headers.get('x-cellular-authenticated') === '1'
    if (isCellularVoid) {
      try {
        await validateCellularOrderAccess(true, orderId, 'mutate', db)
      } catch (caughtErr) {
        if (err instanceof CellularAuthError) {
          return err(err.message, err.status)
        }
        throw err
      }
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let voidLocationId = getRequestLocationId()
    if (!voidLocationId) {
      const orderCheck = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })
      if (!orderCheck) {
        return notFound('Order not found')
      }
      voidLocationId = orderCheck.locationId
    }

    // Verify manager has permission scoped to order's location
    const authResult = await requirePermission(managerId, voidLocationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!authResult.authorized) {
      return err(authResult.error, authResult.status ?? 403)
    }

    // PAY-P2-2: Advisory lock on orderId to coordinate with refund-payment.
    // Uses the same key derivation as refund-payment so void and refund block each other.
    // Session-level lock is intentional: the lock spans external Datacap I/O across
    // multiple DB transactions, so xact_lock (which auto-releases on commit) won't work.
    const voidLockKey = parseInt(orderId.replace(/-/g, '').slice(0, 12), 16)
    // Defensive cleanup: release any stale lock on this key from a prior crashed request
    // that happened to use this same pooled connection. Safe because Prisma serializes
    // requests per connection, so no other in-flight request can hold this lock here.
    await db.$queryRaw`SELECT pg_advisory_unlock(${voidLockKey}::bigint)`.catch(() => {})
    const [{ acquired: voidLockAcquired }] = await db.$queryRaw<[{ acquired: boolean }]>`
      SELECT pg_try_advisory_lock(${voidLockKey}::bigint) as acquired
    `
    if (!voidLockAcquired) {
      return err('Another void or refund is already in progress for this order', 409)
    }

    try {
    // Phase 1: Read order + validate under FOR UPDATE lock on Order row.
    // This contends with pay/route.ts which also holds FOR UPDATE on Order.
    const lockedRead = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      const order = await OrderRepository.getOrderByIdWithInclude(orderId, voidLocationId, {
        payments: {
          where: { deletedAt: null },
        },
      }, tx)

      if (!order) {
        return { error: 'Order not found', status: 404 } as const
      }

      if (order.status === 'voided' || order.status === 'cancelled') {
        return { error: `Cannot void payment on ${order.status} order`, status: 400 } as const
      }

      const payment = order.payments.find((p) => p.id === paymentId)
      if (!payment) {
        return { error: 'Payment not found', status: 404 } as const
      }

      if (payment.status === 'voided') {
        return { error: 'Payment is already voided', status: 400 } as const
      }

      if (payment.status === 'refunded') {
        return { error: 'Cannot void a fully refunded payment', status: 400 } as const
      }

      if (payment.status === 'declined' || payment.status === 'failed') {
        return { error: `Cannot void a ${payment.status} payment`, status: 400 } as const
      }

      return { order, payment }
    }, { timeout: 15000 })

    if ('error' in lockedRead) {
      return err(lockedRead.error!, lockedRead.status)
    }

    const { order, payment } = lockedRead

    // Step 1: If card payment, void at Datacap first (outside DB transaction)
    const isCardPayment = payment.paymentMethod === 'card' || payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'
    let voidActionId: string | null = null
    let safVoidAttempted = false
    if (isCardPayment) {
      const recordNo = payment.datacapRecordNo

      if (!recordNo) {
        return err('Cannot void card payment: missing transaction record number. Void manually via Datacap portal.')
      }

      const effectiveReaderId = readerId || payment.paymentReaderId

      if (!effectiveReaderId) {
        return err('Cannot void card payment: no payment reader available. Void manually via Datacap portal.')
      }

      // SAF1: If the payment is still in the SAF queue (not yet forwarded to processor),
      // void it on the reader to remove from the SAF queue. The regular voidSale call
      // handles this — Datacap's VoidSaleByRecordNo works for both SAF-queued and
      // online-settled transactions.
      const isSafPending = (payment as any).safStatus === 'APPROVED_SAF_PENDING_UPLOAD'
      if (isSafPending) {
        safVoidAttempted = true
        voidActionId = `saf-void-${paymentId}-${Date.now()}`
        console.log(
          `[PROCESSOR-ACTION] PENDING: action=${voidActionId}, type=saf-void, ` +
          `orderId=${orderId}, paymentId=${paymentId}, recordNo=${recordNo}, ` +
          `amount=${Number(payment.totalAmount)}, readerId=${effectiveReaderId}, ` +
          `safStatus=APPROVED_SAF_PENDING_UPLOAD`
        )

        try {
          const client = await requireDatacapClient(order.locationId)
          const datacapResponse = await client.voidSale(effectiveReaderId, { recordNo })
          const datacapError = parseError(datacapResponse)

          if (datacapResponse.cmdStatus === 'Approved' && !datacapError) {
            console.log(`[PROCESSOR-ACTION] APPROVED: action=${voidActionId}, type=saf-void — removed from SAF queue`)
          } else {
            // SAF void failed at the reader (reader offline, or transaction already forwarded).
            // Log warning but proceed with DB void — better to mark as voided in DB than leave
            // it in a pending state. If the SAF forward runs later, it will encounter a mismatch
            // (voided in DB but present on reader) which is safer than keeping the charge active.
            console.warn(
              `[PROCESSOR-ACTION] SAF-VOID-FAILED: action=${voidActionId}, ` +
              `response=${datacapError?.text || datacapResponse.textResponse || 'Unknown'}. ` +
              `Proceeding with DB void — SAF forward may need manual reconciliation.`
            )
          }
        } catch (datacapErr) {
          // Reader is unreachable — log error but still proceed with DB void.
          // The SAF transaction stays on the reader; when SAF forward runs,
          // reconciliation will flag the mismatch.
          const msg = datacapErr instanceof Error ? datacapErr.message : 'SAF void request failed'
          console.error(
            `[PROCESSOR-ACTION] SAF-VOID-ERROR: action=${voidActionId}, error=${msg}. ` +
            `Proceeding with DB void — SAF forward may need manual reconciliation.`
          )
        }
      } else {
        // Regular (non-SAF) card void — must succeed at Datacap before DB update
        voidActionId = `void-${paymentId}-${Date.now()}`
        console.log(
          `[PROCESSOR-ACTION] PENDING: action=${voidActionId}, type=void, ` +
          `orderId=${orderId}, paymentId=${paymentId}, recordNo=${recordNo}, ` +
          `amount=${Number(payment.totalAmount)}, readerId=${effectiveReaderId}`
        )

        try {
          const client = await requireDatacapClient(order.locationId)
          const datacapResponse = await client.voidSale(effectiveReaderId, { recordNo })
          const datacapError = parseError(datacapResponse)

          if (datacapResponse.cmdStatus !== 'Approved' || datacapError) {
            console.log(
              `[PROCESSOR-ACTION] DECLINED: action=${voidActionId}, ` +
              `response=${datacapError?.text || datacapResponse.textResponse || 'Unknown'}`
            )
            return err(`Datacap void failed: ${datacapError?.text || datacapResponse.textResponse || 'Unknown error'}. DB not modified.`, 502)
          }

          console.log(`[PROCESSOR-ACTION] APPROVED: action=${voidActionId}, type=void`)
        } catch (datacapErr) {
          const msg = datacapErr instanceof Error ? datacapErr.message : 'Datacap void request failed'
          console.error(`[PROCESSOR-ACTION] ERROR: action=${voidActionId}, error=${msg}`)
          return err(`Datacap void failed: ${msg}. DB not modified.`, 502)
        }
      }
    }

    // Step 1b: ACH void via PayAPI (same-day only)
    const isAchPayment = payment.paymentMethod === 'ach'
    if (isAchPayment && payment.datacapRefNumber) {
      voidActionId = `ach-void-${paymentId}-${Date.now()}`
      console.log(
        `[PROCESSOR-ACTION] PENDING: action=${voidActionId}, type=ach-void, ` +
        `orderId=${orderId}, paymentId=${paymentId}, refNo=${payment.datacapRefNumber}, ` +
        `amount=${Number(payment.totalAmount)}`
      )

      try {
        // ACH void requires original token + customer name.
        // We don't store the Datacap token on the Payment record (it's in the ACH response only),
        // so we pass the RefNo and minimal customer info. Datacap resolves from the original txn.
        const achResult = await getPayApiClient().achVoid({
          refNo: payment.datacapRefNumber,
          token: '', // Datacap resolves token from RefNo
          custFirstName: 'Void',
          custLastName: 'Customer',
        })

        if (!isPayApiSuccess(achResult.status)) {
          console.log(
            `[PROCESSOR-ACTION] DECLINED: action=${voidActionId}, ` +
            `response=${achResult.message || 'Unknown'}`
          )
          return err(`ACH void failed: ${achResult.message || 'Unknown error'}. ACH voids must be same-day.`, 422)
        }

        console.log(`[PROCESSOR-ACTION] APPROVED: action=${voidActionId}, type=ach-void, refNo=${achResult.refNo ?? 'none'}`)
      } catch (achErr) {
        const msg = achErr instanceof Error ? achErr.message : 'ACH void request failed'
        console.error(`[PROCESSOR-ACTION] ERROR: action=${voidActionId}, error=${msg}`)
        return err(`ACH void failed: ${msg}. ACH voids must be same-day.`, 502)
      }
    }

    // Step 2: Datacap succeeded (or cash/ACH) — update DB
    const activePayments = order.payments.filter(
      (p) => p.id !== paymentId && p.status !== 'voided'
    )

    let newOrderStatus = order.status
    if (activePayments.length === 0) {
      newOrderStatus = 'voided'
    }

    let voidedPayment
    let recalculatedTipTotal = Number(order.tipTotal)
    try {
      voidedPayment = await db.$transaction(async (tx) => {
        // Acquire row locks on Order + Payment + synchronous replication for void durability
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
        await enableSyncReplication(tx)

        // Re-check payment status inside lock (may have changed since Phase 1)
        const freshPayment = await PaymentRepository.getPaymentById(paymentId, order.locationId, tx)
        if (freshPayment?.status === 'voided') {
          throw new VoidValidationError('Payment is already voided', 400)
        }

        // 1. Update payment to voided
        // SAF1: If this was an SAF-queued payment, also update safStatus to reflect the void
        const voidUpdateData: Record<string, unknown> = {
          status: 'voided',
          voidedAt: new Date(),
          voidedBy: managerId,
          voidReason: reason,
          lastMutatedBy: mutationOrigin,
        }
        if (safVoidAttempted) {
          voidUpdateData.safStatus = 'VOIDED'
        }
        await PaymentRepository.updatePayment(paymentId, order.locationId, voidUpdateData, tx)
        // Read back for return value (updatePayment returns count, not record)
        const updated = await PaymentRepository.getPaymentByIdOrThrow(paymentId, order.locationId, tx)

        // 2. Update order status
        await OrderRepository.updateOrder(orderId, order.locationId, {
          status: newOrderStatus,
          lastMutatedBy: mutationOrigin,
        }, tx)

        // 2b. Recalculate tipTotal from remaining non-voided payments
        const remainingPayments = await tx.payment.findMany({
          where: { orderId, status: 'completed', deletedAt: null },
          select: { tipAmount: true },
        })
        const newTipTotal = remainingPayments.reduce((sum, p) => sum + Number(p.tipAmount || 0), 0)
        recalculatedTipTotal = newTipTotal

        await OrderRepository.updateOrder(orderId, order.locationId, {
          tipTotal: newTipTotal,
          lastMutatedBy: mutationOrigin,
        }, tx)

        // 3. Create audit log
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: managerId,
            action: 'payment_voided',
            entityType: 'payment',
            entityId: paymentId,
            details: {
              orderId,
              orderNumber: order.orderNumber,
              paymentId,
              amount: Number(payment.amount),
              tipAmount: Number(payment.tipAmount),
              totalAmount: Number(payment.totalAmount),
              paymentMethod: payment.paymentMethod,
              reason,
              notes: notes || null,
              oldOrderStatus: order.status,
              newOrderStatus,
            },
            ipAddress: request.headers.get('x-forwarded-for'),
            userAgent: request.headers.get('user-agent'),
          },
        })

        // Outage queue writes INSIDE the transaction for atomicity
        if (isInOutageMode()) {
          const fullPayment = await tx.payment.findUnique({ where: { id: paymentId } })
          if (fullPayment) await queueIfOutageOrFail('Payment', order.locationId, paymentId, 'UPDATE', fullPayment as unknown as Record<string, unknown>, tx)
          const fullOrder = await tx.order.findUnique({ where: { id: orderId } })
          if (fullOrder) await queueIfOutageOrFail('Order', order.locationId, orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, tx)
        }

        return updated
      })
    } catch (dbError) {
      if (dbError instanceof VoidValidationError) {
        return err(dbError.message, dbError.statusCode)
      }
      // CRITICAL: Datacap voided but DB update failed
      if (isCardPayment) {
        const recordNo = payment.datacapRecordNo
        const criticalMsg =
          `[PAYMENT-SAFETY] CRITICAL: Datacap voided but DB update failed. ` +
          `actionId=${voidActionId}, orderId=${orderId}, paymentId=${paymentId}, recordNo=${recordNo}, ` +
          `amount=${Number(payment.totalAmount)}, ` +
          `method=${payment.paymentMethod}, reason=${reason}. ` +
          `Reconcile manually via Datacap portal.`
        console.error(criticalMsg, dbError)

        // Report to Sentry if available
        try {
          const Sentry = await import('@sentry/nextjs')
          Sentry.captureException(dbError, {
            tags: { handler: 'void-payment-db-failure', paymentId, orderId },
            extra: { recordNo, amount: Number(payment.totalAmount), method: payment.paymentMethod },
          })
        } catch {
          // Sentry not available — already logged above
        }

        // Bug 7: Still attempt tip chargeback even when DB update failed — the Datacap
        // void succeeded so the customer won't be charged. Best effort.
        if (Number(payment.tipAmount) > 0) {
          void handleTipChargeback({
            locationId: order.locationId,
            paymentId,
            memo: `Payment voided (DB failure path): ${reason}`,
          }).catch(err => {
            console.error(
              `[PAYMENT-SAFETY] CRITICAL: Tip chargeback also failed after DB failure. ` +
              `Manual reconciliation needed. paymentId=${paymentId}`,
              err
            )
          })
        }

        // Do NOT re-throw — return error response so the client can warn the manager
        return NextResponse.json(
          {
            error: `CRITICAL: Card voided at processor but database update failed. Record number: ${recordNo}. Manual reconciliation required.`,
            critical: true,
            recordNo,
            paymentId,
          },
          { status: 500 }
        )
      }
      throw dbError
    }

    // Flag void processed during outage for reconciliation (fire-and-forget)
    if (isInOutageMode()) {
      void PaymentRepository.updatePayment(paymentId, order.locationId, {
        needsReconciliation: true,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Emit order event for voided payment (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'PAYMENT_VOIDED', {
      paymentId: payment.id,
      reason: reason || null,
      employeeId: managerId || null,
    })

    // Dispatch socket events for voided payment (fire-and-forget)
    void dispatchPaymentProcessed(order.locationId, {
      orderId,
      paymentId,
      status: 'voided',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-payment'))
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: recalculatedTipTotal,
      discountTotal: Number(order.discountTotal),
      total: Number(order.total),
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.void-payment'))
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'payment_updated', orderId }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    if (newOrderStatus === 'voided') {
      void dispatchOrderClosed(order.locationId, {
        orderId,
        status: 'voided',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: managerId,
        locationId: order.locationId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Reverse tip allocations for this voided payment (fire-and-forget)
    // The chargeback policy (BUSINESS_ABSORBS vs EMPLOYEE_CHARGEBACK) is
    // determined by location settings automatically.
    if (Number(payment.tipAmount) > 0) {
      handleTipChargeback({
        locationId: order.locationId,
        paymentId,
        memo: `Payment voided: ${reason}`,
      }).catch((err) => {
        // If no TipTransaction exists for this payment (e.g., cash payment with no
        // tip allocation, or legacy payment), this is expected. Log but don't fail.
        console.warn('[void-payment] Tip chargeback skipped or failed:', err.message)
      })
    }

    // Release the table when the full order is voided (C12: prevent zombie tables)
    if (newOrderStatus === 'voided' && order.tableId) {
      await db.table.update({ where: { id: order.tableId }, data: { status: 'available' } })
      void dispatchFloorPlanUpdate(order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Restore inventory deductions when ALL payments on the order are voided.
    // The original sale deductions from deductInventoryForOrder() are reversed
    // so stock levels reflect the fully-reversed sale.
    // Inventory restore is best-effort — payment void takes priority
    if (newOrderStatus === 'voided') {
      try {
        await restoreInventoryForOrder(orderId, order.locationId)
      } catch (caughtErr) {
        console.error('[VOID] Inventory restoration failed — manual stock adjustment may be needed:', err)
      }
    }

    // Parent order cleanup: if this is a split child and now voided, check if ALL siblings are terminal.
    // If so, close the parent order too (same pattern as comp-void route lines 594-623).
    if (newOrderStatus === 'voided' && order.parentOrderId) {
      void (async () => {
        try {
          const siblings = await db.order.findMany({
            where: { parentOrderId: order.parentOrderId!, locationId: order.locationId, deletedAt: null },
            select: { id: true, status: true },
          })
          const allTerminal = siblings.length > 0 && siblings.every(s => isClosed(s.status))
          if (allTerminal) {
            await OrderRepository.updateOrder(order.parentOrderId!, order.locationId, {
              status: 'voided', closedAt: new Date(),
              lastMutatedBy: mutationOrigin,
            })
            void dispatchOrderClosed(order.locationId, {
              orderId: order.parentOrderId!,
              status: 'voided',
              closedAt: new Date().toISOString(),
              closedByEmployeeId: managerId,
              locationId: order.locationId,
            }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
            void dispatchOpenOrdersChanged(order.locationId, {
              trigger: 'voided',
              orderId: order.parentOrderId!,
            }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
          }
        } catch (caughtErr) {
          console.error('[void-payment] Failed to resolve parent order after all children voided:', err)
        }
      })()
    }

    // Gift card balance restoration: if this void is on a gift card payment,
    // restore the full payment amount to the gift card balance (fire-and-forget)
    void (async () => {
      try {
        if (payment.paymentMethod !== 'gift_card') return

        const voidAmount = Number(payment.amount)
        if (voidAmount <= 0) return

        // Find the GiftCardTransaction for this payment via orderId + type='redemption'
        const gcTxns = await db.$queryRaw<Array<{ giftCardId: string }>>`
          SELECT DISTINCT "giftCardId" FROM "GiftCardTransaction"
           WHERE "orderId" = ${orderId} AND "type" = 'redemption' AND "deletedAt" IS NULL
           LIMIT 1
        `

        if (gcTxns.length === 0) {
          console.warn(`[void-payment] Gift card payment voided but no GiftCardTransaction found for orderId=${orderId}`)
          return
        }

        const giftCardId = gcTxns[0].giftCardId

        // Lock the gift card row and restore balance
        let newBalance = 0
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${giftCardId} FOR UPDATE`

          const gcRows = await tx.$queryRaw<Array<{ currentBalance: unknown; status: string }>>`
            SELECT "currentBalance", "status" FROM "GiftCard" WHERE "id" = ${giftCardId}
          `
          if (gcRows.length === 0) return

          const currentBalance = Number(gcRows[0].currentBalance)
          newBalance = currentBalance + voidAmount

          await tx.$executeRaw`
            UPDATE "GiftCard"
             SET "currentBalance" = ${newBalance}, "status" = 'active', "updatedAt" = NOW()
             WHERE "id" = ${giftCardId}
          `

          const gcTxnId = crypto.randomUUID()
          const gcMgrId = managerId || null
          const gcNotes = `Payment voided — $${voidAmount.toFixed(2)} restored to gift card`
          await tx.$executeRaw`
            INSERT INTO "GiftCardTransaction" (
              "id", "locationId", "giftCardId", "type", "amount",
              "balanceBefore", "balanceAfter", "orderId", "employeeId", "notes",
              "createdAt", "updatedAt"
            ) VALUES (
              ${gcTxnId}, ${order.locationId}, ${giftCardId}, 'refund', ${voidAmount},
              ${currentBalance}, ${newBalance}, ${orderId}, ${gcMgrId}, ${gcNotes},
              NOW(), NOW()
            )
          `
        }, { timeout: 10000 })

        console.log(`[void-payment] Gift card ${giftCardId} balance restored by $${voidAmount.toFixed(2)} for orderId=${orderId}`)
        void dispatchGiftCardBalanceChanged(order.locationId, { giftCardId, newBalance })
      } catch (caughtErr) {
        console.error('[void-payment] Gift card balance restoration failed:', err)
      }
    })()

    // Loyalty point reversal: reverse earned points when payment is voided (fire-and-forget)
    void (async () => {
      try {
        if (!order.customerId) return
        const locSettings = parseSettings(await getLocationSettings(order.locationId))
        if (!locSettings.loyalty.enabled) return

        // Find all 'earn' loyalty transactions for this order
        const earnTxns = await db.$queryRaw<Array<{ points: unknown }>>`
          SELECT "points" FROM "LoyaltyTransaction" WHERE "orderId" = ${orderId} AND "type" = 'earn'
        `.catch(() => [] as Array<{ points: unknown }>)

        const earnedPoints = earnTxns.reduce((sum, t) => sum + (Number(t.points) || 0), 0)
        if (earnedPoints <= 0) return

        // Decrement customer loyalty points and stats
        const voidTotalAmount = Number(payment.totalAmount)
        await db.$executeRaw`
          UPDATE "Customer" SET
            "loyaltyPoints" = GREATEST(0, "loyaltyPoints" - ${earnedPoints}),
            "lifetimePoints" = GREATEST(0, "lifetimePoints" - ${earnedPoints}),
            "totalSpent" = GREATEST(0, "totalSpent" - ${voidTotalAmount}),
            "totalOrders" = GREATEST(0, "totalOrders" - 1),
            "updatedAt" = NOW()
          WHERE "id" = ${order.customerId}
        `

        // Create reversal LoyaltyTransaction
        const txnId = crypto.randomUUID()
        const loyaltyDesc = `Reversed: payment voided on order #${order.orderNumber}`
        const loyaltyMgrId = managerId || null
        const negEarnedPoints = -earnedPoints
        await db.$executeRaw`
          INSERT INTO "LoyaltyTransaction" (
            "id", "customerId", "locationId", "orderId", "type", "points",
            "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
          ) VALUES (${txnId}, ${order.customerId}, ${order.locationId}, ${orderId}, 'adjust', ${negEarnedPoints}, 0, 0, ${loyaltyDesc}, ${loyaltyMgrId}, NOW())
        `
      } catch (caughtErr) {
        console.error('[void-payment] Loyalty point reversal failed:', err)
      }
    })()

    // Alert dispatch: notify if void exceeds threshold (fire-and-forget)
    void (async () => {
      try {
        const locSettings = parseSettings(await getLocationSettings(order.locationId))
        if (!locSettings.alerts.enabled) return
        const voidAmount = Number(payment.totalAmount)
        if (voidAmount < locSettings.alerts.largeVoidThreshold) return

        // Resolve manager name for the alert message
        const manager = await db.employee.findUnique({
          where: { id: managerId },
          select: { firstName: true, lastName: true, displayName: true },
        })
        const managerName = manager?.displayName || `${manager?.firstName ?? ''} ${manager?.lastName ?? ''}`.trim() || 'Unknown'

        void dispatchAlert({
          severity: 'HIGH',
          errorType: 'void_processed',
          category: 'transaction',
          message: `Void processed: Order #${order.orderNumber} - $${voidAmount.toFixed(2)} by ${managerName}`,
          locationId: order.locationId,
          employeeId: managerId,
          orderId,
          paymentId,
          groupId: `void-${order.locationId}-${orderId}`,
        }).catch(err => log.warn({ err }, 'Background task failed'))
      } catch (caughtErr) {
        console.error('[void-payment] Alert dispatch failed:', err)
      }
    })()

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    return ok({
        voidedPayment: {
          id: voidedPayment.id,
          status: voidedPayment.status,
          voidedAt: voidedPayment.voidedAt,
        },
        order: {
          id: order.id,
          status: newOrderStatus,
        },
        refundAmount: Number(payment.totalAmount),
      })
    } finally {
      // PAY-P2-2: Release advisory lock after all phases complete (success or failure)
      await db.$queryRaw`SELECT pg_advisory_unlock(${voidLockKey}::bigint)`.catch(err => log.warn({ err }, 'Advisory lock release failed'))
    }
  } catch (error) {
    // SECURITY: Log only safe fields — never managerPinHash or full request body
    console.error('Failed to void payment:', { error, orderId: (await params)?.id })
    return err('Failed to void payment', 500)
  }
})
