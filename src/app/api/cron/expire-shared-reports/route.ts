import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/expire-shared-reports — Daily cleanup of expired shared reports
 *
 * Deletes SharedReport rows where expiresAt < now.
 * Intended to be called by cron (Vercel Cron or NUC crontab).
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await db.$executeRawUnsafe(
      `DELETE FROM "SharedReport" WHERE "expiresAt" < NOW()`
    )

    return NextResponse.json({
      data: { deleted: result },
    })
  } catch (error) {
    console.error('[cron/expire-shared-reports] Error:', error)
    return NextResponse.json({ error: 'Failed to clean up expired reports' }, { status: 500 })
  }
})
