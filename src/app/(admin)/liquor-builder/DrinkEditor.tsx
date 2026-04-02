'use client'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { RecipeBuilder } from '@/components/menu/RecipeBuilder'
import { ModifierFlowEditor } from '@/components/menu/ModifierFlowEditor'
import { SPIRIT_TIERS, BOTTLE_SIZES } from '@/lib/constants'
import { SpiritCategory, BottleProduct } from './types'
import { SpiritTierPanel, SpiritEntry } from './SpiritTierPanel'
import { PourSizeEditor } from './PourSizeEditor'
import { ML_PER_OZ, PourSizeConfig, TIER_BADGE_COLORS, getTierBadgeText } from './liquor-builder-utils'

export interface DrinkEditorProps {
  selectedDrink: any
  editingDrinkName: string
  editingDrinkPrice: string
  savingDrink: boolean
  enabledPourSizes: Record<string, PourSizeConfig>
  defaultPourSize: string
  applyPourToModifiers: boolean
  hideDefaultOnPos: boolean
  isDualPricingEnabled: boolean
  cashDiscountPct: number
  spiritEntries: SpiritEntry[]
  savingSpirit: boolean
  bottles: BottleProduct[]
  categories: SpiritCategory[]
  drinkModifierGroups: any[]
  modGroupRefreshKey: number
  selectedModGroupId: string | null
  editingPourSize: string
  savingPourSize: boolean
  showBottleLinkPicker: boolean
  bottleLinkSearch: string
  linkingBottle: boolean
  expandedPickerCats: Set<string>
  recipeExpanded: boolean
  locationId: string
  // Inline bottle creation state
  showInlineBottleForm: boolean
  inlineBottleName: string
  inlineBottleBrand: string
  inlineBottleCategoryId: string
  inlineBottleTier: string
  inlineBottleSizeMl: string
  inlineBottleCost: string
  creatingInlineBottle: boolean
  // Setters
  setEditingDrinkName: (v: string) => void
  setEditingDrinkPrice: (v: string) => void
  setEnabledPourSizes: React.Dispatch<React.SetStateAction<Record<string, PourSizeConfig>>>
  setDefaultPourSize: (v: string) => void
  setApplyPourToModifiers: (v: boolean) => void
  setHideDefaultOnPos: (v: boolean) => void
  setSelectedModGroupId: (v: string | null) => void
  setModGroupRefreshKey: React.Dispatch<React.SetStateAction<number>>
  setEditingPourSize: (v: string) => void
  setShowBottleLinkPicker: (v: boolean) => void
  setBottleLinkSearch: (v: string) => void
  setExpandedPickerCats: React.Dispatch<React.SetStateAction<Set<string>>>
  setRecipeExpanded: React.Dispatch<React.SetStateAction<boolean>>
  setShowInlineBottleForm: (v: boolean) => void
  setInlineBottleName: (v: string) => void
  setInlineBottleBrand: (v: string) => void
  setInlineBottleCategoryId: (v: string) => void
  setInlineBottleTier: (v: string) => void
  setInlineBottleSizeMl: (v: string) => void
  setInlineBottleCost: (v: string) => void
  // Callbacks
  onSaveDrink: () => Promise<void>
  onToggleAvailability: () => Promise<void>
  onRemoveDrink: () => Promise<void>
  onLinkBottle: (bottleId: string) => Promise<void>
  onUnlinkBottle: () => Promise<void>
  onSavePourSize: () => Promise<void>
  onCreateInlineBottle: () => Promise<void>
  onTogglePourSize: (size: string) => void
  onUpdatePourSizeLabel: (size: string, label: string) => void
  onUpdatePourSizeMultiplier: (size: string, multiplier: number) => void
  onUpdatePourSizeCustomPrice: (size: string, customPrice: number | null) => void
  onAddSpiritBottle: (tier: string, bottleId: string) => void
  onUpdateSpiritEntryPrice: (modifierId: string, price: number) => void
  onRemoveSpiritEntry: (modifierId: string) => void
  onSetSpiritEntryDefault: (modifierId: string) => void
  reloadDrinkModifiers: (itemId: string) => Promise<void>
}

export function DrinkEditor({
  selectedDrink,
  editingDrinkName,
  editingDrinkPrice,
  savingDrink,
  enabledPourSizes,
  defaultPourSize,
  applyPourToModifiers,
  hideDefaultOnPos,
  isDualPricingEnabled,
  cashDiscountPct,
  spiritEntries,
  savingSpirit,
  bottles,
  categories,
  drinkModifierGroups,
  modGroupRefreshKey,
  selectedModGroupId,
  editingPourSize,
  savingPourSize,
  showBottleLinkPicker,
  bottleLinkSearch,
  linkingBottle,
  expandedPickerCats,
  recipeExpanded,
  locationId,
  showInlineBottleForm,
  inlineBottleName,
  inlineBottleBrand,
  inlineBottleCategoryId,
  inlineBottleTier,
  inlineBottleSizeMl,
  inlineBottleCost,
  creatingInlineBottle,
  setEditingDrinkName,
  setEditingDrinkPrice,
  setEnabledPourSizes,
  setDefaultPourSize,
  setApplyPourToModifiers,
  setHideDefaultOnPos,
  setSelectedModGroupId,
  setModGroupRefreshKey,
  setEditingPourSize,
  setShowBottleLinkPicker,
  setBottleLinkSearch,
  setExpandedPickerCats,
  setRecipeExpanded,
  setShowInlineBottleForm,
  setInlineBottleName,
  setInlineBottleBrand,
  setInlineBottleCategoryId,
  setInlineBottleTier,
  setInlineBottleSizeMl,
  setInlineBottleCost,
  onSaveDrink,
  onToggleAvailability,
  onRemoveDrink,
  onLinkBottle,
  onUnlinkBottle,
  onSavePourSize,
  onCreateInlineBottle,
  onTogglePourSize,
  onUpdatePourSizeLabel,
  onUpdatePourSizeMultiplier,
  onUpdatePourSizeCustomPrice,
  onAddSpiritBottle,
  onUpdateSpiritEntryPrice,
  onRemoveSpiritEntry,
  onSetSpiritEntryDefault,
  reloadDrinkModifiers,
}: DrinkEditorProps) {
  return (
    <>
      {/* Item Editor Card */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Item Details</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={editingDrinkName}
              onChange={e => setEditingDrinkName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editingDrinkPrice}
                onChange={e => setEditingDrinkPrice(e.target.value)}
                className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            {isDualPricingEnabled && parseFloat(editingDrinkPrice) > 0 && (
              <p className="text-xs text-indigo-400 mt-1">Card: ${calculateCardPrice(parseFloat(editingDrinkPrice) || 0, cashDiscountPct).toFixed(2)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 86 toggle */}
            <button
              onClick={onToggleAvailability}
              className={`px-3 py-1.5 rounded text-xs font-medium border ${
                selectedDrink.isAvailable
                  ? 'border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600'
                  : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              {selectedDrink.isAvailable ? '⊘ 86 Item' : '✓ Un-86 Item'}
            </button>
            {/* Remove from POS */}
            <button
              onClick={onRemoveDrink}
              className="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 text-gray-900 hover:border-red-400 hover:text-red-600"
            >
              ✕ Remove
            </button>
          </div>
          <Button
            size="sm"
            onClick={onSaveDrink}
            disabled={savingDrink || (!editingDrinkName.trim())}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {savingDrink ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Linked Bottle */}
      {selectedDrink.linkedBottleProductId ? (
        <LinkedBottleCard
          selectedDrink={selectedDrink}
          editingPourSize={editingPourSize}
          editingDrinkPrice={editingDrinkPrice}
          savingPourSize={savingPourSize}
          linkingBottle={linkingBottle}
          isDualPricingEnabled={isDualPricingEnabled}
          cashDiscountPct={cashDiscountPct}
          setEditingPourSize={setEditingPourSize}
          onSavePourSize={onSavePourSize}
          onUnlinkBottle={onUnlinkBottle}
        />
      ) : (
        <BottleLinkPicker
          selectedDrink={selectedDrink}
          showBottleLinkPicker={showBottleLinkPicker}
          bottleLinkSearch={bottleLinkSearch}
          linkingBottle={linkingBottle}
          expandedPickerCats={expandedPickerCats}
          bottles={bottles}
          categories={categories}
          showInlineBottleForm={showInlineBottleForm}
          inlineBottleName={inlineBottleName}
          inlineBottleBrand={inlineBottleBrand}
          inlineBottleCategoryId={inlineBottleCategoryId}
          inlineBottleTier={inlineBottleTier}
          inlineBottleSizeMl={inlineBottleSizeMl}
          inlineBottleCost={inlineBottleCost}
          creatingInlineBottle={creatingInlineBottle}
          setShowBottleLinkPicker={setShowBottleLinkPicker}
          setBottleLinkSearch={setBottleLinkSearch}
          setExpandedPickerCats={setExpandedPickerCats}
          setShowInlineBottleForm={setShowInlineBottleForm}
          setInlineBottleName={setInlineBottleName}
          setInlineBottleBrand={setInlineBottleBrand}
          setInlineBottleCategoryId={setInlineBottleCategoryId}
          setInlineBottleTier={setInlineBottleTier}
          setInlineBottleSizeMl={setInlineBottleSizeMl}
          setInlineBottleCost={setInlineBottleCost}
          onLinkBottle={onLinkBottle}
          onCreateInlineBottle={onCreateInlineBottle}
        />
      )}

      {/* Pour Size Buttons */}
      <div className="bg-white rounded-lg border p-5">
        <PourSizeEditor
          editingDrinkPrice={editingDrinkPrice}
          enabledPourSizes={enabledPourSizes}
          defaultPourSize={defaultPourSize}
          hideDefaultOnPos={hideDefaultOnPos}
          isDualPricingEnabled={isDualPricingEnabled}
          cashDiscountPct={cashDiscountPct}
          onTogglePourSize={onTogglePourSize}
          onUpdateLabel={onUpdatePourSizeLabel}
          onUpdateMultiplier={onUpdatePourSizeMultiplier}
          onUpdateCustomPrice={onUpdatePourSizeCustomPrice}
          onSetDefaultPourSize={setDefaultPourSize}
          onSetHideDefaultOnPos={setHideDefaultOnPos}
          onSetEnabledPourSizes={setEnabledPourSizes}
        />
      </div>

      {/* Spirit Upgrades */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Spirit Upgrades</h3>
        <SpiritTierPanel
          spiritEntries={spiritEntries}
          bottles={bottles}
          savingSpirit={savingSpirit}
          onAddSpiritBottle={onAddSpiritBottle}
          onUpdatePrice={onUpdateSpiritEntryPrice}
          onRemoveEntry={onRemoveSpiritEntry}
          onSetDefault={onSetSpiritEntryDefault}
        />
      </div>

      {/* Combined Pricing — only when both pour sizes and spirit entries are active */}
      {Object.keys(enabledPourSizes).length > 0 && spiritEntries.length > 0 && (() => {
        const previewPourEntry = Object.entries(enabledPourSizes).find(([key]) => key === 'double')
          || Object.entries(enabledPourSizes).find(([key]) => key !== 'standard' && key !== '_hideDefaultOnPos')
        const previewSpirit = spiritEntries.find(e => e.tier === 'premium')
          || spiritEntries.find(e => e.tier !== 'well' && e.price > 0)
          || spiritEntries[0]
        const basePrice = parseFloat(editingDrinkPrice) || 0
        const pourKey = previewPourEntry?.[0] || ''
        const pourCfg = previewPourEntry?.[1]
        const pourPrice = pourCfg
          ? (pourCfg.customPrice != null ? pourCfg.customPrice : basePrice * pourCfg.multiplier)
          : basePrice
        const spiritUpcharge = previewSpirit?.price || 0
        const adjustedUpcharge = applyPourToModifiers && pourCfg
          ? spiritUpcharge * pourCfg.multiplier
          : spiritUpcharge
        const combinedTotal = pourPrice + adjustedUpcharge

        return (
          <div className="bg-gradient-to-r from-purple-50 to-amber-50 rounded-lg border border-purple-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Combined Pricing</h3>
            <p className="text-xs text-gray-600 mb-3">Preview of how pour size and spirit upgrade prices combine on the POS.</p>

            {/* Apply multiplier to spirit charges toggle */}
            <label className="flex items-center gap-2 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={applyPourToModifiers}
                onChange={e => setApplyPourToModifiers(e.target.checked)}
                className="w-4 h-4 text-purple-600"
              />
              <span className="text-xs text-gray-900">Apply pour size multiplier to spirit upgrade charges too</span>
            </label>

            {/* Live preview */}
            {previewPourEntry && previewSpirit && (
              <div className="bg-white/70 rounded-lg border border-purple-100 p-3 space-y-1.5">
                <div className="text-[11px] font-bold uppercase text-purple-600 tracking-wider mb-1">Price Preview</div>
                <div className="flex items-center justify-between text-xs text-gray-700">
                  <span>{pourCfg?.label || pourKey} pour</span>
                  <span>${pourPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-700">
                  <span>{previewSpirit.bottleName} upgrade ({previewSpirit.tier})</span>
                  <span>+${adjustedUpcharge.toFixed(2)}{applyPourToModifiers && pourCfg && pourCfg.multiplier !== 1 ? ` (${spiritUpcharge.toFixed(2)} x ${pourCfg.multiplier})` : ''}</span>
                </div>
                <div className="border-t border-purple-200 pt-1.5 flex items-center justify-between text-sm font-semibold text-purple-800">
                  <span>Guest total</span>
                  <span>${combinedTotal.toFixed(2)}</span>
                </div>
                {isDualPricingEnabled && (
                  <div className="flex items-center justify-between text-[11px] text-indigo-500">
                    <span>Card price</span>
                    <span>${calculateCardPrice(combinedTotal, cashDiscountPct).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Modifier Groups */}
      <ModifierGroupsCard
        selectedDrink={selectedDrink}
        editingDrinkName={editingDrinkName}
        drinkModifierGroups={drinkModifierGroups}
        modGroupRefreshKey={modGroupRefreshKey}
        selectedModGroupId={selectedModGroupId}
        isDualPricingEnabled={isDualPricingEnabled}
        cashDiscountPct={cashDiscountPct}
        setSelectedModGroupId={setSelectedModGroupId}
        setModGroupRefreshKey={setModGroupRefreshKey}
        reloadDrinkModifiers={reloadDrinkModifiers}
      />

      {/* Recipe Builder */}
      <RecipeBuilder
        menuItemId={selectedDrink.id}
        menuItemPrice={parseFloat(editingDrinkPrice) || selectedDrink.price}
        locationId={locationId}
        isExpanded={recipeExpanded}
        onToggle={() => setRecipeExpanded(prev => !prev)}
      />
    </>
  )
}


// --- Sub-components within DrinkEditor ---

function LinkedBottleCard({
  selectedDrink,
  editingPourSize,
  editingDrinkPrice,
  savingPourSize,
  linkingBottle,
  isDualPricingEnabled,
  cashDiscountPct,
  setEditingPourSize,
  onSavePourSize,
  onUnlinkBottle,
}: {
  selectedDrink: any
  editingPourSize: string
  editingDrinkPrice: string
  savingPourSize: boolean
  linkingBottle: boolean
  isDualPricingEnabled: boolean
  cashDiscountPct: number
  setEditingPourSize: (v: string) => void
  onSavePourSize: () => Promise<void>
  onUnlinkBottle: () => Promise<void>
}) {
  const effectivePourOz = parseFloat(editingPourSize) || selectedDrink.linkedPourSizeOz || selectedDrink.linkedBottlePourSizeOz || 1.5
  const bottleSizeMl = selectedDrink.linkedBottleSizeMl || 750
  const unitCost = selectedDrink.linkedBottleUnitCost || 0
  const poursPerBottle = Math.floor(bottleSizeMl / (effectivePourOz * ML_PER_OZ))
  const computedPourCost = poursPerBottle > 0 ? unitCost / poursPerBottle : 0
  const sellPrice = parseFloat(editingDrinkPrice) || selectedDrink.price || 0
  const margin = sellPrice > 0 && computedPourCost > 0 ? ((sellPrice - computedPourCost) / sellPrice) * 100 : null
  const bottleDefaultPour = selectedDrink.linkedBottlePourSizeOz || 1.5

  return (
    <div className="bg-green-50 rounded-lg border border-green-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-green-700 uppercase tracking-wide">Linked Bottle</h3>
        <button
          onClick={onUnlinkBottle}
          disabled={linkingBottle}
          className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
        >
          {linkingBottle ? 'Unlinking...' : 'Unlink'}
        </button>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <span className="font-semibold text-gray-900">{selectedDrink.linkedBottleProductName}</span>
        {selectedDrink.linkedBottleSpiritCategory && (
          <span className="text-xs text-gray-900">{selectedDrink.linkedBottleSpiritCategory}</span>
        )}
        {selectedDrink.linkedBottleTier && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            TIER_BADGE_COLORS[selectedDrink.linkedBottleTier] || 'bg-gray-200 text-gray-900'
          }`}>
            {getTierBadgeText(selectedDrink.linkedBottleTier)}
          </span>
        )}
        {selectedDrink.linkedBottleSizeMl && (
          <span className="text-xs text-gray-900">{selectedDrink.linkedBottleSizeMl}ml</span>
        )}
      </div>

      {/* POUR configuration */}
      <div className="bg-white/70 rounded-lg border border-green-200 p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-green-700 tracking-wide bg-green-200 px-1.5 py-0.5 rounded">POUR</span>
          <span className="text-xs text-gray-600">bottle default: {bottleDefaultPour}oz</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600">Pour Size:</label>
            <div className="relative">
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={editingPourSize}
                onChange={e => setEditingPourSize(e.target.value)}
                className="w-20 px-2 py-1.5 text-sm border rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-green-400"
                placeholder={String(bottleDefaultPour)}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-900">oz</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span>{poursPerBottle} pours/bottle</span>
            <span>|</span>
            <span>{formatCurrency(Math.round(computedPourCost * 100) / 100)}/pour</span>
          </div>
          <button
            onClick={onSavePourSize}
            disabled={savingPourSize}
            className="ml-auto px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {savingPourSize ? 'Saving...' : 'Save Pour'}
          </button>
        </div>
      </div>

      {/* Cost summary */}
      <div className="flex items-center gap-4 text-xs text-gray-600 bg-white/60 rounded px-3 py-2">
        <span>Pour Cost: <strong>{formatCurrency(Math.round(computedPourCost * 100) / 100)}</strong></span>
        <span>Sell Price: <strong>{formatCurrency(sellPrice)}</strong></span>
        {margin !== null && (
          <span>Margin: <strong className={margin >= 70 ? 'text-green-700' : margin >= 50 ? 'text-yellow-700' : 'text-red-700'}>
            {Math.round(margin)}%
          </strong></span>
        )}
      </div>
    </div>
  )
}


function BottleLinkPicker({
  selectedDrink,
  showBottleLinkPicker,
  bottleLinkSearch,
  linkingBottle,
  expandedPickerCats,
  bottles,
  categories,
  showInlineBottleForm,
  inlineBottleName,
  inlineBottleBrand,
  inlineBottleCategoryId,
  inlineBottleTier,
  inlineBottleSizeMl,
  inlineBottleCost,
  creatingInlineBottle,
  setShowBottleLinkPicker,
  setBottleLinkSearch,
  setExpandedPickerCats,
  setShowInlineBottleForm,
  setInlineBottleName,
  setInlineBottleBrand,
  setInlineBottleCategoryId,
  setInlineBottleTier,
  setInlineBottleSizeMl,
  setInlineBottleCost,
  onLinkBottle,
  onCreateInlineBottle,
}: {
  selectedDrink: any
  showBottleLinkPicker: boolean
  bottleLinkSearch: string
  linkingBottle: boolean
  expandedPickerCats: Set<string>
  bottles: BottleProduct[]
  categories: SpiritCategory[]
  showInlineBottleForm: boolean
  inlineBottleName: string
  inlineBottleBrand: string
  inlineBottleCategoryId: string
  inlineBottleTier: string
  inlineBottleSizeMl: string
  inlineBottleCost: string
  creatingInlineBottle: boolean
  setShowBottleLinkPicker: (v: boolean) => void
  setBottleLinkSearch: (v: string) => void
  setExpandedPickerCats: React.Dispatch<React.SetStateAction<Set<string>>>
  setShowInlineBottleForm: (v: boolean) => void
  setInlineBottleName: (v: string) => void
  setInlineBottleBrand: (v: string) => void
  setInlineBottleCategoryId: (v: string) => void
  setInlineBottleTier: (v: string) => void
  setInlineBottleSizeMl: (v: string) => void
  setInlineBottleCost: (v: string) => void
  onLinkBottle: (bottleId: string) => Promise<void>
  onCreateInlineBottle: () => Promise<void>
}) {
  return (
    <div className={`rounded-lg border-2 border-dashed p-5 transition-colors ${showBottleLinkPicker ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Linked Bottle</h3>
        {!showBottleLinkPicker && (
          <button
            onClick={() => { setShowBottleLinkPicker(true); setExpandedPickerCats(new Set()) }}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
          >
            Link to Bottle
          </button>
        )}
      </div>
      {!showBottleLinkPicker ? (
        <p className="text-xs text-gray-600">Link this drink to a bottle from inventory for cost tracking and deductions.</p>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              placeholder="Search bottles..."
              value={bottleLinkSearch}
              onChange={e => setBottleLinkSearch(e.target.value)}
              autoFocus
              className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={() => { setShowBottleLinkPicker(false); setBottleLinkSearch('') }}
              className="px-2 py-2 text-gray-900 hover:text-gray-600 text-sm"
            >
              Cancel
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {(() => {
              const search = bottleLinkSearch.toLowerCase()
              const filtered = bottles.filter((b: BottleProduct) =>
                b.isActive !== false && (
                  b.name.toLowerCase().includes(search) ||
                  b.spiritCategory?.name?.toLowerCase().includes(search)
                )
              )
              // Group by spirit category
              const grouped = new Map<string, BottleProduct[]>()
              for (const b of filtered) {
                const cat = b.spiritCategory?.name || 'Other'
                if (!grouped.has(cat)) grouped.set(cat, [])
                grouped.get(cat)!.push(b)
              }
              if (grouped.size === 0 && !showInlineBottleForm) {
                return <p className="text-xs text-gray-600 text-center py-4">No bottles found — create one below</p>
              }
              return Array.from(grouped.entries()).map(([catName, catBottles]) => {
                const isCatExpanded = expandedPickerCats.has(catName) || bottleLinkSearch.length > 0
                return (
                  <div key={catName}>
                    <button
                      type="button"
                      onClick={() => setExpandedPickerCats(prev => {
                        const next = new Set(prev)
                        if (next.has(catName)) next.delete(catName)
                        else next.add(catName)
                        return next
                      })}
                      className="w-full flex items-center gap-2 px-1 py-1.5 hover:bg-gray-50 rounded transition-colors"
                    >
                      <span className="text-gray-900 text-[10px] select-none">{isCatExpanded ? '\u25BC' : '\u25B6'}</span>
                      <span className="text-[10px] uppercase text-gray-900 font-semibold tracking-wide">{catName}</span>
                      <span className="text-[10px] text-gray-600">{catBottles.length}</span>
                    </button>
                    {isCatExpanded && (
                      <div className="space-y-0.5 ml-3">
                        {catBottles.map((b: BottleProduct) => (
                          <button
                            key={b.id}
                            onClick={() => onLinkBottle(b.id)}
                            disabled={linkingBottle}
                            className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-gray-800">{b.name}</span>
                                {b.needsVerification && (
                                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Needs verification" />
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  TIER_BADGE_COLORS[b.tier] || 'bg-gray-200 text-gray-900'
                                }`}>
                                  {getTierBadgeText(b.tier)}
                                </span>
                                {b.pourCost && (
                                  <span className="text-xs text-gray-900">{formatCurrency(Number(b.pourCost))}</span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>

          {/* Inline bottle creation form */}
          {!showInlineBottleForm ? (
            <button
              type="button"
              onClick={() => {
                setShowInlineBottleForm(true)
                if (categories.length > 0 && !inlineBottleCategoryId) {
                  setInlineBottleCategoryId(categories[0].id)
                }
              }}
              className="w-full mt-2 px-3 py-2 text-sm font-medium text-amber-600 border border-amber-300 border-dashed rounded-lg hover:bg-amber-50 transition-colors"
            >
              + Create New Bottle
            </button>
          ) : (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <div className="text-[10px] font-bold uppercase text-amber-600 tracking-wider">Create Bottle (Unverified)</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={inlineBottleName}
                  onChange={e => setInlineBottleName(e.target.value)}
                  placeholder="Bottle name *"
                  className="px-2 py-1.5 text-sm border rounded"
                  autoFocus
                />
                <input
                  type="text"
                  value={inlineBottleBrand}
                  onChange={e => setInlineBottleBrand(e.target.value)}
                  placeholder="Brand"
                  className="px-2 py-1.5 text-sm border rounded"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={inlineBottleCategoryId}
                  onChange={e => setInlineBottleCategoryId(e.target.value)}
                  className="px-2 py-1.5 text-sm border rounded"
                >
                  <option value="">Category *</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={inlineBottleTier}
                  onChange={e => setInlineBottleTier(e.target.value)}
                  className="px-2 py-1.5 text-sm border rounded"
                >
                  {SPIRIT_TIERS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <select
                  value={inlineBottleSizeMl}
                  onChange={e => setInlineBottleSizeMl(e.target.value)}
                  className="px-2 py-1.5 text-sm border rounded"
                >
                  {BOTTLE_SIZES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inlineBottleCost}
                  onChange={e => setInlineBottleCost(e.target.value)}
                  placeholder="Unit cost ($) *"
                  className="flex-1 px-2 py-1.5 text-sm border rounded"
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); onCreateInlineBottle() }
                    if (e.key === 'Escape') setShowInlineBottleForm(false)
                  }}
                />
                <button
                  type="button"
                  onClick={onCreateInlineBottle}
                  disabled={creatingInlineBottle || !inlineBottleName.trim() || !inlineBottleCategoryId || !inlineBottleCost}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                >
                  {creatingInlineBottle ? '...' : 'Create & Link'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowInlineBottleForm(false)}
                  className="px-2 py-1.5 text-xs text-gray-900 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-amber-600">
                Created bottles are marked as unverified and need to be verified in Liquor Inventory.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function ModifierGroupsCard({
  selectedDrink,
  editingDrinkName,
  drinkModifierGroups,
  modGroupRefreshKey,
  selectedModGroupId,
  isDualPricingEnabled,
  cashDiscountPct,
  setSelectedModGroupId,
  setModGroupRefreshKey,
  reloadDrinkModifiers,
}: {
  selectedDrink: any
  editingDrinkName: string
  drinkModifierGroups: any[]
  modGroupRefreshKey: number
  selectedModGroupId: string | null
  isDualPricingEnabled: boolean
  cashDiscountPct: number
  setSelectedModGroupId: (v: string | null) => void
  setModGroupRefreshKey: React.Dispatch<React.SetStateAction<number>>
  reloadDrinkModifiers: (itemId: string) => Promise<void>
}) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Modifier Groups</h3>
          <p className="text-xs text-gray-600 mt-0.5">Tap a template in the right panel to attach, then edit modifiers inline below</p>
        </div>
      </div>

      {/* Group list -- spirit groups are managed in the Spirit Tier Editor above */}
      {drinkModifierGroups.filter((mg: any) => !mg.isSpiritGroup).length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-600">
          <p className="mb-1 font-medium">No modifier groups yet.</p>
          <p className="text-xs">Tap a template in the Modifier Templates panel on the right →</p>
        </div>
      ) : (
        <div className="divide-y">
          {drinkModifierGroups.filter((mg: any) => !mg.isSpiritGroup).map((mg: any) => {
            const isExpanded = selectedModGroupId === mg.id
            return (
              <div key={mg.id}>
                <button
                  onClick={() => setSelectedModGroupId(isExpanded ? null : mg.id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                    isExpanded
                      ? 'bg-purple-50 border-l-4 border-purple-500'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{mg.name}</span>
                    {mg.isRequired && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Required</span>}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600 text-xs">
                    <span>{mg.modifiers?.length ?? 0} options</span>
                    <span>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Inline per-item modifier editing */}
                {isExpanded && (
                  <div className="bg-gray-50 border-t px-4 py-3">
                    {/* Column headers */}
                    <div className="grid grid-cols-12 gap-2 text-[10px] text-gray-900 px-1 mb-1.5">
                      <div className="col-span-5">Name</div>
                      <div className="col-span-3 text-right">+Charge</div>
                      <div className="col-span-2 text-center">Active</div>
                      <div className="col-span-2"></div>
                    </div>

                    <div className="space-y-1">
                      {(mg.modifiers || []).map((mod: any) => (
                        <div
                          key={mod.id}
                          className={`grid grid-cols-12 gap-2 items-center p-1.5 rounded border transition-colors ${
                            mod.isActive !== false ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-100 opacity-60'
                          }`}
                        >
                          {/* Name */}
                          <div className="col-span-5">
                            <input
                              type="text"
                              defaultValue={mod.name}
                              key={`${mod.id}-name-${modGroupRefreshKey}`}
                              onBlur={async (e) => {
                                const newName = e.target.value.trim()
                                if (newName && newName !== mod.name) {
                                  await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ modifierId: mod.id, name: newName }),
                                  })
                                  reloadDrinkModifiers(selectedDrink.id)
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
                            />
                          </div>

                          {/* Price */}
                          <div className="col-span-3">
                            <div className="relative">
                              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-900 text-xs">$</span>
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                defaultValue={mod.price || 0}
                                key={`${mod.id}-price-${modGroupRefreshKey}`}
                                onBlur={async (e) => {
                                  const newPrice = parseFloat(e.target.value) || 0
                                  if (newPrice !== (mod.price || 0)) {
                                    await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ modifierId: mod.id, price: newPrice }),
                                    })
                                    reloadDrinkModifiers(selectedDrink.id)
                                  }
                                }}
                                className="w-full pl-4 pr-1 py-1 text-sm border rounded text-right focus:outline-none focus:ring-1 focus:ring-purple-400"
                              />
                            </div>
                            {isDualPricingEnabled && (mod.price || 0) > 0 && (
                              <p className="text-xs text-indigo-400 text-right mt-0.5">Card: ${calculateCardPrice(mod.price || 0, cashDiscountPct).toFixed(2)}</p>
                            )}
                          </div>

                          {/* Active toggle */}
                          <div className="col-span-2 flex justify-center">
                            <input
                              type="checkbox"
                              checked={mod.isActive !== false}
                              onChange={async (e) => {
                                await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ modifierId: mod.id, isActive: e.target.checked }),
                                })
                                reloadDrinkModifiers(selectedDrink.id)
                              }}
                              className="w-4 h-4"
                              title="Active on POS"
                            />
                          </div>

                          {/* Remove */}
                          <div className="col-span-2 flex justify-center">
                            <button
                              onClick={async () => {
                                await fetch(
                                  `/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers?modifierId=${mod.id}`,
                                  { method: 'DELETE' }
                                )
                                reloadDrinkModifiers(selectedDrink.id)
                              }}
                              className="text-gray-900 hover:text-red-500 text-lg leading-none"
                              title="Remove option"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add option button */}
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: 'New Option', price: 0, isActive: true }),
                        })
                        if (res.ok) {
                          reloadDrinkModifiers(selectedDrink.id)
                          setModGroupRefreshKey(k => k + 1)
                        }
                      }}
                      className="mt-2 text-xs text-purple-600 hover:text-purple-800 font-medium"
                    >
                      + Add Option
                    </button>

                    {/* Group-level settings */}
                    <div className="mt-3 pt-3 border-t">
                      <ModifierFlowEditor
                        item={{ id: selectedDrink.id, name: editingDrinkName || selectedDrink.name }}
                        selectedGroupId={mg.id}
                        refreshKey={modGroupRefreshKey}
                        onGroupUpdated={() => {
                          reloadDrinkModifiers(selectedDrink.id)
                          setModGroupRefreshKey(k => k + 1)
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
