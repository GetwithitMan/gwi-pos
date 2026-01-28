import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/liquor/upsells
 * Record a spirit upsell event for tracking and reporting
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      orderId,
      orderItemId,
      employeeId,
      baseModifierId,
      baseTier,
      baseBottleName,
      upsellModifierId,
      upsellTier,
      upsellBottleName,
      priceDifference,
      wasShown,
      wasAccepted,
    } = body

    // Validation
    if (!orderId || !orderItemId || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, orderItemId, employeeId' },
        { status: 400 }
      )
    }

    // Get the location
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const upsellEvent = await db.spiritUpsellEvent.create({
      data: {
        locationId: location.id,
        orderId,
        orderItemId,
        employeeId,
        baseModifierId: baseModifierId || '',
        baseTier: baseTier || 'well',
        baseBottleName: baseBottleName || '',
        upsellModifierId: upsellModifierId || '',
        upsellTier: upsellTier || 'premium',
        upsellBottleName: upsellBottleName || '',
        priceDifference: priceDifference || 0,
        wasShown: wasShown ?? true,
        wasAccepted: wasAccepted ?? false,
      },
    })

    return NextResponse.json({
      id: upsellEvent.id,
      wasAccepted: upsellEvent.wasAccepted,
    })
  } catch (error) {
    console.error('Failed to record upsell event:', error)
    return NextResponse.json(
      { error: 'Failed to record upsell event' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/liquor/upsells
 * Get upsell statistics for reporting
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')

    // Get the location
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const where: any = {
      locationId: location.id,
    }

    if (startDate) {
      where.createdAt = { ...where.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(endDate) }
    }
    if (employeeId) {
      where.employeeId = employeeId
    }

    // Get summary stats
    const [totalShown, totalAccepted, revenueGenerated] = await Promise.all([
      db.spiritUpsellEvent.count({
        where: { ...where, wasShown: true },
      }),
      db.spiritUpsellEvent.count({
        where: { ...where, wasAccepted: true },
      }),
      db.spiritUpsellEvent.aggregate({
        where: { ...where, wasAccepted: true },
        _sum: { priceDifference: true },
      }),
    ])

    // Get by tier breakdown
    const byTier = await db.spiritUpsellEvent.groupBy({
      by: ['upsellTier'],
      where: { ...where, wasAccepted: true },
      _count: true,
      _sum: { priceDifference: true },
    })

    // Get by employee
    const byEmployee = await db.spiritUpsellEvent.groupBy({
      by: ['employeeId'],
      where,
      _count: true,
    })

    const acceptanceRate = totalShown > 0 ? (totalAccepted / totalShown) * 100 : 0

    return NextResponse.json({
      summary: {
        totalShown,
        totalAccepted,
        acceptanceRate: Math.round(acceptanceRate * 10) / 10,
        revenueGenerated: revenueGenerated._sum.priceDifference
          ? Number(revenueGenerated._sum.priceDifference)
          : 0,
      },
      byTier: byTier.map(t => ({
        tier: t.upsellTier,
        count: t._count,
        revenue: t._sum.priceDifference ? Number(t._sum.priceDifference) : 0,
      })),
      byEmployee: byEmployee.map(e => ({
        employeeId: e.employeeId,
        totalPrompts: e._count,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch upsell stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch upsell stats' },
      { status: 500 }
    )
  }
}
