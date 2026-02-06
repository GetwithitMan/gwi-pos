'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface Ingredient {
  id: string
  ingredientId: string
  name: string
  isIncluded: boolean
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  allowSwap: boolean
  extraPrice: number
}

interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
  categoryName?: string | null      // NEW: from categoryRelation.name
  categoryId?: string | null        // NEW: actual category relation ID
  parentIngredientId?: string | null // NEW: to identify child items
  parentName?: string | null        // NEW: parent ingredient's name for sub-headers
  needsVerification?: boolean       // NEW: verification flag
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
  onToggle86?: (item: MenuItem) => void
  onDelete?: (itemId: string) => void
  refreshKey?: number
  onSelectGroup?: (groupId: string | null) => void
}

export function ItemEditor({ item, ingredientsLibrary, ingredientCategories = [], locationId = '', onItemUpdated, onToggle86, onDelete, refreshKey, onSelectGroup }: ItemEditorProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Collapse states
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  // Forms
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)
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
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [addingType, setAddingType] = useState<'item' | 'choice' | null>(null)
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null)
  const [editModValues, setEditModValues] = useState<{ name: string; price: string; extraPrice: string }>({ name: '', price: '', extraPrice: '' })
  const [draggedModifierId, setDraggedModifierId] = useState<string | null>(null)
  const [dragOverModifierId, setDragOverModifierId] = useState<string | null>(null)

  // Load data when item changes or refreshKey updates
  useEffect(() => {
    if (!item?.id) {
      setIngredients([])
      setModifierGroups([])
      return
    }
    loadData()
  }, [item?.id, refreshKey])

  const loadData = async () => {
    if (!item?.id) return
    setLoading(true)
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
      setLoading(false)
    }
  }

  // Ingredient functions
  const saveIngredients = async (newIngredients: typeof ingredients) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/ingredients`, {
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
            allowSwap: i.allowSwap,
            extraPrice: i.extraPrice,
          }))
        }),
      })
      await loadData()
      onItemUpdated()
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
      id: '', ingredientId, name: lib.name, isIncluded: true,
      allowNo: true, allowLite: true, allowExtra: true, allowOnSide: true, allowSwap: true, extraPrice: 0,
    }]
    saveIngredients(newIngredients)
    setShowIngredientPicker(false)
    setIngredientSearch('')
  }

  const removeIngredient = (ingredientId: string) => {
    saveIngredients(ingredients.filter(i => i.ingredientId !== ingredientId))
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
      onItemUpdated()
    } catch (e) {
      console.error('Failed to create group:', e)
      toast.error('Failed to create modifier group')
    } finally {
      setSaving(false)
    }
  }

  const updateGroup = async (groupId: string, updates: Partial<ModifierGroup>) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to update group:', e)
      toast.error('Failed to update modifier group')
    } finally {
      setSaving(false)
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
    if (!item?.id || !confirm('Delete this modifier group?')) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}`, { method: 'DELETE' })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to delete group:', e)
      toast.error('Failed to delete modifier group')
    } finally {
      setSaving(false)
    }
  }

  const duplicateGroup = async (groupId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateFromGroupId: groupId }),
      })
      await loadData()
      onItemUpdated()
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
      await fetch(`/api/menu/items/${item.id}/modifier-groups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sortOrders: reordered.map((g, i) => ({ id: g.id, sortOrder: i })),
        }),
      })
      onItemUpdated()
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
      onItemUpdated()
    } catch (e) {
      console.error('Failed to reorder modifiers:', e)
      toast.error('Failed to reorder modifiers')
      await loadData() // rollback
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
      onItemUpdated()
    } catch (e) {
      console.error('Failed to add modifier:', e)
      toast.error('Failed to add modifier')
    } finally {
      setSaving(false)
    }
  }

  const updateModifier = async (groupId: string, modifierId: string, updates: Partial<Modifier>) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId, ...updates }),
      })
      await loadData()
      onItemUpdated()
    } catch (e) {
      console.error('Failed to update modifier:', e)
      toast.error('Failed to update modifier')
    } finally {
      setSaving(false)
    }
  }

  const deleteModifier = async (groupId: string, modifierId: string) => {
    if (!item?.id) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${item.id}/modifier-groups/${groupId}/modifiers?modifierId=${modifierId}`, {
        method: 'DELETE',
      })
      await loadData()
      onItemUpdated()
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
      onItemUpdated()
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
      onItemUpdated()
    } catch (e) {
      console.error('Failed to add choice:', e)
      toast.error('Failed to add choice')
    } finally {
      setSaving(false)
    }
  }

  const linkIngredient = async (groupId: string, modifierId: string, ingredientId: string | null) => {
    await updateModifier(groupId, modifierId, { ingredientId })
    setLinkingModifier(null)
    setModIngredientSearch('')
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
        const error = await response.json()
        toast.error(error.error || 'Failed to create ingredient')
        return
      }

      const { data } = await response.json()
      onItemUpdated()  // Refresh parent's ingredient library
      setNewInventoryName('')
      setCreatingInventoryInCategory(null)
      toast.success(`Created "${data.name}" - pending verification`)
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
        const error = await response.json()
        toast.error(error.error || 'Failed to create prep item')
        return
      }

      const { data } = await response.json()
      onItemUpdated()

      // Auto-link to modifier
      if (linkingModifier) {
        await linkIngredient(linkingModifier.groupId, linkingModifier.modId, data.id)
      }

      setNewPrepName('')
      setCreatingPrepUnderParent(null)
      toast.success(`Created "${data.name}" and linked - pending verification`)
    } catch (error) {
      console.error('Error creating prep item:', error)
      toast.error('Failed to create prep item')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  // Helper to render a choice row (navigation modifier with child group)
  const renderChoiceRow = (groupId: string, mod: Modifier, depth: number = 0) => {
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
        {childGroup && renderChildGroup(childGroup, depth + 1)}
      </div>
    )
  }

  // Helper to render a modifier row with all controls
  const renderModifierRow = (groupId: string, mod: Modifier, depth: number = 0) => {
    // If this is a choice (label with child group), render it differently
    if (mod.isLabel && mod.childModifierGroupId) {
      return renderChoiceRow(groupId, mod, depth)
    }

    const isLinking = linkingModifier?.groupId === groupId && linkingModifier?.modId === mod.id
    const filteredIngredients = ingredientsLibrary.filter(ing =>
      ing.parentIngredientId &&  // ONLY prep items (children)
      ing.name.toLowerCase().includes(modIngredientSearch.toLowerCase())
    )

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
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white border rounded text-sm">
          <span className="cursor-grab text-gray-300 hover:text-gray-500 text-xs" title="Drag to reorder">⠿</span>
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
              className="flex-1 px-1 py-0.5 text-sm border rounded bg-white min-w-0"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="flex-1 truncate cursor-pointer hover:text-indigo-600"
              onDoubleClick={() => startEditModifier(mod)}
              title="Double-click to edit"
            >
              {mod.name}
            </span>
          )}

          {/* Ingredient Link Badge */}
          {mod.ingredientId && mod.ingredientName && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1">
              🔗 {mod.ingredientName}
              <button
                onClick={() => linkIngredient(groupId, mod.id, null)}
                className="hover:text-purple-900"
              >
                ×
              </button>
            </span>
          )}

          {/* Link Ingredient Button */}
          <button
            onClick={() => setLinkingModifier(isLinking ? null : { groupId, modId: mod.id })}
            className={`w-5 h-5 rounded text-xs ${isLinking ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
            title="Link Ingredient"
          >
            🔗
          </button>

          {/* Pre-modifier toggles */}
          <div className="flex gap-0.5">
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowNo: !mod.allowNo })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-400'}`}
            >
              N
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowLite: !mod.allowLite })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-400'}`}
            >
              L
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowOnSide: !mod.allowOnSide })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-400'}`}
            >
              S
            </button>
            <button
              onClick={() => updateModifier(groupId, mod.id, { allowExtra: !mod.allowExtra })}
              className={`w-5 h-5 rounded text-[9px] font-bold ${mod.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-400'}`}
            >
              E
            </button>
          </div>

          {editingModifierId === mod.id ? (
            <div className="flex items-center gap-0.5">
              <span className="text-[9px] text-gray-500">$</span>
              <input
                type="number"
                value={editModValues.price}
                onChange={(e) => setEditModValues(prev => ({ ...prev, price: e.target.value }))}
                onBlur={() => commitEditModifier(groupId, mod.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                  if (e.key === 'Escape') setEditingModifierId(null)
                }}
                className="w-14 px-1 py-0.5 text-xs border rounded text-center"
                step="0.01"
                min="0"
              />
            </div>
          ) : (
            <span
              className="text-xs text-green-600 cursor-pointer hover:underline"
              onDoubleClick={() => startEditModifier(mod)}
              title="Double-click to edit price"
            >
              {mod.price > 0 ? `+${formatCurrency(mod.price)}` : '$0'}
            </span>
          )}

          {editingModifierId === mod.id && mod.allowExtra && (
            <div className="flex items-center gap-0.5">
              <span className="text-[9px] text-gray-500">E$</span>
              <input
                type="number"
                value={editModValues.extraPrice}
                onChange={(e) => setEditModValues(prev => ({ ...prev, extraPrice: e.target.value }))}
                onBlur={() => commitEditModifier(groupId, mod.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                  if (e.key === 'Escape') setEditingModifierId(null)
                }}
                className="w-14 px-1 py-0.5 text-xs border rounded text-center"
                step="0.01"
                min="0"
              />
            </div>
          )}

          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs"
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
                const hierarchy = buildHierarchy()
                const sortedCategories = Object.values(hierarchy).sort((a, b) =>
                  a.category.sortOrder - b.category.sortOrder
                )

                if (sortedCategories.length === 0) {
                  return (
                    <div className="text-xs text-gray-400 text-center py-2">
                      {modIngredientSearch ? 'No matching prep items' : 'No ingredient categories found'}
                    </div>
                  )
                }

                return sortedCategories.map(({ category, parents }) => {
                  const isExpanded = expandedCategories.has(category.id)
                  const hasItems = Object.keys(parents).length > 0

                  return (
                    <div key={category.id}>
                      {/* Category Header */}
                      <div className="flex items-center gap-1 text-[10px] font-bold text-purple-800 uppercase tracking-wider px-2 py-1.5 bg-purple-100 sticky top-0 border-b border-purple-200">
                        <button
                          onClick={() => toggleCategory(category.id)}
                          className="hover:bg-purple-200 rounded px-1"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                        <span className="flex-1">{category.name}</span>
                        <button
                          onClick={() => setCreatingInventoryInCategory(category.id)}
                          className="ml-auto text-purple-600 hover:text-purple-800 hover:bg-purple-200 rounded px-1"
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
                        <div className="px-4 py-2 bg-purple-50 border-b border-purple-200">
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
                              className="flex-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
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
                          {Object.entries(parents)
                            .sort(([, a], [, b]) => {
                              const nameA = a.parent?.name || ''
                              const nameB = b.parent?.name || ''
                              return nameA.localeCompare(nameB)
                            })
                            .map(([parentId, { parent, prepItems }]) => {
                              const isParentExpanded = expandedParents.has(parentId)

                              return (
                                <div key={parentId}>
                                  {/* Parent/Inventory Item Sub-Header */}
                                  <div className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 px-3 py-1 bg-gray-50">
                                    <button
                                      onClick={() => toggleParent(parentId)}
                                      className="hover:bg-gray-200 rounded px-1"
                                    >
                                      {isParentExpanded ? '▼' : '▶'}
                                    </button>
                                    <span className="text-gray-400">🏷</span>
                                    <span className="flex-1">{parent?.name || 'Unknown'}</span>
                                    <button
                                      onClick={() => setCreatingPrepUnderParent(parentId)}
                                      className="ml-auto text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded px-1"
                                      title="Create new prep item"
                                      disabled={creatingIngredientLoading}
                                    >
                                      {creatingIngredientLoading && creatingPrepUnderParent === parentId ? (
                                        <span className="animate-spin">⏳</span>
                                      ) : (
                                        '+'
                                      )}
                                    </button>
                                  </div>

                                  {/* Inline Prep Item Creation Form */}
                                  {creatingPrepUnderParent === parentId && (
                                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                                      <input
                                        type="text"
                                        value={newPrepName}
                                        onChange={(e) => setNewPrepName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') createPrepItem(parentId, category.id)
                                          if (e.key === 'Escape') {
                                            setCreatingPrepUnderParent(null)
                                            setNewPrepName('')
                                          }
                                        }}
                                        placeholder="New prep item name..."
                                        className="w-full px-2 py-1 text-xs border rounded mb-1"
                                        autoFocus
                                        disabled={creatingIngredientLoading}
                                      />
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => createPrepItem(parentId, category.id)}
                                          className="flex-1 px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                                          disabled={!newPrepName.trim() || creatingIngredientLoading}
                                        >
                                          Create & Link
                                        </button>
                                        <button
                                          onClick={() => {
                                            setCreatingPrepUnderParent(null)
                                            setNewPrepName('')
                                          }}
                                          className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                          disabled={creatingIngredientLoading}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Prep Items (Clickable) */}
                                  {isParentExpanded && (
                                    <div>
                                      {prepItems
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map(prep => (
                                          <button
                                            key={prep.id}
                                            onClick={() => {
                                              if (linkingModifier) {
                                                linkIngredient(linkingModifier.groupId, linkingModifier.modId, prep.id)
                                              }
                                            }}
                                            className="w-full text-left px-4 py-1 text-xs hover:bg-purple-100 rounded flex justify-between items-center"
                                          >
                                            <span>{prep.name}</span>
                                            {prep.needsVerification && (
                                              <span className="text-[9px] text-red-600 font-semibold">⚠ Unverified</span>
                                            )}
                                          </button>
                                        ))
                                      }
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

        {/* Render Child Group Recursively */}
        {mod.childModifierGroup && renderChildGroup(mod.childModifierGroup, depth + 1)}
      </div>
    )
  }

  // Helper to render child modifier groups recursively
  const renderChildGroup = (childGroup: ModifierGroup, depth: number = 1) => {
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
    const depthIndent: Record<number, string> = {
      0: 'ml-0',
      1: 'ml-4',
      2: 'ml-8',
      3: 'ml-12',
      4: 'ml-16',
    }
    const indentClass = `${depthIndent[depth] ?? 'ml-16'} pl-3 border-l-2 border-indigo-200`

    return (
      <div key={childGroup.id} className={`mt-2 ${indentClass}`}>
        <div className="text-xs text-gray-500 mb-1">After selecting parent modifier:</div>
        <div className={`border rounded-lg overflow-hidden ${childGroup.isRequired ? 'border-l-4 border-red-400' : ''} ${isEmpty ? 'border-dashed' : ''}`}>
          {/* Child Group Header */}
          {/* Child Group Header */}
          <div className="px-3 py-2 bg-gray-50 flex items-center gap-2">
            {/* Expand/collapse toggle */}
            <button
              onClick={() => {
                toggleExpanded(childGroup.id)
                onSelectGroup?.(isExpanded ? null : childGroup.id)
              }}
              className="flex-shrink-0"
            >
              <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''} ${childGroup.isRequired && isEmpty ? 'text-red-500' : isEmpty ? 'text-gray-300' : 'text-green-500'}`}>
                ▶
              </span>
            </button>

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
                className="flex-1 font-medium text-sm truncate cursor-pointer hover:text-indigo-600"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); startRename(childGroup.id, childGroup.name) }}
                title="Double-click to rename"
              >
                {childGroup.name}
              </span>
            )}

            <span className="text-xs text-gray-400">{childGroup.modifiers.length}</span>

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
              {/* Compact settings summary - edit in right panel */}
              <div className="px-3 py-1.5 bg-gray-50/50 border-b text-xs text-gray-400 flex items-center justify-between">
                <span>
                  {childGroup.minSelections}-{childGroup.maxSelections} selections
                  {childGroup.isRequired && <span className="ml-1 text-red-500 font-medium">· Required</span>}
                  {childGroup.allowStacking && <span className="ml-1 text-yellow-600">· Stacking</span>}
                </span>
                <span className="text-gray-300">Edit in panel →</span>
              </div>

              {/* Child Modifiers */}
              <div className="p-2 space-y-1">
                {isEmpty && (
                  <div className="text-center text-gray-400 text-xs py-2 italic">
                    Add modifiers to get started
                  </div>
                )}
                {childGroup.modifiers.map(mod => renderModifierRow(childGroup.id, mod, depth))}

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
  const buildHierarchy = () => {
    const hierarchy: Record<string, {
      category: IngredientCategory
      parents: Record<string, {
        parent: IngredientLibraryItem | null
        prepItems: IngredientLibraryItem[]
      }>
    }> = {}

    // Filter prep items based on search
    const filteredPrepItems = modIngredientSearch.trim()
      ? ingredientsLibrary.filter(
          ing =>
            ing.parentIngredientId &&
            ing.name.toLowerCase().includes(modIngredientSearch.toLowerCase())
        )
      : ingredientsLibrary.filter(ing => ing.parentIngredientId)

    // Get relevant category IDs
    const relevantCategoryIds = modIngredientSearch.trim()
      ? new Set(filteredPrepItems.map(p => p.categoryId).filter(Boolean) as string[])
      : new Set(ingredientCategories.map(c => c.id))

    // Initialize categories
    ingredientCategories
      .filter(cat => cat.isActive && (relevantCategoryIds.size === 0 || relevantCategoryIds.has(cat.id)))
      .forEach(cat => {
        hierarchy[cat.id] = { category: cat, parents: {} }
      })

    // Group prep items by category and parent
    filteredPrepItems.forEach(prep => {
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

  // Auto-expand on search
  useEffect(() => {
    if (modIngredientSearch.trim()) {
      const hierarchy = buildHierarchy()
      const categoriesToExpand = new Set<string>()
      const parentsToExpand = new Set<string>()

      Object.entries(hierarchy).forEach(([catId, catData]) => {
        if (Object.keys(catData.parents).length > 0) {
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
          <div>
            <h2 className="text-xl font-bold">{item.name}</h2>
            <p className="text-2xl font-bold mt-1">{formatCurrency(item.price)}</p>
          </div>
          <div className="flex gap-2">
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
                  {(() => {
                    const customizableCount = ingredients.filter(i => i.allowNo || i.allowLite || i.allowExtra || i.allowOnSide || i.allowSwap).length
                    return customizableCount > 0 ? (
                      <span className="text-xs text-green-500">· {customizableCount} customizable</span>
                    ) : null
                  })()}
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
                  {/* Ingredient Picker */}
                  {showIngredientPicker && (
                    <div className="p-2 border rounded bg-green-50/50 mb-2">
                      <input
                        type="text"
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        placeholder="Search ingredients..."
                        className="w-full px-2 py-1 text-sm border rounded mb-2"
                        autoFocus
                      />
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(() => {
                          const limited = filteredLibrary.slice(0, 12)
                          const grouped = limited.reduce((acc, lib) => {
                            const cat = lib.categoryName || lib.category || 'Other'
                            if (!acc[cat]) acc[cat] = []
                            acc[cat].push(lib)
                            return acc
                          }, {} as Record<string, typeof limited>)
                          return Object.entries(grouped).map(([category, items]) => (
                            <div key={category}>
                              <div className="text-xs font-semibold text-green-700 px-2 py-1">{category}</div>
                              {items.map(lib => (
                                <button
                                  key={lib.id}
                                  onClick={() => addIngredient(lib.id)}
                                  className="w-full text-left px-2 py-1 text-sm hover:bg-green-100 rounded"
                                >
                                  {lib.name}
                                </button>
                              ))}
                            </div>
                          ))
                        })()}
                      </div>
                    </div>
                  )}

                  {ingredients.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No ingredients</p>
                  ) : (
                    ingredients.map(ing => (
                      <div key={ing.ingredientId} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded border">
                        <span className="flex-1 text-sm truncate">{ing.name}</span>
                        <div className="flex gap-0.5 items-center">
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowNo')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-400'}`}
                          >
                            N
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowLite')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-400'}`}
                          >
                            L
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowOnSide')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-400'}`}
                          >
                            S
                          </button>
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowExtra')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-400'}`}
                          >
                            E
                          </button>
                          {ing.allowExtra && (
                            <input
                              type="number"
                              value={ing.extraPrice || ''}
                              onChange={(e) => updateExtraPrice(ing.ingredientId, parseFloat(e.target.value) || 0)}
                              placeholder="$"
                              className="w-12 px-1 text-xs border rounded"
                              step="0.01"
                              min="0"
                            />
                          )}
                          <button
                            onClick={() => toggleIngredientOption(ing.ingredientId, 'allowSwap')}
                            className={`w-5 h-5 rounded text-[9px] font-bold ${ing.allowSwap ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-400'}`}
                          >
                            Sw
                          </button>
                        </div>
                        <button onClick={() => removeIngredient(ing.ingredientId)} className="text-red-400 hover:text-red-600">×</button>
                      </div>
                    ))
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
                        className={`border rounded-lg overflow-hidden ${group.isRequired ? 'border-l-4 border-red-400' : ''} ${draggedGroupId === group.id ? 'opacity-50' : ''} ${dragOverGroupId === group.id && draggedGroupId !== group.id ? 'ring-2 ring-indigo-400' : ''}`}
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
                        onDrop={(e) => {
                          e.preventDefault()
                          if (draggedGroupId) reorderGroups(draggedGroupId, group.id)
                          setDraggedGroupId(null)
                          setDragOverGroupId(null)
                        }}
                        onDragEnd={() => {
                          setDraggedGroupId(null)
                          setDragOverGroupId(null)
                        }}
                      >
                        {/* Group Header - click to expand */}
                        <div
                          className="px-3 py-2 bg-gray-50 flex items-center gap-2 cursor-pointer"
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

                        {/* Expanded: Settings + Modifiers */}
                        {isExpanded && (
                          <div className="border-t" draggable={false} onDragStart={(e) => e.stopPropagation()}>
                            {/* Compact settings summary - edit in right panel */}
                            <div className="px-3 py-1.5 bg-gray-50/50 border-b text-xs text-gray-400 flex items-center justify-between">
                              <span>
                                {group.minSelections}-{group.maxSelections} selections
                                {group.isRequired && <span className="ml-1 text-red-500 font-medium">· Required</span>}
                                {group.allowStacking && <span className="ml-1 text-yellow-600">· Stacking</span>}
                              </span>
                              <span className="text-gray-300">Edit in panel →</span>
                            </div>

                            {/* Modifier rows */}
                            <div className="p-2 space-y-1">
                              {isEmpty && (
                                <div className="text-center text-gray-400 text-xs py-2 italic">
                                  Add modifiers to get started
                                </div>
                              )}
                              {group.modifiers.map(mod => renderModifierRow(group.id, mod))}

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
