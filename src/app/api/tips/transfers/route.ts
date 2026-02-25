/**
 * Tip Transfer API (Skill 250)
 *
 * POST - Manual tip transfer between two employees (paired DEBIT + CREDIT)
 * GET  - List transfer history for an employee
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import {
  postToTipLedger,
  getLedgerBalance,
  getLedgerEntries,
  dollarsToCents,
  centsToDollars,
} from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'

// ─── POST: Create a tip transfer ────────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, fromEmployeeId, toEmployeeId, amount, memo } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!fromEmployeeId) {
      return NextResponse.json(
        { error: 'fromEmployeeId is required' },
        { status: 400 }
      )
    }

    if (!toEmployeeId) {
      return NextResponse.json(
        { error: 'toEmployeeId is required' },
        { status: 400 }
      )
    }

    if (amount === undefined || amount === null) {
      return NextResponse.json(
        { error: 'amount is required' },
        { status: 400 }
      )
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }

    if (fromEmployeeId === toEmployeeId) {
      return NextResponse.json(
        { error: 'Cannot transfer tips to yourself' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Self-transfer: the requesting employee IS the fromEmployee
    // Manager transfer: requires TIPS_MANAGE_GROUPS permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfTransfer = requestingEmployeeId === fromEmployeeId

    if (!isSelfTransfer) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized. Only the sending employee or a manager with tip management permission can initiate transfers.' },
          { status: 403 }
        )
      }
    }

    const amountCents = dollarsToCents(amount)

    // ── Look up employee names (read-only, outside transaction) ──────────
    const [fromEmployee, toEmployee] = await Promise.all([
      db.employee.findUnique({
        where: { id: fromEmployeeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, displayName: true },
      }),
      db.employee.findUnique({
        where: { id: toEmployeeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, displayName: true },
      }),
    ])

    if (!fromEmployee) {
      return NextResponse.json(
        { error: 'Sending employee not found' },
        { status: 400 }
      )
    }

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Receiving employee not found' },
        { status: 400 }
      )
    }

    const fromName = fromEmployee.displayName || `${fromEmployee.firstName} ${fromEmployee.lastName}`
    const toName = toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`

    // ── Atomic transfer: balance check + DEBIT + CREDIT in one tx (BUG #418-421 fix) ──
    const transferId = crypto.randomUUID()

    const result = await db.$transaction(async (tx) => {
      // Check balance under transaction lock (prevents race condition)
      const fromLedger = await tx.tipLedger.findFirst({
        where: { employeeId: fromEmployeeId },
        select: { currentBalanceCents: true },
      })
      const currentBalanceCents = fromLedger?.currentBalanceCents ?? 0

      if (currentBalanceCents < amountCents) {
        return { ok: false as const, currentBalanceCents }
      }

      // DEBIT from sender (inside tx — Skill 284)
      const debit = await postToTipLedger({
        locationId,
        employeeId: fromEmployeeId,
        amountCents,
        type: 'DEBIT',
        sourceType: 'MANUAL_TRANSFER',
        memo: memo || `Transfer to ${toName}`,
        idempotencyKey: `transfer:${transferId}:DEBIT`,
      }, tx)

      // CREDIT to receiver (inside tx — Skill 284)
      const credit = await postToTipLedger({
        locationId,
        employeeId: toEmployeeId,
        amountCents,
        type: 'CREDIT',
        sourceType: 'MANUAL_TRANSFER',
        memo: `Transfer from ${fromName}`,
        idempotencyKey: `transfer:${transferId}:CREDIT`,
      }, tx)

      return { ok: true as const, debit, credit }
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: 'Insufficient tip bank balance',
          currentBalanceCents: result.currentBalanceCents,
          currentBalanceDollars: centsToDollars(result.currentBalanceCents),
          requestedAmountCents: amountCents,
          requestedAmountDollars: amount,
        },
        { status: 400 }
      )
    }

    // ── Return success ────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      transfer: {
        fromEmployeeId,
        toEmployeeId,
        amountCents,
        amount,
        debitEntryId: result.debit.id,
        creditEntryId: result.credit.id,
        fromNewBalanceCents: result.debit.newBalanceCents,
        toNewBalanceCents: result.credit.newBalanceCents,
      },
    })
  } catch (error) {
    console.error('Failed to create tip transfer:', error)
    return NextResponse.json(
      { error: 'Failed to create tip transfer' },
      { status: 500 }
    )
  }
})

// ─── GET: List transfer history ──────────────────────────────────────────────

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

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Self-access or TIPS_VIEW_LEDGER permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfAccess = requestingEmployeeId === employeeId

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
      sourceType: 'MANUAL_TRANSFER'
      dateFrom?: Date
      dateTo?: Date
      limit: number
      offset: number
    } = {
      sourceType: 'MANUAL_TRANSFER',
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
    const { entries, total } = await getLedgerEntries(employeeId, filters)

    return NextResponse.json({
      transfers: entries.map(entry => ({
        id: entry.id,
        type: entry.type,
        amountCents: entry.amountCents,
        amountDollars: centsToDollars(entry.amountCents),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        memo: entry.memo,
        shiftId: entry.shiftId,
        orderId: entry.orderId,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get tip transfers:', error)
    return NextResponse.json(
      { error: 'Failed to get tip transfers' },
      { status: 500 }
    )
  }
})
