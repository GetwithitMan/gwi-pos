import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get gift card details (by ID or card number)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    // Try to find by ID first, then by card number
    let giftCard = await db.giftCard.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        }
      }
    })

    if (!giftCard) {
      // Try by card number
      giftCard = await db.giftCard.findUnique({
        where: { cardNumber: id.toUpperCase() },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          }
        }
      })
    }

    if (!giftCard) {
      return NextResponse.json(
        { error: 'Gift card not found' },
        { status: 404 }
      )
    }

    // Verify location if provided
    if (locationId && giftCard.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Gift card not found at this location' },
        { status: 404 }
      )
    }

    // Check if expired
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt && giftCard.status === 'active') {
      await db.giftCard.update({
        where: { id: giftCard.id },
        data: { status: 'expired' }
      })
      giftCard.status = 'expired'
    }

    return NextResponse.json({
      ...giftCard,
      initialBalance: Number(giftCard.initialBalance),
      currentBalance: Number(giftCard.currentBalance),
      transactions: giftCard.transactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
      }))
    })
  } catch (error) {
    console.error('Failed to fetch gift card:', error)
    return NextResponse.json(
      { error: 'Failed to fetch gift card' },
      { status: 500 }
    )
  }
}

// PUT - Update gift card (freeze/unfreeze, reload)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, amount, employeeId, orderId, notes, reason } = body

    const giftCard = await db.giftCard.findUnique({
      where: { id }
    })

    if (!giftCard) {
      return NextResponse.json(
        { error: 'Gift card not found' },
        { status: 404 }
      )
    }

    // Handle different actions
    switch (action) {
      case 'freeze': {
        if (giftCard.status !== 'active') {
          return NextResponse.json(
            { error: 'Can only freeze active gift cards' },
            { status: 400 }
          )
        }
        const frozen = await db.giftCard.update({
          where: { id },
          data: {
            status: 'frozen',
            frozenAt: new Date(),
            frozenReason: reason || 'Manual freeze',
          }
        })
        return NextResponse.json({
          ...frozen,
          initialBalance: Number(frozen.initialBalance),
          currentBalance: Number(frozen.currentBalance),
        })
      }

      case 'unfreeze': {
        if (giftCard.status !== 'frozen') {
          return NextResponse.json(
            { error: 'Can only unfreeze frozen gift cards' },
            { status: 400 }
          )
        }
        const unfrozen = await db.giftCard.update({
          where: { id },
          data: {
            status: 'active',
            frozenAt: null,
            frozenReason: null,
          }
        })
        return NextResponse.json({
          ...unfrozen,
          initialBalance: Number(unfrozen.initialBalance),
          currentBalance: Number(unfrozen.currentBalance),
        })
      }

      case 'reload': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for reload' },
            { status: 400 }
          )
        }
        if (giftCard.status !== 'active') {
          return NextResponse.json(
            { error: 'Can only reload active gift cards' },
            { status: 400 }
          )
        }

        const currentBalance = Number(giftCard.currentBalance)
        const newBalance = currentBalance + amount

        const reloaded = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: newBalance,
            transactions: {
              create: {
                type: 'reload',
                amount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                employeeId,
                orderId,
                notes: notes || 'Reload',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        return NextResponse.json({
          ...reloaded,
          initialBalance: Number(reloaded.initialBalance),
          currentBalance: Number(reloaded.currentBalance),
        })
      }

      case 'redeem': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for redemption' },
            { status: 400 }
          )
        }
        if (giftCard.status !== 'active') {
          return NextResponse.json(
            { error: 'Gift card is not active' },
            { status: 400 }
          )
        }

        const currentBalance = Number(giftCard.currentBalance)
        if (amount > currentBalance) {
          return NextResponse.json(
            { error: 'Insufficient balance', currentBalance },
            { status: 400 }
          )
        }

        const newBalance = currentBalance - amount
        const newStatus = newBalance === 0 ? 'depleted' : 'active'

        const redeemed = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: newBalance,
            status: newStatus,
            transactions: {
              create: {
                type: 'redemption',
                amount: -amount, // Negative for redemptions
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                employeeId,
                orderId,
                notes: notes || 'Redemption',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        return NextResponse.json({
          ...redeemed,
          initialBalance: Number(redeemed.initialBalance),
          currentBalance: Number(redeemed.currentBalance),
          amountRedeemed: amount,
        })
      }

      case 'refund': {
        // Refund a previous redemption
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for refund' },
            { status: 400 }
          )
        }

        const currentBalance = Number(giftCard.currentBalance)
        const newBalance = currentBalance + amount

        const refunded = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: newBalance,
            status: 'active', // Reactivate if depleted
            transactions: {
              create: {
                type: 'refund',
                amount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                employeeId,
                orderId,
                notes: notes || 'Refund',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        return NextResponse.json({
          ...refunded,
          initialBalance: Number(refunded.initialBalance),
          currentBalance: Number(refunded.currentBalance),
        })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: freeze, unfreeze, reload, redeem, or refund' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Failed to update gift card:', error)
    return NextResponse.json(
      { error: 'Failed to update gift card' },
      { status: 500 }
    )
  }
}
