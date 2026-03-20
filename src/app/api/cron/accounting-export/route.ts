import { NextRequest, NextResponse } from 'next/server'
import { parseSettings, DEFAULT_ACCOUNTING_SETTINGS } from '@/lib/settings'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { generateDailySalesJournal } from '@/lib/accounting/daily-journal'
import { exportToCSV } from '@/lib/accounting/csv-exporter'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/accounting-export
 *
 * Cron endpoint that runs at the configured exportTime.
 * Generates yesterday's journal and stores the export record.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const locations = await venueDb.location.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, settings: true },
    })

    for (const loc of locations) {
      const parsed = parseSettings(loc.settings as Record<string, unknown> | null)
      const accounting = parsed.accounting ?? DEFAULT_ACCOUNTING_SETTINGS

      // Skip if auto-export is not enabled
      if (!accounting.enabled || !accounting.autoExportDaily) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'auto_export_disabled' })
        continue
      }

      // Check if we're within the 15-minute window after export time
      const exportTime = accounting.exportTime || '04:00'
      const [exportHour, exportMinute] = exportTime.split(':').map(Number)
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()

      const exportMinuteOfDay = exportHour * 60 + exportMinute
      const currentMinuteOfDay = currentHour * 60 + currentMinute
      const minutesSinceExport = currentMinuteOfDay - exportMinuteOfDay

      if (minutesSinceExport < 0 || minutesSinceExport >= 15) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'outside_export_window' })
        continue
      }

      // Calculate yesterday's business date
      const dayStartTime = parsed.businessDay?.dayStartTime || '04:00'
      const currentBusinessDay = getCurrentBusinessDay(dayStartTime)
      const yesterday = new Date(currentBusinessDay.start)
      yesterday.setDate(yesterday.getDate() - 1)
      const businessDate = yesterday.toISOString().split('T')[0]

      // Idempotency: check if auto export already ran for this date
      const alreadyRan = await venueDb.auditLog.findFirst({
        where: {
          locationId: loc.id,
          action: 'accounting_auto_export',
          entityId: businessDate,
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      })

      if (alreadyRan) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'already_ran_today', date: businessDate })
        continue
      }

      try {
        // Generate the journal
        const journal = await generateDailySalesJournal(venueDb as any, loc.id, businessDate)

        // Generate CSV (universal format for auto-export)
        const csvData = exportToCSV(journal.entries)

        // Log the auto-export
        await venueDb.auditLog.create({
          data: {
            locationId: loc.id,
            action: 'accounting_auto_export',
            entityType: 'accounting_journal',
            entityId: businessDate,
            details: {
              format: accounting.provider === 'none' ? 'csv' : accounting.provider,
              date: businessDate,
              entryCount: journal.entries.length,
              totalDebits: journal.totalDebits,
              totalCredits: journal.totalCredits,
              isBalanced: journal.isBalanced,
              csvLength: csvData.length,
              automated: true,
              summary: {
                totalSales: journal.summary.totalSales,
                totalCash: journal.summary.totalCash,
                totalCard: journal.summary.totalCard,
                totalTax: journal.summary.totalTax,
                totalTips: journal.summary.totalTips,
              },
            },
          },
        })

        allResults.push({
          slug,
          locationId: loc.id,
          date: businessDate,
          entryCount: journal.entries.length,
          totalDebits: journal.totalDebits,
          totalCredits: journal.totalCredits,
          isBalanced: journal.isBalanced,
          status: 'exported',
        })
      } catch (err) {
        console.error(`[cron:accounting-export] Failed for venue ${slug} location ${loc.id}:`, err)
        allResults.push({
          slug,
          locationId: loc.id,
          date: businessDate,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }
  }, { label: 'cron:accounting-export' })

  return NextResponse.json({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}
