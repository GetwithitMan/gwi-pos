import { useState } from 'react'
import { toast } from '@/stores/toast-store'
import type { Modifier, ModifierGroup } from './item-editor-types'

interface UseModifierGroupManagerParams {
  itemId: string | undefined
  loadData: () => Promise<void>
  setSaving: (v: boolean) => void
}

export function useModifierGroupManager({ itemId, loadData, setSaving }: UseModifierGroupManagerParams) {
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [dragOverDropZone, setDragOverDropZone] = useState<string | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
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

  const createGroup = async () => {
    if (!itemId || !newGroupName.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    if (!itemId) return
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
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}`, {
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
    if (!itemId) return
    // Step 1: Preview — get cascade counts
    try {
      const previewRes = await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}?preview=true`, { method: 'DELETE' })
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
      await fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}`, { method: 'DELETE' })
      // Optimistic: remove from local state
      setModifierGroups(prev => prev.filter(g => g.id !== groupId))
      toast.success('Modifier group deleted')
      await loadData()
    } catch (e) {
      console.error('Failed to delete group:', e)
      toast.error('Failed to delete modifier group')
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const duplicateGroup = async (groupId: string, targetParentGroupId?: string) => {
    if (!itemId) return
    setSaving(true)
    try {
      // Step 1: Create the duplicate (always creates at top-level)
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
          const modRes = await fetch(`/api/menu/items/${itemId}/modifier-groups/${parentGroupId}/modifiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: sourceGroup?.name ? `${sourceGroup.name} (Copy)` : 'Copy', price: 0 }),
          })
          const modData = await modRes.json()
          const newModId = modData.data?.id

          if (newModId) {
            // Reparent the duplicate group to be a child of the new modifier
            await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    if (!itemId || fromId === toId) return

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
      const resp = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    if (!itemId || fromModId === toModId) return

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
        fetch(`/api/menu/items/${itemId}/modifier-groups/${groupId}/modifiers`, {
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

  // Reparent a group: move it to top-level or make it a child of a modifier
  const reparentGroup = async (groupId: string, targetParentModifierId: string | null) => {
    if (!itemId) return
    setSaving(true)
    try {
      const resp = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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
    if (!itemId) return
    // Find the dragged group name for the auto-created modifier
    const draggedGroup = modifierGroups.find(g => g.id === draggedId)
    const modName = draggedGroup?.name || 'Sub-Group'

    setSaving(true)
    try {
      // Step 1: Create a modifier in the target group
      const modRes = await fetch(`/api/menu/items/${itemId}/modifier-groups/${targetGroupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modName, price: 0 }),
      })
      const modData = await modRes.json()
      const newModId = modData.data?.id
      if (!newModId) throw new Error('Failed to create modifier for nesting')

      // Step 2: Reparent the dragged group to be a child of the new modifier
      const resp = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
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

  return {
    modifierGroups, setModifierGroups,
    expandedGroups, toggleExpanded,
    showNewGroupForm, setShowNewGroupForm,
    newGroupName, setNewGroupName,
    draggedGroupId, setDraggedGroupId,
    dragOverGroupId, setDragOverGroupId,
    dragOverDropZone, setDragOverDropZone,
    renamingGroupId, setRenamingGroupId,
    renameValue, setRenameValue,
    createGroup, updateGroup, deleteGroup, duplicateGroup,
    reorderGroups, reorderModifiers,
    findGroupById, findModifierById, isDescendantOf,
    reparentGroup, handleGroupDrop, handleGroupDropOnModifier,
    nestGroupInGroup, startRename, commitRename,
  }
}
