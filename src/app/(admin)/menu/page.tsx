'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemTreeView } from '@/components/menu/ItemTreeView'
import { ItemEditor } from '@/components/menu/ItemEditor'
import { ModifierFlowEditor } from '@/components/menu/ModifierFlowEditor'
import { ModifierDetailPanel } from '@/components/menu/ModifierDetailPanel'
import { ModifierGroupSettingsPanel } from '@/components/menu/ModifierGroupSettingsPanel'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useMenuData } from './hooks/useMenuData'
import { CategoriesBar } from './components/CategoriesBar'
import { ItemsBar } from './components/ItemsBar'
import { CategoryModal } from './components/CategoryModal'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import type { Modifier, ModifierGroup } from '@/components/menu/item-editor-types'

export default function MenuManagementPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/menu' })

  const {
    // State
    categories,
    isLoading,
    selectedCategory,
    showCategoryModal,
    editingCategory,
    confirmAction,
    selectedItemForEditor,
    selectedTreeNode,
    refreshKey,
    selectedGroupId,
    dragOverItemId,
    itemSearch,
    itemSearchRef,
    categoriesScrollRef,
    itemsScrollRef,
    selectedCategoryData,
    filteredItems,
    ingredientsLibrary,
    ingredientCategories,
    printers,
    kdsScreens,
    employee,
    selectedItemIds,

    // Setters
    setSelectedCategory,
    setShowCategoryModal,
    setEditingCategory,
    setConfirmAction,
    setSelectedItemForEditor,
    setSelectedTreeNode,
    setRefreshKey,
    setSelectedGroupId,
    setDragOverItemId,
    setItemSearch,
    setSelectedItemIds,

    // Handlers
    loadMenu,
    handleCopyModifierGroup,
    handleSaveCategory,
    handleDeleteCategory,
    handleDeleteItem,
    handleToggleItem86,
    handleIngredientCreated,
    handleCategoryCreated,
    handleItemClick,
    handleCreateItem,
    toggleItemSelection,
    handleMoveItems,
  } = useMenuData()

  // --- Right panel selection state ---
  const [selectedModifierId, setSelectedModifierId] = useState<string | null>(null)
  const [rightPanelMode, setRightPanelMode] = useState<'group' | 'modifier' | null>(null)
  const [itemModifierGroups, setItemModifierGroups] = useState<ModifierGroup[]>([])

  // Clear modifier selection when item changes
  useEffect(() => {
    setSelectedModifierId(null)
    setRightPanelMode(null)
  }, [selectedItemForEditor?.id])

  const handleSelectGroup = useCallback((groupId: string | null) => {
    if (groupId === selectedGroupId) {
      setSelectedGroupId(null)
      setSelectedModifierId(null)
      setRightPanelMode(null)
    } else {
      setSelectedGroupId(groupId)
      setSelectedModifierId(null)
      setRightPanelMode(groupId ? 'group' : null)
    }
  }, [selectedGroupId, setSelectedGroupId])

  const handleSelectModifier = useCallback((modifierId: string, groupId: string) => {
    if (modifierId === selectedModifierId) {
      setSelectedModifierId(null)
      setRightPanelMode(selectedGroupId ? 'group' : null)
    } else {
      setSelectedGroupId(groupId)
      setSelectedModifierId(modifierId)
      setRightPanelMode('modifier')
    }
  }, [selectedModifierId, selectedGroupId, setSelectedGroupId])

  // Find selected group/modifier from the item's modifier groups (recursive search)
  const findSelectedGroup = useCallback((): ModifierGroup | undefined => {
    if (!selectedGroupId) return undefined
    const search = (groups: ModifierGroup[]): ModifierGroup | undefined => {
      for (const g of groups) {
        if (g.id === selectedGroupId) return g
        for (const m of g.modifiers) {
          if (m.childModifierGroup) {
            const found = search([m.childModifierGroup])
            if (found) return found
          }
        }
      }
      return undefined
    }
    return search(itemModifierGroups)
  }, [selectedGroupId, itemModifierGroups])

  const findSelectedModifier = useCallback((): Modifier | undefined => {
    if (!selectedModifierId || !selectedGroupId) return undefined
    const group = findSelectedGroup()
    return group?.modifiers.find(m => m.id === selectedModifierId)
  }, [selectedModifierId, selectedGroupId, findSelectedGroup])

  // API handlers for right panel edits
  const handleGroupFieldUpdate = useCallback(async (groupId: string, field: string, value: any) => {
    if (!selectedItemForEditor?.id) return
    try {
      const res = await fetch(`/api/menu/items/${selectedItemForEditor.id}/modifier-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) throw new Error('Failed to update group')
      loadMenu()
      setRefreshKey(prev => prev + 1)
    } catch {
      toast.error('Failed to update modifier group')
    }
  }, [selectedItemForEditor?.id, loadMenu, setRefreshKey])

  const handleModifierSave = useCallback(async (modifierId: string, updates: Partial<Modifier>) => {
    if (!selectedItemForEditor?.id || !selectedGroupId) return
    try {
      const res = await fetch(`/api/menu/items/${selectedItemForEditor.id}/modifier-groups/${selectedGroupId}/modifiers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifierId, ...updates }),
      })
      if (!res.ok) throw new Error('Failed to update modifier')
      loadMenu()
      setRefreshKey(prev => prev + 1)
    } catch {
      toast.error('Failed to update modifier')
    }
  }, [selectedItemForEditor?.id, selectedGroupId, loadMenu, setRefreshKey])

  // Track which item is being dragged for the overlay
  const [activeDragItem, setActiveDragItem] = useState<{ id: string; name: string; price?: number } | null>(null)

  // dnd-kit sensors: require 8px movement before activating (prevents click interference)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.type === 'menu-item') {
      const item = filteredItems.find(i => i.id === data.itemId)
      setActiveDragItem({
        id: data.itemId,
        name: data.itemName || item?.name || 'Item',
        price: item?.price,
      })
    }
  }, [filteredItems])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragItem(null)

    const { active, over } = event
    if (!over) return

    const activeData = active.data.current
    const overData = over.data.current

    // Only handle menu-item → category drops
    if (activeData?.type !== 'menu-item' || overData?.type !== 'category') return

    const itemId = activeData.itemId as string
    const targetCategoryId = overData.categoryId as string

    // Don't move if dropping on same category
    if (targetCategoryId === selectedCategory) return

    // If the dragged item is part of a selection, move all selected items
    if (selectedItemIds.has(itemId) && selectedItemIds.size > 1) {
      void handleMoveItems(Array.from(selectedItemIds), targetCategoryId)
    } else {
      // Move just the single dragged item
      void handleMoveItems([itemId], targetCategoryId)
    }
  }, [selectedCategory, selectedItemIds, handleMoveItems])

  const handleMoveSelected = useCallback((targetCategoryId: string) => {
    if (selectedItemIds.size === 0) return
    void handleMoveItems(Array.from(selectedItemIds), targetCategoryId)
  }, [selectedItemIds, handleMoveItems])

  if (!hydrated) return null

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
        {/* Header - compact: override mb-6 from shared components */}
        <div className="bg-white border-b shrink-0 px-4 py-1 [&>div]:!mb-1 [&>.flex]:!mb-1">
          <AdminPageHeader
            title="Menu Items"
          />
        </div>

        {/* Categories Bar - Horizontal Scroll (droppable targets) */}
        <CategoriesBar
          categories={categories}
          isLoading={isLoading}
          selectedCategory={selectedCategory}
          categoriesScrollRef={categoriesScrollRef}
          isDraggingItem={!!activeDragItem}
          onSelectCategory={(id) => {
            setSelectedCategory(id)
            setSelectedItemForEditor(null)
            setSelectedGroupId(null)
            setItemSearch('')
            setSelectedItemIds(new Set())
          }}
          onEditCategory={(category) => {
            setEditingCategory(category)
            setShowCategoryModal(true)
          }}
          onAddCategory={() => {
            setEditingCategory(null)
            setShowCategoryModal(true)
          }}
        />

        {/* Items Bar - Horizontal Scroll (draggable items) */}
        {selectedCategory && (
          <ItemsBar
            filteredItems={filteredItems}
            selectedCategoryData={selectedCategoryData}
            selectedItemForEditor={selectedItemForEditor}
            dragOverItemId={dragOverItemId}
            itemSearch={itemSearch}
            itemSearchRef={itemSearchRef}
            itemsScrollRef={itemsScrollRef}
            selectedItemIds={selectedItemIds}
            categories={categories}
            onItemClick={handleItemClick}
            onCreateItem={handleCreateItem}
            onItemSearch={setItemSearch}
            onDragOverItem={setDragOverItemId}
            onCopyModifierGroup={handleCopyModifierGroup}
            onToggleSelection={toggleItemSelection}
            onMoveSelected={handleMoveSelected}
          />
        )}

        {/* Main Content Area - 3 Columns: Tree View + Editor + Modifier Groups Builder */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Tree View - Navigation map */}
          <div className={`shrink-0 transition-all duration-300 overflow-hidden ${
            selectedItemForEditor ? 'w-56' : 'w-0'
          }`}>
            <ItemTreeView
              item={selectedItemForEditor}
              refreshKey={refreshKey}
              selectedNode={selectedTreeNode}
              onSelectNode={(type, id) => setSelectedTreeNode({ type, id })}
            />
          </div>

          {/* CENTER: Item Editor (what's live on the front end) */}
          <div className="flex-1 overflow-hidden border-l">
            {!selectedCategory ? (
              <div className="h-full flex items-center justify-center text-gray-900 bg-gray-50">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <p className="font-medium">Select a category</p>
                  <p className="text-xs mt-1">Click on a category above</p>
                </div>
              </div>
            ) : !selectedItemForEditor ? (
              <div className="h-full flex items-center justify-center text-gray-900 bg-gray-50">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="font-medium">Select an item</p>
                  <p className="text-xs mt-1">Click on an item above</p>
                </div>
              </div>
            ) : (
              <ItemEditor
                item={selectedItemForEditor}
                ingredientsLibrary={ingredientsLibrary}
                ingredientCategories={ingredientCategories}
                locationId={employee?.location?.id || ''}
                refreshKey={refreshKey}
                selectedGroupId={selectedGroupId}
                selectedModifierId={selectedModifierId}
                onSelectGroup={handleSelectGroup}
                onSelectModifier={handleSelectModifier}
                onModifierGroupsChanged={setItemModifierGroups}
                onItemUpdated={() => {
                  loadMenu()
                  setRefreshKey(prev => prev + 1)
                }}
                onIngredientCreated={handleIngredientCreated}
                onCategoryCreated={handleCategoryCreated}
                onToggle86={handleToggleItem86}
                onDelete={(itemId) => {
                  handleDeleteItem(itemId)
                  setSelectedItemForEditor(null)
                  setSelectedGroupId(null)
                }}
              />
            )}
          </div>

          {/* RIGHT: Modifier Flow Editor */}
          <div className={`shrink-0 transition-all duration-300 overflow-hidden border-l ${
            selectedItemForEditor ? 'w-96' : 'w-0'
          }`}>
            <ModifierFlowEditor
              item={selectedItemForEditor}
              selectedGroupId={selectedGroupId}
              refreshKey={refreshKey}
              onGroupUpdated={() => {
                loadMenu()
                setRefreshKey(prev => prev + 1)
              }}
            />
          </div>

          {/* FAR RIGHT: Detail Panel (group settings or modifier detail) */}
          {rightPanelMode === 'group' && selectedGroupId && selectedItemForEditor && findSelectedGroup() && (
            <div className="w-80 border-l overflow-y-auto shrink-0">
              <ModifierGroupSettingsPanel
                group={findSelectedGroup()!}
                mode="full"
                onUpdate={(field, value) => handleGroupFieldUpdate(selectedGroupId, field, value)}
              />
            </div>
          )}
          {rightPanelMode === 'modifier' && selectedModifierId && selectedGroupId && selectedItemForEditor && findSelectedModifier() && findSelectedGroup() && (
            <div className="w-96 border-l overflow-y-auto shrink-0">
              <ModifierDetailPanel
                modifier={findSelectedModifier()!}
                group={findSelectedGroup()!}
                menuItemId={selectedItemForEditor.id}
                ingredients={ingredientsLibrary}
                printers={printers}
                onSave={handleModifierSave}
                onDiscard={() => {
                  setSelectedModifierId(null)
                  setRightPanelMode(selectedGroupId ? 'group' : null)
                }}
              />
            </div>
          )}
        </div>

        {/* Category Modal */}
        {showCategoryModal && (
          <CategoryModal
            category={editingCategory}
            printers={printers}
            kdsScreens={kdsScreens}
            onSave={handleSaveCategory}
            onClose={() => {
              setShowCategoryModal(false)
              setEditingCategory(null)
            }}
          />
        )}

        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction?.title || 'Confirm'}
          description={confirmAction?.message}
          confirmLabel="Delete"
          destructive
          onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />

      </div>

      {/* Drag overlay: shows floating ghost of the dragged item */}
      <DragOverlay dropAnimation={null}>
        {activeDragItem && (
          <div className="px-3 py-1.5 rounded-lg border-2 border-blue-500 bg-blue-50 shadow-lg text-left min-w-[120px] pointer-events-none">
            <div className="flex items-center justify-between gap-1">
              <span className="font-medium text-xs text-blue-700">
                {activeDragItem.name}
              </span>
            </div>
            {activeDragItem.price !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-600">
                  {formatCurrency(activeDragItem.price)}
                </span>
              </div>
            )}
            {selectedItemIds.has(activeDragItem.id) && selectedItemIds.size > 1 && (
              <div className="text-[9px] text-blue-500 mt-0.5">
                +{selectedItemIds.size - 1} more selected
              </div>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
