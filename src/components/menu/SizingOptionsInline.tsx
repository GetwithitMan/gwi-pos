'use client'

import { useEffect, useRef } from 'react'
import { usePricingOptions } from './usePricingOptions'
import { PricingOptionRow } from './PricingOptionRow'
import { PricingOptionInventoryLinker } from './PricingOptionInventoryLinker'
import type { IngredientLibraryItem } from './IngredientHierarchyPicker'

interface IngredientCategory {
  id: string
  code: number
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount: number
  needsVerification?: boolean
}

interface SizingOptionsInlineProps {
  itemId: string
  /** Called when sizes are toggled on/off so parent can disable the base price field */
  onSizesActiveChange?: (active: boolean) => void
  /** Ingredient library data for the inventory linker */
  ingredientsLibrary?: IngredientLibraryItem[]
  ingredientCategories?: IngredientCategory[]
  locationId?: string
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onCategoryCreated?: (category: IngredientCategory) => void
}

const SIZE_PRESETS = [
  { label: 'Small' },
  { label: 'Medium' },
  { label: 'Large' },
  { label: 'XL' },
  { label: 'Bowl' },
  { label: 'Cup' },
  { label: 'Half' },
  { label: 'Full' },
  { label: 'Slice' },
  { label: 'Whole' },
]

const QUICK_PICK_PRESETS = [
  { label: 'Mild' },
  { label: 'Medium' },
  { label: 'Hot' },
  { label: 'Extra Hot' },
]

export function SizingOptionsInline({
  itemId,
  onSizesActiveChange,
  ingredientsLibrary = [],
  ingredientCategories = [],
  locationId = '',
  onIngredientCreated,
  onCategoryCreated,
}: SizingOptionsInlineProps) {
  const {
    groups,
    loading,
    saving,
    addGroup,
    deleteGroup,
    addOption,
    updateOption,
    deleteOption,
  } = usePricingOptions(itemId)

  // Size group = NOT quick pick; Quick pick group = showAsQuickPick
  const sizeGroup = groups.find(g => !g.showAsQuickPick)
  const quickPickGroup = groups.find(g => g.showAsQuickPick)
  const hasSizes = !!sizeGroup
  const hasQuickPick = !!quickPickGroup
  const activeGroup = sizeGroup || quickPickGroup
  const optionCount = activeGroup?.options.length ?? 0
  const sizesActive = hasSizes && optionCount > 0
  const hasIngredientData = ingredientsLibrary.length > 0

  // Count how many options have showOnPos checked (for max 4 display cap)
  const showOnPosCount = activeGroup?.options.filter(o => o.showOnPos).length ?? 0

  // Which option labels already exist in the active group
  const existingLabels = new Set(activeGroup?.options.map(o => o.label) ?? [])

  // Notify parent about sizing state changes via effect
  const prevActiveRef = useRef(sizesActive)
  useEffect(() => {
    if (prevActiveRef.current !== sizesActive) {
      prevActiveRef.current = sizesActive
      onSizesActiveChange?.(sizesActive)
    }
  }, [sizesActive, onSizesActiveChange])

  if (loading) {
    return (
      <div className="border border-gray-200 rounded-xl p-3">
        <div className="text-xs text-gray-600 text-center py-2">Loading...</div>
      </div>
    )
  }

  const handleEnableSizes = async () => {
    // If quick pick exists, remove it first
    if (quickPickGroup) {
      await deleteGroup(quickPickGroup.id)
    }
    await addGroup('Sizes', false)
  }

  const handleEnableQuickPick = async () => {
    // If size group exists, remove it first
    if (sizeGroup) {
      await deleteGroup(sizeGroup.id)
    }
    await addGroup('Quick Picks', true)
  }

  const handleDisable = () => {
    if (activeGroup) {
      deleteGroup(activeGroup.id)
    }
  }

  const handlePresetClick = (label: string) => {
    if (!activeGroup) return
    if (existingLabels.has(label)) {
      // Find and delete the option with this label
      const opt = activeGroup.options.find(o => o.label === label)
      if (opt) deleteOption(activeGroup.id, opt.id)
    } else {
      addOption(activeGroup.id, label)
    }
  }

  const presets = hasSizes ? SIZE_PRESETS : hasQuickPick ? QUICK_PICK_PRESETS : []

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-3">
      {/* Toggle row: two mutually exclusive checkboxes */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasSizes}
            onChange={(e) => e.target.checked ? handleEnableSizes() : handleDisable()}
            disabled={saving}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium text-gray-900">Size Options</span>
          <span className="text-[11px] text-gray-600">(S/M/L, Bowl/Cup)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasQuickPick}
            onChange={(e) => e.target.checked ? handleEnableQuickPick() : handleDisable()}
            disabled={saving}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium text-gray-900">Quick Pick</span>
          <span className="text-[11px] text-gray-600">(Mild/Medium/Hot)</span>
        </label>
      </div>

      {activeGroup && (
        <>
          {sizesActive && hasSizes && (
            <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
              Base price is overridden by size options below.
            </p>
          )}

          {/* Preset quick-add buttons */}
          <div>
            <div className="text-[11px] text-gray-600 font-medium mb-1.5">Presets</div>
            <div className="flex gap-1.5 flex-wrap">
              {presets.map(preset => {
                const isActive = existingLabels.has(preset.label)
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePresetClick(preset.label)}
                    disabled={saving}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Option rows */}
          {activeGroup.options.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {activeGroup.options.map(opt => (
                <div key={opt.id}>
                  <PricingOptionRow
                    option={opt}
                    showOnPosCount={showOnPosCount}
                    onUpdate={(data) => updateOption(activeGroup.id, opt.id, data)}
                    onDelete={() => deleteOption(activeGroup.id, opt.id)}
                  />
                  {/* Inventory linker for saved options (only if ingredient data is available) */}
                  {hasIngredientData && hasSizes && (
                    <PricingOptionInventoryLinker
                      optionId={opt.id}
                      itemId={itemId}
                      groupId={activeGroup.id}
                      ingredientsLibrary={ingredientsLibrary}
                      ingredientCategories={ingredientCategories}
                      locationId={locationId}
                      onIngredientCreated={onIngredientCreated}
                      onCategoryCreated={onCategoryCreated}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600 text-center py-1">
              No {hasSizes ? 'sizes' : 'quick picks'} yet. Tap a preset or add one below.
            </p>
          )}

          <button
            type="button"
            onClick={() => addOption(activeGroup.id, hasSizes ? 'New Size' : 'New Pick')}
            disabled={saving}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {hasSizes ? 'Add Custom Size' : 'Add Custom Pick'}
          </button>
        </>
      )}
    </div>
  )
}
