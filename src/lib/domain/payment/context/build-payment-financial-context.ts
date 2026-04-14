/**
 * Payment Financial Context Builder
 *
 * Extracted from the pay route — computes the entire financial state needed
 * before the payment processing loop begins:
 *
 * 1. Entertainment per-minute settlement (mutates order items + recalculates totals)
 * 2. Already-paid calculation + zero-balance early close
 * 3. Cash rounding normalization
 * 4. Payment amount validation (paymentBaseTotal vs remaining)
 * 5. Total drift detection (R3)
 * 6. Auto-gratuity calculation (may mutate payments[].tipAmount)
 * 7. Split child parent validation for auto-grat guest count
 * 8. Drawer resolution
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { roundAmount } from '@/lib/payment'
import { applyPriceRounding, calculateCardPrice, roundToCents, toNumber } from '@/lib/pricing'
import { calculateCharge, type EntertainmentPricing, type OvertimeConfig } from '@/lib/entertainment-pricing'
import { getLocationTaxRate, recalculatePercentDiscounts, calculateSplitTax } from '@/lib/order-calculations'
import { ingestAndProject } from '@/lib/order-events/ingester'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import {
  resolveDrawerForPayment,
  calculateAutoGratuity,
  validatePaymentAmounts,
  type PaymentInput,
  type DrawerAttribution,
} from '@/lib/domain/payment'
import { dispatchPaymentProcessed } from '@/lib/socket-dispatch'
import { getPricingProgram } from '@/lib/settings'
import type { LocationSettings } from '@/lib/settings/types'

const log = createChildLogger('payment-financial-context')

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PaymentFinancialContext {
  alreadyPaid: number
  remaining: number
  orderTotal: number
  validationRemaining: number
  paymentBaseTotal: number
  totalDriftWarning: { capturedTotal: number; currentTotal: number; drift: number } | null
  autoGratApplied: boolean
  autoGratNote: string | null
  drawerAttribution: DrawerAttribution
  payments: PaymentInput[]
}

export type FinancialContextResult =
  | { ok: true; ctx: PaymentFinancialContext }
  | { ok: false; response: NextResponse }

export interface BuildFinancialContextParams {
  tx: any // TxClient — Prisma transaction client
  order: any // The full order with items, payments, location, customer
  payments: PaymentInput[]
  settings: LocationSettings
  capturedOrderTotal?: number | null
  skipDriftCheck?: boolean
  employeeId?: string | null
  terminalId?: string
  splitPayRemainingOverride?: number | null
}

// ─── Builder ────────────────────────────────────────────────────────────────

export async function buildPaymentFinancialContext(
  params: BuildFinancialContextParams
): Promise<FinancialContextResult> {
  const {
    tx,
    order,
    payments: inputPayments,
    settings,
    capturedOrderTotal,
    skipDriftCheck,
    employeeId,
    terminalId,
    splitPayRemainingOverride,
  } = params
  const orderId = order.id

  // Mutable copy — auto-gratuity may mutate tipAmount
  const payments = [...inputPayments] as PaymentInput[]

  // ── 1. Entertainment per-minute settlement ──────────────────────────────
  // BUG #380: Settle per-minute entertainment pricing before calculating totals.
  // For timed_rental items with per-minute pricing, the order item's price was set to
  // the base price at ordering time. At payment, compute the actual charge from elapsed time.
  // H-FIN-5: All settlement writes happen inside a single transaction.
  // H-FIN-4: Tax is recalculated after price settlement (not just subtotal + old tax).
  const perMinuteItems = order.items.filter(
    (item: any) => item.menuItem?.itemType === 'timed_rental' && item.blockTimeStartedAt && !item.blockTimeExpiresAt
  )
  // Skip entertainment settlement for allocation split children — they have no items
  // (all items stay on the parent). Their totals were set during split creation.
  const isAllocationSplitChild = order.parentOrderId && (order as any).splitClass === 'allocation'
  if (perMinuteItems.length > 0 && !isAllocationSplitChild) {
    const now = new Date()
    const payLocSettings = order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } } | null
    // Prefer order-level exclusive tax rate snapshot; fall back to live rate
    const orderPayExclRate = (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
    const taxRate = (orderPayExclRate != null && orderPayExclRate >= 0) ? orderPayExclRate : getLocationTaxRate(payLocSettings)
    // Prefer order-level snapshot; fall back to location setting with > 0 guard
    const orderPayInclRate = toNumber(order.inclusiveTaxRate) || undefined
    const payInclRateRaw = payLocSettings?.tax?.inclusiveTaxRate
    const payInclusiveRate = orderPayInclRate
      ?? (payInclRateRaw != null && Number.isFinite(payInclRateRaw) && payInclRateRaw > 0
        ? payInclRateRaw / 100 : undefined)

    // Batch-fetch all menu items for per-minute settlement in ONE query (N+1 fix)
    const perMinuteMenuItemIds = [...new Set(perMinuteItems.map((item: any) => item.menuItemId))]
    const perMinuteMenuItems = await tx.menuItem.findMany({
      where: { id: { in: perMinuteMenuItemIds } },
      select: {
        id: true, ratePerMinute: true, minimumCharge: true, incrementMinutes: true, graceMinutes: true, price: true,
        overtimeEnabled: true, overtimeMode: true, overtimeMultiplier: true,
        overtimePerMinuteRate: true, overtimeFlatFee: true, overtimeGraceMinutes: true,
      },
    })
    const perMinuteMenuItemMap = new Map<string, any>(perMinuteMenuItems.map((mi: any) => [mi.id, mi]))

    // Calculate settlements and batch the updates
    const settlementUpdates: Promise<unknown>[] = []
    for (const item of perMinuteItems) {
        const startedAt = new Date(item.blockTimeStartedAt!)
        const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000))

        const mi = perMinuteMenuItemMap.get(item.menuItemId)
        if (!mi) continue

        const ratePerMinute = mi.ratePerMinute ? toNumber(mi.ratePerMinute) : 0
        if (ratePerMinute <= 0) continue

        // Build overtime config if enabled on the menu item
        const otConfig: OvertimeConfig | undefined = mi.overtimeEnabled
          ? {
              enabled: true,
              mode: (mi.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
              multiplier: mi.overtimeMultiplier ? toNumber(mi.overtimeMultiplier) : undefined,
              perMinuteRate: mi.overtimePerMinuteRate ? toNumber(mi.overtimePerMinuteRate) : undefined,
              flatFee: mi.overtimeFlatFee ? toNumber(mi.overtimeFlatFee) : undefined,
              graceMinutes: mi.overtimeGraceMinutes ?? undefined,
            }
          : undefined

        const pricing: EntertainmentPricing = {
          ratePerMinute,
          minimumCharge: mi.minimumCharge ? toNumber(mi.minimumCharge) : 0,
          incrementMinutes: mi.incrementMinutes ?? 15,
          graceMinutes: mi.graceMinutes ?? 5,
          overtime: otConfig,
        }

        // Pass bookedMinutes to calculateCharge so overtime applies if session exceeded booked time
        const bookedMinutes = item.blockTimeMinutes || undefined
        const breakdown = calculateCharge(elapsedMinutes, pricing, bookedMinutes)
        const settledPrice = breakdown.totalCharge

        settlementUpdates.push(
          OrderItemRepository.updateItem(item.id, order.locationId, {
            price: settledPrice,
            itemTotal: settledPrice * item.quantity,
          }, tx)
        )
      }
      await Promise.all(settlementUpdates)

      // TX-KEEP: COMPLEX — active items with modifiers include for entertainment settlement recalc; no repo method for status-filtered items with modifiers
      const activeItems = await (tx as any).orderItem.findMany({
        where: { orderId, locationId: order.locationId, status: 'active', deletedAt: null },
        include: { modifiers: true },
      })
      let newSubtotal = 0
      for (const ai of activeItems) {
        const modTotal = ai.modifiers.reduce((s: number, m: any) => s + toNumber(m.price), 0)
        newSubtotal += roundToCents((toNumber(ai.price) + modTotal) * ai.quantity)
      }
      newSubtotal = roundToCents(newSubtotal)

      // Recalculate percent-based discounts against new subtotal (entertainment price changes invalidate them)
      const newDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotal)
      const effectiveDiscount = Math.min(newDiscountTotal, newSubtotal)

      // Split-aware tax recalculation after entertainment settlement
      let payInclSub = 0, payExclSub = 0
      for (const ai of activeItems) {
        const modTotal = ai.modifiers.reduce((s: number, m: any) => s + toNumber(m.price), 0)
        const t = roundToCents((toNumber(ai.price) + modTotal) * ai.quantity)
        if ((ai as any).isTaxInclusive) payInclSub += t; else payExclSub += t
      }
      payInclSub = roundToCents(payInclSub)
      payExclSub = roundToCents(payExclSub)
      // Allocate discount proportionally between inclusive and exclusive
      let payDiscIncl = 0, payDiscExcl = 0
      if (effectiveDiscount > 0 && newSubtotal > 0) {
        payDiscIncl = roundToCents(effectiveDiscount * (payInclSub / newSubtotal))
        payDiscExcl = roundToCents(effectiveDiscount - payDiscIncl)
      }
      const payTaxResult = calculateSplitTax(
        Math.max(0, payInclSub - payDiscIncl), Math.max(0, payExclSub - payDiscExcl), taxRate, payInclusiveRate
      )
      const newTaxTotal = payTaxResult.totalTax
      const newTotal = roundToCents(newSubtotal + payTaxResult.taxFromExclusive - effectiveDiscount)

      await OrderRepository.updateOrder(orderId, order.locationId, {
        subtotal: newSubtotal,
        discountTotal: effectiveDiscount,
        taxTotal: newTaxTotal,
        taxFromInclusive: payTaxResult.taxFromInclusive,
        taxFromExclusive: payTaxResult.taxFromExclusive,
        total: newTotal,
      }, tx)

      ;(order as any).subtotal = newSubtotal
      ;(order as any).discountTotal = effectiveDiscount
      ;(order as any).taxTotal = newTaxTotal
      ;(order as any).total = newTotal
  }

  // ── 2. Already-paid calculation ─────────────────────────────────────────
  // Calculate how much of the ORDER BALANCE is already paid.
  // Uses p.amount (pre-tip base), NOT p.totalAmount which includes tips.
  // Tips don't count toward the order balance — using totalAmount would
  // overcount and let orders close with underpaid balances.
  const alreadyPaid = roundToCents(order.payments
    .filter((p: any) => p.status === 'completed')
    .reduce((sum: number, p: any) => sum + toNumber(p.amount), 0))

  // ── Compute authoritative payable amount from venue pricing program ──────
  // order.total is the cash subtotal (items - discounts). It does NOT include tax,
  // surcharge, or rounding. The register's checkout engine computes the full payable
  // amount from the pricing program. The server must compute the SAME amount or
  // payments will be rejected for mismatch.
  //
  // For split children with splitPayRemainingOverride, the family balance is already
  // the authoritative amount and should not be recomputed.
  const orderTotal = (() => {
    if (splitPayRemainingOverride != null) return splitPayRemainingOverride

    const rawTotal = toNumber(order.total ?? 0)  // subtotal - discounts (cash basis)
    const storedTax = toNumber(order.taxTotal ?? 0)

    // Step 1: Compute tax-inclusive amount
    let taxInclusiveTotal = rawTotal
    if (storedTax > 0) {
      // Tax already stored on the order (entertainment settlement or pre-computed)
      taxInclusiveTotal = roundToCents(rawTotal + storedTax)
    } else {
      // Compute tax from venue settings (same as register engine)
      const taxSettings = settings.tax
      const taxRate = taxSettings?.defaultRate ?? 0  // percentage, e.g. 10.0
      if (taxRate > 0) {
        const computedTax = roundToCents(rawTotal * taxRate / 100)
        taxInclusiveTotal = roundToCents(rawTotal + computedTax)
      }
    }

    // Step 2: Apply cash rounding (mirrors register checkout engine)
    // The register rounds the tax-inclusive total before submitting. The server must
    // compute the same rounded amount or validation will reject for mismatch.
    const isAllocChild = order.parentOrderId && (order as any).splitClass === 'allocation'
    if (!isAllocChild && settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
      return applyPriceRounding(taxInclusiveTotal, settings.priceRounding, 'cash')
    }

    return taxInclusiveTotal
  })()

  const remaining = roundToCents(splitPayRemainingOverride != null
    ? splitPayRemainingOverride  // Family balance already accounts for all paid amounts
    : orderTotal - alreadyPaid)

  // If order total is $0 (e.g., all items voided), close the order without payment
  if (remaining <= 0 && alreadyPaid === 0) {
    await ingestAndProject(tx as any, orderId, order.locationId, [
      { type: 'ORDER_CLOSED', payload: { closedStatus: 'paid' } }
    ])
    return { ok: false, response: NextResponse.json({ data: {
      success: true,
      orderId,
      message: 'Order closed with $0 balance (all items voided/comped)',
      totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
    } }) }
  }

  // ── 3. Cash rounding normalization ──────────────────────────────────────
  // Calculate total being paid now (base amounts only, excludes tips).
  // Tips are tracked separately via totalTips/newTipTotal — they must NOT count
  // toward paying the order balance or the order could close underpaid.
  const paymentBaseTotal = payments.reduce((sum, p) => sum + p.amount, 0)

  // When cash rounding is enabled, the client sends the ROUNDED amount
  // (e.g., $3.29 rounded to $3.25 with quarter rounding). The tolerance
  // must account for the rounding increment to avoid false rejections.
  // Two rounding systems exist:
  //   1. priceRounding (Skill 88) — increment-based ('0.05', '0.25', etc.)
  //   2. cashRounding (legacy) — named modes ('nickel', 'quarter', etc.)
  // priceRounding takes precedence when enabled.
  const hasCashPayment = payments.some(p => p.method === 'cash')
  const isAllocationChild = order.parentOrderId && (order as any).splitClass === 'allocation'
  let validationRemaining = remaining
  // Skip cash rounding for allocation split children — their totals were set
  // during split creation without rounding, so the client sends the exact split amount.
  if (hasCashPayment && !isAllocationChild) {
    // Dual pricing: order.total IS the cash price (stored price model).
    // Card price = order.total * (1 + cashDiscountPercent/100).
    // Cash payments must match the stored total — do NOT call calculateCashPrice()
    // on `remaining` because it is already the cash price; doing so would
    // incorrectly reduce the threshold a second time.
    // (No adjustment needed here — validationRemaining stays as `remaining`.)
    if (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
      validationRemaining = applyPriceRounding(validationRemaining, settings.priceRounding, 'cash')
    } else if (settings.payments?.cashRounding && settings.payments.cashRounding !== 'none') {
      // Legacy fallback — only used by older NUC builds that haven't migrated to priceRounding
      validationRemaining = roundAmount(
        validationRemaining,
        settings.payments.cashRounding,
        settings.payments.roundingDirection ?? 'nearest'
      )
    }
  }

  // ── 4. Payment amount validation ────────────────────────────────────────
  // Compute validation tolerance: when cash rounding is active, the client's rounded
  // amount may differ from the server's by up to a full rounding increment. This happens
  // when the unrounded totals differ by even 1 cent (floating-point differences between
  // Long-cents on Android vs Double-dollars on server) and land on different sides of a
  // rounding boundary. E.g., $25.47 rounds to $25.45, but $25.48 rounds to $25.50.
  // Using the full increment as tolerance is safe — it only relaxes the "minimum payment"
  // check, and the order still must be fully paid before closing.
  const validationTolerance = (hasCashPayment && settings.priceRounding?.enabled && settings.priceRounding.applyToCash)
    ? roundToCents(parseFloat(settings.priceRounding.increment))
    : (hasCashPayment && settings.payments?.cashRounding && settings.payments.cashRounding !== 'none')
      ? (() => {
          const legacyIncrements: Record<string, number> = { nickel: 0.05, dime: 0.10, quarter: 0.25, dollar: 1.00 }
          return roundToCents(legacyIncrements[settings.payments.cashRounding as string] ?? 0.05)
        })()
      : 0.01

  console.log(`[PAY-VALIDATION] paymentBaseTotal=${paymentBaseTotal} validationRemaining=${validationRemaining} remaining=${remaining} isAllocationChild=${isAllocationChild} tolerance=${validationTolerance}`)
  if (paymentBaseTotal < validationRemaining - validationTolerance) {
    return { ok: false, response: NextResponse.json(
      { error: `Payment amount ($${paymentBaseTotal.toFixed(2)}) is less than remaining balance ($${validationRemaining.toFixed(2)})` },
      { status: 400 }
    ) }
  }

  if (paymentBaseTotal > validationRemaining + validationTolerance) {
    return { ok: false, response: NextResponse.json(
      { error: `Payment amount ($${paymentBaseTotal.toFixed(2)}) exceeds remaining balance ($${validationRemaining.toFixed(2)})` },
      { status: 400 }
    ) }
  }

  // ── 4b. Card payment amount validation (dual pricing) ─────────────────
  // When dual pricing is enabled and a card payment is present, validate that
  // the card payment amount matches the expected card price (cash total + markup).
  // order.total stores the CASH price; card price = calculateCardPrice(cashPrice, markupPercent).
  const hasCardPayment = payments.some(p => ['credit', 'debit'].includes(p.method))
  const pp = getPricingProgram(settings)
  if (hasCardPayment && pp.enabled) {
    const markupPct = pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 0
    const cardValidationRemaining = calculateCardPrice(remaining, markupPct)
    const cardPaymentTotal = payments
      .filter(p => ['credit', 'debit'].includes(p.method))
      .reduce((sum, p) => sum + p.amount, 0)

    if (Math.abs(cardPaymentTotal - cardValidationRemaining) > 0.05) {
      log.warn({
        orderId,
        submittedAmount: cardPaymentTotal,
        expectedCashAmount: remaining,
        expectedCardAmount: cardValidationRemaining,
        tier: payments.find(p => ['credit', 'debit'].includes(p.method))?.appliedPricingTier || 'unknown',
        delta: cardPaymentTotal - cardValidationRemaining,
        mode: process.env.PAYMENT_HARD_REJECT === 'true' ? 'hard' : 'soft',
        orderVersion: (order as any).version ?? null,
        snapshotTs: new Date().toISOString(),
      }, '[PAYMENT-AUDIT] Card payment amount does not match expected card total')

      if (process.env.PAYMENT_HARD_REJECT === 'true') {
        return { ok: false, response: NextResponse.json(
          { error: `Card payment amount ($${cardPaymentTotal.toFixed(2)}) does not match expected card total ($${cardValidationRemaining.toFixed(2)})`, code: 'CARD_AMOUNT_MISMATCH' },
          { status: 400 }
        ) }
      }
    }
  }

  // Validate payment amounts and Datacap field consistency
  const amountError = validatePaymentAmounts(payments, orderTotal)
  if (amountError) {
    return { ok: false, response: NextResponse.json({ error: amountError }, { status: 400 }) }
  }

  // ── 5. Total drift detection (R3) ──────────────────────────────────────
  // When the client sends capturedOrderTotal (the total it displayed when the user
  // initiated payment), compare against the current order total (locked via FOR UPDATE).
  // This detects cases where Terminal A adds items while Terminal B is paying.
  // Thresholds:
  //   > $1.00 drift: REJECT unless client sends skipDriftCheck: true (user acknowledged)
  //   $0.01–$1.00 drift: ALLOW but include totalDriftWarning in response
  //   <= $0.01: ignore (rounding)
  let totalDriftWarning: { capturedTotal: number; currentTotal: number; drift: number } | null = null
  if (capturedOrderTotal != null) {
    const currentTotal = toNumber(order.total ?? 0)
    const drift = roundToCents(Math.abs(currentTotal - capturedOrderTotal))

    if (drift > 0.01) {
      // Audit log + socket for ALL drift cases (inside transaction for consistency)
      log.warn({
        orderId,
        capturedTotal: capturedOrderTotal,
        currentTotal,
        drift,
        skipDriftCheck: !!skipDriftCheck,
      }, 'R3: Total drift detected between client capture and payment')

      // Create audit log entry for staff review (savepoint so it never blocks payment)
      try {
        await tx.$executeRaw`SAVEPOINT drift_audit`
        await tx.$executeRaw`
          INSERT INTO "AuditLog" ("id", "locationId", "employeeId", "action", "entityType", "entityId", "details", "createdAt")
          VALUES (
            ${crypto.randomUUID()},
            ${order.locationId},
            ${employeeId || null},
            'TOTAL_DRIFT_DETECTED',
            'order',
            ${orderId},
            ${JSON.stringify({
              orderNumber: order.orderNumber,
              capturedTotal: capturedOrderTotal,
              currentTotal,
              drift,
              acknowledged: !!skipDriftCheck,
              message: `Order total changed from $${capturedOrderTotal.toFixed(2)} to $${currentTotal.toFixed(2)} (drift: $${drift.toFixed(2)})${skipDriftCheck ? ' — acknowledged by client' : ''}`,
            })},
            NOW()
          )
        `
        await tx.$executeRaw`RELEASE SAVEPOINT drift_audit`
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT drift_audit`.catch((e: unknown) => log.warn({ err: e }, 'drift audit savepoint rollback failed'))
      }

      if (drift > 1.00 && !skipDriftCheck) {
        // Significant drift — reject payment, require client acknowledgement
        // Emit socket event so other terminals see the drift
        void dispatchPaymentProcessed(order.locationId, {
          orderId,
          status: 'total_drift_rejected',
          totalDriftDetected: true,
          capturedTotal: capturedOrderTotal,
          currentTotal,
          drift,
          sourceTerminalId: terminalId || undefined,
        } as any).catch((e: unknown) => log.warn({ err: e }, 'R3: drift rejection socket dispatch failed'))

        return { ok: false, response: NextResponse.json(
          {
            error: `Order total has changed by $${drift.toFixed(2)} since payment was initiated. Please retry.`,
            code: 'TOTAL_DRIFT_REJECTED',
            capturedTotal: capturedOrderTotal,
            currentTotal,
            drift,
          },
          { status: 409 }
        ) }
      }

      // Minor drift ($0.01–$1.00) or acknowledged drift (skipDriftCheck) — allow but warn
      totalDriftWarning = { capturedTotal: capturedOrderTotal, currentTotal, drift }
    }
  }

  // ── 6. Auto-gratuity calculation ────────────────────────────────────────
  // When entertainmentTipsEnabled is false, deduct entertainment item totals
  // from the auto-gratuity basis (mirrors client-side tipExemptAmount logic
  // in OrderPageModals.tsx).
  let autoGratSubtotal = roundToCents(toNumber(order.subtotal ?? order.total ?? 0) - toNumber(order.tipTotal ?? 0))
  if (settings.tipBank?.entertainmentTipsEnabled === false) {
    const entertainmentTotal = (order.items ?? [])
      .filter((i: any) => i.status !== 'voided' && i.categoryType === 'entertainment')
      .reduce((sum: number, i: any) => sum + (Number(i.itemTotal) || (Number(i.price) * (i.quantity || 1))), 0)
    autoGratSubtotal = roundToCents(Math.max(0, autoGratSubtotal - entertainmentTotal))
  }

  // ── 7. Split child parent validation for auto-grat ─────────────────────
  // For split children, use the parent order's guestCount for auto-gratuity eligibility
  // (split children have guestCount: 1, which would always fail the minimum party size check)
  let autoGratGuestCount = order.guestCount
  if (order.parentOrderId) {
    const parentOrderForGrat = await db.order.findUnique({
      where: { id: order.parentOrderId },
      select: { guestCount: true },
    })
    if (parentOrderForGrat) {
      autoGratGuestCount = parentOrderForGrat.guestCount
    }
  }
  const autoGratResult = calculateAutoGratuity(settings.autoGratuity, {
    guestCount: autoGratGuestCount,
    existingTipTotal: toNumber(order.tipTotal ?? 0),
    orderSubtotal: autoGratSubtotal,
    payments,
  })
  let autoGratApplied = false
  let autoGratNote: string | null = null
  if (autoGratResult.applied) {
    ;(payments[autoGratResult.tippableIndex] as any).tipAmount = autoGratResult.amount
    autoGratApplied = true
    autoGratNote = autoGratResult.note
    console.info(`[Pay] ${autoGratNote}`, { orderId, guestCount: order.guestCount, autoGratAmount: autoGratResult.amount })
  }

  // ── 8. Drawer resolution ────────────────────────────────────────────────
  // Resolve drawer ONCE before the loop (instead of per-payment)
  const drawerAttribution = await resolveDrawerForPayment(
    'cash', // Resolve for cash (non-cash returns null anyway)
    employeeId || null,
    terminalId,
  )

  return {
    ok: true,
    ctx: {
      alreadyPaid,
      remaining,
      orderTotal,
      validationRemaining,
      paymentBaseTotal,
      totalDriftWarning,
      autoGratApplied,
      autoGratNote,
      drawerAttribution,
      payments,
    },
  }
}
