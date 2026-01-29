'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import type { DualPricingSettings } from '@/lib/settings'
import type { MenuItem, ModifierGroup, SelectedModifier, Modifier } from '@/types'

// Default pour size configuration (used as fallback for old data format)
const DEFAULT_POUR_SIZE_CONFIG = {
  standard: { label: 'Standard Pour', shortLabel: '1x', color: 'bg-blue-500', multiplier: 1.0 },
  shot: { label: 'Shot', shortLabel: '1x', color: 'bg-blue-500', multiplier: 1.0 }, // Legacy support
  double: { label: 'Double', shortLabel: '2x', color: 'bg-purple-500', multiplier: 2.0 },
  tall: { label: 'Tall', shortLabel: '1.5x', color: 'bg-green-500', multiplier: 1.5 },
  short: { label: 'Short', shortLabel: '0.75x', color: 'bg-amber-500', multiplier: 0.75 },
} as const

type PourSizeKey = keyof typeof DEFAULT_POUR_SIZE_CONFIG

// Pour size data can be old format (number) or new format ({ label, multiplier })
type PourSizeValue = number | { label: string; multiplier: number }

// Helper to get multiplier from pour size value (handles both formats)
function getPourSizeMultiplier(value: PourSizeValue): number {
  return typeof value === 'number' ? value : value.multiplier
}

// Helper to get label from pour size (handles both formats)
function getPourSizeLabel(key: string, value: PourSizeValue): string {
  if (typeof value === 'object' && value.label) {
    return value.label
  }
  return DEFAULT_POUR_SIZE_CONFIG[key as PourSizeKey]?.label || key.charAt(0).toUpperCase() + key.slice(1)
}

// Modifier type colors
const MODIFIER_TYPE_COLORS: Record<string, string> = {
  universal: '#6b7280',
  food: '#22c55e',
  liquor: '#8b5cf6',
  retail: '#f59e0b',
  entertainment: '#f97316',
  combo: '#ec4899',
}

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
  onConfirm: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number) => void
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
  const discountPct = dualPricing.cashDiscountPercent || 4.0

  // Pour size state
  const [selectedPourSize, setSelectedPourSize] = useState<string | null>(
    item.defaultPourSize || (item.pourSizes ? 'standard' : null)
  )

  // All selections keyed by groupId
  const [selections, setSelections] = useState<Record<string, SelectedModifier[]>>({})
  const [childGroups, setChildGroups] = useState<Record<string, ModifierGroup>>({})
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({})
  const [initialized, setInitialized] = useState(false)
  const [specialNotes, setSpecialNotes] = useState(initialNotes || '')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  // Get color for a modifier group based on its types
  const getGroupColor = (group: ModifierGroup): string => {
    const types = group.modifierTypes || ['universal']
    // Use the first non-universal type, or universal if that's all there is
    const primaryType = types.find(t => t !== 'universal') || 'universal'
    return MODIFIER_TYPE_COLORS[primaryType] || MODIFIER_TYPE_COLORS.universal
  }

  // Calculate pour multiplier (handles both old and new data formats)
  const pourMultiplier = selectedPourSize && item.pourSizes
    ? getPourSizeMultiplier(item.pourSizes[selectedPourSize] as PourSizeValue || 1.0)
    : 1.0

  // Helper to format modifier price
  const formatModPrice = (storedPrice: number) => {
    if (storedPrice === 0) return ''
    const adjustedPrice = item.applyPourToModifiers ? storedPrice * pourMultiplier : storedPrice
    if (!dualPricing.enabled) {
      return `+${formatCurrency(adjustedPrice)}`
    }
    const cashPrice = adjustedPrice
    const cardPrice = calculateCardPrice(adjustedPrice, discountPct)
    return `+${formatCurrency(cardPrice)}`
  }

  // Initialize with existing modifiers when editing, or defaults for new items
  useEffect(() => {
    if (initialized || modifierGroups.length === 0) return

    const initial: Record<string, SelectedModifier[]> = {}

    if (editingItem && editingItem.modifiers.length > 0) {
      editingItem.modifiers.forEach(existingMod => {
        for (const group of modifierGroups) {
          const matchingMod = group.modifiers.find(m => m.id === existingMod.id)
          if (matchingMod) {
            if (!initial[group.id]) initial[group.id] = []
            initial[group.id].push({
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
  }, [modifierGroups, editingItem, initialized])

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

  const getGroupDepth = (groupId: string): number => {
    if (modifierGroups.some(g => g.id === groupId)) return 0
    for (const [parentGroupId, sels] of Object.entries(selections)) {
      for (const sel of sels) {
        if (sel.childModifierGroupId === groupId) {
          return getGroupDepth(parentGroupId) + 1
        }
      }
    }
    return 0
  }

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

  const toggleModifier = (group: ModifierGroup, modifier: Modifier, preModifier?: string) => {
    const current = selections[group.id] || []
    const existingIndex = current.findIndex(s => s.id === modifier.id)

    let price = modifier.price
    if (preModifier === 'extra' && modifier.extraPrice) {
      price = modifier.extraPrice
    } else if (preModifier === 'no') {
      price = 0
    }

    const depth = getGroupDepth(group.id)
    const parentModifierId = getParentModifierId(group.id)

    if (existingIndex >= 0) {
      const removedMod = current[existingIndex]
      const newSelections = { ...selections }
      newSelections[group.id] = current.filter(s => s.id !== modifier.id)

      if (removedMod.childModifierGroupId) {
        delete newSelections[removedMod.childModifierGroupId]
      }

      setSelections(newSelections)
    } else {
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
        const oldSelection = current[0]
        const newSelections = { ...selections }

        if (oldSelection?.childModifierGroupId) {
          delete newSelections[oldSelection.childModifierGroupId]
        }

        newSelections[group.id] = [newMod]
        setSelections(newSelections)
      } else if (current.length < group.maxSelections) {
        setSelections({
          ...selections,
          [group.id]: [...current, newMod],
        })
      }
    }
  }

  const isSelected = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).some(s => s.id === modifierId)
  }

  const getActiveChildGroups = (): { group: ModifierGroup; parentModifierName: string; depth: number }[] => {
    const result: { group: ModifierGroup; parentModifierName: string; depth: number }[] = []

    const findChildren = (groupId: string, parentName: string, depth: number) => {
      const groupSelections = selections[groupId] || []
      groupSelections.forEach(sel => {
        if (sel.childModifierGroupId && childGroups[sel.childModifierGroupId]) {
          const childGroup = childGroups[sel.childModifierGroupId]
          result.push({ group: childGroup, parentModifierName: sel.name, depth })
          findChildren(sel.childModifierGroupId, sel.name, depth + 1)
        }
      })
    }

    modifierGroups.forEach(group => {
      findChildren(group.id, '', 1)
    })

    return result
  }

  const canConfirm = () => {
    const topLevelOk = modifierGroups.every(group => {
      if (!group.isRequired) return true
      const selected = selections[group.id] || []
      return selected.length >= group.minSelections
    })

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

  // Calculate total with pour multiplier
  const basePrice = item.price * pourMultiplier
  const modifierTotal = getAllSelectedModifiers().reduce((sum, mod) => {
    const modPrice = item.applyPourToModifiers ? mod.price * pourMultiplier : mod.price
    return sum + modPrice
  }, 0)
  const totalPrice = basePrice + modifierTotal

  const activeChildGroups = getActiveChildGroups()

  // Group modifiers by spirit tier for spirit groups
  const getModifiersByTier = (modifiers: Modifier[]): Record<SpiritTier, Modifier[]> => {
    const byTier: Record<SpiritTier, Modifier[]> = { well: [], call: [], premium: [], top_shelf: [] }
    modifiers.forEach(mod => {
      const tier = (mod.spiritTier as SpiritTier) || 'well'
      byTier[tier].push(mod)
    })
    return byTier
  }

  // Handle spirit selection
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

    setSelections(prev => ({
      ...prev,
      [group.id]: [newMod],
    }))
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

  // Render compact modifier squares for a group
  const renderCompactModifierGroup = (group: ModifierGroup) => {
    const groupColor = getGroupColor(group)
    const selectedCount = (selections[group.id] || []).length
    const isExpanded = expandedGroups[group.id]

    return (
      <div key={group.id} className="mb-3">
        {/* Group header - clickable to expand */}
        <button
          onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: groupColor }}
            />
            <span className="font-medium text-sm">{group.displayName || group.name}</span>
            {group.isRequired && <span className="text-red-500 text-xs">*</span>}
            {selectedCount > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full text-white"
                style={{ backgroundColor: groupColor }}
              >
                {selectedCount}
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Compact modifier squares - always visible */}
        <div className="flex flex-wrap gap-1.5 mt-1 ml-5">
          {group.modifiers.slice(0, isExpanded ? undefined : 8).map(modifier => {
            const selected = isSelected(group.id, modifier.id)
            return (
              <button
                key={modifier.id}
                onClick={() => toggleModifier(group, modifier)}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  selected
                    ? 'text-white shadow-md scale-105'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={selected ? { backgroundColor: groupColor } : undefined}
                title={`${modifier.name}${modifier.price > 0 ? ` (+${formatCurrency(modifier.price)})` : ''}`}
              >
                {modifier.name.length > 12 ? modifier.name.substring(0, 10) + '...' : modifier.name}
                {modifier.price > 0 && (
                  <span className={`ml-1 ${selected ? 'text-white/80' : 'text-green-600'}`}>
                    {formatModPrice(modifier.price)}
                  </span>
                )}
              </button>
            )
          })}
          {!isExpanded && group.modifiers.length > 8 && (
            <span className="px-2 py-1 text-xs text-gray-400">
              +{group.modifiers.length - 8} more
            </span>
          )}
        </div>
      </div>
    )
  }

  // Render spirit group with tier buttons
  const renderSpiritGroup = (group: ModifierGroup) => {
    const modifiersByTier = getModifiersByTier(group.modifiers)
    const currentSelection = selections[group.id]?.[0]
    const selectedTier = currentSelection?.spiritTier as SpiritTier | undefined
    const groupColor = getGroupColor(group)

    return (
      <div key={group.id} className="mb-3 p-3 rounded-lg border" style={{ borderColor: groupColor + '40', backgroundColor: groupColor + '10' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: groupColor }} />
          <span className="font-medium text-sm">{group.displayName || group.name}</span>
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
          <div className="text-xs bg-white rounded p-2 flex justify-between items-center">
            <span className="font-medium">{currentSelection.name}</span>
            <span className="text-green-600">
              {currentSelection.price === 0 ? 'Included' : `+${formatCurrency(currentSelection.price)}`}
            </span>
          </div>
        )}

        {/* Expandable all options */}
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer">All {group.modifiers.length} options</summary>
          <div className="flex flex-wrap gap-1 mt-1">
            {group.modifiers.map(mod => {
              const isModSelected = currentSelection?.id === mod.id
              const tier = mod.spiritTier as SpiritTier || 'well'
              return (
                <button
                  key={mod.id}
                  className={`px-2 py-0.5 text-xs rounded transition-all ${
                    isModSelected
                      ? SPIRIT_TIER_CONFIG[tier].selectedColor
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                  onClick={() => handleSpiritSelection(group, mod, tier)}
                >
                  {mod.name}
                </button>
              )
            })}
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-3 border-b bg-gray-50">
          <h2 className="text-lg font-bold">{item.name}</h2>
          <p className="text-gray-500 text-sm">
            Base: {formatCurrency(item.price)}
            {pourMultiplier !== 1 && (
              <span className="ml-2 text-purple-600">
                × {pourMultiplier} = {formatCurrency(item.price * pourMultiplier)}
              </span>
            )}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              {/* Pour Size Buttons - Prominent at top for liquor items */}
              {renderPourSizeButtons()}

              {/* Modifier Groups */}
              {modifierGroups.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">No modifiers</div>
              ) : (
                <div>
                  {modifierGroups.map(group =>
                    group.isSpiritGroup
                      ? renderSpiritGroup(group)
                      : renderCompactModifierGroup(group)
                  )}

                  {/* Child modifier groups */}
                  {activeChildGroups.map(({ group, parentModifierName }) => (
                    <div key={group.id} className="ml-4 pl-3 border-l-2 border-blue-200">
                      <div className="text-xs text-blue-600 mb-1">{parentModifierName} →</div>
                      {group.isSpiritGroup
                        ? renderSpiritGroup(group)
                        : renderCompactModifierGroup(group)}
                    </div>
                  ))}
                </div>
              )}

              {/* Special Notes */}
              <div className="mt-3 pt-3 border-t">
                <label className="block text-sm font-medium mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="Special instructions..."
                  className="w-full p-2 border border-gray-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  maxLength={200}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">Total</span>
            <span className="text-xl font-bold text-blue-600">{formatCurrency(totalPrice)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canConfirm()}
              onClick={() => onConfirm(
                getAllSelectedModifiers(),
                specialNotes.trim() || undefined,
                selectedPourSize || undefined,
                pourMultiplier !== 1 ? pourMultiplier : undefined
              )}
            >
              {editingItem ? 'Update' : 'Add'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
