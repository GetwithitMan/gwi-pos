import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, DEFAULT_MEMBERSHIP_SETTINGS } from '@/lib/settings'
import { processMembershipBilling } from '@/lib/membership/billing-processor'
import { processDunning } from '@/lib/membership/dunning'
import { verifyCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  try {
    const locations = await db.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    const results: Array<{ locationId: string; billing: unknown; dunning: unknown }> = []

    for (const loc of locations) {
      const settings = parseSettings(loc.settings as Record<string, unknown> | null)
      const mbrSettings = settings.memberships ?? DEFAULT_MEMBERSHIP_SETTINGS
      if (!mbrSettings.enabled) continue

      const billing = await processMembershipBilling(loc.id, db)
      const dunning = await processDunning(loc.id, db, mbrSettings.gracePeriodDays)
      results.push({ locationId: loc.id, billing, dunning })
      // Results returned in response body
    }

    return NextResponse.json({ ok: true, results })
  } catch (err) {
    console.error('[cron/process-memberships] fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
