/**
 * Gift Cards Page — Server component that fetches bootstrap data,
 * checks showGiftCards flag, and renders the client purchase flow.
 *
 * Supports two modes:
 *   1. Datacap Virtual Gift (iframe-embedded storefront) — when datacapVirtualGift.enabled
 *   2. PayAPI 4-step form (original) — fallback when Datacap iframe not configured
 */

import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { GiftCardPurchaseClient } from './client'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { PublicDatacapVirtualGiftSettings } from '@/lib/settings/types'
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
  let datacapVirtualGift: PublicDatacapVirtualGiftSettings | null = null
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

      // Extract Datacap Virtual Gift settings from location settings
      const settings = location.settings as Record<string, unknown> | null
      const vgRaw = settings?.datacapVirtualGift as Record<string, unknown> | undefined
      if (vgRaw?.enabled && vgRaw?.embeddedUrl) {
        datacapVirtualGift = {
          enabled: true,
          pageId: (vgRaw.pageId as string) || null,
          publicLinkUrl: (vgRaw.publicLinkUrl as string) || null,
          embeddedUrl: (vgRaw.embeddedUrl as string) || null,
          qrCodeUrl: (vgRaw.qrCodeUrl as string) || null,
          pageStatus: (vgRaw.pageStatus as 'Active' | 'Archived') || null,
        }
      }
    }
  } catch {
    notFound()
  }

  if (!bootstrap) notFound()

  // Redirect if gift cards are not enabled
  if (!bootstrap.sections.showGiftCards) {
    redirect('/')
  }

  return (
    <GiftCardPurchaseClient
      bootstrap={bootstrap}
      slug={slug}
      datacapVirtualGift={datacapVirtualGift}
    />
  )
}
