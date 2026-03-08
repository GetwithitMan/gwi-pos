'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleSwitch, SettingsSaveBar } from '@/components/admin/settings'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { POSDisplaySettings } from '@/lib/settings'

const MENU_ITEM_SIZE_OPTIONS: { value: POSDisplaySettings['menuItemSize']; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
]

const ITEMS_PER_ROW_OPTIONS: { value: POSDisplaySettings['menuItemsPerRow']; label: string }[] = [
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
]

const CATEGORY_SIZE_OPTIONS: { value: POSDisplaySettings['categorySize']; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
]

const ORDER_PANEL_WIDTH_OPTIONS: { value: POSDisplaySettings['orderPanelWidth']; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
]

export default function OrderSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [posDisplay, setPosDisplay] = useState<POSDisplaySettings | null>(null)
  const [eodConfirmOpen, setEodConfirmOpen] = useState(false)

  const permissions = employee?.permissions ?? []
  const canCloseDay = hasPermission(permissions as string[], PERMISSIONS.MGR_CLOSE_DAY)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setPosDisplay(data.settings.posDisplay)
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
    if (!posDisplay) return
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ posDisplay }, employee?.id)
      setPosDisplay(data.settings.posDisplay)
      setIsDirty(false)
      toast.success('Order settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updatePosDisplay = <K extends keyof POSDisplaySettings>(key: K, value: POSDisplaySettings[K]) => {
    setPosDisplay(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  if (isLoading || !posDisplay) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Order Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading order settings...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Order Settings"
        subtitle="Order numbering, POS display defaults, and ticket configuration"
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
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Card 1: Order Numbering (Read-Only Info)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Order Numbering</h2>
          <p className="text-sm text-gray-500 mb-5">Current order numbering behavior.</p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-700">Order numbers reset daily, starting from 1</div>
                <div className="text-xs text-gray-400 mt-0.5">Each new business day starts with order #1. The business day resets at midnight in your venue&apos;s timezone (configured in Venue settings).</div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <div className="text-sm text-gray-700">Format: Sequential (1, 2, 3...)</div>
                <div className="text-xs text-gray-400 mt-0.5">Simple sequential numbering for easy reference</div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <p className="text-xs text-indigo-600/80">
                Custom order numbering (prefixes, custom start numbers, format patterns) will be configurable in a future update.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: POS Display Defaults
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">POS Display Defaults</h2>
          <p className="text-sm text-gray-500 mb-5">Default display settings for all POS terminals. Employees can override with personal settings.</p>

          <div className="space-y-6">
            {/* Menu Item Size */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Menu Item Button Size</label>
              <div className="flex gap-2">
                {MENU_ITEM_SIZE_OPTIONS.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => updatePosDisplay('menuItemSize', opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      posDisplay.menuItemSize === opt.value
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">Compact fits more items on screen. Large is easier to tap on touchscreens.</p>
            </div>

            {/* Items Per Row */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Menu Items Per Row</label>
              <p className="text-xs text-gray-400 mb-2">More columns = smaller buttons and more items visible. Fewer columns = larger buttons, easier to tap. Most venues use 4 or 5.</p>
              <div className="flex gap-2">
                {ITEMS_PER_ROW_OPTIONS.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => updatePosDisplay('menuItemsPerRow', opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      posDisplay.menuItemsPerRow === opt.value
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Size */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Category Button Size</label>
              <p className="text-xs text-gray-400 mb-2">Match this to your Menu Item Button Size for a consistent look.</p>
              <div className="flex gap-2">
                {CATEGORY_SIZE_OPTIONS.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => updatePosDisplay('categorySize', opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      posDisplay.categorySize === opt.value
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Order Panel Width */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Order Panel Width</label>
              <p className="text-xs text-gray-400 mb-2">Controls the size of the right-side panel showing your current order items.</p>
              <div className="flex gap-2">
                {ORDER_PANEL_WIDTH_OPTIONS.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => updatePosDisplay('orderPanelWidth', opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      posDisplay.orderPanelWidth === opt.value
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Show Price Toggle */}
            <div className="flex items-center justify-between py-3 border-t border-gray-100">
              <div>
                <div className="text-sm text-gray-700">Show Prices on Menu Item Buttons</div>
                <div className="text-xs text-gray-400">If OFF, prices only show in the item detail view. Useful if your menu prices change frequently.</div>
              </div>
              <ToggleSwitch
                checked={posDisplay.showPriceOnMenuItems}
                onChange={v => updatePosDisplay('showPriceOnMenuItems', v)}
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 3: Closed Orders
            ═══════════════════════════════════════════ */}
        <Link
          href="/settings/orders/closed"
          className="block bg-white border border-gray-200 rounded-2xl shadow-sm p-6 hover:border-indigo-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Closed Orders</h2>
              <p className="text-sm text-gray-500">Search, review, reopen, adjust tips, and reprint receipts for closed orders</p>
            </div>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        {/* ═══════════════════════════════════════════
            Card 4: End of Day Reset
            ═══════════════════════════════════════════ */}
        {canCloseDay && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">End of Day Reset</h2>
            <p className="text-sm text-gray-500 mb-4">
              Resets orphaned table statuses to available, detects stale open orders from a previous business day, and creates audit log entries. Orders with balances are rolled forward for manual review — no revenue data is lost.
            </p>
            <button
              type="button"
              onClick={() => setEodConfirmOpen(true)}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 shadow-sm transition-all"
            >
              Run EOD Reset
            </button>
            <ConfirmDialog
              open={eodConfirmOpen}
              title="Run End of Day Reset?"
              description="This will reset all orphaned table statuses to available and flag stale open orders from previous business days. Orders with balances are rolled forward — no revenue data is deleted. This action is logged in the audit trail."
              confirmLabel="Run EOD Reset"
              cancelLabel="Cancel"
              destructive
              onCancel={() => setEodConfirmOpen(false)}
              onConfirm={async () => {
                try {
                  const res = await fetch('/api/eod/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      locationId: employee?.location?.id,
                      employeeId: employee?.id,
                    }),
                  })
                  const json = await res.json()
                  if (!res.ok) throw new Error(json.error || 'EOD reset failed')
                  const stats = json.data?.stats
                  toast.success(
                    `EOD reset complete — ${stats?.tablesReset ?? 0} table(s) reset, ${stats?.staleOrdersDetected ?? 0} stale order(s) flagged`
                  )
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'EOD reset failed')
                } finally {
                  setEodConfirmOpen(false)
                }
              }}
            />
          </section>
        )}

        {/* Bottom save bar */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
