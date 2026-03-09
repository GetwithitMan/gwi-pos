import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { OrderStatus, PaymentMethod, PaymentStatus, PmsAttemptStatus } from '@prisma/client'
import {
  generateFakeAuthCode,
  generateFakeTransactionId,
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { calculateCardPrice, calculateCashDiscount, applyPriceRounding, roundToCents } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderTotalsUpdate, dispatchPaymentProcessed, dispatchCFDReceiptSent, dispatchOrderClosed, dispatchNewOrder } from '@/lib/socket-dispatch'
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
import { ingestAndProject, type IngestEvent, type IngestResult } from '@/lib/order-events/ingester'
import { OrderRouter } from '@/lib/order-router'
import { batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'

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
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | 'loyalty_points' | 'room_charge'
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
  // Hotel PMS / Bill to Room fields
  // P1.1: client sends only selectionId; server resolves guest data from in-memory selection
  selectionId?: string
  roomNumber?: string
  guestName?: string
  pmsReservationId?: string
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
  // SAF (Store-and-Forward) — transaction stored offline on reader
  storedOffline?: boolean
  // Simulated - will be replaced with real processor
  simulate?: boolean
}

// Zod schema for request validation
const PaymentInputSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty_points', 'room_charge']),
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
  // Hotel PMS / Bill to Room fields (P1.1: client sends selectionId, not raw OPERA IDs)
  selectionId: z.string().optional(),
  roomNumber: z.string().optional(),
  guestName: z.string().optional(),
  pmsReservationId: z.string().optional(),
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
  // SAF (Store-and-Forward) — transaction stored offline on reader, pending upload
  storedOffline: z.boolean().optional(),
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
  let autoVoidRecords: Record<string, unknown>[] = []
  let autoVoidTerminalId: string | undefined
  let autoVoidLocationId: string | undefined
  try {
    body = await request.json()

    const txResult = await db.$transaction(async (tx) => {

    // Acquire row-level lock to prevent double-charge from concurrent terminals
    const [lockedRow] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`,
      orderId,
    )
    if (!lockedRow) {
      return { earlyReturn: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }
    }

    // Single query for order — replaces separate zero-check, idempotency, and main fetch queries
    // Includes items/employee/table so we can build receipt data in the response (avoids second fetch)
    timing.start('db-fetch')
    const order = await tx.order.findUnique({
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
      return { earlyReturn: NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      ) }
    }

    // Guard: reject empty draft orders — they have $0 total but should NOT be closeable
    if (order.status === 'draft' && (!order.items || order.items.length === 0)) {
      return { earlyReturn: NextResponse.json(
        { error: 'Cannot close an empty draft order. Add items first.' },
        { status: 400 }
      ) }
    }

    // Check for $0 order BEFORE Zod validation (Zod requires amount > 0,
    // but voided orders legitimately have $0 total and need to be closed)
    if (order.status !== 'paid' && order.status !== 'closed') {
      const zeroAlreadyPaid = order.payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + Number(p.totalAmount), 0)
      const zeroRemaining = Number(order.total) - zeroAlreadyPaid
      if (zeroRemaining <= 0) {
        await ingestAndProject(tx as any, orderId, order.locationId, [
          { type: 'ORDER_CLOSED', payload: { closedStatus: 'paid' } }
        ])
        return { earlyReturn: NextResponse.json({ data: {
          success: true,
          orderId,
          orderStatus: 'paid',
          message: 'Order closed with $0 balance (all items voided/comped)',
          totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
        } }) }
      }
    }

    // ─── Normalize legacy / Android offline-sync payment format ───────────
    // Old callers (and PendingPayment offline queue) send a flat object:
    //   { paymentMethodId: "cash", amount: 123, tipAmount: 0, employeeId: "..." }
    // Android native sends:
    //   { paymentMethod: "cash", amount: 159.12, tipAmount: 0, employeeId: "..." }
    // The Zod schema expects:
    //   { payments: [{ method: "cash", amount: 123 }], employeeId: "..." }
    // Transform the flat shape so both formats are accepted.
    if (!body.payments && (body.paymentMethodId || body.paymentMethod || body.method || body.amount)) {
      const method = body.paymentMethodId || body.paymentMethod || body.method || 'cash'
      body = {
        payments: [{
          method,
          amount: body.amount,
          ...(body.tipAmount !== undefined ? { tipAmount: body.tipAmount } : {}),
          ...(body.amountTendered !== undefined ? { amountTendered: body.amountTendered } : {}),
          ...(body.cardBrand !== undefined ? { cardBrand: body.cardBrand } : {}),
          ...(body.cardLast4 !== undefined ? { cardLast4: body.cardLast4 } : {}),
          ...(body.simulate !== undefined ? { simulate: body.simulate } : {}),
          // Map Android PaymentReconciliationWorker fields
          ...(body.authCode !== undefined ? { authCode: body.authCode } : {}),
          ...(body.recordNo !== undefined ? { datacapRecordNo: body.recordNo } : {}),
          ...(body.datacapRecordNo !== undefined ? { datacapRecordNo: body.datacapRecordNo } : {}),
        }],
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        ...(body.terminalId ? { terminalId: body.terminalId } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      }
    }

    // Validate request body with Zod
    const validation = PaymentRequestSchema.safeParse(body)
    if (!validation.success) {
      return { earlyReturn: NextResponse.json(
        {
          error: 'Invalid payment request data',
          details: validation.error.format(),
        },
        { status: 400 }
      ) }
    }

    const { payments, employeeId, terminalId, idempotencyKey } = validation.data
    const finalIdempotencyKey = idempotencyKey || crypto.randomUUID()

    // Idempotency check using already-loaded payments (no extra query needed)
    if (idempotencyKey) {
      const duplicatePayments = order.payments.filter(
        p => p.idempotencyKey === idempotencyKey && p.status === 'completed'
      )
      if (duplicatePayments.length > 0) {
        return { earlyReturn: NextResponse.json({ data: {
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
        } }) }
      }
    }

    // RecordNo-based idempotency check — PaymentReconciliationWorker sends datacapRecordNo
    // as a secondary idempotency key for offline-captured card payments.
    // If a payment with the same recordNo already exists for this order, return 409.
    const firstPaymentRecordNo = payments[0]?.datacapRecordNo
    if (firstPaymentRecordNo) {
      const existingByRecordNo = order.payments.find(
        p => p.datacapRecordNo === firstPaymentRecordNo && p.status === 'completed'
      )
      if (existingByRecordNo) {
        return { earlyReturn: NextResponse.json(
          {
            error: 'Payment with this recordNo already exists for this order',
            code: 'DUPLICATE_RECORD_NO',
            existingPaymentId: existingByRecordNo.id,
          },
          { status: 409 }
        ) }
      }
    }

    // Server-side permission check for payment processing
    const auth = await requireAnyPermission(employeeId, order.locationId, [
      PERMISSIONS.POS_CASH_PAYMENTS,
      PERMISSIONS.POS_CARD_PAYMENTS,
    ])
    if (!auth.authorized) {
      return { earlyReturn: NextResponse.json({ error: auth.error }, { status: auth.status }) }
    }

    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      if (order.status === 'paid' || order.status === 'closed') {
        const existingPayment = await tx.payment.findFirst({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
        })
        return { earlyReturn: NextResponse.json({ data: {
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
        } }) }
      }
      return { earlyReturn: NextResponse.json(
        { error: 'Cannot pay an order with status: ' + order.status },
        { status: 400 }
      ) }
    }

    // Block direct payment of split parent orders — pay individual splits instead
    if (order.status === 'split') {
      return { earlyReturn: NextResponse.json(
        { error: 'Cannot pay a split parent order directly. Pay individual split checks instead.' },
        { status: 400 }
      ) }
    }

    // Validate parent order is still in split state when paying a split child
    if (order.parentOrderId) {
      const parentOrder = await tx.order.findUnique({
        where: { id: order.parentOrderId },
        select: { status: true },
      })
      if (!parentOrder || parentOrder.status !== 'split') {
        return { earlyReturn: NextResponse.json(
          { error: 'Parent order is no longer in split state' },
          { status: 400 }
        ) }
      }
    }

    // Collect unsent items — will be auto-sent to kitchen after payment completes
    const unsentItems = order.items.filter(
      (i: any) => i.kitchenStatus === 'pending' && i.status === 'active'
    )

    // Get settings for rounding
    const settings = parseSettings(order.location.settings)

    // SIMULATED_DEFAULTS guard: block simulated payments in production
    if (process.env.NODE_ENV === 'production' && settings.payments.processor === 'simulated') {
      console.error(
        `[PAY] BLOCKED: Location ${order.locationId} is using simulated payment processor in production. ` +
        'Configure a real Datacap merchantId before processing payments.'
      )
      return { earlyReturn: NextResponse.json(
        { error: 'Payment processor not configured for production. Contact your administrator.' },
        { status: 503 }
      ) }
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

      for (const item of perMinuteItems) {
          const startedAt = new Date(item.blockTimeStartedAt!)
          const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000))

          const mi = await tx.menuItem.findUnique({
            where: { id: item.menuItemId },
            select: { ratePerMinute: true, minimumCharge: true, incrementMinutes: true, graceMinutes: true, price: true },
          })
          if (!mi) continue

          const ratePerMinute = mi.ratePerMinute ? Number(mi.ratePerMinute) : 0
          if (ratePerMinute <= 0) continue

          const pricing: EntertainmentPricing = {
            ratePerMinute,
            minimumCharge: mi.minimumCharge ? Number(mi.minimumCharge) : 0,
            incrementMinutes: mi.incrementMinutes ?? 15,
            graceMinutes: mi.graceMinutes ?? 5,
          }

          const breakdown = calculateCharge(elapsedMinutes, pricing)
          const settledPrice = breakdown.totalCharge

          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              price: settledPrice,
              itemTotal: settledPrice * item.quantity,
            },
          })
        }

        const activeItems = await tx.orderItem.findMany({
          where: { orderId, status: 'active', deletedAt: null },
          include: { modifiers: true },
        })
        let newSubtotal = 0
        for (const ai of activeItems) {
          const modTotal = ai.modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
          newSubtotal += (Number(ai.price) + modTotal) * ai.quantity
        }

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

        ;(order as any).subtotal = newSubtotal
        ;(order as any).taxTotal = newTaxTotal
        ;(order as any).total = newTotal
    }

    // Calculate how much is already paid
    const alreadyPaid = order.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    const orderTotal = Number(order.total)
    const remaining = orderTotal - alreadyPaid

    // If order total is $0 (e.g., all items voided), close the order without payment
    if (remaining <= 0 && alreadyPaid === 0) {
      await ingestAndProject(tx as any, orderId, order.locationId, [
        { type: 'ORDER_CLOSED', payload: { closedStatus: 'paid' } }
      ])
      return { earlyReturn: NextResponse.json({ data: {
        success: true,
        orderId,
        message: 'Order closed with $0 balance (all items voided/comped)',
        totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
      } }) }
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
      // Dual pricing: order.total IS the cash price (stored price model).
      // Card price = order.total * (1 + cashDiscountPercent/100).
      // Cash payments must match the stored total — do NOT call calculateCashPrice()
      // on `remaining` because it is already the cash price; doing so would
      // incorrectly reduce the threshold a second time.
      // (No adjustment needed here — validationRemaining stays as `remaining`.)
      if (settings.priceRounding?.enabled && settings.priceRounding.applyToCash) {
        validationRemaining = applyPriceRounding(validationRemaining, settings.priceRounding, 'cash')
      } else if (settings.payments.cashRounding !== 'none') {
        validationRemaining = roundAmount(
          validationRemaining,
          settings.payments.cashRounding,
          settings.payments.roundingDirection
        )
      }
    }

    if (paymentTotal < validationRemaining - 0.01) {
      return { earlyReturn: NextResponse.json(
        { error: `Payment amount ($${paymentTotal.toFixed(2)}) is less than remaining balance ($${validationRemaining.toFixed(2)})` },
        { status: 400 }
      ) }
    }

    // Validate payment amounts upfront
    for (const payment of payments) {
      const paymentAmount = payment.amount + (payment.tipAmount || 0)

      // Validate amount is a valid number
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        return { earlyReturn: NextResponse.json(
          { error: `Invalid payment amount: ${paymentAmount}. Amount must be a positive number.` },
          { status: 400 }
        ) }
      }

      // Prevent unreasonably large payments (potential UI bugs)
      const maxReasonablePayment = orderTotal * 1.5
      if (paymentAmount > maxReasonablePayment) {
        return { earlyReturn: NextResponse.json(
          { error: `Payment amount $${paymentAmount.toFixed(2)} exceeds reasonable limit (150% of order total). This may indicate an error.` },
          { status: 400 }
        ) }
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
          return { earlyReturn: NextResponse.json(
            {
              error: 'Partial Datacap data detected. Card payments must have either all Datacap fields (RecordNo, RefNumber, CardLast4) or none. This indicates a corrupted payment record.',
              details: {
                hasDatacapRecordNo: !!payment.datacapRecordNo,
                hasDatacapRefNumber: !!payment.datacapRefNumber,
                hasCardLast4: !!payment.cardLast4,
              }
            },
            { status: 400 }
          ) }
        }
      }
    }

    // Process each payment
    // Payments from special types (loyalty, gift card, house account) are created
    // inside their own transactions. Default payments (cash, card) are collected
    // and created atomically with the order status update below.
    const allPendingPayments: Record<string, unknown>[] = []
    let totalTips = 0
    let alreadyPaidInLoop = 0

    // PMS attempt tracking — set in room_charge handler, consumed after payment creation
    let pmsAttemptId: string | null = null
    let pmsTransactionNo: string | null = null

    // Resolve drawer ONCE before the loop (instead of per-payment)
    const drawerAttribution = await resolveDrawerForPayment(
      'cash', // Resolve for cash (non-cash returns null anyway)
      employeeId || null,
      terminalId,
    )

    for (let paymentIdx = 0; paymentIdx < payments.length; paymentIdx++) {
      const payment = payments[paymentIdx]
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
        isOfflineCapture?: boolean
        safStatus?: string
        cashDiscountAmount?: number
        priceBeforeDiscount?: number
        pricingMode?: string
        idempotencyKey?: string
        // Hotel PMS / Bill to Room
        roomNumber?: string
        guestName?: string
        pmsReservationId?: string
        pmsTransactionId?: string
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
        // Per-payment idempotency key: split tenders have multiple payments per request,
        // each must have a unique key. Append index for any multi-payment request.
        idempotencyKey: payments.length > 1
          ? `${finalIdempotencyKey}-${paymentIdx}`
          : finalIdempotencyKey,
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
            ...(payment.storedOffline && { isOfflineCapture: true }),
          }),
          safStatus: payment.storedOffline ? 'APPROVED_SAF_PENDING_UPLOAD' : 'APPROVED_ONLINE',
        }
      } else if (payment.method === 'loyalty_points') {
        if (!settings.loyalty.enabled || !settings.loyalty.redemptionEnabled) {
          return { earlyReturn: NextResponse.json(
            { error: 'Loyalty points redemption is not enabled' },
            { status: 400 }
          ) }
        }

        if (!order.customer) {
          return { earlyReturn: NextResponse.json(
            { error: 'Customer is required to redeem loyalty points' },
            { status: 400 }
          ) }
        }

        const pointsNeeded = Math.ceil(payment.amount * settings.loyalty.pointsPerDollarRedemption)

        if (!payment.pointsUsed || payment.pointsUsed < pointsNeeded) {
          return { earlyReturn: NextResponse.json(
            { error: `${pointsNeeded} points required for $${payment.amount.toFixed(2)} redemption` },
            { status: 400 }
          ) }
        }

        if (order.customer.loyaltyPoints < payment.pointsUsed) {
          return { earlyReturn: NextResponse.json(
            { error: `Insufficient points. Customer has ${order.customer.loyaltyPoints} points.` },
            { status: 400 }
          ) }
        }

        if (payment.pointsUsed < settings.loyalty.minimumRedemptionPoints) {
          return { earlyReturn: NextResponse.json(
            { error: `Minimum ${settings.loyalty.minimumRedemptionPoints} points required for redemption` },
            { status: 400 }
          ) }
        }

        const maxRedemptionAmount = orderTotal * (settings.loyalty.maximumRedemptionPercent / 100)
        if (payment.amount > maxRedemptionAmount) {
          return { earlyReturn: NextResponse.json(
            { error: `Maximum ${settings.loyalty.maximumRedemptionPercent}% of order can be paid with points` },
            { status: 400 }
          ) }
        }

        paymentRecord = {
          ...paymentRecord,
          transactionId: `LOYALTY:${payment.pointsUsed}pts`,
        }

        const freshCustomer = await tx.customer.findUnique({
          where: { id: order.customer!.id },
          select: { loyaltyPoints: true },
        })
        if (!freshCustomer || freshCustomer.loyaltyPoints < payment.pointsUsed!) {
          return { earlyReturn: NextResponse.json(
            { error: `Insufficient points. Customer has ${freshCustomer?.loyaltyPoints ?? 0} points.` },
            { status: 400 }
          ) }
        }
        await tx.customer.update({
          where: { id: order.customer!.id },
          data: {
            loyaltyPoints: { decrement: payment.pointsUsed! },
          },
        })

        allPendingPayments.push(paymentRecord)
        totalTips += payment.tipAmount || 0
        continue
      } else if (payment.method === 'gift_card') {
        // Gift card payment
        if (!settings.payments.acceptGiftCards) {
          return { earlyReturn: NextResponse.json(
            { error: 'Gift cards are not accepted' },
            { status: 400 }
          ) }
        }

        const giftCardLookup = payment.giftCardId || payment.giftCardNumber
        if (!giftCardLookup) {
          return { earlyReturn: NextResponse.json(
            { error: 'Gift card ID or number is required' },
            { status: 400 }
          ) }
        }

        let giftCard = await tx.giftCard.findUnique({
          where: { id: payment.giftCardId || '' }
        })

        if (!giftCard && payment.giftCardNumber) {
          giftCard = await tx.giftCard.findUnique({
            where: { cardNumber: payment.giftCardNumber.toUpperCase() }
          })
        }

        if (!giftCard) {
          return { earlyReturn: NextResponse.json(
            { error: 'Gift card not found' },
            { status: 404 }
          ) }
        }

        if (giftCard.status !== 'active') {
          return { earlyReturn: NextResponse.json(
            { error: `Gift card is ${giftCard.status}` },
            { status: 400 }
          ) }
        }

        if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
          await tx.giftCard.update({
            where: { id: giftCard.id },
            data: { status: 'expired' }
          })
          return { earlyReturn: NextResponse.json(
            { error: 'Gift card has expired' },
            { status: 400 }
          ) }
        }

        const cardBalance = Number(giftCard.currentBalance)
        const gcPaymentAmount = payment.amount + (payment.tipAmount || 0)

        if (cardBalance < gcPaymentAmount) {
          return { earlyReturn: NextResponse.json(
            { error: `Insufficient gift card balance ($${cardBalance.toFixed(2)})`, currentBalance: cardBalance },
            { status: 400 }
          ) }
        }

        const newBalance = cardBalance - gcPaymentAmount

        paymentRecord = {
          ...paymentRecord,
          transactionId: `GC:${giftCard.cardNumber}`,
          cardLast4: giftCard.cardNumber.slice(-4),
        }

        await tx.giftCard.update({
          where: { id: giftCard.id },
          data: {
            currentBalance: { decrement: gcPaymentAmount },
            status: newBalance === 0 ? 'depleted' : 'active',
            transactions: {
              create: {
                locationId: order.locationId,
                type: 'redemption',
                amount: -gcPaymentAmount,
                balanceBefore: cardBalance,
                balanceAfter: newBalance,
                orderId,
                employeeId: employeeId || null,
                notes: `Payment for order #${order.orderNumber}`,
              }
            }
          }
        })

        allPendingPayments.push(paymentRecord)
        totalTips += payment.tipAmount || 0
        continue
      } else if (payment.method === 'house_account') {
        if (!settings.payments.acceptHouseAccounts) {
          return { earlyReturn: NextResponse.json(
            { error: 'House accounts are not accepted' },
            { status: 400 }
          ) }
        }

        if (!payment.houseAccountId) {
          return { earlyReturn: NextResponse.json(
            { error: 'House account ID is required' },
            { status: 400 }
          ) }
        }

        const haPaymentAmount = payment.amount + (payment.tipAmount || 0)

        const freshAccount = await tx.houseAccount.findUnique({
          where: { id: payment.houseAccountId! }
        })

        if (!freshAccount) {
          return { earlyReturn: NextResponse.json(
            { error: 'House account not found' },
            { status: 404 }
          ) }
        }

        if (freshAccount.status !== 'active') {
          return { earlyReturn: NextResponse.json(
            { error: `House account is ${freshAccount.status}` },
            { status: 400 }
          ) }
        }

        const haCurrentBalance = Number(freshAccount.currentBalance)
        const haCreditLimit = Number(freshAccount.creditLimit)
        const haNewBalance = haCurrentBalance + haPaymentAmount

        if (haCreditLimit > 0 && haNewBalance > haCreditLimit) {
          return { earlyReturn: NextResponse.json(
            {
              error: 'Charge would exceed credit limit',
              currentBalance: haCurrentBalance,
              creditLimit: haCreditLimit,
              availableCredit: Math.max(0, haCreditLimit - haCurrentBalance),
            },
            { status: 400 }
          ) }
        }

        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + (freshAccount.paymentTerms ?? 30))

        await tx.houseAccount.update({
          where: { id: freshAccount.id },
          data: {
            currentBalance: { increment: haPaymentAmount },
            transactions: {
              create: {
                locationId: order.locationId,
                type: 'charge',
                amount: haPaymentAmount,
                balanceBefore: haCurrentBalance,
                balanceAfter: haNewBalance,
                orderId,
                employeeId: employeeId || null,
                notes: `Order #${order.orderNumber}`,
                dueDate,
              }
            }
          }
        })

        paymentRecord.transactionId = `HA:${freshAccount.id}`
        paymentRecord.authCode = freshAccount.name

        allPendingPayments.push(paymentRecord)
        totalTips += payment.tipAmount || 0
        continue
      } else if (payment.method === 'room_charge') {
        if (!settings.payments.acceptHotelRoomCharge) {
          return { earlyReturn: NextResponse.json({ error: 'Bill to Room is not enabled' }, { status: 400 }) }
        }

        const pms = settings.hotelPms
        if (!pms?.enabled || !pms.clientId) {
          return { earlyReturn: NextResponse.json({ error: 'Oracle PMS integration is not configured' }, { status: 400 }) }
        }

        if (!payment.selectionId) {
          return { earlyReturn: NextResponse.json({ error: 'Room charge requires a valid guest selection.' }, { status: 400 }) }
        }

        const { consumeRoomChargeSelection } = await import('@/lib/room-charge-selections')
        const sel = consumeRoomChargeSelection(payment.selectionId, order.locationId)
        if (!sel) {
          return { earlyReturn: NextResponse.json(
            { error: 'Guest selection has expired or is invalid. Please look up the guest again.' },
            { status: 400 }
          ) }
        }

        const amountCents = Math.round((payment.amount + (payment.tipAmount || 0)) * 100)
        const idempotencyKey_pms = `${orderId}:${sel.reservationId}:${amountCents}:${pms.chargeCode}`

        let pmsAttempt = await tx.pmsChargeAttempt.findUnique({ where: { idempotencyKey: idempotencyKey_pms } })

        if (pmsAttempt?.status === 'COMPLETED') {
          return { earlyReturn: NextResponse.json({
            success: true,
            message: 'Room charge already processed.',
            transactionNo: pmsAttempt.operaTransactionId,
          }) }
        }

        if (pmsAttempt?.status === 'FAILED') {
          return { earlyReturn: NextResponse.json(
            { error: 'A previous charge attempt failed. Please try a new payment.' },
            { status: 502 }
          ) }
        }

        if (pmsAttempt?.status === 'PENDING') {
          const ageMs = Date.now() - pmsAttempt.updatedAt.getTime()
          if (ageMs < 60_000) {
            return { earlyReturn: NextResponse.json(
              { error: 'Charge in progress. Please wait a moment and try again.' },
              { status: 409 }
            ) }
          }
        }

        if (!pmsAttempt) {
          pmsAttempt = await tx.pmsChargeAttempt.create({
            data: {
              idempotencyKey: idempotencyKey_pms,
              locationId: order.locationId,
              orderId,
              reservationId: sel.reservationId,
              amountCents,
              chargeCode: pms.chargeCode,
              employeeId: sel.employeeId ?? null,
              status: 'PENDING',
            },
          })
        }

        try {
          const { postCharge } = await import('@/lib/oracle-pms-client')
          const chargeResult = await postCharge(pms, order.locationId, {
            reservationId: sel.reservationId,
            amountCents,
            description: `Restaurant Charge`,
            reference: `GWI-POS-Order-${order.orderNumber ?? orderId}`,
            idempotencyKey: pmsAttempt.idempotencyKey,
          })

          paymentRecord.roomNumber = sel.roomNumber
          paymentRecord.guestName = sel.guestName
          paymentRecord.pmsReservationId = sel.reservationId
          paymentRecord.pmsTransactionId = chargeResult.transactionNo
          paymentRecord.transactionId = `PMS:${chargeResult.transactionNo}`
          paymentRecord.authCode = `Room ${sel.roomNumber}`
          pmsAttemptId = pmsAttempt.id
          pmsTransactionNo = chargeResult.transactionNo
        } catch (err) {
          void tx.pmsChargeAttempt.update({
            where: { id: pmsAttempt.id },
            data: {
              status: 'FAILED' as PmsAttemptStatus,
              lastErrorMessage: err instanceof Error ? err.message.substring(0, 200) : 'unknown',
            },
          }).catch(e => console.error('[pay/room_charge] Failed to mark attempt FAILED:', e))
          console.error('[pay/room_charge] OPERA charge failed:', err instanceof Error ? err.message : 'unknown')
          return { earlyReturn: NextResponse.json(
            { error: 'Failed to post charge to hotel room. Please verify the room and try again.' },
            { status: 502 }
          ) }
        }
      }

      allPendingPayments.push(paymentRecord)
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
    // Dual pricing: orderTotal IS the cash price (stored price model).
    // Card price = orderTotal * (1 + cashDiscountPercent/100).
    // For cash payments effectiveTotal is simply orderTotal — do NOT call
    // calculateCashPrice() on it, which would incorrectly reduce it a second time.
    // Cash rounding (applied earlier to validationRemaining) is handled separately;
    // the paid-detection threshold here uses the raw cash total.
    const effectiveTotal = orderTotal
    if (newPaidTotal >= effectiveTotal - paidTolerance) {
      updateData.status = 'paid'
      updateData.paidAt = new Date()
      updateData.closedAt = new Date()
    } else if (newPaidTotal > 0) {
      // Partial payment received — lock order from silent abandonment
      if (order.status === 'open' || order.status === 'draft') {
        updateData.status = 'in_progress'
      }
      if (!order.paidAt) {
        updateData.paidAt = new Date()
      }
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

    // ── Build payment events ──────────────────────────────────────────
    const paymentEvents: IngestEvent[] = []
    const bridgeOverrides: Record<string, Record<string, unknown>> = {}

    // HA cellular sync — detect mutation origin for Payment stamping
    const isCellularPayment = request.headers.get('x-cellular-authenticated') === '1'
    const paymentMutationOrigin = isCellularPayment ? 'cloud' : 'local'

    for (const record of allPendingPayments) {
      const rec = record as any
      const paymentId = rec.id || crypto.randomUUID()

      // Ensure the record has an ID for bridge override keying
      rec.id = paymentId

      paymentEvents.push({
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId,
          method: rec.paymentMethod,
          amountCents: Math.round(Number(rec.amount) * 100),
          tipCents: Math.round(Number(rec.tipAmount ?? 0) * 100),
          totalCents: Math.round(Number(rec.totalAmount) * 100),
          cardBrand: rec.cardBrand ?? null,
          cardLast4: rec.cardLast4 ?? null,
          status: 'approved',
        },
      })

      // All the extra Payment fields that aren't in the domain event
      bridgeOverrides[paymentId] = { ...rec, lastMutatedBy: paymentMutationOrigin }
      // Remove fields already in the event payload to avoid conflicts
      delete bridgeOverrides[paymentId].amount
      delete bridgeOverrides[paymentId].tipAmount
      delete bridgeOverrides[paymentId].totalAmount
      delete bridgeOverrides[paymentId].paymentMethod
      delete bridgeOverrides[paymentId].cardBrand
      delete bridgeOverrides[paymentId].cardLast4
      delete bridgeOverrides[paymentId].status
      delete bridgeOverrides[paymentId].orderId
      delete bridgeOverrides[paymentId].locationId
    }

    // Add ORDER_CLOSED if fully paid
    const orderIsPaid = newPaidTotal >= effectiveTotal - paidTolerance
    if (orderIsPaid) {
      paymentEvents.push({
        type: 'ORDER_CLOSED',
        payload: { closedStatus: 'paid' },
      })
    }

    // ── Ingest synchronously ──────────────────────────────────────────
    autoVoidRecords = allPendingPayments.filter(
      (r: any) => (r.paymentMethod === 'credit' || r.paymentMethod === 'debit') && r.datacapRecordNo
    )
    autoVoidTerminalId = terminalId
    autoVoidLocationId = order.locationId

    timing.start('db-pay')
    const ingestResult = await ingestAndProject(tx as any, orderId, order.locationId, paymentEvents, {
      paymentBridgeOverrides: bridgeOverrides,
      employeeId: employeeId || undefined,
    })
    timing.end('db-pay', 'Payment ingestion')

    if (ingestResult.alreadyPaid) {
      const existingPayment = await tx.payment.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
      })
      const freshOrder = await tx.order.findUnique({ where: { id: orderId }, select: { total: true, status: true } })
      return { earlyReturn: NextResponse.json({ data: {
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
      } }) }
    }

    return {
      order,
      ingestResult,
      settings,
      payments,
      employeeId,
      terminalId,
      allPendingPayments,
      totalTips,
      newTipTotal,
      newPaidTotal,
      effectiveTotal,
      paidTolerance,
      orderIsPaid,
      updateData,
      pointsEarned,
      newAverageTicket,
      loyaltyEarningBase,
      pmsAttemptId,
      pmsTransactionNo,
      unsentItems,
      businessDayStart,
      paymentMutationOrigin,
      hasCash,
    }

    }, { timeout: 30000 })

    if ('earlyReturn' in txResult) {
      return (txResult as any).earlyReturn as NextResponse
    }

    const {
      order,
      ingestResult,
      settings,
      payments,
      employeeId,
      terminalId,
      allPendingPayments,
      totalTips,
      newTipTotal,
      newPaidTotal,
      effectiveTotal,
      paidTolerance,
      orderIsPaid,
      updateData,
      pointsEarned,
      newAverageTicket,
      loyaltyEarningBase,
      pmsAttemptId,
      pmsTransactionNo,
      unsentItems,
      businessDayStart,
      paymentMutationOrigin,
      hasCash,
    } = txResult as any

    if (isInOutageMode()) {
      for (const bp of ingestResult.bridgedPayments) {
        void queueOutageWrite('Payment', bp.id, 'INSERT', { ...bp } as Record<string, unknown>, order.locationId).catch(console.error)
      }
    }

    if (unsentItems.length > 0) {
      const autoSendIds = unsentItems
        .filter((i: any) => i.menuItem?.itemType !== 'timed_rental')
        .map((i: any) => i.id)
      if (autoSendIds.length > 0) {
        void (async () => {
          try {
            const now = new Date()
            await batchUpdateOrderItemStatus(autoSendIds, 'sent', now)
            const routingResult = await OrderRouter.resolveRouting(orderId, autoSendIds)
            void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch(console.error)
            void printKitchenTicketsForManifests(routingResult).catch(console.error)
            void deductPrepStockForOrder(orderId, autoSendIds).catch(console.error)
            void emitOrderEvent(order.locationId, orderId, 'ORDER_SENT', { sentItemIds: autoSendIds })
          } catch (err) {
            console.error('[pay] Auto-send to kitchen failed:', err)
          }
        })()
      }
    }

    if (pmsAttemptId && pmsTransactionNo) {
      void db.pmsChargeAttempt.update({
        where: { id: pmsAttemptId },
        data: { status: 'COMPLETED', operaTransactionId: pmsTransactionNo },
      }).catch(err => console.error('[pay/room_charge] Failed to mark attempt COMPLETED:', err))
    }

    let parentWasMarkedPaid = false
    let parentTableId: string | null = null
    if (orderIsPaid && order.parentOrderId) {
      try {
        await db.$transaction(async (ptx) => {
          await ptx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.parentOrderId} FOR UPDATE`
          const allSiblings = await ptx.order.findMany({
            where: { parentOrderId: order.parentOrderId! },
            select: { id: true, status: true },
          })
          const terminalStatuses = ['paid', 'cancelled', 'voided', 'completed']
          const allSiblingsDone = allSiblings.every(s => terminalStatuses.includes(s.status))
          if (allSiblingsDone) {
            const parentResult = await ptx.order.update({
              where: { id: order.parentOrderId! },
              data: { status: 'paid', paidAt: new Date(), closedAt: new Date() },
              select: { tableId: true },
            })
            parentWasMarkedPaid = true
            parentTableId = parentResult.tableId
          }
        })
      } catch (err) {
        console.error('[Pay] Split parent check failed:', err)
      }
    }

    // Post-ingestion: loyalty points earning (fire-and-forget)
    if (orderIsPaid && pointsEarned > 0 && order.customer) {
      void db.customer.update({
        where: { id: order.customer.id },
        data: {
          loyaltyPoints: { increment: pointsEarned },
          totalSpent: { increment: Number(order.total) },
          totalOrders: { increment: 1 },
          lastVisit: new Date(),
          averageTicket: newAverageTicket!,
        },
      }).catch(err => console.error('Post-ingestion loyalty update failed:', err))
    }

    // Post-ingestion: audit logs (fire-and-forget)
    for (const bp of ingestResult.bridgedPayments) {
      void db.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId: employeeId || null,
          action: 'payment_processed',
          entityType: 'payment',
          entityId: bp.id,
          details: {
            paymentMethod: bp.paymentMethod,
            amount: bp.amount,
            tipAmount: bp.tipAmount,
            orderId,
            orderNumber: order.orderNumber,
          },
        },
      }).catch(console.error)
    }

    if (orderIsPaid) {
      void db.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId: employeeId || null,
          action: 'order_closed',
          entityType: 'order',
          entityId: orderId,
          details: {
            orderNumber: order.orderNumber,
            totalPaid: newPaidTotal,
            paymentCount: ingestResult.bridgedPayments.length,
            paymentMethods: [...new Set(ingestResult.bridgedPayments.map((p: any) => p.paymentMethod))],
          } as any,
        },
      }).catch(console.error)
    }

    // Post-ingestion: update fields not in event state (fire-and-forget)
    if (orderIsPaid) {
      void db.order.update({
        where: { id: orderId },
        data: {
          businessDayDate: businessDayStart,
          primaryPaymentMethod: updateData.primaryPaymentMethod,
          tipTotal: newTipTotal,
          version: { increment: 1 },
        },
      }).catch(console.error)
    } else {
      void db.order.update({
        where: { id: orderId },
        data: {
          tipTotal: newTipTotal,
          ...(updateData.primaryPaymentMethod ? { primaryPaymentMethod: updateData.primaryPaymentMethod } : {}),
        },
      }).catch(console.error)
    }

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
    if (orderIsPaid) {
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

      // ── Inventory Deduction Outbox ──────────────────────────────────────────
      // Create PendingDeduction synchronously after payment commit.
      // If this fails, log but don't block payment response.
      try {
        const firstPaymentId = ingestResult.bridgedPayments[0]?.id ?? null
        await db.pendingDeduction.upsert({
          where: { orderId },
          create: {
            locationId: order.locationId,
            orderId,
            paymentId: firstPaymentId,
            deductionType: 'order_deduction',
            status: 'pending',
          },
          update: {
            paymentId: firstPaymentId,
            status: 'pending',
            availableAt: new Date(),
            lastError: null,
          },
        })
      } catch (err) {
        console.error('[Pay] Failed to create PendingDeduction outbox row:', err)
      }

      // Best-effort async processing (non-blocking)
      void (async () => {
        try {
          const { processNextDeduction } = await import('@/lib/deduction-processor')
          await processNextDeduction()
        } catch (err) {
          console.error('[Pay] Best-effort deduction trigger failed (outbox will retry):', err)
        }
      })()

      // Recalculate commission from active items only (voided items zeroed)
      void (async () => {
        try {
          const activeItems = await db.orderItem.findMany({
            where: { orderId, status: 'active', deletedAt: null },
            include: {
              menuItem: { select: { commissionType: true, commissionValue: true } },
            },
          })

          let recalculatedCommission = 0
          const itemUpdates: Promise<unknown>[] = []

          for (const item of activeItems) {
            const mi = item.menuItem
            if (!mi?.commissionType || !mi?.commissionValue) continue

            const itemTotal = Number(item.itemTotal ?? 0)
            const qty = item.quantity
            const val = Number(mi.commissionValue)
            const commission = mi.commissionType === 'percent'
              ? Math.round(itemTotal * val / 100 * 100) / 100
              : Math.round(val * qty * 100) / 100

            if (commission !== Number(item.commissionAmount ?? 0)) {
              itemUpdates.push(
                db.orderItem.update({
                  where: { id: item.id },
                  data: { commissionAmount: commission },
                })
              )
            }
            recalculatedCommission += commission
          }

          await Promise.all(itemUpdates)

          const currentTotal = Number(order.commissionTotal ?? 0)
          if (Math.abs(recalculatedCommission - currentTotal) > 0.001) {
            await db.order.update({
              where: { id: orderId },
              data: { commissionTotal: recalculatedCommission },
            })
          }
        } catch (err) {
          console.error('[Pay] Commission recalculation failed:', err)
        }
      })()

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
          createdPayments: ingestResult.bridgedPayments.map((bp: any) => ({
            id: bp.id,
            paymentMethod: bp.paymentMethod,
            amount: bp.amount,
            tipAmount: bp.tipAmount,
            totalAmount: bp.totalAmount,
          })),
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
          if (order.tableId && orderIsPaid) {
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
    for (const p of ingestResult.bridgedPayments) {
      void dispatchPaymentProcessed(order.locationId, { orderId, paymentId: p.id, status: 'completed', sourceTerminalId: terminalId || undefined }).catch(() => {})
    }

    // Dispatch open orders list changed when order is fully paid (fire-and-forget)
    // Include sourceTerminalId so receiving clients can suppress "closed on another terminal" banners
    if (orderIsPaid) {
      void dispatchOpenOrdersChanged(order.locationId, { trigger: 'paid', orderId: order.id, tableId: order.tableId || undefined, sourceTerminalId: terminalId || undefined }, { async: true }).catch(() => {})

      // Dispatch order:closed for Android cross-terminal sync (fire-and-forget)
      void dispatchOrderClosed(order.locationId, {
        orderId: order.id,
        status: 'paid',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId || null,
        locationId: order.locationId,
      }, { async: true }).catch(() => {})
    }

    // Notify CFD that receipt was sent — transitions CFD to thank-you screen (fire-and-forget)
    if (orderIsPaid) {
      dispatchCFDReceiptSent(order.locationId, null, {
        orderId: order.id,
        total: Number(order.total),
      })
    }

    // Emit cloud event for fully paid orders (fire-and-forget)
    if (orderIsPaid) {
      void emitCloudEvent('order_paid', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        venueId: order.locationId,
        employeeId: order.employeeId,
        customerId: order.customerId,
        orderType: order.orderType,
        paidAt: new Date(),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        tipTotal: newTipTotal,
        discountTotal: Number(order.discountTotal),
        total: Number(order.total),
        payments: ingestResult.bridgedPayments.map((p: any) => ({
          id: p.id,
          method: p.paymentMethod,
          amount: p.amount,
          tipAmount: p.tipAmount,
          totalAmount: p.totalAmount,
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
      payments: ingestResult.bridgedPayments.map((p: any) => ({
        method: p.paymentMethod,
        amount: p.amount,
        tipAmount: p.tipAmount,
        totalAmount: p.totalAmount,
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
      // For cash discount (dual pricing) model: order.total IS the cash price.
      // If any payment was charged at the card price, show the card total on the receipt.
      total: (() => {
        const dualPricing = settings.dualPricing
        if (dualPricing.enabled) {
          const hasCardPayment = ingestResult.bridgedPayments.some(
            (p: any) => p.pricingMode === 'card'
          )
          if (hasCardPayment) {
            return calculateCardPrice(Number(order.total), dualPricing.cashDiscountPercent)
          }
        }
        return Number(order.total)
      })(),
      createdAt: order.createdAt.toISOString(),
      paidAt: new Date().toISOString(),
      customer: order.customer ? {
        name: (order.customer as any).displayName || `${(order.customer as any).firstName} ${(order.customer as any).lastName}`,
        loyaltyPoints: (order.customer as any).loyaltyPoints,
      } : null,
      loyaltyPointsRedeemed: null,
      loyaltyPointsEarned: pointsEarned || null,
    }

    // Return response — includes flat fields for Android's PayOrderData DTO
    const primaryPayment = ingestResult.bridgedPayments[0]
    const finalStatus = orderIsPaid ? 'paid' : 'partial'
    const finalBalance = orderIsPaid ? 0 : Math.max(0, effectiveTotal - newPaidTotal)
    return NextResponse.json({ data: {
      success: true,
      // Flat fields for Android compatibility
      orderId,
      paymentId: primaryPayment?.id ?? null,
      amount: primaryPayment ? primaryPayment.amount : 0,
      tipAmount: primaryPayment ? primaryPayment.tipAmount : 0,
      totalAmount: primaryPayment ? primaryPayment.totalAmount : 0,
      paymentMethod: primaryPayment?.paymentMethod ?? 'cash',
      newOrderBalance: finalBalance,
      orderStatus: finalStatus,
      // Full payment list for web POS
      payments: ingestResult.bridgedPayments.map((p: any) => ({
        id: p.id,
        paymentMethod: p.paymentMethod,
        method: p.paymentMethod,
        amount: p.amount,
        tipAmount: p.tipAmount,
        totalAmount: p.totalAmount,
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

    if (autoVoidRecords.length > 0 && autoVoidTerminalId && autoVoidLocationId) {
      const locationId = autoVoidLocationId
      const tid = autoVoidTerminalId
      const records = autoVoidRecords
      void (async () => {
        try {
          const terminal = await db.terminal.findUnique({
            where: { id: tid },
            select: { paymentReaderId: true },
          })
          if (!terminal?.paymentReaderId) {
            console.error('[CRITICAL-PAYMENT] Cannot auto-void: no reader bound to terminal', {
              terminalId: tid, orderId, records: records.map((r: any) => r.datacapRecordNo),
            })
            return
          }
          const client = await getDatacapClient(locationId)
          for (const record of records) {
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
            orderId, terminalId: tid, error: lookupErr,
          })
        }
      })()

      return NextResponse.json(
        {
          error: 'Payment approved but recording failed — automatic reversal attempted. Check Datacap portal to confirm.',
          datacapRecordNos: records.map((r: any) => r.datacapRecordNo),
        },
        { status: 500 }
      )
    }

    void errorCapture.critical('PAYMENT', 'Payment processing failed', {
      category: 'payment-processing-error',
      action: `Processing payment for Order ${orderId}`,
      orderId,
      error: error instanceof Error ? error : undefined,
      path: `/api/orders/${orderId}/pay`,
      requestBody: body,
    }).catch(() => {})

    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}, 'orders-pay'))
