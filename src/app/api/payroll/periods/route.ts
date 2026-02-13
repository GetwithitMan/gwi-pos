import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateTaxes } from '@/lib/payroll/tax-calculator'
import { withVenue } from '@/lib/with-venue'

// GET - List payroll periods
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const periods = await db.payrollPeriod.findMany({
      where: {
        locationId,
        ...(status ? { status } : {}),
      },
      include: {
        payStubs: {
          select: {
            id: true,
            employeeId: true,
            grossPay: true,
            netPay: true,
            status: true,
          },
        },
      },
      orderBy: { periodStart: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      periods: periods.map(p => ({
        id: p.id,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        periodType: p.periodType,
        status: p.status,
        closedAt: p.closedAt?.toISOString() || null,
        paidAt: p.paidAt?.toISOString() || null,
        totals: {
          regularHours: Number(p.totalRegularHours || 0),
          overtimeHours: Number(p.totalOvertimeHours || 0),
          wages: Number(p.totalWages || 0),
          tips: Number(p.totalTips || 0),
          commissions: Number(p.totalCommissions || 0),
          bankedTips: Number(p.totalBankedTips || 0),
          grandTotal: Number(p.grandTotal || 0),
        },
        employeeCount: p.payStubs.length,
        notes: p.notes,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payroll periods:', error)
    return NextResponse.json({ error: 'Failed to fetch payroll periods' }, { status: 500 })
  }
})

// POST - Create a new payroll period
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, periodStart, periodEnd, periodType } = body

    if (!locationId || !periodStart || !periodEnd) {
      return NextResponse.json(
        { error: 'locationId, periodStart, and periodEnd are required' },
        { status: 400 }
      )
    }

    // Check for overlapping periods
    const existing = await db.payrollPeriod.findFirst({
      where: {
        locationId,
        OR: [
          {
            periodStart: { lte: new Date(periodEnd) },
            periodEnd: { gte: new Date(periodStart) },
          },
        ],
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'A payroll period already exists that overlaps with these dates' },
        { status: 400 }
      )
    }

    const period = await db.payrollPeriod.create({
      data: {
        locationId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        periodType: periodType || 'biweekly',
        status: 'open',
      },
    })

    return NextResponse.json({
      period: {
        id: period.id,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        periodType: period.periodType,
        status: period.status,
      },
    })
  } catch (error) {
    console.error('Failed to create payroll period:', error)
    return NextResponse.json({ error: 'Failed to create payroll period' }, { status: 500 })
  }
})
