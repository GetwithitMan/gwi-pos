'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { toast } from '@/stores/toast-store'
import type { DeliverySettings } from '@/lib/settings'
import { DEFAULT_DELIVERY } from '@/lib/settings'
import Link from 'next/link'

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliverySettingsPage() {
  const { employee } = useRequireAuth()
  const deliveryEnabled = useDeliveryFeature()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [delivery, setDelivery] = useState<DeliverySettings>(DEFAULT_DELIVERY)

  useUnsavedWarning(isDirty)

  // ─── Load ──────────────────────────────────────────────────────────

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setDelivery({
          ...DEFAULT_DELIVERY,
          ...(data.settings.delivery || {}),
        })
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load delivery settings')
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

  // ─── Save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ delivery }, employee?.id)
      setDelivery({
        ...DEFAULT_DELIVERY,
        ...(data.settings.delivery || {}),
      })
      setIsDirty(false)
      toast.success('Delivery settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  function update<K extends keyof DeliverySettings>(key: K, value: DeliverySettings[K]) {
    setDelivery(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateSmsTemplate(key: string, value: string) {
    setDelivery(prev => ({
      ...prev,
      smsTemplates: { ...prev.smsTemplates, [key]: value },
    }))
    setIsDirty(true)
  }

  function addPeakHour() {
    setDelivery(prev => ({
      ...prev,
      peakHours: [...prev.peakHours, { start: '11:00', end: '14:00' }],
    }))
    setIsDirty(true)
  }

  function removePeakHour(index: number) {
    setDelivery(prev => ({
      ...prev,
      peakHours: prev.peakHours.filter((_, i) => i !== index),
    }))
    setIsDirty(true)
  }

  function updatePeakHour(index: number, field: 'start' | 'end', value: string) {
    setDelivery(prev => ({
      ...prev,
      peakHours: prev.peakHours.map((ph, i) => i === index ? { ...ph, [field]: value } : ph),
    }))
    setIsDirty(true)
  }

  // ─── Render guards ────────────────────────────────────────────────

  if (!deliveryEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Delivery Module Not Enabled</h2>
          <p className="text-gray-600 text-sm">
            Enable the delivery module from Mission Control to configure delivery settings.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Delivery Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-600 text-lg">Loading settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Delivery Settings"
        subtitle="Configure in-house delivery operations"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                isDirty
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Basic Settings
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Basic Settings</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Delivery Enabled"
              description="Master toggle for in-house delivery operations"
              checked={delivery.enabled}
              onChange={v => update('enabled', v)}
            />
            <NumberRow
              label="Delivery Fee"
              description="Fixed delivery fee charged to customers"
              value={delivery.deliveryFee}
              onChange={v => update('deliveryFee', v)}
              prefix="$"
              min={0}
              step={0.5}
            />
            <NumberRow
              label="Free Delivery Minimum"
              description="Order subtotal for free delivery (0 = never free)"
              value={delivery.freeDeliveryMinimum}
              onChange={v => update('freeDeliveryMinimum', v)}
              prefix="$"
              min={0}
              step={1}
            />
            <NumberRow
              label="Max Delivery Radius"
              description="Maximum delivery distance in miles"
              value={delivery.maxDeliveryRadius}
              onChange={v => update('maxDeliveryRadius', v)}
              suffix="miles"
              min={1}
              max={50}
              step={0.5}
            />
            <NumberRow
              label="Estimated Delivery Minutes"
              description="Default estimated delivery time shown to customers"
              value={delivery.estimatedDeliveryMinutes}
              onChange={v => update('estimatedDeliveryMinutes', v)}
              suffix="min"
              min={10}
              max={180}
              step={5}
            />
            <NumberRow
              label="Max Active Deliveries"
              description="Maximum concurrent delivery orders allowed"
              value={delivery.maxActiveDeliveries}
              onChange={v => update('maxActiveDeliveries', v)}
              min={1}
              max={100}
              step={1}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Fee Mode
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Fee Mode</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-900">Fee Calculation</div>
                <div className="text-xs text-gray-600">How delivery fees are determined</div>
              </div>
              <select
                value={delivery.feeMode}
                onChange={e => update('feeMode', e.target.value as 'flat' | 'zone_based')}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="flat">Flat Rate</option>
                <option value="zone_based">Zone-Based</option>
              </select>
            </div>
            {delivery.feeMode === 'zone_based' && (
              <div className="text-xs text-blue-600 bg-blue-50 rounded-lg p-2.5">
                Zone-based fees are configured per zone. Go to{' '}
                <Link href="/settings/delivery/zones" className="underline font-medium">Zone Management</Link>{' '}
                to set zone-specific fees.
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Location Coordinates
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Location Coordinates</h2>
          <p className="text-xs text-gray-600 mb-4">Used as the center for zone calculations and map display</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input
                type="number"
                value={delivery.locationCoordinates?.lat ?? ''}
                onChange={e => {
                  const lat = parseFloat(e.target.value) || 0
                  update('locationCoordinates', {
                    lat,
                    lng: delivery.locationCoordinates?.lng ?? 0,
                  })
                }}
                step="0.0001"
                placeholder="40.7128"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input
                type="number"
                value={delivery.locationCoordinates?.lng ?? ''}
                onChange={e => {
                  const lng = parseFloat(e.target.value) || 0
                  update('locationCoordinates', {
                    lat: delivery.locationCoordinates?.lat ?? 0,
                    lng,
                  })
                }}
                step="0.0001"
                placeholder="-74.0060"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Customer Requirements
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Customer Requirements</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Require Phone Number"
              description="Customers must provide a phone number for delivery orders"
              checked={delivery.requirePhone}
              onChange={v => update('requirePhone', v)}
            />
            <ToggleRow
              label="Require Full Address"
              description="Customers must provide a complete delivery address"
              checked={delivery.requireAddress}
              onChange={v => update('requireAddress', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Notifications (SMS)
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Notifications</h2>
          <div className="space-y-4">
            <ToggleRow
              label="SMS Notifications"
              description="Send SMS updates to customers about their delivery"
              checked={delivery.smsNotificationsEnabled}
              onChange={v => update('smsNotificationsEnabled', v)}
            />
            {delivery.smsNotificationsEnabled && (
              <>
                <div className="border-t border-gray-100 pt-3">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">SMS Templates</h3>
                  <div className="space-y-3">
                    {Object.entries(delivery.smsTemplates).map(([key, template]) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-500 mb-1 capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </label>
                        <textarea
                          value={template}
                          onChange={e => updateSmsTemplate(key, e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="Message template..."
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Variables: {'{orderNumber}'}, {'{venue}'}, {'{eta}'}, {'{trackingUrl}'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-3">
                  <NumberRow
                    label="Max Retries"
                    description="SMS delivery retry attempts"
                    value={delivery.smsMaxRetries}
                    onChange={v => update('smsMaxRetries', v)}
                    min={0}
                    max={5}
                  />
                  <NumberRow
                    label="Retry After"
                    description="Seconds between retry attempts"
                    value={delivery.smsRetryAfterSeconds}
                    onChange={v => update('smsRetryAfterSeconds', v)}
                    suffix="sec"
                    min={10}
                    max={300}
                    step={10}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Customer Tracking
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Customer Tracking</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Enable Customer Tracking"
              description="Allow customers to track their delivery in real time"
              checked={delivery.customerTrackingEnabled}
              onChange={v => update('customerTrackingEnabled', v)}
            />
            {delivery.customerTrackingEnabled && (
              <>
                <ToggleRow
                  label="Share Driver Info"
                  description="Show driver name and vehicle info to customers"
                  checked={delivery.shareDriverInfo}
                  onChange={v => update('shareDriverInfo', v)}
                  border
                />
                <ToggleRow
                  label="Hide Until Nearby"
                  description="Only show driver location when within threshold distance"
                  checked={delivery.hideDriverLocationUntilNearby}
                  onChange={v => update('hideDriverLocationUntilNearby', v)}
                  border
                />
                {delivery.hideDriverLocationUntilNearby && (
                  <NumberRow
                    label="Nearby Threshold"
                    description="Distance at which driver location becomes visible"
                    value={delivery.nearbyThresholdMeters}
                    onChange={v => update('nearbyThresholdMeters', v)}
                    suffix="meters"
                    min={100}
                    max={5000}
                    step={100}
                  />
                )}
              </>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Proof of Delivery
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Proof of Delivery</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-900">Proof Mode</div>
              <div className="text-xs text-gray-600">What proof is required when marking an order as delivered</div>
            </div>
            <select
              value={delivery.proofOfDeliveryMode}
              onChange={e => update('proofOfDeliveryMode', e.target.value as DeliverySettings['proofOfDeliveryMode'])}
              className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="none">None</option>
              <option value="photo">Photo</option>
              <option value="signature">Signature</option>
              <option value="photo_and_signature">Photo + Signature</option>
            </select>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Scheduled Orders
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Scheduled Orders</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Deferred Orders"
              description="Allow customers to schedule delivery orders in advance"
              checked={delivery.deferredOrdersEnabled}
              onChange={v => update('deferredOrdersEnabled', v)}
            />
            {delivery.deferredOrdersEnabled && (
              <NumberRow
                label="Max Days Ahead"
                description="How far in advance customers can schedule"
                value={delivery.maxDeferredDaysAhead}
                onChange={v => update('maxDeferredDaysAhead', v)}
                suffix="days"
                min={1}
                max={30}
              />
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Driver Tips
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Driver Tips</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-900">Tip Distribution Mode</div>
                <div className="text-xs text-gray-600">How delivery tips are distributed</div>
              </div>
              <select
                value={delivery.driverTipMode}
                onChange={e => update('driverTipMode', e.target.value as DeliverySettings['driverTipMode'])}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="driver_keeps_100">Driver Keeps 100%</option>
                <option value="pool_with_kitchen">Pool with Kitchen</option>
                <option value="custom_split">Custom Split</option>
              </select>
            </div>
            {delivery.driverTipMode === 'custom_split' && (
              <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-3">
                <NumberRow
                  label="Driver Split"
                  description="Percentage going to driver"
                  value={delivery.driverTipSplitPercent}
                  onChange={v => {
                    update('driverTipSplitPercent', v)
                    setDelivery(prev => ({ ...prev, kitchenTipSplitPercent: 100 - v }))
                    setIsDirty(true)
                  }}
                  suffix="%"
                  min={0}
                  max={100}
                />
                <NumberRow
                  label="Kitchen Split"
                  description="Percentage going to kitchen"
                  value={delivery.kitchenTipSplitPercent}
                  onChange={v => {
                    update('kitchenTipSplitPercent', v)
                    setDelivery(prev => ({ ...prev, driverTipSplitPercent: 100 - v }))
                    setIsDirty(true)
                  }}
                  suffix="%"
                  min={0}
                  max={100}
                />
              </div>
            )}
            <div className="border-t border-gray-100 pt-3 space-y-3">
              <ToggleRow
                label="Auto-Gratuity"
                description="Automatically add gratuity to delivery orders"
                checked={delivery.deliveryAutoGratuityEnabled}
                onChange={v => update('deliveryAutoGratuityEnabled', v)}
              />
              {delivery.deliveryAutoGratuityEnabled && (
                <NumberRow
                  label="Auto-Gratuity Percent"
                  description="Default gratuity percentage added to delivery orders"
                  value={delivery.deliveryAutoGratuityPercent}
                  onChange={v => update('deliveryAutoGratuityPercent', v)}
                  suffix="%"
                  min={0}
                  max={30}
                  step={0.5}
                />
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Peak Hours
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Peak Hours</h2>
          <p className="text-xs text-gray-600 mb-4">Define peak delivery periods (affects driver limits and dispatch priority)</p>
          <div className="space-y-2">
            {delivery.peakHours.map((ph, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="time"
                  value={ph.start}
                  onChange={e => updatePeakHour(i, 'start', e.target.value)}
                  className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-gray-500 text-sm">to</span>
                <input
                  type="time"
                  value={ph.end}
                  onChange={e => updatePeakHour(i, 'end', e.target.value)}
                  className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => removePeakHour(i)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={addPeakHour}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              + Add Peak Hour Range
            </button>
          </div>
        </section>

        {/* ─── Quick Links ────────────────────────────────────────────── */}
        <section className="rounded-xl bg-gray-50 p-6 border border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 mb-3">More Delivery Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/settings/delivery/zones"
              className="block bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
            >
              <div className="text-lg mb-1">📍</div>
              <div className="text-sm font-medium text-gray-900">Zone Management</div>
              <div className="text-xs text-gray-500">Create and manage delivery zones</div>
            </Link>
            <Link
              href="/settings/delivery/drivers"
              className="block bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
            >
              <div className="text-lg mb-1">🚗</div>
              <div className="text-sm font-medium text-gray-900">Driver Management</div>
              <div className="text-xs text-gray-500">Add, edit, and manage drivers</div>
            </Link>
            <Link
              href="/settings/delivery/dispatch-policy"
              className="block bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
            >
              <div className="text-lg mb-1">📋</div>
              <div className="text-sm font-medium text-gray-900">Dispatch Policy</div>
              <div className="text-xs text-gray-500">Assignment, cash, and enforcement rules</div>
            </Link>
          </div>
        </section>

        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
