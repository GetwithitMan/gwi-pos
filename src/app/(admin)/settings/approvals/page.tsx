'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { ApprovalSettings } from '@/lib/settings'

export default function ApprovalsSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [approvals, setApprovals] = useState<ApprovalSettings | null>(null)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setApprovals(data.settings.approvals)
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
    if (!approvals) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ approvals }, employee?.id)
      setApprovals(data.settings.approvals)
      setIsDirty(false)
      toast.success('Approval settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateApprovals = <K extends keyof ApprovalSettings>(key: K, value: ApprovalSettings[K]) => {
    setApprovals(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !approvals) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Approval Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-900 text-lg">Loading approval settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Approval Settings"
        subtitle="Control which actions require manager approval and set thresholds"
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
                  : 'bg-gray-200 text-gray-900 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* Card 1: Void Approval */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Void Approval</h2>
          <p className="text-sm text-gray-900 mb-5">Require manager approval for voids exceeding a dollar amount.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Void Approval"
              description="Require manager approval for voids exceeding the threshold below"
              checked={approvals.requireVoidApproval}
              onChange={v => updateApprovals('requireVoidApproval', v)}
              border
            />

            {approvals.requireVoidApproval && (
              <NumberRow
                label="Void Approval Threshold"
                description="Voids above this dollar amount require manager approval"
                value={approvals.voidApprovalThreshold}
                onChange={v => updateApprovals('voidApprovalThreshold', v)}
                prefix="$"
                min={0}
                max={10000}
                step={5}
              />
            )}
          </div>
        </section>

        {/* Card 2: Discount Approval */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Discount Approval</h2>
          <p className="text-sm text-gray-900 mb-5">Require manager approval for discounts exceeding a percentage.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Discount Approval"
              description="Require manager approval for discounts exceeding the threshold below"
              checked={approvals.requireDiscountApproval}
              onChange={v => updateApprovals('requireDiscountApproval', v)}
              border
            />

            {approvals.requireDiscountApproval && (
              <NumberRow
                label="Discount Approval Threshold"
                description="Discounts above this percentage require manager approval"
                value={approvals.discountApprovalThreshold}
                onChange={v => updateApprovals('discountApprovalThreshold', v)}
                suffix="%"
                min={1}
                max={100}
                step={5}
              />
            )}
          </div>
        </section>

        {/* Card 3: Refund & Cash Drawer Approval */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Refund & Cash Drawer</h2>
          <p className="text-sm text-gray-900 mb-5">Manager approval requirements for refunds and cash drawer access.</p>

          <div className="space-y-0">
            <ToggleRow
              label="Require Refund Approval"
              description="Require manager approval for all refunds"
              checked={approvals.requireRefundApproval}
              onChange={v => updateApprovals('requireRefundApproval', v)}
              border
            />

            <ToggleRow
              label="Require Cash Drawer Approval"
              description="Require manager approval to open cash drawer without a sale"
              checked={approvals.requireDrawerOpenApproval}
              onChange={v => updateApprovals('requireDrawerOpenApproval', v)}
              border
            />
          </div>
        </section>

        {/* Card 4: Discount Cap */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Discount Cap for Non-Managers</h2>
          <p className="text-sm text-gray-900 mb-5">Set the maximum discount percentage non-managers can apply without approval.</p>

          <div className="space-y-0">
            <NumberRow
              label="Maximum Discount for Non-Managers"
              description="Maximum discount percentage non-managers can apply without approval"
              value={approvals.defaultMaxDiscountPercent}
              onChange={v => updateApprovals('defaultMaxDiscountPercent', v)}
              suffix="%"
              min={0}
              max={100}
              step={5}
            />
          </div>
        </section>

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
