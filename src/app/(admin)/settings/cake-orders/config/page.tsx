'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { CakeOrderingSettings } from '@/lib/settings'
import { DEFAULT_CAKE_ORDERING } from '@/lib/settings'

export default function CakeOrderConfigPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [config, setConfig] = useState<CakeOrderingSettings>(DEFAULT_CAKE_ORDERING)
  const [categoryIdsText, setCategoryIdsText] = useState('')

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const loaded = data.settings.cakeOrdering ?? DEFAULT_CAKE_ORDERING
        setConfig(loaded)
        setCategoryIdsText((loaded.cakeCategoryIds ?? []).join(', '))
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
      const parsedIds = categoryIdsText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const payload: CakeOrderingSettings = { ...config, cakeCategoryIds: parsedIds }
      const data = await saveSettingsApi({ cakeOrdering: payload }, employee?.id)
      const saved = data.settings.cakeOrdering ?? DEFAULT_CAKE_ORDERING
      setConfig(saved)
      setCategoryIdsText((saved.cakeCategoryIds ?? []).join(', '))
      setIsDirty(false)
      toast.success('Cake ordering settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof CakeOrderingSettings>(key: K, value: CakeOrderingSettings[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Cake Ordering Settings"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Cake Orders', href: '/settings/cake-orders' },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="Cake Ordering Settings"
        subtitle="Configure cake ordering, deposits, fees, and delivery rules"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Cake Orders', href: '/settings/cake-orders' },
        ]}
      />

      {/* General */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">General</h2>

        <ToggleRow
          label="Enable Cake Ordering"
          description="Allow creating and managing custom cake orders"
          checked={config.enabled}
          onChange={v => update('enabled', v)}
        />

        {config.enabled && (
          <>
            <ToggleRow
              label="Allow Public Ordering"
              description="Let customers submit cake orders from your public website"
              checked={config.allowPublicOrdering}
              onChange={v => update('allowPublicOrdering', v)}
              border
            />

            <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900">Cake Category IDs</div>
                <div className="text-xs text-gray-600">Comma-separated menu category IDs for cake items</div>
              </div>
              <input
                type="text"
                value={categoryIdsText}
                onChange={e => {
                  setCategoryIdsText(e.target.value)
                  setIsDirty(true)
                }}
                placeholder="cat_abc123, cat_def456"
                className="w-72 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <NumberRow
              label="Max Capacity Per Day"
              description="Maximum number of cake orders that can be scheduled per day"
              value={config.maxCapacityPerDay}
              onChange={v => update('maxCapacityPerDay', v)}
              min={1}
              max={100}
              suffix="orders"
            />

            <NumberRow
              label="Quote Expiry"
              description="How many days before an unaccepted quote expires"
              value={config.quoteExpiryDays}
              onChange={v => update('quoteExpiryDays', v)}
              min={1}
              max={90}
              suffix="days"
            />
          </>
        )}
      </div>

      {/* Deposits */}
      {config.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Deposits</h2>

          <ToggleRow
            label="Require Deposit"
            description="Require a deposit payment before confirming cake orders"
            checked={config.requireDeposit}
            onChange={v => update('requireDeposit', v)}
          />

          {config.requireDeposit && (
            <>
              <NumberRow
                label="Deposit Percentage"
                description="Percentage of quoted total required as deposit"
                value={config.depositPercent}
                onChange={v => update('depositPercent', v)}
                min={1}
                max={100}
                suffix="%"
              />

              <NumberRow
                label="Forfeit Window"
                description="Days before event when deposit becomes non-refundable"
                value={config.forfeitDaysBefore}
                onChange={v => update('forfeitDaysBefore', v)}
                min={0}
                max={60}
                suffix="days"
              />
            </>
          )}
        </div>
      )}

      {/* Fees */}
      {config.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Fees</h2>

          <NumberRow
            label="Rush Fee Amount"
            description="Surcharge for orders placed within the rush window"
            value={config.rushFeeAmount}
            onChange={v => update('rushFeeAmount', v)}
            min={0}
            prefix="$"
            step={5}
          />

          <NumberRow
            label="Rush Fee Days"
            description="Orders placed within this many days of event date incur rush fee"
            value={config.rushFeeDays}
            onChange={v => update('rushFeeDays', v)}
            min={0}
            max={30}
            suffix="days"
          />

          <NumberRow
            label="Setup Fee"
            description="Fixed setup/assembly fee added to each order (0 = none)"
            value={config.setupFeeAmount}
            onChange={v => update('setupFeeAmount', v)}
            min={0}
            prefix="$"
            step={5}
          />
        </div>
      )}

      {/* Delivery */}
      {config.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Delivery</h2>

          <ToggleRow
            label="Enable Delivery"
            description="Offer delivery as an option for cake orders"
            checked={config.deliveryEnabled}
            onChange={v => update('deliveryEnabled', v)}
          />

          {config.deliveryEnabled && (
            <>
              <NumberRow
                label="Fixed Delivery Fee"
                description="Base delivery charge regardless of distance (0 = no base fee)"
                value={config.deliveryFixedFee}
                onChange={v => update('deliveryFixedFee', v)}
                min={0}
                prefix="$"
                step={5}
              />

              <NumberRow
                label="Per-Mile Fee"
                description="Additional charge per mile of delivery distance"
                value={config.deliveryFeePerMile}
                onChange={v => update('deliveryFeePerMile', v)}
                min={0}
                prefix="$"
                step={0.5}
              />

              <NumberRow
                label="Max Delivery Distance"
                description="Maximum delivery radius from your location"
                value={config.deliveryMaxMiles}
                onChange={v => update('deliveryMaxMiles', v)}
                min={1}
                max={200}
                suffix="miles"
              />
            </>
          )}
        </div>
      )}

      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
    </div>
  )
}
