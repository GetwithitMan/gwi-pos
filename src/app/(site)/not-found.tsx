/**
 * Site Not Found — rendered when notFound() is called from within (site) pages.
 *
 * Covers: invalid slug, venue lookup failure, missing bootstrap data.
 * Branded "Coming Soon" / "Site disabled" states are handled in layout.tsx
 * (canBrowseMenu check), so this page only handles true 404s.
 */

export default function SiteNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1
          className="text-6xl font-bold mb-4"
          style={{ color: 'var(--site-brand, #3B82F6)' }}
        >
          404
        </h1>
        <h2
          className="text-2xl font-semibold mb-2"
          style={{ color: 'var(--site-text, #111827)' }}
        >
          Page Not Found
        </h2>
        <p
          className="mb-6"
          style={{ color: 'var(--site-text-muted, #6b7280)' }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <a
          href="/"
          className="inline-block px-6 py-2.5 transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--site-brand, #3B82F6)',
            color: 'var(--site-text-on-brand, #ffffff)',
            borderRadius: 'var(--site-btn-radius, 0.5rem)',
            fontWeight: 'var(--site-btn-font-weight, 600)',
          }}
        >
          Go Home
        </a>
      </div>
    </div>
  )
}
