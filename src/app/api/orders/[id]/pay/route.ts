import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateFakeAuthCode,
  generateFakeTransactionId,
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { parseSettings } from '@/lib/settings'
import { processLiquorInventory } from '@/lib/liquor-inventory'

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
  // Simulated - will be replaced with real processor
  simulate?: boolean
}

// POST - Process payment for order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { payments, employeeId } = body as {
      payments: PaymentInput[]
      employeeId?: string
    }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json(
        { error: 'At least one payment is required' },
        { status: 400 }
      )
    }

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

    // Process each payment
    const createdPayments = []
    let totalTips = 0

    for (const payment of payments) {
      let paymentRecord: {
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
        status: string
      } = {
        orderId,
        employeeId: employeeId || null,
        amount: payment.amount,
        tipAmount: payment.tipAmount || 0,
        totalAmount: payment.amount + (payment.tipAmount || 0),
        paymentMethod: payment.method,
        status: 'completed',
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

        paymentRecord = {
          ...paymentRecord,
          amount: finalAmount,
          totalAmount: finalAmount + (payment.tipAmount || 0),
          amountTendered,
          changeGiven,
          roundingAdjustment: roundingAdjustment !== 0 ? roundingAdjustment : undefined,
        }
      } else if (payment.method === 'credit' || payment.method === 'debit') {
        // Simulated card payment
        if (!payment.cardLast4 || !/^\d{4}$/.test(payment.cardLast4)) {
          return NextResponse.json(
            { error: 'Valid card last 4 digits required' },
            { status: 400 }
          )
        }

        paymentRecord = {
          ...paymentRecord,
          cardBrand: payment.cardBrand || 'visa',
          cardLast4: payment.cardLast4,
          authCode: generateFakeAuthCode(),
          transactionId: generateFakeTransactionId(),
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

        // Deduct points from customer
        await db.customer.update({
          where: { id: order.customer.id },
          data: {
            loyaltyPoints: { decrement: payment.pointsUsed },
          },
        })

        // Store points used in payment record metadata
        paymentRecord = {
          ...paymentRecord,
          // Use transactionId to store points info for now
          transactionId: `LOYALTY:${payment.pointsUsed}pts`,
        }
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

        // Deduct from gift card
        const newBalance = cardBalance - paymentAmount

        await db.giftCard.update({
          where: { id: giftCard.id },
          data: {
            currentBalance: newBalance,
            status: newBalance === 0 ? 'depleted' : 'active',
            transactions: {
              create: {
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

        paymentRecord = {
          ...paymentRecord,
          transactionId: `GC:${giftCard.cardNumber}`,
          cardLast4: giftCard.cardNumber.slice(-4),
        }
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
        dueDate.setDate(dueDate.getDate() + (houseAccount.paymentTerms || 30))

        // Charge to house account
        await db.houseAccount.update({
          where: { id: houseAccount.id },
          data: {
            currentBalance: newBalance,
            transactions: {
              create: {
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

        paymentRecord = {
          ...paymentRecord,
          transactionId: `HA:${houseAccount.id}`,
          // Store account name info for receipt
          authCode: houseAccount.name,
        }
      }

      const created = await db.payment.create({
        data: paymentRecord,
      })

      createdPayments.push(created)
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

    await db.order.update({
      where: { id: orderId },
      data: updateData,
    })

    // If order is fully paid, reset entertainment items
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
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}
