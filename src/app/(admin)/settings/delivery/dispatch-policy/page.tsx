'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { toast } from '@/stores/toast-store'
import type { DeliveryDispatchPolicy, DeliverySettings } from '@/lib/settings'
import { DEFAULT_DISPATCH_POLICY, DEFAULT_DELIVERY } from '@/lib/settings'

// ─── Component ──────────────────────────────────────────────────────────────

export default function DispatchPolicyPage() {
  const { employee } = useRequireAuth()
  const deliveryEnabled = useDeliveryFeature()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [policy, setPolicy] = useState<DeliveryDispatchPolicy>(DEFAULT_DISPATCH_POLICY)

  // We also need the full delivery settings for save
  const [fullDelivery, setFullDelivery] = useState<DeliverySettings>(DEFAULT_DELIVERY)

  useUnsavedWarning(isDirty)

  // ─── Load ──────────────────────────────────────────────────────────

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const delivery = { ...DEFAULT_DELIVERY, ...(data.settings.delivery || {}) }
        setFullDelivery(delivery)
        setPolicy({
          ...DEFAULT_DISPATCH_POLICY,
          ...(delivery.dispatchPolicy || {}),
        })
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load dispatch policy')
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
      const delivery: DeliverySettings = {
        ...fullDelivery,
        dispatchPolicy: policy,
      }
      const data = await saveSettingsApi({ delivery }, employee?.id)
      const saved = { ...DEFAULT_DELIVERY, ...(data.settings.delivery || {}) }
      setFullDelivery(saved)
      setPolicy({ ...DEFAULT_DISPATCH_POLICY, ...(saved.dispatchPolicy || {}) })
      setIsDirty(false)
      toast.success('Dispatch policy saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save dispatch policy')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  function update<K extends keyof DeliveryDispatchPolicy>(key: K, value: DeliveryDispatchPolicy[K]) {
    setPolicy(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateMaxOrders(period: 'peak' | 'offPeak', value: number) {
    setPolicy(prev => ({
      ...prev,
      maxOrdersPerDriverByTimeOfDay: {
        ...prev.maxOrdersPerDriverByTimeOfDay,
        [period]: value,
      },
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
            Enable the delivery module from Mission Control to configure dispatch policy.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Dispatch Policy"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Delivery', href: '/settings/delivery' },
          ]}
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
        title="Dispatch Policy"
        subtitle="Assignment strategy, cash management, order limits, and enforcement rules"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Delivery', href: '/settings/delivery' },
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
            Assignment Strategy
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Assignment Strategy</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-900">Auto-Assignment Method</div>
                <div className="text-xs text-gray-600">How orders are assigned to drivers</div>
              </div>
              <select
                value={policy.assignmentStrategy}
                onChange={e => update('assignmentStrategy', e.target.value as DeliveryDispatchPolicy['assignmentStrategy'])}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="manual">Manual (dispatcher assigns)</option>
                <option value="round_robin">Round Robin</option>
                <option value="least_loaded">Least Loaded</option>
                <option value="zone_affinity">Zone Affinity</option>
              </select>
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
              {policy.assignmentStrategy === 'manual' && 'Dispatcher manually assigns each order to a driver from the dispatch board.'}
              {policy.assignmentStrategy === 'round_robin' && 'Orders cycle through available drivers in order, ensuring even distribution.'}
              {policy.assignmentStrategy === 'least_loaded' && 'Orders go to the driver with the fewest active deliveries.'}
              {policy.assignmentStrategy === 'zone_affinity' && 'Orders are assigned to drivers currently in or nearest to the delivery zone.'}
            </div>
            <ToggleRow
              label="Require Driver Acceptance"
              description="Drivers must accept assigned orders before dispatch (otherwise auto-dispatched)"
              checked={policy.driverAcceptanceRequired}
              onChange={v => update('driverAcceptanceRequired', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Cash Management
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Cash Management</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Cash on Delivery Allowed"
              description="Allow customers to pay with cash upon delivery"
              checked={policy.cashOnDeliveryAllowed}
              onChange={v => update('cashOnDeliveryAllowed', v)}
            />
            <NumberRow
              label="Require Prepayment Above"
              description="Force prepayment for orders above this amount (0 = no limit)"
              value={policy.requirePrepaymentAboveAmount}
              onChange={v => update('requirePrepaymentAboveAmount', v)}
              prefix="$"
              min={0}
              step={10}
            />
            <NumberRow
              label="Cash Drop Threshold"
              description="Force driver to drop cash at venue when carrying more than this amount"
              value={policy.maxCashBeforeForcedDrop}
              onChange={v => update('maxCashBeforeForcedDrop', v)}
              prefix="$"
              min={0}
              step={25}
            />
            <ToggleRow
              label="Cash Shortage Requires Approval"
              description="Manager approval required if driver cash count is short"
              checked={policy.cashShortageApprovalRequired}
              onChange={v => update('cashShortageApprovalRequired', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Order Limits
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Order Limits per Driver</h2>
          <div className="space-y-3">
            <NumberRow
              label="Peak Hours Max"
              description="Maximum orders per driver during peak hours"
              value={policy.maxOrdersPerDriverByTimeOfDay.peak}
              onChange={v => updateMaxOrders('peak', v)}
              min={1}
              max={20}
            />
            <NumberRow
              label="Off-Peak Max"
              description="Maximum orders per driver during off-peak hours"
              value={policy.maxOrdersPerDriverByTimeOfDay.offPeak}
              onChange={v => updateMaxOrders('offPeak', v)}
              min={1}
              max={20}
            />
            <NumberRow
              label="Max Late Threshold"
              description="Minutes past ETA before an order is flagged as late"
              value={policy.maxLateThresholdMinutes}
              onChange={v => update('maxLateThresholdMinutes', v)}
              suffix="min"
              min={5}
              max={60}
              step={5}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Zone Enforcement
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Zone Enforcement</h2>
          <div className="space-y-3">
            <ToggleRow
              label="Block Dispatch Without Valid Zone"
              description="Orders cannot be dispatched if the delivery address is outside all active zones"
              checked={policy.blockDispatchWithoutValidZone}
              onChange={v => update('blockDispatchWithoutValidZone', v)}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Proof Escalation
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Proof Escalation</h2>
          <p className="text-xs text-gray-600 mb-4">
            Additional proof-of-delivery requirements beyond the default mode. These override the base setting.
          </p>
          <div className="space-y-3">
            <ToggleRow
              label="Alcohol Deliveries"
              description="Require proof (photo/signature) for orders containing alcohol items"
              checked={policy.proofRequiredForAlcohol}
              onChange={v => update('proofRequiredForAlcohol', v)}
            />
            <ToggleRow
              label="Flagged Customers"
              description="Require proof for customers flagged by staff (dispute history, etc.)"
              checked={policy.proofRequiredForFlaggedCustomers}
              onChange={v => update('proofRequiredForFlaggedCustomers', v)}
              border
            />
            <ToggleRow
              label="Cash Orders"
              description="Require proof for all cash-on-delivery transactions"
              checked={policy.proofRequiredForCashOrders}
              onChange={v => update('proofRequiredForCashOrders', v)}
              border
            />
            <ToggleRow
              label="Apartment Deliveries"
              description="Require proof for deliveries to apartments or multi-unit buildings"
              checked={policy.proofRequiredForApartments}
              onChange={v => update('proofRequiredForApartments', v)}
              border
            />
            <NumberRow
              label="Amount Threshold"
              description="Require proof for orders above this amount (0 = disabled)"
              value={policy.proofRequiredAboveAmount}
              onChange={v => update('proofRequiredAboveAmount', v)}
              prefix="$"
              min={0}
              step={25}
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Operational Lockouts
            ═══════════════════════════════════════════ */}
        <section className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Operational Lockouts</h2>
          <p className="text-xs text-gray-600 mb-4">
            Safety and compliance rules that prevent certain actions without authorization.
          </p>
          <div className="space-y-3">
            <ToggleRow
              label="Void After Dispatch Requires Manager"
              description="Manager approval required to void an order after it has been dispatched"
              checked={policy.voidAfterDispatchRequiresManager}
              onChange={v => update('voidAfterDispatchRequiresManager', v)}
            />
            <ToggleRow
              label="Cannot Dispatch Suspended Driver"
              description="Suspended drivers cannot receive dispatches without manager override"
              checked={policy.cannotDispatchSuspendedWithoutOverride}
              onChange={v => update('cannotDispatchSuspendedWithoutOverride', v)}
              border
            />
            <ToggleRow
              label="Cannot Mark Delivered Without Proof"
              description="When proof is required, delivery cannot be completed without it"
              checked={policy.cannotMarkDeliveredWithoutRequiredProof}
              onChange={v => update('cannotMarkDeliveredWithoutRequiredProof', v)}
              border
            />
            <ToggleRow
              label="Driver Cannot End Shift With Open Run"
              description="Drivers must complete all active deliveries before clocking out"
              checked={policy.driverCannotEndShiftWithOpenRun}
              onChange={v => update('driverCannotEndShiftWithOpenRun', v)}
              border
            />
            <ToggleRow
              label="Hold Ready Until All Items Complete"
              description="Do not mark order as ready for pickup until all kitchen items are bumped"
              checked={policy.holdReadyUntilAllItemsComplete}
              onChange={v => update('holdReadyUntilAllItemsComplete', v)}
              border
            />
          </div>
        </section>

        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
