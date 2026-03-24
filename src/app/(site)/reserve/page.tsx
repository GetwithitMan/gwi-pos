/**
 * Reserve Page — Redirects to the existing reservation flow.
 *
 * If reservations are not enabled, shows a "coming soon" message.
 * Otherwise, redirects to the existing public reservation page.
 */

import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Reservations',
}

export default async function ReservePage() {
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

  // If reservations enabled, redirect to existing public reservation flow
  if (bootstrap.capabilities.canReserve) {
    redirect(`/reserve/${slug}`)
  }

  // Reservations not enabled — show coming-soon
  return (
    <div className="py-12 md:py-16 px-4 md:px-6">
      <div className="max-w-lg mx-auto text-center">
        <svg
          className="h-16 w-16 mx-auto mb-6"
          style={{ color: 'var(--site-text-muted)' }}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>

        <h1
          className="text-2xl md:text-3xl mb-4"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
          }}
        >
          Reservations Coming Soon
        </h1>
        <p className="mb-8" style={{ color: 'var(--site-text-muted)' }}>
          Online reservations are not yet available. Please call us to reserve a table.
        </p>

        {bootstrap.venue.phone && (
          <a
            href={`tel:${bootstrap.venue.phone}`}
            className="inline-block px-6 py-3 mb-4 transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-text-on-brand)',
              borderRadius: 'var(--site-btn-radius)',
              fontWeight: 'var(--site-btn-font-weight)',
            }}
          >
            Call {bootstrap.venue.phone}
          </a>
        )}

        <div>
          <Link
            href="/"
            className="text-sm hover:underline"
            style={{ color: 'var(--site-brand)' }}
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
