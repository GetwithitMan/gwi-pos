import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'

// Migrated from legacy TipBank/TipShare (Skill 273)
// All tip data now sourced from TipLedgerEntry instead of TipShare/TipBank models.

// GET - Get tips report data
export const GET = withVenue(async function GET(request: NextRequest) {
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

    // Get business day settings for proper date boundaries
    const tipsLocation = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const locationSettings = parseSettings(tipsLocation?.settings)
    const dayStartTime = locationSettings.businessDay.dayStartTime

    // Build date filter using business day boundaries
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      const startRange = getBusinessDayRange(startDate, dayStartTime)
      dateFilter.createdAt = { gte: startRange.start }
    }
    if (endDate) {
      const endRange = getBusinessDayRange(endDate, dayStartTime)
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: endRange.end }
    }

    // ── Tip shares: query TipLedgerEntry where sourceType = 'ROLE_TIPOUT' ──
    // DEBIT entries = tip-outs given, CREDIT entries = tip-outs received.
    // Paired by sourceId (both DEBIT and CREDIT share the same sourceId = TipShare.id).
    const tipOutFilter: Prisma.TipLedgerEntryWhereInput = {
      locationId,
      sourceType: 'ROLE_TIPOUT',
      deletedAt: null,
      ...dateFilter,
    }
    if (employeeId) {
      tipOutFilter.employeeId = employeeId
    }

    // Build banked tip filter
    const bankedTipFilter: Prisma.TipLedgerEntryWhereInput = {
      locationId,
      deletedAt: null,
      sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP', 'PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
      ...dateFilter,
    }
    if (employeeId) {
      bankedTipFilter.employeeId = employeeId
    }

    // Build ledger balance filter
    const ledgerBalanceFilter: Prisma.TipLedgerWhereInput = {
      locationId,
      deletedAt: null,
    }
    if (employeeId) {
      ledgerBalanceFilter.employeeId = employeeId
    }

    // Build shifts filter
    const shiftsFilter: Prisma.ShiftWhereInput = {
      locationId,
      status: 'closed',
      grossTips: { not: null },
    }
    if (startDate || endDate) {
      const endedAtFilter: Prisma.DateTimeNullableFilter = {}
      if (startDate) {
        const startRange = getBusinessDayRange(startDate, dayStartTime)
        endedAtFilter.gte = startRange.start
      }
      if (endDate) {
        const endRange = getBusinessDayRange(endDate, dayStartTime)
        endedAtFilter.lte = endRange.end
      }
      shiftsFilter.endedAt = endedAtFilter
    }
    if (employeeId) {
      shiftsFilter.employeeId = employeeId
    }

    // Fetch all four independent queries in parallel
    const [tipOutEntries, bankedEntries, ledgerBalances, shifts] = await Promise.all([
      // Tip-out entries
      db.tipLedgerEntry.findMany({
        where: tipOutFilter,
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
        orderBy: { createdAt: 'desc' },
      }),
      // Banked tips
      db.tipLedgerEntry.findMany({
        where: bankedTipFilter,
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
        orderBy: { createdAt: 'desc' },
      }),
      // Ledger balances
      db.tipLedger.findMany({
        where: ledgerBalanceFilter,
        select: { employeeId: true, currentBalanceCents: true },
      }),
      // Shifts with tip data
      db.shift.findMany({
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
      }),
    ])

    // Fetch counterpart entries if filtering by employee (depends on tipOutEntries)
    const tipOutSourceIds = tipOutEntries
      .map(e => e.sourceId)
      .filter((id): id is string => id !== null)
    const uniqueSourceIds = [...new Set(tipOutSourceIds)]

    let allTipOutEntries = tipOutEntries
    if (employeeId && uniqueSourceIds.length > 0) {
      const counterparts = await db.tipLedgerEntry.findMany({
        where: {
          locationId,
          sourceType: 'ROLE_TIPOUT',
          sourceId: { in: uniqueSourceIds },
          deletedAt: null,
          employeeId: { not: employeeId },
        },
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
      })
      allTipOutEntries = [...tipOutEntries, ...counterparts]
    }

    // Build lookup maps for pairing
    const debitsBySourceId = new Map<string, typeof allTipOutEntries[number]>()
    const creditsBySourceId = new Map<string, typeof allTipOutEntries[number]>()
    for (const entry of allTipOutEntries) {
      if (!entry.sourceId) continue
      if (entry.type === 'DEBIT') {
        debitsBySourceId.set(entry.sourceId, entry)
      } else {
        creditsBySourceId.set(entry.sourceId, entry)
      }
    }

    // Build tip share pairs from DEBIT entries (one row per tip-out transaction)
    const tipSharePairs: Array<{
      id: string
      debitEntry: typeof allTipOutEntries[number]
      creditEntry: typeof allTipOutEntries[number] | null
    }> = []
    const seenSourceIds = new Set<string>()
    for (const entry of allTipOutEntries) {
      if (entry.type !== 'DEBIT' || !entry.sourceId) continue
      if (seenSourceIds.has(entry.sourceId)) continue
      seenSourceIds.add(entry.sourceId)
      tipSharePairs.push({
        id: entry.id,
        debitEntry: entry,
        creditEntry: creditsBySourceId.get(entry.sourceId) || null,
      })
    }
    // Also add any CREDIT-only entries (employee filtered, giver not in range)
    for (const entry of allTipOutEntries) {
      if (entry.type !== 'CREDIT' || !entry.sourceId) continue
      if (seenSourceIds.has(entry.sourceId)) continue
      seenSourceIds.add(entry.sourceId)
      tipSharePairs.push({
        id: entry.id,
        debitEntry: debitsBySourceId.get(entry.sourceId) || entry,
        creditEntry: entry,
      })
    }

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

    // Process tip-out CREDIT entries for tipOutsReceived
    const tipOutCredits = tipOutEntries.filter(e => e.type === 'CREDIT')
    tipOutCredits.forEach(entry => {
      const empId = entry.employee.id
      const empName = entry.employee.displayName ||
        `${entry.employee.firstName} ${entry.employee.lastName}`

      const existing = employeeSummaries.get(empId) || {
        employeeId: empId,
        employeeName: empName,
        roleName: entry.employee.role?.name || 'Unknown',
        grossTips: 0,
        tipOutsGiven: 0,
        tipOutsReceived: 0,
        netTips: 0,
        shiftCount: 0,
      }

      existing.tipOutsReceived += entry.amountCents / 100
      employeeSummaries.set(empId, existing)
    })

    // Derive banked/collected/paidOut totals from ledger entries
    const payoutEntries = bankedEntries.filter(
      e => e.type === 'DEBIT' && (e.sourceType === 'PAYOUT_CASH' || e.sourceType === 'PAYOUT_PAYROLL')
    )

    const totalPayouts = payoutEntries.reduce((sum, e) => sum + Math.abs(e.amountCents), 0) / 100
    // Current banked = sum of ledger balances (what hasn't been paid out yet)
    const totalCurrentBanked = ledgerBalances.reduce((sum, l) => sum + Math.max(0, l.currentBalanceCents), 0) / 100

    // Calculate totals — tip-outs use DEBIT amountCents (positive stored values)
    const totalTipOuts = tipOutEntries
      .filter(e => e.type === 'DEBIT')
      .reduce((sum, e) => sum + e.amountCents, 0) / 100

    const summary = {
      totalGrossTips: shifts.reduce((sum, s) => sum + Number(s.grossTips || 0), 0),
      totalTipOuts,
      totalBanked: totalCurrentBanked,
      totalCollected: totalPayouts, // payouts = collected/distributed
      totalPaidOut: totalPayouts,   // same — payouts represent final distribution
    }

    // Helper to get employee display name
    const empName = (emp: { displayName: string | null; firstName: string; lastName: string }) =>
      emp.displayName || `${emp.firstName} ${emp.lastName}`

    return NextResponse.json({
      byEmployee: Array.from(employeeSummaries.values()).map(emp => ({
        ...emp,
        grossTips: Math.round(emp.grossTips * 100) / 100,
        tipOutsGiven: Math.round(emp.tipOutsGiven * 100) / 100,
        tipOutsReceived: Math.round(emp.tipOutsReceived * 100) / 100,
        netTips: Math.round(emp.netTips * 100) / 100,
      })),
      tipShares: tipSharePairs.map(pair => {
        const fromEmp = pair.debitEntry.employee
        const toEmp = pair.creditEntry?.employee || pair.debitEntry.employee
        const amount = pair.debitEntry.amountCents / 100
        return {
          id: pair.id,
          from: empName(fromEmp),
          fromRole: fromEmp.role?.name,
          to: empName(toEmp),
          toRole: toEmp.role?.name,
          amount,
          type: 'role_tipout',
          percentage: null as number | null,
          status: 'completed',
          date: pair.debitEntry.createdAt.toISOString(),
          shiftDate: null as string | null,
        }
      }),
      bankedTips: bankedEntries.map(entry => {
        const isCreditTip = entry.type === 'CREDIT' && (entry.sourceType === 'DIRECT_TIP' || entry.sourceType === 'TIP_GROUP')
        const isPayout = entry.type === 'DEBIT' && (entry.sourceType === 'PAYOUT_CASH' || entry.sourceType === 'PAYOUT_PAYROLL')
        // Map source types to legacy status equivalents
        let status = 'pending'
        if (isPayout) {
          status = entry.sourceType === 'PAYOUT_PAYROLL' ? 'paid_out' : 'collected'
        }
        // Map sourceType to legacy source field
        const source = entry.sourceType === 'TIP_GROUP' ? 'tip_pool'
          : entry.sourceType === 'DIRECT_TIP' ? 'tip_share'
          : entry.sourceType

        return {
          id: entry.id,
          employeeId: entry.employee.id,
          employeeName: empName(entry.employee),
          roleName: entry.employee.role?.name,
          amount: isCreditTip ? entry.amountCents / 100 : Math.abs(entry.amountCents) / 100,
          status,
          source,
          fromEmployee: entry.memo || null,
          createdAt: entry.createdAt.toISOString(),
          collectedAt: isPayout ? entry.createdAt.toISOString() : null,
          paidOutAt: entry.sourceType === 'PAYOUT_PAYROLL' ? entry.createdAt.toISOString() : null,
        }
      }),
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
})
