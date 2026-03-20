import { NextRequest, NextResponse } from 'next/server'
import { parseSettings, DEFAULT_MEMBERSHIP_SETTINGS } from '@/lib/settings'
import { processMembershipBilling } from '@/lib/membership/billing-processor'
import { processDunning } from '@/lib/membership/dunning'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Array<{ slug: string; locationId: string; billing: unknown; dunning: unknown }> = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const locations = await venueDb.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    for (const loc of locations) {
      const settings = parseSettings(loc.settings as Record<string, unknown> | null)
      const mbrSettings = settings.memberships ?? DEFAULT_MEMBERSHIP_SETTINGS
      if (!mbrSettings.enabled) continue

      const billing = await processMembershipBilling(loc.id, venueDb)
      const dunning = await processDunning(loc.id, venueDb, mbrSettings.gracePeriodDays)
      allResults.push({ slug, locationId: loc.id, billing, dunning })
    }
  }, { label: 'cron:process-memberships' })

  return NextResponse.json({ ...summary, results: allResults })
}
