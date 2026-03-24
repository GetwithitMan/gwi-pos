/**
 * Site Homepage — Server component with full section rendering.
 *
 * Sections are toggled by bootstrap section flags. Featured items are
 * fetched directly from the venue DB (no HTTP hop). All sections use
 * consistent spacing and CSS variable theming.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { computeIsOrderableOnline, getStockStatus } from '@/lib/online-availability'
import { SiteHero } from '@/components/site/SiteHero'
import { HoursDisplay } from '@/components/site/HoursDisplay'
import { FeaturedItemsGrid } from '@/components/site/FeaturedItemsGrid'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { MenuItemData } from '@/components/site/MenuItemCard'

export const dynamic = 'force-dynamic'

// ── Featured Items Loader ───────────────────────────────────────────────────

async function fetchFeaturedItems(slug: string): Promise<MenuItemData[]> {
  try {
    const venueDb = await getDbForVenue(slug)
    const location = await venueDb.location.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!location) return []

    // Get first 2 online-visible categories
    const categories = await venueDb.category.findMany({
      where: {
        locationId: location.id,
        isActive: true,
        showOnline: true,
        deletedAt: null,
      },
      orderBy: { sortOrder: 'asc' },
      take: 2,
      select: {
        id: true,
        menuItems: {
          where: {
            isActive: true,
            showOnline: true,
            deletedAt: null,
          },
          orderBy: { sortOrder: 'asc' },
          take: 6,
          select: {
            id: true,
            name: true,
            displayName: true,
            description: true,
            price: true,
            onlinePrice: true,
            imageUrl: true,
            itemType: true,
            showOnline: true,
            isAvailable: true,
            availableFrom: true,
            availableTo: true,
            availableDays: true,
            trackInventory: true,
            currentStock: true,
            lowStockAlert: true,
          },
        },
      },
    })

    const now = new Date()
    const items: MenuItemData[] = []

    for (const category of categories) {
      for (const item of category.menuItems) {
        if (items.length >= 6) break

        const isOrderable = computeIsOrderableOnline(
          {
            showOnline: item.showOnline,
            isAvailable: item.isAvailable,
            availableFrom: item.availableFrom,
            availableTo: item.availableTo,
            availableDays: item.availableDays,
            currentStock: item.currentStock,
            trackInventory: item.trackInventory,
            lowStockAlert: item.lowStockAlert,
          },
          now
        )
        if (!isOrderable) continue

        items.push({
          id: item.id,
          name: item.displayName ?? item.name,
          description: item.description,
          price: item.onlinePrice != null ? Number(item.onlinePrice) : Number(item.price),
          imageUrl: item.imageUrl,
          stockStatus: getStockStatus({
            trackInventory: item.trackInventory,
            currentStock: item.currentStock,
            lowStockAlert: item.lowStockAlert,
            isAvailable: item.isAvailable,
          }),
          itemType: item.itemType,
        })
      }
    }

    return items
  } catch {
    return []
  }
}

// ── Page Component ──────────────────────────────────────────────────────────

export default async function SiteHomePage() {
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

  const { venue, branding, sections, content, hours, capabilities } = bootstrap

  // Fetch featured items if section enabled
  const featuredItems =
    sections.showFeaturedItems && capabilities.canBrowseMenu
      ? await fetchFeaturedItems(slug)
      : []

  return (
    <div>
      {/* ── Closed Banner ──────────────────────────────────────────────── */}
      {!capabilities.isCurrentlyOpen && capabilities.canBrowseMenu && !sections.showHero && (
        <div
          className="px-4 py-3 text-center text-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--site-brand) 10%, transparent)',
            color: 'var(--site-text)',
            borderBottom: '1px solid var(--site-border)',
          }}
        >
          We&apos;re currently closed. Browse the menu and check our hours below.
        </div>
      )}

      {/* ── Hero Section ───────────────────────────────────────────────── */}
      {sections.showHero && (
        <SiteHero
          venueName={venue.name}
          tagline={branding.tagline}
          bannerUrl={branding.bannerUrl}
          logoUrl={branding.logoUrl}
          brandColor={branding.brandColor}
          capabilities={capabilities}
        />
      )}

      {/* ── Featured Items ─────────────────────────────────────────────── */}
      {sections.showFeaturedItems && capabilities.canBrowseMenu && featuredItems.length > 0 && (
        <section
          className="py-12 md:py-16 px-4 md:px-6"
          style={{ backgroundColor: 'var(--site-bg-secondary)' }}
        >
          <div className="max-w-5xl mx-auto">
            <h2
              className="text-2xl md:text-3xl mb-8 text-center"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Popular Items
            </h2>
            <FeaturedItemsGrid items={featuredItems} />
            <div className="text-center mt-8">
              <Link
                href="/menu"
                className="inline-flex items-center gap-1 text-base font-medium hover:underline"
                style={{ color: 'var(--site-brand)' }}
              >
                View Full Menu
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── About Section ──────────────────────────────────────────────── */}
      {sections.showAbout && content.aboutText && (
        <section className="py-12 md:py-16 px-4 md:px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              About Us
            </h2>
            <p
              className="text-base md:text-lg leading-relaxed"
              style={{ color: 'var(--site-text-muted)', lineHeight: 1.75 }}
            >
              {content.aboutText}
            </p>
          </div>
        </section>
      )}

      {/* ── Hours Section ──────────────────────────────────────────────── */}
      {sections.showHours && hours.length > 0 && (
        <section
          className="py-12 md:py-16 px-4 md:px-6"
          style={{ backgroundColor: 'var(--site-bg-secondary)' }}
        >
          <div className="max-w-md mx-auto">
            <h2
              className="text-2xl md:text-3xl mb-6 text-center"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Hours
            </h2>
            <HoursDisplay
              hours={hours}
              isCurrentlyOpen={capabilities.isCurrentlyOpen}
            />
          </div>
        </section>
      )}

      {/* ── Reservations CTA ───────────────────────────────────────────── */}
      {sections.showReservations && capabilities.canReserve && (
        <section className="py-12 md:py-16 px-4 md:px-6">
          <div
            className="max-w-2xl mx-auto text-center p-8 md:p-12 rounded-xl"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--site-brand) 5%, var(--site-bg))',
              border: '1px solid color-mix(in srgb, var(--site-brand) 20%, transparent)',
            }}
          >
            <h2
              className="text-2xl md:text-3xl mb-4"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Reserve a Table
            </h2>
            <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
              Skip the wait — book your table online and we&apos;ll have it ready when you arrive.
            </p>
            <Link
              href="/reserve"
              className="inline-block px-8 py-3 transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-text-on-brand)',
                borderRadius: 'var(--site-btn-radius)',
                fontWeight: 'var(--site-btn-font-weight)',
                textTransform: 'var(--site-btn-text-transform)' as React.CSSProperties['textTransform'],
              }}
            >
              Make a Reservation
            </Link>
          </div>
        </section>
      )}

      {/* ── Contact Section ────────────────────────────────────────────── */}
      {sections.showContact && (
        <section
          className="py-12 md:py-16 px-4 md:px-6"
          style={{ backgroundColor: 'var(--site-bg-secondary)' }}
        >
          <div className="max-w-2xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Contact
            </h2>
            <div className="space-y-2" style={{ color: 'var(--site-text-muted)' }}>
              {venue.address && <p>{venue.address}</p>}
              {venue.phone && (
                <p>
                  <a href={`tel:${venue.phone}`} className="underline hover:opacity-80">
                    {venue.phone}
                  </a>
                </p>
              )}
              {venue.email && (
                <p>
                  <a href={`mailto:${venue.email}`} className="underline hover:opacity-80">
                    {venue.email}
                  </a>
                </p>
              )}
            </div>

            {Object.keys(content.socialLinks).length > 0 && (
              <div className="flex justify-center gap-4 mt-6">
                {content.socialLinks.facebook && (
                  <a href={content.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--site-brand)' }}>Facebook</a>
                )}
                {content.socialLinks.instagram && (
                  <a href={content.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--site-brand)' }}>Instagram</a>
                )}
                {content.socialLinks.twitter && (
                  <a href={content.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--site-brand)' }}>Twitter</a>
                )}
                {content.socialLinks.yelp && (
                  <a href={content.socialLinks.yelp} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--site-brand)' }}>Yelp</a>
                )}
                {content.socialLinks.google && (
                  <a href={content.socialLinks.google} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--site-brand)' }}>Google</a>
                )}
              </div>
            )}

            <div className="mt-6">
              <Link
                href="/contact"
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--site-brand)' }}
              >
                View full contact page &rarr;
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

