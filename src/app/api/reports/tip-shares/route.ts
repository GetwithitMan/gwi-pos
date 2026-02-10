// Skill 273 — Legacy TipShare lifecycle report (intentionally NOT migrated to TipLedgerEntry).
//
// This file's GET and POST work as a coupled pair:
//   GET  → reads TipShare records grouped by status (pending/accepted/paid_out)
//   POST → writes status transitions on TipShare (mark_paid, mark_paid_all)
//
// Migrating the GET to TipLedgerEntry would break the payout workflow because
// ledger entries have no status lifecycle. Once the payout flow is fully migrated
// to PAYOUT_CASH / PAYOUT_PAYROLL debit entries (see /api/tips/payouts), this
// entire file can be rewritten against TipLedgerEntry. Until then, the legacy
// TipShare model is the source of truth for tip-out payout status tracking.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'

// GET - Generate tip share report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate') // YYYY-MM-DD
    const endDate = searchParams.get('endDate') // YYYY-MM-DD
    const employeeId = searchParams.get('employeeId') // Optional filter
    const status = searchParams.get('status') // pending, accepted, paid_out, all
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get business day settings for proper date boundaries
    const tipShareLocation = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const locationSettings = parseSettings(tipShareLocation?.settings)
    const dayStartTime = locationSettings.businessDay.dayStartTime

    // Build date range using business day boundaries
    let startOfRange: Date
    let endOfRange: Date

    if (startDate) {
      const startRange = getBusinessDayRange(startDate, dayStartTime)
      startOfRange = startRange.start
    } else {
      // Default to start of current pay period or 2 weeks ago
      const twoWeeksAgo = new Date()
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
      const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0]
      const startRange = getBusinessDayRange(twoWeeksAgoStr, dayStartTime)
      startOfRange = startRange.start
    }

    if (endDate) {
      const endRange = getBusinessDayRange(endDate, dayStartTime)
      endOfRange = endRange.end
    } else {
      const current = getCurrentBusinessDay(dayStartTime)
      endOfRange = current.end
    }

    // Build where clause
    const whereClause: Record<string, unknown> = {
      locationId,
      createdAt: { gte: startOfRange, lte: endOfRange },
    }

    if (status && status !== 'all') {
      whereClause.status = status
    }

    if (employeeId) {
      // Filter by either giver or receiver
      whereClause.OR = [
        { fromEmployeeId: employeeId },
        { toEmployeeId: employeeId },
      ]
      delete whereClause.locationId // Need to move to each OR condition
      whereClause.OR = [
        { fromEmployeeId: employeeId, locationId },
        { toEmployeeId: employeeId, locationId },
      ]
    }

    // Fetch all tip shares in range
    const tipShares = await db.tipShare.findMany({
      where: employeeId ? {
        createdAt: { gte: startOfRange, lte: endOfRange },
        ...(status && status !== 'all' ? { status } : {}),
        OR: [
          { fromEmployeeId: employeeId, locationId },
          { toEmployeeId: employeeId, locationId },
        ],
      } : {
        locationId,
        createdAt: { gte: startOfRange, lte: endOfRange },
        ...(status && status !== 'all' ? { status } : {}),
      },
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
        rule: {
          select: {
            percentage: true,
            fromRole: { select: { name: true } },
            toRole: { select: { name: true } },
          },
        },
        shift: {
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Group by employee who RECEIVES tips (for payout purposes)
    const byRecipient: Record<string, {
      employeeId: string
      employeeName: string
      role: string
      pending: number
      accepted: number
      paidOut: number
      total: number
      shares: Array<{
        id: string
        amount: number
        fromEmployee: string
        fromRole: string
        shareType: string
        ruleName: string | null
        percentage: number | null
        status: string
        date: string
        shiftDate: string | null
      }>
    }> = {}

    // Group by employee who GIVES tips (for tracking purposes)
    const byGiver: Record<string, {
      employeeId: string
      employeeName: string
      role: string
      totalGiven: number
      shares: Array<{
        id: string
        amount: number
        toEmployee: string
        toRole: string
        shareType: string
        status: string
        date: string
      }>
    }> = {}

    // Totals by status
    let totalPending = 0
    let totalAccepted = 0
    let totalPaidOut = 0

    tipShares.forEach(share => {
      const amount = Number(share.amount)
      const fromName = share.fromEmployee.displayName ||
        `${share.fromEmployee.firstName} ${share.fromEmployee.lastName}`
      const toName = share.toEmployee.displayName ||
        `${share.toEmployee.firstName} ${share.toEmployee.lastName}`
      const fromRole = share.fromEmployee.role?.name || 'Unknown'
      const toRole = share.toEmployee.role?.name || 'Unknown'

      // Track by status
      if (share.status === 'pending' || share.status === 'banked') {
        totalPending += amount
      } else if (share.status === 'accepted') {
        totalAccepted += amount
      } else if (share.status === 'paid_out' || share.status === 'collected') {
        totalPaidOut += amount
      }

      // Group by recipient
      const recipientId = share.toEmployee.id
      if (!byRecipient[recipientId]) {
        byRecipient[recipientId] = {
          employeeId: recipientId,
          employeeName: toName,
          role: toRole,
          pending: 0,
          accepted: 0,
          paidOut: 0,
          total: 0,
          shares: [],
        }
      }

      byRecipient[recipientId].total += amount
      if (share.status === 'pending' || share.status === 'banked') {
        byRecipient[recipientId].pending += amount
      } else if (share.status === 'accepted') {
        byRecipient[recipientId].accepted += amount
      } else if (share.status === 'paid_out' || share.status === 'collected') {
        byRecipient[recipientId].paidOut += amount
      }

      byRecipient[recipientId].shares.push({
        id: share.id,
        amount: round(amount),
        fromEmployee: fromName,
        fromRole,
        shareType: share.shareType,
        ruleName: share.rule
          ? `${share.rule.fromRole.name} → ${share.rule.toRole.name}`
          : null,
        percentage: share.rule ? Number(share.rule.percentage) : null,
        status: share.status,
        date: share.createdAt.toISOString(),
        shiftDate: share.shift?.startedAt?.toISOString().split('T')[0] || null,
      })

      // Group by giver
      const giverId = share.fromEmployee.id
      if (!byGiver[giverId]) {
        byGiver[giverId] = {
          employeeId: giverId,
          employeeName: fromName,
          role: fromRole,
          totalGiven: 0,
          shares: [],
        }
      }

      byGiver[giverId].totalGiven += amount
      byGiver[giverId].shares.push({
        id: share.id,
        amount: round(amount),
        toEmployee: toName,
        toRole,
        shareType: share.shareType,
        status: share.status,
        date: share.createdAt.toISOString(),
      })
    })

    // Get location settings for tip share payout method
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })

    const settings = (location?.settings as Record<string, Record<string, unknown>>) || {}
    const tipShareSettings = settings.tipShares || {}
    const tipSharePayoutMethod = (tipShareSettings.payoutMethod as string) || 'payroll'

    return NextResponse.json({
      reportPeriod: {
        start: startOfRange.toISOString().split('T')[0],
        end: endOfRange.toISOString().split('T')[0],
      },
      generatedAt: new Date().toISOString(),

      settings: {
        payoutMethod: tipSharePayoutMethod, // 'payroll' or 'manual'
      },

      summary: {
        totalShares: tipShares.length,
        totalAmount: round(totalPending + totalAccepted + totalPaidOut),
        pending: round(totalPending),      // Awaiting payout
        accepted: round(totalAccepted),    // Acknowledged, on payroll queue
        paidOut: round(totalPaidOut),      // Already paid
        awaitingPayout: round(totalPending + totalAccepted), // Total to pay
      },

      // For PAYOUT - grouped by who needs to receive money
      byRecipient: Object.values(byRecipient)
        .map(r => ({
          ...r,
          pending: round(r.pending),
          accepted: round(r.accepted),
          paidOut: round(r.paidOut),
          total: round(r.total),
        }))
        .sort((a, b) => b.total - a.total),

      // For TRACKING - grouped by who gave tips
      byGiver: Object.values(byGiver)
        .map(g => ({
          ...g,
          totalGiven: round(g.totalGiven),
        }))
        .sort((a, b) => b.totalGiven - a.totalGiven),

      // Raw list of all shares
      allShares: tipShares.map(share => ({
        id: share.id,
        amount: round(Number(share.amount)),
        fromEmployee: share.fromEmployee.displayName ||
          `${share.fromEmployee.firstName} ${share.fromEmployee.lastName}`,
        fromRole: share.fromEmployee.role?.name || 'Unknown',
        toEmployee: share.toEmployee.displayName ||
          `${share.toEmployee.firstName} ${share.toEmployee.lastName}`,
        toRole: share.toEmployee.role?.name || 'Unknown',
        shareType: share.shareType,
        ruleName: share.rule
          ? `${share.rule.fromRole.name} → ${share.rule.toRole.name}`
          : null,
        percentage: share.rule ? Number(share.rule.percentage) : null,
        status: share.status,
        createdAt: share.createdAt.toISOString(),
        shiftDate: share.shift?.startedAt?.toISOString().split('T')[0] || null,
      })),
    })
  } catch (error) {
    console.error('Failed to generate tip share report:', error)
    return NextResponse.json(
      { error: 'Failed to generate tip share report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// POST - Mark tip shares as paid out (for manual payout)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, action, tipShareIds, employeeId, requestingEmployeeId } = body as {
      locationId: string
      action: 'mark_paid' | 'mark_paid_all'
      tipShareIds?: string[]
      employeeId?: string
      requestingEmployeeId?: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId || employeeId, locationId, PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const now = new Date()

    if (action === 'mark_paid' && tipShareIds && tipShareIds.length > 0) {
      // Mark specific tip shares as paid out
      const updated = await db.tipShare.updateMany({
        where: {
          id: { in: tipShareIds },
          locationId,
          status: { in: ['pending', 'banked', 'accepted'] },
        },
        data: {
          status: 'paid_out',
          collectedAt: now,
        },
      })

      return NextResponse.json({
        message: `Marked ${updated.count} tip share(s) as paid out`,
        updatedCount: updated.count,
        paidAt: now.toISOString(),
      })
    }

    if (action === 'mark_paid_all' && employeeId) {
      // Mark all pending tip shares for an employee as paid out
      const updated = await db.tipShare.updateMany({
        where: {
          toEmployeeId: employeeId,
          locationId,
          status: { in: ['pending', 'banked', 'accepted'] },
        },
        data: {
          status: 'paid_out',
          collectedAt: now,
        },
      })

      return NextResponse.json({
        message: `Marked all tip shares for employee as paid out`,
        updatedCount: updated.count,
        paidAt: now.toISOString(),
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Failed to update tip shares:', error)
    return NextResponse.json(
      { error: 'Failed to update tip shares' },
      { status: 500 }
    )
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
