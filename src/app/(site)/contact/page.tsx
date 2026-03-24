/**
 * Contact Page — Server component with venue info, hours, and social links.
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { HoursDisplay } from '@/components/site/HoursDisplay'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Contact',
}

export default async function ContactPage() {
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

  const { venue, content, hours, capabilities } = bootstrap
  const socialLinks = content.socialLinks
  const hasSocialLinks = Object.values(socialLinks).some(Boolean)

  return (
    <div className="py-12 md:py-16 px-4 md:px-6">
      <div className="max-w-2xl mx-auto">
        {/* Heading */}
        <h1
          className="text-3xl md:text-4xl mb-8 text-center"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
          }}
        >
          {venue.name}
        </h1>

        {/* Contact info */}
        <div className="space-y-4 mb-10">
          {venue.address && (
            <div className="flex items-start gap-3">
              <MapPinIcon />
              <div>
                <p className="font-medium" style={{ color: 'var(--site-text)' }}>Address</p>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: 'var(--site-brand)' }}
                >
                  {venue.address}
                </a>
              </div>
            </div>
          )}

          {venue.phone && (
            <div className="flex items-start gap-3">
              <PhoneIcon />
              <div>
                <p className="font-medium" style={{ color: 'var(--site-text)' }}>Phone</p>
                <a
                  href={`tel:${venue.phone}`}
                  className="hover:underline"
                  style={{ color: 'var(--site-brand)' }}
                >
                  {venue.phone}
                </a>
              </div>
            </div>
          )}

          {venue.email && (
            <div className="flex items-start gap-3">
              <EmailIcon />
              <div>
                <p className="font-medium" style={{ color: 'var(--site-text)' }}>Email</p>
                <a
                  href={`mailto:${venue.email}`}
                  className="hover:underline"
                  style={{ color: 'var(--site-brand)' }}
                >
                  {venue.email}
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Hours */}
        {hours.length > 0 && (
          <section className="mb-10">
            <h2
              className="text-2xl md:text-3xl mb-6 text-center"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Hours
            </h2>
            <div className="max-w-md mx-auto">
              <HoursDisplay hours={hours} isCurrentlyOpen={capabilities.isCurrentlyOpen} />
            </div>
          </section>
        )}

        {/* Social links */}
        {hasSocialLinks && (
          <section className="text-center">
            <h2
              className="text-2xl md:text-3xl mb-6"
              style={{
                fontFamily: 'var(--site-heading-font)',
                fontWeight: 'var(--site-heading-weight, 700)',
              }}
            >
              Follow Us
            </h2>
            <div className="flex justify-center gap-5">
              {socialLinks.facebook && (
                <SocialLink href={socialLinks.facebook} label="Facebook">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
                  </svg>
                </SocialLink>
              )}
              {socialLinks.instagram && (
                <SocialLink href={socialLinks.instagram} label="Instagram">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 0 1 1.772 1.153 4.902 4.902 0 0 1 1.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 0 1-1.153 1.772 4.902 4.902 0 0 1-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 0 1-1.772-1.153 4.902 4.902 0 0 1-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 0 1 1.153-1.772A4.902 4.902 0 0 1 5.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 0 0-.748-1.15 3.098 3.098 0 0 0-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 1 1 0 10.27 5.135 5.135 0 0 1 0-10.27zm0 1.802a3.333 3.333 0 1 0 0 6.666 3.333 3.333 0 0 0 0-6.666zm5.338-3.205a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" />
                  </svg>
                </SocialLink>
              )}
              {socialLinks.twitter && (
                <SocialLink href={socialLinks.twitter} label="X (Twitter)">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </SocialLink>
              )}
              {socialLinks.yelp && (
                <SocialLink href={socialLinks.yelp} label="Yelp">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.16 12.594l-4.995 1.433c-.96.276-1.74-.8-1.176-1.63l2.905-4.308a1.072 1.072 0 0 1 1.596-.206l2.039 1.726c.48.406.37 1.14-.082 1.564l-.287.421zM13.498 14.8l1.517 4.965a1.072 1.072 0 0 1-.59 1.318l-2.455 1.16c-.584.276-1.262-.19-1.262-.87l.038-5.21c.01-.99 1.254-1.516 1.92-.78l.832.417zM11.498 11.77l-3.54-3.76c-.72-.764-.24-1.99.77-1.99h2.672a1.072 1.072 0 0 1 1.072 1.07v4.61c0 1.004-1.4 1.434-2.002.79l.028-.72zM10.13 14.58l-4.87 1.82c-.924.346-1.792-.56-1.446-1.484l1.47-3.918a1.072 1.072 0 0 1 1.4-.618l3.63 1.42c.918.36.886 1.69-.184 2.78zM12.77 17.14l-1.626-4.92c-.33-.998.67-1.85 1.59-1.35l4.578 2.5c.878.48.674 1.77-.33 2.084l-3.288 1.03a1.072 1.072 0 0 1-.924-.344z" />
                  </svg>
                </SocialLink>
              )}
              {socialLinks.google && (
                <SocialLink href={socialLinks.google} label="Google">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
                  </svg>
                </SocialLink>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ── Inline Icons ──────────────────────────────────────────────────────────────

function MapPinIcon() {
  return (
    <svg
      className="h-5 w-5 mt-0.5 shrink-0"
      style={{ color: 'var(--site-brand)' }}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg
      className="h-5 w-5 mt-0.5 shrink-0"
      style={{ color: 'var(--site-brand)' }}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg
      className="h-5 w-5 mt-0.5 shrink-0"
      style={{ color: 'var(--site-brand)' }}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  )
}

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="p-3 rounded-full transition-all hover:scale-110"
      style={{
        color: 'var(--site-brand)',
        backgroundColor: 'color-mix(in srgb, var(--site-brand) 10%, transparent)',
      }}
    >
      {children}
    </a>
  )
}
