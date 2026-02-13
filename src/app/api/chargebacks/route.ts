import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Create a chargeback case (manual entry for now)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      cardLast4,
      cardBrand,
      amount,
      chargebackDate,
      reason,
      reasonCode,
      responseDeadline,
      notes,
    } = body

    if (!locationId || !cardLast4 || !amount || !chargebackDate) {
      return NextResponse.json({ error: 'Missing required fields: locationId, cardLast4, amount, chargebackDate' }, { status: 400 })
    }

    // Try to auto-match against orders
    let matchedOrderId: string | null = null
    let matchedPaymentId: string | null = null

    const matchingPayments = await db.payment.findMany({
      where: {
        locationId,
        cardLast4,
        totalAmount: amount,
        deletedAt: null,
        // Look within 30 days before chargeback
        processedAt: {
          gte: new Date(new Date(chargebackDate).getTime() - 30 * 24 * 60 * 60 * 1000),
          lte: new Date(chargebackDate),
        },
      },
      orderBy: { processedAt: 'desc' },
      take: 1,
    })

    if (matchingPayments.length > 0) {
      matchedPaymentId = matchingPayments[0].id
      matchedOrderId = matchingPayments[0].orderId
    }

    const chargebackCase = await db.chargebackCase.create({
      data: {
        locationId,
        orderId: matchedOrderId,
        paymentId: matchedPaymentId,
        cardLast4,
        cardBrand,
        amount,
        chargebackDate: new Date(chargebackDate),
        reason,
        reasonCode,
        responseDeadline: responseDeadline ? new Date(responseDeadline) : null,
        notes,
      },
    })

    return NextResponse.json({
      data: {
        id: chargebackCase.id,
        autoMatched: !!matchedOrderId,
        matchedOrderId,
        matchedPaymentId,
      },
    })
  } catch (error) {
    console.error('Failed to create chargeback case:', error)
    return NextResponse.json({ error: 'Failed to create chargeback case' }, { status: 500 })
  }
})

// GET - List chargeback cases
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // open | responded | won | lost

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId, deletedAt: null }
    if (status) where.status = status

    const cases = await db.chargebackCase.findMany({
      where,
      orderBy: { chargebackDate: 'desc' },
      take: 100,
    })

    return NextResponse.json({
      data: cases.map(c => ({
        id: c.id,
        orderId: c.orderId,
        paymentId: c.paymentId,
        cardLast4: c.cardLast4,
        cardBrand: c.cardBrand,
        amount: Number(c.amount),
        chargebackDate: c.chargebackDate.toISOString(),
        reason: c.reason,
        reasonCode: c.reasonCode,
        responseDeadline: c.responseDeadline?.toISOString(),
        status: c.status,
        notes: c.notes,
        respondedAt: c.respondedAt?.toISOString(),
        resolvedAt: c.resolvedAt?.toISOString(),
        createdAt: c.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to list chargeback cases:', error)
    return NextResponse.json({ error: 'Failed to list chargeback cases' }, { status: 500 })
  }
})
