/**
 * Site Homepage — stub for Phase A.
 *
 * Renders section placeholders driven by bootstrap data.
 * Full components (SiteHero, HoursDisplay, FeaturedItems, etc.) arrive in Phase E.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'

export const dynamic = 'force-dynamic'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

  return (
    <div>
      {/* ── Hero Section ─────────────────────────────────────────────── */}
      {sections.showHero && (
        <section
          className="relative flex items-center justify-center text-center"
          style={{
            minHeight: 'var(--site-hero-min-height, 28rem)',
            background: branding.bannerUrl
              ? `linear-gradient(var(--site-hero-overlay, rgba(0,0,0,0.4)), var(--site-hero-overlay, rgba(0,0,0,0.4))), url(${branding.bannerUrl}) center/cover no-repeat`
              : `linear-gradient(135deg, var(--site-brand), var(--site-brand-secondary))`,
            color: 'var(--site-hero-text, #ffffff)',
          }}
        >
          <div className="px-6 py-16 max-w-2xl mx-auto">
            {branding.logoUrl && (
              <img
                src={branding.logoUrl}
                alt={venue.name}
                className="h-20 mx-auto mb-6"
              />
            )}
            <h1
              className="text-4xl md:text-5xl mb-4"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
            >
              {venue.name}
            </h1>
            {branding.tagline && (
              <p className="text-lg md:text-xl opacity-90 mb-8">{branding.tagline}</p>
            )}

            {/* Capability-driven CTA */}
            {capabilities.isAcceptingOrders ? (
              <Link
                href="/menu"
                className="inline-block px-8 py-3 text-lg transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--site-brand)',
                  color: 'var(--site-text-on-brand)',
                  borderRadius: 'var(--site-btn-radius)',
                  fontWeight: 'var(--site-btn-font-weight)',
                  textTransform: 'var(--site-btn-text-transform)' as React.CSSProperties['textTransform'],
                }}
              >
                Order Now
              </Link>
            ) : capabilities.canBrowseMenu ? (
              <Link
                href="/menu"
                className="inline-block px-8 py-3 text-lg transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--site-brand)',
                  color: 'var(--site-text-on-brand)',
                  borderRadius: 'var(--site-btn-radius)',
                  fontWeight: 'var(--site-btn-font-weight)',
                  textTransform: 'var(--site-btn-text-transform)' as React.CSSProperties['textTransform'],
                }}
              >
                View Menu
              </Link>
            ) : null}

            {!capabilities.isCurrentlyOpen && capabilities.canBrowseMenu && (
              <p className="mt-4 text-sm opacity-80">
                We&apos;re currently closed. Browse the menu and check our hours below.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── About Section ────────────────────────────────────────────── */}
      {sections.showAbout && content.aboutText && (
        <section style={{ padding: 'var(--site-section-padding)' }}>
          <div className="max-w-3xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
            >
              About Us
            </h2>
            <p style={{ color: 'var(--site-text-muted)', lineHeight: 1.75 }}>
              {content.aboutText}
            </p>
          </div>
        </section>
      )}

      {/* ── Featured Items Placeholder ───────────────────────────────── */}
      {sections.showFeaturedItems && capabilities.canBrowseMenu && (
        <section
          style={{
            padding: 'var(--site-section-padding)',
            backgroundColor: 'var(--site-bg-secondary)',
          }}
        >
          <div className="max-w-5xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-8"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
            >
              Popular Items
            </h2>
            {/* Phase E: FeaturedItemsGrid component */}
            <p style={{ color: 'var(--site-text-muted)' }}>
              <Link
                href="/menu"
                className="underline transition-opacity hover:opacity-80"
                style={{ color: 'var(--site-brand)' }}
              >
                Browse our full menu
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* ── Hours Section ────────────────────────────────────────────── */}
      {sections.showHours && hours.length > 0 && (
        <section style={{ padding: 'var(--site-section-padding)' }}>
          <div className="max-w-md mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
            >
              Hours
            </h2>
            <div className="space-y-2">
              {hours.map((h) => (
                <div
                  key={h.day}
                  className="flex justify-between py-1"
                  style={{ borderBottom: '1px solid var(--site-border)' }}
                >
                  <span className="font-medium">{DAY_NAMES[h.day]}</span>
                  <span style={{ color: 'var(--site-text-muted)' }}>
                    {h.closed ? 'Closed' : `${h.open} - ${h.close}`}
                  </span>
                </div>
              ))}
            </div>
            {capabilities.isCurrentlyOpen && (
              <p className="mt-4 text-sm font-medium" style={{ color: 'var(--site-brand)' }}>
                Open Now
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Reservations CTA ─────────────────────────────────────────── */}
      {sections.showReservations && capabilities.canReserve && (
        <section
          style={{
            padding: 'var(--site-section-padding)',
            backgroundColor: 'var(--site-bg-secondary)',
          }}
        >
          <div className="max-w-2xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-4"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
            >
              Make a Reservation
            </h2>
            <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
              Reserve your table and skip the wait.
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
              Reserve a Table
            </Link>
          </div>
        </section>
      )}

      {/* ── Contact Section ──────────────────────────────────────────── */}
      {sections.showContact && (
        <section style={{ padding: 'var(--site-section-padding)' }}>
          <div className="max-w-2xl mx-auto text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{ fontFamily: 'var(--site-heading-font)', fontWeight: 'var(--site-heading-weight, 700)' }}
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

            {/* Social links */}
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
          </div>
        </section>
      )}
    </div>
  )
}
