'use client'

import { useState, useEffect } from 'react'
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

export default function OrderConfigPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [settings, setSettings] = useState<OnlineOrderingSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [prepTime, setPrepTime] = useState(20)
  const [orderTypes, setOrderTypes] = useState<string[]>(['takeout'])
  const [allowSpecialRequests, setAllowSpecialRequests] = useState(true)
  const [maxOrdersPerWindow, setMaxOrdersPerWindow] = useState<string>('')
  const [windowMinutes, setWindowMinutes] = useState(15)
  const [surchargeType, setSurchargeType] = useState<string>('none')
  const [surchargeAmount, setSurchargeAmount] = useState<string>('0')
  const [surchargeName, setSurchargeName] = useState('Online Surcharge')
  const [minOrderAmount, setMinOrderAmount] = useState<string>('')
  const [maxOrderAmount, setMaxOrderAmount] = useState<string>('')

  const locationId = employee?.location?.id

  useEffect(() => {
    if (!locationId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/settings/online-ordering?locationId=${locationId}`)
        if (res.ok) {
          const json = await res.json()
          const data = json.data as OnlineOrderingSettings
          setSettings(data)
          setPrepTime(data.prepTime)
          setOrderTypes(data.orderTypes)
          setAllowSpecialRequests(data.allowSpecialRequests)
          setMaxOrdersPerWindow(data.maxOrdersPerWindow != null ? String(data.maxOrdersPerWindow) : '')
          setWindowMinutes(data.windowMinutes)
          setSurchargeType(data.surchargeType || 'none')
          setSurchargeAmount(String(data.surchargeAmount))
          setSurchargeName(data.surchargeName)
          setMinOrderAmount(data.minOrderAmount != null ? String(data.minOrderAmount) : '')
          setMaxOrderAmount(data.maxOrderAmount != null ? String(data.maxOrderAmount) : '')
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [locationId])

  const handleOrderTypeToggle = (type: string) => {
    setOrderTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  const handleSave = async () => {
    if (!locationId || saving) return
    setSaving(true)
    try {
      const payload = {
        locationId,
        employeeId: employee?.id,
        settings: {
          onlineOrdering: {
            prepTime,
            orderTypes,
            allowSpecialRequests,
            maxOrdersPerWindow: maxOrdersPerWindow ? Number(maxOrdersPerWindow) : null,
            windowMinutes,
            surchargeType: surchargeType === 'none' ? null : surchargeType,
            surchargeAmount: Number(surchargeAmount) || 0,
            surchargeName,
            minOrderAmount: minOrderAmount ? Number(minOrderAmount) : null,
            maxOrderAmount: maxOrderAmount ? Number(maxOrderAmount) : null,
          },
        },
      }
      const res = await fetch('/api/settings/online-ordering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const json = await res.json()
        setSettings(prev => prev ? { ...prev, ...json.data } : prev)
        toast.success('Order settings saved')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
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
        title="Order Config"
        subtitle="Configure how online orders are handled"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Online Ordering', href: '/settings/online-ordering' },
        ]}
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Order Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Settings</h2>

          {/* Prep Time */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prep Time
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={prepTime}
                onChange={(e) => setPrepTime(Math.max(1, Math.min(120, Number(e.target.value))))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
              <span className="text-sm text-gray-500">minutes</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Approximate time to prepare an order</p>
          </div>

          {/* Order Types */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Order Types
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={orderTypes.includes('takeout')}
                  onChange={() => handleOrderTypeToggle('takeout')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Takeout</span>
              </label>
              <label className="flex items-center gap-3 opacity-50 cursor-not-allowed">
                <input
                  type="checkbox"
                  disabled
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-500">Delivery</span>
                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded font-medium">
                  Coming soon
                </span>
              </label>
              <label className="flex items-center gap-3 opacity-50 cursor-not-allowed">
                <input
                  type="checkbox"
                  disabled
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-500">Dine-in QR</span>
                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded font-medium">
                  Coming soon
                </span>
              </label>
            </div>
          </div>

          {/* Special Requests */}
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <div>
              <span className="text-sm font-medium text-gray-700">Allow Special Requests</span>
              <p className="text-xs text-gray-400">Let customers add notes to their order</p>
            </div>
            <button
              onClick={() => setAllowSpecialRequests(!allowSpecialRequests)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                allowSpecialRequests ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  allowSpecialRequests ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Throttling */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Throttling</h2>
          <p className="text-sm text-gray-500 mb-4">
            Limit the number of orders accepted in a time window. Leave blank to accept unlimited orders.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700">Max</span>
            <input
              type="number"
              min={1}
              value={maxOrdersPerWindow}
              onChange={(e) => setMaxOrdersPerWindow(e.target.value)}
              placeholder="Unlimited"
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <span className="text-sm text-gray-700">orders per</span>
            <select
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>
        </div>

        {/* Online Surcharge */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Online Surcharge</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Surcharge Name
            </label>
            <input
              type="text"
              value={surchargeName}
              onChange={(e) => setSurchargeName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={surchargeType}
                onChange={(e) => setSurchargeType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="none">None</option>
                <option value="flat">Flat ($)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            {surchargeType !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount {surchargeType === 'flat' ? '($)' : '(%)'}
                </label>
                <input
                  type="number"
                  min={0}
                  step={surchargeType === 'flat' ? '0.01' : '0.1'}
                  value={surchargeAmount}
                  onChange={(e) => setSurchargeAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
            )}
          </div>
        </div>

        {/* Order Limits */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Limits</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Order Amount ($)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder="No minimum"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Order Amount ($)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={maxOrderAmount}
                onChange={(e) => setMaxOrderAmount(e.target.value)}
                placeholder="No maximum"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-6 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors ${
              saving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
