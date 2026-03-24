'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SiteConfig {
  siteEnabled: boolean
  themePreset: 'modern' | 'classic' | 'bold'
  brandColor: string
  brandColorSecondary?: string
  logoUrl?: string
  bannerUrl?: string
  tagline?: string
  headingFont?: string
  showHero: boolean
  showAbout: boolean
  showHours: boolean
  showFeaturedItems: boolean
  showReservations: boolean
  showContact: boolean
  showRewardsOnSite: boolean
  showGiftCards: boolean
  aboutText: string
  socialLinks: {
    facebook?: string
    instagram?: string
    twitter?: string
    yelp?: string
    google?: string
  }
  footerText?: string
  featuredItemSource: 'popular' | 'manual' | 'first_n'
  featuredItemIds?: string[]
  slug: string
}

const DEFAULTS: SiteConfig = {
  siteEnabled: false,
  themePreset: 'modern',
  brandColor: '#3B82F6',
  brandColorSecondary: '',
  logoUrl: '',
  bannerUrl: '',
  tagline: '',
  headingFont: '',
  showHero: true,
  showAbout: true,
  showHours: true,
  showFeaturedItems: true,
  showReservations: false,
  showContact: true,
  showRewardsOnSite: false,
  showGiftCards: false,
  aboutText: '',
  socialLinks: {},
  footerText: '',
  featuredItemSource: 'first_n',
  featuredItemIds: [],
  slug: '',
}

// ─── Theme Presets ───────────────────────────────────────────────────────────

const THEME_PRESETS = [
  {
    id: 'modern' as const,
    name: 'Modern',
    description: 'Clean lines, subtle shadows',
    colors: ['#3B82F6', '#1E293B', '#F8FAFC', '#64748B'],
  },
  {
    id: 'classic' as const,
    name: 'Classic',
    description: 'Warm tones, traditional feel',
    colors: ['#B45309', '#1C1917', '#FEF3C7', '#78716C'],
  },
  {
    id: 'bold' as const,
    name: 'Bold',
    description: 'High contrast, vibrant accents',
    colors: ['#DC2626', '#0F172A', '#FFFFFF', '#F43F5E'],
  },
]

// ─── Toggle Component ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ─── Section Toggle Row ──────────────────────────────────────────────────────

function SectionRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (val: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && (
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function SiteConfigPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [config, setConfig] = useState<SiteConfig>(DEFAULTS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const locationId = employee?.location?.id

  // Load config
  useEffect(() => {
    if (!locationId) return
    fetch(`/api/settings/site-config?locationId=${locationId}&requestingEmployeeId=${employee?.id ?? ''}`)
      .then(res => res.json())
      .then(json => {
        const d = json.data || {}
        setConfig({
          siteEnabled: d.siteEnabled ?? DEFAULTS.siteEnabled,
          themePreset: d.themePreset ?? DEFAULTS.themePreset,
          brandColor: d.brandColor ?? DEFAULTS.brandColor,
          brandColorSecondary: d.brandColorSecondary ?? '',
          logoUrl: d.logoUrl ?? '',
          bannerUrl: d.bannerUrl ?? '',
          tagline: d.tagline ?? '',
          headingFont: d.headingFont ?? '',
          showHero: d.showHero ?? DEFAULTS.showHero,
          showAbout: d.showAbout ?? DEFAULTS.showAbout,
          showHours: d.showHours ?? DEFAULTS.showHours,
          showFeaturedItems: d.showFeaturedItems ?? DEFAULTS.showFeaturedItems,
          showReservations: d.showReservations ?? DEFAULTS.showReservations,
          showContact: d.showContact ?? DEFAULTS.showContact,
          showRewardsOnSite: d.showRewardsOnSite ?? DEFAULTS.showRewardsOnSite,
          showGiftCards: d.showGiftCards ?? DEFAULTS.showGiftCards,
          aboutText: d.aboutText ?? '',
          socialLinks: d.socialLinks ?? {},
          footerText: d.footerText ?? '',
          featuredItemSource: d.featuredItemSource ?? DEFAULTS.featuredItemSource,
          featuredItemIds: d.featuredItemIds ?? [],
          slug: d.slug ?? '',
        })
      })
      .catch(() => toast.error('Failed to load site config'))
      .finally(() => setIsLoading(false))
  }, [locationId])

  const handleSave = async () => {
    if (!locationId || isSaving) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/settings/site-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee?.id,
          settings: {
            siteEnabled: config.siteEnabled,
            themePreset: config.themePreset,
            brandColor: config.brandColor,
            brandColorSecondary: config.brandColorSecondary || undefined,
            logoUrl: config.logoUrl || undefined,
            bannerUrl: config.bannerUrl || undefined,
            tagline: config.tagline || undefined,
            headingFont: config.headingFont || undefined,
            showHero: config.showHero,
            showAbout: config.showAbout,
            showHours: config.showHours,
            showFeaturedItems: config.showFeaturedItems,
            showReservations: config.showReservations,
            showContact: config.showContact,
            showRewardsOnSite: config.showRewardsOnSite,
            showGiftCards: config.showGiftCards,
            aboutText: config.aboutText,
            socialLinks: config.socialLinks,
            footerText: config.footerText || undefined,
            featuredItemSource: config.featuredItemSource,
            featuredItemIds: config.featuredItemSource === 'manual' ? config.featuredItemIds : undefined,
          },
        }),
      })
      if (res.ok) {
        toast.success('Site configuration saved')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateField = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const updateSocialLink = (platform: string, value: string) => {
    setConfig(prev => ({
      ...prev,
      socialLinks: { ...prev.socialLinks, [platform]: value },
    }))
  }

  // Derive ordering URL
  const orderCode = config.slug
    ? (() => {
        const code = config.slug.replace(/-/g, '').toUpperCase()
        return code.length >= 4 ? code.substring(0, 8) : code.padEnd(4, 'X')
      })()
    : null
  const orderingUrl = orderCode && config.slug
    ? `${config.slug}.ordercontrolcenter.com`
    : null

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <AdminPageHeader
        title="Site Configuration"
        subtitle="Configure your customer-facing ordering website"
        breadcrumbs={[{ label: 'Online Ordering', href: '/settings/online-ordering' }]}
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* ── Site Status ─────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Site Status</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Control whether your ordering website is live
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                config.siteEnabled
                  ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-800'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}
            >
              {config.siteEnabled ? 'Live' : 'Offline'}
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-t border-gray-800">
            <span className="text-sm font-medium text-white">Enable Ordering Website</span>
            <Toggle
              checked={config.siteEnabled}
              onChange={(val) => updateField('siteEnabled', val)}
            />
          </div>

          {!config.siteEnabled && orderingUrl && (
            <div className="mt-3 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700">
              <p className="text-sm text-gray-400">
                Enable to let customers order at{' '}
                <span className="font-mono text-gray-300">{orderingUrl}</span>
              </p>
            </div>
          )}

          {config.siteEnabled && orderingUrl && (
            <div className="mt-3 px-3 py-2 bg-blue-900/20 rounded-lg border border-blue-800/40">
              <p className="text-sm text-blue-300">
                Your site is live at{' '}
                <span className="font-mono text-blue-200">{orderingUrl}</span>
              </p>
            </div>
          )}
        </div>

        {/* ── Theme ───────────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Theme</h2>

          {/* Preset selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">Preset</label>
            <div className="grid grid-cols-3 gap-3">
              {THEME_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => updateField('themePreset', preset.id)}
                  className={`rounded-lg border-2 p-3 text-left transition-all ${
                    config.themePreset === preset.id
                      ? 'border-blue-500 bg-blue-900/20'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                >
                  {/* Color preview */}
                  <div className="flex gap-1 mb-2">
                    {preset.colors.map((color, i) => (
                      <div
                        key={i}
                        className="h-6 flex-1 rounded"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <p className="text-sm font-medium text-white">{preset.name}</p>
                  <p className="text-xs text-gray-400">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Brand colors */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Brand Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.brandColor}
                  onChange={(e) => updateField('brandColor', e.target.value)}
                  className="h-9 w-12 rounded border border-gray-700 bg-gray-800 cursor-pointer"
                />
                <input
                  type="text"
                  value={config.brandColor}
                  onChange={(e) => updateField('brandColor', e.target.value)}
                  placeholder="#3B82F6"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.brandColorSecondary || '#1E293B'}
                  onChange={(e) => updateField('brandColorSecondary', e.target.value)}
                  className="h-9 w-12 rounded border border-gray-700 bg-gray-800 cursor-pointer"
                />
                <input
                  type="text"
                  value={config.brandColorSecondary || ''}
                  onChange={(e) => updateField('brandColorSecondary', e.target.value)}
                  placeholder="#1E293B"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Heading font */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Heading Font</label>
            <input
              type="text"
              value={config.headingFont || ''}
              onChange={(e) => updateField('headingFont', e.target.value)}
              placeholder="e.g. Playfair Display, Montserrat"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Google Font name (leave blank for default)</p>
          </div>
        </div>

        {/* ── Branding ────────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Branding</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Logo URL</label>
              <input
                type="text"
                value={config.logoUrl || ''}
                onChange={(e) => updateField('logoUrl', e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {config.logoUrl && (
                <div className="mt-2 p-2 bg-gray-800 rounded-lg border border-gray-700 inline-block">
                  <img
                    src={config.logoUrl}
                    alt="Logo preview"
                    className="h-10 object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Banner Image URL</label>
              <input
                type="text"
                value={config.bannerUrl || ''}
                onChange={(e) => updateField('bannerUrl', e.target.value)}
                placeholder="https://example.com/banner.jpg"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {config.bannerUrl && (
                <div className="mt-2 rounded-lg border border-gray-700 overflow-hidden">
                  <img
                    src={config.bannerUrl}
                    alt="Banner preview"
                    className="w-full h-24 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tagline</label>
              <input
                type="text"
                value={config.tagline || ''}
                onChange={(e) => updateField('tagline', e.target.value)}
                placeholder="Fresh food, fast service"
                maxLength={120}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* ── Sections ────────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Sections</h2>
          <p className="text-sm text-gray-400 mb-4">Show or hide sections on your ordering site</p>

          <div className="space-y-4">
            <SectionRow
              label="Hero Banner"
              description="Large banner image at the top of the page"
              checked={config.showHero}
              onChange={(val) => updateField('showHero', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="About Section"
              description="Tell customers about your venue"
              checked={config.showAbout}
              onChange={(val) => updateField('showAbout', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Hours"
              description="Display your operating hours"
              checked={config.showHours}
              onChange={(val) => updateField('showHours', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Featured Items"
              description="Highlight popular or selected menu items"
              checked={config.showFeaturedItems}
              onChange={(val) => updateField('showFeaturedItems', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Reservations"
              description="Show reservation booking widget"
              checked={config.showReservations}
              onChange={(val) => updateField('showReservations', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Contact Info"
              description="Display address, phone, and map"
              checked={config.showContact}
              onChange={(val) => updateField('showContact', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Rewards Program"
              description="Show rewards/loyalty info on site"
              checked={config.showRewardsOnSite}
              onChange={(val) => updateField('showRewardsOnSite', val)}
            />
            <div className="border-t border-gray-800" />
            <SectionRow
              label="Gift Cards"
              description="Allow customers to purchase gift cards"
              checked={config.showGiftCards}
              onChange={(val) => updateField('showGiftCards', val)}
            />
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Content</h2>

          <div className="space-y-5">
            {/* About text */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">About Text</label>
              <textarea
                value={config.aboutText}
                onChange={(e) => updateField('aboutText', e.target.value)}
                rows={4}
                placeholder="Tell your customers about your venue, your story, what makes you special..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Social links */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Social Links</label>
              <div className="space-y-3">
                {[
                  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourpage' },
                  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle' },
                  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
                  { key: 'yelp', label: 'Yelp', placeholder: 'https://yelp.com/biz/yourvenue' },
                  { key: 'google', label: 'Google', placeholder: 'https://g.page/yourvenue' },
                ].map(social => (
                  <div key={social.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-20 text-right shrink-0">{social.label}</span>
                    <input
                      type="text"
                      value={(config.socialLinks as Record<string, string | undefined>)[social.key] || ''}
                      onChange={(e) => updateSocialLink(social.key, e.target.value)}
                      placeholder={social.placeholder}
                      className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Footer text */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Footer Text</label>
              <input
                type="text"
                value={config.footerText || ''}
                onChange={(e) => updateField('footerText', e.target.value)}
                placeholder="Custom footer message (optional)"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* ── Featured Items ──────────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Featured Items</h2>

          <div className="space-y-3">
            {[
              { id: 'popular' as const, label: 'Most Popular', description: 'Automatically show best-selling items' },
              { id: 'first_n' as const, label: 'First Items', description: 'Show the first items from each category' },
              { id: 'manual' as const, label: 'Manual Selection', description: 'Choose specific items to feature' },
            ].map(option => (
              <label
                key={option.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  config.featuredItemSource === option.id
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="featuredItemSource"
                  value={option.id}
                  checked={config.featuredItemSource === option.id}
                  onChange={() => updateField('featuredItemSource', option.id)}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-white">{option.label}</p>
                  <p className="text-xs text-gray-400">{option.description}</p>
                </div>
              </label>
            ))}
          </div>

          {config.featuredItemSource === 'manual' && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Featured Item IDs</label>
              <input
                type="text"
                value={(config.featuredItemIds || []).join(', ')}
                onChange={(e) => updateField('featuredItemIds', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="Paste comma-separated item IDs"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Item picker coming soon. For now, paste menu item IDs.</p>
            </div>
          )}
        </div>

        {/* ── Save Button ─────────────────────────────────────────────────── */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
