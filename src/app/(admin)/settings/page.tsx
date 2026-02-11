'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import { formatCurrency, calculateCashPrice } from '@/lib/pricing'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { HardwareHealthWidget } from '@/components/hardware/HardwareHealthWidget'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

export default function SettingsPage() {
  const { employee } = useAuthStore()
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_SETTINGS)
  const [locationName, setLocationName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // Hardware health data
  const [terminals, setTerminals] = useState<any[]>([])
  const [printers, setPrinters] = useState<any[]>([])
  const [kdsScreens, setKdsScreens] = useState<any[]>([])

  // Check if user has admin/settings permissions
  const isSuperAdmin = employee?.role?.name === 'Owner' ||
    employee?.role?.name === 'Admin' ||
    hasPermission(employee?.permissions || [], PERMISSIONS.ADMIN)

  const loadHardwareStatus = useCallback(async () => {
    try {
      const [terminalsRes, printersRes, kdsRes] = await Promise.all([
        fetch('/api/hardware/terminals?locationId=loc-1'),
        fetch('/api/hardware/printers?locationId=loc-1'),
        fetch('/api/hardware/kds-screens?locationId=loc-1'),
      ])

      if (terminalsRes.ok) {
        const data = await terminalsRes.json()
        setTerminals(data.terminals || [])
      }
      if (printersRes.ok) {
        const data = await printersRes.json()
        setPrinters(data.printers || [])
      }
      if (kdsRes.ok) {
        const data = await kdsRes.json()
        setKdsScreens(data.screens || [])
      }
    } catch (error) {
      console.error('Failed to load hardware status:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadHardwareStatus()
    // Refresh hardware status every 30 seconds
    const interval = setInterval(loadHardwareStatus, 30000)
    return () => clearInterval(interval)
  }, [loadHardwareStatus])

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

  const updatePriceRounding = (updates: Partial<LocationSettings['priceRounding']>) => {
    setSettings(prev => ({
      ...prev,
      priceRounding: { ...prev.priceRounding, ...updates },
    }))
  }

  const updateTips = (updates: Partial<LocationSettings['tips']>) => {
    setSettings(prev => ({
      ...prev,
      tips: { ...prev.tips, ...updates },
    }))
  }

  const updatePayments = (updates: Partial<LocationSettings['payments']>) => {
    setSettings(prev => ({
      ...prev,
      payments: { ...prev.payments, ...updates },
    }))
  }

  const updateLoyalty = (updates: Partial<LocationSettings['loyalty']>) => {
    setSettings(prev => ({
      ...prev,
      loyalty: { ...prev.loyalty, ...updates },
    }))
  }

  const updateBusinessDay = (updates: Partial<LocationSettings['businessDay']>) => {
    setSettings(prev => ({
      ...prev,
      businessDay: { ...prev.businessDay, ...updates },
    }))
  }

  // Calculate example prices for display
  // Cash price is what you enter, card price is calculated (adds the fee)
  const exampleCashPrice = 10.00
  const discountPercent = settings.dualPricing.cashDiscountPercent || 4.0
  const exampleCardPrice = Math.round(exampleCashPrice * (1 + discountPercent / 100) * 100) / 100

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Settings"
        subtitle={locationName}
        actions={
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
        }
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Cash Discount Program Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Cash Discount Program</h2>
              <p className="text-sm text-gray-500">Card price is the default - cash customers receive a discount</p>
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
              {/* Cash Discount Percentage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cash Discount Percentage
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
                    value={settings.dualPricing.cashDiscountPercent || 4.0}
                    onChange={(e) => updateDualPricing({ cashDiscountPercent: parseFloat(e.target.value) || 0 })}
                    disabled={!isSuperAdmin}
                    className={`w-24 px-3 py-2 border rounded-lg ${!isSuperAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                  />
                  <span className="text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  You enter: {formatCurrency(exampleCashPrice)} → Card price: {formatCurrency(exampleCardPrice)} (displayed) → Cash discount: -{formatCurrency(exampleCardPrice - exampleCashPrice)}
                </p>
              </div>

              {/* Card Types */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Card Types (full price)
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
                <p className="text-xs text-gray-500 mt-1">
                  Checked = pays full card price. Unchecked = receives cash discount.
                </p>
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
                      checked={settings.dualPricing.showSavingsMessage}
                      onChange={(e) => updateDualPricing({ showSavingsMessage: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show &quot;Save by paying cash&quot; message at checkout</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Price Rounding Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Price Rounding</h2>
              <p className="text-sm text-gray-500">Round totals for easier cash handling</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.priceRounding?.enabled || false}
                onChange={(e) => updatePriceRounding({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.priceRounding?.enabled && (
            <div className="space-y-4 border-t pt-4">
              {/* Rounding Increment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Round to nearest
                </label>
                <select
                  value={settings.priceRounding.increment}
                  onChange={(e) => updatePriceRounding({ increment: e.target.value as LocationSettings['priceRounding']['increment'] })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="none">No rounding</option>
                  <option value="0.05">$0.05 (nickel)</option>
                  <option value="0.10">$0.10 (dime)</option>
                  <option value="0.25">$0.25 (quarter)</option>
                  <option value="0.50">$0.50 (half dollar)</option>
                  <option value="1.00">$1.00 (dollar)</option>
                </select>
              </div>

              {/* Rounding Direction */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rounding direction
                </label>
                <div className="flex gap-4">
                  {(['nearest', 'up', 'down'] as const).map(dir => (
                    <label key={dir} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="roundingDirection"
                        checked={settings.priceRounding.direction === dir}
                        onChange={() => updatePriceRounding({ direction: dir })}
                        className="text-blue-600"
                      />
                      <span className="text-sm capitalize">{dir}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Apply To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Apply rounding to
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.priceRounding.applyToCash}
                      onChange={(e) => updatePriceRounding({ applyToCash: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Cash payments</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.priceRounding.applyToCard}
                      onChange={(e) => updatePriceRounding({ applyToCard: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Card payments</span>
                  </label>
                </div>
              </div>

              {/* Example */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  Example: $16.47 → {formatCurrency(
                    settings.priceRounding.increment === 'none'
                      ? 16.47
                      : settings.priceRounding.direction === 'up'
                        ? Math.ceil(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                        : settings.priceRounding.direction === 'down'
                          ? Math.floor(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                          : Math.round(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                  )}
                </p>
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

        {/* Bar Tab / Pre-Auth Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Bar Tab / Pre-Auth</h2>
              <p className="text-sm text-gray-500">Configure auto-increment and hold amounts for bar tabs</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.payments.autoIncrementEnabled}
                onChange={(e) => updatePayments({ autoIncrementEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="space-y-4 border-t pt-4">
            {/* Tip Buffer */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tip Buffer on Hold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="50"
                  value={settings.payments.incrementTipBufferPercent ?? 25}
                  onChange={(e) => updatePayments({ incrementTipBufferPercent: parseInt(e.target.value) || 0 })}
                  className="w-20 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Extra % added to hold to cover potential tip. Set to 0 to hold exact tab total only.
              </p>
              {(settings.payments.incrementTipBufferPercent ?? 25) > 0 && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                  Example: $50.00 tab → ${(50 * (1 + (settings.payments.incrementTipBufferPercent ?? 25) / 100)).toFixed(2)} hold
                  (covers up to {settings.payments.incrementTipBufferPercent ?? 25}% tip)
                </div>
              )}
            </div>

            {settings.payments.autoIncrementEnabled && (
              <>
                {/* Auto-Increment Threshold */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Auto-Increment Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="5"
                      min="50"
                      max="100"
                      value={settings.payments.incrementThresholdPercent}
                      onChange={(e) => updatePayments({ incrementThresholdPercent: parseInt(e.target.value) || 80 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Automatically re-auth when tab reaches this % of the current hold
                  </p>
                </div>

                {/* Minimum Increment Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum Auto-Increment
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      step="5"
                      min="5"
                      max="200"
                      value={settings.payments.incrementAmount}
                      onChange={(e) => updatePayments({ incrementAmount: parseInt(e.target.value) || 25 })}
                      className="w-24 px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum amount for background auto-increments (avoids frequent small auths)
                  </p>
                </div>
              </>
            )}

            {/* Max Tab Alert */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Manager Alert Amount
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  step="50"
                  min="0"
                  max="5000"
                  value={settings.payments.maxTabAlertAmount}
                  onChange={(e) => updatePayments({ maxTabAlertAmount: parseInt(e.target.value) || 500 })}
                  className="w-28 px-3 py-2 border rounded-lg"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Alert manager when a tab exceeds this amount
              </p>
            </div>
          </div>
        </Card>

        {/* Loyalty Program Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Loyalty Program</h2>
              <p className="text-sm text-gray-500">Reward customers with points</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.loyalty.enabled}
                onChange={(e) => updateLoyalty({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.loyalty.enabled && (
            <div className="space-y-6 border-t pt-4">
              {/* Points Earning */}
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Points Earning</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Points per $1 spent:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={settings.loyalty.pointsPerDollar}
                      onChange={(e) => updateLoyalty({ pointsPerDollar: parseFloat(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Minimum order to earn:</label>
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={settings.loyalty.minimumEarnAmount}
                      onChange={(e) => updateLoyalty({ minimumEarnAmount: parseFloat(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.earnOnSubtotal}
                      onChange={(e) => updateLoyalty({ earnOnSubtotal: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Earn on subtotal (before tax)</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.earnOnTips}
                      onChange={(e) => updateLoyalty({ earnOnTips: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Include tips in earning calculation</span>
                  </label>

                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Welcome bonus:</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={settings.loyalty.welcomeBonus}
                      onChange={(e) => updateLoyalty({ welcomeBonus: parseInt(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-sm text-gray-500">points for new customers</span>
                  </div>
                </div>
              </div>

              {/* Points Redemption */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900">Points Redemption</h3>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.redemptionEnabled}
                      onChange={(e) => updateLoyalty({ redemptionEnabled: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Allow redemption</span>
                  </label>
                </div>

                {settings.loyalty.redemptionEnabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Points per $1 value:</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={settings.loyalty.pointsPerDollarRedemption}
                        onChange={(e) => updateLoyalty({ pointsPerDollarRedemption: parseInt(e.target.value) || 100 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">points = $1</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Minimum to redeem:</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={settings.loyalty.minimumRedemptionPoints}
                        onChange={(e) => updateLoyalty({ minimumRedemptionPoints: parseInt(e.target.value) || 0 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">points</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Max % of order:</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={settings.loyalty.maximumRedemptionPercent}
                        onChange={(e) => updateLoyalty({ maximumRedemptionPercent: parseInt(e.target.value) || 50 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>

                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                      Example: {settings.loyalty.pointsPerDollarRedemption} points = $1.00 discount
                    </div>
                  </div>
                )}
              </div>

              {/* Display Options */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.loyalty.showPointsOnReceipt}
                  onChange={(e) => updateLoyalty({ showPointsOnReceipt: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Show loyalty points on receipt</span>
              </label>
            </div>
          )}
        </Card>

        {/* Happy Hour — full settings at /settings/happy-hour */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Happy Hour / Time-Based Pricing</h2>
              <p className="text-sm text-gray-500 mt-1">
                {settings.happyHour.enabled
                  ? `${settings.happyHour.name} is active — ${settings.happyHour.discountType === 'percent' ? `${settings.happyHour.discountValue}% off` : formatCurrency(settings.happyHour.discountValue) + ' off'}`
                  : 'Not currently active'}
              </p>
            </div>
            <Link href="/settings/happy-hour">
              <Button variant="outline">Configure</Button>
            </Link>
          </div>
        </Card>

        {/* Business Day Boundary */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Business Day Boundary</h2>
            <p className="text-sm text-gray-500">
              Define when a business day starts for reports, shifts, and daily batches.
              Orders after midnight but before this time count toward the previous business day.
            </p>
          </div>

          <div className="space-y-4">
            {/* Day Start Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Day Start Time
              </label>
              <input
                type="time"
                value={settings.businessDay?.dayStartTime || '04:00'}
                onChange={(e) => updateBusinessDay({ dayStartTime: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Business day starts at this time. Example: 4:00 AM means a 1:30 AM order on Feb 11 counts as Feb 10.
              </p>
            </div>

            {/* Enforce Clock-Out */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Enforce Clock-Out at Day Boundary</span>
                <p className="text-xs text-gray-500">Force employees to clock out when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.enforceClockOut ?? true}
                  onChange={(e) => updateBusinessDay({ enforceClockOut: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Enforce Tab Close */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Enforce Tab Close at Day Boundary</span>
                <p className="text-xs text-gray-500">Force open tabs to close when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.enforceTabClose ?? true}
                  onChange={(e) => updateBusinessDay({ enforceTabClose: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Batch at Day End */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Run Daily Batch at Day End</span>
                <p className="text-xs text-gray-500">Automatically run daily batch processing when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.batchAtDayEnd ?? true}
                  onChange={(e) => updateBusinessDay({ batchAtDayEnd: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Grace Period */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grace Period (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="5"
                  min="0"
                  max="60"
                  value={settings.businessDay?.graceMinutes ?? 15}
                  onChange={(e) => updateBusinessDay({ graceMinutes: parseInt(e.target.value) || 0 })}
                  className="w-20 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">minutes</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Extra time after the day boundary before enforcement kicks in
              </p>
            </div>

            {/* Example */}
            <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              Business day runs from{' '}
              <span className="font-semibold">{settings.businessDay?.dayStartTime || '04:00'}</span>
              {' '}to{' '}
              <span className="font-semibold">{settings.businessDay?.dayStartTime || '04:00'}</span>
              {' '}next day. Orders at 2:00 AM count toward the previous business day.
            </div>
          </div>
        </Card>

        {/* Hardware Health Status */}
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <HardwareHealthWidget
            terminals={terminals}
            printers={printers}
            kdsScreens={kdsScreens}
          />
        </div>

        {/* Quick Links */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Links</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              href="/settings/hardware"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span className="text-sm font-medium">Hardware</span>
            </Link>
            <Link
              href="/settings/order-types"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span className="text-sm font-medium">Order Types</span>
            </Link>
            <Link
              href="/settings/tip-outs"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Tip-Outs</span>
            </Link>
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
