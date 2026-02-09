'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { calculateCardPrice } from '@/lib/pricing'
import { isItemTaxInclusive } from '@/lib/order-calculations'

interface Ingredient {
  id: string
  ingredientId: string
  name: string
  category?: string | null     // Ingredient category code from API
  isIncluded: boolean
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  allowSwap: boolean
  extraPrice: number
  needsVerification?: boolean  // ← Verification status
}

export interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
  categoryName: string | null       // from categoryRelation.name
  categoryId: string | null         // actual category relation ID
  parentIngredientId: string | null  // to identify child items
  parentName: string | null         // parent ingredient's name for sub-headers
  needsVerification: boolean        // verification flag
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  allowSwap: boolean
  swapModifierGroupId: string | null
  swapUpcharge: number
}

interface IngredientCategory {
  id: string
  code: number
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount: number
}

interface Modifier {
  id: string
  name: string
  price: number
  allowNo?: boolean
  allowLite?: boolean
  allowOnSide?: boolean
  allowExtra?: boolean
  extraPrice?: number
  isDefault?: boolean
  sortOrder: number
  ingredientId?: string | null
  ingredientName?: string | null
  childModifierGroupId?: string | null
  childModifierGroup?: ModifierGroup | null
  isLabel?: boolean
  printerRouting?: string  // "follow" | "also" | "only"
  printerIds?: string[]    // Printer IDs for "also" or "only" mode
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking?: boolean
  tieredPricingConfig?: any
  exclusionGroupKey?: string | null
  sortOrder: number
  modifiers: Modifier[]
}

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string
  isActive: boolean
  isAvailable: boolean
}

interface ItemEditorProps {
  item: MenuItem | null
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories?: IngredientCategory[]
  locationId?: string
  onItemUpdated: () => void
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onToggle86?: (item: MenuItem) => void
  onDelete?: (itemId: string) => void
  refreshKey?: number
  onSelectGroup?: (groupId: string | null) => void
}

export function ItemEditor({ item, ingredientsLibrary, ingredientCategories = [], locationId = '', onItemUpdated, onIngredientCreated, onToggle86, onDelete, refreshKey, onSelectGroup }: ItemEditorProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Pricing settings — item is the source of truth for all pricing
  const { dualPricing, taxRate, taxInclusiveLiquor, taxInclusiveFood } = useOrderSettings()
  const isDualPricingEnabled = dualPricing.enabled
  const cashDiscountPct = dualPricing.cashDiscountPercent || 4.0

  const itemCardPrice = useMemo(() => {
    if (!item || !isDualPricingEnabled) return item?.price ?? 0
    return calculateCardPrice(item.price, cashDiscountPct)
  }, [item?.price, isDualPricingEnabled, cashDiscountPct])

  const isTaxInclusive = useMemo(() => {
    if (!item) return false
    return isItemTaxInclusive(item.categoryType, { taxInclusiveLiquor, taxInclusiveFood })
  }, [item?.categoryType, taxInclusiveLiquor, taxInclusiveFood])

  // Collapse states
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  // Forms
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)
  const [relinkingIngredientId, setRelinkingIngredientId] = useState<string | null>(null)
  const [ingredientSearch, setIngredientSearch] = useState('')

  // Modifier group editing state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const toggleExpanded = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [addingModifierTo, setAddingModifierTo] = useState<string | null>(null)
  const [newModName, setNewModName] = useState('')
  const [newModPrice, setNewModPrice] = useState('')
  const [linkingModifier, setLinkingModifier] = useState<{ groupId: string; modId: string } | null>(null)
  const [modIngredientSearch, setModIngredientSearch] = useState('')

  // Hierarchical dropdown state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())
  const [creatingInventoryInCategory, setCreatingInventoryInCategory] = useState<string | null>(null)
  const [creatingPrepUnderParent, setCreatingPrepUnderParent] = useState<string | null>(null)
  const [newInventoryName, setNewInventoryName] = useState('')
  const [newPrepName, setNewPrepName] = useState('')
  const [creatingIngredientLoading, setCreatingIngredientLoading] = useState(false)

  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [dragOverDropZone, setDragOverDropZone] = useState<string | null>(null) // 'top-level' or modifier ID for nesting
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [addingType, setAddingType] = useState<'item' | 'choice' | null>(null)
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null)
  const [editModValues, setEditModValues] = useState<{ name: string; price: string; extraPrice: string }>({ name: '', price: '', extraPrice: '' })
  const [draggedModifierId, setDraggedModifierId] = useState<string | null>(null)
  const [dragOverModifierId, setDragOverModifierId] = useState<string | null>(null)

  // Printer routing state
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>([])
  const [printerRoutingModifier, setPrinterRoutingModifier] = useState<{ groupId: string; modId: string } | null>(null)

  // Compute ingredient-to-modifier mapping for bidirectional link indicators
  const ingredientToModifiers = useMemo(() => {
    const map = new Map<string, { modName: string; groupName: string }[]>()

    // Recursive function to process modifiers, including child groups
    const processModifiers = (mods: Modifier[], groupName: string) => {
      mods.forEach(mod => {
        if (mod.ingredientId) {
          const existing = map.get(mod.ingredientId) || []
          existing.push({ modName: mod.name, groupName })
          map.set(mod.ingredientId, existing)
        }
        // Recurse into child modifier groups
        if (mod.childModifierGroup) {
          processModifiers(
            mod.childModifierGroup.modifiers,
            mod.childModifierGroup.name
          )
        }
      })
    }

    modifierGroups.forEach(group => {
      processModifiers(group.modifiers, group.name)
    })
    return map
  }, [modifierGroups])

  // Load data when item changes or refreshKey updates
  useEffect(() => {
    if (!item?.id) {
      setIngredients([])
      setModifierGroups([])
      return
    }
    loadData(true) // Show spinner only on initial/item-change load
  }, [item?.id, refreshKey])

  // Load printers for print routing
  useEffect(() => {
    const fetchPrinters = async () => {
      try {
        const res = await fetch('/api/hardware/printers')
        if (res.ok) {
          const data = await res.json()
          setPrinters((data.printers || []).map((p: any) => ({ id: p.id, name: p.name })))
        }
      } catch (e) {
        console.error('Failed to load printers:', e)
      }
    }
    fetchPrinters()
  }, [])

  // Close printer routing dropdown when clicking outside
  useEffect(() => {
    if (!printerRoutingModifier) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking inside the dropdown or on the button
      if (target.closest('.printer-routing-dropdown') || target.closest('.printer-routing-button')) {
        return
      }
      setPrinterRoutingModifier(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [printerRoutingModifier])

  const loadData = async (showSpinner = false) => {
    if (!item?.id) return
    if (showSpinner) setLoading(true)
    try {
      const [ingRes, groupsRes] = await Promise.all([
        fetch(`/api/menu/items/${item.id}/ingredients`),
        fetch(`/api/menu/items/${item.id}/modifier-groups`),
      ])
      const [ingData, groupsData] = await Promise.all([ingRes.json(), groupsRes.json()])
      setIngredients(ingData.data || [])
      setModifierGroups(groupsData.data || [])
    } catch (e) {
      console.error('Failed to load data:', e)
      toast.error('Failed to load modifier data')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  // Ingredient functions
  const saveIngredients = async (newIngredients: typeof ingredients) => {
    if (!item?.id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: newIngredients.map(i => ({
            ingredientId: i.ingredientId,
            isIncluded: i.isIncluded,
            allowNo: i.allowNo,
            allowLite: i.allowLite,
            allowExtra: i.allowExtra,
            allowOnSide: i.allowOnSide,
            extraPrice: i.extraPrice,
          }))
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Save ingredients failed:', res.status, err)
        toast.error(err.error || `Save failed (${res.status})`)
        return
      }
      await loadData()
      // No onItemUpdated() — ingredient toggles are local-only, no tree change
    } catch (e) {
      console.error('Failed to save:', e)
      toast.error('Failed to save ingredients')
    } finally {
      setSaving(false)
    }
  }

  const addIngredient = (ingredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === ingredientId)
    if (!lib) return
    const newIngredients = [...ingredients, {
      id: '',
      ingredientId,
      name: lib.name,
      isIncluded: true,
      allowNo: true,
      allowLite: true,
      allowExtra: true,
      allowOnSide: true,
      allowSwap: true,
      extraPrice: 0,
    }]
    saveIngredients(newIngredients)
    setShowIngredientPicker(false)
    setIngredientSearch('')
  }

  const removeIngredient = (ingredientId: string) => {
    saveIngredients(ingredients.filter(i => i.ingredientId !== ingredientId))
  }

  // Swap an ingredient link — replace one ingredientId with another
  const swapIngredientLink = async (oldIngredientId: string, newIngredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === newIngredientId)
    if (!lib) return
    setRelinkingIngredientId(null)
    setIngredientSearch('')
    await saveIngredients(ingredients.map(i =>
      i.ingredientId === oldIngredientId
        ? { ...i, ingredientId: newIngredientId, name: lib.name }
        : i
    ))
    toast.success(`Linked to ${lib.name}`)
  }

  const toggleIngredientOption = (ingredientId: string, option: 'allowNo' | 'allowLite' | 'allowExtra' | 'allowOnSide' | 'allowSwap') => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, [option]: !i[option] } : i))
  }

  const updateExtraPrice = (ingredientId: string, price: number) => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, extraPrice: price } : i))
  }

  // Modifier group CRUD functions
  const createGroup = async () => {
    if (!item?.id || !newGroupName.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), minSelections: 0, maxSelections: 1 }),
      })
      setNewGroupName('')
      setShowNewGroupForm(false)
      await loadData()
      // No onItemUpdated() — creating a modifier group is local to this item, no tree change
    } catch (e) {
      console.error('Failed to create group:', e)
      toast.error('Failed to create modifier group')
    } finally {
      setSaving(false)
    }
  }

  const updateGroup = async (groupId: string, updates: Partial<ModifierGroup>) => {
    if (!item?.id) return
    // Optimistic: update local state immediately, no flash
    setModifierGroups(prev => {
      const updateInGroups = (groups: ModifierGroup[]): ModifierGroup[] =>
        groups.map(g => {
          const updated = g.id === groupId ? { ...g, ...updates } : g
          return {
            ...updated,
            modifiers: updated.modifiers.map(m => {
              if (m.childModifierGroup) {
                return { ...m, childModifierGroup: updateInGroups([m.childModifierGroup])[0] }
              }
              return m
            }),
          }
        })
      return updateInGroups(prev)
    })
    try {
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        await loadData() // Revert on error
        toast.error('Failed to update modifier group')
      }
      // No onItemUpdated() — rename/toggle/settings are local-only, no full menu refetch needed
    } catch (e) {
      console.error('Failed to update group:', e)
      await loadData() // Revert on error
      toast.error('Failed to update modifier group')
    }
  }

  const startRename = (groupId: string, currentName: string) => {
    setRenamingGroupId(groupId)
    setRenameValue(currentName)
  }

  // Helper to find a group by ID (recursive search through child groups)
  const findGroupById = (id: string, groups?: ModifierGroup[], visited?: Set<string>): ModifierGroup | undefined => {
    const searchGroups = groups || modifierGroups
    const seen = visited || new Set<string>()

    for (const g of searchGroups) {
      if (seen.has(g.id)) continue  // Cycle detection
      seen.add(g.id)
      if (g.id === id) return g
      for (const m of g.modifiers) {
        if (m.childModifierGroup) {
          if (m.childModifierGroup.id === id) return m.childModifierGroup
          const found = findGroupById(id, [m.childModifierGroup], seen)
          if (found) return found
        }
      }
    }
    return undefined
  }

  // Helper to find a modifier by ID (recursive search through child groups)
  const findModifierById = (id: string, groups?: ModifierGroup[], visited?: Set<string>): Modifier | undefined => {
    const searchGroups = groups || modifierGroups
    const seen = visited || new Set<string>()

    for (const g of searchGroups) {
      if (seen.has(g.id)) continue
      seen.add(g.id)
      for (const m of g.modifiers) {
        if (m.id === id) return m
        if (m.childModifierGroup) {
          const found = findModifierById(id, [m.childModifierGroup], seen)
          if (found) return found
        }
      }
    }
    return undefined
  }

  const commitRename = async (groupId: string) => {
    const trimmed = renameValue.trim()
    if (trimmed) {
      // Find the group name (could be top-level or a nested child group)
      const currentGroup = findGroupById(groupId)
      if (!currentGroup || currentGroup.name !== trimmed) {
        await updateGroup(groupId, { name: trimmed })
      }
    }
    setRenamingGroupId(null)
    setRenameValue('')
  }

  const deleteGroup = async (groupId: string) => {
    if (!item?.id) return
    // Step 1: Preview — get cascade counts
    try {
      const previewRes = await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}?preview=true`, { method: 'DELETE' })
      const previewData = await previewRes.json()
      const { groupCount, modifierCount, groupName } = previewData.data || {}

      // Step 2: First confirmation
      const childGroupCount = (groupCount || 1) - 1 // exclude the group itself
      let msg = `Delete "${groupName || 'this group'}"?`
      if (childGroupCount > 0 || modifierCount > 0) {
        msg += `\n\nThis will also delete:`
        if (modifierCount > 0) msg += `\n  • ${modifierCount} modifier${modifierCount > 1 ? 's' : ''}`
        if (childGroupCount > 0) msg += `\n  • ${childGroupCount} child group${childGroupCount > 1 ? 's' : ''}`
      }
      if (!confirm(msg)) return

      // Step 3: Second confirmation for groups with children
      if (childGroupCount > 0) {
        if (!confirm('⚠️ Are you SURE? All nested groups and modifiers will be permanently deleted.')) return
      }
    } catch (e) {
      // If preview fails, fall back to simple confirm
      if (!confirm('Delete this modifier group and all its contents?')) return
    }

    // Step 4: Execute delete
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, { method: 'DELETE' })
      // Optimistic: remove from local state
      setModifierGroups(prev => prev.filter(g => g.id !== groupId))
      toast.success('Modifier group deleted')
      await loadData(false)
    } catch (e) {
      console.error('Failed to delete group:', e)
      toast.error('Failed to delete modifier group')
      await loadData(false)
    } finally {
      setSaving(false)
    }
  }

  const duplicateGroup = async (groupId: string, targetParentGroupId?: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      // Step 1: Create the duplicate (always creates at top-level)
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateFromGroupId: groupId }),
      })
      const resData = await res.json()
      const newGroupId = resData.data?.id

      // Step 2: If the source was a child group, re-nest the duplicate in the same parent group
      // OR if a specific target parent group was provided, nest it there
      if (newGroupId) {
        // Find the parent modifier that links to the source group (if it's a child)
        let parentGroupId = targetParentGroupId
        if (!parentGroupId) {
          for (const g of modifierGroups) {
            for (const m of g.modifiers) {
              if (m.childModifierGroupId === groupId) {
                parentGroupId = g.id
                break
              }
            }
            if (parentGroupId) break
          }
        }

        if (parentGroupId) {
          // Create a modifier in the parent group to hold the duplicate
          const sourceGroup = modifierGroups.find(g => g.id === groupId)
          const modRes = await fetch(`/api/menu/items/${item.id}/modifier-groups/${parentGroupId}/modifiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: sourceGroup?.name ? `${sourceGroup.name} (Copy)` : 'Copy', price: 0 }),
          })
          const modData = await modRes.json()
          const newModId = modData.data?.id

          if (newModId) {
            // Reparent the duplicate group to be a child of the new modifier
            await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupId: newGroupId, targetParentModifierId: newModId }),
            })
          }
        }
      }

      toast.success('Group duplicated')
      await loadData()
    } catch (e) {
      console.error('Failed to duplicate group:', e)
      toast.error('Failed to duplicate modifier group')
    } finally {
      setSaving(false)
    }
  }

  const reorderGroups = async (fromId: string, toId: string) => {
    if (!item?.id || fromId === toId) return

    // Build top-level list (same filter as the render)
    const childGroupIdSet = new Set<string>()
    modifierGroups.forEach(g => {
      g.modifiers.forEach(m => {
        if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
      })
    })
    const topLevel = modifierGroups.filter(g => !childGroupIdSet.has(g.id))

    const fromIndex = topLevel.findIndex(g => g.id === fromId)
    const toIndex = topLevel.findIndex(g => g.id === toId)
    if (fromIndex === -1 || toIndex === -1) return

    // Reorder the top-level list
    const reordered = [...topLevel]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)

    // Build new full list: reordered top-level + unchanged child groups
    const newFull = [
      ...reordered,
      ...modifierGroups.filter(g => childGroupIdSet.has(g.id)),
    ]
    setModifierGroups(newFull)

    // Persist only top-level sort orders
    try {
      const resp = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sortOrders: reordered.map((g, i) => ({ id: g.id, sortOrder: i })),
        }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        console.error('Failed to reorder groups:', err)
        toast.error(err.error || 'Failed to reorder groups')
        await loadData() // Rollback
        return
      }
      // No onItemUpdated() — reorder is optimistic, already updated local state
    } catch (e) {
      console.error('Failed to reorder groups:', e)
      toast.error('Failed to reorder groups')
      await loadData() // Rollback on failure
    }
  }

  const reorderModifiers = async (groupId: string, fromModId: string, toModId: string) => {
    if (!item?.id || fromModId === toModId) return

    // Find the group (could be top-level or child)
    const group = findGroupById(groupId)
    if (!group) return

    const mods = [...group.modifiers]
    const fromIdx = mods.findIndex(m => m.id === fromModId)
    const toIdx = mods.findIndex(m => m.id === toModId)
    if (fromIdx === -1 || toIdx === -1) return

    const [moved] = mods.splice(fromIdx, 1)
    mods.splice(toIdx, 0, moved)

    // Optimistic UI update
    const newGroups = modifierGroups.map(g => {
      if (g.id === groupId) {
        return { ...g, modifiers: mods }
      }
      // Also check child groups
      return {
        ...g,
        modifiers: g.modifiers.map(m => {
          if (m.childModifierGroup?.id === groupId) {
            return { ...m, childModifierGroup: { ...m.childModifierGroup, modifiers: mods } }
          }
          return m
        })
      }
    })
    setModifierGroups(newGroups)

    // Persist: update sort orders for all modifiers in the group
    try {
      await Promise.all(mods.map((m, idx) =>
        fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modifierId: m.id, sortOrder: idx }),
        })
      ))
      // No onItemUpdated() — reorder is optimistic, already updated local state
    } catch (e) {
      console.error('Failed to reorder modifiers:', e)
      toast.error('Failed to reorder modifiers')
      await loadData() // rollback
    }
  }

  // Helper to check if a group is a descendant of another (cycle prevention for drag-drop)
  const isDescendantOf = (ancestorGroupId: string, targetGroupId: string, visited = new Set<string>()): boolean => {
    if (ancestorGroupId === targetGroupId) return true
    if (visited.has(ancestorGroupId)) return false
    visited.add(ancestorGroupId)

    const group = findGroupById(ancestorGroupId)
    if (!group) return false

    for (const mod of group.modifiers) {
      if (mod.childModifierGroup) {
        if (mod.childModifierGroup.id === targetGroupId) return true
        if (isDescendantOf(mod.childModifierGroup.id, targetGroupId, visited)) return true
      }
    }
    return false
  }

  // Reparent a group: move it to top-level or make it a child of a modifier
  const reparentGroup = async (groupId: string, targetParentModifierId: string | null) => {
    if (!item?.id) return
    setSaving(true)
    try {
      const resp = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, targetParentModifierId }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        toast.error(err.error || 'Failed to move group')
        return
      }
      toast.success('Group moved successfully')
      await loadData()
      // No onItemUpdated() — reparenting a modifier group is local to this item, no tree change
    } catch (e) {
      console.error('Failed to reparent group:', e)
      toast.error('Failed to move group')
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  // Handle drop of a group onto a top-level reorder target OR onto a modifier (nesting)
  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault()
    if (!draggedGroupId || draggedGroupId === targetGroupId) {
      setDraggedGroupId(null)
      setDragOverGroupId(null)
      setDragOverDropZone(null)
      return
    }

    // Check if the dragged group is currently a child group
    const childGroupIdSet = new Set<string>()
    modifierGroups.forEach(g => {
      g.modifiers.forEach(m => {
        if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
      })
    })
    const draggedIsChild = childGroupIdSet.has(draggedGroupId)
    const targetIsChild = childGroupIdSet.has(targetGroupId)

    if (draggedIsChild && !targetIsChild) {
      // Child being dropped on a top-level group → promote to top-level then reorder
      await reparentGroup(draggedGroupId, null)
      // After reparent, reorder will happen naturally from the new loadData
    } else if (!draggedIsChild && !targetIsChild) {
      // Both top-level → simple reorder
      await reorderGroups(draggedGroupId, targetGroupId)
    } else {
      // Both are children or dragging top-level onto child → just reorder
      await reorderGroups(draggedGroupId, targetGroupId)
    }

    setDraggedGroupId(null)
    setDragOverGroupId(null)
    setDragOverDropZone(null)
  }

  // Handle dropping a group onto a modifier to make it a child
  const handleGroupDropOnModifier = async (e: React.DragEvent, targetModifierId: string, targetGroupId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedGroupId) return

    // Prevent cycle: can't drop a group onto a modifier that's inside it
    if (isDescendantOf(draggedGroupId, targetGroupId)) {
      toast.error('Cannot nest a group inside its own descendant')
      setDraggedGroupId(null)
      setDragOverGroupId(null)
      setDragOverDropZone(null)
      return
    }

    // Check if target modifier already has a child group — offer to replace
    const targetMod = findModifierById(targetModifierId)
    if (targetMod?.childModifierGroupId) {
      const existingChild = findGroupById(targetMod.childModifierGroupId)
      const existingName = existingChild?.name || 'existing child group'
      if (!confirm(`"${targetMod.name}" already has a child group "${existingName}". Replace it?`)) {
        setDraggedGroupId(null)
        setDragOverGroupId(null)
        setDragOverDropZone(null)
        return
      }
      // Unlink the existing child group (promote it to top-level)
      await reparentGroup(targetMod.childModifierGroupId, null)
    }

    await reparentGroup(draggedGroupId, targetModifierId)
    setDraggedGroupId(null)
    setDragOverGroupId(null)
    setDragOverDropZone(null)
  }

  // Nest a group inside another group: auto-create a modifier in targetGroupId, then reparent draggedGroupId to it
  const nestGroupInGroup = async (draggedId: string, targetGroupId: string) => {
    if (!item?.id) return
    // Find the dragged group name for the auto-created modifier
    const draggedGroup = modifierGroups.find(g => g.id === draggedId)
    const modName = draggedGroup?.name || 'Sub-Group'

    setSaving(true)
    try {
      // Step 1: Create a modifier in the target group
      const modRes = await fetch(`/api/menu/items/${item.id}/modifier-groups/${targetGroupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modName, price: 0 }),
      })
      const modData = await modRes.json()
      const newModId = modData.data?.id
      if (!newModId) throw new Error('Failed to create modifier for nesting')

      // Step 2: Reparent the dragged group to be a child of the new modifier
      const resp = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: draggedId, targetParentModifierId: newModId }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        toast.error(err.error || 'Failed to nest group')
        return
      }
      toast.success('Group nested successfully')
      await loadData()
    } catch (e) {
      console.error('Failed to nest group:', e)
      toast.error('Failed to nest group')
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const addModifier = async (groupId: string) => {
    if (!item?.id || !newModName.trim()) return
    setSaving(true)
    try {
      const parsedPrice = parseFloat(newModPrice)
      const price = Number.isFinite(parsedPrice) ? parsedPrice : 0
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newModName.trim(), price }),
      })
      setNewModName('')
      setNewModPrice('')
      setAddingModifierTo(null)
      setAddingType(null)
      await loadData()
      // No onItemUpdated() — adding a modifier within a group is local-only
    } catch (e) {
      console.error('Failed to add modifier:', e)
      toast.error('Failed to add modifier')
    } finally {
      setSaving(false)
    }
  }

  // Helper: recursively update a modifier in local state (handles child groups)
  const updateModifierInGroups = (groups: ModifierGroup[], targetGroupId: string, modId: string, updates: Partial<Modifier>): ModifierGroup[] => {
    return groups.map(g => {
      const updatedModifiers = g.modifiers.map(m => {
        // Update the target modifier
        const updatedMod = (g.id === targetGroupId && m.id === modId)
          ? { ...m, ...updates }
          : m
        // Recurse into child groups
        if (updatedMod.childModifierGroup) {
          return {
            ...updatedMod,
            childModifierGroup: updateModifierInGroups([updatedMod.childModifierGroup], targetGroupId, modId, updates)[0]
          }
        }
        return updatedMod
      })
      return { ...g, modifiers: updatedModifiers }
    })
  }

  const updateModifier = async (groupId: string, modifierId: string, updates: Partial<Modifier>) => {
    if (!item?.id) return

    // Optimistic local update — no flash, instant feedback
    setModifierGroups(prev => updateModifierInGroups(prev, groupId, modifierId, updates))

    try {
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId, ...updates }),
      })
      if (!res.ok) {
        // Revert on failure
        await loadData()
        toast.error('Failed to update modifier')
      }
    } catch (e) {
      console.error('Failed to update modifier:', e)
      await loadData() // Revert on error
      toast.error('Failed to update modifier')
    }
  }

  // Toggle isDefault with group rule enforcement (respects maxSelections)
  const toggleDefault = async (groupId: string, modifierId: string, currentlyDefault: boolean) => {
    if (!item?.id) return
    const group = findGroupById(groupId)
    if (!group) return

    if (!currentlyDefault && group.maxSelections > 0) {
      // Turning ON — check if we'd exceed maxSelections
      const currentDefaults = group.modifiers.filter(m => m.isDefault && m.id !== modifierId)
      if (currentDefaults.length >= group.maxSelections) {
        // Optimistically clear excess defaults locally (API does same server-side)
        const excessCount = currentDefaults.length - group.maxSelections + 1
        const idsToUndefault = currentDefaults.slice(0, excessCount).map(d => d.id)
        setModifierGroups(prev => {
          let updated = prev
          for (const clearId of idsToUndefault) {
            updated = updateModifierInGroups(updated, groupId, clearId, { isDefault: false })
          }
          return updated
        })
        toast.info(`Max ${group.maxSelections} default${group.maxSelections > 1 ? 's' : ''} — replacing previous`)
      }
    }

    // This will also optimistically update the target modifier
    await updateModifier(groupId, modifierId, { isDefault: !currentlyDefault })
    // After API responds, do a background refresh to get canonical server state
    loadData()
  }

  const deleteModifier = async (groupId: string, modifierId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers?modifierId=${modifierId}`, {
        method: 'DELETE',
      })
      await loadData()
      // No onItemUpdated() — removing a modifier within a group is local-only
    } catch (e) {
      console.error('Failed to delete modifier:', e)
      toast.error('Failed to delete modifier')
    } finally {
      setSaving(false)
    }
  }

  const startEditModifier = (mod: Modifier) => {
    setEditingModifierId(mod.id)
    setEditModValues({
      name: mod.name,
      price: String(mod.price ?? 0),
      extraPrice: String(mod.extraPrice ?? 0),
    })
  }

  const commitEditModifier = async (groupId: string, modId: string) => {
    const updates: Partial<Modifier> = {}
    const currentMod = findModifierById(modId)

    if (!currentMod) { setEditingModifierId(null); return }

    const newName = editModValues.name.trim()
    const parsedPrice = parseFloat(editModValues.price)
    const newPrice = Number.isFinite(parsedPrice) ? parsedPrice : 0
    const parsedExtra = parseFloat(editModValues.extraPrice)
    const newExtraPrice = Number.isFinite(parsedExtra) ? parsedExtra : 0

    if (newName && newName !== currentMod.name) updates.name = newName
    if (newPrice !== currentMod.price) updates.price = newPrice
    if (newExtraPrice !== (currentMod.extraPrice ?? 0)) updates.extraPrice = newExtraPrice

    if (Object.keys(updates).length > 0) {
      await updateModifier(groupId, modId, updates)
    }
    setEditingModifierId(null)
  }

  const createChildGroup = async (parentModifierId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Sub-Group',
          minSelections: 0,
          maxSelections: 1,
          parentModifierId
        }),
      })
      await loadData()
      // No onItemUpdated() — creating a child group is local to this item, no tree change
    } catch (e) {
      console.error('Failed to create child group:', e)
      toast.error('Failed to create child group')
    } finally {
      setSaving(false)
    }
  }

  const addChoice = async (groupId: string) => {
    if (!item?.id || !newModName.trim()) return
    setSaving(true)
    try {
      // Step 1: Create modifier with isLabel=true, price=0, all pre-mods false
      const modRes = await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newModName.trim(),
          price: 0,
          allowNo: false,
          allowLite: false,
          allowOnSide: false,
          allowExtra: false,
          isLabel: true,
        }),
      })
      const modData = await modRes.json()
      const modifierId = modData.data?.id
      if (!modifierId) throw new Error('Failed to create choice modifier')

      // Step 2: Create child group linked to this modifier (same name)
      await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newModName.trim(),
          minSelections: 0,
          maxSelections: 1,
          parentModifierId: modifierId,
        }),
      })

      setNewModName('')
      setNewModPrice('')
      setAddingModifierTo(null)
      setAddingType(null)
      await loadData()
      // No onItemUpdated() — adding a choice is local to this item, no tree change
    } catch (e) {
      console.error('Failed to add choice:', e)
      toast.error('Failed to add choice')
    } finally {
      setSaving(false)
    }
  }

  const linkIngredient = async (groupId: string, modifierId: string, ingredientId: string | null) => {
    // Include ingredientName in optimistic update so badge renders immediately
    const ingredientName = ingredientId
      ? ingredientsLibrary.find(i => i.id === ingredientId)?.name || null
      : null
    await updateModifier(groupId, modifierId, { ingredientId, ingredientName } as Partial<Modifier>)
    // Refresh data to update the 🔗 badge immediately
    await loadData()
    // Reset ALL linking state to prevent stale data on next open
    setLinkingModifier(null)
    setModIngredientSearch('')
    setExpandedCategories(new Set())
    setExpandedParents(new Set())
  }

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  // Toggle parent expansion
  const toggleParent = (parentId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  // Create inventory item (parent)
  const createInventoryItem = async (categoryId: string) => {
    if (!newInventoryName.trim()) return
    setCreatingIngredientLoading(true)

    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newInventoryName.trim(),
          categoryId,
          parentIngredientId: null,
          needsVerification: true,
          isBaseIngredient: true,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // 409 = duplicate name — auto-expand the existing item so user can add a prep item under it
        if (response.status === 409 && errorData.existing) {
          const existingId = errorData.existing.id
          const existingCatId = errorData.existing.categoryId || categoryId
          setNewInventoryName('')
          setCreatingInventoryInCategory(null)

          // Expand the category and the existing inventory item, then open prep creation
          setExpandedCategories(prev => {
            const next = new Set(prev)
            next.add(existingCatId)
            return next
          })
          setExpandedParents(prev => {
            const next = new Set(prev)
            next.add(existingId)
            return next
          })
          setCreatingPrepUnderParent(existingId)
          toast.info(`"${errorData.existing.name}" already exists — add a prep item below`)
          return
        }

        toast.error(errorData.error || 'Failed to create ingredient')
        return
      }

      const { data } = await response.json()
      onIngredientCreated?.(data)  // Optimistic local update + socket event
      onItemUpdated()  // Refresh parent's ingredient library
      setNewInventoryName('')
      setCreatingInventoryInCategory(null)

      // Auto-expand the new inventory item and prompt to add a prep item
      setExpandedCategories(prev => {
        const next = new Set(prev)
        next.add(categoryId)
        return next
      })
      setExpandedParents(prev => {
        const next = new Set(prev)
        next.add(data.id)
        return next
      })
      setCreatingPrepUnderParent(data.id)
      toast.success(`Created "${data.name}" — now add a prep item below`)
    } catch (error) {
      console.error('Error creating inventory item:', error)
      toast.error('Failed to create ingredient')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  // Create prep item (child) with auto-link
  const createPrepItem = async (parentId: string, categoryId: string) => {
    if (!newPrepName.trim()) return
    setCreatingIngredientLoading(true)

    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newPrepName.trim(),
          categoryId,
          parentIngredientId: parentId,
          needsVerification: true,
          isBaseIngredient: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // 409 = duplicate name — if it's a prep item, offer to use the existing one
        if (response.status === 409 && errorData.existing) {
          const existingItem = errorData.existing
          const isPrepItem = !!existingItem.parentIngredientId

          if (isPrepItem) {
            // It's an existing prep item — ask if they want to use it
            const useExisting = confirm(
              `"${existingItem.name}" already exists as a prep item. Use the existing one instead?`
            )
            if (useExisting) {
              // Auto-link or auto-add the existing prep item
              if (linkingModifier) {
                await linkIngredient(linkingModifier.groupId, linkingModifier.modId, existingItem.id)
                toast.success(`Linked existing "${existingItem.name}"`)
              } else if (showIngredientPicker) {
                const alreadyAdded = ingredients.some(i => i.ingredientId === existingItem.id)
                if (alreadyAdded) {
                  toast.info(`"${existingItem.name}" is already added to this item`)
                } else {
                  const newIngredients = [...ingredients, {
                    id: '', ingredientId: existingItem.id, name: existingItem.name,
                    isIncluded: true, allowNo: true, allowLite: true, allowExtra: true,
                    allowOnSide: true, allowSwap: true, extraPrice: 0,
                  }]
                  saveIngredients(newIngredients)
                  setShowIngredientPicker(false)
                  setIngredientSearch('')
                  toast.success(`Added existing "${existingItem.name}"`)
                }
              }
              setNewPrepName('')
              setCreatingPrepUnderParent(null)
              return
            }
            // User said no — keep the form open so they can change the name
            toast.info('Change the name to create a new prep item')
            return
          } else {
            // It's an inventory item with the same name — tell user to pick a different name
            toast.error(`"${existingItem.name}" exists as an inventory item. Use a different name for the prep item.`)
            return
          }
        }

        toast.error(errorData.error || 'Failed to create prep item')
        return
      }

      const { data } = await response.json()
      onIngredientCreated?.(data)  // Optimistic local update + socket event
      onItemUpdated()

      // Auto-link to modifier OR auto-add to ingredients
      if (linkingModifier) {
        await linkIngredient(linkingModifier.groupId, linkingModifier.modId, data.id)
        toast.success(`Created "${data.name}" and linked - pending verification`)
      } else if (showIngredientPicker) {
        // Auto-add to ingredients when called from ingredient picker
        // Don't rely on ingredientsLibrary being updated, use the data we got from API
        const newIngredients = [...ingredients, {
          id: '',
          ingredientId: data.id,
          name: data.name,
          isIncluded: true,
          allowNo: true,
          allowLite: true,
          allowExtra: true,
          allowOnSide: true,
          allowSwap: true,
          extraPrice: 0,
        }]
        saveIngredients(newIngredients)
        setShowIngredientPicker(false)
        setIngredientSearch('')
        toast.success(`Created "${data.name}" and added - pending verification`)
      } else {
        toast.success(`Created "${data.name}" - pending verification`)
      }

      setNewPrepName('')
      setCreatingPrepUnderParent(null)
    } catch (error) {
      console.error('Error creating prep item:', error)
      toast.error('Failed to create prep item')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  // Helper to render a choice row (navigation modifier with child group)
  const renderChoiceRow = (groupId: string, mod: Modifier, depth: number = 0, siblingIndex: number = 0) => {
    const childGroup = mod.childModifierGroup
    const itemCount = childGroup?.modifiers?.length || 0

    return (
      <div
        key={mod.id}
        className={`space-y-1 ${draggedModifierId === mod.id ? 'opacity-50' : ''} ${dragOverModifierId === mod.id && draggedModifierId !== mod.id ? 'ring-2 ring-indigo-300 rounded' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedModifierId(mod.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', mod.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId) {
            // Group being dragged — choice already has a child, can't nest another
            return
          }
          setDragOverModifierId(mod.id)
        }}
        onDragLeave={() => setDragOverModifierId(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedModifierId) reorderModifiers(groupId, draggedModifierId, mod.id)
          setDraggedModifierId(null)
          setDragOverModifierId(null)
        }}
        onDragEnd={() => {
          setDraggedModifierId(null)
          setDragOverModifierId(null)
        }}
      >
        <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-sm">
          <span className="cursor-grab text-gray-300 hover:text-gray-500 text-xs" title="Drag to reorder">⠿</span>
          <span className="text-amber-500 text-xs">📁</span>
          {editingModifierId === mod.id ? (
            <input
              type="text"
              value={editModValues.name}
              onChange={(e) => setEditModValues(prev => ({ ...prev, name: e.target.value }))}
              onBlur={() => commitEditModifier(groupId, mod.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                if (e.key === 'Escape') setEditingModifierId(null)
              }}
              className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
              autoFocus
            />
          ) : (
            <span
              className="flex-1 font-medium text-amber-800 truncate cursor-pointer hover:text-amber-600"
              onDoubleClick={() => startEditModifier(mod)}
              title="Double-click to rename"
            >
              {mod.name}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded font-medium">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs"
            title="Delete choice and its group"
          >
            ×
          </button>
        </div>
        {childGroup && renderChildGroup(childGroup, depth + 1, siblingIndex)}
      </div>
    )
  }

  // Helper to render a modifier row with all controls
  const renderModifierRow = (groupId: string, mod: Modifier, depth: number = 0, rowIndex: number = 0) => {
    // If this is a choice (label with child group), render it differently
    if (mod.isLabel && mod.childModifierGroupId) {
      return renderChoiceRow(groupId, mod, depth, rowIndex)
    }

    const isLinking = linkingModifier?.groupId === groupId && linkingModifier?.modId === mod.id
    const filteredIngredients = ingredientsLibrary.filter(ing =>
      ing.parentIngredientId &&  // ONLY prep items (children)
      ing.name.toLowerCase().includes(modIngredientSearch.toLowerCase())
    )

    // When a group is being dragged, this modifier becomes a potential nest target
    // Allow dropping groups on any modifier (swap if already has child)
    const isGroupDropTarget = !!draggedGroupId
    const isGroupDragOverThis = dragOverDropZone === mod.id && draggedGroupId

    return (
      <div
        key={mod.id}
        className={`space-y-1 ${draggedModifierId === mod.id ? 'opacity-50' : ''} ${dragOverModifierId === mod.id && draggedModifierId !== mod.id ? 'ring-2 ring-indigo-300 rounded' : ''} ${isGroupDragOverThis ? 'ring-2 ring-green-400 rounded bg-green-50' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedModifierId(mod.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', mod.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId) {
            // Group is being dragged — this modifier is a nest target
            if (isGroupDropTarget) setDragOverDropZone(mod.id)
          } else {
            setDragOverModifierId(mod.id)
          }
        }}
        onDragLeave={() => { setDragOverModifierId(null); setDragOverDropZone(null) }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId && isGroupDropTarget) {
            // A group was dropped on this modifier → nest the group
            handleGroupDropOnModifier(e, mod.id, groupId)
          } else if (draggedModifierId) {
            reorderModifiers(groupId, draggedModifierId, mod.id)
          }
          setDraggedModifierId(null)
          setDragOverModifierId(null)
          setDragOverDropZone(null)
        }}
        onDragEnd={() => {
          setDraggedModifierId(null)
          setDragOverModifierId(null)
          setDragOverDropZone(null)
        }}
      >
        <div className={`flex items-center gap-1.5 px-2 py-1.5 border rounded text-sm ${isGroupDragOverThis ? 'bg-green-50 border-green-300' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
          <span className="cursor-grab text-gray-300 hover:text-gray-500 text-xs shrink-0" title="Drag to reorder">⠿</span>

          {/* LEFT SIDE: Name + Upcharge price only */}
          {editingModifierId === mod.id ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" ref={(el) => {
              // Store ref so blur can check if focus moved within this container
              if (el) (el as any)._editContainer = true
            }}>
              <input
                type="text"
                value={editModValues.name}
                onChange={(e) => setEditModValues(prev => ({ ...prev, name: e.target.value }))}
                onBlur={(e) => {
                  // Don't close if clicking the sibling price input
                  const related = e.relatedTarget as HTMLElement | null
                  if (related && e.currentTarget.parentElement?.contains(related)) return
                  setTimeout(() => commitEditModifier(groupId, mod.id), 100)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                  if (e.key === 'Escape') setEditingModifierId(null)
                }}
                className="flex-1 px-1 py-0.5 text-sm border rounded bg-white min-w-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <span className="text-[9px] text-gray-500">$</span>
                <input
                  type="number"
                  value={editModValues.price}
                  onChange={(e) => setEditModValues(prev => ({ ...prev, price: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const related = e.relatedTarget as HTMLElement | null
                    if (related && e.currentTarget.parentElement?.parentElement?.contains(related)) return
                    setTimeout(() => commitEditModifier(groupId, mod.id), 100)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                    if (e.key === 'Escape') setEditingModifierId(null)
                  }}
                  className="w-16 px-1 py-0.5 text-xs border rounded text-center"
                  step="0.01"
                  min="0"
                />
                {isDualPricingEnabled && editModValues.price && parseFloat(editModValues.price) > 0 && (
                  <span className="text-[9px] text-indigo-400 font-semibold whitespace-nowrap">
                    card {formatCurrency(calculateCardPrice(parseFloat(editModValues.price) || 0, cashDiscountPct))}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span
              className="flex-1 truncate cursor-pointer hover:text-indigo-600 flex items-center gap-1.5 min-w-0 group/name"
              onClick={() => startEditModifier(mod)}
              title="Click to edit name & price"
            >
              <span className="truncate">{mod.name}</span>
              {mod.price > 0 && (
                <span className="text-xs font-semibold shrink-0 flex items-center gap-1">
                  <span className="text-green-600">+{formatCurrency(mod.price)}</span>
                  {isDualPricingEnabled && (
                    <span className="text-indigo-400">+{formatCurrency(calculateCardPrice(mod.price, cashDiscountPct))}</span>
                  )}
                </span>
              )}
              {mod.isDefault && (
                <span className="text-[8px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold shrink-0">DEFAULT</span>
              )}
              <span className="text-gray-300 group-hover/name:text-indigo-400 text-[10px] shrink-0 transition-colors">✏️</span>
            </span>
          )}

          {/* RIGHT SIDE: All controls */}
          {/* Ingredient Link Badge */}
          {mod.ingredientId && mod.ingredientName && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1 shrink-0">
              🔗 {mod.ingredientName}
              <button
                onClick={() => linkIngredient(groupId, mod.id, null)}
                className="hover:text-purple-900"
              >
                ×
              </button>
            </span>
          )}

          {/* Unlinked hint - only for non-label modifiers */}
          {!mod.ingredientId && !mod.isLabel && (
            <span className="text-[8px] text-gray-300 italic shrink-0">unlinked</span>
          )}

          {/* Link Ingredient Button */}
          <button
            onClick={() => {
              if (isLinking) {
                // Closing current modifier's dropdown — reset everything
                setLinkingModifier(null)
                setModIngredientSearch('')
                setExpandedCategories(new Set())
                setExpandedParents(new Set())
              } else {
                // Opening dropdown for a new modifier — reset and open
                setExpandedCategories(new Set())
                setExpandedParents(new Set())
                setModIngredientSearch('')
                setLinkingModifier({ groupId, modId: mod.id })
              }
            }}
            className={`w-5 h-5 rounded text-xs shrink-0 ${isLinking ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
            title="Link Ingredient"
          >
            🔗
          </button>

          {/* Default Selection Toggle */}
          <button
            onClick={() => toggleDefault(groupId, mod.id, !!mod.isDefault)}
            className={`w-5 h-5 rounded text-[9px] font-bold shrink-0 ${mod.isDefault ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-500'}`}
            title={mod.isDefault ? 'Default: ON' : 'Default: OFF'}
          >
            ★
          </button>

          {/* Pre-modifier toggles — each in own bordered box, faded color when off */}
          <div className="flex gap-1 shrink-0">
            <span className={`flex items-center h-6 rounded border px-0.5 ${mod.allowNo ? 'border-red-300 bg-red-50' : 'border-red-200 bg-red-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowNo: !mod.allowNo })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-300'}`}
              >
                No
              </button>
            </span>
            <span className={`flex items-center h-6 rounded border px-0.5 ${mod.allowLite ? 'border-yellow-300 bg-yellow-50' : 'border-yellow-200 bg-yellow-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowLite: !mod.allowLite })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-300'}`}
              >
                Lite
              </button>
            </span>
            <span className={`flex items-center h-6 rounded border px-0.5 ${mod.allowOnSide ? 'border-blue-300 bg-blue-50' : 'border-blue-200 bg-blue-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowOnSide: !mod.allowOnSide })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-300'}`}
              >
                Side
              </button>
            </span>
            <span className={`flex items-center gap-0.5 h-6 rounded border px-0.5 ${mod.allowExtra ? 'border-green-300 bg-green-50' : 'border-green-200 bg-green-50/40'}`}>
              <button
                onClick={() => {
                  const turningOn = !mod.allowExtra
                  const updates: Partial<Modifier> = { allowExtra: turningOn }
                  if (turningOn && mod.price > 0 && !(mod.extraPrice && mod.extraPrice > 0)) {
                    updates.extraPrice = mod.price
                  }
                  updateModifier(groupId, mod.id, updates)
                }}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-300'}`}
              >
                Extra
              </button>
              <span className={`text-[9px] font-bold ${mod.allowExtra ? 'text-green-600' : 'text-green-300'}`}>$</span>
              {mod.allowExtra ? (
                <input
                  type="number"
                  defaultValue={mod.extraPrice ?? 0}
                  key={`extra-${mod.id}-${mod.extraPrice ?? 0}`}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const parsed = parseFloat(e.target.value)
                    const val = Number.isFinite(parsed) ? parsed : 0
                    if (val !== (mod.extraPrice ?? 0)) {
                      updateModifier(groupId, mod.id, { extraPrice: val })
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  className="w-14 h-5 px-1 text-[10px] font-semibold rounded text-center bg-white border border-green-300 text-green-700 focus:border-green-500 focus:ring-1 focus:ring-green-300 focus:outline-none"
                  step="0.01"
                  min="0"
                />
              ) : (
                <span className="w-14 h-5 flex items-center justify-center text-[10px] text-green-300 font-semibold">
                  {(mod.extraPrice ?? 0).toFixed(2)}
                </span>
              )}
              {isDualPricingEnabled && (mod.extraPrice ?? 0) > 0 && (
                <span className="text-[8px] text-indigo-400 font-semibold ml-0.5">
                  {formatCurrency(calculateCardPrice(mod.extraPrice ?? 0, cashDiscountPct))}
                </span>
              )}
            </span>
          </div>

          {/* Printer Routing Button */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPrinterRoutingModifier(
                printerRoutingModifier?.modId === mod.id ? null : { groupId, modId: mod.id }
              )}
              className={`printer-routing-button w-5 h-5 rounded text-xs shrink-0 ${
                mod.printerRouting === 'only' ? 'bg-orange-500 text-white' :
                mod.printerRouting === 'also' ? 'bg-blue-500 text-white' :
                'bg-gray-100 text-gray-400 hover:bg-gray-200'
              }`}
              title={
                mod.printerRouting === 'only' ? 'Prints ONLY to specific printers' :
                mod.printerRouting === 'also' ? 'ALSO prints to additional printers' :
                'Follows item\'s printer routing'
              }
            >
              🖨️
            </button>

            {/* Printer Routing Dropdown */}
            {printerRoutingModifier?.modId === mod.id && (
              <div className="printer-routing-dropdown absolute right-0 top-full mt-1 bg-white border rounded shadow-lg p-2 w-56 z-50">
                <div className="text-xs font-semibold mb-2">Print Routing</div>

                {/* Routing Mode Selection */}
                <div className="space-y-1 mb-2">
                  <button
                    onClick={() => updateModifier(groupId, mod.id, { printerRouting: 'follow', printerIds: [] })}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      (mod.printerRouting || 'follow') === 'follow' ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'
                    }`}
                  >
                    Follow Item (Default)
                  </button>
                  <button
                    onClick={() => {
                      if (mod.printerRouting !== 'also') {
                        updateModifier(groupId, mod.id, { printerRouting: 'also', printerIds: [] })
                      }
                    }}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      mod.printerRouting === 'also' ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-blue-50'
                    }`}
                  >
                    Also Print To...
                  </button>
                  <button
                    onClick={() => {
                      if (mod.printerRouting !== 'only') {
                        updateModifier(groupId, mod.id, { printerRouting: 'only', printerIds: [] })
                      }
                    }}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      mod.printerRouting === 'only' ? 'bg-orange-100 text-orange-700 font-semibold' : 'hover:bg-orange-50'
                    }`}
                  >
                    Only Print To...
                  </button>
                </div>

                {/* Printer Selection (only show for "also" or "only") */}
                {(mod.printerRouting === 'also' || mod.printerRouting === 'only') && (
                  <div className="border-t pt-2">
                    <div className="text-[10px] text-gray-500 mb-1">Select Printers:</div>
                    {printers.length === 0 ? (
                      <div className="text-xs text-gray-400 py-2 text-center">
                        No printers configured
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {printers.map(printer => {
                          const isSelected = (mod.printerIds || []).includes(printer.id)
                          return (
                            <label key={printer.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentIds = mod.printerIds || []
                                  const newIds = e.target.checked
                                    ? [...currentIds, printer.id]
                                    : currentIds.filter(id => id !== printer.id)
                                  updateModifier(groupId, mod.id, { printerIds: newIds })
                                }}
                                className="w-3 h-3"
                              />
                              <span>{printer.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs shrink-0"
          >
            ×
          </button>

          {/* Create Child Group Button — only if no child group exists yet */}
          {!mod.childModifierGroupId && (
            <button
              onClick={(e) => { e.stopPropagation(); createChildGroup(mod.id) }}
              className="w-5 h-5 rounded bg-indigo-100 text-indigo-600 hover:bg-indigo-200 text-xs font-bold"
              title="Add sub-group"
            >
              +▶
            </button>
          )}
        </div>

        {/* Hierarchical Ingredient Dropdown */}
        {isLinking && (
          <div className="ml-4 p-2 bg-purple-50 border border-purple-200 rounded">
            <input
              type="text"
              value={modIngredientSearch}
              onChange={(e) => setModIngredientSearch(e.target.value)}
              placeholder="Search prep items..."
              className="w-full px-2 py-1 text-xs border rounded mb-1"
              autoFocus
            />
            <div className="max-h-96 overflow-y-auto space-y-0.5">
              {(() => {
                const hierarchy = buildHierarchy(modIngredientSearch)
                const sortedCategories = Object.values(hierarchy).sort((a, b) =>
                  a.category.sortOrder - b.category.sortOrder
                )

                if (sortedCategories.length === 0) {
                  return (
                    <div className="text-xs text-gray-400 text-center py-2">
                      {modIngredientSearch ? 'No matching ingredients' : 'No ingredient categories found'}
                    </div>
                  )
                }

                return sortedCategories.map(({ category, baseIngredients, parents }) => {
                  const isExpanded = expandedCategories.has(category.id)
                  const hasItems = baseIngredients.length > 0 || Object.keys(parents).length > 0

                  return (
                    <div key={category.id}>
                      {/* Category Header */}
                      <div className="flex items-center gap-1 text-[10px] font-bold text-gray-700 uppercase tracking-wider px-2 py-1.5 bg-gray-100 sticky top-0 border-b border-gray-200">
                        <button
                          onClick={() => toggleCategory(category.id)}
                          className="hover:bg-gray-200 rounded px-1"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                        <span className="flex-1">{category.name}</span>

                        {/* Unverified count badge */}
                        {(() => {
                          const baseUnverified = baseIngredients.filter(b => b.needsVerification).length
                          const prepUnverified = Object.values(parents)
                            .flatMap(p => p.prepItems)
                            .filter(prep => prep.needsVerification).length
                          const unverifiedCount = baseUnverified + prepUnverified
                          return unverifiedCount > 0 ? (
                            <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">
                              ⚠ {unverifiedCount}
                            </span>
                          ) : null
                        })()}

                        <button
                          onClick={() => setCreatingInventoryInCategory(category.id)}
                          className="ml-auto text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded px-1"
                          title="Create new inventory item"
                          disabled={creatingIngredientLoading}
                        >
                          {creatingIngredientLoading && creatingInventoryInCategory === category.id ? (
                            <span className="animate-spin">⏳</span>
                          ) : (
                            '+'
                          )}
                        </button>
                      </div>

                      {/* Inline Inventory Item Creation Form */}
                      {creatingInventoryInCategory === category.id && (
                        <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                          <input
                            type="text"
                            value={newInventoryName}
                            onChange={(e) => setNewInventoryName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') createInventoryItem(category.id)
                              if (e.key === 'Escape') {
                                setCreatingInventoryInCategory(null)
                                setNewInventoryName('')
                              }
                            }}
                            placeholder="New inventory item name..."
                            className="w-full px-2 py-1 text-xs border rounded mb-1"
                            autoFocus
                            disabled={creatingIngredientLoading}
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={() => createInventoryItem(category.id)}
                              className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                              disabled={!newInventoryName.trim() || creatingIngredientLoading}
                            >
                              Create
                            </button>
                            <button
                              onClick={() => {
                                setCreatingInventoryInCategory(null)
                                setNewInventoryName('')
                              }}
                              className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                              disabled={creatingIngredientLoading}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Category Contents */}
                      {isExpanded && (() => {
                        // Build unified list for modifier ingredient picker too
                        const modInvItems = baseIngredients
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(base => ({
                            item: base,
                            children: (parents[base.id]?.prepItems || [])
                              .sort((a, b) => a.name.localeCompare(b.name)),
                          }))
                        const modBaseIds = new Set(baseIngredients.map(b => b.id))
                        const modOrphanParents = Object.entries(parents)
                          .filter(([pid]) => !modBaseIds.has(pid))
                          .map(([pid, { parent: p, prepItems }]) => ({
                            item: p, parentId: pid,
                            children: prepItems.sort((a, b) => a.name.localeCompare(b.name)),
                          }))
                          .filter(g => g.children.length > 0)
                          .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))

                        return (
                          <div>
                            {/* Inventory items (BLUE) — expand only, only prep items are linkable */}
                            {modInvItems.map(({ item: base, children: modChildren }) => {
                              const hasKids = modChildren.length > 0
                              const isBaseExp = expandedParents.has(base.id)
                              return (
                                <div key={base.id}>
                                  <div
                                    className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                    onClick={() => toggleParent(base.id)}
                                  >
                                    <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">
                                      {isBaseExp ? '▼' : '▶'}
                                    </span>
                                    <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                    <span className="flex-1 text-xs font-medium truncate text-gray-900">{base.name}</span>
                                    {base.needsVerification && <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>}
                                    {hasKids ? (
                                      <span className="text-[9px] text-blue-400 shrink-0">{modChildren.length} prep</span>
                                    ) : (
                                      <span className="text-[9px] text-gray-400 italic shrink-0">+ add prep</span>
                                    )}
                                  </div>
                                  {isBaseExp && (
                                    <div className="ml-5 border-l-2 border-green-300">
                                      {modChildren.map(prep => (
                                        <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                          <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                          <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                          <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                          {prep.needsVerification && <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>}
                                          <button
                                            onClick={() => { if (linkingModifier) linkIngredient(linkingModifier.groupId, linkingModifier.modId, prep.id) }}
                                            className="px-2.5 py-0.5 text-[9px] font-bold bg-purple-600 text-white rounded hover:bg-purple-700 active:bg-purple-800 shrink-0"
                                          >
                                            Link
                                          </button>
                                        </div>
                                      ))}
                                      {creatingPrepUnderParent === base.id ? (
                                        <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                          <input type="text" value={newPrepName} onChange={(e) => setNewPrepName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPrepItem(base.id, category.id); if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') } }} placeholder="New prep item name..." className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus disabled={creatingIngredientLoading} />
                                          <div className="flex gap-1">
                                            <button onClick={() => createPrepItem(base.id, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create & Link</button>
                                            <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button onClick={() => setCreatingPrepUnderParent(base.id)} className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100" disabled={creatingIngredientLoading}>+ New prep item</button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            {/* Orphan parents (BLUE header + GREEN children) */}
                            {modOrphanParents.map(({ item: p, parentId: pid, children: opChildren }) => {
                              const isOpExp = expandedParents.has(pid)
                              return (
                                <div key={pid}>
                                  <div
                                    className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                    onClick={() => toggleParent(pid)}
                                  >
                                    <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">{isOpExp ? '▼' : '▶'}</span>
                                    <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                    <span className="flex-1 text-xs font-medium truncate text-gray-900">{p?.name || 'Unknown'}</span>
                                    <span className="text-[9px] text-blue-400 shrink-0">{opChildren.length} prep</span>
                                  </div>
                                  {isOpExp && (
                                    <div className="ml-5 border-l-2 border-green-300">
                                      {opChildren.map(prep => (
                                        <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                          <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                          <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                          <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                          {prep.needsVerification && <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>}
                                          <button
                                            onClick={() => { if (linkingModifier) linkIngredient(linkingModifier.groupId, linkingModifier.modId, prep.id) }}
                                            className="px-2.5 py-0.5 text-[9px] font-bold bg-purple-600 text-white rounded hover:bg-purple-700 active:bg-purple-800 shrink-0"
                                          >
                                            Link
                                          </button>
                                        </div>
                                      ))}
                                      {/* Create prep item inline for orphan parent in modifier linking */}
                                      {creatingPrepUnderParent === pid ? (
                                        <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                          <input type="text" value={newPrepName} onChange={(e) => setNewPrepName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPrepItem(pid, category.id); if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') } }} placeholder="New prep item name..." className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus disabled={creatingIngredientLoading} />
                                          <div className="flex gap-1">
                                            <button onClick={() => createPrepItem(pid, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create & Link</button>
                                            <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button onClick={() => setCreatingPrepUnderParent(pid)} className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100" disabled={creatingIngredientLoading}>+ New prep item</button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}

        {/* Render Child Group: collapsed chip or full expanded view */}
        {mod.childModifierGroup && (() => {
          const cg = mod.childModifierGroup
          const cgExpanded = expandedGroups.has(cg.id)
          if (cgExpanded) {
            return renderChildGroup(cg, depth + 1, rowIndex)
          }
          // Collapsed: compact inline chip
          const colorIndex = (depth + rowIndex) % childGroupColors.length
          const colors = childGroupColors[colorIndex]
          return (
            <div
              key={`chip-${cg.id}`}
              className={`ml-6 mt-0.5 mb-0.5 flex items-center gap-1.5 cursor-pointer group/chip`}
              onClick={() => { toggleExpanded(cg.id); onSelectGroup?.(cg.id) }}
              title={`${cg.name} — ${cg.modifiers.length} modifier${cg.modifiers.length !== 1 ? 's' : ''} (click to expand)`}
            >
              <div className={`h-1.5 w-1.5 rounded-full ${colors.bg} border ${colors.border} shrink-0`} />
              <span className={`text-[10px] ${colors.border.replace('border-', 'text-')} group-hover/chip:underline truncate`}>
                {cg.name}
              </span>
              <span className="text-[9px] text-gray-400">
                ({cg.modifiers.length})
              </span>
            </div>
          )
        })()}
      </div>
    )
  }

  // Helper to render child modifier groups recursively
  // Color palette for child group headers — cycles through distinct colors per depth
  const childGroupColors = [
    { bg: 'bg-violet-100', border: 'border-violet-300', borderB: 'border-violet-200', hover: 'hover:bg-violet-200/70', wrapper: 'border-violet-300', leftBorder: 'border-l-violet-300' },
    { bg: 'bg-teal-100', border: 'border-teal-300', borderB: 'border-teal-200', hover: 'hover:bg-teal-200/70', wrapper: 'border-teal-300', leftBorder: 'border-l-teal-300' },
    { bg: 'bg-rose-100', border: 'border-rose-300', borderB: 'border-rose-200', hover: 'hover:bg-rose-200/70', wrapper: 'border-rose-300', leftBorder: 'border-l-rose-300' },
    { bg: 'bg-amber-100', border: 'border-amber-300', borderB: 'border-amber-200', hover: 'hover:bg-amber-200/70', wrapper: 'border-amber-300', leftBorder: 'border-l-amber-300' },
    { bg: 'bg-sky-100', border: 'border-sky-300', borderB: 'border-sky-200', hover: 'hover:bg-sky-200/70', wrapper: 'border-sky-300', leftBorder: 'border-l-sky-300' },
  ]

  const renderChildGroup = (childGroup: ModifierGroup, depth: number = 1, siblingIndex: number = 0) => {
    // Safety: prevent infinite recursion
    if (depth > 10) {
      console.error('Max nesting depth exceeded for group:', childGroup.id)
      return (
        <div className="ml-4 p-2 text-xs text-red-500 bg-red-50 rounded">
          ⚠ Maximum nesting depth reached
        </div>
      )
    }

    const isExpanded = expandedGroups.has(childGroup.id)
    const isEmpty = childGroup.modifiers.length === 0
    const colorIndex = (depth - 1 + siblingIndex) % childGroupColors.length
    const colors = childGroupColors[colorIndex]
    const depthIndent: Record<number, string> = {
      0: 'ml-0',
      1: 'ml-4',
      2: 'ml-8',
      3: 'ml-12',
      4: 'ml-16',
    }
    const indentClass = `${depthIndent[depth] ?? 'ml-16'} pl-3 border-l-2 ${colors.leftBorder}`

    return (
      <div
        key={childGroup.id}
        className={`mt-2 ${indentClass} ${draggedGroupId === childGroup.id ? 'opacity-50' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedGroupId(childGroup.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-modifier-group', JSON.stringify({
            groupId: childGroup.id,
            sourceItemId: item?.id,
            groupName: childGroup.name,
            isChild: true,
          }))
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOverGroupId(childGroup.id)
        }}
        onDragLeave={() => setDragOverGroupId(null)}
        onDrop={(e) => handleGroupDrop(e, childGroup.id)}
        onDragEnd={() => {
          setDraggedGroupId(null)
          setDragOverGroupId(null)
          setDragOverDropZone(null)
        }}
      >
        {/* Removed "After selecting parent modifier:" label to save space */}
        <div className={`border-2 ${colors.wrapper} rounded-lg overflow-hidden shadow-sm ${childGroup.isRequired ? 'border-l-4 border-l-red-400' : ''} ${isEmpty ? 'border-dashed' : ''} ${dragOverGroupId === childGroup.id && draggedGroupId !== childGroup.id ? 'ring-2 ring-indigo-400' : ''}`}>
          {/* Child Group Header — entire bar is clickable to expand/collapse */}
          <div
            className={`px-3 py-2 ${colors.bg} border-b ${colors.borderB} flex items-center gap-2 cursor-pointer ${colors.hover} transition-colors`}
            onClick={() => {
              toggleExpanded(childGroup.id)
              onSelectGroup?.(isExpanded ? null : childGroup.id)
            }}
          >
            {/* Drag handle */}
            <span className="cursor-grab text-gray-400 hover:text-gray-600 mr-1 text-xs" title="Drag to move group" onClick={(e) => e.stopPropagation()}>⠿</span>
            {/* Expand/collapse arrow */}
            <span className={`text-xs transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''} ${childGroup.isRequired && isEmpty ? 'text-red-500' : isEmpty ? 'text-gray-300' : 'text-green-500'}`}>
              ▶
            </span>

            {/* Name - double-click to rename */}
            {renamingGroupId === childGroup.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(childGroup.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(childGroup.id)
                  if (e.key === 'Escape') { setRenamingGroupId(null); setRenameValue('') }
                }}
                className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="flex-1 font-medium text-sm truncate"
                onDoubleClick={(e) => { e.stopPropagation(); startRename(childGroup.id, childGroup.name) }}
                title="Double-click to rename"
              >
                {childGroup.name}
              </span>
            )}

            {/* Settings badges — always visible in header */}
            <span className="ml-auto text-[9px] text-gray-400 flex items-center gap-1 shrink-0">
              <span className="px-1 py-0.5 bg-gray-100 rounded">{childGroup.minSelections}-{childGroup.maxSelections}</span>
              {childGroup.isRequired && <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">Req</span>}
              {childGroup.allowStacking && <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 rounded">Stack</span>}
            </span>
            <span className="text-xs text-gray-400">{childGroup.modifiers.length}</span>

            {/* Promote to top-level button */}
            <button
              onClick={(e) => { e.stopPropagation(); reparentGroup(childGroup.id, null) }}
              className="text-gray-400 hover:text-green-600 text-xs px-0.5"
              title="Promote to top-level group"
              disabled={saving}
            >
              ⬆
            </button>

            {/* Action buttons */}
            <button
              onClick={(e) => { e.stopPropagation(); startRename(childGroup.id, childGroup.name) }}
              className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
              title="Rename"
              disabled={saving}
            >
              ✏️
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); duplicateGroup(childGroup.id) }}
              className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
              title="Duplicate Group"
              disabled={saving}
            >
              ⧉
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteGroup(childGroup.id) }}
              className="text-gray-400 hover:text-red-600 text-xs px-0.5"
              title="Delete Group"
              disabled={saving}
            >
              🗑
            </button>
          </div>

          {/* Child Group Expanded Content */}
          {isExpanded && (
            <div className="border-t" draggable={false} onDragStart={(e) => e.stopPropagation()}>
              {/* Child Modifiers */}
              <div className="p-2 space-y-1">
                {isEmpty && (
                  <div className="text-center text-gray-400 text-xs py-2 italic">
                    Add modifiers to get started
                  </div>
                )}
                {childGroup.modifiers.map((mod, idx) => renderModifierRow(childGroup.id, mod, depth, idx))}

                {/* Drop zone: nest a group inside this child group */}
                {draggedGroupId && draggedGroupId !== childGroup.id && !isDescendantOf(draggedGroupId, childGroup.id) && (
                  <div
                    className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === `nest-${childGroup.id}` ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-400'}`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDropZone(`nest-${childGroup.id}`) }}
                    onDragLeave={() => setDragOverDropZone(null)}
                    onDrop={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (draggedGroupId) {
                        await nestGroupInGroup(draggedGroupId, childGroup.id)
                      }
                      setDraggedGroupId(null)
                      setDragOverGroupId(null)
                      setDragOverDropZone(null)
                    }}
                  >
                    ⬇ Drop here to nest inside {childGroup.name}
                  </div>
                )}

                {/* Add Modifier to Child Group */}
                {addingModifierTo === childGroup.id ? (
                  <div className="flex gap-1 mt-2">
                    <input
                      type="text"
                      value={newModName}
                      onChange={(e) => setNewModName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 px-2 py-1 text-xs border rounded"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (addingType === 'choice') {
                            addChoice(childGroup.id)
                          } else {
                            addModifier(childGroup.id)
                          }
                        }
                      }}
                    />
                    {addingType === 'item' && (
                      <input
                        type="number"
                        value={newModPrice}
                        onChange={(e) => setNewModPrice(e.target.value)}
                        placeholder="$"
                        className="w-14 px-2 py-1 text-xs border rounded"
                        step="0.01"
                        min="0"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => addingType === 'choice' ? addChoice(childGroup.id) : addModifier(childGroup.id)}
                      disabled={!newModName.trim()}
                    >
                      +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setAddingType(null); setNewModName(''); setNewModPrice('') }}>
                      ×
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setAddingModifierTo(childGroup.id); setAddingType('item') }}
                      className="flex-1 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                    >
                      + Add Item
                    </button>
                    <button
                      onClick={() => { setAddingModifierTo(childGroup.id); setAddingType('choice') }}
                      className="flex-1 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded border border-dashed border-amber-300"
                    >
                      + Add Choice
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const filteredLibrary = ingredientsLibrary.filter(lib =>
    !ingredients.find(i => i.ingredientId === lib.id) &&
    lib.name.toLowerCase().includes(ingredientSearch.toLowerCase())
  )

  // Build hierarchy for dropdown
  const buildHierarchy = (searchTerm: string = '') => {
    const hierarchy: Record<string, {
      category: IngredientCategory
      baseIngredients: IngredientLibraryItem[]
      parents: Record<string, {
        parent: IngredientLibraryItem | null
        prepItems: IngredientLibraryItem[]
      }>
    }> = {}

    // Filter ALL ingredients based on search (both base and prep)
    const filteredIngredients = searchTerm.trim()
      ? ingredientsLibrary.filter(ing =>
          ing.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : ingredientsLibrary

    // Separate base ingredients from prep items
    const baseIngredients = filteredIngredients.filter(ing => !ing.parentIngredientId)
    const prepItems = filteredIngredients.filter(ing => ing.parentIngredientId)

    // Get relevant category IDs from ALL matching ingredients
    const relevantCategoryIds = searchTerm.trim()
      ? new Set([...baseIngredients, ...prepItems].map(p => p.categoryId).filter(Boolean) as string[])
      : new Set(ingredientCategories.map(c => c.id))

    // Initialize categories
    ingredientCategories
      .filter(cat => cat.isActive && (relevantCategoryIds.size === 0 || relevantCategoryIds.has(cat.id)))
      .forEach(cat => {
        hierarchy[cat.id] = { category: cat, baseIngredients: [], parents: {} }
      })

    // Add base ingredients to their categories
    baseIngredients.forEach(base => {
      const catId = base.categoryId || 'uncategorized'

      if (!hierarchy[catId]) {
        hierarchy[catId] = {
          category: {
            id: 'uncategorized',
            code: 0,
            name: 'Uncategorized',
            icon: null,
            color: null,
            sortOrder: 999,
            isActive: true,
            ingredientCount: 0,
          },
          baseIngredients: [],
          parents: {},
        }
      }

      hierarchy[catId].baseIngredients.push(base)
    })

    // Group prep items by category and parent
    prepItems.forEach(prep => {
      const catId = prep.categoryId || 'uncategorized'

      if (!hierarchy[catId]) {
        hierarchy[catId] = {
          category: {
            id: 'uncategorized',
            code: 0,
            name: 'Uncategorized',
            icon: null,
            color: null,
            sortOrder: 999,
            isActive: true,
            ingredientCount: 0,
          },
          baseIngredients: [],
          parents: {},
        }
      }

      const parentId = prep.parentIngredientId || 'standalone'

      if (!hierarchy[catId].parents[parentId]) {
        const parentIng = ingredientsLibrary.find(i => i.id === prep.parentIngredientId)
        hierarchy[catId].parents[parentId] = {
          parent: parentIng || null,
          prepItems: [],
        }
      }

      hierarchy[catId].parents[parentId].prepItems.push(prep)
    })

    return hierarchy
  }

  // Auto-expand on search (modifier linking)
  useEffect(() => {
    if (modIngredientSearch.trim()) {
      const hierarchy = buildHierarchy(modIngredientSearch)
      const categoriesToExpand = new Set<string>()
      const parentsToExpand = new Set<string>()

      Object.entries(hierarchy).forEach(([catId, catData]) => {
        // Expand category if it has base ingredients OR prep items
        if (catData.baseIngredients.length > 0 || Object.keys(catData.parents).length > 0) {
          categoriesToExpand.add(catId)
          Object.keys(catData.parents).forEach(parentId => {
            parentsToExpand.add(parentId)
          })
        }
      })

      setExpandedCategories(categoriesToExpand)
      setExpandedParents(parentsToExpand)
    } else {
      setExpandedCategories(new Set())
      setExpandedParents(new Set())
    }
  }, [modIngredientSearch])

  // Auto-expand on search (ingredient picker)
  useEffect(() => {
    if (ingredientSearch.trim()) {
      const hierarchy = buildHierarchy(ingredientSearch)
      const categoriesToExpand = new Set<string>()
      const parentsToExpand = new Set<string>()

      Object.entries(hierarchy).forEach(([catId, catData]) => {
        // Expand category if it has base ingredients OR prep items
        if (catData.baseIngredients.length > 0 || Object.keys(catData.parents).length > 0) {
          categoriesToExpand.add(catId)
          Object.keys(catData.parents).forEach(parentId => {
            parentsToExpand.add(parentId)
          })
        }
      })

      setExpandedCategories(categoriesToExpand)
      setExpandedParents(parentsToExpand)
    } else if (!modIngredientSearch.trim()) {
      // Only clear if modifier search is also empty
      setExpandedCategories(new Set())
      setExpandedParents(new Set())
    }
  }, [ingredientSearch, modIngredientSearch])

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 p-4 bg-gray-50">
        <p className="text-sm">Select an item to edit</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Item Header */}
      <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold truncate">{item.name}</h2>
              {/* Default Selections — on same line as item name, never shifts layout */}
              {!loading && (() => {
                const seen = new Set<string>()
                const allDefaults: { id: string; name: string; price: number }[] = []
                const collectDefaults = (groups: ModifierGroup[]) => {
                  for (const g of groups) {
                    for (const m of g.modifiers) {
                      if (m.isDefault && !seen.has(m.id)) {
                        seen.add(m.id)
                        allDefaults.push({ id: m.id, name: m.name, price: m.price })
                      }
                      if (m.childModifierGroup) collectDefaults([m.childModifierGroup])
                    }
                  }
                }
                collectDefaults(modifierGroups)
                if (allDefaults.length === 0) return null
                return (
                  <span className="ml-auto text-[11px] font-semibold text-red-300 truncate shrink-0 pl-3">
                    ★ {allDefaults.map(d => d.name).join(', ')}
                  </span>
                )
              })()}
            </div>
            <div className="mt-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{formatCurrency(item.price)}</span>
                {isDualPricingEnabled && (
                  <>
                    <span className="text-xs text-slate-400">cash</span>
                    <span className="text-lg font-semibold text-indigo-400">{formatCurrency(itemCardPrice)}</span>
                    <span className="text-xs text-slate-400">card</span>
                  </>
                )}
              </div>
              {isTaxInclusive && (
                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 mt-1">
                  TAX INCLUSIVE
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {onToggle86 && (
              <button
                onClick={() => onToggle86(item)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  !item.isAvailable ? 'bg-white text-blue-600' : 'bg-white/20 hover:bg-white/30'
                }`}
              >
                {!item.isAvailable ? 'Restore' : '86 It'}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(item.id)}
                className="px-3 py-1.5 rounded text-sm bg-red-500/80 hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <>
            {/* INGREDIENTS SECTION - Collapsible */}
            <div className="border-b">
              <button
                onClick={() => setIngredientsExpanded(!ingredientsExpanded)}
                className="w-full px-4 py-3 bg-green-50 flex items-center justify-between hover:bg-green-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-green-600 transition-transform ${ingredientsExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-semibold text-green-900">🥗 Ingredients</span>
                  <span className="text-sm text-green-600">({ingredients.length})</span>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  className="text-green-600 text-xs font-semibold px-2 py-1 hover:bg-green-100 rounded cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) } }}
                >
                  + Add
                </span>
              </button>

              {ingredientsExpanded && (
                <div className="p-3 space-y-2">
                  {/* Hierarchical Ingredient Picker */}
                  {showIngredientPicker && (
                    <div className="p-2 border rounded bg-white mb-2">
                      <input
                        type="text"
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        placeholder="Search ingredients..."
                        className="w-full px-2 py-1 text-xs border rounded mb-1"
                        autoFocus
                      />
                      <div className="max-h-96 overflow-y-auto space-y-0.5">
                        {(() => {
                          const hierarchy = buildHierarchy(ingredientSearch)
                          const sortedCategories = Object.values(hierarchy).sort((a, b) =>
                            a.category.sortOrder - b.category.sortOrder
                          )

                          // Filter out already-added ingredients
                          const alreadyAddedIds = new Set(ingredients.map(i => i.ingredientId))

                          if (sortedCategories.length === 0) {
                            return (
                              <div className="text-xs text-gray-400 text-center py-2">
                                {ingredientSearch ? 'No matching ingredients' : 'No ingredient categories found'}
                              </div>
                            )
                          }

                          return sortedCategories.map(({ category, baseIngredients, parents }) => {
                            const isExpanded = expandedCategories.has(category.id)

                            // Build unified list: each inventory item + its prep children
                            const inventoryItems = baseIngredients
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(base => ({
                                item: base,
                                children: (parents[base.id]?.prepItems || [])
                                  .filter(pr => !alreadyAddedIds.has(pr.id))
                                  .sort((a, b) => a.name.localeCompare(b.name)),
                              }))

                            // Orphan parents not in base list
                            const baseIds = new Set(baseIngredients.map(b => b.id))
                            const orphanParents = Object.entries(parents)
                              .filter(([pid]) => !baseIds.has(pid))
                              .map(([pid, { parent: p, prepItems }]) => ({
                                item: p,
                                parentId: pid,
                                children: prepItems
                                  .filter(pr => !alreadyAddedIds.has(pr.id))
                                  .sort((a, b) => a.name.localeCompare(b.name)),
                              }))
                              .filter(g => g.children.length > 0)
                              .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))

                            const totalAvailable = inventoryItems.filter(iv => !alreadyAddedIds.has(iv.item.id)).length
                              + inventoryItems.reduce((sum, iv) => sum + iv.children.length, 0)
                              + orphanParents.reduce((sum, op) => sum + op.children.length, 0)

                            return (
                              <div key={category.id}>
                                {/* Category Header */}
                                <div className="flex items-center gap-1 text-[10px] font-bold text-gray-700 uppercase tracking-wider px-2 py-1.5 bg-gray-100 sticky top-0 border-b border-gray-200">
                                  <button
                                    onClick={() => toggleCategory(category.id)}
                                    className="hover:bg-gray-200 rounded px-1"
                                  >
                                    {isExpanded ? '▼' : '▶'}
                                  </button>
                                  <span className="flex-1">{category.name}</span>
                                  <span className="text-[9px] text-gray-400 font-normal">{totalAvailable}</span>

                                  {/* Unverified count badge */}
                                  {(() => {
                                    const baseUnverified = baseIngredients.filter(b => b.needsVerification).length
                                    const prepUnverified = Object.values(parents)
                                      .flatMap(p => p.prepItems)
                                      .filter(prep => prep.needsVerification).length
                                    const unverifiedCount = baseUnverified + prepUnverified
                                    return unverifiedCount > 0 ? (
                                      <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">
                                        ⚠ {unverifiedCount}
                                      </span>
                                    ) : null
                                  })()}

                                  <button
                                    onClick={() => setCreatingInventoryInCategory(category.id)}
                                    className="ml-auto text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded px-1"
                                    title="Create new inventory item"
                                    disabled={creatingIngredientLoading}
                                  >
                                    {creatingIngredientLoading && creatingInventoryInCategory === category.id ? (
                                      <span className="animate-spin">⏳</span>
                                    ) : (
                                      '+'
                                    )}
                                  </button>
                                </div>

                                {/* Inline Inventory Item Creation Form */}
                                {creatingInventoryInCategory === category.id && (
                                  <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                                    <input
                                      type="text"
                                      value={newInventoryName}
                                      onChange={(e) => setNewInventoryName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') createInventoryItem(category.id)
                                        if (e.key === 'Escape') {
                                          setCreatingInventoryInCategory(null)
                                          setNewInventoryName('')
                                        }
                                      }}
                                      placeholder="New inventory item name..."
                                      className="w-full px-2 py-1 text-xs border rounded mb-1"
                                      autoFocus
                                      disabled={creatingIngredientLoading}
                                    />
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => createInventoryItem(category.id)}
                                        className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                        disabled={!newInventoryName.trim() || creatingIngredientLoading}
                                      >
                                        Create
                                      </button>
                                      <button
                                        onClick={() => {
                                          setCreatingInventoryInCategory(null)
                                          setNewInventoryName('')
                                        }}
                                        className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                        disabled={creatingIngredientLoading}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Category Contents */}
                                {isExpanded && (
                                  <div>
                                    {/* Inventory items (BLUE) — expand only, only prep items are addable */}
                                    {inventoryItems.map(({ item: base, children }) => {
                                      const hasChildren = children.length > 0
                                      const isBaseExpanded = expandedParents.has(base.id)
                                      return (
                                        <div key={base.id}>
                                          <div
                                            className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                            onClick={() => toggleParent(base.id)}
                                          >
                                            <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">
                                              {isBaseExpanded ? '▼' : '▶'}
                                            </span>
                                            <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                            <span className="flex-1 text-xs font-medium truncate text-gray-900">{base.name}</span>
                                            {base.needsVerification && (
                                              <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>
                                            )}
                                            {hasChildren ? (
                                              <span className="text-[9px] text-blue-400 shrink-0">{children.length} prep</span>
                                            ) : (
                                              <span className="text-[9px] text-gray-400 italic shrink-0">+ add prep</span>
                                            )}
                                          </div>
                                          {/* Prep items (GREEN) under this inventory item — always expandable so user can create prep items */}
                                          {isBaseExpanded && (
                                            <div className="ml-5 border-l-2 border-green-300">
                                              {children.map(prep => (
                                                <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                                  <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                                  <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                                  <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                                  {prep.needsVerification && (
                                                    <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>
                                                  )}
                                                  <button
                                                    onClick={() => addIngredient(prep.id)}
                                                    className="px-2.5 py-0.5 text-[9px] font-bold bg-green-600 text-white rounded hover:bg-green-700 active:bg-green-800 shrink-0"
                                                  >
                                                    + Add
                                                  </button>
                                                </div>
                                              ))}

                                              {/* Create prep item inline */}
                                              {creatingPrepUnderParent === base.id ? (
                                                <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                                  <input
                                                    type="text"
                                                    value={newPrepName}
                                                    onChange={(e) => setNewPrepName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') createPrepItem(base.id, category.id)
                                                      if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') }
                                                    }}
                                                    placeholder="New prep item name..."
                                                    className="w-full px-2 py-1 text-xs border rounded mb-1"
                                                    autoFocus
                                                    disabled={creatingIngredientLoading}
                                                  />
                                                  <div className="flex gap-1">
                                                    <button onClick={() => createPrepItem(base.id, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create & Add</button>
                                                    <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <button
                                                  onClick={() => setCreatingPrepUnderParent(base.id)}
                                                  className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100"
                                                  disabled={creatingIngredientLoading}
                                                >
                                                  + New prep item
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                    {/* Orphan parent groups (BLUE header with GREEN children) */}
                                    {orphanParents.map(({ item: p, parentId: pid, children }) => {
                                      const isOpExpanded = expandedParents.has(pid)
                                      return (
                                        <div key={pid}>
                                          <div
                                            className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                            onClick={() => toggleParent(pid)}
                                          >
                                            <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">
                                              {isOpExpanded ? '▼' : '▶'}
                                            </span>
                                            <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                            <span className="flex-1 text-xs font-medium truncate text-gray-900">{p?.name || 'Unknown'}</span>
                                            <span className="text-[9px] text-blue-400 shrink-0">{children.length} prep</span>
                                          </div>
                                          {isOpExpanded && (
                                            <div className="ml-5 border-l-2 border-green-300">
                                              {children.map(prep => (
                                                <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                                  <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                                  <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                                  <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                                  {prep.needsVerification && (
                                                    <span className="text-[8px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium shrink-0">⚠</span>
                                                  )}
                                                  <button
                                                    onClick={() => addIngredient(prep.id)}
                                                    className="px-2.5 py-0.5 text-[9px] font-bold bg-green-600 text-white rounded hover:bg-green-700 active:bg-green-800 shrink-0"
                                                  >
                                                    + Add
                                                  </button>
                                                </div>
                                              ))}
                                              {/* Create prep item inline for orphan parent */}
                                              {creatingPrepUnderParent === pid ? (
                                                <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                                  <input type="text" value={newPrepName} onChange={(e) => setNewPrepName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPrepItem(pid, category.id); if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') } }} placeholder="New prep item name..." className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus disabled={creatingIngredientLoading} />
                                                  <div className="flex gap-1">
                                                    <button onClick={() => createPrepItem(pid, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create & Add</button>
                                                    <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <button onClick={() => setCreatingPrepUnderParent(pid)} className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100" disabled={creatingIngredientLoading}>+ New prep item</button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}

                  {ingredients.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No ingredients linked</p>
                  ) : (
                    ingredients.map(ing => {
                      const linkedModifiers = ingredientToModifiers.get(ing.ingredientId) || []
                      const libItem = ingredientsLibrary.find(l => l.id === ing.ingredientId)
                      const isUnverified = ing.needsVerification || libItem?.needsVerification
                      const isRelinking = relinkingIngredientId === ing.ingredientId
                      const isPrepItem = !!libItem?.parentIngredientId
                      const parentName = libItem?.parentName
                      const parentId = libItem?.parentIngredientId
                      const categoryName = libItem?.categoryName || ing.category
                      return (
                        <div key={ing.ingredientId} className={`rounded border overflow-hidden ${isPrepItem ? 'border-green-200' : 'border-blue-200'}`}>
                          {/* Hierarchy breadcrumb — stepped display */}
                          <div className="px-2 pt-1.5 pb-1 bg-white">
                            <div className="flex items-center gap-0 text-[9px] leading-tight">
                              {/* Level 1: Category */}
                              {categoryName && (
                                <>
                                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-semibold">{categoryName}</span>
                                  <span className="text-gray-300 mx-0.5">›</span>
                                </>
                              )}
                              {/* Level 2: Inventory item (parent) — clickable link */}
                              {isPrepItem && parentName ? (
                                <>
                                  <a
                                    href="/ingredients"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold hover:bg-blue-200 hover:underline transition-colors cursor-pointer"
                                    title={`Open ${parentName} in Inventory`}
                                  >
                                    {parentName}
                                    <span className="text-[7px] text-blue-400">↗</span>
                                  </a>
                                  <span className="text-gray-300 mx-0.5">›</span>
                                </>
                              ) : !isPrepItem && (
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded font-semibold">{ing.name}</span>
                              )}
                              {/* Level 3: Prep item (this item) */}
                              {isPrepItem && (
                                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-semibold">{ing.name}</span>
                              )}
                            </div>
                          </div>

                          {/* Main row: Type badge + Name + actions */}
                          <div className={`flex items-center gap-1.5 px-2 py-1.5 ${isPrepItem ? 'bg-green-50' : 'bg-blue-50'}`}>
                            {/* Type badge */}
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold shrink-0 ${isPrepItem ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                              {isPrepItem ? 'PREP' : 'INV'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium truncate">{ing.name}</span>
                                {isUnverified && (
                                  <span className="text-[9px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-semibold shrink-0">
                                    ⚠ Unverified
                                  </span>
                                )}
                              </div>
                              {/* Modifier links */}
                              {linkedModifiers.length > 0 && (
                                <div className="text-[9px] text-purple-500 mt-0.5">🔗 {linkedModifiers.map(lm => lm.modName).join(', ')}</div>
                              )}
                            </div>
                            {/* Relink button */}
                            <button
                              onClick={() => {
                                if (isRelinking) {
                                  setRelinkingIngredientId(null)
                                  setIngredientSearch('')
                                } else {
                                  setRelinkingIngredientId(ing.ingredientId)
                                  setIngredientSearch('')
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isRelinking ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                              title={isRelinking ? 'Close picker' : 'Change linked ingredient'}
                            >
                              {isRelinking ? '✕ Close' : '🔗 Relink'}
                            </button>
                            {/* Unlink button — removes this ingredient from the item (with confirmation) */}
                            <button
                              onClick={() => {
                                if (confirm(`Unlink "${ing.name}" from this item?`)) {
                                  removeIngredient(ing.ingredientId)
                                  toast.success(`Unlinked ${ing.name}`)
                                }
                              }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-red-100 text-red-600 hover:bg-red-200 active:bg-red-300"
                              title="Unlink this ingredient from the item"
                            >
                              Unlink
                            </button>
                          </div>

                          {/* Inline relink picker — swap this ingredient for a different one */}
                          {isRelinking && (
                            <div className="p-2 border-2 border-blue-400 rounded bg-white">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="text-[10px] font-bold text-blue-700 uppercase">Relink to:</span>
                                <span className="text-[10px] text-gray-400 flex-1">expand → tap Link</span>
                                <button
                                  onClick={() => { setRelinkingIngredientId(null); setIngredientSearch('') }}
                                  className="text-xs text-gray-400 hover:text-red-500 px-1"
                                >✕</button>
                              </div>
                              <input
                                type="text"
                                value={ingredientSearch}
                                onChange={(e) => setIngredientSearch(e.target.value)}
                                placeholder="Search ingredients..."
                                className="w-full px-2 py-1 text-xs border rounded mb-1.5"
                                autoFocus
                              />
                              <div className="max-h-64 overflow-y-auto space-y-0.5">
                                {(() => {
                                  const hierarchy = buildHierarchy(ingredientSearch)
                                  const sortedCats = Object.values(hierarchy).sort((a, b) =>
                                    a.category.sortOrder - b.category.sortOrder
                                  )
                                  const alreadyAddedIds = new Set(ingredients.map(i => i.ingredientId))
                                  const excludeId = ing.ingredientId

                                  if (sortedCats.length === 0) {
                                    return (
                                      <div className="text-xs text-gray-400 text-center py-2">
                                        {ingredientSearch ? 'No matching ingredients' : 'No categories'}
                                      </div>
                                    )
                                  }

                                  return sortedCats.map(({ category, baseIngredients: catBase, parents }) => {
                                    const catExpanded = expandedCategories.has(category.id)

                                    // Build unified list: each inventory item + its prep children
                                    // An inventory item can be in baseIngredients AND be a parent key
                                    const inventoryItems = catBase
                                      .filter(b => b.id !== excludeId)
                                      .sort((a, b) => a.name.localeCompare(b.name))
                                      .map(base => ({
                                        item: base,
                                        children: (parents[base.id]?.prepItems || [])
                                          .filter(pr => pr.id !== excludeId && !alreadyAddedIds.has(pr.id))
                                          .sort((a, b) => a.name.localeCompare(b.name)),
                                      }))

                                    // Also include parent groups whose parent isn't in baseIngredients
                                    // (orphaned prep items — their parent might be in a different category or filtered out)
                                    const baseIds = new Set(catBase.map(b => b.id))
                                    const orphanParents = Object.entries(parents)
                                      .filter(([pid]) => !baseIds.has(pid))
                                      .map(([pid, { parent: p, prepItems }]) => ({
                                        item: p,
                                        parentId: pid,
                                        children: prepItems
                                          .filter(pr => pr.id !== excludeId && !alreadyAddedIds.has(pr.id))
                                          .sort((a, b) => a.name.localeCompare(b.name)),
                                      }))
                                      .filter(g => g.children.length > 0)
                                      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))

                                    // Count available items
                                    const totalAvailable = inventoryItems.filter(iv => !alreadyAddedIds.has(iv.item.id)).length
                                      + inventoryItems.reduce((sum, iv) => sum + iv.children.length, 0)
                                      + orphanParents.reduce((sum, op) => sum + op.children.length, 0)

                                    if (totalAvailable === 0 && inventoryItems.length === 0 && orphanParents.length === 0) return null

                                    return (
                                      <div key={category.id}>
                                        {/* Category header — collapsed by default */}
                                        <button
                                          onClick={() => toggleCategory(category.id)}
                                          className="w-full flex items-center gap-1 text-[10px] font-bold text-gray-700 uppercase tracking-wider px-2 py-1.5 bg-gray-100 sticky top-0 border-b border-gray-200"
                                        >
                                          <span>{catExpanded ? '▼' : '▶'}</span>
                                          <span className="flex-1 text-left">{category.name}</span>
                                          <span className="text-[9px] text-gray-400 font-normal">{totalAvailable}</span>
                                        </button>
                                        {catExpanded && (
                                          <div>
                                            {/* Inventory items (BLUE) — expand only, not directly linkable */}
                                            {inventoryItems.map(({ item: base, children }) => {
                                              const hasChildren = children.length > 0
                                              const isBaseExpanded = expandedParents.has(base.id)
                                              return (
                                                <div key={base.id}>
                                                  <div
                                                    className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                                    onClick={() => toggleParent(base.id)}
                                                  >
                                                    <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">
                                                      {isBaseExpanded ? '▼' : '▶'}
                                                    </span>
                                                    <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                                    <span className="flex-1 text-xs font-medium truncate text-gray-900">{base.name}</span>
                                                    {hasChildren ? (
                                                      <span className="text-[9px] text-blue-400 shrink-0">{children.length} prep</span>
                                                    ) : (
                                                      <span className="text-[9px] text-gray-400 italic shrink-0">+ add prep</span>
                                                    )}
                                                  </div>
                                                  {/* Prep items (GREEN) under this inventory item — always expandable */}
                                                  {isBaseExpanded && (
                                                    <div className="ml-5 border-l-2 border-green-300">
                                                      {children.map(prep => (
                                                        <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                                          <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                                          <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                                          <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                                          <button
                                                            onClick={() => swapIngredientLink(ing.ingredientId, prep.id)}
                                                            className="px-2.5 py-0.5 text-[9px] font-bold bg-green-600 text-white rounded hover:bg-green-700 active:bg-green-800 shrink-0"
                                                          >
                                                            Link
                                                          </button>
                                                        </div>
                                                      ))}
                                                      {/* Create prep item inline for relink */}
                                                      {creatingPrepUnderParent === base.id ? (
                                                        <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                                          <input type="text" value={newPrepName} onChange={(e) => setNewPrepName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPrepItem(base.id, category.id); if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') } }} placeholder="New prep item name..." className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus disabled={creatingIngredientLoading} />
                                                          <div className="flex gap-1">
                                                            <button onClick={() => createPrepItem(base.id, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create</button>
                                                            <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                                          </div>
                                                        </div>
                                                      ) : (
                                                        <button onClick={() => setCreatingPrepUnderParent(base.id)} className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100" disabled={creatingIngredientLoading}>+ New prep item</button>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              )
                                            })}
                                            {/* Orphan parent groups — inventory items not in this category's base list (BLUE) */}
                                            {orphanParents.map(({ item: p, parentId: pid, children }) => {
                                              const isOpExpanded = expandedParents.has(pid)
                                              return (
                                                <div key={pid}>
                                                  <div
                                                    className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 border-b border-blue-100 hover:bg-blue-100 cursor-pointer"
                                                    onClick={() => toggleParent(pid)}
                                                  >
                                                    <span className="w-5 h-5 flex items-center justify-center text-[10px] text-blue-500 shrink-0">
                                                      {isOpExpanded ? '▼' : '▶'}
                                                    </span>
                                                    <span className="text-[8px] px-1 py-0.5 bg-blue-600 text-white rounded font-bold shrink-0">INV</span>
                                                    <span className="flex-1 text-xs font-medium truncate text-gray-900">{p?.name || 'Unknown'}</span>
                                                    <span className="text-[9px] text-blue-400 shrink-0">{children.length} prep</span>
                                                  </div>
                                                  {isOpExpanded && (
                                                    <div className="ml-5 border-l-2 border-green-300">
                                                      {children.map(prep => (
                                                        <div key={prep.id} className="flex items-center gap-1 px-2 py-1.5 bg-green-50 border-b border-green-100 hover:bg-green-100">
                                                          <span className="w-5 h-5 flex items-center justify-center text-[10px] text-green-400 shrink-0">·</span>
                                                          <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
                                                          <span className="flex-1 text-xs truncate text-gray-700">{prep.name}</span>
                                                          <button
                                                            onClick={() => swapIngredientLink(ing.ingredientId, prep.id)}
                                                            className="px-2.5 py-0.5 text-[9px] font-bold bg-green-600 text-white rounded hover:bg-green-700 active:bg-green-800 shrink-0"
                                                          >
                                                            Link
                                                          </button>
                                                        </div>
                                                      ))}
                                                      {/* Create prep item inline for orphan parent in relink */}
                                                      {creatingPrepUnderParent === pid ? (
                                                        <div className="px-3 py-2 bg-green-50 border-b border-green-200">
                                                          <input type="text" value={newPrepName} onChange={(e) => setNewPrepName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createPrepItem(pid, category.id); if (e.key === 'Escape') { setCreatingPrepUnderParent(null); setNewPrepName('') } }} placeholder="New prep item name..." className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus disabled={creatingIngredientLoading} />
                                                          <div className="flex gap-1">
                                                            <button onClick={() => createPrepItem(pid, category.id)} className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={!newPrepName.trim() || creatingIngredientLoading}>Create</button>
                                                            <button onClick={() => { setCreatingPrepUnderParent(null); setNewPrepName('') }} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400" disabled={creatingIngredientLoading}>Cancel</button>
                                                          </div>
                                                        </div>
                                                      ) : (
                                                        <button onClick={() => setCreatingPrepUnderParent(pid)} className="w-full text-left px-3 py-1 text-[10px] text-green-600 hover:bg-green-100" disabled={creatingIngredientLoading}>+ New prep item</button>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Row 2: Pre-modifier toggles + extra price */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowNo')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowNo ? 'bg-red-500 text-white border-red-500' : 'bg-red-50 text-red-300 border-red-200'}`}
                              title="Allow NO"
                            >
                              No
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowLite')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowLite ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-yellow-50 text-yellow-300 border-yellow-200'}`}
                              title="Allow LITE"
                            >
                              Lite
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowOnSide')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowOnSide ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-50 text-blue-300 border-blue-200'}`}
                              title="Allow ON SIDE"
                            >
                              Side
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowExtra')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowExtra ? 'bg-green-500 text-white border-green-500' : 'bg-green-50 text-green-300 border-green-200'}`}
                              title="Allow EXTRA"
                            >
                              Extra
                            </button>
                            {ing.allowExtra && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-green-600">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  defaultValue={ing.extraPrice}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value) || 0
                                    if (val !== ing.extraPrice) updateExtraPrice(ing.ingredientId, val)
                                  }}
                                  className="w-14 px-1 py-0 text-[10px] border rounded text-center"
                                />
                              </span>
                            )}
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowSwap')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowSwap ? 'bg-purple-500 text-white border-purple-500' : 'bg-purple-50 text-purple-300 border-purple-200'}`}
                              title="Allow SWAP"
                            >
                              Swap
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {/* MODIFIER GROUPS - Interactive Editor */}
            <div className="border-b">
              <div className="px-4 py-3 bg-indigo-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-indigo-900">⚙️ Modifier Groups</span>
                  <span className="text-sm text-indigo-600">({modifierGroups.length})</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-indigo-600 text-xs"
                  onClick={() => setShowNewGroupForm(true)}
                  disabled={saving}
                >
                  + Add Group
                </Button>
              </div>

              {/* New Group Form */}
              {showNewGroupForm && (
                <div className="p-2 border-b bg-indigo-50/50">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name"
                    className="w-full px-2 py-1 text-sm border rounded mb-2"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim() || saving}>
                      Create
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowNewGroupForm(false); setNewGroupName('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Groups List — filter out child groups (they render nested under parent modifier) */}
              <div className="p-3 space-y-2">
                {/* Drop zone to promote a child group to top-level */}
                {draggedGroupId && (() => {
                  const childGroupIdSet = new Set<string>()
                  modifierGroups.forEach(g => {
                    g.modifiers.forEach(m => {
                      if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
                    })
                  })
                  const isChild = childGroupIdSet.has(draggedGroupId)
                  if (!isChild) return null
                  return (
                    <div
                      className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === 'top-level' ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 text-gray-400'}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDropZone('top-level') }}
                      onDragLeave={() => setDragOverDropZone(null)}
                      onDrop={async (e) => {
                        e.preventDefault()
                        if (draggedGroupId) {
                          await reparentGroup(draggedGroupId, null)
                        }
                        setDraggedGroupId(null)
                        setDragOverGroupId(null)
                        setDragOverDropZone(null)
                      }}
                    >
                      ⬆ Drop here to promote to top-level
                    </div>
                  )
                })()}
                {(() => {
                  // Build set of child group IDs so we can exclude them from the top-level list
                  const childGroupIdSet = new Set<string>()
                  modifierGroups.forEach(g => {
                    g.modifiers.forEach(m => {
                      if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
                    })
                  })
                  const topLevelGroups = modifierGroups.filter(g => !childGroupIdSet.has(g.id))

                  return topLevelGroups.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No modifier groups</p>
                  ) : (
                    topLevelGroups.map(group => {
                    const isExpanded = expandedGroups.has(group.id)
                    const isEmpty = group.modifiers.length === 0
                    const childModCount = group.modifiers.filter(m => m.childModifierGroupId).length

                    return (
                      <div
                        key={group.id}
                        className={`border-2 border-indigo-300 rounded-lg overflow-hidden shadow-sm ${group.isRequired ? 'border-l-4 border-l-red-400' : ''} ${draggedGroupId === group.id ? 'opacity-50' : ''} ${dragOverGroupId === group.id && draggedGroupId !== group.id ? 'ring-2 ring-indigo-400' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDraggedGroupId(group.id)
                          e.dataTransfer.effectAllowed = 'copyMove'
                          // Set data for cross-item copy
                          e.dataTransfer.setData('application/x-modifier-group', JSON.stringify({
                            groupId: group.id,
                            sourceItemId: item.id,
                            groupName: group.name,
                          }))
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverGroupId(group.id)
                        }}
                        onDragLeave={() => setDragOverGroupId(null)}
                        onDrop={(e) => handleGroupDrop(e, group.id)}
                        onDragEnd={() => {
                          setDraggedGroupId(null)
                          setDragOverGroupId(null)
                          setDragOverDropZone(null)
                        }}
                      >
                        {/* Group Header - click to expand */}
                        <div
                          className="px-3 py-2 bg-indigo-100 border-b border-indigo-200 flex items-center gap-2 cursor-pointer hover:bg-indigo-150 transition-colors"
                          onClick={() => {
                            toggleExpanded(group.id)
                            onSelectGroup?.(isExpanded ? null : group.id)
                          }}
                        >
                          <span className="cursor-grab text-gray-400 hover:text-gray-600 mr-1" title="Drag to reorder">⠿</span>
                          <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          {renamingGroupId === group.id ? (
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => commitRename(group.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename(group.id)
                                if (e.key === 'Escape') { setRenamingGroupId(null); setRenameValue('') }
                              }}
                              className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className="flex-1 font-medium text-sm truncate"
                              onDoubleClick={(e) => { e.stopPropagation(); startRename(group.id, group.name) }}
                              title="Double-click to rename"
                            >
                              {group.name}
                            </span>
                          )}
                          {/* Settings badges — always visible in header */}
                          <span className="ml-auto text-[9px] text-gray-400 flex items-center gap-1 shrink-0">
                            <span className="px-1 py-0.5 bg-gray-100 rounded">{group.minSelections}-{group.maxSelections}</span>
                            {group.isRequired && <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">Req</span>}
                            {group.allowStacking && <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 rounded">Stack</span>}
                            {(() => {
                              const defaults = group.modifiers.filter(m => m.isDefault)
                              if (defaults.length === 0) return null
                              return <span className="px-1 py-0.5 bg-amber-100 text-amber-700 rounded">★{defaults.length}</span>
                            })()}
                          </span>
                          {childModCount > 0 && <span className="text-[9px] px-1 bg-indigo-100 text-indigo-600 rounded">{childModCount}▶</span>}
                          <span className="text-xs text-gray-400">{group.modifiers.length}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(group.id, group.name) }}
                            className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
                            title="Rename"
                            disabled={saving}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateGroup(group.id) }}
                            className="text-gray-400 hover:text-indigo-600 text-xs px-1"
                            title="Duplicate Group"
                            disabled={saving}
                          >
                            ⧉
                          </button>
                        </div>

                        {/* Expanded: Modifiers */}
                        {isExpanded && (
                          <div className="border-t" draggable={false} onDragStart={(e) => e.stopPropagation()}>

                            {/* Modifier rows */}
                            <div className="p-2 space-y-1">
                              {isEmpty && (
                                <div className="text-center text-gray-400 text-xs py-2 italic">
                                  Add modifiers to get started
                                </div>
                              )}
                              {group.modifiers.map((mod, idx) => renderModifierRow(group.id, mod, 0, idx))}

                              {/* Drop zone: nest a group inside this group */}
                              {draggedGroupId && draggedGroupId !== group.id && !isDescendantOf(draggedGroupId, group.id) && (
                                <div
                                  className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === `nest-${group.id}` ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-400'}`}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDropZone(`nest-${group.id}`) }}
                                  onDragLeave={() => setDragOverDropZone(null)}
                                  onDrop={async (e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (draggedGroupId) {
                                      await nestGroupInGroup(draggedGroupId, group.id)
                                    }
                                    setDraggedGroupId(null)
                                    setDragOverGroupId(null)
                                    setDragOverDropZone(null)
                                  }}
                                >
                                  ⬇ Drop here to nest inside {group.name}
                                </div>
                              )}

                              {/* Add modifier form */}
                              {addingModifierTo === group.id ? (
                                <div className="flex gap-1 mt-2">
                                  <input
                                    type="text"
                                    value={newModName}
                                    onChange={(e) => setNewModName(e.target.value)}
                                    placeholder="Name"
                                    className="flex-1 px-2 py-1 text-xs border rounded"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (addingType === 'choice') {
                                          addChoice(group.id)
                                        } else {
                                          addModifier(group.id)
                                        }
                                      }
                                    }}
                                  />
                                  {addingType === 'item' && (
                                    <input
                                      type="number"
                                      value={newModPrice}
                                      onChange={(e) => setNewModPrice(e.target.value)}
                                      placeholder="$"
                                      className="w-14 px-2 py-1 text-xs border rounded"
                                      step="0.01"
                                      min="0"
                                    />
                                  )}
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => addingType === 'choice' ? addChoice(group.id) : addModifier(group.id)}
                                    disabled={!newModName.trim() || saving}
                                  >
                                    +
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setAddingType(null); setNewModName(''); setNewModPrice('') }}>
                                    ×
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { setAddingModifierTo(group.id); setAddingType('item') }}
                                    className="flex-1 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                                    disabled={saving}
                                  >
                                    + Add Item
                                  </button>
                                  <button
                                    onClick={() => { setAddingModifierTo(group.id); setAddingType('choice') }}
                                    className="flex-1 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded border border-dashed border-amber-300"
                                    disabled={saving}
                                  >
                                    + Add Choice
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                  )
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
