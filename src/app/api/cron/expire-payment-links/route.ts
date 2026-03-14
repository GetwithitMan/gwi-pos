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
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await db.$executeRawUnsafe(`
      UPDATE "PaymentLink"
      SET "status" = 'expired', "updatedAt" = NOW()
      WHERE "status" = 'pending'
        AND "expiresAt" < NOW()
    `)

    const expiredCount = typeof result === 'number' ? result : 0

    if (expiredCount > 0) { /* expired count returned in response */ }

    return NextResponse.json({
      success: true,
      expired: expiredCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/expire-payment-links] Error:', error)
    return NextResponse.json({ error: 'Failed to expire payment links' }, { status: 500 })
  }
}
