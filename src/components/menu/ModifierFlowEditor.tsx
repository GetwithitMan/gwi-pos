'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'
import { ModifierGroupSettingsPanel } from './ModifierGroupSettingsPanel'
import type { ModifierGroup } from './item-editor-types'

interface ModifierFlowEditorProps {
  item: { id: string; name: string } | null
  selectedGroupId: string | null
  refreshKey?: number
  onGroupUpdated: () => void
}

export function ModifierFlowEditor({
  item,
  selectedGroupId,
  refreshKey,
  onGroupUpdated,
}: ModifierFlowEditorProps) {
  const [group, setGroup] = useState<ModifierGroup | null>(null)
  const [loading, setLoading] = useState(false)

  // Debounce ref for batched saves
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUpdatesRef = useRef<Record<string, any>>({})

  // Load group data when selectedGroupId changes
  useEffect(() => {
    // Flush any pending debounced saves from the previous group before switching
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      const pending = { ...pendingUpdatesRef.current }
      pendingUpdatesRef.current = {}
      if (Object.keys(pending).length > 0 && item?.id) {
        // Fire-and-forget: save previous group's pending changes
        // Use the previous selectedGroupId from the ref (captured before this effect runs)
        void fetch(`/api/menu/items/${item.id}/modifier-groups/${group?.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending),
        }).catch(err => console.warn('fire-and-forget failed in menu.ModifierFlowEditor:', err))
      }
    }

    if (!item?.id || !selectedGroupId) {
      setGroup(null)
      return
    }

    const loadGroupData = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
        if (response.ok) {
          const data = await response.json()
          const groups = data.data || data.modifierGroups || []
          const foundGroup = groups.find((g: ModifierGroup) => g.id === selectedGroupId)
          if (foundGroup) {
            setGroup(foundGroup)
          } else {
            setGroup(null) // Group not found (deleted or switched items)
          }
        }
      } catch (error) {
        console.error('Failed to load group data:', error)
        toast.error('Failed to load group settings')
      } finally {
        setLoading(false)
      }
    }

    loadGroupData()

  }, [item?.id, selectedGroupId])
  // Note: refreshKey intentionally excluded — external refreshes (from ItemEditor saves)
  // should NOT wipe this panel's state mid-edit. Panel reloads on group selection change only.

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  // Maps field updates from ModifierGroupSettingsPanel to debounced API saves
  const handleGroupFieldUpdate = useCallback((field: string, value: any) => {
    if (!item?.id || !selectedGroupId) return

    // Optimistic update
    setGroup(prev => prev ? { ...prev, [field]: value } : prev)

    // Accumulate updates and debounce save
    pendingUpdatesRef.current[field] = value

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      const updates = { ...pendingUpdatesRef.current }
      pendingUpdatesRef.current = {}

      try {
        const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          toast.error(errorData.error || 'Failed to save settings')
        }
        // No onGroupUpdated() — settings saves are local to this panel,
        // calling onGroupUpdated triggers refreshKey++ which re-fetches and resets all state mid-edit
      } catch (error) {
        console.error('Failed to save group settings:', error)
        toast.error('Failed to save group settings')
      }
    }, 300)
  }, [item?.id, selectedGroupId])

  const handleDeleteGroup = async () => {
    if (!item?.id || !selectedGroupId || !confirm('Delete this modifier group?')) return
    try {
      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        onGroupUpdated()
      }
    } catch (e) {
      console.error('Failed to delete group:', e)
      toast.error('Failed to delete modifier group')
    }
  }

  if (!selectedGroupId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-900 bg-white p-6">
        <div className="text-center">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <p className="text-sm font-medium">Select a modifier group</p>
          <p className="text-xs mt-1">to configure pricing rules</p>
        </div>
      </div>
    )
  }

  if (loading || !group) {
    return (
      <div className="h-full flex items-center justify-center text-gray-900 bg-white p-6">
        <p className="text-sm">Loading group settings...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Group Summary Header */}
      <div className="p-4 border-b">
        <h3 className="text-lg font-bold text-gray-800">{group.displayName || group.name}</h3>
        <div className="flex gap-2 mt-2 flex-wrap">
          {group.isRequired && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
              Required
            </span>
          )}
          {group.allowStacking && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
              Stacking
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-900">
            {group.minSelections}-{group.maxSelections} selections
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
            {group.modifiers.length} modifiers
          </span>
        </div>
        <button
          onClick={() => handleDeleteGroup()}
          className="mt-3 text-red-500 hover:text-red-700 text-sm px-3 py-1.5 border border-red-200 rounded hover:bg-red-50 w-full"
        >
          Delete Group
        </button>
      </div>

      {/* Shared Settings Panel */}
      <div className="flex-1 min-h-0">
        <ModifierGroupSettingsPanel
          group={group}
          mode="full"
          onUpdate={handleGroupFieldUpdate}
        />
      </div>
    </div>
  )
}
