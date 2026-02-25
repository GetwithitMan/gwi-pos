import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC, getTodayInTimezone, tzToUTC } from '@/lib/timezone'

// GET - Comprehensive payroll report for a date range
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Resolve venue timezone for correct date boundaries
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    // Default to current week (Sunday start) in venue timezone
    let periodStart: Date
    let periodEnd: Date

    if (startDate && endDate) {
      const range = dateRangeToUTC(startDate, endDate, timezone)
      periodStart = range.start
      periodEnd = range.end
    } else if (startDate) {
      const range = dateRangeToUTC(startDate, null, timezone)
      periodStart = range.start
      periodEnd = new Date()
    } else {
      // Current week: find Sunday in venue timezone
      const todayStr = getTodayInTimezone(timezone)
      const [y, m, d] = todayStr.split('-').map(Number)
      const localNow = new Date(y, m - 1, d)
      const dayOfWeek = localNow.getDay() // 0 = Sunday
      const sundayDate = new Date(localNow)
      sundayDate.setDate(localNow.getDate() - dayOfWeek)
      const sundayStr = sundayDate.toISOString().split('T')[0]
      periodStart = tzToUTC(
        sundayDate.getFullYear(), sundayDate.getMonth() + 1, sundayDate.getDate(),
        0, 0, 0, 0, timezone
      )
      periodEnd = new Date()
    }

    // Get all active employees
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
        ...(employeeId ? { id: employeeId } : {}),
      },
      include: {
        role: { select: { id: true, name: true, isTipped: true } },
      },
    })

    // Build employee payroll data
    const employeePayroll: Record<string, {
      employeeId: string
      employeeName: string
      role: string
      isTipped: boolean
      hourlyRate: number
      // Time
      regularHours: number
      overtimeHours: number
      totalHours: number
      breakMinutes: number
      // Wages
      regularPay: number
      overtimePay: number
      totalWages: number
      // Tips
      declaredTips: number
      tipSharesGiven: number
      tipSharesReceived: number
      bankedTipsPending: number
      bankedTipsCollected: number
      netTips: number
      // Commission
      commissionTotal: number
      // Totals
      grossPay: number
      // Details
      shifts: {
        id: string
        date: string
        hours: number
        tips: number
        commission: number
      }[]
      timeEntries: {
        id: string
        date: string
        clockIn: string
        clockOut: string | null
        regularHours: number
        overtimeHours: number
        breakMinutes: number
      }[]
    }> = {}

    // Initialize employee records
    employees.forEach(emp => {
      const name = emp.displayName || `${emp.firstName} ${emp.lastName}`
      employeePayroll[emp.id] = {
        employeeId: emp.id,
        employeeName: name,
        role: emp.role.name,
        isTipped: emp.role.isTipped,
        hourlyRate: Number(emp.hourlyRate || 0),
        regularHours: 0,
        overtimeHours: 0,
        totalHours: 0,
        breakMinutes: 0,
        regularPay: 0,
        overtimePay: 0,
        totalWages: 0,
        declaredTips: 0,
        tipSharesGiven: 0,
        tipSharesReceived: 0,
        bankedTipsPending: 0,
        bankedTipsCollected: 0,
        netTips: 0,
        commissionTotal: 0,
        grossPay: 0,
        shifts: [],
        timeEntries: [],
      }
    })

    // Fetch all payroll data in parallel (all queries are independent)
    const [
      timeEntries,
      shifts,
      tipSharesGivenEntries,
      tipSharesReceivedEntries,
      grossTipLedgerEntries,
      bankedPendingEntries,
      bankedCollectedEntries,
      allPayoutEntries,
      orders,
    ] = await Promise.all([
      // 1. Time clock entries
      db.timeClockEntry.findMany({
        where: {
          locationId,
          clockIn: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
        orderBy: { clockIn: 'asc' },
      }),
      // 2. Closed shifts (shift metadata only — tips come from ledger)
      db.shift.findMany({
        where: {
          locationId,
          status: 'closed',
          startedAt: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
        orderBy: { startedAt: 'asc' },
      }),
      // 3a. Tip shares GIVEN (Skill 273)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: 'ROLE_TIPOUT',
          type: 'DEBIT',
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 3b. Tip shares RECEIVED (Skill 273)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: 'ROLE_TIPOUT',
          type: 'CREDIT',
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 4. Gross tips from ledger — DIRECT_TIP + TIP_GROUP credits in period
      // This replaces Shift.tipsDeclared as the canonical source of truth (BUG #416 fix)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
          type: 'CREDIT',
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 5a. Banked tips PENDING (all time — for current balance)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
          type: 'CREDIT',
          deletedAt: null,
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 5b. Banked tips COLLECTED (this period — informational)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
          type: 'DEBIT',
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 5c. All-time payouts (for net pending calculation)
      db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
          type: 'DEBIT',
          deletedAt: null,
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      // 6. Commission from orders (businessDayDate OR-fallback)
      db.order.findMany({
        where: {
          locationId,
          status: { in: ['completed', 'paid'] },
          commissionTotal: { gt: 0 },
          ...(employeeId ? { employeeId } : {}),
          OR: [
            { businessDayDate: { gte: periodStart, lte: periodEnd } },
            { businessDayDate: null, createdAt: { gte: periodStart, lte: periodEnd } },
          ],
        },
      }),
    ])

    // Process time entries
    timeEntries.forEach(entry => {
      if (!employeePayroll[entry.employeeId]) return

      const regularHours = Number(entry.regularHours || 0)
      const overtimeHours = Number(entry.overtimeHours || 0)
      const breakMinutes = entry.breakMinutes || 0

      employeePayroll[entry.employeeId].regularHours += regularHours
      employeePayroll[entry.employeeId].overtimeHours += overtimeHours
      employeePayroll[entry.employeeId].totalHours += regularHours + overtimeHours
      employeePayroll[entry.employeeId].breakMinutes += breakMinutes

      employeePayroll[entry.employeeId].timeEntries.push({
        id: entry.id,
        date: entry.clockIn.toISOString().split('T')[0],
        clockIn: entry.clockIn.toISOString(),
        clockOut: entry.clockOut?.toISOString() || null,
        regularHours,
        overtimeHours,
        breakMinutes,
      })
    })

    // Process shifts (metadata only — tip values come from ledger)
    shifts.forEach(shift => {
      if (!employeePayroll[shift.employeeId]) return

      employeePayroll[shift.employeeId].shifts.push({
        id: shift.id,
        date: shift.startedAt.toISOString().split('T')[0],
        hours: 0, // Calculated from time entries
        tips: 0, // Now sourced from ledger below
        commission: 0, // Calculated separately from orders
      })
    })

    // Ledger-only: grossTips from DIRECT_TIP + TIP_GROUP credits in period (BUG #416 fix)
    // Replaces Shift.tipsDeclared to eliminate double-counting
    grossTipLedgerEntries.forEach(entry => {
      if (!employeePayroll[entry.employeeId]) return
      employeePayroll[entry.employeeId].declaredTips += Math.abs(Number(entry.amountCents)) / 100
    })

    // Process tip shares
    tipSharesGivenEntries.forEach(entry => {
      if (employeePayroll[entry.employeeId]) {
        employeePayroll[entry.employeeId].tipSharesGiven += Math.abs(Number(entry.amountCents)) / 100
      }
    })

    tipSharesReceivedEntries.forEach(entry => {
      if (employeePayroll[entry.employeeId]) {
        employeePayroll[entry.employeeId].tipSharesReceived += Number(entry.amountCents) / 100
      }
    })

    // Calculate pending: all-time credits + all-time debits (debits are negative amountCents)
    // Result > 0 means employee still has unredeemed banked tips
    const pendingByEmployee: Record<string, number> = {}
    bankedPendingEntries.forEach(entry => {
      if (!pendingByEmployee[entry.employeeId]) pendingByEmployee[entry.employeeId] = 0
      pendingByEmployee[entry.employeeId] += Number(entry.amountCents) // CREDIT: positive
    })
    allPayoutEntries.forEach(entry => {
      if (!pendingByEmployee[entry.employeeId]) pendingByEmployee[entry.employeeId] = 0
      pendingByEmployee[entry.employeeId] += Number(entry.amountCents) // DEBIT: negative (reduces balance)
    })

    Object.entries(pendingByEmployee).forEach(([empId, balanceCents]) => {
      if (employeePayroll[empId]) {
        employeePayroll[empId].bankedTipsPending = Math.max(0, balanceCents) / 100
      }
    })

    bankedCollectedEntries.forEach(entry => {
      if (employeePayroll[entry.employeeId]) {
        employeePayroll[entry.employeeId].bankedTipsCollected += Math.abs(Number(entry.amountCents)) / 100
      }
    })

    // Process commission from orders
    orders.forEach(order => {
      if (!employeePayroll[order.employeeId]) return
      employeePayroll[order.employeeId].commissionTotal += Number(order.commissionTotal)
    })

    // 6. Calculate final totals for each employee
    Object.values(employeePayroll).forEach(emp => {
      // Wages
      emp.regularPay = Math.round(emp.regularHours * emp.hourlyRate * 100) / 100
      emp.overtimePay = Math.round(emp.overtimeHours * emp.hourlyRate * 1.5 * 100) / 100
      emp.totalWages = Math.round((emp.regularPay + emp.overtimePay) * 100) / 100

      // Net tips — ledger-only formula (BUG #416/#423 fix)
      // - declaredTips: now sourced from DIRECT_TIP + TIP_GROUP ledger credits (not Shift.tipsDeclared)
      // - tipSharesGiven: ROLE_TIPOUT debits (amount given to other roles)
      // - tipSharesReceived: ROLE_TIPOUT credits (amount received from other roles)
      // bankedTipsCollected is informational only — NOT included in netTips to prevent double-count
      emp.netTips = Math.round((
        emp.declaredTips -
        emp.tipSharesGiven +
        emp.tipSharesReceived
      ) * 100) / 100

      // Gross pay
      emp.grossPay = Math.round((
        emp.totalWages +
        emp.netTips +
        emp.commissionTotal
      ) * 100) / 100

      // Round all values
      emp.regularHours = Math.round(emp.regularHours * 100) / 100
      emp.overtimeHours = Math.round(emp.overtimeHours * 100) / 100
      emp.totalHours = Math.round(emp.totalHours * 100) / 100
      emp.declaredTips = Math.round(emp.declaredTips * 100) / 100
      emp.tipSharesGiven = Math.round(emp.tipSharesGiven * 100) / 100
      emp.tipSharesReceived = Math.round(emp.tipSharesReceived * 100) / 100
      emp.bankedTipsPending = Math.round(emp.bankedTipsPending * 100) / 100
      emp.bankedTipsCollected = Math.round(emp.bankedTipsCollected * 100) / 100
      emp.commissionTotal = Math.round(emp.commissionTotal * 100) / 100
    })

    // Filter to employees with any activity
    const payrollReport = Object.values(employeePayroll)
      .filter(emp => emp.totalHours > 0 || emp.declaredTips > 0 || emp.commissionTotal > 0 || emp.tipSharesReceived > 0)
      .sort((a, b) => b.grossPay - a.grossPay)

    // Calculate summary totals
    const summary = {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      employeeCount: payrollReport.length,
      totalRegularHours: Math.round(payrollReport.reduce((sum, e) => sum + e.regularHours, 0) * 100) / 100,
      totalOvertimeHours: Math.round(payrollReport.reduce((sum, e) => sum + e.overtimeHours, 0) * 100) / 100,
      totalHours: Math.round(payrollReport.reduce((sum, e) => sum + e.totalHours, 0) * 100) / 100,
      totalWages: Math.round(payrollReport.reduce((sum, e) => sum + e.totalWages, 0) * 100) / 100,
      totalTips: Math.round(payrollReport.reduce((sum, e) => sum + e.netTips, 0) * 100) / 100,
      totalCommissions: Math.round(payrollReport.reduce((sum, e) => sum + e.commissionTotal, 0) * 100) / 100,
      totalBankedTipsPending: Math.round(payrollReport.reduce((sum, e) => sum + e.bankedTipsPending, 0) * 100) / 100,
      grandTotal: Math.round(payrollReport.reduce((sum, e) => sum + e.grossPay, 0) * 100) / 100,
    }

    return NextResponse.json({ data: {
      summary,
      employees: payrollReport,
      filters: {
        startDate: periodStart.toISOString().split('T')[0],
        endDate: periodEnd.toISOString().split('T')[0],
        locationId,
        employeeId,
      },
    } })
  } catch (error) {
    console.error('Failed to generate payroll report:', error)
    return NextResponse.json(
      { error: 'Failed to generate payroll report' },
      { status: 500 }
    )
  }
})
