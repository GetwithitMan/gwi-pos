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
}: ModifierGroupSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const selectedCount = selections.length

  // Spirit group rendering
  if (isSpiritGroup && handleSpiritSelection && getModifiersByTier) {
    const modifiersByTier = getModifiersByTier(group.modifiers)
    const currentSelection = selections[0]
    const selectedTier = currentSelection?.spiritTier as SpiritTier | undefined

    return (
      <div className="mb-3 p-3 rounded-lg border" style={{ borderColor: groupColor + '40', backgroundColor: groupColor + '10' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: groupColor }} />
          <span className="font-medium text-sm text-slate-200">{group.displayName || group.name}</span>
          {group.isRequired && <span className="text-red-500 text-xs">*</span>}
        </div>

        {/* Tier quick-select buttons */}
        <div className="flex gap-1.5 mb-2">
          {(['well', 'call', 'premium', 'top_shelf'] as SpiritTier[]).map(tier => {
            const tierMods = modifiersByTier[tier]
            if (tierMods.length === 0) return null
            const config = SPIRIT_TIER_CONFIG[tier]
            const isSelected = selectedTier === tier

            return (
              <button
                key={tier}
                className={`flex-1 py-1.5 px-2 rounded text-center text-xs transition-all border ${
                  isSelected ? config.selectedColor + ' font-medium' : config.color
                }`}
                onClick={() => handleSpiritSelection(group, tierMods[0], tier)}
              >
                <div className="font-medium">{config.label}</div>
                <div className="opacity-75">
                  {tierMods[0].price === 0 ? 'Incl' : `+${formatCurrency(tierMods[0].price)}`}
                </div>
              </button>
            )
          })}
        </div>

        {/* Selected spirit */}
        {currentSelection && (
          <div className="text-xs bg-white/10 rounded p-2 flex justify-between items-center">
            <span className="font-medium text-slate-200">{currentSelection.name}</span>
            <span className="text-emerald-400">
              {currentSelection.price === 0 ? 'Included' : `+${formatCurrency(currentSelection.price)}`}
            </span>
          </div>
        )}

        {/* Expandable all options */}
        <details className="mt-2">
          <summary className="text-xs text-slate-400 cursor-pointer">All {group.modifiers.length} options</summary>
          <div className="flex flex-wrap gap-1 mt-1">
            {group.modifiers.map(mod => {
              const isModSelected = currentSelection?.id === mod.id
              const tier = mod.spiritTier as SpiritTier || 'well'
              const is86d = mod.is86d || false

              return (
                <button
                  key={mod.id}
                  className={`px-2 py-0.5 text-xs rounded transition-all ${
                    is86d
                      ? 'opacity-40 cursor-not-allowed grayscale'
                      : isModSelected
                      ? SPIRIT_TIER_CONFIG[tier].selectedColor
                      : 'bg-white/7 hover:bg-white/12 text-slate-300'
                  }`}
                  onClick={() => {
                    if (is86d) {
                      toast.warning(`${mod.name} is 86'd (out of stock)`)
                    } else {
                      handleSpiritSelection(group, mod, tier)
                    }
                  }}
                >
                  <span className={is86d ? 'line-through' : ''}>
                    {mod.name}
                  </span>
                </button>
              )
            })}
          </div>
        </details>
      </div>
    )
  }

  // Regular modifier group rendering
  // Compute excluded modifiers (cross-group duplicate prevention)
  const excludedIds = getExcludedModifierIds
    ? getExcludedModifierIds(group.id, group.exclusionGroupKey)
    : new Set<string>()

  return (
    <div className="mb-3">
      {/* Group header - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: groupColor }}
          />
          <span className="font-medium text-sm text-slate-200">{group.displayName || group.name}</span>
          {group.isRequired && <span className="text-red-500 text-xs">*</span>}
          {allowStacking && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
              Tap same item twice for 2x
            </span>
          )}
          {selectedCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full text-white"
              style={{ backgroundColor: groupColor }}
            >
              {selectedCount}/{group.maxSelections}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Modifier grid */}
      <div className="grid grid-cols-2 gap-2 mt-2 ml-5">
        {group.modifiers.slice(0, isExpanded ? undefined : 8).map(modifier => {
          const selected = isSelected(group.id, modifier.id)
          const selectionCount = getSelectionCount(group.id, modifier.id)
          const selectedPreMod = getSelectedPreModifier(group.id, modifier.id)
          const hasPreModifiers = modifier.allowedPreModifiers && (modifier.allowedPreModifiers as string[]).length > 0
          const preModifiers = (modifier.allowedPreModifiers as string[]) || []
          const hasChildGroup = !!modifier.childModifierGroupId
          const is86d = modifier.is86d || false
          const isExcluded = excludedIds.has(modifier.id)

          // Calculate dynamic price for tiered pricing
          const displayPrice = getTieredPrice && group.tieredPricingConfig?.enabled
            ? getTieredPrice(group, modifier, selections.length)  // Next selection index
            : modifier.price

          // Determine button style based on selection count for stacking
          const isStacked = selectionCount > 1
          const getButtonStyle = () => {
            if (is86d) {
              // 86'd items are always dimmed
              return { className: 'mm-btn opacity-40 cursor-not-allowed grayscale', style: undefined }
            }
            if (isExcluded) {
              // Excluded items are grayed out (lighter than 86'd)
              return { className: 'mm-btn opacity-30 cursor-not-allowed', style: undefined }
            }
            if (!selected) {
              return { className: 'mm-btn bg-white/7 text-slate-300 hover:bg-white/12', style: undefined }
            }
            if (selectedPreMod) {
              return { className: 'mm-btn-selected-with-premods ring-2 ring-offset-1 bg-white/12 text-slate-200', style: undefined }
            }
            if (isStacked) {
              // Stacked selection - use a gradient/brighter style
              return {
                className: 'mm-btn-stacked text-white shadow-lg scale-105 ring-2 ring-yellow-400',
                style: { background: `linear-gradient(135deg, ${groupColor} 0%, #f59e0b 100%)` }
              }
            }
            // Single selection
            return {
              className: 'mm-btn-selected text-white shadow-md scale-105',
              style: { backgroundColor: groupColor }
            }
          }
          const buttonStyle = getButtonStyle()

          return (
            <div key={modifier.id} className="flex flex-col gap-1">
              {/* Main modifier button */}
              <button
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
                  // Auto-drill down if modifier has child group and becomes selected
                  if (hasChildGroup && !selected && onDrillDown) {
                    // Use setTimeout to allow the selection to happen first
                    setTimeout(() => {
                      onDrillDown(modifier.childModifierGroupId!, modifier.name)
                    }, 0)
                  }
                }}
                className={`relative px-3 py-3 text-sm rounded-lg transition-all min-h-[48px] flex items-center justify-between ${buttonStyle.className}`}
                style={buttonStyle.style}
                title={`${modifier.name}${displayPrice > 0 ? ` (+${formatCurrency(displayPrice)})` : ''}${allowStacking ? ' (click again to add more)' : ''}${is86d ? ' (86\'d - out of stock)' : ''}${isExcluded ? ' (already selected elsewhere)' : ''}`}
              >
                <span className="flex-1 text-left">
                  <span className={is86d ? 'line-through' : ''}>
                    {modifier.name}
                  </span>
                  {/* Price display with tiered pricing support */}
                  {displayPrice === 0 && group.tieredPricingConfig?.enabled && modifier.price > 0 ? (
                    <span className="ml-1 block text-xs text-green-400 font-semibold">FREE</span>
                  ) : displayPrice > 0 ? (
                    <span className={`ml-1 block text-xs ${selected && !selectedPreMod ? 'text-white/80' : 'text-emerald-400'}`}>
                      {formatModPrice(modifier.price, displayPrice)}
                      {displayPrice !== modifier.price && modifier.price > 0 && (
                        <span className="line-through opacity-50 ml-1">{formatModPrice(modifier.price)}</span>
                      )}
                    </span>
                  ) : null}
                </span>

                {/* 86'd badge */}
                {is86d && <EightySixBadge size="sm" />}

                {/* Stacking count badge */}
                {!is86d && selectionCount > 1 && (
                  <span className="absolute -top-2 -right-2 bg-yellow-500 text-black text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-md border-2 border-white">
                    {selectionCount}x
                  </span>
                )}

                {/* Child group indicator */}
                {!is86d && hasChildGroup && (
                  <span className="text-slate-400 ml-1">›</span>
                )}
              </button>

              {/* Pre-modifier buttons - show when modifier is selected or has preModifiers and expanded, but NOT if 86'd */}
              {!is86d && hasPreModifiers && (selected || isExpanded) && (
                <div className="flex gap-0.5 flex-wrap">
                  {preModifiers.map(preMod => {
                    const config = PRE_MODIFIER_CONFIG[preMod]
                    if (!config) return null
                    const isPreModSelected = selectedPreMod === preMod

                    return (
                      <button
                        key={preMod}
                        onClick={() => onToggle(group, modifier, preMod)}
                        className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
                          isPreModSelected
                            ? `${config.activeClass} font-semibold ring-1 ring-offset-1`
                            : `${config.cssClass} opacity-70 hover:opacity-100`
                        }`}
                        title={`${config.label} ${modifier.name}${preMod === 'extra' && modifier.extraPrice ? ` (+${formatCurrency(modifier.extraPrice)})` : ''}`}
                      >
                        {config.label}
                        {preMod === 'extra' && modifier.extraPrice && modifier.extraPrice > 0 && (
                          <span className="ml-0.5">+${modifier.extraPrice}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {!isExpanded && group.modifiers.length > 8 && (
          <span className="px-2 py-1 text-xs text-slate-500">
            +{group.modifiers.length - 8} more
          </span>
        )}
      </div>
    </div>
  )
}
