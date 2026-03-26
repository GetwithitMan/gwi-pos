import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { generateDailySalesJournal } from '@/lib/accounting/daily-journal'
import { exportToCSV } from '@/lib/accounting/csv-exporter'
import { exportToIIF } from '@/lib/accounting/quickbooks-exporter'
import { exportToXeroCSV } from '@/lib/accounting/xero-exporter'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('accounting-export')

/**
 * GET /api/accounting/export?date=2026-03-10
 *
 * Preview the daily sales journal for a given business date.
 * Returns journal entries, totals, and balance check.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const date = searchParams.get('date')
    const locationId = searchParams.get('locationId')

    if (!date) {
      return NextResponse.json({ error: 'date query parameter is required (YYYY-MM-DD)' }, { status: 400 })
    }

    if (!locationId) {
      return NextResponse.json({ error: 'locationId query parameter is required' }, { status: 400 })
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const journal = await generateDailySalesJournal(db as any, locationId, date)

    return NextResponse.json({
      data: {
        date: journal.date,
        entries: journal.entries,
        totalDebits: journal.totalDebits,
        totalCredits: journal.totalCredits,
        isBalanced: journal.isBalanced,
        summary: journal.summary,
        entryCount: journal.entries.length,
      },
    })
  } catch (error) {
    console.error('[Accounting Export] Preview failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate journal preview' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/accounting/export
 *
 * Export the daily sales journal in a specified format.
 * Body: { date: string, format: 'csv' | 'quickbooks_iif' | 'xero_csv' | 'json', locationId: string }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { date, format, locationId } = body as {
      date: string
      format: 'csv' | 'quickbooks_iif' | 'xero_csv' | 'json'
      locationId: string
    }

    if (!date || !format || !locationId) {
      return NextResponse.json(
        { error: 'date, format, and locationId are required' },
        { status: 400 }
      )
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 })
    }

    const validFormats = ['csv', 'quickbooks_iif', 'xero_csv', 'json']
    if (!validFormats.includes(format)) {
      return NextResponse.json(
        { error: `format must be one of: ${validFormats.join(', ')}` },
        { status: 400 }
      )
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Generate journal
    const journal = await generateDailySalesJournal(db as any, locationId, date)

    if (!journal.isBalanced) {
      console.warn(`[Accounting Export] Journal for ${date} is NOT balanced: debits=${journal.totalDebits}, credits=${journal.totalCredits}`)
    }

    // Get location name for exports that need it
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { name: true },
    })
    const companyName = location?.name || 'GWI POS'

    // Generate export in requested format
    let exportData: string
    let contentType: string
    let filename: string

    switch (format) {
      case 'csv':
        exportData = exportToCSV(journal.entries)
        contentType = 'text/csv'
        filename = `daily-journal-${date}.csv`
        break

      case 'quickbooks_iif':
        exportData = exportToIIF(journal.entries, companyName)
        contentType = 'text/plain'
        filename = `daily-journal-${date}.iif`
        break

      case 'xero_csv':
        exportData = exportToXeroCSV(journal.entries)
        contentType = 'text/csv'
        filename = `daily-journal-xero-${date}.csv`
        break

      case 'json':
      default:
        exportData = JSON.stringify({
          date: journal.date,
          entries: journal.entries,
          totalDebits: journal.totalDebits,
          totalCredits: journal.totalCredits,
          isBalanced: journal.isBalanced,
          summary: journal.summary,
        }, null, 2)
        contentType = 'application/json'
        filename = `daily-journal-${date}.json`
        break
    }

    // Log the export to audit trail (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: actor.employeeId || undefined,
        action: 'accounting_export',
        entityType: 'accounting_journal',
        entityId: date,
        details: {
          format,
          date,
          entryCount: journal.entries.length,
          totalDebits: journal.totalDebits,
          totalCredits: journal.totalCredits,
          isBalanced: journal.isBalanced,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Return file download response
    return new Response(exportData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Journal-Balanced': journal.isBalanced ? 'true' : 'false',
        'X-Journal-Debits': journal.totalDebits.toString(),
        'X-Journal-Credits': journal.totalCredits.toString(),
      },
    })
  } catch (error) {
    console.error('[Accounting Export] Export failed:', error)
    return NextResponse.json(
      { error: 'Failed to export journal' },
      { status: 500 }
    )
  }
})
