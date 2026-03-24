'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { DEFAULT_CFD_DISPLAY, type CfdDisplayMode, type CfdDisplaySettings } from '@/lib/settings'

// ─── Display Mode Radio Group ────────────────────────────────────────────────

const DISPLAY_MODES: { value: CfdDisplayMode; label: string; description: string }[] = [
  { value: 'full', label: 'Full Display', description: 'Items, prices, modifiers, and totals — the complete order view' },
  { value: 'items_only', label: 'Items Only', description: 'Item names and quantities only — no prices or totals shown' },
  { value: 'items_no_price', label: 'Items (No Prices)', description: 'Item names, quantities, and modifiers — prices hidden' },
  { value: 'total_only', label: 'Total Only', description: 'Hide item list, show only the running total in large text' },
]

function DisplayModeSelector({
  value,
  onChange,
}: {
  value: CfdDisplayMode
  onChange: (mode: CfdDisplayMode) => void
}) {
  return (
    <div className="space-y-2">
      {DISPLAY_MODES.map((mode) => (
        <label
          key={mode.value}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            value === mode.value
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <input
            type="radio"
            name="displayMode"
            value={mode.value}
            checked={value === mode.value}
            onChange={() => onChange(mode.value)}
            className="mt-0.5 accent-indigo-600"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">{mode.label}</div>
            <div className="text-xs text-gray-600">{mode.description}</div>
          </div>
        </label>
      ))}
    </div>
  )
}

// ─── Text Input Row ──────────────────────────────────────────────────────────

function TextInputRow({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm text-gray-900">{label}</div>
      <div className="text-xs text-gray-600 mb-1.5">{description}</div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CfdSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // CFD display settings state
  const [displayMode, setDisplayMode] = useState<CfdDisplayMode>(DEFAULT_CFD_DISPLAY.displayMode)
  const [showModifiers, setShowModifiers] = useState(DEFAULT_CFD_DISPLAY.showModifiers)
  const [showModifierPrices, setShowModifierPrices] = useState(DEFAULT_CFD_DISPLAY.showModifierPrices)
  const [showDualPricing, setShowDualPricing] = useState(DEFAULT_CFD_DISPLAY.showDualPricing)
  const [totalOnlyDelaySeconds, setTotalOnlyDelaySeconds] = useState(DEFAULT_CFD_DISPLAY.totalOnlyDelaySeconds)
  const [showTotalOnPaymentMethod, setShowTotalOnPaymentMethod] = useState(DEFAULT_CFD_DISPLAY.showTotalOnPaymentMethod)
  const [showUpsellSuggestions, setShowUpsellSuggestions] = useState(DEFAULT_CFD_DISPLAY.showUpsellSuggestions)
  const [upsellMessage, setUpsellMessage] = useState(DEFAULT_CFD_DISPLAY.upsellMessage)
  const [idleScreenMessage, setIdleScreenMessage] = useState(DEFAULT_CFD_DISPLAY.idleScreenMessage)
  const [idleScreenImageUrl, setIdleScreenImageUrl] = useState(DEFAULT_CFD_DISPLAY.idleScreenImageUrl)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const s = data.settings
        const cfd = s.cfdDisplay ?? DEFAULT_CFD_DISPLAY
        setDisplayMode(cfd.displayMode)
        setShowModifiers(cfd.showModifiers)
        setShowModifierPrices(cfd.showModifierPrices)
        setShowDualPricing(cfd.showDualPricing)
        setTotalOnlyDelaySeconds(cfd.totalOnlyDelaySeconds)
        setShowTotalOnPaymentMethod(cfd.showTotalOnPaymentMethod)
        setShowUpsellSuggestions(cfd.showUpsellSuggestions)
        setUpsellMessage(cfd.upsellMessage)
        setIdleScreenMessage(cfd.idleScreenMessage)
        setIdleScreenImageUrl(cfd.idleScreenImageUrl)
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

      const cfdDisplay: CfdDisplaySettings = {
        displayMode,
        showModifiers,
        showModifierPrices,
        showDualPricing,
        totalOnlyDelaySeconds,
        showTotalOnPaymentMethod,
        showUpsellSuggestions,
        upsellMessage,
        idleScreenMessage,
        idleScreenImageUrl,
      }

      await saveSettingsApi(
        { cfdDisplay } as any,
        employee?.id,
      )

      setIsDirty(false)
      toast.success('CFD display settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const markDirty = () => setIsDirty(true)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-900">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader title="Customer-Facing Display" subtitle="Configure what customers see on the CFD screen during ordering and payment" />

      <div className="max-w-3xl mx-auto space-y-8">

        {/* ─── Display Mode Section ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Display Mode</h2>
          <p className="text-sm text-gray-600 mb-4">Choose how much order detail the customer sees on screen.</p>

          <DisplayModeSelector
            value={displayMode}
            onChange={v => { setDisplayMode(v); markDirty() }}
          />

          {displayMode === 'total_only' && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <NumberRow
                label="Delay Before Total-Only"
                description="Show items normally for this many seconds after the last item is added, then transition to total-only view. 0 = always total-only."
                value={totalOnlyDelaySeconds}
                onChange={v => { setTotalOnlyDelaySeconds(v); markDirty() }}
                suffix="seconds"
                min={0}
                max={300}
                step={1}
              />
            </div>
          )}
        </section>

        {/* ─── Item Display Options ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Item Display Options</h2>
          <p className="text-sm text-gray-600 mb-4">Control modifier and pricing visibility on the order screen.</p>

          <ToggleRow
            label="Show Modifiers"
            description="Display modifier lines under each order item (e.g., 'No Onions', 'Extra Cheese')"
            checked={showModifiers}
            onChange={v => { setShowModifiers(v); markDirty() }}
          />

          <ToggleRow
            label="Show Modifier Prices"
            description="Show individual modifier prices inline. When off, modifier costs are reflected in the item total only."
            checked={showModifierPrices}
            onChange={v => { setShowModifierPrices(v); markDirty() }}
            border
            disabled={!showModifiers}
            disabledNote="Enable Show Modifiers first"
          />

          <ToggleRow
            label="Show Dual Pricing"
            description="Display both cash and card prices side-by-side (requires a dual pricing program to be active)"
            checked={showDualPricing}
            onChange={v => { setShowDualPricing(v); markDirty() }}
            border
          />

          <ToggleRow
            label="Highlight Total on Payment"
            description="Flash/highlight the total prominently when the cashier presses Cash or Credit"
            checked={showTotalOnPaymentMethod}
            onChange={v => { setShowTotalOnPaymentMethod(v); markDirty() }}
            border
          />
        </section>

        {/* ─── Upsell Section ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Upsell Suggestions</h2>
          <p className="text-sm text-gray-600 mb-4">Show featured items at the bottom of the order screen to encourage add-ons.</p>

          <ToggleRow
            label="Show Upsell Suggestions"
            description="Display featured items strip at the bottom of the order screen"
            checked={showUpsellSuggestions}
            onChange={v => { setShowUpsellSuggestions(v); markDirty() }}
          />

          {showUpsellSuggestions && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <TextInputRow
                label="Upsell Message"
                description="Text shown above the featured items strip"
                value={upsellMessage}
                onChange={v => { setUpsellMessage(v); markDirty() }}
                placeholder="While you wait..."
              />
            </div>
          )}
        </section>

        {/* ─── Idle Screen Section ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Idle Screen</h2>
          <p className="text-sm text-gray-600 mb-4">Customize what customers see when no order is active.</p>

          <div className="space-y-4">
            <TextInputRow
              label="Welcome Message"
              description="Main text displayed on the idle screen"
              value={idleScreenMessage}
              onChange={v => { setIdleScreenMessage(v); markDirty() }}
              placeholder="Welcome!"
            />

            <TextInputRow
              label="Logo / Image URL"
              description="URL to a custom logo or image for the idle screen (leave blank for default GWI POS branding)"
              value={idleScreenImageUrl}
              onChange={v => { setIdleScreenImageUrl(v); markDirty() }}
              placeholder="https://example.com/logo.png"
            />
          </div>
        </section>

        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />

      </div>
    </div>
  )
}
