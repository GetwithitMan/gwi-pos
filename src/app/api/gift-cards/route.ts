import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// Generate a unique gift card number
function generateCardNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'GC-'
  for (let i = 0; i < 4; i++) {
    if (i > 0) result += '-'
    for (let j = 0; j < 4; j++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
  }
  return result
}

// GET - List gift cards
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = { locationId }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { cardNumber: { contains: search } },
        { recipientName: { contains: search } },
        { recipientEmail: { contains: search } },
        { purchaserName: { contains: search } },
      ]
    }

    const giftCards = await db.giftCard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    })

    return NextResponse.json(giftCards.map(card => ({
      ...card,
      initialBalance: Number(card.initialBalance),
      currentBalance: Number(card.currentBalance),
    })))
  } catch (error) {
    console.error('Failed to fetch gift cards:', error)
    return NextResponse.json(
      { error: 'Failed to fetch gift cards' },
      { status: 500 }
    )
  }
})

// POST - Create/purchase a new gift card
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      amount,
      recipientName,
      recipientEmail,
      recipientPhone,
      purchaserName,
      message,
      purchasedById,
      orderId,
      expiresAt,
    } = body

    if (!locationId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Location ID and positive amount are required' },
        { status: 400 }
      )
    }

    // Generate unique card number
    let cardNumber = generateCardNumber()
    let attempts = 0
    while (attempts < 10) {
      const existing = await db.giftCard.findUnique({
        where: { cardNumber }
      })
      if (!existing) break
      cardNumber = generateCardNumber()
      attempts++
    }

    const giftCard = await db.giftCard.create({
      data: {
        locationId,
        cardNumber,
        initialBalance: amount,
        currentBalance: amount,
        status: 'active',
        recipientName,
        recipientEmail,
        recipientPhone,
        purchaserName,
        message,
        purchasedById,
        orderId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        transactions: {
          create: {
            locationId,
            type: 'purchase',
            amount,
            balanceBefore: 0,
            balanceAfter: amount,
            orderId,
            employeeId: purchasedById,
            notes: 'Initial purchase',
          }
        }
      },
      include: {
        transactions: true,
      }
    })

    return NextResponse.json({ data: {
      ...giftCard,
      initialBalance: Number(giftCard.initialBalance),
      currentBalance: Number(giftCard.currentBalance),
    } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create gift card:', error)
    return NextResponse.json(
      { error: 'Failed to create gift card' },
      { status: 500 }
    )
  }
})
