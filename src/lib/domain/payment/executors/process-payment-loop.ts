/**
 * Payment Loop Executor
 *
 * Extracted from the pay route: iterates over payments[], builds records,
 * dispatches to method-specific handlers, and processes HA line-item payments.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { PaymentMethod, PaymentStatus } from '@/generated/prisma/client'
import { calculateCardPrice, roundToCents, toNumber } from '@/lib/pricing'
import {
  processCashPayment,
  processCardPayment,
  processGiftCardPayment,
  processHouseAccountPayment,
  processLoyaltyPayment,
  processRoomChargePayment,
  type PaymentInput,
  type PaymentRecord,
  type PreChargeResult,
  type TxClient,
} from '@/lib/domain/payment'
import type { LocationSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-loop')

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PaymentLoopResult {
  allPendingPayments: PaymentRecord[]
  totalTips: number
  alreadyPaidInLoop: number
  giftCardBalanceChanges: Array<{ giftCardId: string; newBalance: number }>
  pmsAttemptId: string | null
  pmsTransactionNo: string | null
}

export interface PaymentLoopParams {
  tx: TxClient
  order: {
    locationId: string
    orderNumber: number | null
    total: unknown
    isTraining?: boolean | null
    customer?: unknown
    items?: Array<{ specialNotes?: string | null; status?: string; price?: unknown; quantity?: number }>
  }
  payments: Array<PaymentInput & Record<string, unknown>>
  settings: LocationSettings
  remaining: number
  alreadyPaid: number
  orderTotal: number
  drawerAttribution: { drawerId: string | null; shiftId: string | null }
  preChargeResult: PreChargeResult | null
  employeeId: string | undefined
  terminalId: string | undefined
  orderId: string
  finalIdempotencyKey: string
  isTrainingPayment: boolean
}

// ─── Executor ───────────────────────────────────────────────────────────────

export async function processPaymentLoop(
  params: PaymentLoopParams,
): Promise<{ ok: true; result: PaymentLoopResult } | { ok: false; response: NextResponse }> {
  const {
    tx,
    order,
    payments,
    settings,
    remaining,
    alreadyPaid: _alreadyPaid,
    orderTotal,
    drawerAttribution,
    preChargeResult,
    employeeId,
    terminalId,
    orderId,
    finalIdempotencyKey,
    isTrainingPayment,
  } = params

  const allPendingPayments: PaymentRecord[] = []
  const giftCardBalanceChanges: Array<{ giftCardId: string; newBalance: number }> = []
  let totalTips = 0
  let alreadyPaidInLoop = 0
  let pmsAttemptId: string | null = null
  let pmsTransactionNo: string | null = null

  for (let paymentIdx = 0; paymentIdx < payments.length; paymentIdx++) {
    const payment = payments[paymentIdx]

    // Training mode bypass — skip real payment processing, create simulated record
    if (isTrainingPayment) {
      const trainingRecord = {
        locationId: order.locationId,
        orderId,
        employeeId: employeeId || null,
        drawerId: null as string | null,
        shiftId: null as string | null,
        terminalId: terminalId || null,
        amount: payment.amount,
        tipAmount: 0, // No tips on training orders
        totalAmount: payment.amount,
        paymentMethod: 'cash' as PaymentMethod, // Store as cash — no card processor interaction
        status: 'completed' as PaymentStatus,
        idempotencyKey: payments.length > 1
          ? `${finalIdempotencyKey}-${paymentIdx}`
          : finalIdempotencyKey,
        authCode: 'TRAINING',
        transactionId: `TRAINING-${crypto.randomUUID().slice(0, 8)}`,
      } as PaymentRecord
      allPendingPayments.push(trainingRecord)
      alreadyPaidInLoop += payment.amount
      continue
    }

    // Use cached attribution for cash, null for non-cash
    const attribution = payment.method === 'cash'
      ? drawerAttribution
      : { drawerId: null, shiftId: null }

    let paymentRecord: PaymentRecord & Record<string, unknown> = {
      locationId: order.locationId,
      orderId,
      employeeId: employeeId || null,
      drawerId: attribution.drawerId,
      shiftId: attribution.shiftId,
      terminalId: terminalId || null,
      amount: payment.amount,
      tipAmount: payment.tipAmount || 0,
      totalAmount: payment.amount + (payment.tipAmount || 0),
      paymentMethod: payment.method as PaymentMethod,
      status: 'completed' as PaymentStatus,
      // Per-payment idempotency key: split tenders have multiple payments per request,
      // each must have a unique key. Append index for any multi-payment request.
      idempotencyKey: payments.length > 1
        ? `${finalIdempotencyKey}-${paymentIdx}`
        : finalIdempotencyKey,
      // Pricing tier detection (Payment & Pricing Redesign)
      // appliedPricingTier is NOT NULL with default 'cash' — always set it
      // Non-card methods (cash, gift_card, house_account, room_charge, loyalty) = 'cash' tier
      // Card methods (credit, debit) use client-detected tier or default to 'credit'
      appliedPricingTier: (['cash', 'gift_card', 'house_account', 'room_charge', 'loyalty', 'loyalty_points'] as string[]).includes(payment.method)
        ? 'cash'
        : ((payment as any).appliedPricingTier || 'credit'),
      ...(((payment as any).detectedCardType) && { detectedCardType: (payment as any).detectedCardType }),
      ...(((payment as any).walletType) && { walletType: (payment as any).walletType }),
    }

    // Dual pricing: record pricing mode and discount info
    const dualPricing = settings.dualPricing
    if (dualPricing.enabled) {
      const isCash = payment.method === 'cash'
      const isCard = (payment.method === 'credit' && dualPricing.applyToCredit) ||
                     (payment.method === 'debit' && dualPricing.applyToDebit)

      if (isCash) {
        // Dual pricing fields calculated after cash rounding below
        paymentRecord.pricingMode = 'cash'
      } else if (isCard) {
        paymentRecord.pricingMode = 'card'
        paymentRecord.cashDiscountAmount = 0
        paymentRecord.priceBeforeDiscount = payment.amount

        // Validate: card amount should match expected card price (warn, don't reject)
        const expectedCardAmount = calculateCardPrice(toNumber(order.total ?? 0), dualPricing.cashDiscountPercent)
        if (Math.abs(payment.amount - expectedCardAmount) > 0.01) {
          console.warn(`[DualPricing] Card payment amount $${payment.amount} differs from expected $${expectedCardAmount} for order ${orderId}`)
          // Route through audit log so it shows up in monitoring dashboards
          void tx.auditLog.create({
            data: {
              locationId: order.locationId,
              action: 'DUAL_PRICING_MISMATCH',
              employeeId: employeeId || null,
              entityType: 'order',
              entityId: orderId,
              details: JSON.stringify({
                orderNumber: order.orderNumber,
                submittedAmount: payment.amount,
                expectedCardAmount,
                orderTotal: toNumber(order.total ?? 0),
                cashDiscountPercent: dualPricing.cashDiscountPercent,
                delta: roundToCents(payment.amount - expectedCardAmount),
              }),
            },
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in payment-loop'))
        }
      }
    }

    // Snapshot pricing program config at transaction time (for audit trail)
    if (settings.pricingProgram?.enabled && (payment.method === 'credit' || payment.method === 'debit' || payment.method === 'cash')) {
      paymentRecord.pricingProgramSnapshot = {
        model: settings.pricingProgram.model,
        creditMarkupPercent: settings.pricingProgram.creditMarkupPercent,
        debitMarkupPercent: settings.pricingProgram.debitMarkupPercent,
        cashDiscountPercent: settings.pricingProgram.cashDiscountPercent,
        surchargePercent: settings.pricingProgram.surchargePercent,
      }
    }

    if (payment.method === 'cash') {
      paymentRecord = processCashPayment(
        payment as PaymentInput, paymentRecord as PaymentRecord,
        remaining, alreadyPaidInLoop, settings, dualPricing?.enabled ? dualPricing : undefined,
        orderId, toNumber(order.total ?? 0),
      ) as typeof paymentRecord
    } else if (payment.method === 'credit' || payment.method === 'debit') {
      paymentRecord = processCardPayment(
        payment as PaymentInput, paymentRecord as PaymentRecord, orderId,
      ) as typeof paymentRecord
    } else if (payment.method === 'loyalty_points') {
      const loyaltyResult = await processLoyaltyPayment(
        tx as any, payment as PaymentInput, paymentRecord as PaymentRecord,
        orderTotal, order.customer as any, settings.loyalty,
      )
      if (loyaltyResult.error) {
        return { ok: false, response: NextResponse.json(
          { error: loyaltyResult.error }, { status: loyaltyResult.errorStatus || 400 }
        ) }
      }
      allPendingPayments.push(loyaltyResult.record)
      totalTips += payment.tipAmount || 0
      continue
    } else if (payment.method === 'gift_card') {
      const gcResult = await processGiftCardPayment(
        tx as any, payment as PaymentInput, paymentRecord as PaymentRecord,
        orderId, order.locationId, order.orderNumber, employeeId || null,
        settings.payments.acceptGiftCards,
      )
      if (gcResult.error) {
        return { ok: false, response: NextResponse.json(
          { error: gcResult.error, ...gcResult.errorExtras }, { status: gcResult.errorStatus || 400 }
        ) }
      }
      allPendingPayments.push(gcResult.record)
      if (gcResult.giftCardId && gcResult.newBalance !== undefined) {
        giftCardBalanceChanges.push({ giftCardId: gcResult.giftCardId, newBalance: gcResult.newBalance })
      }
      totalTips += payment.tipAmount || 0
      continue
    } else if (payment.method === 'house_account') {
      const haResult = await processHouseAccountPayment(
        tx as any, payment as PaymentInput, paymentRecord as PaymentRecord,
        orderId, order.locationId, order.orderNumber, employeeId || null,
        settings.payments.acceptHouseAccounts,
      )
      if (haResult.error) {
        return { ok: false, response: NextResponse.json(
          { error: haResult.error, ...haResult.errorExtras }, { status: haResult.errorStatus || 400 }
        ) }
      }
      allPendingPayments.push(haResult.record)
      totalTips += payment.tipAmount || 0
      continue
    } else if (payment.method === 'room_charge') {
      const rcResult = processRoomChargePayment(paymentRecord as PaymentRecord, preChargeResult as PreChargeResult | null)
      if (rcResult.error) {
        return { ok: false, response: NextResponse.json(
          { error: rcResult.error }, { status: rcResult.errorStatus || 500 }
        ) }
      }
      paymentRecord = rcResult.record as typeof paymentRecord
      pmsAttemptId = rcResult.pmsAttemptId
      pmsTransactionNo = rcResult.pmsTransactionNo
    }

    allPendingPayments.push(paymentRecord)
    totalTips += payment.tipAmount || 0
    alreadyPaidInLoop += payment.amount
  }

  // Process house account payment line items (balance reduction)
  // These are order items added via /api/orders/[id]/add-ha-payment that represent
  // a customer paying down their house account balance. When the order is paid,
  // we reduce the HA balance and create a transaction record.
  //
  // ATOMICITY FIX (Issue B): Pre-calculate all HA charges BEFORE updating any balances.
  // If the transaction rolls back after partial updates, balance drift occurs.
  // Now: collect all amounts -> validate all -> execute all in single phase.
  const haPaymentItems = order.items?.filter(
    (item: { specialNotes?: string | null; status?: string }) =>
      item.specialNotes?.startsWith('ha_payment:') && item.status !== 'voided'
  ) ?? []

  // Collect and pre-validate all house account updates
  const haUpdates: Array<{
    haId: string
    haAmount: number
    currentBal: number
    effectiveAmount: number
  }> = []

  for (const haItem of haPaymentItems) {
    const haId = (haItem as any).specialNotes!.replace('ha_payment:', '')
    const haAmount = roundToCents(toNumber((haItem as any).price) * ((haItem as any).quantity || 1))

    // Lock and read current balance
    await tx.$queryRaw`SELECT id FROM "HouseAccount" WHERE id = ${haId} FOR UPDATE`
    const haAccount = await tx.houseAccount.findUnique({ where: { id: haId } })
    if (haAccount && haAccount.status === 'active') {
      const currentBal = toNumber(haAccount.currentBalance)
      const effectiveAmount = Math.min(haAmount, currentBal)
      if (effectiveAmount > 0) {
        haUpdates.push({ haId, haAmount, currentBal, effectiveAmount })
      }
    }
  }

  // Apply all house account updates atomically — if any fails, the entire tx rolls back.
  // This prevents partial state where some balances were decremented but the tx failed.
  for (const update of haUpdates) {
    const newBalance = update.currentBal - update.effectiveAmount
    await tx.houseAccount.update({
      where: { id: update.haId },
      data: {
        currentBalance: newBalance,
        transactions: {
          create: {
            locationId: order.locationId,
            type: 'payment',
            amount: -update.effectiveAmount,
            balanceBefore: update.currentBal,
            balanceAfter: newBalance,
            orderId,
            employeeId: employeeId || null,
            notes: `Payment via Order #${order.orderNumber}`,
          }
        }
      }
    })
  }

  return {
    ok: true,
    result: {
      allPendingPayments,
      totalTips,
      alreadyPaidInLoop,
      giftCardBalanceChanges,
      pmsAttemptId,
      pmsTransactionNo,
    },
  }
}
