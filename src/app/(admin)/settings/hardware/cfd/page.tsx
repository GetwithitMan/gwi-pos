'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

interface CfdSettings {
  id: string | null
  locationId: string
  tipMode: string
  tipStyle: string
  tipOptions: string
  tipShowNoTip: boolean
  signatureEnabled: boolean
  signatureThresholdCents: number
  receiptEmailEnabled: boolean
  receiptSmsEnabled: boolean
  receiptPrintEnabled: boolean
  receiptTimeoutSeconds: number
  tabMode: string
  tabPreAuthAmountCents: number
  idlePromoEnabled: boolean
  idleWelcomeText: string | null
}

interface Terminal {
  id: string
  name: string
  category: string
  cfdTerminalId: string | null
  cfdIpAddress: string | null
  cfdConnectionMode: string | null
  cfdSerialNumber: string | null
  isPaired: boolean
  isOnline: boolean
}

interface FeaturedItem {
  id: string
  name: string
  categoryName: string
  price: number
  isFeaturedCfd: boolean
}

interface MenuItem {
  id: string
  name: string
  price: number
  isActive: boolean
  isFeaturedCfd: boolean
  category: { id: string; name: string }
}

export default function CfdSettingsPage() {
  const employee = useAuthStore((s) => s.employee)
  const locationId = employee?.location?.id

  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<CfdSettings | null>(null)
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [savingSettings, setSavingSettings] = useState(false)
  const [togglingItem, setTogglingItem] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const loadData = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoading(true)
      const [settingsRes, terminalsRes, menuRes] = await Promise.all([
        fetch(`/api/hardware/cfd-settings?locationId=${locationId}`),
        fetch(`/api/hardware/terminals?locationId=${locationId}`),
        fetch(`/api/menu?locationId=${locationId}`),
      ])

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        setSettings(settingsData.data?.settings || null)
      }

      if (terminalsRes.ok) {
        const terminalsData = await terminalsRes.json()
        const allTerminals: Terminal[] = terminalsData.data?.terminals || []
        // Show terminals that have CFD pairing info or are CFD_DISPLAY
        setTerminals(allTerminals.filter(
          (t: Terminal) => t.cfdTerminalId || t.category === 'CFD_DISPLAY'
        ))
      }

      if (menuRes.ok) {
        const menuData = await menuRes.json()
        const categories = menuData.data?.categories || []
        const rawItems = menuData.data?.items || []
        // Build category lookup
        const catMap = new Map<string, string>()
        for (const cat of categories) {
          catMap.set(cat.id, cat.name)
        }
        const items: MenuItem[] = rawItems.map((item: any) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          isActive: item.isActive,
          isFeaturedCfd: item.isFeaturedCfd || false,
          category: { id: item.categoryId, name: catMap.get(item.categoryId) || 'Unknown' },
        }))
        setMenuItems(items)
      }
    } catch (err) {
      console.error('Failed to load CFD data:', err)
      toast.error('Failed to load CFD settings')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSaveSettings = async () => {
    if (!settings || !locationId) return
    try {
      setSavingSettings(true)
      const res = await fetch('/api/hardware/cfd-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, locationId }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const data = await res.json()
      setSettings(data.data?.settings)
      toast.success('CFD settings saved')
    } catch {
      toast.error('Failed to save CFD settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleFeatured = async (itemId: string, currentValue: boolean) => {
    try {
      setTogglingItem(itemId)
      const res = await fetch(`/api/menu/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFeaturedCfd: !currentValue }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setMenuItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, isFeaturedCfd: !currentValue } : item
        )
      )
    } catch {
      toast.error('Failed to update featured status')
    } finally {
      setTogglingItem(null)
    }
  }

  const featuredItems = menuItems.filter((i) => i.isFeaturedCfd)
  const filteredItems = menuItems.filter(
    (i) =>
      i.isActive &&
      (searchQuery === '' ||
        i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.category.name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Customer-Facing Display"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Hardware', href: '/settings/hardware' },
          ]}
        />
        <div className="animate-pulse space-y-4 mt-6">
          <div className="h-32 bg-gray-100 rounded-lg" />
          <div className="h-64 bg-gray-100 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Customer-Facing Display"
        subtitle="Manage CFD connection, settings, and featured menu items"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
      />

      {/* CFD Terminals Section */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Paired CFD Devices</h2>
        {terminals.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            No CFD terminals paired yet. Pair a PAX A3700 from the{' '}
            <a href="/settings/hardware/terminals" className="text-blue-600 hover:underline">
              Terminals
            </a>{' '}
            page.
          </div>
        ) : (
          <div className="space-y-3">
            {terminals.map((t) => (
              <div
                key={t.id}
                className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-gray-900">{t.name}</div>
                  <div className="text-sm text-gray-500 space-x-3">
                    {t.cfdConnectionMode && (
                      <span>Mode: {t.cfdConnectionMode.toUpperCase()}</span>
                    )}
                    {t.cfdIpAddress && <span>IP: {t.cfdIpAddress}</span>}
                    {t.cfdSerialNumber && <span>S/N: {t.cfdSerialNumber}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      t.isOnline
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        t.isOnline ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    {t.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CFD Settings Section */}
      {settings && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Display Settings</h2>
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
            {/* Idle Screen */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Welcome Text
                </label>
                <input
                  type="text"
                  value={settings.idleWelcomeText || ''}
                  onChange={(e) =>
                    setSettings({ ...settings, idleWelcomeText: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Welcome!"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Idle Promos
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={settings.idlePromoEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, idlePromoEnabled: e.target.checked })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    Show featured items on idle screen
                  </span>
                </label>
              </div>
            </div>

            {/* Tip Configuration */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Tip Settings</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tip Mode
                  </label>
                  <select
                    value={settings.tipMode}
                    onChange={(e) => setSettings({ ...settings, tipMode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="pre_tap">Pre-Tap</option>
                    <option value="post_auth">Post-Auth</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tip Style
                  </label>
                  <select
                    value={settings.tipStyle}
                    onChange={(e) => setSettings({ ...settings, tipStyle: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="percent">Percentage</option>
                    <option value="dollar">Dollar Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tip Options
                  </label>
                  <input
                    type="text"
                    value={settings.tipOptions}
                    onChange={(e) => setSettings({ ...settings, tipOptions: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="18,20,22,25"
                  />
                  <p className="text-xs text-gray-400 mt-1">Comma-separated values</p>
                </div>
              </div>
              <label className="flex items-center gap-2 mt-3">
                <input
                  type="checkbox"
                  checked={settings.tipShowNoTip}
                  onChange={(e) =>
                    setSettings({ ...settings, tipShowNoTip: e.target.checked })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Show &quot;No Tip&quot; button</span>
              </label>
            </div>

            {/* Signature */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Signature</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.signatureEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, signatureEnabled: e.target.checked })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Require signature</span>
                </label>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Signature Threshold ($)
                  </label>
                  <input
                    type="number"
                    value={(settings.signatureThresholdCents / 100).toFixed(2)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        signatureThresholdCents: Math.round(
                          parseFloat(e.target.value || '0') * 100
                        ),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
            </div>

            {/* Receipt Options */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Receipt Delivery</h3>
              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.receiptEmailEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, receiptEmailEnabled: e.target.checked })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Email</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.receiptSmsEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, receiptSmsEnabled: e.target.checked })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">SMS</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.receiptPrintEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, receiptPrintEnabled: e.target.checked })
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Print</span>
                </label>
              </div>
              <div className="mt-3 w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timeout (seconds)
                </label>
                <input
                  type="number"
                  value={settings.receiptTimeoutSeconds}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      receiptTimeoutSeconds: parseInt(e.target.value || '30', 10),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  min="5"
                  max="300"
                />
              </div>
            </div>

            {/* Save Button */}
            <div className="border-t pt-4 flex justify-end">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Featured Items Section */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Featured Items</h2>
        <p className="text-sm text-gray-500 mb-4">
          Select menu items to promote on the CFD idle screen. Currently{' '}
          <strong>{featuredItems.length}</strong> item{featuredItems.length !== 1 ? 's' : ''}{' '}
          featured.
        </p>

        {/* Currently Featured */}
        {featuredItems.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {featuredItems.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-sm px-3 py-1.5 rounded-full border border-blue-200"
                >
                  {item.name}
                  <button
                    onClick={() => toggleFeatured(item.id, true)}
                    disabled={togglingItem === item.id}
                    className="hover:bg-blue-200 rounded-full p-0.5"
                    title="Remove from featured"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Search and Item List */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="p-3 border-b">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search menu items..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {filteredItems.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                No menu items found
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.isFeaturedCfd}
                      onChange={() => toggleFeatured(item.id, item.isFeaturedCfd)}
                      disabled={togglingItem === item.id}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">{item.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{item.category.name}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">${item.price.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
