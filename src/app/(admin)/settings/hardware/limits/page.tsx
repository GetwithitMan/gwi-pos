'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { HardwareLimitsSettings } from '@/lib/settings'
import { DEFAULT_HARDWARE_LIMITS } from '@/lib/settings'

interface DeviceCounts {
  terminals: number
  handhelds: number
  cellular: number
  kds: number
  printers: number
}

interface DeviceCountsResponse {
  data: {
    counts: DeviceCounts
    limits: {
      maxPOSTerminals: number
      maxHandhelds: number
      maxCellularDevices: number
      maxKDSScreens: number
      maxPrinters: number
    } | null
  }
}

export default function HardwareLimitsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [limits, setLimits] = useState<HardwareLimitsSettings>({ ...DEFAULT_HARDWARE_LIMITS })
  const [deviceCounts, setDeviceCounts] = useState<DeviceCounts | null>(null)

  useUnsavedWarning(isDirty)

  const loadDeviceCounts = useCallback(async (locationId: string) => {
    try {
      const res = await fetch(`/api/hardware/device-counts?locationId=${locationId}`)
      if (res.ok) {
        const data: DeviceCountsResponse = await res.json()
        setDeviceCounts(data.data.counts)
      }
    } catch {
      // Non-critical — device counts are informational only
    }
  }, [])

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setLimits(data.settings.hardwareLimits ?? { ...DEFAULT_HARDWARE_LIMITS })
        // Load device counts using the locationId from settings
        if (data.locationId) {
          void loadDeviceCounts(data.locationId)
        }
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [loadDeviceCounts])

  useEffect(() => {
    const cleanup = loadSettings()
    return cleanup
  }, [loadSettings])

  const handleSave = async () => {
    if (!limits) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ hardwareLimits: limits }, employee?.id)
      setLimits(data.settings.hardwareLimits ?? { ...DEFAULT_HARDWARE_LIMITS })
      setIsDirty(false)
      toast.success('Hardware & transaction limits saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof HardwareLimitsSettings>(key: K, value: HardwareLimitsSettings[K]) => {
    setLimits(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Hardware & Transaction Limits"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Hardware', href: '/settings/hardware' },
          ]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-900 text-lg">Loading transaction limits...</div>
        </div>
      </div>
    )
  }

  // Check if any device type is at its limit
  const isAnyAtLimit = deviceCounts && (
    (limits.maxPOSTerminals > 0 && deviceCounts.terminals >= limits.maxPOSTerminals) ||
    (limits.maxHandhelds > 0 && deviceCounts.handhelds >= limits.maxHandhelds) ||
    (limits.maxCellularDevices > 0 && deviceCounts.cellular >= limits.maxCellularDevices) ||
    (limits.maxKDSScreens > 0 && deviceCounts.kds >= limits.maxKDSScreens) ||
    (limits.maxPrinters > 0 && deviceCounts.printers >= limits.maxPrinters)
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Hardware & Transaction Limits"
        subtitle="Set maximum transaction amounts, device-level restrictions, and volume guards"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
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
                  : 'bg-gray-200 text-gray-900 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Card 0: Device Limits (Subscription-Gated)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Device Limits</h2>
          <p className="text-sm text-gray-900 mb-2">
            Maximum number of devices your venue can pair. Set to 0 for unlimited.
          </p>
          <p className="text-xs text-gray-900 mb-5">
            These limits are typically managed by your subscription plan via Mission Control.
          </p>

          {isAnyAtLimit && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-5">
              You&apos;ve reached your device limit for one or more device types. Contact your administrator or upgrade your plan in Mission Control to add more devices.
            </div>
          )}

          <div className="space-y-5">
            <DeviceLimitRow
              label="POS Terminals"
              description="Fixed station terminals (browser or Android)"
              current={deviceCounts?.terminals ?? null}
              limit={limits.maxPOSTerminals}
              onChange={v => update('maxPOSTerminals', v)}
            />

            <DeviceLimitRow
              label="Handhelds"
              description="Handheld Android register devices"
              current={deviceCounts?.handhelds ?? null}
              limit={limits.maxHandhelds}
              onChange={v => update('maxHandhelds', v)}
            />

            <DeviceLimitRow
              label="Cellular Devices"
              description="Devices operating over cellular (LTE/5G)"
              current={deviceCounts?.cellular ?? null}
              limit={limits.maxCellularDevices}
              onChange={v => update('maxCellularDevices', v)}
            />

            <DeviceLimitRow
              label="KDS Screens"
              description="Kitchen display system screens"
              current={deviceCounts?.kds ?? null}
              limit={limits.maxKDSScreens}
              onChange={v => update('maxKDSScreens', v)}
            />

            <DeviceLimitRow
              label="Printers"
              description="Receipt, kitchen, and bar printers"
              current={deviceCounts?.printers ?? null}
              limit={limits.maxPrinters}
              onChange={v => update('maxPrinters', v)}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 1: Transaction Limits
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Transaction Limits</h2>
          <p className="text-sm text-gray-900 mb-5">
            Set maximum dollar amounts for payments, cash, tabs, and discounts. Set to 0 for unlimited.
          </p>

          <div className="space-y-4">
            <DollarRow
              label="Max Single Transaction"
              description="Maximum dollar amount for a single order payment (0 = unlimited)"
              value={limits.maxSingleTransactionAmount}
              onChange={v => update('maxSingleTransactionAmount', v)}
            />

            <DollarRow
              label="Max Cash Payment"
              description="Maximum single cash payment allowed (0 = unlimited)"
              value={limits.maxCashPaymentAmount}
              onChange={v => update('maxCashPaymentAmount', v)}
            />

            <DollarRow
              label="Max Open Tab Amount"
              description="Maximum running tab total before the tab is locked (0 = unlimited)"
              value={limits.maxOpenTabAmount}
              onChange={v => update('maxOpenTabAmount', v)}
            />

            <DollarRow
              label="Max Discount Amount"
              description="Maximum dollar discount on a single order (0 = unlimited)"
              value={limits.maxDiscountDollarAmount}
              onChange={v => update('maxDiscountDollarAmount', v)}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: Handheld Device Limits
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Handheld Device Limits</h2>
          <p className="text-sm text-gray-900 mb-5">
            Restrict what handheld terminals (Android register devices) can do. These limits apply to terminals with category HANDHELD.
          </p>

          <div className="space-y-4">
            <DollarRow
              label="Max Payment Amount"
              description="Maximum payment amount for handheld terminals (0 = unlimited)"
              value={limits.handheldMaxPaymentAmount}
              onChange={v => update('handheldMaxPaymentAmount', v)}
            />

            <div className="space-y-0">
              <ToggleRow
                label="Allow Voids"
                description="Can handheld devices void items?"
                checked={limits.handheldAllowVoids}
                onChange={v => update('handheldAllowVoids', v)}
                border
              />

              <ToggleRow
                label="Allow Comps"
                description="Can handheld devices comp items?"
                checked={limits.handheldAllowComps}
                onChange={v => update('handheldAllowComps', v)}
                border
              />

              <ToggleRow
                label="Allow Discounts"
                description="Can handheld devices apply discounts?"
                checked={limits.handheldAllowDiscounts}
                onChange={v => update('handheldAllowDiscounts', v)}
                border
              />

              <ToggleRow
                label="Allow Refunds"
                description="Can handheld devices process refunds?"
                checked={limits.handheldAllowRefunds}
                onChange={v => update('handheldAllowRefunds', v)}
                border
              />

              <ToggleRow
                label="Allow Cash Payments"
                description="Can handheld devices accept cash payments?"
                checked={limits.handheldAllowCashPayments}
                onChange={v => update('handheldAllowCashPayments', v)}
                border
              />

              <ToggleRow
                label="Allow Tab Close"
                description="Can handheld devices close tabs?"
                checked={limits.handheldAllowTabClose}
                onChange={v => update('handheldAllowTabClose', v)}
                border
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Cellular Device Limits
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Cellular Device Limits</h2>
          <p className="text-sm text-gray-900 mb-5">
            Additional restrictions for devices operating over cellular connections. These are on top of the hard-coded proxy blocks.
          </p>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-5">
            Cellular devices are always blocked from refunds, tip adjustments, splits, merges, and shift closes regardless of these settings.
          </div>

          <div className="space-y-4">
            <DollarRow
              label="Max Order Amount"
              description="Maximum order total for cellular devices (0 = unlimited)"
              value={limits.cellularMaxOrderAmount}
              onChange={v => update('cellularMaxOrderAmount', v)}
            />

            <div className="space-y-0">
              <ToggleRow
                label="Allow Voids"
                description="Can cellular devices void items? (Currently requires re-authentication)"
                checked={limits.cellularAllowVoids}
                onChange={v => update('cellularAllowVoids', v)}
                border
              />

              <ToggleRow
                label="Allow Comps"
                description="Can cellular devices comp items? (Currently requires re-authentication)"
                checked={limits.cellularAllowComps}
                onChange={v => update('cellularAllowComps', v)}
                border
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 4: Volume Guards
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Volume Guards</h2>
          <p className="text-sm text-gray-900 mb-5">
            Limit how many orders, voids, or comps a single employee can perform in a time window. Set to 0 for unlimited.
          </p>

          <div className="space-y-4">
            <NumberRow
              label="Max Orders per Hour"
              description="Maximum orders a single employee can create per hour (0 = unlimited)"
              value={limits.maxOrdersPerHour}
              onChange={v => update('maxOrdersPerHour', v)}
              suffix="per hour"
              min={0}
              max={1000}
              step={1}
            />

            <NumberRow
              label="Max Voids per Shift"
              description="Maximum voids an employee can perform per shift (0 = unlimited)"
              value={limits.maxVoidsPerShift}
              onChange={v => update('maxVoidsPerShift', v)}
              suffix="per shift"
              min={0}
              max={1000}
              step={1}
            />

            <NumberRow
              label="Max Comps per Shift"
              description="Maximum comps an employee can perform per shift (0 = unlimited)"
              value={limits.maxCompsPerShift}
              onChange={v => update('maxCompsPerShift', v)}
              suffix="per shift"
              min={0}
              max={1000}
              step={1}
            />
          </div>
        </section>

      </div>
    </div>
  )
}

// ─── Device Limit Row with Progress Bar ──────────────────────────────────────

function DeviceLimitRow({
  label,
  description,
  current,
  limit,
  onChange,
}: {
  label: string
  description: string
  current: number | null
  limit: number
  onChange: (v: number) => void
}) {
  const isUnlimited = limit === 0
  const ratio = isUnlimited || current === null ? 0 : limit > 0 ? current / limit : 0
  const pct = Math.min(ratio * 100, 100)

  // Color based on usage percentage
  let barColor = 'bg-emerald-500'
  let textColor = 'text-emerald-700'
  if (pct >= 90) {
    barColor = 'bg-red-500'
    textColor = 'text-red-700'
  } else if (pct >= 75) {
    barColor = 'bg-amber-500'
    textColor = 'text-amber-700'
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900 font-medium">{label}</div>
          <div className="text-xs text-gray-900">{description}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Current count display */}
          {current !== null && !isUnlimited && (
            <span className={`text-sm font-medium ${textColor}`}>
              {current} / {limit}
            </span>
          )}
          {current !== null && isUnlimited && (
            <span className="text-sm font-medium text-gray-900">
              {current} active
            </span>
          )}
          {/* Editable limit */}
          <input
            type="number"
            value={limit}
            onChange={e => onChange(parseInt(e.target.value) || 0)}
            min={0}
            max={999}
            step={1}
            className="w-20 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
            aria-label={`${label} limit`}
          />
        </div>
      </div>
      {/* Progress bar — only show when limit is set and we have counts */}
      {!isUnlimited && current !== null && (
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Dollar Input Row ─────────────────────────────────────────────────────────
// A number input with $ prefix and "(0 = unlimited)" built into the description

function DollarRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900">{label}</div>
        <div className="text-xs text-gray-600">{description}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-gray-900 text-sm">$</span>
        <input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={0}
          max={99999.99}
          step={0.01}
          className="w-28 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label={label}
        />
      </div>
    </div>
  )
}
