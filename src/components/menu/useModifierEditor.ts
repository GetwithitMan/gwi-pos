import { useState, type MutableRefObject } from 'react'
import { toast } from '@/stores/toast-store'
import type { Modifier, ModifierGroup, IngredientLibraryItem } from './item-editor-types'

interface UseModifierEditorParams {
  itemId: string | undefined
  ingredientsLibrary: IngredientLibraryItem[]
  loadData: () => Promise<void>
  setSaving: (v: boolean) => void
  modifierGroups: ModifierGroup[]
  setModifierGroups: React.Dispatch<React.SetStateAction<ModifierGroup[]>>
  findGroupById: (id: string, groups?: ModifierGroup[], visited?: Set<string>) => ModifierGroup | undefined
  findModifierById: (id: string, groups?: ModifierGroup[], visited?: Set<string>) => Modifier | undefined
  resetCreationExpansionRef: MutableRefObject<() => void>
}

// Helper: recursively update a modifier in local state (handles child groups)
export function updateModifierInGroups(groups: ModifierGroup[], targetGroupId: string, modId: string, updates: Partial<Modifier>): ModifierGroup[] {
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

export function useModifierEditor({
  itemId,
  ingredientsLibrary,
  loadData,
  setSaving,
  modifierGroups,
  setModifierGroups,
  findGroupById,
  findModifierById,
  resetCreationExpansionRef,
}: UseModifierEditorParams) {
  const [addingModifierTo, setAddingModifierTo] = useState<string | null>(null)
  const [newModName, setNewModName] = useState('')
  const [newModPrice, setNewModPrice] = useState('')
  const [addingType, setAddingType] = useState<'item' | 'choice' | null>(null)
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null)
  const [editModValues, setEditModValues] = useState<{ name: string; price: string; extraPrice: string }>({ name: '', price: '', extraPrice: '' })
  const [linkingModifier, setLinkingModifier] = useState<{ groupId: string; modId: string } | null>(null)
  const [modIngredientSearch, setModIngredientSearch] = useState('')
  const [draggedModifierId, setDraggedModifierId] = useState<string | null>(null)
  const [dragOverModifierId, setDragOverModifierId] = useState<string | null>(null)

  const addModifier = async (groupId: string) => {
    if (!itemId || !newModName.trim()) return
    setSaving(true)
    try {
      const parsedPrice = parseFloat(newModPrice)
      const price = Number.isFinite(parsedPrice) ? parsedPrice : 0
      await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}/modifiers`, {
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

  const updateModifier = async (groupId: string, modifierId: string, updates: Partial<Modifier>) => {
    if (!itemId) return

    // Optimistic local update — no flash, instant feedback
    setModifierGroups(prev => updateModifierInGroups(prev, groupId, modifierId, updates))

    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId, ...updates }),
      })
      if (!res.ok) {
        // Revert on failure
        await loadData()
        toast.error('Failed to update modifier')
      } else {
        const json = await res.json().catch(() => null)
        if (json?.warning) {
          toast.warning(json.warning, 8000)
        }
      }
    } catch (e) {
      console.error('Failed to update modifier:', e)
      await loadData() // Revert on error
      toast.error('Failed to update modifier')
    }
  }

  // Toggle isDefault with group rule enforcement (respects maxSelections)
  const toggleDefault = async (groupId: string, modifierId: string, currentlyDefault: boolean) => {
    if (!itemId) return
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
    if (!itemId) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}/modifiers?modifierId=${modifierId}`, {
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
    if (!itemId) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    if (!itemId || !newModName.trim()) return
    setSaving(true)
    try {
      // Step 1: Create modifier with isLabel=true, price=0, all pre-mods false
      const modRes = await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}/modifiers`, {
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
      await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    // Refresh data to update the link badge immediately
    await loadData()
    // Reset ALL linking state to prevent stale data on next open
    setLinkingModifier(null)
    setModIngredientSearch('')
    resetCreationExpansionRef.current()
  }

  const saveInventoryLink = async (
    modifierId: string,
    inventoryItemId: string,
    usageQuantity: number,
    usageUnit: string
  ) => {
    try {
      const res = await fetch(`/api/modifiers/${modifierId}/inventory-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryItemId, usageQuantity, usageUnit }),
      })
      if (!res.ok) {
        toast.error('Failed to save inventory link')
        return
      }
      const json = await res.json().catch(() => null)
      if (json?.warning) {
        toast.warning(json.warning, 8000)
      }
      await loadData()
    } catch (e) {
      console.error('Failed to save inventory link:', e)
      toast.error('Failed to save inventory link')
    }
  }

  return {
    addingModifierTo, setAddingModifierTo,
    newModName, setNewModName,
    newModPrice, setNewModPrice,
    addingType, setAddingType,
    editingModifierId, setEditingModifierId,
    editModValues, setEditModValues,
    linkingModifier, setLinkingModifier,
    modIngredientSearch, setModIngredientSearch,
    draggedModifierId, setDraggedModifierId,
    dragOverModifierId, setDragOverModifierId,
    addModifier, updateModifier, toggleDefault, deleteModifier,
    startEditModifier, commitEditModifier,
    createChildGroup, addChoice, linkIngredient, saveInventoryLink,
  }
}
