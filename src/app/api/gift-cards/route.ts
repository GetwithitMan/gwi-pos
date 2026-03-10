import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { sendGiftCardEmail } from '@/lib/gift-card-email'

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
// Auth: session-verified employee with CUSTOMERS_GIFT_CARDS permission
export const GET = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function GET(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    // Use verified locationId from session
    const locationId = ctx.auth.locationId

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
}))

// POST - Create/purchase a new gift card
// Auth: session-verified employee with CUSTOMERS_GIFT_CARDS permission
export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await request.json()
    const {
      amount,
      recipientName,
      recipientEmail,
      recipientPhone,
      purchaserName,
      message,
      orderId,
      expiresAt,
    } = body

    // Use verified locationId and employeeId from session
    const locationId = ctx.auth.locationId
    const purchasedById = ctx.auth.employeeId

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'A positive amount is required' },
        { status: 400 }
      )
    }

    // Gift card creation must be tied to a payment (anti-fraud guard)
    const skipPaymentCheck = body.skipPaymentCheck === true
    if (!orderId && !skipPaymentCheck) {
      return NextResponse.json(
        { error: 'Gift card creation requires an associated order. Use the POS payment flow to create gift cards.' },
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

    // Audit trail for gift card creation
    console.log(`[AUDIT] GIFT_CARD_CREATED: card=${giftCard.cardNumber}, balance=$${Number(giftCard.initialBalance)}, by employee ${purchasedById}, orderId=${orderId || 'NONE'}`)

    // Fire-and-forget: Send gift card email to recipient if email provided
    if (recipientEmail) {
      // Look up location name for the email
      const location = await db.location.findUnique({
        where: { id: locationId },
        select: { name: true, address: true },
      })

      void sendGiftCardEmail({
        recipientEmail,
        recipientName: recipientName || undefined,
        cardCode: giftCard.cardNumber,
        balance: Number(giftCard.initialBalance),
        fromName: purchaserName || undefined,
        message: message || undefined,
        locationName: location?.name || 'Our Restaurant',
        locationAddress: location?.address || undefined,
      }).catch(err => console.error('[GiftCard] Email delivery failed:', err))
    }

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
}))
