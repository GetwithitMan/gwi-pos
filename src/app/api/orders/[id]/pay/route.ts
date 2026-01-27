import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateFakeAuthCode,
  generateFakeTransactionId,
  calculateRoundingAdjustment,
  roundAmount,
} from '@/lib/payment'
import { parseSettings } from '@/lib/settings'

interface PaymentInput {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
  amount: number
  tipAmount?: number
  // Cash specific
  amountTendered?: number
  // Card specific
  cardBrand?: string
  cardLast4?: string
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

    // Get the order
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        location: true,
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
    }

    await db.order.update({
      where: { id: orderId },
      data: updateData,
    })

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
    })
  } catch (error) {
    console.error('Failed to process payment:', error)
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}
