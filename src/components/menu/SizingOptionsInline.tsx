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
        <div className="text-xs text-gray-400 text-center py-2">Loading...</div>
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
          <span className="text-sm font-medium text-gray-700">Size Options</span>
          <span className="text-[11px] text-gray-400">(S/M/L, Bowl/Cup)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasQuickPick}
            onChange={(e) => e.target.checked ? handleEnableQuickPick() : handleDisable()}
            disabled={saving}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium text-gray-700">Quick Pick</span>
          <span className="text-[11px] text-gray-400">(Mild/Medium/Hot)</span>
        </label>
      </div>

      {activeGroup && (
        <>
          {sizesActive && hasSizes && (
            <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
              Base price is overridden by size options below.
            </p>
          )}

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
            <p className="text-xs text-gray-400 text-center py-1">
              No {hasSizes ? 'sizes' : 'quick picks'} yet. Add one below.
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
            {hasSizes ? 'Add Size' : 'Add Quick Pick'}
          </button>
        </>
      )}
    </div>
  )
}
