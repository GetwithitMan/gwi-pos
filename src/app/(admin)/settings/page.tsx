'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import { formatCurrency, calculateCardPrice } from '@/lib/pricing'

export default function SettingsPage() {
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_SETTINGS)
  const [locationName, setLocationName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // For now, assume admin access. Later we'll check permissions.
  const isSuperAdmin = true // TODO: Get from auth context

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        setSettings(data.settings)
        setLocationName(data.locationName)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const saveSettings = async () => {
    setIsSaving(true)
    setSaveMessage('')

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (response.ok) {
        setSaveMessage('Settings saved successfully!')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage('Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      setSaveMessage('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateDualPricing = (updates: Partial<LocationSettings['dualPricing']>) => {
    setSettings(prev => ({
      ...prev,
      dualPricing: { ...prev.dualPricing, ...updates },
    }))
  }

  const updateTax = (updates: Partial<LocationSettings['tax']>) => {
    setSettings(prev => ({
      ...prev,
      tax: { ...prev.tax, ...updates },
    }))
  }

  const updateTips = (updates: Partial<LocationSettings['tips']>) => {
    setSettings(prev => ({
      ...prev,
      tips: { ...prev.tips, ...updates },
    }))
  }

  // Calculate example prices for display
  const exampleCashPrice = 10.00
  const exampleCardPrice = calculateCardPrice(exampleCashPrice, settings.dualPricing.cardSurchargePercent)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/orders" className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              <p className="text-sm text-gray-500">{locationName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                {saveMessage}
              </span>
            )}
            <Button variant="primary" onClick={saveSettings} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Dual Pricing Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Dual Pricing</h2>
              <p className="text-sm text-gray-500">Show different prices for cash vs card payments</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.dualPricing.enabled}
                onChange={(e) => updateDualPricing({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.dualPricing.enabled && (
            <div className="space-y-4 border-t pt-4">
              {/* Card Surcharge Percentage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Card Surcharge Percentage
                  {!isSuperAdmin && (
                    <span className="ml-2 text-xs text-orange-600">(Super Admin only)</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={settings.dualPricing.cardSurchargePercent}
                    onChange={(e) => updateDualPricing({ cardSurchargePercent: parseFloat(e.target.value) || 0 })}
                    disabled={!isSuperAdmin}
                    className={`w-24 px-3 py-2 border rounded-lg ${!isSuperAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                  />
                  <span className="text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Example: {formatCurrency(exampleCashPrice)} cash / {formatCurrency(exampleCardPrice)} card
                </p>
              </div>

              {/* Apply To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Apply Surcharge To
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.dualPricing.applyToCredit}
                      onChange={(e) => updateDualPricing({ applyToCredit: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Credit Cards</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.dualPricing.applyToDebit}
                      onChange={(e) => updateDualPricing({ applyToDebit: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Debit Cards</span>
                  </label>
                </div>
              </div>

              {/* Display Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display Options
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.dualPricing.showBothPrices}
                      onChange={(e) => updateDualPricing({ showBothPrices: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show both prices on POS menu</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.dualPricing.showSavingsMessage}
                      onChange={(e) => updateDualPricing({ showSavingsMessage: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show &quot;Save by paying cash&quot; message</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Tax Settings Section */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Tax Settings</h2>
            <p className="text-sm text-gray-500">Configure tax calculation</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Tax Rate
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  value={settings.tax.defaultRate}
                  onChange={(e) => updateTax({ defaultRate: parseFloat(e.target.value) || 0 })}
                  className="w-24 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">%</span>
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.tax.calculateAfterDiscount}
                onChange={(e) => updateTax({ calculateAfterDiscount: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Calculate tax after discounts</span>
            </label>
          </div>
        </Card>

        {/* Tip Settings Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Tip Settings</h2>
              <p className="text-sm text-gray-500">Configure tipping options</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.tips.enabled}
                onChange={(e) => updateTips({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.tips.enabled && (
            <div className="space-y-4 border-t pt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Suggested Tip Percentages
                </label>
                <div className="flex gap-2">
                  {settings.tips.suggestedPercentages.map((pct, idx) => (
                    <input
                      key={idx}
                      type="number"
                      value={pct}
                      onChange={(e) => {
                        const newPcts = [...settings.tips.suggestedPercentages]
                        newPcts[idx] = parseInt(e.target.value) || 0
                        updateTips({ suggestedPercentages: newPcts })
                      }}
                      className="w-16 px-2 py-2 border rounded-lg text-center"
                    />
                  ))}
                  <span className="text-gray-500 self-center">%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calculate Tip On
                </label>
                <select
                  value={settings.tips.calculateOn}
                  onChange={(e) => updateTips({ calculateOn: e.target.value as 'subtotal' | 'total' })}
                  className="px-3 py-2 border rounded-lg"
                >
                  <option value="subtotal">Subtotal (before tax)</option>
                  <option value="total">Total (after tax)</option>
                </select>
              </div>
            </div>
          )}
        </Card>

        {/* Quick Links */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Links</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              href="/menu"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-sm font-medium">Menu</span>
            </Link>
            <Link
              href="/modifiers"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span className="text-sm font-medium">Modifiers</span>
            </Link>
            <Link
              href="/orders"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-sm font-medium">Orders</span>
            </Link>
            <Link
              href="/reports/commission"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm font-medium">Commissions</span>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
