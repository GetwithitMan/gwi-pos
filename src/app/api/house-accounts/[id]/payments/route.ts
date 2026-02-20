import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Record a payment against a house account balance
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const { amount, paymentMethod, referenceNumber, notes, employeeId } = body

    // Validate required fields
    if (amount === undefined || amount === null) {
      return NextResponse.json({ error: 'amount is required' }, { status: 400 })
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a number greater than 0' }, { status: 400 })
    }
    if (!paymentMethod) {
      return NextResponse.json({ error: 'paymentMethod is required' }, { status: 400 })
    }
    const validPaymentMethods = ['cash', 'check', 'ach', 'wire', 'card']
    if (!validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { error: `paymentMethod must be one of: ${validPaymentMethods.join(', ')}` },
        { status: 400 }
      )
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }

    // Fetch the house account
    const account = await db.houseAccount.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        locationId: true,
        currentBalance: true,
        creditLimit: true,
        status: true,
        deletedAt: true,
      },
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    if (account.status !== 'active') {
      return NextResponse.json({ error: 'Account is not active' }, { status: 409 })
    }

    const { locationId } = account
    const currentBalance = Number(account.currentBalance)

    // Calculate new balance — clamp to 0 minimum (cannot go negative)
    const newBalance = Math.max(0, currentBalance - amount)

    // Execute as a transaction: update balance + create transaction record
    const [, transaction] = await db.$transaction([
      db.houseAccount.update({
        where: { id },
        data: {
          currentBalance: newBalance,
          updatedAt: new Date(),
        },
      }),
      db.houseAccountTransaction.create({
        data: {
          locationId,
          houseAccountId: id,
          type: 'payment',
          amount: -amount,        // negative = reduces balance
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          paymentMethod,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
          employeeId,
        },
      }),
    ])

    return NextResponse.json({
      data: {
        transaction: {
          ...transaction,
          amount: Number(transaction.amount),
          balanceBefore: Number(transaction.balanceBefore),
          balanceAfter: Number(transaction.balanceAfter),
        },
        newBalance: Number(newBalance),
      },
    })
  } catch (error) {
    console.error('Failed to record payment:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
})
