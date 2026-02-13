/**
 * Tip Payout API (Skill 251)
 *
 * POST - Cash out tips for a single employee
 * GET  - Get payout history
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  cashOutTips,
  getPayoutHistory,
  dollarsToCents,
  centsToDollars,
  getLedgerBalance,
} from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'

// ─── POST: Cash out tips for a single employee ──────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
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
})

// ─── GET: Get payout history ─────────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
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
})
