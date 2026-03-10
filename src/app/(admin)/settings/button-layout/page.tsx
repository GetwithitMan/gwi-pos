'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MenuItemOption {
  id: string
  name: string
  price: number
  categoryName: string
}

interface EmployeeOverride {
  employeeId: string
  employeeName: string
  itemCount: number
}

// ─── Sortable Item ───────────────────────────────────────────────────────────

function SortableQuickBarItem({
  item,
  onRemove,
}: {
  item: MenuItemOption
  onRemove: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        relative flex items-center gap-2 px-3 py-2 rounded-lg border bg-white
        shadow-sm select-none group
        ${isDragging ? 'ring-2 ring-blue-400 shadow-lg z-10' : ''}
      `}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
        aria-label={`Drag to reorder ${item.name}`}
      >
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900 truncate block">{item.name}</span>
        <span className="text-xs text-gray-500">{item.categoryName}</span>
      </div>

      {/* Remove button */}
      <button
        onClick={() => onRemove(item.id)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
        aria-label={`Remove ${item.name}`}
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ButtonLayoutPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const locationId = useAuthStore(s => s.employee?.location?.id)

  // All menu items for the picker
  const [allItems, setAllItems] = useState<MenuItemOption[]>([])
  const [allItemsLoading, setAllItemsLoading] = useState(false)

  // Current default quick bar item IDs (ordered)
  const [defaultItemIds, setDefaultItemIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Employee overrides
  const [overrides, setOverrides] = useState<EmployeeOverride[]>([])
  const [overridesLoading, setOverridesLoading] = useState(false)

  // Item picker modal
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  // Reset confirm
  const [resetEmployeeId, setResetEmployeeId] = useState<string | null>(null)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ── Load defaults ──────────────────────────────────────────────────────────

  const loadDefaults = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/location/quick-bar/default?locationId=${locationId}`)
      if (res.ok) {
        const json = await res.json()
        setDefaultItemIds(json.data.itemIds || [])
      }
    } catch (error) {
      console.error('Failed to load quick bar defaults:', error)
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  // ── Load all menu items ────────────────────────────────────────────────────

  const loadAllItems = useCallback(async () => {
    if (!locationId) return
    setAllItemsLoading(true)
    try {
      const res = await fetch(`/api/menu/items?locationId=${locationId}`)
      if (res.ok) {
        const json = await res.json()
        const items = (json.data?.items || json.items || json.data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price) || 0,
          categoryName: item.category?.name || 'Uncategorized',
        }))
        setAllItems(items)
      }
    } catch (error) {
      console.error('Failed to load menu items:', error)
    } finally {
      setAllItemsLoading(false)
    }
  }, [locationId])

  // ── Load employee overrides ────────────────────────────────────────────────

  const loadOverrides = useCallback(async () => {
    if (!locationId) return
    setOverridesLoading(true)
    try {
      const res = await fetch(`/api/employees?locationId=${locationId}`)
      if (!res.ok) { setOverridesLoading(false); return }
      const json = await res.json()
      const employees = json.data?.employees || json.employees || json.data || []

      // Check each employee for a quick bar preference
      const results: EmployeeOverride[] = []
      for (const emp of employees) {
        try {
          const prefRes = await fetch(`/api/employees/${emp.id}/quick-bar`)
          if (prefRes.ok) {
            const prefJson = await prefRes.json()
            const itemIds = prefJson.data?.itemIds || []
            if (itemIds.length > 0) {
              results.push({
                employeeId: emp.id,
                employeeName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.name || 'Unknown',
                itemCount: itemIds.length,
              })
            }
          }
        } catch {
          // Skip this employee
        }
      }

      setOverrides(results)
    } catch (error) {
      console.error('Failed to load employee overrides:', error)
    } finally {
      setOverridesLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadDefaults()
    loadAllItems()
    loadOverrides()
  }, [loadDefaults, loadAllItems, loadOverrides])

  // ── Resolve item IDs to full objects ───────────────────────────────────────

  const itemMap = new Map(allItems.map(i => [i.id, i]))
  const resolvedItems: MenuItemOption[] = defaultItemIds
    .map(id => itemMap.get(id))
    .filter((item): item is MenuItemOption => !!item)

  // ── Save defaults ──────────────────────────────────────────────────────────

  const saveDefaults = async () => {
    if (!locationId) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/location/quick-bar/default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, itemIds: defaultItemIds, employeeId }),
      })
      if (res.ok) {
        toast.success('Default quick bar saved')
        setHasChanges(false)
      } else {
        const errData = await res.json().catch(() => ({}))
        toast.error(errData.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save defaults')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Drag end ───────────────────────────────────────────────────────────────

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = defaultItemIds.indexOf(String(active.id))
    const newIndex = defaultItemIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    setDefaultItemIds(arrayMove(defaultItemIds, oldIndex, newIndex))
    setHasChanges(true)
  }

  // ── Remove item ────────────────────────────────────────────────────────────

  const removeItem = (itemId: string) => {
    setDefaultItemIds(prev => prev.filter(id => id !== itemId))
    setHasChanges(true)
  }

  // ── Add item from picker ───────────────────────────────────────────────────

  const addItem = (itemId: string) => {
    if (defaultItemIds.includes(itemId)) return
    setDefaultItemIds(prev => [...prev, itemId])
    setHasChanges(true)
  }

  // ── Reset to empty ─────────────────────────────────────────────────────────

  const resetDefaults = () => {
    setDefaultItemIds([])
    setHasChanges(true)
  }

  // ── Reset employee override ────────────────────────────────────────────────

  const handleResetEmployeeOverride = async () => {
    if (!resetEmployeeId) return
    try {
      const res = await fetch(`/api/employees/${resetEmployeeId}/quick-bar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: [] }),
      })
      if (res.ok) {
        toast.success('Employee override reset')
        setOverrides(prev => prev.filter(o => o.employeeId !== resetEmployeeId))
      } else {
        toast.error('Failed to reset override')
      }
    } catch {
      toast.error('Failed to reset override')
    } finally {
      setResetEmployeeId(null)
    }
  }

  // ── Picker filtered items ──────────────────────────────────────────────────

  const pickerItems = allItems.filter(item => {
    if (defaultItemIds.includes(item.id)) return false
    if (!pickerSearch) return true
    const q = pickerSearch.toLowerCase()
    return item.name.toLowerCase().includes(q) || item.categoryName.toLowerCase().includes(q)
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff Button Layout</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure the default quick bar buttons shown on all POS terminals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
          )}
          <Button onClick={saveDefaults} disabled={isSaving || !hasChanges}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Default Quick Bar */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Default Quick Bar</h2>
            <p className="text-sm text-gray-500">
              Drag to reorder. These items appear on every terminal unless an employee has a personal override.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowItemPicker(true)}>
              + Add Item
            </Button>
            {defaultItemIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={resetDefaults}>
                Clear All
              </Button>
            )}
          </div>
        </div>

        {resolvedItems.length === 0 ? (
          <div className="py-8 text-center text-gray-400 border-2 border-dashed rounded-xl">
            <p className="text-sm">No items in the default quick bar.</p>
            <button
              onClick={() => setShowItemPicker(true)}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Add items to get started
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={defaultItemIds}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex flex-wrap gap-2">
                {resolvedItems.map((item) => (
                  <SortableQuickBarItem
                    key={item.id}
                    item={item}
                    onRemove={removeItem}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="text-xs text-gray-400">
          {resolvedItems.length} item{resolvedItems.length !== 1 ? 's' : ''} in default layout
        </div>
      </Card>

      {/* Employee Overrides */}
      <Card className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Employee Overrides</h2>
          <p className="text-sm text-gray-500">
            Employees who have customized their personal quick bar. Reset to make them use the location defaults.
          </p>
        </div>

        {overridesLoading ? (
          <div className="py-4 text-center text-gray-400 text-sm">Loading overrides...</div>
        ) : overrides.length === 0 ? (
          <div className="py-4 text-center text-gray-400 text-sm">
            No employees have custom overrides.
          </div>
        ) : (
          <div className="divide-y">
            {overrides.map((override) => (
              <div key={override.employeeId} className="flex items-center justify-between py-3">
                <div>
                  <span className="text-sm font-medium text-gray-900">{override.employeeName}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {override.itemCount} custom item{override.itemCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => setResetEmployeeId(override.employeeId)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Reset
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Item Picker Modal */}
      <Modal
        isOpen={showItemPicker}
        onClose={() => { setShowItemPicker(false); setPickerSearch('') }}
        title="Add Items to Quick Bar"
        size="lg"
      >
        <div className="space-y-4">
          {/* Search */}
          <input
            type="text"
            placeholder="Search items..."
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />

          {/* Items list */}
          <div className="max-h-96 overflow-y-auto divide-y">
            {allItemsLoading ? (
              <div className="py-8 text-center text-gray-400 text-sm">Loading menu items...</div>
            ) : pickerItems.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">
                {pickerSearch ? 'No matching items found.' : 'All items are already in the quick bar.'}
              </div>
            ) : (
              pickerItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItem(item.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors text-left"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-900">{item.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{item.categoryName}</span>
                  </div>
                  <span className="text-xs text-gray-400">${item.price.toFixed(2)}</span>
                </button>
              ))
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowItemPicker(false); setPickerSearch('') }}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset Employee Confirm Dialog */}
      <ConfirmDialog
        open={!!resetEmployeeId}
        onCancel={() => setResetEmployeeId(null)}
        onConfirm={handleResetEmployeeOverride}
        title="Reset Employee Override"
        description="This will remove the employee's custom quick bar and they will use the location defaults. This cannot be undone."
        confirmLabel="Reset"
        destructive
      />
    </div>
  )
}
