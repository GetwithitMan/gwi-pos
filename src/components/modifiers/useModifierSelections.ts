import { useEffect, useState, useCallback, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { toast } from '@/stores/toast-store'
import type { DualPricingSettings } from '@/lib/settings'
import type { MenuItem, ModifierGroup, SelectedModifier, Modifier } from '@/types'

// Ingredient modification types
export type IngredientModificationType = 'standard' | 'no' | 'lite' | 'on_side' | 'extra' | 'swap'

export interface IngredientModification {
  ingredientId: string
  name: string
  modificationType: IngredientModificationType
  priceAdjustment: number
  swappedTo?: { modifierId: string; name: string; price: number }
}

export interface MenuItemIngredient {
  id: string
  ingredientId: string
  name: string
  category: string | null
  isIncluded: boolean
  sortOrder: number
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  allowSwap: boolean
  swapUpcharge: number
  swapModifierGroup?: {
    id: string
    name: string
    modifiers: { id: string; name: string; price: number }[]
  } | null
  is86d?: boolean
}

// Default pour size configuration (used as fallback for old data format)
export const DEFAULT_POUR_SIZE_CONFIG = {
  standard: { label: 'Standard Pour', shortLabel: '1x', color: 'bg-blue-500', multiplier: 1.0 },
  shot: { label: 'Shot', shortLabel: '1x', color: 'bg-blue-500', multiplier: 1.0 }, // Legacy support
  double: { label: 'Double', shortLabel: '2x', color: 'bg-purple-500', multiplier: 2.0 },
  tall: { label: 'Tall', shortLabel: '1.5x', color: 'bg-green-500', multiplier: 1.5 },
  short: { label: 'Short', shortLabel: '0.75x', color: 'bg-amber-500', multiplier: 0.75 },
} as const

export type PourSizeKey = keyof typeof DEFAULT_POUR_SIZE_CONFIG

// Pour size data can be old format (number) or new format ({ label, multiplier })
export type PourSizeValue = number | { label: string; multiplier: number }

// Helper to get multiplier from pour size value (handles both formats)
export function getPourSizeMultiplier(value: PourSizeValue): number {
  return typeof value === 'number' ? value : value.multiplier
}

// Helper to get label from pour size (handles both formats)
export function getPourSizeLabel(key: string, value: PourSizeValue): string {
  if (typeof value === 'object' && value.label) {
    return value.label
  }
  return DEFAULT_POUR_SIZE_CONFIG[key as PourSizeKey]?.label || key.charAt(0).toUpperCase() + key.slice(1)
}

// Modifier type colors
export const MODIFIER_TYPE_COLORS: Record<string, string> = {
  universal: '#6b7280',
  food: '#22c55e',
  liquor: '#8b5cf6',
  retail: '#f59e0b',
  entertainment: '#f97316',
  combo: '#ec4899',
}

// Spirit tier configuration
export const SPIRIT_TIER_CONFIG = {
  well: { label: 'Well', color: 'bg-gray-500/20 border-gray-500/40 text-gray-300', selectedColor: 'bg-gray-500/40 border-gray-500 text-white', badgeColor: 'bg-gray-500' },
  call: { label: 'Call', color: 'bg-blue-500/20 border-blue-500/40 text-blue-300', selectedColor: 'bg-blue-500/40 border-blue-500 text-white', badgeColor: 'bg-blue-500' },
  premium: { label: 'Premium', color: 'bg-purple-500/20 border-purple-500/40 text-purple-300', selectedColor: 'bg-purple-500/40 border-purple-500 text-white', badgeColor: 'bg-purple-500' },
  top_shelf: { label: 'Top Shelf', color: 'bg-amber-500/20 border-amber-500/40 text-amber-300', selectedColor: 'bg-amber-500/40 border-amber-500 text-white', badgeColor: 'bg-amber-500' },
} as const

export type SpiritTier = keyof typeof SPIRIT_TIER_CONFIG

// Pre-modifier colors and labels
export const PRE_MODIFIER_CONFIG: Record<string, { label: string; cssClass: string; activeClass: string }> = {
  no: { label: 'No', cssClass: 'mm-premod-no', activeClass: 'mm-premod-no active' },
  lite: { label: 'Lite', cssClass: 'mm-premod-lite', activeClass: 'mm-premod-lite active' },
  extra: { label: 'Extra', cssClass: 'mm-premod-extra', activeClass: 'mm-premod-extra active' },
  side: { label: 'Side', cssClass: 'mm-premod-side', activeClass: 'mm-premod-side active' },
}

// Tiered pricing helper: Calculate dynamic price based on selection position
function getTieredPrice(
  group: ModifierGroup,
  modifier: Modifier,
  selectionIndex: number  // 0-based: which selection is this? (0 = first, 1 = second, etc.)
): number {
  const config = group.tieredPricingConfig
  if (!config?.enabled) return modifier.price  // No tiered pricing, use normal price

  // Free threshold mode: first N selections are free
  if (config.modes.free_threshold && config.free_threshold) {
    if (selectionIndex < config.free_threshold.freeCount) {
      return 0  // This selection is free
    }
    // Beyond free count, use modifier's individual price
    // Fall through to check flat_tiers too if both are enabled
    if (!config.modes.flat_tiers) return modifier.price
  }

  // Flat tiers mode: fixed price per tier
  if (config.modes.flat_tiers && config.flat_tiers) {
    const { tiers, overflowPrice } = config.flat_tiers
    let remaining = selectionIndex
    for (const tier of tiers) {
      if (remaining < tier.upTo) {
        return tier.price
      }
      remaining -= tier.upTo
    }
    return overflowPrice  // Beyond all tiers
  }

  return modifier.price  // Fallback
}

// Exclusion helper: Returns IDs of modifiers already selected in other groups with the same exclusion key
function getExcludedModifierIds(
  currentGroupId: string,
  exclusionGroupKey: string | null | undefined,
  allGroups: ModifierGroup[],
  selections: Record<string, SelectedModifier[]>
): Set<string> {
  const excluded = new Set<string>()
  if (!exclusionGroupKey) return excluded

  // Find other groups with the same exclusion key
  for (const group of allGroups) {
    if (group.id === currentGroupId) continue
    if (group.exclusionGroupKey !== exclusionGroupKey) continue

    // All modifiers selected in those groups are excluded from this group
    const groupSelections = selections[group.id] || []
    groupSelections.forEach(sel => excluded.add(sel.id))
  }

  return excluded
}

export function useModifierSelections(
  item: MenuItem,
  modifierGroups: ModifierGroup[],
  editingItem: {
    id: string
    menuItemId: string
    modifiers: { id: string; name: string; price: number; preModifier?: string; depth: number; parentModifierId?: string }[]
    ingredientModifications?: IngredientModification[]
  } | null | undefined,
  dualPricing: DualPricingSettings,
  initialNotes?: string
) {
  const discountPct = dualPricing.cashDiscountPercent || 4.0

  // Pour size state
  const [selectedPourSize, setSelectedPourSize] = useState<string | null>(
    item.defaultPourSize || (item.pourSizes ? 'standard' : null)
  )

  // Ingredients state
  const [ingredients, setIngredients] = useState<MenuItemIngredient[]>([])
  const [ingredientMods, setIngredientMods] = useState<Record<string, IngredientModification>>({})
  const [loadingIngredients, setLoadingIngredients] = useState(false)
  const [swapModalIngredient, setSwapModalIngredient] = useState<MenuItemIngredient | null>(null)

  // All selections keyed by groupId
  const [selections, setSelections] = useState<Record<string, SelectedModifier[]>>({})
  const [childGroups, setChildGroups] = useState<Record<string, ModifierGroup>>({})
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({})
  const [initialized, setInitialized] = useState(false)
  const [specialNotes, setSpecialNotes] = useState(initialNotes || '')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  // Restore ingredient modifications immediately on edit (before API fetch)
  useEffect(() => {
    const initialMods: Record<string, IngredientModification> = {}
    if (editingItem?.ingredientModifications) {
      editingItem.ingredientModifications.forEach(mod => {
        initialMods[mod.ingredientId] = mod
      })
    }
    setIngredientMods(initialMods)
  }, [editingItem])

  // Load ingredients for this menu item
  useEffect(() => {
    if (!item.id) return

    setLoadingIngredients(true)
    fetch(`/api/menu/items/${item.id}/ingredients`)
      .then(res => res.json())
      .then(data => {
        if (data.data) {
          setIngredients(data.data)
        }
      })
      .catch(console.error)
      .finally(() => setLoadingIngredients(false))
  }, [item.id])

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
  const formatModPrice = (storedPrice: number, overridePrice?: number) => {
    const price = overridePrice !== undefined ? overridePrice : storedPrice
    if (price === 0) return ''
    const adjustedPrice = item.applyPourToModifiers ? price * pourMultiplier : price
    if (!dualPricing.enabled) {
      return `+${formatCurrency(adjustedPrice)}`
    }
    const cardPrice = calculateCardPrice(adjustedPrice, discountPct)
    return `+${formatCurrency(cardPrice)}`
  }

  // Handle ingredient modification toggle
  const toggleIngredientMod = (ingredient: MenuItemIngredient, modType: IngredientModificationType) => {
    const existing = ingredientMods[ingredient.ingredientId]

    // If clicking the same mod type, toggle it off (back to standard)
    if (existing?.modificationType === modType) {
      const newMods = { ...ingredientMods }
      delete newMods[ingredient.ingredientId]
      setIngredientMods(newMods)
      return
    }

    // Calculate price adjustment
    let priceAdjustment = 0
    if (modType === 'extra') {
      priceAdjustment = ingredient.extraPrice
    }

    const newMod: IngredientModification = {
      ingredientId: ingredient.ingredientId,
      name: ingredient.name,
      modificationType: modType,
      priceAdjustment,
    }

    setIngredientMods({ ...ingredientMods, [ingredient.ingredientId]: newMod })
  }

  // Handle swap selection from modal
  const handleSwapSelection = (ingredient: MenuItemIngredient, swapOption: { id: string; name: string; price: number }) => {
    const priceAdjustment = ingredient.swapUpcharge + swapOption.price

    const newMod: IngredientModification = {
      ingredientId: ingredient.ingredientId,
      name: ingredient.name,
      modificationType: 'swap',
      priceAdjustment,
      swappedTo: { modifierId: swapOption.id, name: swapOption.name, price: swapOption.price },
    }

    setIngredientMods({ ...ingredientMods, [ingredient.ingredientId]: newMod })
    setSwapModalIngredient(null)
  }

  // Calculate total price from ingredient modifications
  const ingredientModTotal = Object.values(ingredientMods).reduce((sum, mod) => sum + mod.priceAdjustment, 0)

  // Get all ingredient modifications as array
  const getAllIngredientMods = (): IngredientModification[] => {
    return Object.values(ingredientMods).filter(mod => mod.modificationType !== 'standard')
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
  // Using useCallback to ensure stable reference for inline calls
  const loadChildGroup = useCallback(async (groupId: string) => {
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
  }, [childGroups, loadingChildren])

  // Load child groups for initial/edited selections on mount
  // Note: Further child loading happens directly in toggleModifier for better performance
  useEffect(() => {
    // Only run once on initialization to load children for pre-existing selections
    if (!initialized) return

    const loadInitialChildren = async () => {
      for (const sel of Object.values(selections).flat()) {
        if (sel.childModifierGroupId && !childGroups[sel.childModifierGroupId]) {
          await loadChildGroup(sel.childModifierGroupId)
        }
      }
    }
    loadInitialChildren()
    // Intentionally only run when initialized changes (once)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized])

  // Build child→parent group mapping: childGroupId → parentGroupId
  // This lets us walk up the chain to compute depth for any group
  const childToParentGroupId = useMemo(() => {
    const map: Record<string, string> = {}
    // Walk all modifierGroups (flat array from API includes both top-level and child groups)
    modifierGroups.forEach(g => {
      g.modifiers?.forEach(m => {
        if (m.childModifierGroupId) {
          map[m.childModifierGroupId] = g.id
        }
      })
    })
    // Also map dynamically-loaded child groups
    Object.values(childGroups).forEach(g => {
      g.modifiers?.forEach(m => {
        if (m.childModifierGroupId) {
          map[m.childModifierGroupId] = g.id
        }
      })
    })
    return map
  }, [modifierGroups, childGroups])

  const getGroupDepth = (groupId: string): number => {
    let depth = 0
    let currentId: string | undefined = groupId
    // Walk up the parent chain
    while (currentId && childToParentGroupId[currentId]) {
      depth += 1
      currentId = childToParentGroupId[currentId]
    }
    return depth
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
    const existingMod = existingIndex >= 0 ? current[existingIndex] : null

    let price = modifier.price
    if (preModifier === 'extra' && modifier.extraPrice) {
      price = modifier.extraPrice
    } else if (preModifier === 'no') {
      price = 0
    }

    const depth = getGroupDepth(group.id)
    const parentModifierId = getParentModifierId(group.id)

    // If modifier is already selected
    if (existingMod) {
      const newSelections = { ...selections }

      // If clicking with a preModifier
      if (preModifier) {
        // If same preModifier, remove it (toggle off the preModifier, keep modifier selected normally)
        if (existingMod.preModifier === preModifier) {
          // Update to regular selection (no preModifier)
          const updatedMod: SelectedModifier = {
            ...existingMod,
            price: modifier.price,
            preModifier: undefined,
          }
          newSelections[group.id] = current.map(s => s.id === modifier.id ? updatedMod : s)
        } else {
          // Different preModifier, update to new one
          const updatedMod: SelectedModifier = {
            ...existingMod,
            price,
            preModifier,
          }
          newSelections[group.id] = current.map(s => s.id === modifier.id ? updatedMod : s)
        }
        setSelections(newSelections)
      } else {
        // Clicking main button without preModifier
        if (existingMod.preModifier) {
          // Has a preModifier, clicking main button removes preModifier
          const updatedMod: SelectedModifier = {
            ...existingMod,
            price: modifier.price,
            preModifier: undefined,
          }
          newSelections[group.id] = current.map(s => s.id === modifier.id ? updatedMod : s)
          setSelections(newSelections)
        } else {
          // No preModifier - behavior depends on stacking setting
          if (group.allowStacking && current.length < group.maxSelections) {
            // Stacking enabled and room for more - add another instance
            // Use extraPrice for stacked instances (adding multiples = ordering extras)
            const stackedPrice = modifier.extraPrice && modifier.extraPrice > 0
              ? modifier.extraPrice
              : modifier.price
            const newMod: SelectedModifier = {
              id: modifier.id,
              name: modifier.name,
              price: stackedPrice,
              preModifier: undefined,
              childModifierGroupId: modifier.childModifierGroupId,
              depth: getGroupDepth(group.id),
              parentModifierId: getParentModifierId(group.id),
            }
            newSelections[group.id] = [...current, newMod]
            setSelections(newSelections)
          } else {
            // No stacking or at max - remove one instance of this modifier
            const indexToRemove = current.findIndex(s => s.id === modifier.id)
            if (indexToRemove >= 0) {
              const removed = current[indexToRemove]
              newSelections[group.id] = current.filter((_, i) => i !== indexToRemove)
              if (removed.childModifierGroupId) {
                delete newSelections[removed.childModifierGroupId]
              }
            }
            setSelections(newSelections)
          }
        }
      }
    } else {
      // Modifier not selected, add it
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

        // Load child group if this modifier has one
        if (modifier.childModifierGroupId) {
          loadChildGroup(modifier.childModifierGroupId)
        }
      } else if (current.length < group.maxSelections) {
        // Room available - just add
        setSelections({
          ...selections,
          [group.id]: [...current, newMod],
        })

        // Load child group if this modifier has one
        if (modifier.childModifierGroupId) {
          loadChildGroup(modifier.childModifierGroupId)
        }
      } else {
        // At max - show toast instead of silently failing or auto-removing
        toast.warning(`Maximum ${group.maxSelections} selections reached for ${group.displayName || group.name}`)
      }
    }
  }

  const isSelected = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).some(s => s.id === modifierId)
  }

  // Get count of how many times a modifier is selected (for stacking)
  const getSelectionCount = (groupId: string, modifierId: string) => {
    return (selections[groupId] || []).filter(s => s.id === modifierId).length
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
  const modifierTotal = (() => {
    let total = 0
    for (const [groupId, groupSels] of Object.entries(selections)) {
      const group = modifierGroups.find(g => g.id === groupId)
        || Object.values(childGroups).find(g => g.id === groupId)
      groupSels.forEach((sel, index) => {
        const tieredPrice = group?.tieredPricingConfig?.enabled
          ? getTieredPrice(group, { price: sel.price } as Modifier, index)
          : sel.price
        const adjustedPrice = item.applyPourToModifiers ? tieredPrice * pourMultiplier : tieredPrice
        total += adjustedPrice
      })
    }
    return total
  })()
  const totalPrice = basePrice + modifierTotal + ingredientModTotal

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

  // Get the current selection's preModifier for a modifier
  const getSelectedPreModifier = (groupId: string, modifierId: string): string | undefined => {
    const selection = (selections[groupId] || []).find(s => s.id === modifierId)
    return selection?.preModifier
  }

  return {
    // Pour
    selectedPourSize,
    setSelectedPourSize,
    pourMultiplier,
    // Ingredients
    ingredients,
    ingredientMods,
    loadingIngredients,
    toggleIngredientMod,
    ingredientModTotal,
    getAllIngredientMods,
    // Swap
    swapModalIngredient,
    setSwapModalIngredient,
    handleSwapSelection,
    // Modifier selections
    selections,
    expandedGroups,
    setExpandedGroups,
    childGroups,
    loadingChildren,
    toggleModifier,
    isSelected,
    getSelectionCount,
    getActiveChildGroups,
    getSelectedPreModifier,
    handleSpiritSelection,
    getModifiersByTier,
    // Validation
    canConfirm,
    getAllSelectedModifiers,
    // Price
    basePrice,
    modifierTotal,
    totalPrice,
    // Notes
    specialNotes,
    setSpecialNotes,
    // Computed
    activeChildGroups,
    // Utilities
    formatModPrice,
    getGroupColor,
    // Tiered pricing
    getTieredPrice: (group: ModifierGroup, modifier: Modifier, selectionIndex: number) =>
      getTieredPrice(group, modifier, selectionIndex),
    // Exclusions
    getExcludedModifierIds: (currentGroupId: string, exclusionGroupKey: string | null | undefined) =>
      getExcludedModifierIds(currentGroupId, exclusionGroupKey, modifierGroups, selections),
  }
}
