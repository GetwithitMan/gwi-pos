import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchPaymentProcessed, dispatchOrderClosed, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
// deductInventoryForOrder replaced by PendingDeduction outbox pattern (see pay/route.ts)
// import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { parseSettings } from '@/lib/settings'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { calculateAutoGratuity } from '@/lib/domain/payment/auto-gratuity'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { requireAnyPermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-pay-all-splits')

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
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: parentOrderId } = await params

  try {
    const body = await request.json()

    const validation = PayAllSplitsSchema.safeParse(body)
    if (!validation.success) {
      return err('Invalid request', 400, validation.error.format())
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
      return notFound('Order not found')
    }
    const payAllAuth = await requireAnyPermission(payAllEmployeeId, payAllOrderCheck.locationId, paymentPermissions)
    if (!payAllAuth.authorized) return err(payAllAuth.error, payAllAuth.status)

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
      return notFound('Order not found')
    }

    if (parentOrder.status !== 'split') {
      return err('Order is not a split parent. Only orders with status "split" can use this endpoint.')
    }

    // Find unpaid split children
    const unpaidSplits = parentOrder.splitOrders.filter(s => s.status !== 'paid')

    if (unpaidSplits.length === 0) {
      return err('All split tickets are already paid')
    }

    // Idempotency check — per-split keys use format `${key}:split:${splitId}`
    const perSplitKeys = new Set(unpaidSplits.map(s => `${effectiveIdempotencyKey}:split:${s.id}`))
    const existingPayment = parentOrder.splitOrders
      .flatMap(s => s.payments)
      .find(p => p.idempotencyKey && perSplitKeys.has(p.idempotencyKey))
    if (existingPayment) {
      return ok({
        success: true,
        duplicate: true,
        parentOrderId,
        message: 'Duplicate payment detected — already processed',
      })
    }

    // Parse settings before tx — needed for loyalty inside tx and tips outside
    const settings = parseSettings(parentOrder.location.settings)

    // ── Party-size auto-gratuity for pay-all-splits ────────────────────────
    // Use parent's guestCount (split children all have guestCount: 1)
    const autoGratPerSplit = new Map<string, number>()
    if (settings.autoGratuity?.enabled && parentOrder.guestCount >= (settings.autoGratuity.minimumPartySize || 0)) {
      for (const split of unpaidSplits) {
        const splitSubtotal = Number(split.subtotal ?? split.total ?? 0)
        const autoGratResult = calculateAutoGratuity(settings.autoGratuity, {
          guestCount: parentOrder.guestCount,
          existingTipTotal: Number(split.tipTotal ?? 0),
          orderSubtotal: splitSubtotal,
          payments: [{ method }],
        })
        if (autoGratResult.applied && autoGratResult.amount > 0) {
          autoGratPerSplit.set(split.id, autoGratResult.amount)
        }
      }
    }

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
    const { paymentMap: splitPaymentMap, loyaltyPointsEarned } = await db.$transaction(async (tx) => {
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
        unpaidSplits.map(async (split) => {
          const cashSplitTotal = roundToCents(Number(split.total))
          const splitTotal = dualPricingApplies
            ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
            : cashSplitTotal
          const splitAutoGratTip = autoGratPerSplit.get(split.id) ?? 0

          // If auto-gratuity applies, update the split order's tipTotal
          if (splitAutoGratTip > 0) {
            await tx.order.update({
              where: { id: split.id },
              data: { tipTotal: splitAutoGratTip },
            })
          }

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
              tipAmount: splitAutoGratTip,
              totalAmount: roundToCents(splitTotal + splitAutoGratTip),
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
      let loyaltyPointsEarned = 0
      if (parentOrder.customer && settings.loyalty.enabled) {
        const earningBase = settings.loyalty.earnOnSubtotal
          ? Number(parentOrder.splitOrders.reduce((sum, s) => sum + Number(s.subtotal), 0))
          : combinedTotal

        // Check for tier multiplier from LoyaltyTier
        let tierMultiplier = 1.0
        const custTierId = (parentOrder.customer as any).loyaltyTierId
        if (custTierId) {
          try {
            const tierRows = await tx.$queryRaw<Array<{ pointsMultiplier: unknown }>>`SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = ${custTierId} AND "deletedAt" IS NULL`
            if (tierRows.length > 0) {
              tierMultiplier = Number(tierRows[0].pointsMultiplier) || 1.0
            }
          } catch { /* table may not exist yet — graceful fallback */ }
        }

        if (earningBase >= settings.loyalty.minimumEarnAmount) {
          loyaltyPointsEarned = Math.round(earningBase * settings.loyalty.pointsPerDollar * tierMultiplier)
          if (loyaltyPointsEarned > 0) {
            await tx.customer.update({
              where: { id: parentOrder.customer.id },
              data: {
                loyaltyPoints: { increment: loyaltyPointsEarned },
                lifetimePoints: { increment: loyaltyPointsEarned },
                totalSpent: { increment: combinedTotal },
                totalOrders: { increment: 1 },
                lastVisit: new Date(),
              },
            })
          }
        }
      }

      return { paymentMap, loyaltyPointsEarned }
    })

    // Create LoyaltyTransaction record + check tier promotion (fire-and-forget)
    if (loyaltyPointsEarned > 0 && parentOrder.customer) {
      void (async () => {
        try {
          const customer = parentOrder.customer!
          const custId = customer.id
          const currentPoints = Number((customer as any).loyaltyPoints ?? 0)
          const currentLifetime = Number((customer as any).lifetimePoints ?? 0)
          const custTierId = (customer as any).loyaltyTierId

          // Resolve tier multiplier for description
          let tierMultiplier = 1.0
          if (custTierId) {
            try {
              const tierRows = await db.$queryRaw<Array<{ pointsMultiplier: unknown }>>`SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = ${custTierId} AND "deletedAt" IS NULL`
              if (tierRows.length > 0) {
                tierMultiplier = Number(tierRows[0].pointsMultiplier) || 1.0
              }
            } catch { /* table may not exist yet */ }
          }

          const txnId = crypto.randomUUID()
          const loyaltyDescription = `Earned ${loyaltyPointsEarned} points on split order #${parentOrder.orderNumber}${tierMultiplier > 1 ? ` (${tierMultiplier}x tier)` : ''}`
          await db.$executeRaw`INSERT INTO "LoyaltyTransaction" (
              "id", "customerId", "locationId", "orderId", "type", "points",
              "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
            ) VALUES (${txnId}, ${custId}, ${parentOrder.locationId}, ${parentOrderId}, 'earn', ${loyaltyPointsEarned}, ${currentPoints}, ${currentPoints + loyaltyPointsEarned}, ${loyaltyDescription}, ${employeeId || null}, NOW())`

          // Check tier promotion
          const newLifetime = currentLifetime + loyaltyPointsEarned
          const custProgramId = (customer as any).loyaltyProgramId
          if (custProgramId) {
            const tiers = await db.$queryRaw<Array<{ id: string; name: string; minimumPoints: number }>>`SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
               WHERE "programId" = ${custProgramId} AND "deletedAt" IS NULL ORDER BY "minimumPoints" DESC`
            for (const tier of tiers) {
              if (newLifetime >= Number(tier.minimumPoints)) {
                if (tier.id !== custTierId) {
                  await db.$executeRaw`UPDATE "Customer" SET "loyaltyTierId" = ${tier.id}, "updatedAt" = NOW() WHERE "id" = ${custId}`
                }
                break
              }
            }
          }
        } catch (err) {
          console.error('[pay-all-splits] Loyalty transaction/tier check failed:', err)
        }
      })()
    }

    // Fire-and-forget socket events
    void dispatchOpenOrdersChanged(parentOrder.locationId, {
      trigger: 'paid',
      orderId: parentOrderId,
      tableId: parentOrder.tableId || undefined,
      sourceTerminalId: terminalId || undefined,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay-all-splits'))

    if (parentOrder.tableId) {
      void dispatchTableStatusChanged(parentOrder.locationId, { tableId: parentOrder.tableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
    }

    // Dispatch payment:processed for each split payment (fire-and-forget)
    for (const split of unpaidSplits) {
      const cashSplitTotal = roundToCents(Number(split.total))
      const splitTotal = dualPricingApplies
        ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
        : cashSplitTotal
      const splitAutoGratTip = autoGratPerSplit.get(split.id) ?? 0
      void dispatchPaymentProcessed(parentOrder.locationId, {
        orderId: split.id,
        paymentId: splitPaymentMap.get(split.id),
        status: 'completed',
        method,
        amount: splitTotal,
        tipAmount: splitAutoGratTip,
        totalAmount: roundToCents(splitTotal + splitAutoGratTip),
        employeeId: split.employeeId || employeeId || null,
        isClosed: true,
        parentOrderId: parentOrderId,
        allSiblingsPaid: true,
        sourceTerminalId: terminalId || undefined,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Dispatch order:closed for the parent order (Android cross-terminal sync)
    void dispatchOrderClosed(parentOrder.locationId, {
      orderId: parentOrderId,
      status: 'paid',
      closedAt: now.toISOString(),
      closedByEmployeeId: employeeId || null,
      locationId: parentOrder.locationId,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    for (const split of unpaidSplits) {
      const cashSplitTotal = roundToCents(Number(split.total))
      const splitTotal = dualPricingApplies
        ? calculateCardPrice(cashSplitTotal, dualPricing.cashDiscountPercent)
        : cashSplitTotal
      const splitAutoGratTipEmit = autoGratPerSplit.get(split.id) ?? 0
      void emitOrderEvents(split.locationId, split.id, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: splitPaymentMap.get(split.id) || split.id,
            method,
            amountCents: Math.round(splitTotal * 100),
            tipCents: Math.round(splitAutoGratTipEmit * 100),
            totalCents: Math.round((splitTotal + splitAutoGratTipEmit) * 100),
            ...(cardBrand && { cardBrand }),
            ...(cardLast4 && { cardLast4 }),
            status: 'completed',
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid' },
        },
      ]).catch(err => log.warn({ err }, 'Background task failed'))
    }
    void emitOrderEvent(parentOrder.locationId, parentOrderId, 'ORDER_CLOSED', {
      closedStatus: 'paid',
      reason: `All ${unpaidSplits.length} splits paid`,
    }).catch(err => log.warn({ err }, 'Background task failed'))
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

    // Fire-and-forget: tip allocation for splits that have tips (including auto-gratuity)
    for (const split of unpaidSplits) {
      const autoGratTipForSplit = autoGratPerSplit.get(split.id) ?? 0
      const splitTipTotal = Number(split.tipTotal || 0) + autoGratTipForSplit
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

    pushUpstream()

    return ok({
      success: true,
      splitsPaid: unpaidSplits.length,
      totalAmount: Math.round(combinedTotal * 100) / 100,
      parentOrderId,
    })
  } catch (error) {
    // Handle race condition: another request already paid all splits
    if (error instanceof Error && error.message === 'ALL_SPLITS_ALREADY_PAID') {
      return ok({
        success: true,
        duplicate: true,
        parentOrderId,
        message: 'All splits were already paid by another request',
      })
    }
    console.error('Failed to pay all splits:', error)
    return err('Failed to pay all splits', 500)
  }
}))
