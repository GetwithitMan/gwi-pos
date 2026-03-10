'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { CateringSettings } from '@/lib/settings'
import { DEFAULT_CATERING } from '@/lib/settings'

export default function CateringSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [catering, setCatering] = useState<CateringSettings>(DEFAULT_CATERING)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setCatering(data.settings.catering ?? DEFAULT_CATERING)
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
      const data = await saveSettingsApi({ catering }, employee?.id)
      setCatering(data.settings.catering ?? DEFAULT_CATERING)
      setIsDirty(false)
      toast.success('Catering settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof CateringSettings>(key: K, value: CateringSettings[K]) => {
    setCatering(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Catering Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="Catering Settings"
        subtitle="Configure catering order rules, deposits, and fees"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">General</h2>

        <ToggleRow
          label="Enable Catering"
          description="Allow creating and managing catering orders"
          checked={catering.enabled}
          onChange={v => update('enabled', v)}
        />

        {catering.enabled && (
          <>
            <NumberRow
              label="Minimum Advance Days"
              description="How many days in advance must catering orders be placed"
              value={catering.minAdvanceDays}
              onChange={v => update('minAdvanceDays', v)}
              min={0}
              max={60}
              suffix="days"
            />

            <NumberRow
              label="Minimum Order Amount"
              description="Minimum total before service fee and tax"
              value={catering.minOrderAmount}
              onChange={v => update('minOrderAmount', v)}
              min={0}
              prefix="$"
              step={10}
            />

            <NumberRow
              label="Maximum Guest Count"
              description="Maximum number of guests per catering order"
              value={catering.maxGuestCount}
              onChange={v => update('maxGuestCount', v)}
              min={1}
              max={5000}
              suffix="guests"
            />
          </>
        )}
      </div>

      {catering.enabled && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Deposits</h2>

            <ToggleRow
              label="Require Deposit"
              description="Require a deposit payment before confirming catering orders"
              checked={catering.requireDeposit}
              onChange={v => update('requireDeposit', v)}
            />

            {catering.requireDeposit && (
              <NumberRow
                label="Deposit Percentage"
                description="Percentage of total required as deposit"
                value={catering.depositPercent}
                onChange={v => update('depositPercent', v)}
                min={1}
                max={100}
                suffix="%"
              />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Fees</h2>

            <NumberRow
              label="Service Fee / Auto-Gratuity"
              description="Automatically applied gratuity percentage on catering orders"
              value={catering.serviceFeePercent}
              onChange={v => update('serviceFeePercent', v)}
              min={0}
              max={30}
              suffix="%"
            />

            <NumberRow
              label="Delivery Fee"
              description="Fixed delivery charge (0 = no delivery fee)"
              value={catering.deliveryFee}
              onChange={v => update('deliveryFee', v)}
              min={0}
              prefix="$"
              step={5}
            />
          </div>
        </>
      )}

      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
    </div>
  )
}
