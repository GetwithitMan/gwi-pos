/**
 * Payroll Export API (Skill 258)
 *
 * GET - Generate payroll export data for a date range.
 *       Supports CSV (default) and JSON output formats.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { aggregatePayrollData, formatPayrollCSV } from '@/lib/domain/tips/tip-payroll-export'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// ─── GET: Generate payroll export ────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const periodStart = searchParams.get('periodStart')
    const periodEnd = searchParams.get('periodEnd')
    const format = searchParams.get('format') || 'csv'

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!periodStart) {
      return err('periodStart is required')
    }

    if (!periodEnd) {
      return err('periodEnd is required')
    }

    if (format !== 'csv' && format !== 'json') {
      return err('format must be "csv" or "json"')
    }

    // ── Auth check ────────────────────────────────────────────────────────

    const requestingEmployeeId = request.headers.get('x-employee-id')

    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_PROCESS_PAYOUT]
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // ── Parse dates ─────────────────────────────────────────────────────

    const startDate = new Date(periodStart)
    const endDate = new Date(periodEnd)
    endDate.setHours(23, 59, 59, 999)

    // ── Generate payroll data ───────────────────────────────────────────

    const data = await aggregatePayrollData({
      locationId,
      periodStart: startDate,
      periodEnd: endDate,
    })

    // ── Return in requested format ──────────────────────────────────────

    if (format === 'csv') {
      const csv = formatPayrollCSV(data)
      const startStr = startDate.toISOString().split('T')[0]
      const endStr = endDate.toISOString().split('T')[0]

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="payroll-export-${startStr}-to-${endStr}.csv"`,
        },
      })
    }

    // JSON format
    return ok({ data })
  } catch (error) {
    console.error('Failed to generate payroll export:', error)
    return err('Failed to generate payroll export', 500)
  }
})
