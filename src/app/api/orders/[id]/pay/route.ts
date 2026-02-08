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
import { tableEvents } from '@/lib/realtime/table-events'
import { errorCapture } from '@/lib/error-capture'
import { calculateCardPrice, calculateCashDiscount } from '@/lib/pricing'

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
})

// POST - Process payment for order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()

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

    const { payments, employeeId } = validation.data

    // Get the order with customer for loyalty
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        location: true,
        customer: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
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

    // Get settings for rounding
    const settings = parseSettings(order.location.settings)

    // Calculate how much is already paid
    const alreadyPaid = order.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    const orderTotal = Number(order.total)
    const remaining = orderTotal - alreadyPaid

    // Calculate total being paid now
    const paymentTotal = payments.reduce((sum, p) => sum + p.amount + (p.tipAmount || 0), 0)

    if (paymentTotal < remaining - 0.01) {
      // Allow small rounding differences
      return NextResponse.json(
        { error: `Payment amount ($${paymentTotal.toFixed(2)}) is less than remaining balance ($${remaining.toFixed(2)})` },
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

    for (const payment of payments) {
      let paymentRecord: {
        locationId: string
        orderId: string
        employeeId: string | null
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
        status: string
      } = {
        locationId: order.locationId,
        orderId,
        employeeId: employeeId || null,
        amount: payment.amount,
        tipAmount: payment.tipAmount || 0,
        totalAmount: payment.amount + (payment.tipAmount || 0),
        paymentMethod: payment.method,
        status: 'completed',
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
        // Apply rounding if enabled
        let finalAmount = payment.amount
        let roundingAdjustment = 0

        if (settings.payments.cashRounding !== 'none') {
          roundingAdjustment = calculateRoundingAdjustment(
            payment.amount,
            settings.payments.cashRounding,
            settings.payments.roundingDirection
          )
          finalAmount = roundAmount(
            payment.amount,
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
          const expectedCashAmount = Number(order.total)
          if (Math.abs(finalAmount - expectedCashAmount) > 0.01) {
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

        // Find the gift card
        let giftCard = await db.giftCard.findUnique({
          where: { id: payment.giftCardId || '' }
        })

        if (!giftCard && payment.giftCardNumber) {
          giftCard = await db.giftCard.findUnique({
            where: { cardNumber: payment.giftCardNumber.toUpperCase() }
          })
        }

        if (!giftCard) {
          return NextResponse.json(
            { error: 'Gift card not found' },
            { status: 404 }
          )
        }

        if (giftCard.status !== 'active') {
          return NextResponse.json(
            { error: `Gift card is ${giftCard.status}` },
            { status: 400 }
          )
        }

        // Check expiration
        if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
          await db.giftCard.update({
            where: { id: giftCard.id },
            data: { status: 'expired' }
          })
          return NextResponse.json(
            { error: 'Gift card has expired' },
            { status: 400 }
          )
        }

        const cardBalance = Number(giftCard.currentBalance)
        const paymentAmount = payment.amount + (payment.tipAmount || 0)

        if (paymentAmount > cardBalance) {
          return NextResponse.json(
            { error: `Insufficient gift card balance. Available: $${cardBalance.toFixed(2)}`, currentBalance: cardBalance },
            { status: 400 }
          )
        }

        // Deduct from gift card + create payment atomically
        const newBalance = cardBalance - paymentAmount

        paymentRecord = {
          ...paymentRecord,
          transactionId: `GC:${giftCard.cardNumber}`,
          cardLast4: giftCard.cardNumber.slice(-4),
        }

        const gcResult = await db.$transaction(async (tx) => {
          await tx.giftCard.update({
            where: { id: giftCard!.id },
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
        })

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
    }

    // Update order status and tip total
    const newTipTotal = Number(order.tipTotal) + totalTips
    const newPaidTotal = alreadyPaid + paymentTotal

    const updateData: {
      tipTotal: number
      primaryPaymentMethod?: string
      status?: string
      paidAt?: Date
      closedAt?: Date
    } = {
      tipTotal: newTipTotal,
    }

    // Set primary payment method based on first/largest payment
    if (!order.primaryPaymentMethod) {
      const primaryMethod = payments[0].method
      updateData.primaryPaymentMethod = primaryMethod === 'cash' ? 'cash' : 'card'
    }

    // Mark as paid if fully paid
    if (newPaidTotal >= orderTotal - 0.01) {
      updateData.status = 'paid'
      updateData.paidAt = new Date()
      updateData.closedAt = new Date()
    }

    // Create default payments + update order status atomically
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
    })

    // If order is fully paid, reset entertainment items and cleanup virtual groups
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

      // Process liquor inventory deductions for cocktails with recipes
      // This tracks pour usage and creates inventory transactions
      await processLiquorInventory(orderId, employeeId)

      // Deduct general food/ingredient inventory (fire-and-forget to not block payment)
      // This processes MenuItemRecipes and ModifierInventoryLinks
      deductInventoryForOrder(orderId, employeeId).catch(err => {
        console.error('Background inventory deduction failed:', err)
      })

      // Clean up virtual group if this order belongs to one
      // Find the table associated with this order
      const orderTable = await db.table.findFirst({
        where: {
          orders: {
            some: { id: orderId },
          },
        },
      })

      if (orderTable?.virtualGroupId) {
        const virtualGroupId = orderTable.virtualGroupId

        // Find all tables in the group before clearing
        const groupTables = await db.table.findMany({
          where: {
            virtualGroupId,
            locationId: order.locationId,
          },
          select: { id: true },
        })

        // Dissolve the virtual group when the order is paid
        await db.table.updateMany({
          where: {
            virtualGroupId,
            locationId: order.locationId,
          },
          data: {
            virtualGroupId: null,
            virtualGroupPrimary: false,
            virtualGroupColor: null,
            virtualGroupCreatedAt: null,
            status: 'available',
          },
        })

        // Create audit log for virtual group dissolution
        await db.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: employeeId || null,
            action: 'virtual_group_dissolved',
            entityType: 'order',
            entityId: orderId,
            details: {
              virtualGroupId,
              reason: 'Order paid',
              primaryTableId: orderTable.id,
            },
          },
        })

        // Emit real-time event for UI updates
        tableEvents.virtualGroupDissolved?.({
          virtualGroupId,
          tableIds: groupTables.map(t => t.id),
          locationId: order.locationId,
          timestamp: new Date().toISOString(),
          triggeredBy: employeeId,
        })
      } else if (order.tableId) {
        // Regular table (not virtual group) - just reset status
        await db.table.update({
          where: { id: order.tableId },
          data: { status: 'available' },
        })
      }
    }

    // Award loyalty points if order is fully paid and has a customer
    let pointsEarned = 0
    if (updateData.status === 'paid' && order.customer && settings.loyalty.enabled) {
      // Calculate earning base (subtotal or total based on settings)
      let earningBase = settings.loyalty.earnOnSubtotal
        ? Number(order.subtotal)
        : Number(order.total)

      // Add tips if configured
      if (settings.loyalty.earnOnTips) {
        earningBase += newTipTotal
      }

      // Check minimum earning amount
      if (earningBase >= settings.loyalty.minimumEarnAmount) {
        // Calculate points (1 point per dollar by default)
        pointsEarned = Math.floor(earningBase * settings.loyalty.pointsPerDollar)

        if (pointsEarned > 0) {
          // Update customer loyalty points and stats
          await db.customer.update({
            where: { id: order.customer.id },
            data: {
              loyaltyPoints: { increment: pointsEarned },
              totalSpent: { increment: Number(order.total) },
              totalOrders: { increment: 1 },
              lastVisit: new Date(),
              averageTicket: {
                set: await db.customer.findUnique({
                  where: { id: order.customer.id },
                }).then(c => {
                  if (!c) return Number(order.total)
                  const newTotal = Number(c.totalSpent) + Number(order.total)
                  const newOrders = c.totalOrders + 1
                  return newTotal / newOrders
                }),
              },
            },
          })
        }
      }
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

    // Return response
    return NextResponse.json({
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
      orderStatus: newPaidTotal >= orderTotal - 0.01 ? 'paid' : 'partial',
      remainingBalance: Math.max(0, orderTotal - newPaidTotal),
      // Loyalty info
      loyaltyPointsEarned: pointsEarned,
      customerId: order.customer?.id || null,
    })
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
}
