/**
 * Cron: Expire Payment Links
 *
 * GET /api/cron/expire-payment-links
 *
 * Marks pending PaymentLink records as 'expired' when their expiresAt has passed.
 * Runs every 5 minutes via Vercel cron.
 *
 * Protected by CRON_SECRET to prevent external invocation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    const result = await venueDb.$executeRawUnsafe(`
      UPDATE "PaymentLink"
      SET "status" = 'expired', "updatedAt" = NOW()
      WHERE "status" = 'pending'
        AND "expiresAt" < NOW()
    `)

    const expiredCount = typeof result === 'number' ? result : 0
    allResults[slug] = { expired: expiredCount }
  }, { label: 'cron:expire-payment-links' })

  return NextResponse.json({
    ...summary,
    data: allResults,
    timestamp: new Date().toISOString(),
  })
}
