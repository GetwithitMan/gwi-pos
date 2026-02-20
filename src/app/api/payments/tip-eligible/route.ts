/**
 * GET /api/payments/tip-eligible
 *
 * Returns card payments eligible for tip adjustment (have datacapRecordNo).
 * Used by the Tip Adjustment Report page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Default to today if no dates
    const now = new Date()
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    if (endDate) {
      end.setHours(23, 59, 59, 999)
    }

    const payments = await db.payment.findMany({
      where: {
        order: { locationId },
        paymentMethod: { in: ['credit', 'debit'] },
        datacapRecordNo: { not: null },
        status: 'completed',
        deletedAt: null,
        createdAt: { gte: start, lte: end },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            locationId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      data: {
        payments: payments.map(p => ({
          id: p.id,
          orderId: p.order?.id,
          orderNumber: p.order?.orderNumber,
          locationId: p.order?.locationId,
          paymentMethod: p.paymentMethod,
          cardBrand: p.cardBrand,
          cardLast4: p.cardLast4,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          datacapRecordNo: p.datacapRecordNo,
          datacapRefNumber: p.datacapRefNumber,
          paymentReaderId: p.paymentReaderId,
          entryMethod: p.entryMethod,
          createdAt: p.createdAt.toISOString(),
        })),
        count: payments.length,
      },
    })
  } catch (error) {
    console.error('Failed to fetch tip-eligible payments:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
})
