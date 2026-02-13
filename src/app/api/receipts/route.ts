import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Create a digital receipt (called after payment)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, orderId, paymentId, receiptData, signatureData, signatureSource } = body

    if (!locationId || !orderId || !paymentId || !receiptData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const receipt = await db.digitalReceipt.create({
      data: {
        locationId,
        orderId,
        paymentId,
        receiptData,
        signatureData,
        signatureSource,
      },
    })

    return NextResponse.json({ data: { id: receipt.id } })
  } catch (error) {
    // Handle unique constraint (duplicate orderId)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Receipt already exists for this order' }, { status: 409 })
    }
    console.error('Failed to create receipt:', error)
    return NextResponse.json({ error: 'Failed to create receipt' }, { status: 500 })
  }
})

// GET - Search digital receipts
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const cardLast4 = searchParams.get('cardLast4')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const orderId = searchParams.get('orderId')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId, deletedAt: null }

    if (orderId) {
      where.orderId = orderId
    }

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {}
      if (startDate) dateFilter.gte = new Date(startDate)
      if (endDate) dateFilter.lte = new Date(endDate)
      where.createdAt = dateFilter
    }

    // If searching by card last 4, we need to join through payment
    let receipts
    if (cardLast4) {
      // Find payments with this card
      const payments = await db.payment.findMany({
        where: { locationId, cardLast4, deletedAt: null },
        select: { id: true },
      })
      const paymentIds = payments.map(p => p.id)
      where.paymentId = { in: paymentIds }
    }

    receipts = await db.digitalReceipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    })

    const total = await db.digitalReceipt.count({ where })

    return NextResponse.json({
      data: receipts.map(r => ({
        id: r.id,
        orderId: r.orderId,
        paymentId: r.paymentId,
        hasSignature: !!r.signatureData,
        signatureSource: r.signatureSource,
        archivedAt: r.archivedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to search receipts:', error)
    return NextResponse.json({ error: 'Failed to search receipts' }, { status: 500 })
  }
})
