'use client'

import { formatCurrency } from '@/lib/utils'
import type { SelectedModifier, Modifier, ModifierGroup } from '@/types'
import { PRE_MODIFIER_CONFIG, type SpiritTier, SPIRIT_TIER_CONFIG } from './useModifierSelections'
import { useState } from 'react'
import { EightySixBadge } from './EightySixBadge'
import { toast } from '@/stores/toast-store'

interface ModifierGroupSectionProps {
  group: ModifierGroup
  selections: SelectedModifier[]
  onToggle: (group: ModifierGroup, modifier: Modifier, preModifier?: string) => void
  isSelected: (groupId: string, modifierId: string) => boolean
  getSelectionCount: (groupId: string, modifierId: string) => number
  getSelectedPreModifier: (groupId: string, modifierId: string) => string | undefined
  formatModPrice: (price: number, overridePrice?: number) => string
  groupColor: string
  allowStacking?: boolean
  onDrillDown?: (childGroupId: string, childGroupName: string) => void
  isSpiritGroup?: boolean
  handleSpiritSelection?: (group: ModifierGroup, modifier: Modifier, tier: SpiritTier) => void
  getModifiersByTier?: (modifiers: Modifier[]) => Record<SpiritTier, Modifier[]>
  getTieredPrice?: (group: ModifierGroup, modifier: Modifier, selectionIndex: number) => number
  getExcludedModifierIds?: (currentGroupId: string, exclusionGroupKey: string | null | undefined) => Set<string>
  cardPriceMultiplier?: number
}

export function ModifierGroupSection({
  group,
  selections,
  onToggle,
  isSelected,
  getSelectionCount,
  getSelectedPreModifier,
  formatModPrice,
  groupColor,
  allowStacking,
  onDrillDown,
  isSpiritGroup,
  handleSpiritSelection,
  getModifiersByTier,
  getTieredPrice,
  getExcludedModifierIds,
  cardPriceMultiplier,
}: ModifierGroupSectionProps) {
  const cpm = cardPriceMultiplier || 1
  const selectedCount = selections.length
  const isComplete = group.isRequired
    ? selectedCount >= group.minSelections
    : selectedCount > 0

  // Compute excluded modifiers (cross-group duplicate prevention)
  const excludedIds = getExcludedModifierIds
    ? getExcludedModifierIds(group.id, group.exclusionGroupKey)
    : new Set<string>()

  // Determine box border class
  const boxClass = isComplete
    ? 'mm-group-box mm-group-box-complete'
    : group.isRequired
    ? 'mm-group-box mm-group-box-required'
    : 'mm-group-box'

  const headerClass = isComplete
    ? 'mm-group-box-header mm-group-box-header-complete'
    : group.isRequired
    ? 'mm-group-box-header mm-group-box-header-required'
    : 'mm-group-box-header'

  // Spirit group rendering — compact box version
  if (isSpiritGroup && handleSpiritSelection && getModifiersByTier) {
    const modifiersByTier = getModifiersByTier(group.modifiers)
    const currentSelection = selections[0]
    const selectedTier = currentSelection?.spiritTier as SpiritTier | undefined

    return (
      <div className={boxClass}>
        <div className={`${headerClass} ${group.isRequired ? 'mm-group-header-required' : 'mm-group-header-optional'}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{group.displayName || group.name}</span>
            {group.isRequired ? (
              <span className="text-red-400/70 text-[10px] flex-shrink-0">• Required</span>
            ) : (
              <span className="text-gray-400/60 text-[10px] flex-shrink-0">• Optional</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {group.isRequired && !isComplete && <span className="text-red-400 text-[10px]">REQ</span>}
            {selectedCount > 0 && (
              <span className="text-[10px] px-1 rounded bg-white/15">{selectedCount}/{group.maxSelections}</span>
            )}
          </div>
        </div>
        <div className="mm-group-box-body">
          {/* Tier quick-select */}
          <div className="flex gap-1 mb-1">
            {(['well', 'call', 'premium', 'top_shelf'] as SpiritTier[]).map(tier => {
              const tierMods = modifiersByTier[tier]
              if (tierMods.length === 0) return null
              const config = SPIRIT_TIER_CONFIG[tier]
              const isTierSelected = selectedTier === tier

              return (
                <button
                  key={tier}
                  className={`flex-1 py-1 px-1 rounded text-center text-[10px] transition-all border ${
                    isTierSelected ? config.selectedColor + ' font-medium' : config.color
                  }`}
                  onClick={() => handleSpiritSelection(group, tierMods[0], tier)}
                >
                  {config.label}
                </button>
              )
            })}
          </div>

          {/* Selected spirit display */}
          {currentSelection && (
            <div className="text-[11px] bg-white/10 rounded px-2 py-1 flex justify-between items-center mb-1">
              <span className="font-medium text-slate-200 truncate">{currentSelection.name}</span>
              <span className="text-emerald-400 text-[10px] ml-1 flex-shrink-0">
                {currentSelection.price === 0 ? 'Incl' : `+${formatCurrency(currentSelection.price * cpm)}`}
              </span>
            </div>
          )}

          {/* All options expandable */}
          <details className="mt-auto">
            <summary className="text-[10px] text-slate-500 cursor-pointer">All {group.modifiers.length} options</summary>
            <div className="flex flex-col gap-1 mt-1">
              {group.modifiers.map(mod => {
                const isModSelected = currentSelection?.id === mod.id
                const tier = mod.spiritTier as SpiritTier || 'well'
                const is86d = mod.is86d || false

                return (
                  <button
                    key={mod.id}
                    className={`mm-box-mod-btn ${
                      is86d
                        ? 'mm-box-mod-btn-86d'
                        : isModSelected
                        ? 'mm-box-mod-btn-selected'
                        : ''
                    }`}
                    onClick={() => {
                      if (is86d) {
                        toast.warning(`${mod.name} is 86'd (out of stock)`)
                      } else {
                        handleSpiritSelection(group, mod, tier)
                      }
                    }}
                  >
                    <span className="truncate">{mod.name}</span>
                    {mod.price > 0 && (
                      <span className="text-[10px] text-emerald-400 flex-shrink-0">+{formatCurrency(mod.price * cpm)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </details>
        </div>
      </div>
    )
  }

  // ── Regular modifier group — box card ──
  return (
    <div className={boxClass}>
      {/* Box header with group name */}
      <div className={`${headerClass} ${group.isRequired ? 'mm-group-header-required' : 'mm-group-header-optional'}`} style={{ borderBottomColor: groupColor + '30' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: groupColor }} />
          <span className="truncate">{group.displayName || group.name}</span>
          {group.isRequired ? (
            <span className="text-red-400/70 text-[10px] flex-shrink-0">• Required</span>
          ) : (
            <span className="text-gray-400/60 text-[10px] flex-shrink-0">• Optional</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {group.isRequired && !isComplete && <span className="text-red-400 text-[10px] font-bold">REQ</span>}
          {allowStacking && <span className="text-[9px] text-yellow-300">2x</span>}
          {selectedCount > 0 && (
            <span className="text-[10px] px-1 rounded bg-white/15">{selectedCount}/{group.maxSelections}</span>
          )}
        </div>
      </div>

      {/* Modifier buttons */}
      <div className="mm-group-box-body">
        {group.modifiers.map(modifier => {
          const selected = isSelected(group.id, modifier.id)
          const selectionCount = getSelectionCount(group.id, modifier.id)
          const selectedPreMod = getSelectedPreModifier(group.id, modifier.id)
          const preModifiersFromJson = modifier.allowedPreModifiers as string[] | null
          const preModifiers = (preModifiersFromJson && preModifiersFromJson.length > 0)
            ? preModifiersFromJson
            : [
                ...(modifier.allowNo ? ['no'] : []),
                ...(modifier.allowLite ? ['lite'] : []),
                ...(modifier.allowExtra ? ['extra'] : []),
                ...(modifier.allowOnSide ? ['side'] : []),
              ]
          const hasPreModifiers = preModifiers.length > 0
          const hasChildGroup = !!modifier.childModifierGroupId
          const is86d = modifier.is86d || false
          const isExcluded = excludedIds.has(modifier.id)
          const isStacked = selectionCount > 1

          // Calculate dynamic price for tiered pricing
          const displayPrice = getTieredPrice && group.tieredPricingConfig?.enabled
            ? getTieredPrice(group, modifier, selections.length)
            : modifier.price

          // Determine button class
          const getButtonClass = () => {
            if (is86d) return 'mm-box-mod-btn mm-box-mod-btn-86d'
            if (isExcluded) return 'mm-box-mod-btn mm-box-mod-btn-excluded'
            if (isStacked) return 'mm-box-mod-btn mm-box-mod-btn-stacked'
            if (selected && !selectedPreMod) return 'mm-box-mod-btn mm-box-mod-btn-selected'
            if (selected && selectedPreMod) return 'mm-box-mod-btn mm-box-mod-btn-selected'
            return 'mm-box-mod-btn'
          }

          return (
            <div key={modifier.id}>
              <button
                className={getButtonClass()}
                style={selected && !isStacked && !selectedPreMod ? { backgroundColor: groupColor, borderColor: groupColor } : undefined}
                onClick={() => {
                  if (is86d) {
                    toast.warning(`${modifier.name} is 86'd (out of stock)`)
                    return
                  }
                  if (isExcluded) {
                    toast.warning(`${modifier.name} is already selected in another group`)
                    return
                  }
                  onToggle(group, modifier, undefined)
                }}
              >
                <span className="truncate flex-1 text-left">
                  {modifier.name}
                </span>

                <span className="flex items-center gap-1 flex-shrink-0">
                  {/* Price */}
                  {displayPrice === 0 && group.tieredPricingConfig?.enabled && modifier.price > 0 ? (
                    <span className="text-[10px] text-green-400 font-semibold">FREE</span>
                  ) : displayPrice > 0 ? (
                    <span className={`text-[10px] ${selected ? 'text-white/80' : 'text-emerald-400'}`}>
                      +{formatCurrency(displayPrice * cpm)}
                    </span>
                  ) : null}

                  {/* 86'd badge */}
                  {is86d && <EightySixBadge size="sm" />}

                  {/* Stacking count */}
                  {!is86d && selectionCount > 1 && (
                    <span className="text-[10px] bg-yellow-500 text-black font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {selectionCount}x
                    </span>
                  )}

                  {/* Child group indicator */}
                  {!is86d && hasChildGroup && (
                    <span className="text-slate-400 text-xs">›</span>
                  )}
                </span>
              </button>

              {/* Pre-modifier buttons — inline under selected modifier */}
              {!is86d && hasPreModifiers && selected && (
                <div className="flex gap-0.5 flex-wrap px-1 py-0.5">
                  {preModifiers.map(preMod => {
                    const config = PRE_MODIFIER_CONFIG[preMod]
                    if (!config) return null
                    const isPreModSelected = selectedPreMod === preMod

                    return (
                      <button
                        key={preMod}
                        onClick={() => onToggle(group, modifier, preMod)}
                        className={`px-1.5 py-0.5 text-[9px] rounded transition-all ${
                          isPreModSelected
                            ? `${config.activeClass} font-semibold ring-1 ring-offset-1`
                            : `${config.cssClass} opacity-70 hover:opacity-100`
                        }`}
                      >
                        {config.label}
                        {preMod === 'extra' && modifier.extraPrice && modifier.extraPrice > 0 && (
                          <span className="ml-0.5">+${(modifier.extraPrice * cpm).toFixed(2)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
