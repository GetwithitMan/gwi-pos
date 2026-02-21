'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface OnlineOrderingSettings {
  enabled: boolean
  prepTime: number
  orderTypes: string[]
  allowSpecialRequests: boolean
  maxOrdersPerWindow: number | null
  windowMinutes: number
  surchargeType: string | null
  surchargeAmount: number
  surchargeName: string
  minOrderAmount: number | null
  maxOrderAmount: number | null
  tipSuggestions: number[]
  defaultTip: number
  requireZip: boolean
  allowGuestCheckout: boolean
  requireContactForPickup: boolean
  notificationEmail: string | null
  notificationPhone: string | null
  hours: Array<{ day: number; open: string; close: string; closed: boolean }>
}

const quickLinks = [
  {
    title: 'Online Menu',
    description: 'Choose which items appear online',
    href: '/settings/online-ordering/menu',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    title: 'Order Config',
    description: 'Prep time, throttling, surcharges',
    href: '/settings/online-ordering/orders',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: 'Hours',
    description: 'Set online ordering hours',
    href: '/settings/online-ordering/hours',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Payments',
    description: 'Tips, guest checkout, limits',
    href: '/settings/online-ordering/payments',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    title: 'Notifications',
    description: 'Email & phone alerts for orders',
    href: '/settings/online-ordering/notifications',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
]

export default function OnlineOrderingOverviewPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [settings, setSettings] = useState<OnlineOrderingSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [locationSlug, setLocationSlug] = useState<string | null>(null)

  const locationId = employee?.location?.id

  // Load settings
  useEffect(() => {
    if (!locationId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/settings/online-ordering?locationId=${locationId}`)
        if (res.ok) {
          const json = await res.json()
          setSettings(json.data)
        }
      } catch (err) {
        console.error('Failed to load online ordering settings:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [locationId])

  // Load location slug for URL display
  useEffect(() => {
    if (!locationId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/locations/${locationId}`)
        if (res.ok) {
          const json = await res.json()
          setLocationSlug(json.data?.slug || null)
        }
      } catch {
        // Slug not available — that's fine
      }
    }
    load()
  }, [locationId])

  const orderingUrl = locationSlug
    ? `ordercontrolcenter.com/${locationSlug}`
    : null

  const handleCopyUrl = () => {
    if (orderingUrl) {
      navigator.clipboard.writeText(`https://${orderingUrl}`)
      toast.success('URL copied to clipboard')
    }
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Online Ordering"
        subtitle="Manage your online ordering configuration"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Status & URL Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Status</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Enable or disable online ordering for your venue
              </p>
            </div>
            {settings && (
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  settings.enabled
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {settings.enabled ? 'Accepting Orders' : 'Disabled'}
              </span>
            )}
          </div>

          {/* Read-only status — controlled by Mission Control */}
          <div className="py-3 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  settings?.enabled ? 'bg-emerald-500' : 'bg-gray-400'
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                {settings?.enabled ? 'Accepting Orders' : 'Disabled'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Enable or disable online ordering from Mission Control.
            </p>
            <a
              href="https://app.thepasspos.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Open Mission Control
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          {/* URL */}
          <div className="pt-3 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ordering URL
            </label>
            {orderingUrl ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 font-mono">
                  {orderingUrl}
                </code>
                <button
                  onClick={handleCopyUrl}
                  className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Copy URL"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <a
                  href={`https://${orderingUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Open in new tab"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                URL will appear here once your venue slug is configured
              </p>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all group"
              >
                <div className="text-gray-400 group-hover:text-blue-500 transition-colors mb-3">
                  {link.icon}
                </div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {link.title}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{link.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
