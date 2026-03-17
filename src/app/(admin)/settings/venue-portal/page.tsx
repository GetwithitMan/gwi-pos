'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow } from '@/components/admin/settings'
import { SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { VenuePortalSettings } from '@/lib/settings'
import { DEFAULT_VENUE_PORTAL } from '@/lib/settings'

export default function VenuePortalSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [config, setConfig] = useState<VenuePortalSettings>(DEFAULT_VENUE_PORTAL)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const loaded = data.settings.venuePortal ?? DEFAULT_VENUE_PORTAL
        setConfig(loaded)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadSettings()
    return cleanup
  }, [loadSettings])

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ venuePortal: config }, employee?.id)
      const saved = data.settings.venuePortal ?? DEFAULT_VENUE_PORTAL
      setConfig(saved)
      setIsDirty(false)
      toast.success('Portal settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof VenuePortalSettings>(key: K, value: VenuePortalSettings[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Customer Portal Settings"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="Customer Portal Settings"
        subtitle="Configure your customer-facing portal: branding, features, and access"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
        ]}
      />

      {/* General */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">General</h2>

        <ToggleRow
          label="Enable Customer Portal"
          description="Activate the public customer portal for your venue"
          checked={config.enabled}
          onChange={v => update('enabled', v)}
        />

        {config.enabled && (
          <>
            <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900">Portal Slug</div>
                <div className="text-xs text-gray-600">
                  URL: /portal/<span className="font-mono">{config.slug || 'your-venue'}</span>
                </div>
              </div>
              <input
                type="text"
                value={config.slug}
                onChange={e => {
                  // Sanitize slug: lowercase, alphanumeric + hyphens only
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                  update('slug', val)
                }}
                placeholder="your-venue-name"
                className="w-72 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900">Tagline</div>
                <div className="text-xs text-gray-600">Short message shown below your venue name</div>
              </div>
              <input
                type="text"
                value={config.tagline || ''}
                onChange={e => update('tagline', e.target.value || undefined)}
                placeholder="Welcome to our portal!"
                className="w-72 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </>
        )}
      </div>

      {/* Branding */}
      {config.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Branding</h2>

          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">Brand Color (Primary)</div>
              <div className="text-xs text-gray-600">Hex color for header, buttons, and accents</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config.brandColor}
                onChange={e => update('brandColor', e.target.value)}
                className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={config.brandColor}
                onChange={e => update('brandColor', e.target.value)}
                placeholder="#3B82F6"
                className="w-28 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">Brand Color (Secondary)</div>
              <div className="text-xs text-gray-600">Optional gradient accent color</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config.brandColorSecondary || config.brandColor}
                onChange={e => update('brandColorSecondary', e.target.value)}
                className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={config.brandColorSecondary || ''}
                onChange={e => update('brandColorSecondary', e.target.value || undefined)}
                placeholder={config.brandColor}
                className="w-28 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">Logo URL</div>
              <div className="text-xs text-gray-600">Square image displayed in the portal header</div>
            </div>
            <input
              type="url"
              value={config.logoUrl || ''}
              onChange={e => update('logoUrl', e.target.value || undefined)}
              placeholder="https://..."
              className="w-72 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">Banner URL</div>
              <div className="text-xs text-gray-600">Wide banner image for the portal (optional)</div>
            </div>
            <input
              type="url"
              value={config.bannerUrl || ''}
              onChange={e => update('bannerUrl', e.target.value || undefined)}
              placeholder="https://..."
              className="w-72 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}

      {/* Features */}
      {config.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Portal Features</h2>

          <ToggleRow
            label="Rewards Page"
            description="Show a rewards / loyalty redemption page on the portal"
            checked={config.rewardsPageEnabled}
            onChange={v => update('rewardsPageEnabled', v)}
          />

          <ToggleRow
            label="Order History"
            description="Allow customers to view their past order history"
            checked={config.orderHistoryEnabled}
            onChange={v => update('orderHistoryEnabled', v)}
            border
          />

          <ToggleRow
            label="Cake Ordering on Portal"
            description="Show cake ordering access from the customer portal"
            checked={config.cakeOrderingOnPortal}
            onChange={v => update('cakeOrderingOnPortal', v)}
            border
          />
        </div>
      )}

      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
    </div>
  )
}
