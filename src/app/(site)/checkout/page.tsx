/**
 * Checkout Page — Server component that fetches bootstrap data
 * and renders the client-side checkout experience.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { CheckoutPageClient } from './client'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Checkout',
}

export default async function CheckoutPage() {
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

  if (!bootstrap.capabilities.isAcceptingOrders) {
    return (
      <div className="flex items-center justify-center py-24 px-6">
        <div className="text-center">
          <h1
            className="text-2xl mb-2"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
              color: 'var(--site-text)',
            }}
          >
            Orders Not Available
          </h1>
          <p style={{ color: 'var(--site-text-muted)' }}>
            We&apos;re not currently accepting online orders. Please check back later.
          </p>
        </div>
      </div>
    )
  }

  return <CheckoutPageClient bootstrap={bootstrap} slug={slug} />
}
