/**
 * Gift Cards Page — Server component that fetches bootstrap data,
 * checks showGiftCards flag, and renders the client purchase flow.
 */

import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { GiftCardPurchaseClient } from './client'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Gift Cards',
}

export default async function GiftCardsPage() {
  const headersList = await headers()
  const slug = headersList.get('x-venue-slug')

  if (!slug) notFound()

  let bootstrap: SiteBootstrapResponse | null = null
  try {
    const venueDb = await getDbForVenue(slug)
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, address: true, phone: true, timezone: true, settings: true },
    })
    if (location) {
      bootstrap = await getSiteBootstrapData(venueDb, location.id, {
        name: location.name,
        address: location.address,
        phone: location.phone,
        timezone: location.timezone,
        settings: location.settings,
      })
    }
  } catch {
    notFound()
  }

  if (!bootstrap) notFound()

  // Redirect if gift cards are not enabled
  if (!bootstrap.sections.showGiftCards) {
    redirect('/')
  }

  return <GiftCardPurchaseClient bootstrap={bootstrap} slug={slug} />
}
