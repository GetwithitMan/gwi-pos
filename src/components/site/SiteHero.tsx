'use client'

/**
 * SiteHero — Full-width hero section for the public site homepage.
 *
 * Renders a background image with gradient overlay (if bannerUrl set)
 * or a brand-color gradient. CTA button is capability-driven.
 */

import Link from 'next/link'

interface SiteHeroProps {
  venueName: string
  tagline?: string | null
  bannerUrl?: string | null
  logoUrl?: string | null
  brandColor: string
  capabilities: {
    isAcceptingOrders: boolean
    canBrowseMenu: boolean
    canReserve: boolean
    isCurrentlyOpen: boolean
  }
}

export function SiteHero({
  venueName,
  tagline,
  bannerUrl,
  logoUrl,
  brandColor,
  capabilities,
}: SiteHeroProps) {
  const hasBanner = !!bannerUrl

  // Determine CTA
  let ctaHref: string | null = null
  let ctaLabel: string | null = null
  let ctaOutline = false

  if (capabilities.isAcceptingOrders) {
    ctaHref = '/menu'
    ctaLabel = 'Order Now'
  } else if (capabilities.canBrowseMenu) {
    ctaHref = '/menu'
    ctaLabel = 'View Menu'
    ctaOutline = true
  } else if (capabilities.canReserve) {
    ctaHref = '/reserve'
    ctaLabel = 'Reserve a Table'
  }

  return (
    <section
      className="relative flex items-center justify-center text-center"
      style={{
        minHeight: 'min(60vh, 600px)',
        background: hasBanner
          ? `linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.6)), url(${bannerUrl}) center/cover no-repeat`
          : `linear-gradient(135deg, ${brandColor}, var(--site-brand-secondary, ${brandColor}))`,
        color: '#ffffff',
      }}
    >
      <div className="relative z-10 px-4 md:px-6 py-16 md:py-24 max-w-3xl mx-auto">
        {logoUrl && (
          <img
            src={logoUrl}
            alt={venueName}
            className="h-16 md:h-20 mx-auto mb-6"
          />
        )}

        <h1
          className="text-4xl md:text-6xl mb-4"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
            textShadow: hasBanner ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
          }}
        >
          {venueName}
        </h1>

        {tagline && (
          <p
            className="text-lg md:text-xl opacity-90 mb-8 font-light"
            style={{
              textShadow: hasBanner ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
            }}
          >
            {tagline}
          </p>
        )}

        {ctaHref && ctaLabel && (
          <Link
            href={ctaHref}
            className="inline-block px-8 py-3 text-lg transition-all hover:opacity-90 hover:scale-105"
            style={
              ctaOutline
                ? {
                    border: '2px solid #ffffff',
                    color: '#ffffff',
                    borderRadius: 'var(--site-btn-radius)',
                    fontWeight: 'var(--site-btn-font-weight, 600)',
                    textTransform: 'var(--site-btn-text-transform)' as React.CSSProperties['textTransform'],
                    backgroundColor: 'transparent',
                  }
                : {
                    backgroundColor: 'var(--site-brand)',
                    color: 'var(--site-text-on-brand)',
                    borderRadius: 'var(--site-btn-radius)',
                    fontWeight: 'var(--site-btn-font-weight, 600)',
                    textTransform: 'var(--site-btn-text-transform)' as React.CSSProperties['textTransform'],
                  }
            }
          >
            {ctaLabel}
          </Link>
        )}

        {!capabilities.isCurrentlyOpen && capabilities.canBrowseMenu && (
          <p className="mt-4 text-sm opacity-80">
            We&apos;re currently closed. Browse the menu and check our hours below.
          </p>
        )}
      </div>
    </section>
  )
}
