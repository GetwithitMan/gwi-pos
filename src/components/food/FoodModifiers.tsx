'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'
import { LiquorModifierGroupEditor } from '@/app/(admin)/liquor-builder/LiquorModifierGroupEditor'

interface ModifierGroup {
  id: string
  name: string
  displayName?: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  modifierTypes?: string[]
  linkedItems?: any[]
  modifiers: Array<{
    id: string
    name: string
    price: number
    isDefault: boolean
    isActive: boolean
    showOnPOS?: boolean
    ingredientId?: string | null
  }>
}

export function FoodModifiers() {
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState<ModifierGroup | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const selectedGroupIdRef = useRef<string | null>(null)
  selectedGroupIdRef.current = selectedGroup?.id ?? null

  const loadGroups = useCallback(async (autoSelectId?: string) => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/menu/modifiers')
      if (res.ok) {
        const data = await res.json()
        const foodGroups = (data.data?.modifierGroups || []).filter(
          (g: any) =>
            g.modifierTypes?.includes('food') &&
            (!g.linkedItems || g.linkedItems.length === 0)
        )
        setGroups(foodGroups)

        if (autoSelectId) {
          const target = foodGroups.find((g: ModifierGroup) => g.id === autoSelectId)
          setSelectedGroup(target || foodGroups[0] || null)
        } else if (selectedGroupIdRef.current) {
          const refreshed = foodGroups.find((g: ModifierGroup) => g.id === selectedGroupIdRef.current)
          setSelectedGroup(refreshed || foodGroups[0] || null)
        } else if (foodGroups.length > 0) {
          setSelectedGroup(foodGroups[0])
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const addGroup = async () => {
    try {
      const res = await fetch('/api/menu/modifiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Group', modifierTypes: ['food'] }),
      })
      if (res.ok) {
        const data = await res.json()
        const newId = data.data?.id
        await loadGroups(newId)
      } else {
        toast.error('Failed to create modifier group')
      }
    } catch {
      toast.error('Failed to create modifier group')
    }
  }

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Delete this modifier group? This cannot be undone.')) return
    const res = await fetch(`/api/menu/modifiers/${groupId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Group deleted')
      setSelectedGroup(null)
      await loadGroups()
    } else {
      toast.error('Failed to delete group')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-900">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b shrink-0">
        <div className="px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Food Modifier Templates</h1>
            <p className="text-xs text-gray-600 mt-0.5">Reusable groups you can attach to any food item</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={addGroup}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              + New Group
            </Button>
            <Link href="/settings/menu" className="text-xs text-orange-600 hover:underline">
              ← Back to Menu Builder
            </Link>
          </div>
        </div>
      </div>

      {/* Body: left list + right editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Template list */}
        <div className="w-72 bg-white border-r flex flex-col shrink-0">
          <div className="px-4 py-2.5 border-b">
            <span className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
              Templates ({groups.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {groups.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-600">
                <p className="mb-2">No food modifier templates yet.</p>
                <p className="text-xs text-gray-600 mb-3">
                  Create templates like Meat Temp, Cooking Style, or Sauce options.
                </p>
                <button
                  onClick={addGroup}
                  className="text-orange-600 hover:text-orange-700 font-medium text-xs"
                >
                  + Create first template
                </button>
              </div>
            ) : (
              groups.map((group) => {
                const isSelected = selectedGroup?.id === group.id
                const activeCount = group.modifiers?.filter((m) => m.isActive).length ?? 0
                return (
                  <button
                    key={group.id}
                    onClick={() => setSelectedGroup(group)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-orange-50 border-orange-400 shadow-sm'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium text-sm ${isSelected ? 'text-orange-700' : 'text-gray-800'}`}>
                        {group.name}
                      </span>
                      {group.isRequired && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Req</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {activeCount} option{activeCount !== 1 ? 's' : ''}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Group editor */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedGroup ? (
            <>
              <div className="px-6 py-3 border-b bg-white flex items-center justify-between shrink-0">
                <h2 className="text-sm font-semibold text-gray-900">
                  Editing: <span className="text-orange-700">{selectedGroup.name}</span>
                </h2>
              </div>
              <div className="flex-1 overflow-auto bg-white">
                <LiquorModifierGroupEditor
                  key={selectedGroup.id}
                  group={selectedGroup}
                  onSaved={async () => {
                    await loadGroups()
                  }}
                  onDelete={() => deleteGroup(selectedGroup.id)}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              <div className="text-center">
                <p className="text-sm">Select a template to edit</p>
                <p className="text-xs mt-1">or create a new one with the + New Group button</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
