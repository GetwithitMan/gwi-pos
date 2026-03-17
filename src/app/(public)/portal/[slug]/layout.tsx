'use client'

import { useEffect, useState, ReactNode } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getPortalCSSVariables } from '@/lib/portal-branding'

interface Branding {
  locationName: string
  brandColor: string
  brandColorSecondary: string
  logoUrl: string | null
  bannerUrl: string | null
  tagline: string | null
  features: {
    rewards: boolean
    orderHistory: boolean
    cakeOrdering: boolean
  }
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const slug = params.slug as string

  const [branding, setBranding] = useState<Branding | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/public/portal/${slug}/branding`)
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Portal not available' }))
          throw new Error(json.error || 'Portal not available')
        }
        const data = await res.json()
        if (!cancelled) setBranding(data)
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading...</p>
      </div>
    )
  }

  if (error || !branding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Portal Unavailable</h1>
          <p className="text-gray-600">{error || 'This customer portal is not available.'}</p>
        </div>
      </div>
    )
  }

  const cssVars = getPortalCSSVariables(branding.brandColor, branding.brandColorSecondary)
  const basePath = `/portal/${slug}`

  const navItems: Array<{ label: string; href: string }> = [
    { label: 'Home', href: basePath },
  ]
  if (branding.features.orderHistory) {
    navItems.push({ label: 'My Orders', href: `${basePath}/my-orders` })
  }
  if (branding.features.rewards) {
    navItems.push({ label: 'Rewards', href: `${basePath}/rewards` })
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50" style={cssVars as React.CSSProperties}>
      {/* Header */}
      <header
        className="w-full shadow-sm"
        style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
      >
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          {branding.logoUrl && (
            <img
              src={branding.logoUrl}
              alt={branding.locationName}
              className="h-10 w-10 rounded-full object-cover bg-white"
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">
              {branding.locationName}
            </h1>
            <p className="text-sm text-white/80">Customer Portal</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== basePath && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap rounded-t-lg ${
                    isActive
                      ? 'bg-gray-50 text-gray-900'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="w-full py-6 text-center text-xs text-gray-400">
        Powered by OrderControlCenter
      </footer>
    </div>
  )
}
