'use client'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
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
import { ModifierGroupSection } from './ModifierGroupSection'
import { useState, useEffect } from 'react'

type ViewMode = 'steps' | 'grid'

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
    getTieredPrice,
    getExcludedModifierIds,
  } = useModifierSelections(item, modifierGroups, editingItem, dualPricing, initialNotes)

  // Card price multiplier for dual pricing display
  const cpm = dualPricing?.enabled && dualPricing.cashDiscountPercent > 0
    ? 1 + dualPricing.cashDiscountPercent / 100
    : 1

  // View mode: stepped (default) or grid (all at once)
  const [viewMode, setViewMode] = useState<ViewMode>('steps')

  // Active group index for stepped view
  const [activeGroupIndex, setActiveGroupIndex] = useState(0)

  // Build set of child group IDs (groups that are children of modifiers)
  const childGroupIds = new Set<string>()
  modifierGroups.forEach(group => {
    group.modifiers.forEach(mod => {
      if (mod.childModifierGroupId) {
        childGroupIds.add(mod.childModifierGroupId)
      }
    })
  })

  // Top-level groups only (not child groups)
  const topLevelGroups = modifierGroups.filter(g => !childGroupIds.has(g.id))

  // Auto-advance to next group when current is complete (stepped mode)
  useEffect(() => {
    if (viewMode !== 'steps') return
    if (topLevelGroups.length <= 1) return
    const currentGroup = topLevelGroups[activeGroupIndex]
    if (!currentGroup) return

    const groupSelections = selections[currentGroup.id] || []
    const isComplete = currentGroup.isRequired
      ? groupSelections.length >= currentGroup.minSelections
      : false

    if (isComplete && currentGroup.maxSelections === 1) {
      const nextIndex = topLevelGroups.findIndex((g, i) => {
        if (i <= activeGroupIndex) return false
        if (!g.isRequired) return false
        const sels = selections[g.id] || []
        return sels.length < g.minSelections
      })
      if (nextIndex !== -1) {
        setTimeout(() => setActiveGroupIndex(nextIndex), 300)
      }
    }
  }, [selections, activeGroupIndex, topLevelGroups, viewMode])

  // Count required groups that are incomplete
  const requiredIncomplete = topLevelGroups.filter(g => {
    if (!g.isRequired) return false
    const sels = selections[g.id] || []
    return sels.length < g.minSelections
  }).length

  // Helper: get child groups for a specific parent group's selections (for inline rendering)
  const getChildGroupsForGroup = (groupId: string): { group: ModifierGroup; parentModifierName: string }[] => {
    const result: { group: ModifierGroup; parentModifierName: string }[] = []
    const groupSels = selections[groupId] || []
    groupSels.forEach(sel => {
      if (sel.childModifierGroupId && childGroups[sel.childModifierGroupId]) {
        result.push({
          group: childGroups[sel.childModifierGroupId],
          parentModifierName: sel.name,
        })
      }
    })
    return result
  }

  // Render pour size buttons for liquor items
  const renderPourSizeButtons = () => {
    if (!item.pourSizes) return null

    const enabledSizes = Object.entries(item.pourSizes).filter(([, value]) => {
      const mult = getPourSizeMultiplier(value as PourSizeValue)
      return mult > 0
    })
    if (enabledSizes.length === 0) return null

    return (
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg p-3 mb-3">
        <div className="text-white text-xs font-medium mb-2">Pour Size</div>
        <div className="flex gap-2">
          {enabledSizes.map(([size, value]) => {
            const multiplier = getPourSizeMultiplier(value as PourSizeValue)
            const label = getPourSizeLabel(size, value as PourSizeValue)
            const isSel = selectedPourSize === size
            const price = item.price * multiplier * cpm

            return (
              <button
                key={size}
                onClick={() => setSelectedPourSize(size)}
                className={`flex-1 py-2 px-2 rounded-lg text-center transition-all ${
                  isSel
                    ? 'bg-white text-purple-700 shadow-lg scale-105'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                <div className="text-sm font-bold">{label}</div>
                <div className={`text-xs ${isSel ? 'text-purple-600' : 'text-white/80'}`}>
                  {formatCurrency(price)}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Render step-selector boxes ──
  const renderStepBoxes = () => {
    if (topLevelGroups.length === 0) return null

    return (
      <div className="mm-step-boxes">
        {topLevelGroups.map((group, index) => {
          const groupSelections = selections[group.id] || []
          const isComplete = group.isRequired
            ? groupSelections.length >= group.minSelections
            : groupSelections.length > 0
          const isCurrent = index === activeGroupIndex

          let boxClass = 'mm-step-box'
          if (isCurrent) boxClass += ' mm-step-box-active'
          if (isComplete) {
            boxClass += ' mm-step-box-complete'
          } else if (group.isRequired) {
            boxClass += ' mm-step-box-required'
          }

          return (
            <button
              key={group.id}
              onClick={() => setActiveGroupIndex(index)}
              className={boxClass}
            >
              <span className="mm-step-box-label">
                {group.displayName || group.name}
              </span>
              {isComplete ? (
                <span className="mm-step-box-badge bg-green-500/20 text-green-400">✓</span>
              ) : group.isRequired ? (
                <span className="mm-step-box-badge bg-red-500/20 text-red-400">REQ</span>
              ) : groupSelections.length > 0 ? (
                <span className="mm-step-box-badge bg-white/10 text-slate-300">{groupSelections.length}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  // ── Render a single group with its inline child groups ──
  const renderGroupWithChildren = (group: ModifierGroup) => {
    const inlineChildren = getChildGroupsForGroup(group.id)

    return (
      <div key={group.id} className="mm-stepped-group">
        <ModifierGroupSection
          group={group}
          selections={selections[group.id] || []}
          onToggle={toggleModifier}
          isSelected={isSelected}
          getSelectionCount={getSelectionCount}
          getSelectedPreModifier={getSelectedPreModifier}
          formatModPrice={formatModPrice}
          groupColor={getGroupColor(group)}
          allowStacking={group.allowStacking}
          isSpiritGroup={group.isSpiritGroup}
          handleSpiritSelection={handleSpiritSelection}
          getModifiersByTier={getModifiersByTier}
          getTieredPrice={getTieredPrice}
          getExcludedModifierIds={getExcludedModifierIds}
          cardPriceMultiplier={cpm}
        />

        {/* Inline child groups — appear right below their parent */}
        {inlineChildren.map(({ group: childGroup, parentModifierName }) => (
          <div key={childGroup.id} className="mm-child-group-inline">
            <div className="mm-child-group-label">
              <span className="text-indigo-400">↳</span>
              {parentModifierName} → {childGroup.displayName || childGroup.name}
              {childGroup.isRequired && <span className="text-red-400 ml-1">*</span>}
            </div>
            <ModifierGroupSection
              group={childGroup}
              selections={selections[childGroup.id] || []}
              onToggle={toggleModifier}
              isSelected={isSelected}
              getSelectionCount={getSelectionCount}
              getSelectedPreModifier={getSelectedPreModifier}
              formatModPrice={formatModPrice}
              groupColor={getGroupColor(childGroup)}
              allowStacking={childGroup.allowStacking}
              isSpiritGroup={childGroup.isSpiritGroup}
              handleSpiritSelection={handleSpiritSelection}
              getModifiersByTier={getModifiersByTier}
              getTieredPrice={getTieredPrice}
              getExcludedModifierIds={getExcludedModifierIds}
            />

            {/* Recursively render grandchildren */}
            {getChildGroupsForGroup(childGroup.id).map(({ group: grandChild, parentModifierName: grandParentName }) => (
              <div key={grandChild.id} className="mm-child-group-inline">
                <div className="mm-child-group-label">
                  <span className="text-indigo-400">↳</span>
                  {grandParentName} → {grandChild.displayName || grandChild.name}
                </div>
                <ModifierGroupSection
                  group={grandChild}
                  selections={selections[grandChild.id] || []}
                  onToggle={toggleModifier}
                  isSelected={isSelected}
                  getSelectionCount={getSelectionCount}
                  getSelectedPreModifier={getSelectedPreModifier}
                  formatModPrice={formatModPrice}
                  groupColor={getGroupColor(grandChild)}
                  allowStacking={grandChild.allowStacking}
                  isSpiritGroup={grandChild.isSpiritGroup}
                  handleSpiritSelection={handleSpiritSelection}
                  getModifiersByTier={getModifiersByTier}
                  getTieredPrice={getTieredPrice}
                  getExcludedModifierIds={getExcludedModifierIds}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <Modal isOpen={true} onClose={onCancel} size={viewMode === 'grid' ? '2xl' : 'lg'}>
      <div className="-m-5 modifier-modal-container mm-glass-panel rounded-2xl h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-3 border-b border-white/10 bg-gradient-to-r from-indigo-600/30 to-purple-600/20 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{item.name}</h2>
            <p className="text-slate-300 text-sm">
              Base: {formatCurrency(item.price * cpm)}
              {pourMultiplier !== 1 && (
                <span className="ml-2 text-purple-300">
                  × {pourMultiplier} = {formatCurrency(item.price * cpm * pourMultiplier)}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {requiredIncomplete > 0 && (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                {requiredIncomplete} req
              </span>
            )}
            {/* View toggle */}
            {topLevelGroups.length > 1 && (
              <div className="mm-view-toggle">
                <button
                  className={`mm-view-toggle-btn ${viewMode === 'steps' ? 'mm-view-toggle-btn-active' : ''}`}
                  onClick={() => setViewMode('steps')}
                  title="Step-by-step view"
                >
                  Steps
                </button>
                <button
                  className={`mm-view-toggle-btn ${viewMode === 'grid' ? 'mm-view-toggle-btn-active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="All groups at once"
                >
                  All
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step Boxes — only in stepped view with multiple groups */}
        {viewMode === 'steps' && topLevelGroups.length > 1 && renderStepBoxes()}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3" style={{ background: 'var(--mm-bg-primary)' }}>
          {loading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : (
            <>
              {/* Pour Size Buttons */}
              {renderPourSizeButtons()}

              {/* Ingredients Section */}
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

              {/* ── STEPPED VIEW ── */}
              {viewMode === 'steps' && (
                <>
                  {modifierGroups.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-sm">No modifiers</div>
                  ) : topLevelGroups.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-sm">No modifiers</div>
                  ) : (
                    renderGroupWithChildren(topLevelGroups[activeGroupIndex] || topLevelGroups[0])
                  )}
                </>
              )}

              {/* ── GRID VIEW ── */}
              {viewMode === 'grid' && (
                <>
                  {modifierGroups.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-sm">No modifiers</div>
                  ) : (
                    <div className="mm-groups-grid">
                      {topLevelGroups.map(group => (
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
                          isSpiritGroup={group.isSpiritGroup}
                          handleSpiritSelection={handleSpiritSelection}
                          getModifiersByTier={getModifiersByTier}
                          getTieredPrice={getTieredPrice}
                          getExcludedModifierIds={getExcludedModifierIds}
                        />
                      ))}
                    </div>
                  )}

                  {/* Inline child groups below the grid in grid mode */}
                  {activeChildGroups.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {activeChildGroups.map(({ group: childGroup, parentModifierName }) => (
                        <div key={childGroup.id} className="mm-child-group-inline">
                          <div className="mm-child-group-label">
                            <span className="text-indigo-400">↳</span>
                            {parentModifierName} → {childGroup.displayName || childGroup.name}
                            {childGroup.isRequired && <span className="text-red-400 ml-1">*</span>}
                          </div>
                          <ModifierGroupSection
                            group={childGroup}
                            selections={selections[childGroup.id] || []}
                            onToggle={toggleModifier}
                            isSelected={isSelected}
                            getSelectionCount={getSelectionCount}
                            getSelectedPreModifier={getSelectedPreModifier}
                            formatModPrice={formatModPrice}
                            groupColor={getGroupColor(childGroup)}
                            allowStacking={childGroup.allowStacking}
                            isSpiritGroup={childGroup.isSpiritGroup}
                            handleSpiritSelection={handleSpiritSelection}
                            getModifiersByTier={getModifiersByTier}
                            getTieredPrice={getTieredPrice}
                            getExcludedModifierIds={getExcludedModifierIds}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Special Notes */}
              <div className="mt-3 pt-3 border-t border-white/10">
                <label className="block font-medium text-slate-200 mb-1" style={{ fontSize: '13px', letterSpacing: '0.02em' }}>
                  📝 Special Instructions <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="Special instructions..."
                  className="w-full p-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder:text-slate-500 resize-none focus:outline-none"
                  style={{ transition: 'border-color 0.15s ease' }}
                  rows={2}
                  maxLength={200}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)' }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/10" style={{ background: 'rgba(30, 30, 50, 0.9)', backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm text-slate-300">Total</span>
            <span className="text-xl font-bold text-emerald-400">{formatCurrency(totalPrice * cpm)}</span>
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
    </Modal>
  )
}
