import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET - Get tips report data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Self-access: employees can always view their own tips report
    const isSelfAccess = employeeId && requestingEmployeeId && employeeId === requestingEmployeeId
    if (!isSelfAccess) {
      const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE, { soft: true })
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Build date filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { gte: new Date(startDate) }
    }
    if (endDate) {
      const endDateTime = new Date(endDate)
      endDateTime.setHours(23, 59, 59, 999)
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: endDateTime }
    }

    // Get tip shares
    const tipSharesFilter: Prisma.TipShareWhereInput = {
      locationId,
      ...dateFilter,
    }
    if (employeeId) {
      tipSharesFilter.OR = [
        { fromEmployeeId: employeeId },
        { toEmployeeId: employeeId },
      ]
    }

    const tipShares = await db.tipShare.findMany({
      where: tipSharesFilter,
      include: {
        fromEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { name: true } },
          },
        },
        toEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { name: true } },
          },
        },
        shift: {
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
          },
        },
        rule: {
          select: {
            percentage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get banked tips
    const tipBankFilter: Prisma.TipBankWhereInput = {
      locationId,
      ...dateFilter,
    }
    if (employeeId) {
      tipBankFilter.employeeId = employeeId
    }

    const bankedTips = await db.tipBank.findMany({
      where: tipBankFilter,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { name: true } },
          },
        },
        tipShare: {
          include: {
            fromEmployee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get shifts with tip data for summary
    const shiftsFilter: Prisma.ShiftWhereInput = {
      locationId,
      status: 'closed',
      grossTips: { not: null },
    }
    if (startDate || endDate) {
      const endedAtFilter: Prisma.DateTimeNullableFilter = {}
      if (startDate) endedAtFilter.gte = new Date(startDate)
      if (endDate) {
        const endDateTime = new Date(endDate)
        endDateTime.setHours(23, 59, 59, 999)
        endedAtFilter.lte = endDateTime
      }
      shiftsFilter.endedAt = endedAtFilter
    }
    if (employeeId) {
      shiftsFilter.employeeId = employeeId
    }

    const shifts = await db.shift.findMany({
      where: shiftsFilter,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { name: true } },
          },
        },
      },
      orderBy: { endedAt: 'desc' },
    })

    // Calculate employee summaries
    const employeeSummaries = new Map<string, {
      employeeId: string
      employeeName: string
      roleName: string
      grossTips: number
      tipOutsGiven: number
      tipOutsReceived: number
      netTips: number
      shiftCount: number
    }>()

    // Process shifts for gross tips
    shifts.forEach(shift => {
      const empId = shift.employee.id
      const empName = shift.employee.displayName ||
        `${shift.employee.firstName} ${shift.employee.lastName}`

      const existing = employeeSummaries.get(empId) || {
        employeeId: empId,
        employeeName: empName,
        roleName: shift.employee.role?.name || 'Unknown',
        grossTips: 0,
        tipOutsGiven: 0,
        tipOutsReceived: 0,
        netTips: 0,
        shiftCount: 0,
      }

      existing.grossTips += Number(shift.grossTips || 0)
      existing.netTips += Number(shift.netTips || 0)
      existing.tipOutsGiven += Number(shift.tipOutTotal || 0)
      existing.shiftCount += 1

      employeeSummaries.set(empId, existing)
    })

    // Process tip shares received
    tipShares.forEach(share => {
      if (share.status === 'collected' || share.status === 'pending') {
        const empId = share.toEmployee.id
        const empName = share.toEmployee.displayName ||
          `${share.toEmployee.firstName} ${share.toEmployee.lastName}`

        const existing = employeeSummaries.get(empId) || {
          employeeId: empId,
          employeeName: empName,
          roleName: share.toEmployee.role?.name || 'Unknown',
          grossTips: 0,
          tipOutsGiven: 0,
          tipOutsReceived: 0,
          netTips: 0,
          shiftCount: 0,
        }

        existing.tipOutsReceived += Number(share.amount)
        employeeSummaries.set(empId, existing)
      }
    })

    // Calculate totals
    const summary = {
      totalGrossTips: shifts.reduce((sum, s) => sum + Number(s.grossTips || 0), 0),
      totalTipOuts: tipShares.reduce((sum, s) => sum + Number(s.amount), 0),
      totalBanked: bankedTips
        .filter(t => t.status === 'pending')
        .reduce((sum, t) => sum + Number(t.amount), 0),
      totalCollected: bankedTips
        .filter(t => t.status === 'collected')
        .reduce((sum, t) => sum + Number(t.amount), 0),
      totalPaidOut: bankedTips
        .filter(t => t.status === 'paid_out')
        .reduce((sum, t) => sum + Number(t.amount), 0),
    }

    return NextResponse.json({
      byEmployee: Array.from(employeeSummaries.values()).map(emp => ({
        ...emp,
        grossTips: Math.round(emp.grossTips * 100) / 100,
        tipOutsGiven: Math.round(emp.tipOutsGiven * 100) / 100,
        tipOutsReceived: Math.round(emp.tipOutsReceived * 100) / 100,
        netTips: Math.round(emp.netTips * 100) / 100,
      })),
      tipShares: tipShares.map(share => ({
        id: share.id,
        from: share.fromEmployee.displayName ||
          `${share.fromEmployee.firstName} ${share.fromEmployee.lastName}`,
        fromRole: share.fromEmployee.role?.name,
        to: share.toEmployee.displayName ||
          `${share.toEmployee.firstName} ${share.toEmployee.lastName}`,
        toRole: share.toEmployee.role?.name,
        amount: Number(share.amount),
        type: share.shareType,
        percentage: share.rule ? Number(share.rule.percentage) : null,
        status: share.status,
        date: share.createdAt.toISOString(),
        shiftDate: share.shift?.endedAt?.toISOString() || share.shift?.startedAt?.toISOString(),
      })),
      bankedTips: bankedTips.map(tip => ({
        id: tip.id,
        employeeId: tip.employee.id,
        employeeName: tip.employee.displayName ||
          `${tip.employee.firstName} ${tip.employee.lastName}`,
        roleName: tip.employee.role?.name,
        amount: Number(tip.amount),
        status: tip.status,
        source: tip.source,
        fromEmployee: tip.tipShare?.fromEmployee
          ? tip.tipShare.fromEmployee.displayName ||
            `${tip.tipShare.fromEmployee.firstName} ${tip.tipShare.fromEmployee.lastName}`
          : null,
        createdAt: tip.createdAt.toISOString(),
        collectedAt: tip.collectedAt?.toISOString() || null,
        paidOutAt: tip.paidOutAt?.toISOString() || null,
      })),
      summary: {
        ...summary,
        totalGrossTips: Math.round(summary.totalGrossTips * 100) / 100,
        totalTipOuts: Math.round(summary.totalTipOuts * 100) / 100,
        totalBanked: Math.round(summary.totalBanked * 100) / 100,
        totalCollected: Math.round(summary.totalCollected * 100) / 100,
        totalPaidOut: Math.round(summary.totalPaidOut * 100) / 100,
      },
    })
  } catch (error) {
    console.error('Failed to generate tips report:', error)
    return NextResponse.json(
      { error: 'Failed to generate tips report' },
      { status: 500 }
    )
  }
}
