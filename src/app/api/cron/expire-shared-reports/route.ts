import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/expire-shared-reports — Daily cleanup of expired shared reports
 *
 * Deletes SharedReport rows where expiresAt < now.
 * Intended to be called by cron (Vercel Cron or NUC crontab).
 */
export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    const result = await venueDb.$executeRawUnsafe(
      `DELETE FROM "SharedReport" WHERE "expiresAt" < NOW()`
    )
    allResults[slug] = { deleted: result }
  }, { label: 'cron:expire-shared-reports' })

  return NextResponse.json({
    ...summary,
    data: allResults,
  })
}
