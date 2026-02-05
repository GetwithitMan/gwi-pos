'use client'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import type { DualPricingSettings } from '@/lib/settings'
import type { MenuItem, ModifierGroup, SelectedModifier, Modifier } from '@/types'
import './modifier-modal.css'
import {
  useModifierSelections,
  DEFAULT_POUR_SIZE_CONFIG,
  SPIRIT_TIER_CONFIG,
  PRE_MODIFIER_CONFIG,
  getPourSizeMultiplier,
  getPourSizeLabel,
  type IngredientModification,
  type IngredientModificationType,
  type MenuItemIngredient,
  type SpiritTier,
  type PourSizeValue,
  type PourSizeKey,
} from './useModifierSelections'
import { SwapPicker } from './SwapPicker'
import { IngredientsSection } from './IngredientsSection'
import { HierarchyBreadcrumb } from './HierarchyBreadcrumb'
import { ModifierGroupSection } from './ModifierGroupSection'
import { useState } from 'react'

interface ModifierModalProps {
  item: MenuItem
  modifierGroups: ModifierGroup[]
  loading: boolean
  editingItem?: {
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; preModifier?: string; depth: number; parentModifierId?: string }[]
    ingredientModifications?: IngredientModification[]
  } | null
  dualPricing: DualPricingSettings
  onConfirm: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: IngredientModification[]) => void
  onCancel: () => void
  initialNotes?: string
}

export function ModifierModal({
  item,
  modifierGroups,
  loading,
  editingItem,
  dualPricing,
  onConfirm,
  onCancel,
  initialNotes,
}: ModifierModalProps) {
  // Extract all state and logic into custom hook
  const {
    selectedPourSize,
    setSelectedPourSize,
    pourMultiplier,
    ingredients,
    ingredientMods,
    loadingIngredients,
    toggleIngredientMod,
    ingredientModTotal,
    getAllIngredientMods,
    swapModalIngredient,
    setSwapModalIngredient,
    handleSwapSelection,
    selections,
    expandedGroups,
    setExpandedGroups,
    childGroups,
    toggleModifier,
    isSelected,
    getSelectionCount,
    getActiveChildGroups,
    getSelectedPreModifier,
    handleSpiritSelection,
    getModifiersByTier,
    canConfirm,
    getAllSelectedModifiers,
    totalPrice,
    specialNotes,
    setSpecialNotes,
    activeChildGroups,
    formatModPrice,
    getGroupColor,
  } = useModifierSelections(item, modifierGroups, editingItem, dualPricing, initialNotes)

  // Navigation state for hierarchical drill-down
  const [navStack, setNavStack] = useState<{ groupId: string; groupName: string }[]>([])

  // Navigation handlers
  const handleDrillDown = (childGroupId: string, childGroupName: string) => {
    setNavStack(prev => [...prev, { groupId: childGroupId, groupName: childGroupName }])
  }

  const handleNavigateTo = (index: number) => {
    if (index === -1) {
      // Navigate to root (clear stack)
      setNavStack([])
    } else {
      // Navigate to specific level (trim stack)
      setNavStack(prev => prev.slice(0, index + 1))
    }
  }

  // Determine which groups to show based on navigation
  const currentGroupId = navStack.length > 0 ? navStack[navStack.length - 1].groupId : null

  // Build set of child group IDs (groups that are children of modifiers)
  const childGroupIds = new Set<string>()
  modifierGroups.forEach(group => {
    group.modifiers.forEach(mod => {
      if (mod.childModifierGroupId) {
        childGroupIds.add(mod.childModifierGroupId)
      }
    })
  })

  const visibleGroups = currentGroupId
    ? modifierGroups.filter(g => g.id === currentGroupId)
    : modifierGroups.filter(g => !childGroupIds.has(g.id)) // Show only top-level groups at root

  // Render pour size buttons for liquor items
  const renderPourSizeButtons = () => {
    if (!item.pourSizes) return null

    const enabledSizes = Object.entries(item.pourSizes).filter(([, value]) => {
      const mult = getPourSizeMultiplier(value as PourSizeValue)
      return mult > 0
    })
    if (enabledSizes.length === 0) return null

    return (
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg p-4 mb-4">
        <div className="text-white text-sm font-medium mb-3">Pour Size</div>
        <div className="flex gap-2">
          {enabledSizes.map(([size, value]) => {
            const multiplier = getPourSizeMultiplier(value as PourSizeValue)
            const label = getPourSizeLabel(size, value as PourSizeValue)
            const isSelected = selectedPourSize === size
            const price = item.price * multiplier

            return (
              <button
                key={size}
                onClick={() => setSelectedPourSize(size)}
                className={`flex-1 py-3 px-2 rounded-lg text-center transition-all ${
                  isSelected
                    ? 'bg-white text-purple-700 shadow-lg scale-105'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                <div className="text-lg font-bold">{label}</div>
                <div className={`text-sm ${isSelected ? 'text-purple-600' : 'text-white/80'}`}>
                  {formatCurrency(price)}
                </div>
                <div className={`text-xs ${isSelected ? 'text-purple-500' : 'text-white/60'}`}>
                  {multiplier}×
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 modifier-modal-container">
      <div className="mm-glass-panel rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-gradient-to-r from-indigo-600/30 to-purple-600/20">
          <h2 className="text-lg font-bold text-white">{item.name}</h2>
          <p className="text-slate-300 text-sm">
            Base: {formatCurrency(item.price)}
            {pourMultiplier !== 1 && (
              <span className="ml-2 text-purple-300">
                × {pourMultiplier} = {formatCurrency(item.price * pourMultiplier)}
              </span>
            )}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3" style={{ background: 'var(--mm-bg-primary)' }}>
          {loading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : (
            <>
              {/* Pour Size Buttons - Prominent at top for liquor items */}
              {renderPourSizeButtons()}

              {/* Ingredients Section - Collapsed by default */}
              {ingredients.length > 0 && (
                <IngredientsSection
                  ingredients={ingredients}
                  ingredientMods={ingredientMods}
                  loading={loadingIngredients}
                  onToggleMod={toggleIngredientMod}
                  onOpenSwap={(ingredient) => setSwapModalIngredient(ingredient)}
                  modTotal={ingredientModTotal}
                />
              )}

              {/* Breadcrumb - show when navigated into child groups */}
              {navStack.length > 0 && (
                <HierarchyBreadcrumb
                  itemName={item.name}
                  navStack={navStack}
                  onNavigateTo={handleNavigateTo}
                />
              )}

              {/* Modifier Groups */}
              {modifierGroups.length === 0 ? (
                <div className="text-center py-4 text-slate-400 text-sm">No modifiers</div>
              ) : (
                <div>
                  {visibleGroups.map(group => (
                    <ModifierGroupSection
                      key={group.id}
                      group={group}
                      selections={selections[group.id] || []}
                      onToggle={toggleModifier}
                      isSelected={isSelected}
                      getSelectionCount={getSelectionCount}
                      getSelectedPreModifier={getSelectedPreModifier}
                      formatModPrice={formatModPrice}
                      groupColor={getGroupColor(group)}
                      allowStacking={group.allowStacking}
                      onDrillDown={handleDrillDown}
                      isSpiritGroup={group.isSpiritGroup}
                      handleSpiritSelection={handleSpiritSelection}
                      getModifiersByTier={getModifiersByTier}
                    />
                  ))}
                </div>
              )}

              {/* Special Notes */}
              <div className="mt-3 pt-3 border-t border-white/10">
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Notes <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="Special instructions..."
                  className="w-full p-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                  maxLength={200}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/10" style={{ background: 'rgba(30, 30, 50, 0.9)', backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm text-slate-300">Total</span>
            <span className="text-xl font-bold text-emerald-400">{formatCurrency(totalPrice)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 text-slate-300 border-white/20 hover:bg-white/10 bg-transparent" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-0"
              disabled={!canConfirm()}
              onClick={() => onConfirm(
                getAllSelectedModifiers(),
                specialNotes.trim() || undefined,
                selectedPourSize || undefined,
                pourMultiplier !== 1 ? pourMultiplier : undefined,
                getAllIngredientMods().length > 0 ? getAllIngredientMods() : undefined
              )}
            >
              {editingItem ? 'Update' : 'Add'}
            </Button>
          </div>
        </div>
      </div>

      {/* Swap Picker */}
      {swapModalIngredient && swapModalIngredient.swapModifierGroup && (
        <SwapPicker
          ingredient={swapModalIngredient}
          currentSwap={ingredientMods[swapModalIngredient.ingredientId]?.swappedTo}
          onSelect={(option) => handleSwapSelection(swapModalIngredient, option)}
          onCancel={() => setSwapModalIngredient(null)}
        />
      )}
    </div>
  )
}
