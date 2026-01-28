'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import type { DualPricingSettings } from '@/lib/settings'
import type { MenuItem, ModifierGroup, SelectedModifier, Modifier } from '@/types'

// Spirit tier configuration
const SPIRIT_TIER_CONFIG = {
  well: { label: 'Well', color: 'bg-gray-100 border-gray-300 text-gray-700', selectedColor: 'bg-gray-200 border-gray-500 text-gray-900', badgeColor: 'bg-gray-500' },
  call: { label: 'Call', color: 'bg-blue-50 border-blue-200 text-blue-700', selectedColor: 'bg-blue-100 border-blue-500 text-blue-900', badgeColor: 'bg-blue-500' },
  premium: { label: 'Premium', color: 'bg-purple-50 border-purple-200 text-purple-700', selectedColor: 'bg-purple-100 border-purple-500 text-purple-900', badgeColor: 'bg-purple-500' },
  top_shelf: { label: 'Top Shelf', color: 'bg-amber-50 border-amber-200 text-amber-700', selectedColor: 'bg-amber-100 border-amber-500 text-amber-900', badgeColor: 'bg-amber-500' },
} as const

type SpiritTier = keyof typeof SPIRIT_TIER_CONFIG

interface ModifierModalProps {
  item: MenuItem
  modifierGroups: ModifierGroup[]
  loading: boolean
  editingItem?: {
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; preModifier?: string; depth: number; parentModifierId?: string }[]
  } | null
  dualPricing: DualPricingSettings
  onConfirm: (modifiers: SelectedModifier[], specialNotes?: string) => void
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
  // Helper to format modifier price - shows both card and cash prices if dual pricing enabled
  const discountPct = dualPricing.cashDiscountPercent || 4.0
  const formatModPrice = (storedPrice: number) => {
    if (storedPrice === 0) return 'Included'
    if (!dualPricing.enabled) {
      return `+${formatCurrency(storedPrice)}`
    }
    // Stored price is cash price, calculate card price
    const cashPrice = storedPrice
    const cardPrice = calculateCardPrice(storedPrice, discountPct)
    return (
      <span className="text-xs">
        <span className="text-gray-700">+{formatCurrency(cardPrice)}</span>
        <span className="text-gray-400 mx-0.5">-</span>
        <span className="text-green-600">+{formatCurrency(cashPrice)}</span>
      </span>
    )
  }
  // All selections keyed by groupId
  const [selections, setSelections] = useState<Record<string, SelectedModifier[]>>({})
  // Cache of loaded child modifier groups
  const [childGroups, setChildGroups] = useState<Record<string, ModifierGroup>>({})
  // Track which child groups are currently loading
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({})
  // Track if we've initialized from editing item
  const [initialized, setInitialized] = useState(false)
  // Special notes/instructions for the item
  const [specialNotes, setSpecialNotes] = useState(initialNotes || '')
  // Spirit upsell tracking
  const [shownUpsells, setShownUpsells] = useState<Record<string, { baseTier: SpiritTier; shown: boolean; accepted: boolean }>>({})
  const [activeUpsellGroup, setActiveUpsellGroup] = useState<string | null>(null)

  // Initialize with existing modifiers when editing, or defaults for new items
  useEffect(() => {
    if (initialized || modifierGroups.length === 0) return

    const initial: Record<string, SelectedModifier[]> = {}

    if (editingItem && editingItem.modifiers.length > 0) {
      // Pre-populate from existing order item modifiers
      // We need to match modifiers to their groups
      editingItem.modifiers.forEach(existingMod => {
        // Find which group this modifier belongs to
        for (const group of modifierGroups) {
          const matchingMod = group.modifiers.find(m => m.id === existingMod.id)
          if (matchingMod) {
            if (!initial[group.id]) initial[group.id] = []
            initial[group.id].push({
              id: existingMod.id,
              name: matchingMod.name, // Use the original name without preModifier
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            break
          }
        }
        // Also check child groups that might already be loaded
        for (const [groupId, childGroup] of Object.entries(childGroups)) {
          const matchingMod = childGroup.modifiers.find(m => m.id === existingMod.id)
          if (matchingMod) {
            if (!initial[groupId]) initial[groupId] = []
            initial[groupId].push({
              id: existingMod.id,
              name: matchingMod.name,
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            break
          }
        }
      })
    } else {
      // New item - use defaults
      modifierGroups.forEach(group => {
        const defaults = group.modifiers
          .filter(mod => mod.isDefault)
          .map(mod => ({
            id: mod.id,
            name: mod.name,
            price: mod.price,
            childModifierGroupId: mod.childModifierGroupId,
            depth: 0,
            parentModifierId: undefined,
          }))
        if (defaults.length > 0) {
          initial[group.id] = defaults
        }
      })
    }

    setSelections(initial)
    setInitialized(true)
  }, [modifierGroups, editingItem, childGroups, initialized])

  // Load a child modifier group by ID
  const loadChildGroup = async (groupId: string) => {
    if (childGroups[groupId] || loadingChildren[groupId]) return

    setLoadingChildren(prev => ({ ...prev, [groupId]: true }))
    try {
      const response = await fetch(`/api/menu/modifiers/${groupId}`)
      if (response.ok) {
        const data = await response.json()
        setChildGroups(prev => ({ ...prev, [groupId]: data }))
      }
    } catch (error) {
      console.error('Failed to load child modifier group:', error)
    } finally {
      setLoadingChildren(prev => ({ ...prev, [groupId]: false }))
    }
  }

  // When a modifier with a child is selected, load the child group
  useEffect(() => {
    Object.values(selections).flat().forEach(sel => {
      if (sel.childModifierGroupId && !childGroups[sel.childModifierGroupId]) {
        loadChildGroup(sel.childModifierGroupId)
      }
    })
  }, [selections])

  // When editing, match child modifiers once their groups are loaded
  useEffect(() => {
    if (!editingItem || !initialized) return

    // Find unmatched child modifiers (depth > 0 that aren't yet in selections)
    const unmatchedChildMods = editingItem.modifiers.filter(existingMod => {
      if ((existingMod.depth || 0) === 0) return false // Skip top-level
      // Check if already matched
      for (const sels of Object.values(selections)) {
        if (sels.some(s => s.id === existingMod.id)) return false
      }
      return true
    })

    if (unmatchedChildMods.length === 0) return

    // Try to match them to loaded child groups
    const newSelections = { ...selections }
    let changed = false

    unmatchedChildMods.forEach(existingMod => {
      for (const [groupId, childGroup] of Object.entries(childGroups)) {
        const matchingMod = childGroup.modifiers.find(m => m.id === existingMod.id)
        if (matchingMod) {
          if (!newSelections[groupId]) newSelections[groupId] = []
          // Check if not already added
          if (!newSelections[groupId].some(s => s.id === existingMod.id)) {
            newSelections[groupId].push({
              id: existingMod.id,
              name: matchingMod.name,
              price: existingMod.price,
              preModifier: existingMod.preModifier,
              childModifierGroupId: matchingMod.childModifierGroupId,
              depth: existingMod.depth || 0,
              parentModifierId: existingMod.parentModifierId,
            })
            changed = true
          }
          break
        }
      }
    })

    if (changed) {
      setSelections(newSelections)
    }
  }, [childGroups, editingItem, initialized, selections])

  // Calculate the depth of a group (0 for top-level, 1+ for children)
  const getGroupDepth = (groupId: string): number => {
    // Check if this is a top-level group
    if (modifierGroups.some(g => g.id === groupId)) {
      return 0
    }
    // It's a child group, find its parent
    for (const [parentGroupId, sels] of Object.entries(selections)) {
      for (const sel of sels) {
        if (sel.childModifierGroupId === groupId) {
          return getGroupDepth(parentGroupId) + 1
        }
      }
    }
    return 0
  }

  // Find the parent modifier ID for a group
  const getParentModifierId = (groupId: string): string | undefined => {
    for (const [, sels] of Object.entries(selections)) {
      for (const sel of sels) {
        if (sel.childModifierGroupId === groupId) {
          return sel.id
        }
      }
    }
    return undefined
  }

  const toggleModifier = (
    group: ModifierGroup,
    modifier: ModifierGroup['modifiers'][0],
    preModifier?: string
  ) => {
    const current = selections[group.id] || []
    const existingIndex = current.findIndex(s => s.id === modifier.id)

    let price = modifier.price
    if (preModifier === 'extra' && modifier.extraPrice) {
      price = modifier.extraPrice
    } else if (preModifier === 'no') {
      price = 0
    }

    // Calculate depth and parent for this modifier
    const depth = getGroupDepth(group.id)
    const parentModifierId = getParentModifierId(group.id)

    if (existingIndex >= 0) {
      // Remove if already selected - also remove any child selections
      const removedMod = current[existingIndex]
      const newSelections = { ...selections }
      newSelections[group.id] = current.filter(s => s.id !== modifier.id)

      // Remove child group selections if any
      if (removedMod.childModifierGroupId) {
        delete newSelections[removedMod.childModifierGroupId]
        // Recursively remove nested children
        const removeNestedChildren = (parentGroupId: string) => {
          const parentSelections = newSelections[parentGroupId] || []
          parentSelections.forEach(sel => {
            if (sel.childModifierGroupId) {
              delete newSelections[sel.childModifierGroupId]
              removeNestedChildren(sel.childModifierGroupId)
            }
          })
        }
        removeNestedChildren(removedMod.childModifierGroupId)
      }

      setSelections(newSelections)
    } else {
      // Add modifier with depth and parent info
      const newMod: SelectedModifier = {
        id: modifier.id,
        name: modifier.name,
        price,
        preModifier,
        childModifierGroupId: modifier.childModifierGroupId,
        depth,
        parentModifierId,
      }

      if (group.maxSelections === 1) {
        // Single select - replace and remove old child selections
        const oldSelection = current[0]
        const newSelections = { ...selections }

        if (oldSelection?.childModifierGroupId) {
          delete newSelections[oldSelection.childModifierGroupId]
        }

        newSelections[group.id] = [newMod]
        setSelections(newSelections)
      } else if (current.length < group.maxSelections) {
        // Multi-select - add if under max
        setSelections({
          ...selections,
          [group.id]: [...current, newMod],
        })
      }
    }
  }

  const updatePreModifier = (groupId: string, modifierId: string, preModifier: string, modifier: ModifierGroup['modifiers'][0]) => {
    const current = selections[groupId] || []
    const updated = current.map(s => {
      if (s.id === modifierId) {
        let price = modifier.price
        if (preModifier === 'extra' && modifier.extraPrice) {
          price = modifier.extraPrice
        } else if (preModifier === 'no') {
          price = 0
        }
        // Maintain depth and parentModifierId
        return { ...s, preModifier, price, depth: s.depth, parentModifierId: s.parentModifierId }
      }
      return s
    })
    setSelections({ ...selections, [groupId]: updated })
  }

  const isSelected = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).some(s => s.id === modifierId)
  }

  const getSelectedModifier = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).find(s => s.id === modifierId)
  }

  // Get all active child groups that should be displayed
  const getActiveChildGroups = (): { group: ModifierGroup; parentModifierName: string; depth: number }[] => {
    const result: { group: ModifierGroup; parentModifierName: string; depth: number }[] = []

    const findChildren = (groupId: string, parentName: string, depth: number) => {
      const groupSelections = selections[groupId] || []
      groupSelections.forEach(sel => {
        if (sel.childModifierGroupId && childGroups[sel.childModifierGroupId]) {
          const childGroup = childGroups[sel.childModifierGroupId]
          result.push({ group: childGroup, parentModifierName: sel.name, depth })
          // Recursively find children of children
          findChildren(sel.childModifierGroupId, sel.name, depth + 1)
        }
      })
    }

    // Start from top-level groups
    modifierGroups.forEach(group => {
      findChildren(group.id, '', 1)
    })

    return result
  }

  const canConfirm = () => {
    // Check all top-level required groups
    const topLevelOk = modifierGroups.every(group => {
      if (!group.isRequired) return true
      const selected = selections[group.id] || []
      return selected.length >= group.minSelections
    })

    // Check all active child groups that are required
    const activeChildren = getActiveChildGroups()
    const childrenOk = activeChildren.every(({ group }) => {
      if (!group.isRequired) return true
      const selected = selections[group.id] || []
      return selected.length >= group.minSelections
    })

    return topLevelOk && childrenOk
  }

  const getAllSelectedModifiers = (): SelectedModifier[] => {
    return Object.values(selections).flat()
  }

  const totalPrice = item.price + getAllSelectedModifiers().reduce((sum, mod) => sum + mod.price, 0)

  const activeChildGroups = getActiveChildGroups()

  // Group modifiers by spirit tier for spirit groups
  const getModifiersByTier = (modifiers: Modifier[]): Record<SpiritTier, Modifier[]> => {
    const byTier: Record<SpiritTier, Modifier[]> = {
      well: [],
      call: [],
      premium: [],
      top_shelf: [],
    }
    modifiers.forEach(mod => {
      const tier = (mod.spiritTier as SpiritTier) || 'well'
      byTier[tier].push(mod)
    })
    return byTier
  }

  // Handle spirit selection with upsell tracking
  const handleSpiritSelection = (group: ModifierGroup, modifier: Modifier, tier: SpiritTier) => {
    const depth = getGroupDepth(group.id)
    const parentModifierId = getParentModifierId(group.id)

    const newMod: SelectedModifier = {
      id: modifier.id,
      name: modifier.name,
      price: modifier.price,
      childModifierGroupId: modifier.childModifierGroupId,
      depth,
      parentModifierId,
      spiritTier: tier,
      linkedBottleProductId: modifier.linkedBottleProductId,
    }

    // Track upsell if selecting well and upsell is enabled
    if (tier === 'well' && group.spiritConfig?.upsellEnabled) {
      setShownUpsells(prev => ({
        ...prev,
        [group.id]: { baseTier: 'well', shown: true, accepted: false }
      }))
      setActiveUpsellGroup(group.id)
    } else if (activeUpsellGroup === group.id) {
      // Accepting upsell by selecting a higher tier
      if (tier !== 'well') {
        setShownUpsells(prev => ({
          ...prev,
          [group.id]: { ...prev[group.id], accepted: true }
        }))
      }
      setActiveUpsellGroup(null)
    }

    setSelections(prev => ({
      ...prev,
      [group.id]: [newMod],
    }))
  }

  // Dismiss upsell prompt
  const dismissUpsell = (groupId: string) => {
    setActiveUpsellGroup(null)
  }

  // Accept upsell by selecting a premium modifier
  const acceptUpsell = (group: ModifierGroup, tier: SpiritTier) => {
    const modifiers = group.modifiers.filter(m => m.spiritTier === tier)
    if (modifiers.length > 0) {
      handleSpiritSelection(group, modifiers[0], tier)
    }
  }

  // Render spirit group with tier-based UI
  const renderSpiritGroup = (group: ModifierGroup) => {
    const modifiersByTier = getModifiersByTier(group.modifiers)
    const currentSelection = selections[group.id]?.[0]
    const selectedTier = currentSelection?.spiritTier as SpiritTier | undefined
    const showUpsell = activeUpsellGroup === group.id && group.spiritConfig?.upsellEnabled

    // Find a premium option for upsell
    const premiumOption = modifiersByTier.premium[0] || modifiersByTier.call[0]
    const wellOption = modifiersByTier.well[0]
    const priceDiff = premiumOption && wellOption ? premiumOption.price - wellOption.price : 0

    return (
      <div key={group.id} className="bg-gradient-to-br from-purple-50 to-amber-50 rounded-lg p-4 border border-purple-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-purple-900">
              {group.displayName || group.name}
              {group.isRequired && <span className="text-red-500 ml-1">*</span>}
            </h3>
            {group.spiritConfig?.spiritCategoryName && (
              <p className="text-sm text-purple-600">{group.spiritConfig.spiritCategoryName}</p>
            )}
          </div>
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
            Spirit Selection
          </span>
        </div>

        {/* Tier quick-select buttons */}
        <div className="flex gap-2 mb-3">
          {(['well', 'call', 'premium', 'top_shelf'] as SpiritTier[]).map(tier => {
            const tierMods = modifiersByTier[tier]
            if (tierMods.length === 0) return null
            const config = SPIRIT_TIER_CONFIG[tier]
            const isSelected = selectedTier === tier

            return (
              <button
                key={tier}
                className={`flex-1 py-2 px-3 rounded-lg border-2 text-center transition-all ${
                  isSelected ? config.selectedColor + ' font-medium shadow-sm' : config.color + ' hover:opacity-80'
                }`}
                onClick={() => handleSpiritSelection(group, tierMods[0], tier)}
              >
                <div className="text-sm font-medium">{config.label}</div>
                <div className="text-xs opacity-75">
                  {tierMods[0].price === 0 ? 'Included' : `+${formatCurrency(tierMods[0].price)}`}
                </div>
              </button>
            )
          })}
        </div>

        {/* Upsell prompt */}
        {showUpsell && premiumOption && (
          <div className="bg-gradient-to-r from-purple-100 to-amber-100 border border-purple-300 rounded-lg p-3 mb-3 animate-pulse">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-purple-900">
                  {group.spiritConfig?.upsellPromptText || `Upgrade to ${premiumOption.name}?`}
                </p>
                <p className="text-sm text-purple-700">
                  Just {formatCurrency(priceDiff)} more for premium quality
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissUpsell(group.id)}
                  className="text-gray-600"
                >
                  No thanks
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => acceptUpsell(group, 'premium')}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  Upgrade
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Selected spirit details */}
        {currentSelection && (
          <div className="bg-white rounded-lg p-3 border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${SPIRIT_TIER_CONFIG[selectedTier || 'well'].badgeColor}`} />
                <span className="font-medium">{currentSelection.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${SPIRIT_TIER_CONFIG[selectedTier || 'well'].color}`}>
                  {SPIRIT_TIER_CONFIG[selectedTier || 'well'].label}
                </span>
              </div>
              <span className="font-medium text-green-600">
                {currentSelection.price === 0 ? 'Included' : `+${formatCurrency(currentSelection.price)}`}
              </span>
            </div>
          </div>
        )}

        {/* Expandable list of all options by tier */}
        <details className="mt-3">
          <summary className="text-sm text-purple-600 cursor-pointer hover:text-purple-800">
            View all {group.modifiers.length} options
          </summary>
          <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
            {(['well', 'call', 'premium', 'top_shelf'] as SpiritTier[]).map(tier => {
              const tierMods = modifiersByTier[tier]
              if (tierMods.length === 0) return null
              const config = SPIRIT_TIER_CONFIG[tier]

              return (
                <div key={tier}>
                  <div className={`text-xs font-semibold ${config.color.split(' ')[2]} mb-1`}>
                    {config.label}
                  </div>
                  {tierMods.map(mod => {
                    const isModSelected = currentSelection?.id === mod.id
                    return (
                      <button
                        key={mod.id}
                        className={`w-full text-left p-2 rounded border text-sm mb-1 transition-colors ${
                          isModSelected
                            ? config.selectedColor
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleSpiritSelection(group, mod, tier)}
                      >
                        <div className="flex justify-between items-center">
                          <span>{mod.name}</span>
                          <span className={mod.price > 0 ? 'text-green-600' : 'text-gray-400'}>
                            {mod.price === 0 ? 'Included' : `+${formatCurrency(mod.price)}`}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </details>
      </div>
    )
  }

  // Render a single modifier group
  const renderModifierGroup = (group: ModifierGroup, indent: number = 0, parentLabel?: string) => (
    <div key={group.id} className={indent > 0 ? 'ml-4 pl-4 border-l-2 border-blue-200' : ''}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">
          {parentLabel && (
            <span className="text-blue-600 text-sm mr-2">{parentLabel} →</span>
          )}
          {group.displayName || group.name}
          {group.isRequired && <span className="text-red-500 ml-1">*</span>}
        </h3>
        <span className="text-sm text-gray-500">
          {group.minSelections === group.maxSelections
            ? `Select ${group.minSelections}`
            : `Select ${group.minSelections}-${group.maxSelections}`}
        </span>
      </div>
      <div className="space-y-2">
        {group.modifiers.map(modifier => {
          const selected = isSelected(group.id, modifier.id)
          const selectedMod = getSelectedModifier(group.id, modifier.id)
          const hasPreModifiers = modifier.allowedPreModifiers && modifier.allowedPreModifiers.length > 0
          const hasChild = modifier.childModifierGroupId
          const childLoading = modifier.childModifierGroupId ? loadingChildren[modifier.childModifierGroupId] : false

          return (
            <div key={modifier.id}>
              <button
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selected
                    ? 'bg-blue-50 border-blue-500'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => toggleModifier(group, modifier)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={selected ? 'font-medium text-blue-700' : ''}>
                      {modifier.name}
                    </span>
                    {hasChild && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        + options
                      </span>
                    )}
                  </div>
                  <span className={modifier.price > 0 ? '' : 'text-gray-400'}>
                    {formatModPrice(modifier.price)}
                  </span>
                </div>
              </button>

              {/* Pre-modifier buttons when selected */}
              {selected && hasPreModifiers && (
                <div className="flex gap-2 mt-2 ml-4">
                  {modifier.allowedPreModifiers?.map(pre => (
                    <button
                      key={pre}
                      className={`px-3 py-1 rounded text-sm border ${
                        selectedMod?.preModifier === pre
                          ? 'bg-purple-100 border-purple-500 text-purple-700'
                          : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updatePreModifier(group.id, modifier.id, pre, modifier)
                      }}
                    >
                      {pre.charAt(0).toUpperCase() + pre.slice(1)}
                      {pre === 'extra' && modifier.extraPrice && (
                        <span className="ml-1 text-green-600">+{formatCurrency(modifier.extraPrice)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading indicator for child group */}
              {selected && hasChild && childLoading && (
                <div className="ml-4 mt-2 text-sm text-gray-500">Loading options...</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-bold">{item.name}</h2>
          <p className="text-gray-500">{formatCurrency(item.price)}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading modifiers...</div>
          ) : modifierGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No modifiers available</div>
          ) : (
            <div className="space-y-6">
              {/* Top-level modifier groups */}
              {modifierGroups.map(group =>
                group.isSpiritGroup
                  ? renderSpiritGroup(group)
                  : renderModifierGroup(group)
              )}

              {/* Child modifier groups (nested) */}
              {activeChildGroups.map(({ group, parentModifierName, depth }) => (
                <div key={group.id} className="pt-4 border-t">
                  {group.isSpiritGroup
                    ? renderSpiritGroup(group)
                    : renderModifierGroup(group, depth, parentModifierName)}
                </div>
              ))}

              {/* Special Notes/Instructions */}
              <div className="pt-4 border-t">
                <label className="block font-semibold mb-2">
                  Special Instructions
                  <span className="text-gray-400 text-sm font-normal ml-2">(optional)</span>
                </label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="E.g., no onions, extra sauce, allergy info..."
                  className="w-full p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                  maxLength={200}
                />
                <div className="text-xs text-gray-400 text-right mt-1">
                  {specialNotes.length}/200
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold">Total</span>
            {dualPricing.enabled ? (
              <div className="text-right">
                <span className="text-xl font-bold text-blue-600">{formatCurrency(calculateCardPrice(totalPrice, discountPct))}</span>
                <span className="text-gray-400 mx-1">-</span>
                <span className="text-lg font-bold text-green-600">{formatCurrency(totalPrice)}</span>
              </div>
            ) : (
              <span className="text-xl font-bold text-blue-600">{formatCurrency(totalPrice)}</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canConfirm()}
              onClick={() => onConfirm(getAllSelectedModifiers(), specialNotes.trim() || undefined)}
            >
              {editingItem ? 'Update Order' : 'Add to Order'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
