import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PayrollPeriodStatus } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'
// TODO: Phase 1 - No PayrollPeriodRepository yet.
// db.payrollPeriod calls remain direct.

// GET - List payroll periods
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') as PayrollPeriodStatus | null
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!locationId) {
      return err('Location ID required')
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

    return ok({
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
    return err('Failed to fetch payroll periods', 500)
  }
})

// POST - Create a new payroll period
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, periodStart, periodEnd, periodType } = body

    if (!locationId || !periodStart || !periodEnd) {
      return err('locationId, periodStart, and periodEnd are required')
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
      return err('A payroll period already exists that overlaps with these dates')
    }

    const period = await db.payrollPeriod.create({
      data: {
        locationId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        periodType: periodType || 'biweekly',
        status: 'open',
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId, domain: 'payroll', action: 'created', entityId: period.id })
    void pushUpstream()

    return ok({
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
    return err('Failed to create payroll period', 500)
  }
}))
