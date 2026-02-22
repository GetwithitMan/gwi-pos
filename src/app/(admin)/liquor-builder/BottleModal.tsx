'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { SPIRIT_TIERS, LIQUOR_DEFAULTS } from '@/lib/constants'
import { SpiritCategory, BottleProduct } from './types'

// ─── Beer sizes by container type ───────────────────────────────────────────
const BEER_SIZES = {
  can: [
    { value: 355,  label: '12 oz  ·  Standard Can' },
    { value: 473,  label: '16 oz  ·  Tallboy / Pint Can' },
    { value: 568,  label: '19.2 oz  ·  Imperial Pint' },
    { value: 710,  label: '24 oz  ·  Large Can' },
  ],
  bottle: [
    { value: 355,  label: '12 oz  ·  Standard Bottle' },
    { value: 651,  label: '22 oz  ·  Bomber' },
  ],
  draft: [
    { value: 296,  label: '10 oz  ·  Snifter' },
    { value: 355,  label: '12 oz  ·  Short Pour' },
    { value: 473,  label: '16 oz  ·  Pint' },
    { value: 568,  label: '19.2 oz  ·  Imperial Pint' },
    { value: 710,  label: '24 oz  ·  Large Pour' },
    { value: 946,  label: '32 oz  ·  Growler Fill' },
  ],
}

const BEER_STYLES = [
  { value: 'domestic', label: 'Domestic',    emoji: '🇺🇸' },
  { value: 'import',   label: 'Import',      emoji: '🌍' },
  { value: 'craft',    label: 'Craft',       emoji: '🍺' },
  { value: 'seltzer',  label: 'Hard Seltzer', emoji: '💧' },
  { value: 'na',       label: 'N/A Beer',    emoji: '🚫' },
]

// ─── Wine sizes ──────────────────────────────────────────────────────────────
const WINE_SIZES = [
  { value: 187,  label: '187 mL  ·  Split  (2 glasses)' },
  { value: 375,  label: '375 mL  ·  Half Bottle  (2.5 glasses)' },
  { value: 750,  label: '750 mL  ·  Standard Bottle  (5 glasses)' },
  { value: 1500, label: '1500 mL  ·  Magnum  (10 glasses)' },
  { value: 3000, label: '3000 mL  ·  Double Magnum  (20 glasses)' },
]

const WINE_TYPES = [
  { value: 'red',      label: 'Red',      emoji: '🍷' },
  { value: 'white',    label: 'White',    emoji: '🥂' },
  { value: 'rose',     label: 'Rosé',     emoji: '🌸' },
  { value: 'sparkling',label: 'Sparkling',emoji: '🍾' },
  { value: 'dessert',  label: 'Dessert',  emoji: '🍯' },
]

// ─── Spirit bottle sizes ─────────────────────────────────────────────────────
const SPIRIT_SIZES = [
  { value: 50,   label: '50 mL  ·  Mini / Shot' },
  { value: 200,  label: '200 mL  ·  Half Pint' },
  { value: 375,  label: '375 mL  ·  Pint' },
  { value: 750,  label: '750 mL  ·  Fifth  (Standard)' },
  { value: 1000, label: '1000 mL  ·  Liter' },
  { value: 1750, label: '1750 mL  ·  Handle  (1.75 L)' },
]

// ─── Shared pour sizes for spirits/wine (presets) ───────────────────────────
const SPIRIT_POUR_PRESETS = [
  { oz: 1.0,  label: '1 oz' },
  { oz: 1.5,  label: '1.5 oz  (standard)' },
  { oz: 2.0,  label: '2 oz' },
]
const WINE_POUR_PRESETS = [
  { oz: 3,  label: '3 oz  (tasting)' },
  { oz: 5,  label: '5 oz  (standard)' },
  { oz: 6,  label: '6 oz  (generous)' },
  { oz: 8,  label: '8 oz  (large)' },
]

export interface BottleModalProps {
  bottle: BottleProduct | null
  categories: SpiritCategory[]
  onSave: (data: any) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  onMenuItemChange?: () => void
  /** Pre-fill defaults when creating a variant bottle in the same product group */
  defaultValues?: { brand?: string; spiritCategoryId?: string; tier?: string }
}

export function BottleModal({
  bottle,
  categories,
  onSave,
  onDelete,
  onClose,
  onMenuItemChange,
  defaultValues,
}: BottleModalProps) {
  // Core fields — use defaultValues for pre-filling variant bottles
  const [name, setName]                   = useState(bottle?.name || '')
  const [brand, setBrand]                 = useState(bottle?.brand || defaultValues?.brand || '')
  const [spiritCategoryId, setSpiritCategoryId] = useState(bottle?.spiritCategoryId || defaultValues?.spiritCategoryId || categories[0]?.id || '')
  const [tier, setTier]                   = useState(bottle?.tier || defaultValues?.tier || 'well')
  const [bottleSizeMl, setBottleSizeMl]   = useState(bottle?.bottleSizeMl?.toString() || '750')
  const [unitCost, setUnitCost]           = useState(bottle?.unitCost?.toString() || '')
  const [pourSizeOz, setPourSizeOz]       = useState(bottle?.pourSizeOz?.toString() || '')
  const [currentStock, setCurrentStock]   = useState(bottle?.currentStock?.toString() || '0')
  const [lowStockAlert, setLowStockAlert] = useState(bottle?.lowStockAlert?.toString() || '')
  const [isActive, setIsActive]           = useState(bottle?.isActive ?? true)
  const [saving, setSaving]               = useState(false)

  // Category-specific fields
  const [containerType, setContainerType]   = useState(bottle?.containerType || 'bottle')
  const [alcoholSubtype, setAlcoholSubtype] = useState(bottle?.alcoholSubtype || '')
  const [vintage, setVintage]               = useState(bottle?.vintage?.toString() || '')

  // POS Menu state
  const [showOnPOS, setShowOnPOS]   = useState(bottle?.hasMenuItem ?? false)
  const [menuPrice, setMenuPrice]   = useState(bottle?.linkedMenuItems?.[0]?.price?.toString() || '')
  const [savingMenu, setSavingMenu] = useState(false)

  // Track whether the category change is user-initiated (not first render)
  const isFirstRender = useRef(true)

  // ─── Derived category info ────────────────────────────────────────────────
  const selectedCategory = categories.find(c => c.id === spiritCategoryId)
  const categoryName = selectedCategory?.name || ''
  const isBeer  = categoryName === 'Beer'
  const isWine  = categoryName === 'Wine'

  // Tier options are relabeled based on category so they make sense to the user
  const tierOptions = isBeer
    ? [
        { value: 'well',      label: 'Domestic',       description: 'House domestic beers' },
        { value: 'call',      label: 'Import',          description: 'Imported beers' },
        { value: 'premium',   label: 'Craft',           description: 'Craft & specialty beers' },
        { value: 'top_shelf', label: 'Premium Craft',   description: 'High-end / limited craft' },
      ]
    : isWine
    ? [
        { value: 'well',      label: 'House',           description: 'House / table wines' },
        { value: 'call',      label: 'By the Glass',    description: 'Standard glass pours' },
        { value: 'premium',   label: 'Reserve',         description: 'Premium bottles' },
        { value: 'top_shelf', label: 'Cellar Select',   description: 'High-end / collector wines' },
      ]
    : SPIRIT_TIERS.map(t => ({ value: t.value, label: t.label, description: t.description }))

  // When user changes category, set smart defaults
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (isBeer) {
      setBottleSizeMl('355')
      setContainerType('can')
      setPourSizeOz('')
      setAlcoholSubtype('')
      setVintage('')
    } else if (isWine) {
      setBottleSizeMl('750')
      setContainerType('bottle')
      setPourSizeOz('5')
      setAlcoholSubtype('')
      setVintage('')
    } else {
      setBottleSizeMl('750')
      setContainerType('bottle')
      setPourSizeOz('')
      setAlcoholSubtype('')
      setVintage('')
    }
  }, [spiritCategoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When beer container type changes, pick first matching size
  useEffect(() => {
    if (!isBeer) return
    const sizes = BEER_SIZES[containerType as keyof typeof BEER_SIZES]
    if (sizes && !sizes.find(s => s.value.toString() === bottleSizeMl)) {
      setBottleSizeMl(sizes[0].value.toString())
    }
  }, [containerType]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Available sizes for the current mode ────────────────────────────────
  const availableSizes = isBeer
    ? (BEER_SIZES[containerType as keyof typeof BEER_SIZES] || BEER_SIZES.can)
    : isWine
    ? WINE_SIZES
    : SPIRIT_SIZES

  // ─── Calculated metrics ───────────────────────────────────────────────────
  const bottleMl = parseInt(bottleSizeMl) || 0
  const cost     = parseFloat(unitCost) || 0
  const ML_PER_OZ = LIQUOR_DEFAULTS.mlPerOz

  let effectivePourSizeOz: number
  let poursPerBottle: number
  let pourCost: number

  if (isBeer) {
    // Beer: 1 container = 1 serve
    effectivePourSizeOz = bottleMl / ML_PER_OZ
    poursPerBottle = 1
    pourCost = cost
  } else {
    const defaultPour = isWine ? 5 : LIQUOR_DEFAULTS.pourSizeOz
    effectivePourSizeOz = pourSizeOz ? parseFloat(pourSizeOz) : defaultPour
    poursPerBottle = bottleMl > 0 ? Math.floor(bottleMl / (effectivePourSizeOz * ML_PER_OZ)) : 0
    pourCost = poursPerBottle > 0 ? cost / poursPerBottle : 0
  }

  const bottleOz = Math.round((bottleMl / ML_PER_OZ) * 10) / 10

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !spiritCategoryId || !bottleSizeMl || !unitCost) return
    setSaving(true)
    await onSave({
      name: name.trim(),
      brand: brand.trim() || undefined,
      spiritCategoryId,
      tier,
      bottleSizeMl: parseInt(bottleSizeMl),
      unitCost: parseFloat(unitCost),
      pourSizeOz: isBeer
        ? undefined
        : pourSizeOz ? parseFloat(pourSizeOz) : undefined,
      currentStock: parseInt(currentStock) || 0,
      lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : undefined,
      isActive,
      containerType: isBeer ? containerType : 'bottle',
      alcoholSubtype: alcoholSubtype || undefined,
      vintage: isWine && vintage ? parseInt(vintage) : undefined,
    })
    setSaving(false)
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────
  const marginPct = menuPrice && parseFloat(menuPrice) > 0 && pourCost > 0
    ? (((parseFloat(menuPrice) - pourCost) / parseFloat(menuPrice)) * 100).toFixed(0)
    : null

  const marginColor = marginPct
    ? parseInt(marginPct) >= 70 ? 'text-green-600' : parseInt(marginPct) >= 55 ? 'text-yellow-600' : 'text-red-500'
    : ''

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Modal isOpen={true} onClose={onClose} title={bottle ? 'Edit Bottle' : 'Add to Inventory'} size="2xl">
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Name + Brand ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={isBeer ? 'e.g., Bud Light' : isWine ? 'e.g., House Cabernet' : 'e.g., Patron Silver'}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Brand</label>
            <input
              type="text"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={isBeer ? 'e.g., Anheuser-Busch' : isWine ? 'e.g., Josh Cellars' : 'e.g., Patron'}
            />
          </div>
        </div>

        {/* ── Category + Tier ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category *</label>
            <select
              value={spiritCategoryId}
              onChange={e => setSpiritCategoryId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              required
            >
              <option value="">Select Category</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tier *</label>
            <select
              value={tier}
              onChange={e => setTier(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              {tierOptions.map(t => (
                <option key={t.value} value={t.value}>{t.label} – {t.description}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            BEER MODE
        ═══════════════════════════════════════════════════════════════════ */}
        {isBeer && (
          <>
            {/* Container Type — big tap buttons */}
            <div>
              <label className="block text-sm font-semibold mb-2">Container Type</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'can',    label: 'Can',    emoji: '🥫', hint: 'Canned beer' },
                  { value: 'bottle', label: 'Bottle', emoji: '🍺', hint: 'Glass bottle' },
                  { value: 'draft',  label: 'Draft',  emoji: '🍻', hint: 'Tap / keg' },
                ].map(ct => (
                  <button
                    key={ct.value}
                    type="button"
                    onClick={() => setContainerType(ct.value)}
                    className={`py-3 px-2 rounded-lg border-2 font-medium text-sm transition-all text-center ${
                      containerType === ct.value
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-gray-200 hover:border-amber-300 text-gray-600'
                    }`}
                  >
                    <div className="text-2xl mb-1">{ct.emoji}</div>
                    <div className="font-semibold">{ct.label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{ct.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Beer Style */}
            <div>
              <label className="block text-sm font-semibold mb-2">Beer Style</label>
              <div className="flex flex-wrap gap-2">
                {BEER_STYLES.map(style => (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => setAlcoholSubtype(alcoholSubtype === style.value ? '' : style.value)}
                    className={`px-4 py-2 rounded-full border-2 text-sm font-medium transition-all ${
                      alcoholSubtype === style.value
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-gray-200 hover:border-amber-300 text-gray-600'
                    }`}
                  >
                    {style.emoji} {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Size + Cost */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {containerType === 'draft' ? 'Pour Size' : containerType === 'can' ? 'Can Size' : 'Bottle Size'}
                </label>
                <select
                  value={bottleSizeMl}
                  onChange={e => setBottleSizeMl(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {availableSizes.map(size => (
                    <option key={size.value} value={size.value}>{size.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Your Cost per {containerType === 'draft' ? 'Pour' : containerType === 'can' ? 'Can' : 'Bottle'} ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost}
                  onChange={e => setUnitCost(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., 1.60"
                  required
                />
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            WINE MODE
        ═══════════════════════════════════════════════════════════════════ */}
        {isWine && (
          <>
            {/* Wine Type — big tap buttons */}
            <div>
              <label className="block text-sm font-semibold mb-2">Wine Type</label>
              <div className="grid grid-cols-5 gap-2">
                {WINE_TYPES.map(wt => (
                  <button
                    key={wt.value}
                    type="button"
                    onClick={() => setAlcoholSubtype(wt.value)}
                    className={`py-3 px-1 rounded-lg border-2 font-medium text-xs transition-all text-center ${
                      alcoholSubtype === wt.value
                        ? 'border-purple-500 bg-purple-50 text-purple-800'
                        : 'border-gray-200 hover:border-purple-300 text-gray-600'
                    }`}
                  >
                    <div className="text-2xl mb-1">{wt.emoji}</div>
                    <div className="font-semibold">{wt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Bottle Size + Vintage + Pour Size */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Bottle Size</label>
                <select
                  value={bottleSizeMl}
                  onChange={e => setBottleSizeMl(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {availableSizes.map(size => (
                    <option key={size.value} value={size.value}>{size.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Vintage Year</label>
                <input
                  type="number"
                  min="1900"
                  max={new Date().getFullYear()}
                  value={vintage}
                  onChange={e => setVintage(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., 2022"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Pour Size (oz)</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  value={pourSizeOz}
                  onChange={e => setPourSizeOz(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="5 oz (standard)"
                />
                {/* Quick presets */}
                <div className="flex gap-1 mt-1">
                  {WINE_POUR_PRESETS.map(p => (
                    <button
                      key={p.oz}
                      type="button"
                      onClick={() => setPourSizeOz(p.oz.toString())}
                      className={`flex-1 text-xs py-1 rounded border transition-colors ${
                        pourSizeOz === p.oz.toString()
                          ? 'bg-purple-100 border-purple-400 text-purple-700 font-semibold'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {p.oz}oz
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Cost */}
            <div>
              <label className="block text-sm font-medium mb-1">Your Cost per Bottle ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., 8.00"
                required
              />
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SPIRIT MODE (default)
        ═══════════════════════════════════════════════════════════════════ */}
        {!isBeer && !isWine && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bottle Size *</label>
              <select
                value={bottleSizeMl}
                onChange={e => setBottleSizeMl(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {availableSizes.map(size => (
                  <option key={size.value} value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit Cost ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., 42.99"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pour Size (oz)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={pourSizeOz}
                onChange={e => setPourSizeOz(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder={`Default: ${LIQUOR_DEFAULTS.pourSizeOz}`}
              />
              {/* Quick presets */}
              <div className="flex gap-1 mt-1">
                {SPIRIT_POUR_PRESETS.map(p => (
                  <button
                    key={p.oz}
                    type="button"
                    onClick={() => setPourSizeOz(p.oz.toString())}
                    className={`flex-1 text-xs py-1 rounded border transition-colors ${
                      pourSizeOz === p.oz.toString()
                        ? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Calculated Metrics ────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-900 mb-3">
            {isBeer ? '📊 Cost Breakdown' : isWine ? '🍷 Pour Analysis' : '📊 Yield & Cost'}
          </h4>
          {isBeer ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Cost per Serve:</span>
                <span className="ml-2 font-bold text-green-600 text-base">{formatCurrency(pourCost)}</span>
              </div>
              <div>
                <span className="text-blue-700">Container:</span>
                <span className="ml-2 font-bold text-blue-900">
                  {containerType === 'can' ? 'Can' : containerType === 'bottle' ? 'Bottle' : 'Draft'} · {bottleOz} oz
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-blue-700">{isWine ? 'Glasses / Bottle:' : 'Pours / Bottle:'}</span>
                <span className="ml-2 font-bold text-blue-900 text-base">{poursPerBottle}</span>
              </div>
              <div>
                <span className="text-blue-700">Cost per Pour:</span>
                <span className="ml-2 font-bold text-green-600 text-base">{formatCurrency(pourCost)}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Size:</span>
                <span className="ml-2 font-bold text-blue-900 text-base">{effectivePourSizeOz} oz</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Stock ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Current Stock ({isBeer ? 'units on hand' : 'bottles on hand'})
            </label>
            <input
              type="number"
              min="0"
              value={currentStock}
              onChange={e => setCurrentStock(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Low Stock Alert  <span className="text-gray-400 font-normal">(alert below X {isBeer ? 'units' : 'bottles'})</span>
            </label>
            <input
              type="number"
              min="0"
              value={lowStockAlert}
              onChange={e => setLowStockAlert(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., 2"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">Active</span>
          </label>
        </div>

        {/* ── Show on POS Menu ──────────────────────────────────────────── */}
        {bottle && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-purple-900">Show on POS Menu</h4>
                <p className="text-xs text-purple-600 mt-0.5">Appears as a menu item bartenders can ring up</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!showOnPOS) {
                    if (!menuPrice || parseFloat(menuPrice) <= 0) {
                      const suggested = pourCost > 0 ? Math.ceil(pourCost / 0.25) : 0
                      setMenuPrice(suggested.toString())
                    }
                    setShowOnPOS(true)
                  } else {
                    if (bottle.linkedMenuItems?.[0]?.id) {
                      setSavingMenu(true)
                      await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                      })
                      setSavingMenu(false)
                      onMenuItemChange?.()
                    }
                    setShowOnPOS(false)
                    setMenuPrice('')
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  showOnPOS ? 'bg-purple-600' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  showOnPOS ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {showOnPOS && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-purple-800 mb-1">Sell Price *</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.25"
                      value={menuPrice}
                      onChange={e => setMenuPrice(e.target.value)}
                      className="flex-1 border rounded-lg px-3 py-2"
                      placeholder="e.g., 8.00"
                    />
                    <button
                      type="button"
                      disabled={savingMenu || !menuPrice || parseFloat(menuPrice) <= 0}
                      onClick={async () => {
                        if (!menuPrice || parseFloat(menuPrice) <= 0) return
                        setSavingMenu(true)
                        if (bottle.linkedMenuItems?.[0]?.id) {
                          await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ price: parseFloat(menuPrice) }),
                          })
                        } else {
                          await fetch(`/api/liquor/bottles/${bottle.id}/create-menu-item`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ price: parseFloat(menuPrice) }),
                          })
                        }
                        setSavingMenu(false)
                        onMenuItemChange?.()
                      }}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
                    >
                      {savingMenu ? '...' : bottle.hasMenuItem ? 'Update' : 'Add to POS'}
                    </button>
                  </div>
                </div>

                {menuPrice && parseFloat(menuPrice) > 0 && pourCost > 0 && (
                  <div className="text-sm text-purple-700">
                    Margin:{' '}
                    <span className={`font-bold ${marginColor}`}>{marginPct}%</span>
                    {' '}(Profit: {formatCurrency(parseFloat(menuPrice) - pourCost)} per {isBeer ? 'unit' : isWine ? 'glass' : 'pour'})
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex justify-between pt-4 border-t">
          <div>
            {onDelete && (
              <Button type="button" variant="danger" onClick={onDelete}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !name.trim() || !spiritCategoryId || !unitCost}
            >
              {saving ? 'Saving...' : bottle ? 'Save Changes' : 'Add to Inventory'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
