import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client'
import {
  generateFakeAuthCode,
  generateFakeTransactionId,
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { calculateCardPrice, calculateCashDiscount, applyPriceRounding, roundToCents } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderTotalsUpdate, dispatchPaymentProcessed, dispatchCFDReceiptSent } from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { emitCloudEvent } from '@/lib/cloud-events'
import { triggerCashDrawer } from '@/lib/cash-drawer'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { calculateCharge, type EntertainmentPricing } from '@/lib/entertainment-pricing'
import { getLocationTaxRate } from '@/lib/order-calculations'
import { emitOrderEvent } from '@/lib/order-events/emitter'

/**
 * Resolve which drawer and shift should be attributed for a cash payment.
 *
 * Priority:
 * 1. If terminal has a physical drawer, use it (+ the shift that claimed it)
 * 2. Fall back to the processing employee's own open shift/drawer
 *
 * Card payments return nulls (no drawer attribution needed).
 */
async function resolveDrawerForPayment(
  paymentMethod: string,
  processingEmployeeId: string | null,
  terminalId?: string,
): Promise<{ drawerId: string | null; shiftId: string | null }> {
  // Card payments: no drawer attribution
  if (paymentMethod !== 'cash') {
    return { drawerId: null, shiftId: null }
  }

  // 1. If terminal has a physical drawer, use it
  if (terminalId) {
    const drawer = await db.drawer.findFirst({
      where: { deviceId: terminalId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (drawer) {
      const ownerShift = await db.shift.findFirst({
        where: { drawerId: drawer.id, status: 'open', deletedAt: null },
        select: { id: true },
      })
      return { drawerId: drawer.id, shiftId: ownerShift?.id ?? null }
    }
  }

  // 2. Fall back to the processing employee's own shift
  if (processingEmployeeId) {
    const employeeShift = await db.shift.findFirst({
      where: { employeeId: processingEmployeeId, status: 'open', deletedAt: null },
      select: { id: true, drawerId: true },
    })
    if (employeeShift) {
      return {
        drawerId: employeeShift.drawerId ?? null,
        shiftId: employeeShift.id,
      }
    }
  }

  return { drawerId: null, shiftId: null }
}

interface PaymentInput {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | 'loyalty_points'
  amount: number
  tipAmount?: number
  // Cash specific
  amountTendered?: number
  // Card specific
  cardBrand?: string
  cardLast4?: string
  // Gift card specific
  giftCardId?: string
  giftCardNumber?: string
  // House account specific
  houseAccountId?: string
  // Loyalty points specific
  pointsUsed?: number
  // Datacap Direct fields
  datacapRecordNo?: string
  datacapRefNumber?: string
  datacapSequenceNo?: string
  authCode?: string
  entryMethod?: string
  signatureData?: string
  amountAuthorized?: number
  // Simulated - will be replaced with real processor
  simulate?: boolean
}

// Zod schema for request validation
const PaymentInputSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty_points']),
  amount: z.number().positive('Amount must be positive'),
  tipAmount: z.number().min(0, 'Tip amount cannot be negative').optional(),
  // Cash specific
  amountTendered: z.number().positive().optional(),
  // Card specific
  cardBrand: z.string().optional(),
  cardLast4: z.string().length(4, 'Card last 4 must be exactly 4 digits').regex(/^\d{4}$/, 'Card last 4 must be numeric').optional(),
  // Gift card specific
  giftCardId: z.string().optional(),
  giftCardNumber: z.string().optional(),
  // House account specific
  houseAccountId: z.string().optional(),
  // Loyalty points specific
  pointsUsed: z.number().int().positive().optional(),
  // Datacap Direct fields
  datacapRecordNo: z.string().optional(),
  datacapRefNumber: z.string().optional(),
  datacapSequenceNo: z.string().optional(),
  authCode: z.string().optional(),
  entryMethod: z.string().optional(),
  signatureData: z.string().optional(),
  amountAuthorized: z.number().positive().optional(),
  // Simulated
  simulate: z.boolean().optional(),
})

// PAYMENT-SAFETY: Idempotency design
// - idempotencyKey is optional in the schema because some clients (legacy, mobile) may not send it.
// - Server generates a fallback UUID when missing (line below: `finalIdempotencyKey`).
// - The duplicate check only fires when the CLIENT sends a key, because a server-generated UUID
//   is unique per request and can never match an existing payment.
// - For true double-charge prevention, the client MUST generate a UUID on button press and resend
//   the same key on retries. The PaymentModal already does this.
const PaymentRequestSchema = z.object({
  payments: z.array(PaymentInputSchema).min(1, 'At least one payment is required'),
  employeeId: z.string().optional(),
  terminalId: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

// POST - Process payment for order
export const POST = withVenue(withTiming(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params
  const timing = getTimingFromRequest(request)
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()

    // Single query for order — replaces separate zero-check, idempotency, and main fetch queries
    // Includes items/employee/table so we can build receipt data in the response (avoids second fetch)
    timing.start('db-fetch')
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        location: true,
        customer: true,
        items: { where: { deletedAt: null }, include: { modifiers: { where: { deletedAt: null } }, menuItem: { select: { id: true, itemType: true } } } },
        employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
        table: { select: { id: true, name: true } },
      },
    })

    timing.end('db-fetch', 'Fetch order')

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Check for $0 order BEFORE Zod validation (Zod requires amount > 0,
    // but voided orders legitimately have $0 total and need to be closed)
    if (order.status !== 'paid' && order.status !== 'closed') {
      const zeroAlreadyPaid = order.payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + Number(p.totalAmount), 0)
      const zeroRemaining = Number(order.total) - zeroAlreadyPaid
      if (zeroRemaining <= 0) {
        await db.order.update({
          where: { id: orderId },
          data: { status: 'paid', paidAt: new Date() },
        })
        return NextResponse.json({ data: {
          success: true,
          orderId,
          orderStatus: 'paid',
          message: 'Order closed with $0 balance (all items voided/comped)',
          totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
        } })
      }
    }

    // ─── Normalize legacy / Android offline-sync payment format ───────────
    // Old callers (and PendingPayment offline queue) send a flat object:
    //   { paymentMethodId: "cash", amount: 123, tipAmount: 0, employeeId: "..." }
    // The Zod schema expects:
    //   { payments: [{ method: "cash", amount: 123 }], employeeId: "..." }
    // Transform the flat shape so both formats are accepted.
    if (!body.payments && (body.paymentMethodId || body.method || body.amount)) {
      const method = body.paymentMethodId || body.method || 'cash'
      body = {
        payments: [{
          method,
          amount: body.amount,
          ...(body.tipAmount !== undefined ? { tipAmount: body.tipAmount } : {}),
          ...(body.amountTendered !== undefined ? { amountTendered: body.amountTendered } : {}),
          ...(body.cardBrand !== undefined ? { cardBrand: body.cardBrand } : {}),
          ...(body.cardLast4 !== undefined ? { cardLast4: body.cardLast4 } : {}),
          ...(body.simulate !== undefined ? { simulate: body.simulate } : {}),
        }],
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        ...(body.terminalId ? { terminalId: body.terminalId } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      }
    }

    // Validate request body with Zod
    const validation = PaymentRequestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid payment request data',
          details: validation.error.format(),
        },
        { status: 400 }
      )
    }

    const { payments, employeeId, terminalId, idempotencyKey } = validation.data
    const finalIdempotencyKey = idempotencyKey || crypto.randomUUID()

    // Idempotency check using already-loaded payments (no extra query needed)
    if (idempotencyKey) {
      const duplicatePayments = order.payments.filter(
        p => p.idempotencyKey === idempotencyKey && p.status === 'completed'
      )
      if (duplicatePayments.length > 0) {
        // Return success with existing data — don't process again
        return NextResponse.json({ data: {
          success: true,
          duplicate: true,
          payments: duplicatePayments.map(p => ({
            id: p.id,
            method: p.paymentMethod,
            amount: Number(p.amount),
            tipAmount: Number(p.tipAmount),
            totalAmount: Number(p.totalAmount),
            status: p.status,
          })),
          orderStatus: order.status || 'unknown',
          remainingBalance: 0,
        } })
      }
    }

    // Server-side permission check for payment processing
    const auth = await requireAnyPermission(employeeId, order.locationId, [
      PERMISSIONS.POS_CASH_PAYMENTS,
      PERMISSIONS.POS_CARD_PAYMENTS,
    ])
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      // Return 200 (not 400) for already-paid orders so offline sync queues
      // treat this as success and stop retrying. The payment already went through.
      if (order.status === 'paid' || order.status === 'closed') {
        // Include all fields Android's PayOrderData expects so Moshi doesn't choke
        const existingPayment = await db.payment.findFirst({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
        })
        return NextResponse.json({ data: {
          success: true,
          alreadyPaid: true,
          orderId,
          paymentId: existingPayment?.id ?? 'already-paid',
          amount: existingPayment ? Number(existingPayment.amount) : Number(order.total),
          tipAmount: existingPayment ? Number(existingPayment.tipAmount) : 0,
          totalAmount: existingPayment ? Number(existingPayment.totalAmount) : Number(order.total),
          paymentMethod: existingPayment?.paymentMethod ?? body.paymentMethod ?? 'cash',
          newOrderBalance: 0,
          orderStatus: order.status,
          message: `Order already ${order.status}`,
        } })
      }
      return NextResponse.json(
        { error: 'Cannot pay an order with status: ' + order.status },
        { status: 400 }
      )
    }

    // Block direct payment of split parent orders — pay individual splits instead
    if (order.status === 'split') {
      return NextResponse.json(
        { error: 'Cannot pay a split parent order directly. Pay individual split checks instead.' },
        { status: 400 }
      )
    }

    // Validate parent order is still in split state when paying a split child
    if (order.parentOrderId) {
      const parentOrder = await db.order.findUnique({
        where: { id: order.parentOrderId },
        select: { status: true },
      })
      if (!parentOrder || parentOrder.status !== 'split') {
        return NextResponse.json(
          { error: 'Parent order is no longer in split state' },
          { status: 400 }
        )
      }
    }

    // Get settings for rounding
    const settings = parseSettings(order.location.settings)

    // SIMULATED_DEFAULTS guard: block simulated payments in production
    if (process.env.NODE_ENV === 'production' && settings.payments.processor === 'simulated') {
      console.error(
        `[PAY] BLOCKED: Location ${order.locationId} is using simulated payment processor in production. ` +
        'Configure a real Datacap merchantId before processing payments.'
      )
      return NextResponse.json(
        { error: 'Payment processor not configured for production. Contact your administrator.' },
        { status: 503 }
      )
    }

    // Compute current business day start for promotion on pay
    const locSettingsRaw = order.location.settings as Record<string, unknown> | null
    const dayStartTime = (locSettingsRaw?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

    // BUG #380: Settle per-minute entertainment pricing before calculating totals.
    // For timed_rental items with per-minute pricing, the order item's price was set to
    // the base price at ordering time. At payment, compute the actual charge from elapsed time.
    // H-FIN-5: All settlement writes happen inside a single transaction.
    // H-FIN-4: Tax is recalculated after price settlement (not just subtotal + old tax).
    const perMinuteItems = order.items.filter(
      (item: any) => item.menuItem?.itemType === 'timed_rental' && item.blockTimeStartedAt && !item.blockTimeExpiresAt
    )
    if (perMinuteItems.length > 0) {
      const now = new Date()
      const taxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })

      await db.$transaction(async (tx) => {
        for (const item of perMinuteItems) {
          const startedAt = new Date(item.blockTimeStartedAt!)
          const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000))

          // Fetch the menu item's pricing config
          const mi = await tx.menuItem.findUnique({
            where: { id: item.menuItemId },
            select: { ratePerMinute: true, minimumCharge: true, incrementMinutes: true, graceMinutes: true, price: true },
          })
          if (!mi) continue

          const ratePerMinute = mi.ratePerMinute ? Number(mi.ratePerMinute) : 0
          if (ratePerMinute <= 0) continue // Not per-minute pricing

          const pricing: EntertainmentPricing = {
            ratePerMinute,
            minimumCharge: mi.minimumCharge ? Number(mi.minimumCharge) : 0,
            incrementMinutes: mi.incrementMinutes ?? 15,
            graceMinutes: mi.graceMinutes ?? 5,
          }

          const breakdown = calculateCharge(elapsedMinutes, pricing)
          const settledPrice = breakdown.totalCharge

          // Update the order item's price to the settled per-minute charge
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              price: settledPrice,
              itemTotal: settledPrice * item.quantity,
            },
          })
        }

        // Recalculate the order total from all active items (once, after all items settled)
        const activeItems = await tx.orderItem.findMany({
          where: { orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }

        // H-FIN-4: Recalculate tax from the new subtotal (don't reuse stale taxTotal)
        const newTaxTotal = roundToCents(newSubtotal * taxRate)
        const newTotal = roundToCents(newSubtotal + newTaxTotal)

        await tx.order.update({
          where: { id: orderId },
          data: {
            subtotal: newSubtotal,
            taxTotal: newTaxTotal,
            total: newTotal,
          },
        })

        // Refresh order reference for accurate total below
        ;(order as any).subtotal = newSubtotal
        ;(order as any).taxTotal = newTaxTotal
        ;(order as any).total = newTotal
      })
    }

    // Calculate how much is already paid
    const alreadyPaid = order.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    const orderTotal = Number(order.total)
    const remaining = orderTotal - alreadyPaid

    // If order total is $0 (e.g., all items voided), close the order without payment
    if (remaining <= 0 && alreadyPaid === 0) {
      await db.order.update({
        where: { id: orderId },
        data: { status: 'paid', paidAt: new Date() },
      })
      return NextResponse.json({ data: {
        success: true,
        orderId,
        message: 'Order closed with $0 balance (all items voided/comped)',
        totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
      } })
    }

    // Calculate total being paid now
    const paymentTotal = payments.reduce((sum, p) => sum + p.amount + (p.tipAmount || 0), 0)

    // When cash rounding is enabled, the client sends the ROUNDED amount
    // (e.g., $3.29 rounded to $3.25 with quarter rounding). The tolerance
    // must account for the rounding increment to avoid false rejections.
    // Two rounding systems exist:
    //   1. priceRounding (Skill 88) — increment-based ('0.05', '0.25', etc.)
    //   2. cashRounding (legacy) — named modes ('nickel', 'quarter', etc.)
    // priceRounding takes precedence when enabled.
    const hasCashPayment = payments.some(p => p.method === 'cash')
    let validationRemaining = remaining
    if (hasCashPayment) {
      if (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
        validationRemaining = applyPriceRounding(remaining, settings.priceRounding, 'cash')
      } else if (settings.payments.cashRounding !== 'none') {
        validationRemaining = roundAmount(
          remaining,
          settings.payments.cashRounding,
          settings.payments.roundingDirection
        )
      }
    }

    if (paymentTotal < validationRemaining - 0.01) {
      return NextResponse.json(
        { error: `Payment amount ($${paymentTotal.toFixed(2)}) is less than remaining balance ($${validationRemaining.toFixed(2)})` },
        { status: 400 }
      )
    }

    // Validate payment amounts upfront
    for (const payment of payments) {
      const paymentAmount = payment.amount + (payment.tipAmount || 0)

      // Validate amount is a valid number
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        return NextResponse.json(
          { error: `Invalid payment amount: ${paymentAmount}. Amount must be a positive number.` },
          { status: 400 }
        )
      }

      // Prevent unreasonably large payments (potential UI bugs)
      const maxReasonablePayment = orderTotal * 1.5
      if (paymentAmount > maxReasonablePayment) {
        return NextResponse.json(
          { error: `Payment amount $${paymentAmount.toFixed(2)} exceeds reasonable limit (150% of order total). This may indicate an error.` },
          { status: 400 }
        )
      }

      // Validate Datacap field mutual exclusivity for card payments
      if (payment.method === 'credit' || payment.method === 'debit') {
        const hasAnyDatacapField = !!(
          payment.datacapRecordNo ||
          payment.datacapRefNumber ||
          payment.datacapSequenceNo ||
          payment.entryMethod ||
          payment.signatureData ||
          payment.amountAuthorized
        )

        const hasAllRequiredDatacapFields = !!(
          payment.datacapRecordNo &&
          payment.datacapRefNumber &&
          payment.cardLast4
        )

        // If ANY Datacap field is present, ensure ALL required fields are present
        if (hasAnyDatacapField && !hasAllRequiredDatacapFields) {
          return NextResponse.json(
            {
              error: 'Partial Datacap data detected. Card payments must have either all Datacap fields (RecordNo, RefNumber, CardLast4) or none. This indicates a corrupted payment record.',
              details: {
                hasDatacapRecordNo: !!payment.datacapRecordNo,
                hasDatacapRefNumber: !!payment.datacapRefNumber,
                hasCardLast4: !!payment.cardLast4,
              }
            },
            { status: 400 }
          )
        }
      }
    }

    // Process each payment
    // Payments from special types (loyalty, gift card, house account) are created
    // inside their own transactions. Default payments (cash, card) are collected
    // and created atomically with the order status update below.
    const createdPayments: Awaited<ReturnType<typeof db.payment.create>>[] = []
    const pendingDefaultRecords: Record<string, unknown>[] = []
    let totalTips = 0
    let alreadyPaidInLoop = 0

    // Resolve drawer ONCE before the loop (instead of per-payment)
    const drawerAttribution = await resolveDrawerForPayment(
      'cash', // Resolve for cash (non-cash returns null anyway)
      employeeId || null,
      terminalId,
    )

    for (const payment of payments) {
      // Use cached attribution for cash, null for non-cash
      const attribution = payment.method === 'cash'
        ? drawerAttribution
        : { drawerId: null, shiftId: null }

      let paymentRecord: {
        locationId: string
        orderId: string
        employeeId: string | null
        drawerId?: string | null
        shiftId?: string | null
        terminalId?: string | null
        amount: number
        tipAmount: number
        totalAmount: number
        paymentMethod: PaymentMethod
        amountTendered?: number
        changeGiven?: number
        roundingAdjustment?: number
        cardBrand?: string
        cardLast4?: string
        authCode?: string
        transactionId?: string
        datacapRecordNo?: string
        datacapRefNumber?: string
        datacapSequenceNo?: string
        entryMethod?: string
        signatureData?: string
        amountAuthorized?: number
        amountRequested?: number
        cashDiscountAmount?: number
        priceBeforeDiscount?: number
        pricingMode?: string
        idempotencyKey?: string
        status: PaymentStatus
      } = {
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
        idempotencyKey: finalIdempotencyKey,
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
          const expectedCardAmount = calculateCardPrice(Number(order.total), dualPricing.cashDiscountPercent)
          if (Math.abs(payment.amount - expectedCardAmount) > 0.01) {
            console.warn(`[DualPricing] Card payment amount $${payment.amount} differs from expected $${expectedCardAmount} for order ${orderId}`)
          }
        }
      }

      if (payment.method === 'cash') {
        // Apply rounding if enabled (priceRounding takes precedence over legacy cashRounding)
        let finalAmount = payment.amount
        let roundingAdjustment = 0

        // The client already sends the rounded amount (e.g. $3.25 from $3.29).
        // To compute the adjustment, compare against the raw remaining balance.
        const rawRemaining = roundToCents(remaining - alreadyPaidInLoop)
        if (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
          const rounded = applyPriceRounding(rawRemaining, settings.priceRounding, 'cash')
          roundingAdjustment = Math.round((rounded - rawRemaining) * 100) / 100
          finalAmount = payment.amount // already rounded by client
        } else if (settings.payments.cashRounding !== 'none') {
          roundingAdjustment = calculateRoundingAdjustment(
            rawRemaining,
            settings.payments.cashRounding,
            settings.payments.roundingDirection
          )
          finalAmount = roundAmount(
            rawRemaining,
            settings.payments.cashRounding,
            settings.payments.roundingDirection
          )
        }

        const amountTendered = payment.amountTendered || finalAmount + (payment.tipAmount || 0)
        const changeGiven = Math.max(0, amountTendered - finalAmount - (payment.tipAmount || 0))

        // Dual pricing: calculate from post-rounding amount
        if (dualPricing?.enabled && paymentRecord.pricingMode === 'cash') {
          const cardPrice = calculateCardPrice(finalAmount, dualPricing.cashDiscountPercent)
          const discountAmount = calculateCashDiscount(cardPrice, dualPricing.cashDiscountPercent)
          paymentRecord.priceBeforeDiscount = cardPrice
          paymentRecord.cashDiscountAmount = discountAmount

          // Validate: cash amount should match expected cash price (warn, don't reject)
          // When priceRounding is active, the rounded amount will differ from order.total — that's expected
          const expectedCashAmount = Number(order.total)
          const roundingTolerance = (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) ? 0.50 : 0.01
          if (Math.abs(finalAmount - expectedCashAmount) > roundingTolerance) {
            console.warn(`[DualPricing] Cash payment amount $${finalAmount} differs from total $${expectedCashAmount} for order ${orderId}`)
          }
        }

        paymentRecord = {
          ...paymentRecord,
          amount: finalAmount,
          totalAmount: finalAmount + (payment.tipAmount || 0),
          amountTendered,
          changeGiven,
          roundingAdjustment: roundingAdjustment !== 0 ? roundingAdjustment : undefined,
        }
      } else if (payment.method === 'credit' || payment.method === 'debit') {
        // Default cardLast4 to '0000' if missing or invalid (e.g. simulated payments)
        if (!payment.cardLast4 || !/^\d{4}$/.test(payment.cardLast4)) {
          payment.cardLast4 = '0000'
        }

        // Use real Datacap fields when available, fall back to simulated
        const isDatacap = !!payment.datacapRecordNo || !!payment.datacapRefNumber
        paymentRecord = {
          ...paymentRecord,
          cardBrand: payment.cardBrand || 'visa',
          cardLast4: payment.cardLast4,
          authCode: isDatacap ? payment.authCode : generateFakeAuthCode(),
          transactionId: isDatacap ? payment.datacapRefNumber : generateFakeTransactionId(),
          ...(isDatacap && {
            datacapRecordNo: payment.datacapRecordNo,
            datacapRefNumber: payment.datacapRefNumber,
            datacapSequenceNo: payment.datacapSequenceNo,
            entryMethod: payment.entryMethod,
            signatureData: payment.signatureData,
            amountAuthorized: payment.amountAuthorized,
            amountRequested: payment.amount,
          }),
        }
      } else if (payment.method === 'loyalty_points') {
        // Loyalty points redemption
        if (!settings.loyalty.enabled || !settings.loyalty.redemptionEnabled) {
          return NextResponse.json(
            { error: 'Loyalty points redemption is not enabled' },
            { status: 400 }
          )
        }

        if (!order.customer) {
          return NextResponse.json(
            { error: 'Customer is required to redeem loyalty points' },
            { status: 400 }
          )
        }

        const pointsNeeded = Math.ceil(payment.amount * settings.loyalty.pointsPerDollarRedemption)

        if (!payment.pointsUsed || payment.pointsUsed < pointsNeeded) {
          return NextResponse.json(
            { error: `${pointsNeeded} points required for $${payment.amount.toFixed(2)} redemption` },
            { status: 400 }
          )
        }

        // Pre-flight check (non-authoritative — authoritative check is inside tx)
        if (order.customer.loyaltyPoints < payment.pointsUsed) {
          return NextResponse.json(
            { error: `Insufficient points. Customer has ${order.customer.loyaltyPoints} points.` },
            { status: 400 }
          )
        }

        // Check minimum redemption
        if (payment.pointsUsed < settings.loyalty.minimumRedemptionPoints) {
          return NextResponse.json(
            { error: `Minimum ${settings.loyalty.minimumRedemptionPoints} points required for redemption` },
            { status: 400 }
          )
        }

        // Check maximum redemption percentage
        const maxRedemptionAmount = orderTotal * (settings.loyalty.maximumRedemptionPercent / 100)
        if (payment.amount > maxRedemptionAmount) {
          return NextResponse.json(
            { error: `Maximum ${settings.loyalty.maximumRedemptionPercent}% of order can be paid with points` },
            { status: 400 }
          )
        }

        // Store points used in payment record metadata
        paymentRecord = {
          ...paymentRecord,
          transactionId: `LOYALTY:${payment.pointsUsed}pts`,
        }

        // H-FIN-3: Read fresh balance + check + decrement ALL inside transaction
        // to prevent TOCTOU race where concurrent redemptions bypass balance check
        const loyaltyResult = await db.$transaction(async (tx) => {
          const freshCustomer = await tx.customer.findUnique({
            where: { id: order.customer!.id },
            select: { loyaltyPoints: true },
          })
          if (!freshCustomer || freshCustomer.loyaltyPoints < payment.pointsUsed!) {
            throw new Error(`LOYALTY_INSUFFICIENT:${freshCustomer?.loyaltyPoints ?? 0}`)
          }
          await tx.customer.update({
            where: { id: order.customer!.id },
            data: {
              loyaltyPoints: { decrement: payment.pointsUsed! },
            },
          })
          return tx.payment.create({ data: paymentRecord })
        }).catch((err: Error) => {
          if (err.message.startsWith('LOYALTY_INSUFFICIENT:')) {
            const pts = parseInt(err.message.split(':')[1], 10)
            return { error: `Insufficient points. Customer has ${pts} points.`, status: 400 } as const
          }
          throw err
        })

        if ('error' in loyaltyResult) {
          return NextResponse.json(
            { error: loyaltyResult.error },
            { status: loyaltyResult.status }
          )
        }

        createdPayments.push(loyaltyResult)
        totalTips += payment.tipAmount || 0
        continue
      } else if (payment.method === 'gift_card') {
        // Gift card payment
        if (!settings.payments.acceptGiftCards) {
          return NextResponse.json(
            { error: 'Gift cards are not accepted' },
            { status: 400 }
          )
        }

        const giftCardLookup = payment.giftCardId || payment.giftCardNumber
        if (!giftCardLookup) {
          return NextResponse.json(
            { error: 'Gift card ID or number is required' },
            { status: 400 }
          )
        }

        // Find gift card and deduct balance atomically inside a single transaction
        // This prevents TOCTOU race conditions on the gift card balance
        const gcResult = await db.$transaction(async (tx) => {
          let giftCard = await tx.giftCard.findUnique({
            where: { id: payment.giftCardId || '' }
          })

          if (!giftCard && payment.giftCardNumber) {
            giftCard = await tx.giftCard.findUnique({
              where: { cardNumber: payment.giftCardNumber.toUpperCase() }
            })
          }

          if (!giftCard) {
            throw new Error('GC_NOT_FOUND')
          }

          if (giftCard.status !== 'active') {
            throw new Error(`GC_STATUS:${giftCard.status}`)
          }

          // Check expiration
          if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
            await tx.giftCard.update({
              where: { id: giftCard.id },
              data: { status: 'expired' }
            })
            throw new Error('GC_EXPIRED')
          }

          const cardBalance = Number(giftCard.currentBalance)
          const paymentAmount = payment.amount + (payment.tipAmount || 0)

          // H-FIN-2: Verify balance >= amount INSIDE transaction to prevent negative balance
          if (cardBalance < paymentAmount) {
            throw new Error(`GC_INSUFFICIENT:${cardBalance}`)
          }

          const newBalance = cardBalance - paymentAmount

          paymentRecord = {
            ...paymentRecord,
            transactionId: `GC:${giftCard.cardNumber}`,
            cardLast4: giftCard.cardNumber.slice(-4),
          }

          // H-FIN-2: Use atomic decrement instead of SET to prevent TOCTOU race
          await tx.giftCard.update({
            where: { id: giftCard.id },
            data: {
              currentBalance: { decrement: paymentAmount },
              status: newBalance === 0 ? 'depleted' : 'active',
              transactions: {
                create: {
                  locationId: order.locationId,
                  type: 'redemption',
                  amount: -paymentAmount,
                  balanceBefore: cardBalance,
                  balanceAfter: newBalance,
                  orderId,
                  employeeId: employeeId || null,
                  notes: `Payment for order #${order.orderNumber}`,
                }
              }
            }
          })
          return tx.payment.create({ data: paymentRecord })
        }).catch((err: Error) => {
          // Convert transaction errors to HTTP responses
          if (err.message === 'GC_NOT_FOUND') {
            return { error: 'Gift card not found', status: 404 } as const
          }
          if (err.message.startsWith('GC_STATUS:')) {
            return { error: `Gift card is ${err.message.split(':')[1]}`, status: 400 } as const
          }
          if (err.message === 'GC_EXPIRED') {
            return { error: 'Gift card has expired', status: 400 } as const
          }
          if (err.message.startsWith('GC_INSUFFICIENT:')) {
            const balance = parseFloat(err.message.split(':')[1])
            return { error: `Insufficient gift card balance ($${balance.toFixed(2)})`, currentBalance: balance, status: 400 } as const
          }
          throw err // Re-throw unexpected errors
        })

        // If the transaction returned an error object, return it as HTTP response
        if ('error' in gcResult) {
          return NextResponse.json(
            { error: gcResult.error, ...('currentBalance' in gcResult ? { currentBalance: gcResult.currentBalance } : {}) },
            { status: gcResult.status }
          )
        }

        createdPayments.push(gcResult)
        totalTips += payment.tipAmount || 0
        continue
      } else if (payment.method === 'house_account') {
        // House account payment
        if (!settings.payments.acceptHouseAccounts) {
          return NextResponse.json(
            { error: 'House accounts are not accepted' },
            { status: 400 }
          )
        }

        if (!payment.houseAccountId) {
          return NextResponse.json(
            { error: 'House account ID is required' },
            { status: 400 }
          )
        }

        const paymentAmount = payment.amount + (payment.tipAmount || 0)

        // C-FIN-1: Read balance, check credit limit, and increment ALL inside the
        // transaction to prevent race conditions on concurrent house account charges.
        // Previously, balance was read outside the tx and SET inside — two concurrent
        // payments would both read the same balance and one would overwrite the other.
        const haResult = await db.$transaction(async (tx) => {
          const freshAccount = await tx.houseAccount.findUnique({
            where: { id: payment.houseAccountId! }
          })

          if (!freshAccount) {
            throw new Error('HA_NOT_FOUND')
          }

          if (freshAccount.status !== 'active') {
            throw new Error(`HA_STATUS:${freshAccount.status}`)
          }

          const currentBalance = Number(freshAccount.currentBalance)
          const creditLimit = Number(freshAccount.creditLimit)
          const newBalance = currentBalance + paymentAmount

          // Check credit limit inside transaction with fresh balance (0 = unlimited)
          if (creditLimit > 0 && newBalance > creditLimit) {
            throw new Error(`HA_CREDIT_LIMIT:${currentBalance}:${creditLimit}`)
          }

          // Calculate due date
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + (freshAccount.paymentTerms ?? 30))

          // Atomic increment instead of direct SET to prevent lost updates
          await tx.houseAccount.update({
            where: { id: freshAccount.id },
            data: {
              currentBalance: { increment: paymentAmount },
              transactions: {
                create: {
                  locationId: order.locationId,
                  type: 'charge',
                  amount: paymentAmount,
                  balanceBefore: currentBalance,
                  balanceAfter: newBalance,
                  orderId,
                  employeeId: employeeId || null,
                  notes: `Order #${order.orderNumber}`,
                  dueDate,
                }
              }
            }
          })

          return tx.payment.create({
            data: {
              ...paymentRecord,
              transactionId: `HA:${freshAccount.id}`,
              authCode: freshAccount.name,
            }
          })
        }).catch((err: Error) => {
          if (err.message === 'HA_NOT_FOUND') {
            return { error: 'House account not found', status: 404 } as const
          }
          if (err.message.startsWith('HA_STATUS:')) {
            return { error: `House account is ${err.message.split(':')[1]}`, status: 400 } as const
          }
          if (err.message.startsWith('HA_CREDIT_LIMIT:')) {
            const [, bal, lim] = err.message.split(':')
            const currentBalance = parseFloat(bal)
            const creditLimit = parseFloat(lim)
            return {
              error: 'Charge would exceed credit limit',
              currentBalance,
              creditLimit,
              availableCredit: Math.max(0, creditLimit - currentBalance),
              status: 400,
            } as const
          }
          throw err
        })

        // If the transaction returned an error object, return it as HTTP response
        if ('error' in haResult) {
          return NextResponse.json(
            {
              error: haResult.error,
              ...('currentBalance' in haResult ? {
                currentBalance: (haResult as any).currentBalance,
                creditLimit: (haResult as any).creditLimit,
                availableCredit: (haResult as any).availableCredit,
              } : {}),
            },
            { status: haResult.status }
          )
        }

        createdPayments.push(haResult)
        totalTips += payment.tipAmount || 0
        continue
      }

      pendingDefaultRecords.push(paymentRecord)
      totalTips += payment.tipAmount || 0
      alreadyPaidInLoop += payment.amount
    }

    // Update order status and tip total
    const newTipTotal = Number(order.tipTotal) + totalTips
    const newPaidTotal = alreadyPaid + paymentTotal

    // When price rounding is active for cash, the paid amount may be less than orderTotal
    // by up to the rounding increment (e.g., $3.25 paid for $3.29 order with quarter rounding).
    // The tolerance must cover this gap so the order is marked fully paid.
    const hasCash = payments.some(p => p.method === 'cash')
    const paidTolerance = (hasCash && settings.priceRounding?.enabled && settings.priceRounding.applyToCash)
      ? roundToCents(parseFloat(settings.priceRounding.increment) / 2)  // Half the increment covers rounding in either direction
      : 0.01

    const updateData: {
      tipTotal: number
      primaryPaymentMethod?: PaymentMethod
      status?: OrderStatus
      paidAt?: Date
      closedAt?: Date
      businessDayDate: Date
    } = {
      tipTotal: newTipTotal,
      businessDayDate: businessDayStart,
    }

    // Set primary payment method based on first/largest payment
    if (!order.primaryPaymentMethod) {
      const primaryMethod = payments[0].method
      updateData.primaryPaymentMethod = (primaryMethod === 'cash' ? 'cash' : 'card') as PaymentMethod
    }

    // Mark as paid if fully paid
    if (newPaidTotal >= orderTotal - paidTolerance) {
      updateData.status = 'paid'
      updateData.paidAt = new Date()
      updateData.closedAt = new Date()
    }

    // Pre-compute loyalty points BEFORE the transaction (avoid nested findUnique inside tx)
    let pointsEarned = 0
    let loyaltyEarningBase = 0
    if (updateData.status === 'paid' && order.customer && settings.loyalty.enabled) {
      loyaltyEarningBase = settings.loyalty.earnOnSubtotal
        ? Number(order.subtotal)
        : Number(order.total)
      if (settings.loyalty.earnOnTips) {
        loyaltyEarningBase += newTipTotal
      }
      if (loyaltyEarningBase >= settings.loyalty.minimumEarnAmount) {
        pointsEarned = Math.floor(loyaltyEarningBase * settings.loyalty.pointsPerDollar)
      }
    }

    // Pre-compute averageTicket using already-fetched customer data (no extra query needed)
    let newAverageTicket: number | null = null
    if (pointsEarned > 0 && order.customer) {
      const currentTotalSpent = Number((order.customer as any).totalSpent ?? 0)
      const currentTotalOrders = (order.customer as any).totalOrders ?? 0
      const newTotal = currentTotalSpent + Number(order.total)
      const newOrders = currentTotalOrders + 1
      newAverageTicket = newTotal / newOrders
    }

    // PAYMENT-SAFETY: NEVER OPTIMISTIC PAID
    // The order status transitions to 'paid' ONLY inside this atomic $transaction, AFTER
    // all Payment records are created. For card payments, the gateway auth happens CLIENT-SIDE
    // before this route is called — the route validates proof of authorization (datacapRecordNo +
    // datacapRefNumber + cardLast4) in the Zod + field validation above. The updateMany uses
    // `where: { status: { in: ['open', 'in_progress'] } }` as a DB-level guard against double-pay.
    let parentWasMarkedPaid = false
    let parentTableId: string | null = null

    timing.start('db-pay')
    try {
      await db.$transaction(async (tx) => {
        // W1-P5: Lock parent row FIRST to prevent split payment race condition.
        // Two siblings paying concurrently must serialize here so "all siblings paid?"
        // check is always consistent.
        if (order.parentOrderId) {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.parentOrderId} FOR UPDATE`
        }

        for (const record of pendingDefaultRecords) {
          const created = await tx.payment.create({ data: record as Parameters<typeof tx.payment.create>[0]['data'] })
          createdPayments.push(created)

          // Audit log: payment processed
          await tx.auditLog.create({
            data: {
              locationId: order.locationId,
              employeeId: employeeId || null,
              action: 'payment_processed',
              entityType: 'payment',
              entityId: created.id,
              details: {
                paymentMethod: created.paymentMethod,
                amount: Number(created.amount),
                tipAmount: Number(created.tipAmount),
                orderId,
                orderNumber: order.orderNumber,
              },
            },
          })
        }
        const orderUpdateResult = await tx.order.updateMany({
          where: { id: orderId, status: { in: ['open', 'in_progress'] } },
          data: { ...updateData, version: { increment: 1 } },
        })
        if (orderUpdateResult.count === 0) {
          throw new Error('ORDER_ALREADY_PAID')
        }

        // Audit log: order closed (when fully paid)
        if (updateData.status === 'paid') {
          await tx.auditLog.create({
            data: {
              locationId: order.locationId,
              employeeId: employeeId || null,
              action: 'order_closed',
              entityType: 'order',
              entityId: orderId,
              details: {
                orderNumber: order.orderNumber,
                totalPaid: newPaidTotal,
                paymentCount: createdPayments.length,
                paymentMethods: [...new Set(createdPayments.map(p => p.paymentMethod))],
              },
            },
          })
        }

        // Award loyalty points atomically with the payment (moved inside transaction)
        if (pointsEarned > 0 && order.customer) {
          await tx.customer.update({
            where: { id: order.customer.id },
            data: {
              loyaltyPoints: { increment: pointsEarned },
              totalSpent: { increment: Number(order.total) },
              totalOrders: { increment: 1 },
              lastVisit: new Date(),
              averageTicket: newAverageTicket!,
            },
          })
        }

        // W1-P5: Check if all split siblings are paid and mark parent as paid.
        // Parent row was already locked at the top of this transaction, so the
        // sibling status read is guaranteed to be serialized.
        if (updateData.status === 'paid' && order.parentOrderId) {
          const allSiblings = await tx.order.findMany({
            where: { parentOrderId: order.parentOrderId },
            select: { id: true, status: true },
          })

          const allSiblingsPaid = allSiblings.every(s => s.status === 'paid')

          if (allSiblingsPaid) {
            const parentResult = await tx.order.update({
              where: { id: order.parentOrderId },
              data: { status: 'paid', paidAt: new Date(), closedAt: new Date() },
              select: { tableId: true },
            })
            parentWasMarkedPaid = true
            parentTableId = parentResult.tableId
          }
        }
      })
    } catch (txError) {
      if (txError instanceof Error && txError.message === 'ORDER_ALREADY_PAID') {
        // Return 200 (not 409) so offline outbox queues treat this as success.
        // The order was already paid — mission accomplished.
        const existingPayment = await db.payment.findFirst({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
        })
        const freshOrder = await db.order.findUnique({ where: { id: orderId }, select: { total: true, status: true } })
        return NextResponse.json({ data: {
          success: true,
          alreadyPaid: true,
          orderId,
          paymentId: existingPayment?.id ?? 'already-paid',
          amount: existingPayment ? Number(existingPayment.amount) : Number(freshOrder?.total ?? 0),
          tipAmount: existingPayment ? Number(existingPayment.tipAmount) : 0,
          totalAmount: existingPayment ? Number(existingPayment.totalAmount) : Number(freshOrder?.total ?? 0),
          paymentMethod: existingPayment?.paymentMethod ?? 'cash',
          newOrderBalance: 0,
          orderStatus: freshOrder?.status ?? 'paid',
        } })
      }

      // W1-P3: If DB transaction failed but card was already charged at Datacap,
      // attempt automatic void to prevent invisible charges (customer charged, no POS record).
      const cardRecordsToVoid = pendingDefaultRecords.filter(
        (r: any) => (r.paymentMethod === 'credit' || r.paymentMethod === 'debit') && r.datacapRecordNo
      )
      if (cardRecordsToVoid.length > 0 && terminalId) {
        // Fire-and-forget void attempts — log results but don't block error response
        void (async () => {
          try {
            const terminal = await db.terminal.findUnique({
              where: { id: terminalId },
              select: { paymentReaderId: true },
            })
            if (!terminal?.paymentReaderId) {
              console.error('[CRITICAL-PAYMENT] Cannot auto-void: no reader bound to terminal', {
                terminalId, orderId, records: cardRecordsToVoid.map((r: any) => r.datacapRecordNo),
              })
              return
            }
            const client = await getDatacapClient(order.locationId)
            for (const record of cardRecordsToVoid) {
              const recordNo = (record as any).datacapRecordNo
              try {
                const voidResult = await client.voidSale(terminal.paymentReaderId!, { recordNo })
                const voided = voidResult.cmdStatus === 'Approved'
                console.error(`[CRITICAL-PAYMENT] Auto-void ${voided ? 'SUCCEEDED' : 'FAILED'} for recordNo=${recordNo}`, {
                  orderId,
                  amount: (record as any).amount,
                  voidResult: { cmdStatus: voidResult.cmdStatus, textResponse: voidResult.textResponse },
                })
              } catch (voidErr) {
                console.error(`[CRITICAL-PAYMENT] Auto-void EXCEPTION for recordNo=${recordNo}`, {
                  orderId, amount: (record as any).amount, error: voidErr,
                })
              }
            }
          } catch (lookupErr) {
            console.error('[CRITICAL-PAYMENT] Auto-void lookup failed', {
              orderId, terminalId, error: lookupErr,
            })
          }
        })()

        // Return specific error so client knows reversal was attempted
        return NextResponse.json(
          {
            error: 'Payment approved but recording failed — automatic reversal attempted. Check Datacap portal to confirm.',
            datacapRecordNos: cardRecordsToVoid.map((r: any) => r.datacapRecordNo),
          },
          { status: 500 }
        )
      }

      throw txError // Re-throw unexpected errors to the outer catch
    }
    timing.end('db-pay', 'Payment transaction')

    // Dispatch socket events when parent order was auto-closed (after transaction commit)
    if (parentWasMarkedPaid) {
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'paid',
        orderId: order.parentOrderId!,
        tableId: parentTableId || undefined,
        sourceTerminalId: terminalId || undefined,
      }).catch(() => {})
      void dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(() => {})
      invalidateSnapshotCache(order.locationId)

      // Free the parent order's table (child split orders have no tableId)
      if (parentTableId) {
        void db.table.update({
          where: { id: parentTableId },
          data: { status: 'available' },
        }).then(() => {
          invalidateSnapshotCache(order.locationId)
        }).catch(err => {
          console.error('[Pay] Parent table status reset failed:', err)
        })
      }
    }

    // If order is fully paid, reset entertainment items and table status
    if (updateData.status === 'paid') {
      void db.menuItem.updateMany({
        where: {
          currentOrderId: orderId,
          itemType: 'timed_rental',
        },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      }).catch(err => {
        console.error('[Pay] Entertainment reset failed:', err)
      })

      // Deduct inventory (food + liquor) — fire-and-forget to not block payment.
      // Handles MenuItemRecipes, RecipeIngredients (cocktails), ModifierInventoryLinks,
      // and spirit tier substitutions (linkedBottleProduct on OrderItemModifier).
      void deductInventoryForOrder(orderId, employeeId).catch(err => {
        console.error('Background inventory deduction failed:', err)
      })

      // Kick cash drawer on cash payments (Skill 56) — fire-and-forget
      // Failure must never fail the payment response
      if (hasCash) {
        void triggerCashDrawer(order.locationId).catch(() => {})
      }

      // Allocate tips via the tip bank pipeline (Skill 269)
      // Handles: CC fee deduction, tip group detection, ownership splits, ledger posting
      // Fire-and-forget to not block payment response
      // Skill 277: kind defaults to 'tip' (voluntary gratuity). Future callers
      // (e.g. bottle service auto-gratuity) should pass 'auto_gratuity' or 'service_charge'.
      // Resolve tip owner: order's assigned employee, or the processing employee as fallback.
      // Without fallback, tips on unassigned orders (e.g. walk-up kiosk) would be silently dropped.
      const tipOwnerEmployeeId = order.employeeId || employeeId
      if (totalTips > 0 && tipOwnerEmployeeId) {
        void allocateTipsForPayment({
          locationId: order.locationId,
          orderId,
          primaryEmployeeId: tipOwnerEmployeeId,
          createdPayments,
          totalTipsDollars: totalTips,
          tipBankSettings: settings.tipBank,
          // kind: 'tip' (default — voluntary gratuity from customer)
        }).catch(err => {
          console.error('Background tip allocation failed:', err)
        })
      }

      // Reset table status to available (fire-and-forget — don't block payment response)
      if (order.tableId) {
        void db.table.update({
          where: { id: order.tableId },
          data: { status: 'available' },
        }).then(() => {
          // Invalidate snapshot cache after table update completes so floor plan gets fresh data
          invalidateSnapshotCache(order.locationId)
        }).catch(err => {
          console.error('[Pay] Table status reset failed:', err)
        })
      }

      // Clean up temporary seats then dispatch floor plan update
      // Chain: cleanup must finish BEFORE dispatch so snapshot doesn't still see temp seats
      void cleanupTemporarySeats(orderId)
        .then(() => {
          if (order.tableId && updateData.status === 'paid') {
            return dispatchFloorPlanUpdate(order.locationId, { async: true })
          }
        })
        .catch(console.error)
    }

    // Dispatch real-time order totals update (tip changed) — fire-and-forget
    if (totalTips > 0) {
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        tipTotal: newTipTotal,
        discountTotal: Number(order.discountTotal),
        total: Number(order.total),
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch order totals update:', err)
      })
    }

    // Dispatch payment:processed for each created payment (fire-and-forget)
    for (const p of createdPayments) {
      void dispatchPaymentProcessed(order.locationId, { orderId, paymentId: p.id, status: 'completed', sourceTerminalId: terminalId || undefined }).catch(() => {})
    }

    // Dispatch open orders list changed when order is fully paid (fire-and-forget)
    // Include sourceTerminalId so receiving clients can suppress "closed on another terminal" banners
    if (updateData.status === 'paid') {
      void dispatchOpenOrdersChanged(order.locationId, { trigger: 'paid', orderId: order.id, tableId: order.tableId || undefined, sourceTerminalId: terminalId || undefined }, { async: true }).catch(() => {})
    }

    // Notify CFD that receipt was sent — transitions CFD to thank-you screen (fire-and-forget)
    if (updateData.status === 'paid') {
      dispatchCFDReceiptSent(order.locationId, {
        orderId: order.id,
        total: Number(order.total),
      })
    }

    // Emit cloud event for fully paid orders (fire-and-forget)
    if (updateData.status === 'paid') {
      void emitCloudEvent('order_paid', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        venueId: order.locationId,
        employeeId: order.employeeId,
        customerId: order.customerId,
        orderType: order.orderType,
        paidAt: updateData.paidAt,
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        tipTotal: newTipTotal,
        discountTotal: Number(order.discountTotal),
        total: Number(order.total),
        payments: createdPayments.map(p => ({
          id: p.id,
          method: p.paymentMethod,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          cardLast4: p.cardLast4 ?? null,
        })),
      }).catch(console.error)
    }

    // Build receipt data inline (eliminates separate /receipt fetch)
    const receiptData = {
      id: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      orderType: order.orderType,
      tabName: order.tabName,
      tableName: order.table?.name || null,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      location: {
        name: order.location.name,
        address: order.location.address,
        phone: order.location.phone,
      },
      items: order.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
        itemTotal: Number(item.itemTotal),
        specialNotes: item.specialNotes,
        status: item.status,
        modifiers: (item.modifiers || []).map((mod: any) => ({
          id: mod.id,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
        })),
      })),
      payments: createdPayments.map(p => ({
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        authCode: p.authCode,
        amountTendered: p.amountTendered ? Number(p.amountTendered) : null,
        changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
      })),
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      createdAt: order.createdAt.toISOString(),
      paidAt: new Date().toISOString(),
      customer: order.customer ? {
        name: (order.customer as any).displayName || `${(order.customer as any).firstName} ${(order.customer as any).lastName}`,
        loyaltyPoints: (order.customer as any).loyaltyPoints,
      } : null,
      loyaltyPointsRedeemed: null,
      loyaltyPointsEarned: pointsEarned || null,
    }

    // Emit order events for each payment (fire-and-forget)
    for (const p of createdPayments) {
      void emitOrderEvent(order.locationId, orderId, 'PAYMENT_APPLIED', {
        paymentId: p.id,
        method: p.paymentMethod,
        amountCents: Math.round(Number(p.amount) * 100),
        tipCents: Math.round(Number(p.tipAmount || 0) * 100),
        totalCents: Math.round(Number(p.totalAmount) * 100),
        cardBrand: p.cardBrand ?? null,
        cardLast4: p.cardLast4 ?? null,
        status: 'approved',
      })
    }
    if (updateData.status === 'paid') {
      void emitOrderEvent(order.locationId, orderId, 'ORDER_CLOSED', {
        closedStatus: 'paid',
      })
    }

    // Return response — includes flat fields for Android's PayOrderData DTO
    const primaryPayment = createdPayments[0]
    const finalStatus = newPaidTotal >= orderTotal - paidTolerance ? 'paid' : 'partial'
    const finalBalance = newPaidTotal >= orderTotal - paidTolerance ? 0 : Math.max(0, orderTotal - newPaidTotal)
    return NextResponse.json({ data: {
      success: true,
      // Flat fields for Android compatibility
      orderId,
      paymentId: primaryPayment?.id ?? null,
      amount: primaryPayment ? Number(primaryPayment.amount) : 0,
      tipAmount: primaryPayment ? Number(primaryPayment.tipAmount) : 0,
      totalAmount: primaryPayment ? Number(primaryPayment.totalAmount) : 0,
      paymentMethod: primaryPayment?.paymentMethod ?? 'cash',
      newOrderBalance: finalBalance,
      orderStatus: finalStatus,
      // Full payment list for web POS
      payments: createdPayments.map(p => ({
        id: p.id,
        paymentMethod: p.paymentMethod,
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        amountTendered: p.amountTendered ? Number(p.amountTendered) : null,
        changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
        roundingAdjustment: p.roundingAdjustment ? Number(p.roundingAdjustment) : null,
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        authCode: p.authCode,
        status: p.status,
      })),
      remainingBalance: finalBalance,
      receiptData,
      // Loyalty info
      loyaltyPointsEarned: pointsEarned,
      customerId: order.customer?.id || null,
    } })
  } catch (error) {
    console.error('Failed to process payment:', error)

    // Capture CRITICAL payment error
    void errorCapture.critical('PAYMENT', 'Payment processing failed', {
      category: 'payment-processing-error',
      action: `Processing payment for Order ${orderId}`,
      orderId,
      error: error instanceof Error ? error : undefined,
      path: `/api/orders/${orderId}/pay`,
      requestBody: body,
    }).catch(() => {
      // Silently fail error logging - don't block the error response
    })

    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}, 'orders-pay'))
