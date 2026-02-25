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

    // C-FIN-1: Read balance inside the transaction to prevent race condition.
    // Previously, balance was read outside the tx and SET inside — concurrent
    // payments could overwrite each other's balance changes.
    const result = await db.$transaction(async (tx) => {
      const account = await tx.houseAccount.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          locationId: true,
          currentBalance: true,
          status: true,
        },
      })

      if (!account) {
        throw new Error('HA_NOT_FOUND')
      }

      if (account.status !== 'active') {
        throw new Error(`HA_NOT_ACTIVE:${account.status}`)
      }

      const currentBalance = Number(account.currentBalance)
      // Clamp decrement so balance never goes negative
      const effectiveAmount = Math.min(amount, currentBalance)
      const newBalance = currentBalance - effectiveAmount

      // Atomic decrement instead of direct SET to prevent lost updates
      await tx.houseAccount.update({
        where: { id },
        data: {
          currentBalance: { decrement: effectiveAmount },
          updatedAt: new Date(),
        },
      })

      const transaction = await tx.houseAccountTransaction.create({
        data: {
          locationId: account.locationId,
          houseAccountId: id,
          type: 'payment',
          amount: -effectiveAmount,  // negative = reduces balance
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          paymentMethod,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
          employeeId,
        },
      })

      return { transaction, newBalance }
    }).catch((err: Error) => {
      if (err.message === 'HA_NOT_FOUND') {
        return { error: 'Account not found', status: 404 } as const
      }
      if (err.message.startsWith('HA_NOT_ACTIVE:')) {
        return { error: 'Account is not active', status: 409 } as const
      }
      throw err
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const { transaction, newBalance } = result

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
