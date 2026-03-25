'use client'

/**
 * ModifierGroupRenderer — Renders a modifier group with all its options.
 *
 * Supports radio (max=1) and checkbox (max>1) modes, stacking quantities,
 * pre-modifiers (No/Lite/Extra/Side), child modifier groups, open entry,
 * and the "None" option.
 */

import { useState } from 'react'
import { NoneButton } from './NoneButton'
import { OpenEntryInput } from './OpenEntryInput'
import { ChildModifierExpander } from './ChildModifierExpander'
import type {
  ModifierGroupData,
  ModifierOptionData,
  SelectedModifier,
  PreModifier,
} from './modifier-types'
import { formatModifierPrice } from './modifier-types'

interface ModifierGroupRendererProps {
  group: ModifierGroupData
  selections: Map<string, SelectedModifier[]>
  onSelectionChange: (groupId: string, selections: SelectedModifier[]) => void
  depth?: number
  /** Map of exclusionGroupKey → groupIds sharing that key. Used to enforce mutual exclusion across groups. */
  exclusionGroups?: Map<string, string[]>
  /** Callback to clear selections in another group when exclusion fires */
  onExclusionClear?: (groupId: string) => void
}

// ── Pre-modifier pill button ────────────────────────────────────────────────

interface PreModPillProps {
  label: string
  value: PreModifier
  active: boolean
  extraPriceLabel?: string
  onSelect: (value: PreModifier) => void
}

function PreModPill({ label, value, active, extraPriceLabel, onSelect }: PreModPillProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect(value)
      }}
      className="rounded-full border px-2.5 py-1 text-xs font-medium transition-all"
      style={{
        minHeight: 28,
        borderColor: active ? 'var(--site-brand)' : 'var(--site-border)',
        backgroundColor: active ? 'var(--site-brand)' : 'transparent',
        color: active ? '#fff' : 'var(--site-text-muted)',
      }}
    >
      {label}
      {extraPriceLabel && (
        <span className="ml-1 opacity-75">{extraPriceLabel}</span>
      )}
    </button>
  )
}

// ── Quantity stepper ────────────────────────────────────────────────────────

interface QuantityStepperProps {
  quantity: number
  onDecrement: () => void
  onIncrement: () => void
}

function QuantityStepper({ quantity, onDecrement, onIncrement }: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onDecrement}
        className="flex items-center justify-center rounded-full border text-sm font-bold transition-colors"
        style={{
          width: 28,
          height: 28,
          borderColor: 'var(--site-border)',
          color: 'var(--site-text)',
        }}
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium" style={{ color: 'var(--site-text)' }}>
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        className="flex items-center justify-center rounded-full border text-sm font-bold transition-colors"
        style={{
          width: 28,
          height: 28,
          borderColor: 'var(--site-brand)',
          backgroundColor: 'var(--site-brand)',
          color: '#fff',
        }}
      >
        +
      </button>
    </div>
  )
}

// ── Single modifier option row ──────────────────────────────────────────────

interface ModifierOptionRowProps {
  option: ModifierOptionData
  isSelected: boolean
  isRadio: boolean
  selection: SelectedModifier | undefined
  allowStacking: boolean
  depth: number
  onToggle: () => void
  onPreModChange: (preMod: PreModifier) => void
  onQuantityChange: (delta: number) => void
  childSelections: Map<string, SelectedModifier[]>
  onChildSelectionChange: (groupId: string, selections: SelectedModifier[]) => void
}

function ModifierOptionRow({
  option,
  isSelected,
  isRadio,
  selection,
  allowStacking,
  depth,
  onToggle,
  onPreModChange,
  onQuantityChange,
  childSelections,
  onChildSelectionChange,
}: ModifierOptionRowProps) {
  const currentPreMod = selection?.preModifier ?? 'regular'
  const hasPreMods = option.allowNo || option.allowLite || option.allowExtra || option.allowOnSide
  const priceDisplay = option.price > 0 ? formatModifierPrice(option.price) : ''

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all"
        style={{
          minHeight: 44,
          borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
          backgroundColor: isSelected ? 'rgba(var(--site-brand-rgb), 0.05)' : 'transparent',
        }}
      >
        {/* Radio / checkbox indicator */}
        <span
          className="shrink-0 flex items-center justify-center border-2 transition-colors"
          style={{
            width: 20,
            height: 20,
            borderRadius: isRadio ? '50%' : 4,
            borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
            backgroundColor: isSelected ? 'var(--site-brand)' : 'transparent',
          }}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </span>

        {/* Name + price */}
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium" style={{ color: 'var(--site-text)' }}>
            {option.name}
          </span>
          {priceDisplay && (
            <span className="ml-2 text-sm" style={{ color: 'var(--site-text-muted)' }}>
              {priceDisplay}
            </span>
          )}
        </span>

        {/* Stacking quantity stepper (shown when selected + stacking allowed) */}
        {isSelected && allowStacking && (
          <QuantityStepper
            quantity={selection?.quantity ?? 1}
            onDecrement={() => onQuantityChange(-1)}
            onIncrement={() => onQuantityChange(1)}
          />
        )}
      </button>

      {/* Pre-modifier pills (shown when selected and option has pre-mod flags) */}
      {isSelected && hasPreMods && (
        <div className="flex flex-wrap gap-1.5 mt-2 ml-10">
          <PreModPill
            label="Regular"
            value="regular"
            active={currentPreMod === 'regular'}
            onSelect={onPreModChange}
          />
          {option.allowNo && (
            <PreModPill
              label="No"
              value="no"
              active={currentPreMod === 'no'}
              onSelect={onPreModChange}
            />
          )}
          {option.allowLite && (
            <PreModPill
              label="Lite"
              value="lite"
              active={currentPreMod === 'lite'}
              onSelect={onPreModChange}
            />
          )}
          {option.allowExtra && (
            <PreModPill
              label="Extra"
              value="extra"
              active={currentPreMod === 'extra'}
              extraPriceLabel={option.extraPrice > 0 ? formatModifierPrice(option.extraPrice) : undefined}
              onSelect={onPreModChange}
            />
          )}
          {option.allowOnSide && (
            <PreModPill
              label="Side"
              value="side"
              active={currentPreMod === 'side'}
              onSelect={onPreModChange}
            />
          )}
        </div>
      )}

      {/* Child modifier group (shown when selected and option has children) */}
      {isSelected && option.childModifierGroup && (
        <ChildModifierExpander
          childGroup={option.childModifierGroup}
          parentModifierId={option.id}
          selections={childSelections}
          onSelectionChange={onChildSelectionChange}
          depth={depth}
        />
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function ModifierGroupRenderer({
  group,
  selections,
  onSelectionChange,
  depth = 0,
  exclusionGroups,
  onExclusionClear,
}: ModifierGroupRendererProps) {
  const [openEntryText, setOpenEntryText] = useState('')

  const groupSelections = selections.get(group.id) ?? []
  const isRadio = group.maxSelections === 1
  const isNoneSelected = groupSelections.some((s) => s.isNoneSelection)

  // Selection count hint text
  const selectionHint = (() => {
    if (group.minSelections === group.maxSelections && group.minSelections === 1) {
      return 'Choose 1'
    }
    if (group.minSelections === 0 && group.maxSelections === 1) {
      return 'Choose up to 1'
    }
    if (group.minSelections > 0 && group.maxSelections > 1) {
      return `Choose ${group.minSelections}–${group.maxSelections}`
    }
    if (group.maxSelections > 1) {
      return `Choose up to ${group.maxSelections}`
    }
    return null
  })()

  const nonNoneCount = groupSelections.filter((s) => !s.isNoneSelection).length
  const hasError = group.isRequired && group.minSelections > 0 && nonNoneCount < group.minSelections && !isNoneSelected

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleNoneSelect() {
    onSelectionChange(group.id, [{
      modifierId: `${group.id}__none`,
      name: 'None',
      price: 0,
      quantity: 1,
      preModifier: null,
      depth,
      isNoneSelection: true,
    }])
  }

  function handleToggle(option: ModifierOptionData) {
    const existing = groupSelections.find((s) => s.modifierId === option.id)

    if (existing) {
      // Deselect
      if (isRadio) {
        // Radio: can only deselect if group is not required
        if (!group.isRequired) {
          onSelectionChange(group.id, [])
        }
        return
      }
      onSelectionChange(
        group.id,
        groupSelections.filter((s) => s.modifierId !== option.id)
      )
      return
    }

    // TODO: Exclusion group enforcement — when this group has an exclusionGroupKey,
    // check if any other group shares the same key via exclusionGroups map and call
    // onExclusionClear(otherGroupId) to clear conflicting selections.
    // This requires MenuItemSheet to build the exclusionGroups map from all modifier groups
    // and pass the onExclusionClear callback that clears the target group's selections.
    if (group.exclusionGroupKey && exclusionGroups && onExclusionClear) {
      const siblingGroupIds = exclusionGroups.get(group.exclusionGroupKey) ?? []
      for (const siblingId of siblingGroupIds) {
        if (siblingId !== group.id) {
          onExclusionClear(siblingId)
        }
      }
    }

    // Select
    const newSelection: SelectedModifier = {
      modifierId: option.id,
      name: option.name,
      price: option.price,
      quantity: 1,
      preModifier: null,
      depth,
      childSelections: option.childModifierGroup ? new Map() : undefined,
    }

    if (isRadio) {
      onSelectionChange(group.id, [newSelection])
      return
    }

    // Multi-select: check max
    const current = groupSelections.filter((s) => !s.isNoneSelection)
    if (group.maxSelections > 0 && current.length >= group.maxSelections) {
      return // At max
    }

    // Clear "None" if selecting a real modifier
    const filtered = groupSelections.filter((s) => !s.isNoneSelection)
    onSelectionChange(group.id, [...filtered, newSelection])
  }

  function handlePreModChange(optionId: string, preMod: PreModifier) {
    onSelectionChange(
      group.id,
      groupSelections.map((s) =>
        s.modifierId === optionId ? { ...s, preModifier: preMod } : s
      )
    )
  }

  function handleQuantityChange(optionId: string, delta: number) {
    onSelectionChange(
      group.id,
      groupSelections.flatMap((s) => {
        if (s.modifierId !== optionId) return [s]
        const newQty = s.quantity + delta
        if (newQty <= 0) return [] // Remove
        return [{ ...s, quantity: newQty }]
      })
    )
  }

  function handleChildSelectionChange(optionId: string, childGroupId: string, childSels: SelectedModifier[]) {
    onSelectionChange(
      group.id,
      groupSelections.map((s) => {
        if (s.modifierId !== optionId) return s
        const childMap = new Map(s.childSelections ?? [])
        if (childSels.length === 0) {
          childMap.delete(childGroupId)
        } else {
          childMap.set(childGroupId, childSels)
        }
        return { ...s, childSelections: childMap }
      })
    )
  }

  function handleOpenEntryChange(_groupId: string, value: string) {
    setOpenEntryText(value)

    // Persist open entry text as a SelectedModifier so it flows to the order
    const currentSels = groupSelections.filter(s => !s.isCustomEntry)

    if (value.trim()) {
      currentSels.push({
        modifierId: `custom-${group.id}`,
        name: value.trim(),
        price: 0,
        quantity: 1,
        preModifier: null,
        depth,
        isCustomEntry: true,
        customEntryText: value.trim(),
      })
    }

    onSelectionChange(group.id, currentSels)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="py-4">
      {/* Group header */}
      <div className="flex items-center gap-2 mb-3">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--site-text)' }}
        >
          {group.name}
        </h3>
        {group.isRequired && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              backgroundColor: hasError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(var(--site-brand-rgb), 0.1)',
              color: hasError ? '#ef4444' : 'var(--site-brand)',
            }}
          >
            Required
          </span>
        )}
        {selectionHint && (
          <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
            {selectionHint}
          </span>
        )}
      </div>

      {/* Error message */}
      {hasError && (
        <p className="text-xs mb-2" style={{ color: '#ef4444' }}>
          Please select at least {group.minSelections} option{group.minSelections > 1 ? 's' : ''}
        </p>
      )}

      {/* Options */}
      <div className="space-y-2">
        {/* None button */}
        {group.allowNone && group.isRequired && (
          <NoneButton
            groupId={group.id}
            isSelected={isNoneSelected}
            onSelect={handleNoneSelect}
          />
        )}

        {/* Modifier options */}
        {group.options.map((option) => {
          const selection = groupSelections.find((s) => s.modifierId === option.id)
          const isSelected = !!selection && !isNoneSelected

          return (
            <ModifierOptionRow
              key={option.id}
              option={option}
              isSelected={isSelected}
              isRadio={isRadio}
              selection={selection}
              allowStacking={group.allowStacking}
              depth={depth}
              onToggle={() => handleToggle(option)}
              onPreModChange={(preMod) => handlePreModChange(option.id, preMod)}
              onQuantityChange={(delta) => handleQuantityChange(option.id, delta)}
              childSelections={selection?.childSelections ?? new Map()}
              onChildSelectionChange={(childGroupId, childSels) =>
                handleChildSelectionChange(option.id, childGroupId, childSels)
              }
            />
          )
        })}

        {/* Open entry */}
        {group.allowOpenEntry && (
          <OpenEntryInput
            groupId={group.id}
            value={openEntryText}
            onChange={handleOpenEntryChange}
          />
        )}
      </div>
    </div>
  )
}
