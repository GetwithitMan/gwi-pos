'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { Plus, ChevronUp, ChevronDown, Eye, EyeOff, X } from 'lucide-react'
import { SwapTargetPicker } from './SwapTargetPicker'
import type { Modifier, ModifierGroup, SwapTarget, CustomPreMod } from './item-editor-types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModifierDetailPanelProps {
  modifier: Modifier
  group: ModifierGroup
  menuItemId: string
  locationSettings?: { cashDiscountPercent?: number }
  ingredients?: Array<{ id: string; name: string; category?: string | null }>
  printers?: Array<{ id: string; name: string }>
  onSave: (modifierId: string, updates: Partial<Modifier>) => Promise<void>
  onDiscard: () => void
}

interface ValidationResult {
  errors: string[]
  warnings: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function currencyInput(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return String(v)
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function getChanges(draft: Modifier, original: Modifier): Partial<Modifier> {
  const changes: Partial<Modifier> = {}
  for (const key of Object.keys(draft) as (keyof Modifier)[]) {
    if (!eq(draft[key], original[key])) {
      ;(changes as any)[key] = draft[key]
    }
  }
  return changes
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateModifier(draft: Modifier, group: ModifierGroup, stalePrices: boolean): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (draft.price != null && (isNaN(draft.price) || draft.price < 0)) {
    errors.push('Price cannot be negative or invalid')
  }
  if (draft.cost != null && (isNaN(draft.cost) || draft.cost < 0)) {
    errors.push('Cost cannot be negative or invalid')
  }
  if (draft.extraPrice != null && (isNaN(draft.extraPrice) || draft.extraPrice < 0)) {
    errors.push('Extra price cannot be negative or invalid')
  }

  if (draft.commissionType === 'percent' && draft.commissionValue != null && draft.commissionValue > 100) {
    errors.push('Percent commission cannot exceed 100%')
  }
  if (draft.commissionType && draft.commissionType !== 'none' && draft.commissionValue != null && draft.commissionValue < 0) {
    errors.push('Commission value cannot be negative')
  }

  if (draft.swapEnabled) {
    const targets = draft.swapTargets ?? []
    if (targets.length === 0) {
      errors.push('Swap is enabled but no targets are configured')
    }
    for (const t of targets) {
      if (t.pricingMode === 'fixed_price' && (t.fixedPrice == null || isNaN(t.fixedPrice))) {
        errors.push(`Swap target "${t.name}" uses fixed pricing but has no price set`)
      }
    }
    const ids = targets.map(t => t.menuItemId)
    if (new Set(ids).size !== ids.length) {
      errors.push('Duplicate menu items in swap targets')
    }
  }

  if (draft.inventoryDeductionAmount != null && draft.inventoryDeductionAmount < 0) {
    errors.push('Inventory deduction amount cannot be negative')
  }

  // Custom pre-modifier validation
  const customPreMods = draft.customPreModifiers ?? []
  for (const cpm of customPreMods) {
    if (!cpm.name || cpm.name.trim() === '') {
      errors.push('Each custom pre-modifier must have a name')
    }
    if (cpm.name && cpm.name.length > 10 && !cpm.shortLabel) {
      warnings.push(`Custom pre-mod "${cpm.name}" exceeds 10 chars — add a short label`)
    }
    if (cpm.shortLabel && cpm.shortLabel.length > 12) {
      errors.push(`Short label "${cpm.shortLabel}" exceeds 12 character limit`)
    }
  }
  const shortLabels = customPreMods.map(c => c.shortLabel).filter(Boolean)
  if (new Set(shortLabels).size !== shortLabels.length) {
    warnings.push('Duplicate short labels in custom pre-modifiers')
  }

  if (draft.isDefault && draft.showOnPOS === false) {
    warnings.push('Default modifier hidden from POS')
  }
  if (draft.isActive === false && draft.isDefault) {
    warnings.push('Inactive modifier set as default — default will be cleared on save')
  }
  if (stalePrices) {
    warnings.push('Some swap target prices may be out of date — prices will refresh when you save')
  }
  if (draft.showOnPOS === false && group.isRequired) {
    warnings.push('Modifier hidden from POS in a required group')
  }

  return { errors, warnings }
}

// ── Preview Summaries ──────────────────────────────────────────────────────────

function getPreModSummary(draft: Modifier): string {
  const parts: string[] = []
  if (draft.allowNo) parts.push('No')
  if (draft.allowLite) {
    const mult = draft.liteMultiplier ?? 0.5
    parts.push(`Lite (${mult}x)`)
  }
  if (draft.allowExtra) {
    const mult = draft.extraMultiplier ?? 2.0
    const extra = draft.extraPrice ? ` +${formatCurrency(draft.extraPrice)}` : ''
    parts.push(`Extra (${mult}x${extra})`)
  }
  if (draft.allowOnSide) parts.push('Side')
  const customCount = (draft.customPreModifiers ?? []).filter(c => c.isActive).length
  if (customCount > 0) parts.push(`${customCount} custom`)
  return parts.join(', ')
}

function getSwapSummary(targets: SwapTarget[]): string {
  if (targets.length === 0) return ''
  return targets.slice(0, 3).map(t => {
    if (t.pricingMode === 'no_charge') return `${t.name} (free)`
    if (t.pricingMode === 'fixed_price') return `${t.name} (+${formatCurrency(t.fixedPrice ?? 0)})`
    return `${t.name} (item price)`
  }).join(', ') + (targets.length > 3 ? `, +${targets.length - 3} more` : '')
}

function getRoutingSummary(draft: Modifier, printers: Array<{ id: string; name: string }>): string {
  if (!draft.printerRouting || draft.printerRouting === 'follow') return 'Follow item'
  const selected = (draft.printerIds ?? [])
    .map(id => printers.find(p => p.id === id)?.name)
    .filter(Boolean)
  if (selected.length === 0) {
    return draft.printerRouting === 'also' ? 'Also: (none selected)' : 'Only: (none selected)'
  }
  return `${draft.printerRouting === 'also' ? 'Also' : 'Only'}: ${selected.join(', ')}`
}

function getCommissionSummary(draft: Modifier): string {
  if (!draft.commissionType || draft.commissionType === 'none') return ''
  const val = draft.commissionValue ?? 0
  return draft.commissionType === 'percent' ? `${val}% per sale` : `${formatCurrency(val)} per sale`
}

// ── Collapsible Section ────────────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = false,
  visible = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  visible?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!visible) return null
  return (
    <div className="border-t border-gray-200">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {title}
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

// ── Field Components ───────────────────────────────────────────────────────────

function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {helper && <p className="text-[11px] text-gray-400 mt-0.5">{helper}</p>}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
  large,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  large?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${large ? 'text-base font-semibold py-2' : ''} ${className}`}
    />
  )
}

function CurrencyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'}
        className="w-full rounded-md border border-gray-200 bg-white pl-7 pr-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
  step,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  step?: string
}) {
  return (
    <input
      type="number"
      step={step ?? 'any'}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  )
}

function Toggle({
  checked,
  onChange,
  label,
  color,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  color?: 'red' | 'yellow' | 'green' | 'blue'
}) {
  const colorMap = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
  }
  const dotColor = color && checked ? colorMap[color] : undefined
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? (color ? colorMap[color] : 'bg-blue-500') : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      {dotColor && checked && <span className={`h-2 w-2 rounded-full ${dotColor}`} />}
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ModifierDetailPanel({
  modifier,
  group,
  menuItemId,
  locationSettings,
  ingredients = [],
  printers = [],
  onSave,
  onDiscard,
}: ModifierDetailPanelProps) {
  // ── State ─────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Modifier>({ ...modifier })
  const [original, setOriginal] = useState<Modifier>({ ...modifier })
  const [saving, setSaving] = useState(false)
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [pendingSwitch, setPendingSwitch] = useState<Modifier | null>(null)
  const [showSwitchDialog, setShowSwitchDialog] = useState(false)
  const [stalePriceWarning, setStalePriceWarning] = useState(false)
  const errorBannerRef = useRef<HTMLDivElement>(null)
  const switchSavingRef = useRef(false)

  // Dirty check against original (not current prop)
  const isDirty = !eq(draft, original)

  // Validation (computed live)
  const { errors, warnings } = validateModifier(draft, group, stalePriceWarning)

  // ── Entity switch behavior ────────────────────────────────────────────
  useEffect(() => {
    if (modifier.id === original.id) return
    if (switchSavingRef.current) return // Guard against rapid switching during in-flight save

    const dirtyCheck = !eq(draft, original)
    if (!dirtyCheck) {
      // Clean switch
      setOriginal({ ...modifier })
      setDraft({ ...modifier })
      setIngredientSearch('')
      setStalePriceWarning(false)
      setPendingSwitch(null)
      setShowSwitchDialog(false)
      return
    }

    // Dirty — check validation
    const { errors: currentErrors } = validateModifier(draft, group, stalePriceWarning)
    if (currentErrors.length === 0) {
      // Auto-save then switch
      const changes = getChanges(draft, original)
      if (Object.keys(changes).length > 0) {
        switchSavingRef.current = true
        void onSave(original.id, changes)
          .then(() => {
            setOriginal({ ...modifier })
            setDraft({ ...modifier })
            setIngredientSearch('')
            setStalePriceWarning(false)
            setPendingSwitch(null)
          })
          .catch(() => {
            // Save failed — show switch dialog so user can discard or fix
            setPendingSwitch(modifier)
            setShowSwitchDialog(true)
          })
          .finally(() => {
            switchSavingRef.current = false
          })
      } else {
        setOriginal({ ...modifier })
        setDraft({ ...modifier })
        setIngredientSearch('')
        setStalePriceWarning(false)
        setPendingSwitch(null)
      }
      return
    }

    // Dirty + invalid — show prompt
    setPendingSwitch(modifier)
    setShowSwitchDialog(true)
  }, [modifier.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Staleness detection for swap targets ──────────────────────────────
  useEffect(() => {
    const targets = modifier.swapTargets ?? []
    if (targets.length === 0) {
      setStalePriceWarning(false)
      return
    }
    const ids = targets.map(t => t.menuItemId).join(',')
    void fetch(`/api/menu/items?ids=${encodeURIComponent(ids)}`)
      .then(r => r.ok ? r.json() : [])
      .then((items: Array<{ id: string; price: number }>) => {
        const stale = targets.some(t => {
          const current = items.find(i => i.id === t.menuItemId)
          return current != null && current.price !== t.snapshotPrice
        })
        setStalePriceWarning(stale)
      })
      .catch(() => {})
  }, [modifier.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Patch helper ──────────────────────────────────────────────────────
  const patch = useCallback((updates: Partial<Modifier>) => {
    setDraft(prev => {
      const next = { ...prev, ...updates }
      // Auto-clear isDefault when deactivating
      if (updates.isActive === false && prev.isDefault) {
        next.isDefault = false
      }
      return next
    })
  }, [])

  // ── Custom Pre-Modifier helpers ──────────────────────────────────────
  const addCustomPreMod = () => {
    const current = draft.customPreModifiers || []
    patch({
      customPreModifiers: [...current, {
        name: '',
        shortLabel: undefined,
        kitchenLabel: undefined,
        priceAdjustment: 0,
        multiplier: 1.0,
        sortOrder: current.length,
        isActive: true,
      }]
    })
  }

  const removeCustomPreMod = (idx: number) => {
    const current = [...(draft.customPreModifiers || [])]
    current.splice(idx, 1)
    current.forEach((c, i) => c.sortOrder = i)
    patch({ customPreModifiers: current.length > 0 ? current : null })
  }

  const updateCustomPreMod = (idx: number, field: keyof CustomPreMod, value: any) => {
    const current = [...(draft.customPreModifiers || [])]
    current[idx] = { ...current[idx], [field]: value }
    patch({ customPreModifiers: current })
  }

  const moveCustomPreMod = (idx: number, direction: number) => {
    const current = [...(draft.customPreModifiers || [])]
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= current.length) return
    ;[current[idx], current[newIdx]] = [current[newIdx], current[idx]]
    current.forEach((c, i) => c.sortOrder = i)
    patch({ customPreModifiers: current })
  }

  const toggleCustomPreModActive = (idx: number) => {
    const current = [...(draft.customPreModifiers || [])]
    current[idx] = { ...current[idx], isActive: !current[idx].isActive }
    patch({ customPreModifiers: current })
  }

  const applyPreset = (preset: string) => {
    const presets: Record<string, Array<{ name: string; shortLabel?: string }>> = {
      temperature: [
        { name: 'Rare', shortLabel: 'R' },
        { name: 'Medium Rare', shortLabel: 'MR' },
        { name: 'Medium', shortLabel: 'M' },
        { name: 'Medium Well', shortLabel: 'MW' },
        { name: 'Well Done', shortLabel: 'WD' },
      ],
      cook_style: [
        { name: 'Grilled' },
        { name: 'Fried' },
        { name: 'Baked' },
        { name: 'Blackened' },
        { name: 'Sautéed' },
      ],
      sauce: [
        { name: 'Extra Sauce', shortLabel: 'XS' },
        { name: 'No Sauce', shortLabel: 'NS' },
        { name: 'Sauce on Side', shortLabel: 'SoS' },
      ],
    }
    const items = presets[preset]
    if (!items) return
    const current = draft.customPreModifiers || []
    const newMods: CustomPreMod[] = items.map((item, i) => ({
      name: item.name,
      shortLabel: item.shortLabel,
      kitchenLabel: undefined,
      priceAdjustment: 0,
      multiplier: 1.0,
      sortOrder: current.length + i,
      isActive: true,
    }))
    patch({ customPreModifiers: [...current, ...newMods] })
  }

  // ── Save handler ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return

    const validation = validateModifier(draft, group, stalePriceWarning)
    if (validation.errors.length > 0) {
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }

    const changes = getChanges(draft, original)
    if (Object.keys(changes).length === 0) return

    // Strip out custom pre-mods with empty names (user added but didn't fill in)
    if (changes.customPreModifiers && Array.isArray(changes.customPreModifiers)) {
      changes.customPreModifiers = (changes.customPreModifiers as CustomPreMod[]).filter(c => c.name && c.name.trim() !== '')
      if (changes.customPreModifiers.length === 0) changes.customPreModifiers = null as any
    }

    // Refresh swap target snapshot prices before saving
    if (changes.swapTargets && Array.isArray(changes.swapTargets)) {
      const targets = changes.swapTargets as SwapTarget[]
      if (targets.length > 0) {
        try {
          const ids = targets.map(t => t.menuItemId).join(',')
          const res = await fetch(`/api/menu/items?ids=${encodeURIComponent(ids)}`)
          if (res.ok) {
            const items: Array<{ id: string; price: number }> = await res.json()
            changes.swapTargets = targets.map(t => {
              const current = items.find(i => i.id === t.menuItemId)
              return current ? { ...t, snapshotPrice: current.price } : t
            })
          }
        } catch { /* use existing prices */ }
      }
    }

    setSaving(true)
    try {
      await onSave(original.id, changes)
      // Update state to reflect saved data
      const savedDraft = {
        ...draft,
        ...(changes.swapTargets ? { swapTargets: changes.swapTargets as SwapTarget[] } : {}),
      }
      setOriginal(savedDraft)
      setDraft(savedDraft)
      setStalePriceWarning(false)

      // Execute pending switch if any
      if (pendingSwitch) {
        setOriginal({ ...pendingSwitch })
        setDraft({ ...pendingSwitch })
        setPendingSwitch(null)
        setShowSwitchDialog(false)
        setIngredientSearch('')
      }
    } finally {
      setSaving(false)
    }
  }, [isDirty, saving, draft, original, group, stalePriceWarning, onSave, pendingSwitch])

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onDiscard()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, onDiscard])

  // ── Switch dialog handlers ────────────────────────────────────────────
  const handleDiscardAndSwitch = useCallback(() => {
    if (!pendingSwitch) return
    setOriginal({ ...pendingSwitch })
    setDraft({ ...pendingSwitch })
    setPendingSwitch(null)
    setShowSwitchDialog(false)
    setIngredientSearch('')
    setStalePriceWarning(false)
  }, [pendingSwitch])

  const handleStayAndFix = useCallback(() => {
    // Hide dialog, keep pendingSwitch so handleSave will auto-switch after fix + save
    setShowSwitchDialog(false)
  }, [])

  // ── Derived values ────────────────────────────────────────────────────
  const cashDiscountPct = locationSettings?.cashDiscountPercent
  const showDualPricing = cashDiscountPct != null && cashDiscountPct > 0

  const filteredIngredients = ingredientSearch.trim()
    ? ingredients.filter(i => i.name.toLowerCase().includes(ingredientSearch.toLowerCase()))
    : ingredients

  const selectedIngredient = draft.ingredientId
    ? ingredients.find(i => i.id === draft.ingredientId)
    : null

  const hasAnyPreMod = draft.allowNo || draft.allowLite || draft.allowExtra || draft.allowOnSide || (draft.customPreModifiers ?? []).length > 0
  const swapTargets = draft.swapTargets ?? []

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 relative">
      {/* ── Sticky Header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900 truncate flex-1">
          {draft.name || 'Untitled Modifier'}
        </h2>
        {isDirty && (
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" title="Unsaved changes" />
        )}
        <span className="text-[11px] text-gray-400 shrink-0">{group.name}</span>
      </div>

      {/* ── Scrollable Body ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Error / Warning Banners ──────────────────────────────── */}
        {errors.length > 0 && (
          <div
            ref={errorBannerRef}
            className="mx-4 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 space-y-0.5"
          >
            {errors.map((err, i) => (
              <div key={i}>• {err}</div>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mx-4 mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400 space-y-0.5">
            {warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}

        {/* ── Section 1: General (always visible) ──────────────────── */}
        <div className="px-4 py-4 space-y-4">
          <Field label="Name">
            <TextInput
              value={draft.name}
              onChange={v => patch({ name: v })}
              placeholder="Modifier name"
              large
            />
          </Field>

          <Field label="Display Name">
            <TextInput
              value={draft.displayName ?? ''}
              onChange={v => patch({ displayName: v || null })}
              placeholder="POS display name override"
            />
          </Field>

          <div className="flex items-center gap-6">
            <Toggle
              checked={draft.isActive !== false}
              onChange={v => patch({ isActive: v })}
              label="Active"
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => patch({ isDefault: !draft.isDefault })}
                className={`text-lg ${draft.isDefault ? 'text-yellow-400' : 'text-gray-500'} hover:text-yellow-300 transition-colors`}
                title={draft.isDefault ? 'Default selection (click to remove)' : 'Set as default selection'}
              >
                {draft.isDefault ? '★' : '☆'}
              </button>
              <span className="text-sm text-gray-700">Default selection</span>
            </label>
          </div>

          {/* Pre-modifier toggles */}
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pre-Modifiers</p>

            <Toggle
              checked={draft.allowNo === true}
              onChange={v => patch({ allowNo: v })}
              label="No"
              color="red"
            />

            <div className="space-y-2">
              <Toggle
                checked={draft.allowLite === true}
                onChange={v => patch({ allowLite: v })}
                label="Lite"
                color="yellow"
              />
              {draft.allowLite && (
                <div className="ml-12">
                  <Field label="Lite Multiplier">
                    <NumberInput
                      value={draft.liteMultiplier != null ? String(draft.liteMultiplier) : ''}
                      onChange={v => patch({ liteMultiplier: parseNum(v) })}
                      placeholder="0.5"
                      step="0.1"
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Toggle
                checked={draft.allowExtra === true}
                onChange={v => patch({ allowExtra: v })}
                label="Extra"
                color="green"
              />
              {draft.allowExtra && (
                <div className="ml-12 space-y-2">
                  <Field label="Extra Multiplier">
                    <NumberInput
                      value={draft.extraMultiplier != null ? String(draft.extraMultiplier) : ''}
                      onChange={v => patch({ extraMultiplier: parseNum(v) })}
                      placeholder="2.0"
                      step="0.1"
                    />
                  </Field>
                  <Field label="Extra Price">
                    <CurrencyInput
                      value={currencyInput(draft.extraPrice)}
                      onChange={v => patch({ extraPrice: parseNum(v) ?? 0 })}
                    />
                  </Field>
                </div>
              )}
            </div>

            <Toggle
              checked={draft.allowOnSide === true}
              onChange={v => patch({ allowOnSide: v })}
              label="Side"
              color="blue"
            />
          </div>

          {/* Custom Pre-Modifiers */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Custom Pre-Modifiers</h4>
              <button
                type="button"
                onClick={addCustomPreMod}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Custom
              </button>
            </div>

            {/* Quick presets dropdown */}
            <div className="mb-2">
              <select
                onChange={(e) => { applyPreset(e.target.value); e.target.value = '' }}
                value=""
                className="text-xs rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-500 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Quick presets...</option>
                <option value="temperature">Temperature (Rare → Well Done)</option>
                <option value="cook_style">Cook Style (Grilled, Fried, Baked...)</option>
                <option value="sauce">Sauce Options (Extra, No, Side)</option>
              </select>
            </div>

            {/* Custom pre-mod rows */}
            {(draft.customPreModifiers || []).map((cpm, idx, arr) => (
              <div key={idx} className="flex items-start gap-2 p-2 bg-gray-50 rounded-md mb-1.5 text-sm border border-gray-100">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Name (e.g., Well Done)"
                      value={cpm.name}
                      onChange={e => updateCustomPreMod(idx, 'name', e.target.value)}
                      className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Label"
                        value={cpm.shortLabel || ''}
                        onChange={e => updateCustomPreMod(idx, 'shortLabel', e.target.value || undefined)}
                        maxLength={12}
                        className="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <span className={`absolute right-1 top-1 text-[9px] ${(cpm.shortLabel?.length || 0) > 8 ? ((cpm.shortLabel?.length || 0) > 12 ? 'text-red-500' : 'text-yellow-500') : 'text-gray-400'}`}>
                        {cpm.shortLabel?.length || 0}/8
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Kitchen label"
                      value={cpm.kitchenLabel || ''}
                      onChange={e => updateCustomPreMod(idx, 'kitchenLabel', e.target.value || undefined)}
                      className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="$0.00"
                      value={cpm.priceAdjustment ? (cpm.priceAdjustment / 100).toFixed(2) : ''}
                      onChange={e => updateCustomPreMod(idx, 'priceAdjustment', Math.round(parseFloat(e.target.value || '0') * 100))}
                      step="0.01"
                      className="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="1.0"
                      value={cpm.multiplier}
                      onChange={e => updateCustomPreMod(idx, 'multiplier', parseFloat(e.target.value || '1'))}
                      step="0.1"
                      min="0"
                      className="w-16 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveCustomPreMod(idx, -1)}
                    disabled={idx === 0}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCustomPreMod(idx, 1)}
                    disabled={idx === arr.length - 1}
                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => toggleCustomPreModActive(idx)}
                  className="p-0.5 shrink-0"
                  title={cpm.isActive ? 'Active' : 'Inactive'}
                >
                  {cpm.isActive ? <Eye className="w-3.5 h-3.5 text-green-500" /> : <EyeOff className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => removeCustomPreMod(idx)}
                  className="p-0.5 text-red-400 hover:text-red-300 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {(draft.customPreModifiers || []).length === 0 && (
              <p className="text-xs text-gray-400 italic">No custom pre-modifiers. Use presets or add manually.</p>
            )}
          </div>
        </div>

        {/* ── Section 2: Pricing ───────────────────────────────────── */}
        <Section title="Pricing" defaultOpen>
          <Field label="Price">
            <CurrencyInput
              value={currencyInput(draft.price)}
              onChange={v => patch({ price: parseNum(v) ?? 0 })}
            />
            {showDualPricing && draft.price > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                Cash: {formatCurrency(draft.price)} | Card: {formatCurrency(calculateCardPrice(draft.price, cashDiscountPct!))}
              </p>
            )}
          </Field>

          <Field label="Price Type">
            <SelectInput
              value={draft.priceType ?? 'upcharge'}
              onChange={v => patch({ priceType: v })}
              options={[
                { value: 'upcharge', label: 'Upcharge' },
                { value: 'flat', label: 'Flat' },
              ]}
            />
          </Field>

          <Field label="Extra Price">
            <CurrencyInput
              value={currencyInput(draft.extraPrice)}
              onChange={v => patch({ extraPrice: parseNum(v) ?? 0 })}
            />
          </Field>

          <Field label="Upsell Price" helper="Admin reference only (V1)">
            <CurrencyInput
              value={currencyInput(draft.upsellPrice)}
              onChange={v => patch({ upsellPrice: parseNum(v) })}
            />
          </Field>

          <Field label="Cost" helper="For margin tracking">
            <CurrencyInput
              value={currencyInput(draft.cost)}
              onChange={v => patch({ cost: parseNum(v) })}
            />
          </Field>

          <Field label="Commission Type">
            <SelectInput
              value={draft.commissionType ?? 'none'}
              onChange={v => patch({ commissionType: v === 'none' ? null : v, commissionValue: v === 'none' ? null : draft.commissionValue })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'fixed', label: 'Fixed' },
                { value: 'percent', label: 'Percent' },
              ]}
            />
          </Field>

          {draft.commissionType && draft.commissionType !== 'none' && (
            <Field label={draft.commissionType === 'fixed' ? '$ per sale' : '% per sale'}>
              <NumberInput
                value={draft.commissionValue != null ? String(draft.commissionValue) : ''}
                onChange={v => patch({ commissionValue: parseNum(v) })}
                placeholder={draft.commissionType === 'fixed' ? '0.00' : '0'}
                step={draft.commissionType === 'fixed' ? '0.01' : '1'}
              />
            </Field>
          )}
        </Section>

        {/* ── Section 3: Visibility ────────────────────────────────── */}
        <Section title="Visibility">
          <Toggle
            checked={draft.showOnPOS !== false}
            onChange={v => patch({ showOnPOS: v })}
            label="Visible to servers on POS"
          />
          <Toggle
            checked={draft.showOnline !== false}
            onChange={v => patch({ showOnline: v })}
            label="Visible for online ordering"
          />
          <Toggle
            checked={draft.showAsHotButton === true}
            onChange={v => patch({ showAsHotButton: v })}
            label="Quick-access button in POS modifier modal"
          />
        </Section>

        {/* ── Section 4: Routing & Inventory ───────────────────────── */}
        <Section title="Routing & Inventory">
          <Field label="Ingredient">
            {selectedIngredient ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-800">{selectedIngredient.name}</span>
                {selectedIngredient.category && (
                  <span className="text-[11px] text-gray-400">({selectedIngredient.category})</span>
                )}
                <button
                  type="button"
                  onClick={() => patch({ ingredientId: null, ingredientName: null })}
                  className="ml-auto text-xs text-gray-400 hover:text-red-400"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <TextInput
                  value={ingredientSearch}
                  onChange={setIngredientSearch}
                  placeholder="Search ingredients..."
                />
                {ingredientSearch.trim() && (
                  <div className="max-h-32 overflow-y-auto rounded border border-gray-200 bg-white">
                    {filteredIngredients.length === 0 ? (
                      <p className="p-2 text-xs text-gray-400">No matches</p>
                    ) : (
                      filteredIngredients.slice(0, 20).map(ing => (
                        <button
                          key={ing.id}
                          type="button"
                          onClick={() => {
                            patch({ ingredientId: ing.id, ingredientName: ing.name })
                            setIngredientSearch('')
                          }}
                          className="w-full text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          {ing.name}
                          {ing.category && <span className="text-gray-400 ml-1 text-xs">({ing.category})</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
                <p className="text-[11px] text-gray-400">None</p>
              </div>
            )}
          </Field>

          <Field label="Inventory Deduction Amount" helper="Blank = default 1 unit, 0 = no deduction on purpose">
            <NumberInput
              value={draft.inventoryDeductionAmount != null ? String(draft.inventoryDeductionAmount) : ''}
              onChange={v => patch({ inventoryDeductionAmount: parseNum(v) })}
              placeholder=""
              step="0.001"
            />
          </Field>

          {draft.inventoryDeductionAmount != null && (
            <Field label="Deduction Unit">
              <SelectInput
                value={draft.inventoryDeductionUnit ?? 'unit'}
                onChange={v => patch({ inventoryDeductionUnit: v })}
                options={[
                  { value: 'oz', label: 'oz' },
                  { value: 'ml', label: 'ml' },
                  { value: 'unit', label: 'unit' },
                  { value: 'g', label: 'g' },
                ]}
              />
            </Field>
          )}

          <Field label="Linked Menu Item ID">
            <TextInput
              value={draft.linkedMenuItemId ?? ''}
              onChange={v => patch({ linkedMenuItemId: v || null })}
              placeholder="Menu item ID"
            />
          </Field>

          <Field label="Printer Routing">
            <SelectInput
              value={draft.printerRouting ?? 'follow'}
              onChange={v => patch({ printerRouting: v })}
              options={[
                { value: 'follow', label: 'Follow parent item' },
                { value: 'also', label: 'Also send to...' },
                { value: 'only', label: 'Only send to...' },
              ]}
            />
          </Field>

          {draft.printerRouting && draft.printerRouting !== 'follow' && printers.length > 0 && (
            <Field label="Select Printers">
              <div className="space-y-1.5">
                {printers.map(p => {
                  const checked = (draft.printerIds ?? []).includes(p.id)
                  return (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const current = draft.printerIds ?? []
                          const next = checked
                            ? current.filter(id => id !== p.id)
                            : [...current, p.id]
                          patch({ printerIds: next })
                        }}
                        className="h-4 w-4 rounded border-gray-300 bg-white text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <span className="text-sm text-gray-700">{p.name}</span>
                    </label>
                  )
                })}
              </div>
            </Field>
          )}
        </Section>

        {/* ── Section 5: Swap Options ──────────────────────────────── */}
        <Section title="Swap Options">
          <Toggle
            checked={draft.swapEnabled === true}
            onChange={v => patch({ swapEnabled: v })}
            label="Allow swap at POS"
          />
          {draft.swapEnabled && (
            <SwapTargetPicker
              targets={draft.swapTargets || []}
              onChange={(targets) => patch({ swapTargets: targets })}
              menuItemId={menuItemId}
            />
          )}
        </Section>
      </div>

      {/* ── Effective Preview ──────────────────────────────────────── */}
      <div className="border-t border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500 space-y-0.5">
        <div className="font-medium text-gray-700 text-[11px] uppercase tracking-wider">Effective Preview</div>
        <div>
          Visible on POS: {draft.showOnPOS !== false ? 'Yes' : 'No'}
          {' | '}Online: {draft.showOnline !== false ? 'Yes' : 'No'}
          {' | '}Hot Button: {draft.showAsHotButton ? 'Yes' : 'No'}
        </div>
        {hasAnyPreMod && <div>Pre-mods: {getPreModSummary(draft)}</div>}
        {draft.swapEnabled && swapTargets.length > 0 && (
          <div>Swaps to: {getSwapSummary(swapTargets)}</div>
        )}
        <div>Prints to: {getRoutingSummary(draft, printers)}</div>
        {draft.commissionType && draft.commissionType !== 'none' && (
          <div>Commission: {getCommissionSummary(draft)}</div>
        )}
        {draft.linkedMenuItemId && (
          <div>Linked item: {draft.linkedMenuItemId}</div>
        )}
      </div>

      {/* ── Sticky Footer ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          disabled={!isDirty || saving || errors.length > 0}
          onClick={handleSave}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            isDirty && !saving && errors.length === 0
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving...' : errors.length > 0 && isDirty ? 'Fix Errors' : 'Save'}
          <span className="ml-1 text-[11px] opacity-60">({navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+S)</span>
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-white hover:text-gray-800 transition-colors"
        >
          Discard
          <span className="ml-1 text-[11px] opacity-60">(Esc)</span>
        </button>
      </div>

      {/* ── Switch Prompt Dialog (overlay) ─────────────────────────── */}
      {showSwitchDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-w-sm rounded-lg border border-gray-300 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Unsaved Changes with Errors</h3>
            <p className="text-xs text-gray-500 mb-4">
              Your changes have validation errors that must be fixed before saving.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDiscardAndSwitch}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleStayAndFix}
                className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
              >
                Stay and Fix
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
