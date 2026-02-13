/**
 * Batch Tip Payout API (Skill 251)
 *
 * POST - Batch payroll payout for multiple employees
 * GET  - Get payable balances (employees owed tips)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  batchPayrollPayout,
  getPayableBalances,
  centsToDollars,
} from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'

// ─── POST: Batch payroll payout ──────────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, processedById, employeeIds, memo } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!processedById) {
      return NextResponse.json(
        { error: 'processedById is required' },
        { status: 400 }
      )
    }

    // Validate employeeIds format if provided
    if (employeeIds !== undefined && employeeIds !== null) {
      if (!Array.isArray(employeeIds)) {
        return NextResponse.json(
          { error: 'employeeIds must be an array of employee IDs' },
          { status: 400 }
        )
      }
      if (employeeIds.length > 0 && employeeIds.some((id: unknown) => typeof id !== 'string')) {
        return NextResponse.json(
          { error: 'employeeIds must contain only string IDs' },
          { status: 400 }
        )
      }
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Batch payroll payouts always require TIPS_PROCESS_PAYOUT permission
    const requestingEmployeeId = request.headers.get('x-employee-id')

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PROCESS_PAYOUT]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Not authorized. Batch payroll payouts require tip payout permission.' },
        { status: 403 }
      )
    }

    // ── Execute batch payout ──────────────────────────────────────────────
    const result = await batchPayrollPayout({
      locationId,
      processedById,
      employeeIds: employeeIds || undefined,
      memo,
    })

    // ── Return success ────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      batch: {
        totalPaidOutCents: result.totalPaidOutCents,
        totalPaidOutDollars: centsToDollars(result.totalPaidOutCents),
        employeeCount: result.employeeCount,
        entries: result.entries.map(entry => ({
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          amountCents: entry.amountCents,
          amountDollars: centsToDollars(entry.amountCents),
          ledgerEntryId: entry.ledgerEntryId,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to process batch payroll payout:', error)
    return NextResponse.json(
      { error: 'Failed to process batch payroll payout' },
      { status: 500 }
    )
  }
})

// ─── GET: Get payable balances ───────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Viewing payable balances requires TIPS_PROCESS_PAYOUT permission
    const requestingEmployeeId = request.headers.get('x-employee-id')

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PROCESS_PAYOUT]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
    }

    // ── Query payable balances ────────────────────────────────────────────
    const employees = await getPayableBalances(locationId)

    const totalOwedCents = employees.reduce(
      (sum, emp) => sum + emp.currentBalanceCents,
      0
    )

    return NextResponse.json({
      employees: employees.map(emp => ({
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        displayName: emp.displayName,
        roleName: emp.roleName,
        currentBalanceCents: emp.currentBalanceCents,
        currentBalanceDollars: centsToDollars(emp.currentBalanceCents),
      })),
      totalOwedCents,
      totalOwedDollars: centsToDollars(totalOwedCents),
    })
  } catch (error) {
    console.error('Failed to get payable balances:', error)
    return NextResponse.json(
      { error: 'Failed to get payable balances' },
      { status: 500 }
    )
  }
})
