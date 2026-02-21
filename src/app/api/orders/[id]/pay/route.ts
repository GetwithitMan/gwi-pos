import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  generateFakeAuthCode,
  generateFakeTransactionId,
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { processLiquorInventory } from '@/lib/liquor-inventory'
import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { calculateCardPrice, calculateCashDiscount, applyPriceRounding } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderTotalsUpdate, dispatchPaymentProcessed, dispatchCFDReceiptSent } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { emitCloudEvent } from '@/lib/cloud-events'
import { triggerCashDrawer } from '@/lib/cash-drawer'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'

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
        items: { where: { deletedAt: null }, include: { modifiers: { where: { deletedAt: null } } } },
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
      if (zeroRemaining <= 0 && zeroAlreadyPaid === 0) {
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

    if (order.status === 'paid' || order.status === 'closed') {
      return NextResponse.json(
        { error: 'Order is already paid' },
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

    // Get settings for rounding
    const settings = parseSettings(order.location.settings)

    // Compute current business day start for promotion on pay
    const locSettingsRaw = order.location.settings as Record<string, unknown> | null
    const dayStartTime = (locSettingsRaw?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

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
        paymentMethod: string
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
        status: string
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
        paymentMethod: payment.method,
        status: 'completed',
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
        const rawRemaining = remaining - alreadyPaidInLoop
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

        // Deduct points + create payment atomically
        const loyaltyResult = await db.$transaction(async (tx) => {
          await tx.customer.update({
            where: { id: order.customer!.id },
            data: {
              loyaltyPoints: { decrement: payment.pointsUsed! },
            },
          })
          return tx.payment.create({ data: paymentRecord })
        })

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

          if (paymentAmount > cardBalance) {
            throw new Error(`GC_INSUFFICIENT:${cardBalance.toFixed(2)}`)
          }

          const newBalance = cardBalance - paymentAmount

          paymentRecord = {
            ...paymentRecord,
            transactionId: `GC:${giftCard.cardNumber}`,
            cardLast4: giftCard.cardNumber.slice(-4),
          }

          await tx.giftCard.update({
            where: { id: giftCard.id },
            data: {
              currentBalance: newBalance,
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
            const balance = err.message.split(':')[1]
            return { error: `Insufficient gift card balance. Available: $${balance}`, status: 400, currentBalance: parseFloat(balance) } as const
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

        const houseAccount = await db.houseAccount.findUnique({
          where: { id: payment.houseAccountId }
        })

        if (!houseAccount) {
          return NextResponse.json(
            { error: 'House account not found' },
            { status: 404 }
          )
        }

        if (houseAccount.status !== 'active') {
          return NextResponse.json(
            { error: `House account is ${houseAccount.status}` },
            { status: 400 }
          )
        }

        const paymentAmount = payment.amount + (payment.tipAmount || 0)
        const currentBalance = Number(houseAccount.currentBalance)
        const creditLimit = Number(houseAccount.creditLimit)
        const newBalance = currentBalance + paymentAmount

        // Check credit limit (0 = unlimited)
        if (creditLimit > 0 && newBalance > creditLimit) {
          return NextResponse.json(
            {
              error: 'Charge would exceed credit limit',
              currentBalance,
              creditLimit,
              availableCredit: Math.max(0, creditLimit - currentBalance),
            },
            { status: 400 }
          )
        }

        // Calculate due date
        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + (houseAccount.paymentTerms ?? 30))

        // Charge to house account + create payment atomically
        paymentRecord = {
          ...paymentRecord,
          transactionId: `HA:${houseAccount.id}`,
          authCode: houseAccount.name,
        }

        const haResult = await db.$transaction(async (tx) => {
          await tx.houseAccount.update({
            where: { id: houseAccount!.id },
            data: {
              currentBalance: newBalance,
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
          return tx.payment.create({ data: paymentRecord })
        })

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
      ? parseFloat(settings.priceRounding.increment) / 2  // Half the increment covers rounding in either direction
      : 0.01

    const updateData: {
      tipTotal: number
      primaryPaymentMethod?: string
      status?: string
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
      updateData.primaryPaymentMethod = primaryMethod === 'cash' ? 'cash' : 'card'
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

    // Create default payments + update order status + loyalty points atomically
    timing.start('db-pay')
    await db.$transaction(async (tx) => {
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
      await tx.order.update({
        where: { id: orderId },
        data: updateData,
      })

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
    })
    timing.end('db-pay', 'Payment transaction')

    // If order is fully paid, reset entertainment items and table status
    if (updateData.status === 'paid') {
      await db.menuItem.updateMany({
        where: {
          currentOrderId: orderId,
          itemType: 'timed_rental',
        },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      })

      // Process liquor inventory deductions for cocktails with recipes (fire-and-forget)
      // This tracks pour usage and creates inventory transactions
      processLiquorInventory(orderId, employeeId).catch(err => {
        console.error('Background liquor inventory failed:', err)
      })

      // Deduct general food/ingredient inventory (fire-and-forget to not block payment)
      // This processes MenuItemRecipes and ModifierInventoryLinks
      deductInventoryForOrder(orderId, employeeId).catch(err => {
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
      if (totalTips > 0 && order.employeeId) {
        allocateTipsForPayment({
          locationId: order.locationId,
          orderId,
          primaryEmployeeId: order.employeeId,
          createdPayments,
          totalTipsDollars: totalTips,
          tipBankSettings: settings.tipBank,
          // kind: 'tip' (default — voluntary gratuity from customer)
        }).catch(err => {
          console.error('Background tip allocation failed:', err)
        })
      }

      // Reset table status to available
      if (order.tableId) {
        await db.table.update({
          where: { id: order.tableId },
          data: { status: 'available' },
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
      dispatchOrderTotalsUpdate(order.locationId, orderId, {
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
      void dispatchPaymentProcessed(order.locationId, { orderId, paymentId: p.id, status: 'completed' }).catch(() => {})
    }

    // Dispatch open orders list changed when order is fully paid (fire-and-forget)
    if (updateData.status === 'paid') {
      dispatchOpenOrdersChanged(order.locationId, { trigger: 'paid', orderId: order.id, tableId: order.tableId || undefined }, { async: true }).catch(() => {})
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

    // If this is a split order that was just paid, check if all siblings are paid
    // and mark the parent as paid if so
    if (updateData.status === 'paid' && order.parentOrderId) {
      const allSiblings = await db.order.findMany({
        where: { parentOrderId: order.parentOrderId },
        select: { status: true },
      })

      const allSiblingsPaid = allSiblings.every(s => s.status === 'paid')

      if (allSiblingsPaid) {
        // Mark parent order as paid
        await db.order.update({
          where: { id: order.parentOrderId },
          data: {
            status: 'paid',
            paidAt: new Date(),
            closedAt: new Date(),
          },
        })
      }
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

    // Return response
    return NextResponse.json({ data: {
      success: true,
      payments: createdPayments.map(p => ({
        id: p.id,
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
      orderStatus: newPaidTotal >= orderTotal - paidTolerance ? 'paid' : 'partial',
      remainingBalance: newPaidTotal >= orderTotal - paidTolerance ? 0 : Math.max(0, orderTotal - newPaidTotal),
      receiptData,
      // Loyalty info
      loyaltyPointsEarned: pointsEarned,
      customerId: order.customer?.id || null,
    } })
  } catch (error) {
    console.error('Failed to process payment:', error)

    // Capture CRITICAL payment error
    errorCapture.critical('PAYMENT', 'Payment processing failed', {
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
