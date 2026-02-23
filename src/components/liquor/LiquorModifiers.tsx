'use client'

import { useState, useEffect } from 'react'
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
  isSpiritGroup?: boolean
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

export function LiquorModifiers() {
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState<ModifierGroup | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadGroups()
  }, [])

  const loadGroups = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/menu/modifiers')
      if (res.ok) {
        const data = await res.json()
        const liquorGroups = (data.data?.modifierGroups || []).filter(
          (g: any) =>
            g.modifierTypes?.includes('liquor') &&
            !g.isSpiritGroup &&
            (!g.linkedItems || g.linkedItems.length === 0)
        )
        setGroups(liquorGroups)
        // Keep selected group in sync, or auto-select first
        if (selectedGroup) {
          const refreshed = liquorGroups.find((g: ModifierGroup) => g.id === selectedGroup.id)
          setSelectedGroup(refreshed || liquorGroups[0] || null)
        } else if (liquorGroups.length > 0) {
          setSelectedGroup(liquorGroups[0])
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  const addGroup = async () => {
    const res = await fetch('/api/menu/modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Group', modifierTypes: ['liquor'] }),
    })
    if (res.ok) {
      const data = await res.json()
      const newId = data.data?.id
      await loadGroups()
      // Auto-select the new group after reload
      if (newId) {
        // loadGroups sets groups, but we need to wait for state update
        // so re-fetch to find it
        const res2 = await fetch('/api/menu/modifiers')
        if (res2.ok) {
          const data2 = await res2.json()
          const liquorGroups = (data2.data?.modifierGroups || []).filter(
            (g: any) =>
              g.modifierTypes?.includes('liquor') &&
              !g.isSpiritGroup &&
              (!g.linkedItems || g.linkedItems.length === 0)
          )
          setGroups(liquorGroups)
          const newGroup = liquorGroups.find((g: ModifierGroup) => g.id === newId)
          setSelectedGroup(newGroup || null)
        }
      }
    } else {
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
      <div className="flex items-center justify-center min-h-screen text-gray-500">
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
            <h1 className="text-lg font-bold text-gray-900">Liquor Modifier Templates</h1>
            <p className="text-xs text-gray-500 mt-0.5">Reusable groups you can attach to any drink</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={addGroup}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              + New Group
            </Button>
            <Link href="/liquor-builder" className="text-xs text-purple-600 hover:underline">
              ← Back to Liquor Builder
            </Link>
          </div>
        </div>
      </div>

      {/* Body: left list + right editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Template list */}
        <div className="w-72 bg-white border-r flex flex-col shrink-0">
          <div className="px-4 py-2.5 border-b">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Templates ({groups.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {groups.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">
                <p className="mb-2">No modifier templates yet.</p>
                <p className="text-xs text-gray-400 mb-3">
                  Create templates like Mixers, Garnishes, or Ice options.
                </p>
                <button
                  onClick={addGroup}
                  className="text-purple-600 hover:text-purple-700 font-medium text-xs"
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
                        ? 'bg-purple-50 border-purple-400 shadow-sm'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium text-sm ${isSelected ? 'text-purple-700' : 'text-gray-800'}`}>
                        {group.name}
                      </span>
                      {group.isRequired && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Req</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
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
                <h2 className="text-sm font-semibold text-gray-700">
                  Editing: <span className="text-purple-700">{selectedGroup.name}</span>
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
            <div className="flex-1 flex items-center justify-center text-gray-400">
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
