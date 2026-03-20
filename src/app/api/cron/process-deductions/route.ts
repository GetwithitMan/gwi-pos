import { NextRequest, NextResponse } from 'next/server'
import { processAllPending } from '@/lib/deduction-processor'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  // processAllPending() uses module-level `db` from @/lib/db.
  // forAllVenues sets up requestStore.run() so the db Proxy resolves
  // to each venue's PrismaClient automatically.
  const summary = await forAllVenues(async (_venueDb, slug) => {
    const result = await processAllPending()
    allResults[slug] = result
  }, { label: 'cron:process-deductions' })

  return NextResponse.json({ ...summary, data: allResults })
}
