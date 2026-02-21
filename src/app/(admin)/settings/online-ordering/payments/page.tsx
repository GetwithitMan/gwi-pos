'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface OnlineOrderingSettings {
  tipSuggestions: number[]
  defaultTip: number | null
  requireZip: boolean
  allowGuestCheckout: boolean
  requireContactForPickup: boolean
}

const DEFAULTS: OnlineOrderingSettings = {
  tipSuggestions: [15, 18, 20],
  defaultTip: 18,
  requireZip: false,
  allowGuestCheckout: true,
  requireContactForPickup: false,
}

export default function PaymentsPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [settings, setSettings] = useState<OnlineOrderingSettings>(DEFAULTS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!employee?.location?.id) return
    fetch(`/api/settings/online-ordering?locationId=${employee.location.id}`)
      .then(res => res.json())
      .then(data => {
        const d = data.data || {}
        setSettings({
          tipSuggestions: d.tipSuggestions ?? DEFAULTS.tipSuggestions,
          defaultTip: d.defaultTip ?? DEFAULTS.defaultTip,
          requireZip: d.requireZip ?? DEFAULTS.requireZip,
          allowGuestCheckout: d.allowGuestCheckout ?? DEFAULTS.allowGuestCheckout,
          requireContactForPickup: d.requireContactForPickup ?? DEFAULTS.requireContactForPickup,
        })
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setIsLoading(false))
  }, [employee?.location?.id])

  const handleTipChange = (index: number, value: string) => {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 0 || num > 100) return
    const updated = [...settings.tipSuggestions]
    updated[index] = num
    setSettings(prev => ({ ...prev, tipSuggestions: updated }))
  }

  const handleDefaultTipChange = (value: number | null) => {
    setSettings(prev => ({ ...prev, defaultTip: value }))
  }

  const handleToggle = (field: keyof OnlineOrderingSettings) => {
    setSettings(prev => ({ ...prev, [field]: !prev[field] }))
  }

  const handleSave = async () => {
    if (!employee?.location?.id) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/settings/online-ordering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          employeeId: employee.id,
          settings: {
            onlineOrdering: {
              tipSuggestions: settings.tipSuggestions,
              defaultTip: settings.defaultTip,
              requireZip: settings.requireZip,
              allowGuestCheckout: settings.allowGuestCheckout,
              requireContactForPickup: settings.requireContactForPickup,
            },
          },
        }),
      })
      if (res.ok) {
        toast.success('Payment settings saved')
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
        title="Payments & Tips"
        subtitle="Configure tips and payment options for online orders"
        breadcrumbs={[{ label: 'Online Ordering', href: '/settings/online-ordering' }]}
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Tip Suggestions */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Tip Suggestions</h2>
          <p className="text-sm text-gray-400 mb-5">
            These percentages appear as quick-tap buttons on the customer checkout page.
          </p>

          <div className="space-y-4">
            {settings.tipSuggestions.map((tip, i) => (
              <div key={i} className="flex items-center gap-3">
                <label className="text-sm text-gray-300 w-24">Tip Option {i + 1}</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tip}
                    onChange={e => handleTipChange(i, e.target.value)}
                    className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <label className="text-sm text-gray-300 block mb-2">Default Selection</label>
            <div className="flex flex-wrap gap-2">
              {settings.tipSuggestions.map((tip, i) => (
                <button
                  key={i}
                  onClick={() => handleDefaultTipChange(tip)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.defaultTip === tip
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  {tip}%
                </button>
              ))}
              <button
                onClick={() => handleDefaultTipChange(null)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  settings.defaultTip === null
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                }`}
              >
                No default
              </button>
            </div>
          </div>
        </div>

        {/* Payment Options */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Payment Options</h2>

          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Require ZIP code for card payment</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Some payment processors require ZIP for card-not-present transactions
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.requireZip}
                onClick={() => handleToggle('requireZip')}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  settings.requireZip ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    settings.requireZip ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-gray-800" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Allow guest checkout (no account required)</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.allowGuestCheckout}
                onClick={() => handleToggle('allowGuestCheckout')}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  settings.allowGuestCheckout ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    settings.allowGuestCheckout ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-gray-800" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Require contact info for pickup orders</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Requires customers to provide phone or email when ordering takeout
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.requireContactForPickup}
                onClick={() => handleToggle('requireContactForPickup')}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  settings.requireContactForPickup ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    settings.requireContactForPickup ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Future Options */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800/50 p-6 opacity-60">
          <h2 className="text-lg font-semibold text-gray-400 mb-4">Future Options</h2>

          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-500">Allow pay-on-pickup (cash)</p>
                <span className="px-2 py-0.5 text-xs bg-gray-800 text-gray-500 rounded-full">Coming soon</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                Future feature — customers can choose to pay when they pick up
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={false}
              disabled
              className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-gray-800"
            >
              <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-gray-600 shadow-lg translate-x-0" />
            </button>
          </div>
        </div>

        {/* Save Button */}
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
