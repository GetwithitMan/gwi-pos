/**
 * (site) Layout — Server component shell for the public ordering website.
 *
 * Reads x-venue-slug from proxy headers, fetches bootstrap data directly
 * (no HTTP call — server component), applies theme CSS vars, and renders
 * the SiteHeader + SiteFooter shell.
 *
 * Does NOT render <html> or <body> — those belong to the root layout.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { getSiteThemeVariables, getSiteThemeCSS } from '@/lib/site-theme'
import { SiteShell } from '@/components/site/SiteShell'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { FloatingCartBar } from '@/components/site/FloatingCartBar'
import { CartSidebar } from '@/components/site/CartSidebar'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { ThemePreset } from '@/lib/site-theme'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const slug = headersList.get('x-venue-slug')

  if (!slug) {
    return { title: 'Restaurant' }
  }

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
    // Fall through — metadata will use defaults
  }

  const venueName = bootstrap?.venue.name ?? 'Restaurant'
  const tagline = bootstrap?.branding.tagline

  return {
    title: {
      default: venueName,
      template: `%s | ${venueName}`,
    },
    description: tagline ?? `Order online from ${venueName}`,
    openGraph: {
      title: venueName,
      description: tagline ?? `Order online from ${venueName}`,
      ...(bootstrap?.branding.bannerUrl && { images: [bootstrap.branding.bannerUrl] }),
    },
  }
}

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const slug = headersList.get('x-venue-slug')
  const isSiteMode = headersList.get('x-site-mode') === '1'

  // If we're not in site mode or no slug, this layout shouldn't be active
  if (!slug || !isSiteMode) {
    redirect('/admin-login')
  }

  // ── Fetch bootstrap data (server-side, no HTTP call) ───────────────
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
  } catch (error) {
    console.error('[site-layout] Failed to load bootstrap data:', error)
  }

  // ── Venue not found or site disabled ───────────────────────────────
  if (!bootstrap) {
    return (
      <div data-site-theme className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center px-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Venue Not Found</h1>
          <p className="text-gray-600">This venue is not available.</p>
        </div>
      </div>
    )
  }

  if (!bootstrap.capabilities.canBrowseMenu) {
    return (
      <div data-site-theme className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center px-6">
          {bootstrap.branding.logoUrl && (
            <img
              src={bootstrap.branding.logoUrl}
              alt={bootstrap.venue.name}
              className="h-16 mx-auto mb-6"
            />
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{bootstrap.venue.name}</h1>
          <p className="text-gray-600">Online ordering is coming soon.</p>
          {bootstrap.venue.phone && (
            <p className="text-gray-500 mt-4">
              Call us: <a href={`tel:${bootstrap.venue.phone}`} className="underline">{bootstrap.venue.phone}</a>
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Generate theme CSS ─────────────────────────────────────────────
  const themeVars = getSiteThemeVariables({
    themePreset: (bootstrap.branding.themePreset || 'modern') as ThemePreset,
    brandColor: bootstrap.branding.brandColor,
    brandColorSecondary: bootstrap.branding.brandColorSecondary ?? undefined,
    headingFont: bootstrap.branding.headingFont,
  })
  const themeCSS = getSiteThemeCSS(themeVars)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCSS }} />
      <SiteShell slug={slug}>
        <div
          data-site-theme
          className="min-h-screen flex flex-col"
          style={{
            backgroundColor: 'var(--site-bg)',
            color: 'var(--site-text)',
            fontFamily: 'var(--site-body-font)',
          }}
        >
          <SiteHeader
            venueName={bootstrap.venue.name}
            logoUrl={bootstrap.branding.logoUrl}
            capabilities={bootstrap.capabilities}
          />
          <div className="flex-1 flex flex-col lg:flex-row">
            <CartSidebar />
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
          <FloatingCartBar />
          <SiteFooter
            venueName={bootstrap.venue.name}
            address={bootstrap.venue.address}
            phone={bootstrap.venue.phone}
            email={bootstrap.venue.email}
            hours={bootstrap.hours}
            socialLinks={bootstrap.content.socialLinks}
            footerText={bootstrap.content.footerText}
          />
        </div>
      </SiteShell>
    </>
  )
}
