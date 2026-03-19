import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchPaymentProcessed, dispatchOrderClosed, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
// deductInventoryForOrder replaced by PendingDeduction outbox pattern (see pay/route.ts)
// import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { parseSettings } from '@/lib/settings'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { requireAnyPermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

const PayAllSplitsSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit']),
  employeeId: z.string().min(1, 'employeeId is required'),
  terminalId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  // Card details (required for credit/debit)
  cardBrand: z.string().optional(),
  cardLast4: z.string().optional(),
  authCode: z.string().optional(),
  datacapRecordNo: z.string().optional(),
  datacapRefNumber: z.string().optional(),
  datacapSequenceNo: z.string().optional(),
  entryMethod: z.string().optional(),
  amountAuthorized: z.number().optional(),
})

// POST - Pay all unpaid split children of a parent order in one batch
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: parentOrderId } = await params

  try {
    const body = await request.json()

    const validation = PayAllSplitsSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.format() },
        { status: 400 }
      )
    }

    const { method, employeeId, terminalId, idempotencyKey, cardBrand, cardLast4, authCode, datacapRecordNo, datacapRefNumber, datacapSequenceNo, entryMethod, amountAuthorized } = validation.data

    // Permission check: require POS_CASH_PAYMENTS or POS_CARD_PAYMENTS based on payment method
    const paymentPermissions = method === 'cash'
      ? [PERMISSIONS.POS_CASH_PAYMENTS]
      : [PERMISSIONS.POS_CARD_PAYMENTS]
    const actor = await getActorFromRequest(request)
    const payAllEmployeeId = employeeId || actor.employeeId
    // Lightweight order fetch for locationId
    const payAllOrderCheck = await db.order.findFirst({
      where: { id: parentOrderId, deletedAt: null },
      select: { locationId: true },
    })
    if (!payAllOrderCheck) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    const payAllAuth = await requireAnyPermission(payAllEmployeeId, payAllOrderCheck.locationId, paymentPermissions)
    if (!payAllAuth.authorized) return NextResponse.json({ error: payAllAuth.error }, { status: payAllAuth.status })

    // W2-P1: Generate server-side idempotency key if client didn't provide one
    const effectiveIdempotencyKey = idempotencyKey || crypto.randomUUID()

    // Fetch parent order with its split children
    const parentOrder = await db.order.findUnique({
      where: { id: parentOrderId },
      include: {
        location: true,
        customer: true,
        splitOrders: {
          where: { deletedAt: null },
          include: {
            payments: { where: { status: 'completed' }, select: { totalAmount: true, idempotencyKey: true } },
          },
        },
      },
    })

    if (!parentOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (parentOrder.status !== 'split') {
      return NextResponse.json(
        { error: 'Order is not a split parent. Only orders with status "split" can use this endpoint.' },
        { status: 400 }
      )
    }

    // Find unpaid split children
    const unpaidSplits = parentOrder.splitOrders.filter(s => s.status !== 'paid')

    if (unpaidSplits.length === 0) {
      return NextResponse.json(
        { error: 'All split tickets are already paid' },
        { status: 400 }
      )
    }

    // Idempotency check — per-split keys use format `${key}:split:${splitId}`
    const perSplitKeys = new Set(unpaidSplits.map(s => `${effectiveIdempotencyKey}:split:${s.id}`))
    const existingPayment = parentOrder.splitOrders
      .flatMap(s => s.payments)
      .find(p => p.idempotencyKey && perSplitKeys.has(p.idempotencyKey))
    if (existingPayment) {
      return NextResponse.json({ data: {
        success: true,
        duplicate: true,
        parentOrderId,
        message: 'Duplicate payment detected — already processed',
      } })
    }

    // Parse settings before tx — needed for loyalty inside tx and tips outside
    const settings = parseSettings(parentOrder.location.settings)

    // Dual pricing: determine if card price applies to this payment method
    const dualPricing = settings.dualPricing
    const isCard = method !== 'cash'
    const dualPricingApplies = dualPricing.enabled && isCard && (
      (method === 'credit' && dualPricing.applyToCredit) ||
      (method === 'debit' && dualPricing.applyToDebit)
    )

    // Calculate combined total (W2-P2: round to avoid floating-point drift)
    // For card payments with dual pricing, use card price (cash price × (1 + %))
    const combinedTotal = roundToCents(unpaidSplits.reduce((sum, s) => {
      const cashAmt = Number(s.total)
      const amt = dualPricingApplies ? calculateCardPrice(cashAmt, dualPricing.cashDiscountPercent) : cashAmt
      return sum + amt
    }, 0))

    // Process all payments atomically
    const now = new Date()

    // Build shared card detail fields once
    const cardDetails = {
      ...(cardBrand && { cardBrand }),
      ...(cardLast4 && { cardLast4 }),
      ...(authCode && { authCode }),
      ...(datacapRecordNo && { datacapRecordNo }),
      ...(datacapRefNumber && { datacapRefNumber }),
      ...(datacapSequenceNo && { datacapSequenceNo }),
      ...(entryMethod && { entryMethod }),
      ...(amountAuthorized && { amountAuthorized }),
    }

    const unpaidSplitIds = unpaidSplits.map(s => s.id)

    // splitPaymentMap: splitOrderId → real payment row ID (populated inside tx, used outside for events)
    const splitPaymentMap = await db.$transaction(async (tx) => {
      // RACE-CONDITION FIX: Lock the parent order first to prevent concurrent
      // pay-all-splits requests from double-paying all splits.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${parentOrderId} FOR UPDATE`

      // Also lock each split order to prevent individual split payments racing
      for (const split of unpaidSplits) {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${split.id} FOR UPDATE`
      }

      // TX-KEEP: LOCK — re-check split payment status inside FOR UPDATE lock to prevent double-pay
      const lockedSplits = await tx.order.findMany({
        where: { id: { in: unpaidSplitIds }, locationId: parentOrder.locationId, deletedAt: null },
        select: { id: true, status: true },
      })
      const stillUnpaid = lockedSplits.filter(s => s.status !== 'paid')
      if (stillUnpaid.length === 0) {
        throw new Error('ALL_SPLITS_ALREADY_PAID')
      }

      // Create payments individually to capture real payment IDs for event emission
      const createdPayments = await Promise.all(
        unpaidSplits.map(split => {
          const cashSplitTotal = roundToCents(Number(split.total))
          const splitTotal = dualPricingApplies
            ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
            : cashSplitTotal

          // TX-KEEP: CREATE — payment record per split inside FOR UPDATE lock; no batch payment create repo method
          return tx.payment.create({
            data: {
              locationId: split.locationId,
              orderId: split.id,
              // Use split.employeeId (the selling employee) for sale credit,
              // falling back to request employeeId if split has none.
              employeeId: split.employeeId || employeeId,
              terminalId: terminalId || null,
              amount: splitTotal,
              tipAmount: 0,
              totalAmount: splitTotal,
              paymentMethod: method,
              status: 'completed',
              ...cardDetails,
              idempotencyKey: `${effectiveIdempotencyKey}:split:${split.id}`,
            },
            select: { id: true, orderId: true, totalAmount: true },
          })
        })
      )

      // Build lookup: splitOrderId → real payment row ID (returned from tx)
      const paymentMap = new Map(createdPayments.map(p => [p.orderId, p.id]))

      // Batch-update all unpaid splits to paid + mark parent as paid
      await Promise.all([
        // TX-KEEP: BULK — batch mark all unpaid split orders as paid by ID array; no batch repo method
        tx.order.updateMany({
          where: { id: { in: unpaidSplitIds }, locationId: parentOrder.locationId },
          data: { status: 'paid', paidAt: now },
        }),
        OrderRepository.updateOrder(parentOrderId, parentOrder.locationId, { status: 'paid', paidAt: now, closedAt: now }, tx),
        // Reset table if parent had one
        ...(parentOrder.tableId
          ? [tx.table.update({ where: { id: parentOrder.tableId }, data: { status: 'available' } })]
          : []),
      ])

      // W2-P1: Loyalty points INSIDE transaction to prevent double-credit on retry
      if (parentOrder.customer && settings.loyalty.enabled) {
        const earningBase = settings.loyalty.earnOnSubtotal
          ? Number(parentOrder.splitOrders.reduce((sum, s) => sum + Number(s.subtotal), 0))
          : combinedTotal
        if (earningBase >= settings.loyalty.minimumEarnAmount) {
          const pointsEarned = Math.floor(earningBase * settings.loyalty.pointsPerDollar)
          if (pointsEarned > 0) {
            await tx.customer.update({
              where: { id: parentOrder.customer.id },
              data: {
                loyaltyPoints: { increment: pointsEarned },
                totalSpent: { increment: combinedTotal },
                totalOrders: { increment: 1 },
                lastVisit: new Date(),
              },
            })
          }
        }
      }

      return paymentMap
    })

    // Fire-and-forget socket events
    void dispatchOpenOrdersChanged(parentOrder.locationId, {
      trigger: 'paid',
      orderId: parentOrderId,
      tableId: parentOrder.tableId || undefined,
      sourceTerminalId: terminalId || undefined,
    }, { async: true }).catch(() => {})

    if (parentOrder.tableId) {
      void dispatchTableStatusChanged(parentOrder.locationId, { tableId: parentOrder.tableId, status: 'available' }).catch(console.error)
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(() => {})
    }

    // Dispatch payment:processed for each split payment (fire-and-forget)
    for (const split of unpaidSplits) {
      const cashSplitTotal = roundToCents(Number(split.total))
      const splitTotal = dualPricingApplies
        ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
        : cashSplitTotal
      void dispatchPaymentProcessed(parentOrder.locationId, {
        orderId: split.id,
        paymentId: splitPaymentMap.get(split.id),
        status: 'completed',
        method,
        amount: splitTotal,
        tipAmount: 0,
        totalAmount: splitTotal,
        employeeId: split.employeeId || employeeId || null,
        isClosed: true,
        parentOrderId: parentOrderId,
        allSiblingsPaid: true,
        sourceTerminalId: terminalId || undefined,
      }).catch(console.error)
    }

    // Dispatch order:closed for the parent order (Android cross-terminal sync)
    void dispatchOrderClosed(parentOrder.locationId, {
      orderId: parentOrderId,
      status: 'paid',
      closedAt: now.toISOString(),
      closedByEmployeeId: employeeId || null,
      locationId: parentOrder.locationId,
    }, { async: true }).catch(console.error)

    // Event emission: PAYMENT_APPLIED + ORDER_CLOSED per split, then parent ORDER_CLOSED
    for (const split of unpaidSplits) {
      const cashSplitTotal = roundToCents(Number(split.total))
      const splitTotal = dualPricingApplies
        ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
        : cashSplitTotal
      void emitOrderEvents(split.locationId, split.id, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: splitPaymentMap.get(split.id) || split.id,
            method,
            amountCents: Math.round(splitTotal * 100),
            tipCents: 0,
            totalCents: Math.round(splitTotal * 100),
            ...(cardBrand && { cardBrand }),
            ...(cardLast4 && { cardLast4 }),
            status: 'completed',
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid' },
        },
      ]).catch(console.error)
    }
    void emitOrderEvent(parentOrder.locationId, parentOrderId, 'ORDER_CLOSED', {
      closedStatus: 'paid',
      reason: `All ${unpaidSplits.length} splits paid`,
    }).catch(console.error)

    // ── Inventory Deduction Outbox ──────────────────────────────────────────
    // Create PendingDeduction rows for each split child, then trigger best-effort processing.
    // This mirrors the pattern in pay/route.ts — durable outbox instead of fire-and-forget.
    for (const split of unpaidSplits) {
      try {
        const splitPaymentId = splitPaymentMap.get(split.id) ?? null
        const existingDeduction = await db.pendingDeduction.findUnique({ where: { orderId: split.id } })
        if (!existingDeduction) {
          await db.pendingDeduction.create({
            data: {
              locationId: split.locationId,
              orderId: split.id,
              paymentId: splitPaymentId,
              deductionType: 'order_deduction',
              status: 'pending',
            },
          })
        } else if (existingDeduction.status !== 'succeeded' && existingDeduction.status !== 'dead') {
          await db.pendingDeduction.update({
            where: { orderId: split.id },
            data: {
              paymentId: splitPaymentId,
              status: 'pending',
              availableAt: new Date(),
              lastError: null,
            },
          })
        }
      } catch (err) {
        console.error(`[Pay-All-Splits] Failed to create PendingDeduction for split ${split.id}:`, err)
      }
    }

    // Best-effort async processing (non-blocking)
    void (async () => {
      try {
        const { processNextDeduction } = await import('@/lib/deduction-processor')
        await processNextDeduction()
      } catch (err) {
        console.error('[Pay-All-Splits] Best-effort deduction trigger failed (outbox will retry):', err)
      }
    })()

    // Fire-and-forget: tip allocation for splits that have tips
    for (const split of unpaidSplits) {
      const splitTipTotal = Number(split.tipTotal || 0)
      if (splitTipTotal > 0 && split.employeeId) {
        void allocateTipsForPayment({
          locationId: split.locationId,
          orderId: split.id,
          primaryEmployeeId: split.employeeId,
          createdPayments: [{
            id: splitPaymentMap.get(split.id) || split.id,
            paymentMethod: method,
            tipAmount: splitTipTotal,
          }],
          totalTipsDollars: splitTipTotal,
          tipBankSettings: settings.tipBank,
        }).catch(err => {
          console.error(`[PAYMENT-SAFETY] Tip allocation failed for split ${split.id}:`, err)
        })
      }
    }

    return NextResponse.json({ data: {
      success: true,
      splitsPaid: unpaidSplits.length,
      totalAmount: Math.round(combinedTotal * 100) / 100,
      parentOrderId,
    } })
  } catch (error) {
    // Handle race condition: another request already paid all splits
    if (error instanceof Error && error.message === 'ALL_SPLITS_ALREADY_PAID') {
      return NextResponse.json({ data: {
        success: true,
        duplicate: true,
        parentOrderId,
        message: 'All splits were already paid by another request',
      } })
    }
    console.error('Failed to pay all splits:', error)
    return NextResponse.json(
      { error: 'Failed to pay all splits' },
      { status: 500 }
    )
  }
})
