'use client'

import { useEffect, useRef } from 'react'
import { usePricingOptions } from './usePricingOptions'
import { PricingOptionRow } from './PricingOptionRow'
import { PricingOptionInventoryLinker } from './PricingOptionInventoryLinker'
import type { IngredientLibraryItem } from './IngredientHierarchyPicker'

const MAX_SIZE_OPTIONS = 4

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

  // The sizing group is the one NOT marked as quick pick
  const sizeGroup = groups.find(g => !g.showAsQuickPick)
  const hasSizes = !!sizeGroup
  const optionCount = sizeGroup?.options.length ?? 0
  const atMax = optionCount >= MAX_SIZE_OPTIONS
  const sizesActive = hasSizes && optionCount > 0
  const hasIngredientData = ingredientsLibrary.length > 0

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

  const handleToggleOn = async () => {
    await addGroup('Sizes', false)
  }

  const handleToggleOff = () => {
    if (sizeGroup) {
      deleteGroup(sizeGroup.id)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasSizes}
            onChange={(e) => e.target.checked ? handleToggleOn() : handleToggleOff()}
            disabled={saving}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-medium text-gray-700">Enable Size Options</span>
          <span className="text-[11px] text-gray-400">(e.g. S/M/L, Bowl/Cup)</span>
        </label>
        {hasSizes && (
          <span className="text-[11px] text-gray-400">{optionCount}/{MAX_SIZE_OPTIONS}</span>
        )}
      </div>

      {hasSizes && sizeGroup && (
        <>
          {sizesActive && (
            <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
              Base price is overridden by size options below.
            </p>
          )}

          {sizeGroup.options.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {sizeGroup.options.map(opt => (
                <div key={opt.id}>
                  <PricingOptionRow
                    option={opt}
                    onUpdate={(data) => updateOption(sizeGroup.id, opt.id, data)}
                    onDelete={() => deleteOption(sizeGroup.id, opt.id)}
                  />
                  {/* Inventory linker for saved options (only if ingredient data is available) */}
                  {hasIngredientData && (
                    <PricingOptionInventoryLinker
                      optionId={opt.id}
                      itemId={itemId}
                      groupId={sizeGroup.id}
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
            <p className="text-xs text-gray-400 text-center py-1">No sizes yet. Add one below.</p>
          )}

          <button
            type="button"
            onClick={() => addOption(sizeGroup.id, 'New Size')}
            disabled={saving || atMax}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {atMax ? `Max ${MAX_SIZE_OPTIONS} sizes` : 'Add Size'}
          </button>
        </>
      )}
    </div>
  )
}
