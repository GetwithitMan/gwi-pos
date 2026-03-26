/**
 * Tip Payout API (Skill 251)
 *
 * POST - Cash out tips for a single employee
 * GET  - Get payout history OR payout preview (when ?preview=true)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import {
  cashOutTips,
  getPayoutHistory,
  dollarsToCents,
  centsToDollars,
  getLedgerBalance,
} from '@/lib/domain/tips'
import { emitCloudEvent } from '@/lib/cloud-events'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('tips-payouts')

// ─── POST: Cash out tips for a single employee ──────────────────────────────

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, amount, shiftId, approvedById, memo } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    // If amount is provided, validate it is a positive number
    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number' || amount <= 0) {
        return NextResponse.json(
          { error: 'amount must be a positive number' },
          { status: 400 }
        )
      }
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Self-access: the requesting employee IS the employee being paid out
    // Otherwise: requires TIPS_PROCESS_PAYOUT permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfAccess = requestingEmployeeId === employeeId

    if (!isSelfAccess) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_PROCESS_PAYOUT]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized. Only the employee or a manager with tip payout permission can process payouts.' },
          { status: 403 }
        )
      }
    }

    // ── Convert amount to cents (if provided) ─────────────────────────────
    const amountCents = amount !== undefined && amount !== null
      ? dollarsToCents(amount)
      : undefined

    // ── Execute cash out ──────────────────────────────────────────────────
    const result = await cashOutTips({
      locationId,
      employeeId,
      amountCents,
      shiftId,
      approvedById,
      memo,
    })

    if (!result.success) {
      // Check if it was an insufficient balance issue
      const balance = await getLedgerBalance(employeeId)
      const currentBalanceCents = balance?.currentBalanceCents ?? 0

      return NextResponse.json(
        {
          error: currentBalanceCents <= 0
            ? 'Employee has no tip balance to pay out'
            : 'Insufficient tip balance',
          currentBalanceCents,
          currentBalanceDollars: centsToDollars(currentBalanceCents),
          requestedAmountCents: amountCents ?? 0,
          requestedAmountDollars: amount ?? 0,
        },
        { status: 400 }
      )
    }

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipLedgerEntry', locationId, result.ledgerEntryId, 'INSERT')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
      }
      throw err
    }

    // Emit cloud event for tip payout (fire-and-forget)
    void emitCloudEvent("tip_settled", {
      employeeId,
      shiftId: shiftId || null,
      payoutAmountCents: result.payoutAmountCents,
      payoutAmountDollars: centsToDollars(result.payoutAmountCents),
      previousBalanceCents: result.previousBalanceCents,
      newBalanceCents: result.newBalanceCents,
      settledAt: new Date().toISOString(),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // ── Return success ────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      payout: {
        employeeId,
        amountCents: result.payoutAmountCents,
        amountDollars: centsToDollars(result.payoutAmountCents),
        previousBalanceCents: result.previousBalanceCents,
        previousBalanceDollars: centsToDollars(result.previousBalanceCents),
        newBalanceCents: result.newBalanceCents,
        newBalanceDollars: centsToDollars(result.newBalanceCents),
        ledgerEntryId: result.ledgerEntryId,
      },
    })
  } catch (error) {
    console.error('Failed to process tip payout:', error)
    return NextResponse.json(
      { error: 'Failed to process tip payout' },
      { status: 500 }
    )
  }
}))

// ─── GET: Get payout history OR payout preview ──────────────────────────────

export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const preview = searchParams.get('preview')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // If employeeId is provided: self-access or TIPS_VIEW_LEDGER permission
    // If no employeeId (all history): requires TIPS_VIEW_LEDGER permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfAccess = employeeId ? requestingEmployeeId === employeeId : false

    if (!isSelfAccess) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_VIEW_LEDGER]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        )
      }
    }

    // ── Preview mode: return payout breakdown before actual cash-out ─────
    if (preview === 'true') {
      if (!employeeId) {
        return NextResponse.json(
          { error: 'employeeId is required for preview' },
          { status: 400 }
        )
      }

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date()
      todayEnd.setHours(23, 59, 59, 999)

      // Fetch balance and today's ledger entries in parallel
      const [balance, todayEntries, previousPayouts] = await Promise.all([
        getLedgerBalance(employeeId),
        db.tipLedgerEntry.findMany({
          where: {
            employeeId,
            locationId,
            deletedAt: null,
            createdAt: { gte: todayStart, lte: todayEnd },
          },
          select: {
            amountCents: true,
            type: true,
            sourceType: true,
          },
        }),
        db.tipLedgerEntry.aggregate({
          where: {
            employeeId,
            locationId,
            deletedAt: null,
            sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
            createdAt: { gte: todayStart, lte: todayEnd },
          },
          _sum: { amountCents: true },
        }),
      ])

      const totalAvailableCents = balance?.currentBalanceCents ?? 0

      // Categorize today's entries
      let directTipsCents = 0
      let groupTipsCents = 0
      let tipOutsGivenCents = 0
      let tipOutsReceivedCents = 0
      let adjustmentsCents = 0

      for (const entry of todayEntries) {
        const amt = Number(entry.amountCents)
        switch (entry.sourceType) {
          case 'DIRECT_TIP':
            if (entry.type === 'CREDIT') directTipsCents += amt
            break
          case 'TIP_GROUP':
            if (entry.type === 'CREDIT') groupTipsCents += amt
            break
          case 'ROLE_TIPOUT':
            if (entry.type === 'DEBIT') tipOutsGivenCents += amt   // negative (debit)
            if (entry.type === 'CREDIT') tipOutsReceivedCents += amt
            break
          case 'ADJUSTMENT':
          case 'CHARGEBACK':
            adjustmentsCents += amt
            break
        }
      }

      // Previous payouts today (debits, so the sum is negative)
      const previousPayoutsCents = Number(previousPayouts._sum.amountCents || 0)

      // Today's tips = sum of all CREDIT entries today
      const todaysTipsCents = directTipsCents + groupTipsCents + tipOutsReceivedCents

      // Previous balance = total available - today's net activity
      const todayNetCents = todayEntries.reduce(
        (sum, e) => sum + Number(e.amountCents), 0
      )
      const previousBalanceCents = totalAvailableCents - todayNetCents

      return NextResponse.json({
        todaysTips: centsToDollars(todaysTipsCents),
        previousBalance: centsToDollars(Math.max(0, previousBalanceCents)),
        totalAvailable: centsToDollars(totalAvailableCents),
        payoutAmount: centsToDollars(totalAvailableCents),
        breakdown: {
          directTips: centsToDollars(directTipsCents),
          groupTips: centsToDollars(groupTipsCents),
          tipOutsGiven: centsToDollars(tipOutsGivenCents),
          tipOutsReceived: centsToDollars(tipOutsReceivedCents),
          adjustments: centsToDollars(adjustmentsCents),
          previousPayouts: centsToDollars(previousPayoutsCents),
        },
      })
    }

    // ── Standard mode: return payout history ─────────────────────────────

    // ── Build filters ─────────────────────────────────────────────────────
    const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50)) : 50
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    const filters: {
      dateFrom?: Date
      dateTo?: Date
      limit: number
      offset: number
    } = {
      limit,
      offset,
    }

    if (dateFrom) {
      filters.dateFrom = new Date(dateFrom)
    }
    if (dateTo) {
      const dateToEnd = new Date(dateTo)
      dateToEnd.setHours(23, 59, 59, 999)
      filters.dateTo = dateToEnd
    }

    // ── Query entries ─────────────────────────────────────────────────────
    const { entries, total } = await getPayoutHistory({
      locationId,
      employeeId: employeeId || undefined,
      ...filters,
    })

    return NextResponse.json({
      payouts: entries.map(entry => ({
        id: entry.id,
        employeeId: entry.employeeId,
        amountCents: entry.amountCents,
        amountDollars: centsToDollars(entry.amountCents),
        sourceType: entry.sourceType,
        memo: entry.memo,
        shiftId: entry.shiftId,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get payout history:', error)
    return NextResponse.json(
      { error: 'Failed to get payout history' },
      { status: 500 }
    )
  }
}))
