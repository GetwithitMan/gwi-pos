/**
 * Batch Tip Payout API (Skill 251)
 *
 * POST - Batch payroll payout for multiple employees
 * GET  - Get payable balances (employees owed tips)
 */

import { NextRequest } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  batchPayrollPayout,
  getPayableBalances,
  centsToDollars,
} from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { err, forbidden, ok } from '@/lib/api-response'

// ─── POST: Batch payroll payout ──────────────────────────────────────────────

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, processedById, employeeIds, memo } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!processedById) {
      return err('processedById is required')
    }

    // Validate employeeIds format if provided
    if (employeeIds !== undefined && employeeIds !== null) {
      if (!Array.isArray(employeeIds)) {
        return err('employeeIds must be an array of employee IDs')
      }
      if (employeeIds.length > 0 && employeeIds.some((id: unknown) => typeof id !== 'string')) {
        return err('employeeIds must contain only string IDs')
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
      return forbidden('Not authorized. Batch payroll payouts require tip payout permission.')
    }

    // ── Execute batch payout ──────────────────────────────────────────────
    const result = await batchPayrollPayout({
      locationId,
      processedById,
      employeeIds: employeeIds || undefined,
      memo,
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      for (const entry of result.entries) {
        await queueIfOutageOrFail('TipLedgerEntry', locationId, entry.ledgerEntryId, 'INSERT')
      }
    } catch (caughtErr) {
      if (caughtErr instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw caughtErr
    }

    // ── Return success ────────────────────────────────────────────────────
    return ok({
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
    return err('Failed to process batch payroll payout', 500)
  }
}))

// ─── GET: Get payable balances ───────────────────────────────────────────────

export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
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
      return err(auth.error, auth.status)
    }

    // ── Query payable balances ────────────────────────────────────────────
    const employees = await getPayableBalances(locationId)

    const totalOwedCents = employees.reduce(
      (sum, emp) => sum + emp.currentBalanceCents,
      0
    )

    return ok({
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
    return err('Failed to get payable balances', 500)
  }
}))
