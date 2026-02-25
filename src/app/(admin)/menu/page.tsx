'use client'

import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemTreeView } from '@/components/menu/ItemTreeView'
import { ItemEditor } from '@/components/menu/ItemEditor'
import { ModifierFlowEditor } from '@/components/menu/ModifierFlowEditor'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useMenuData } from './hooks/useMenuData'
import { CategoriesBar } from './components/CategoriesBar'
import { ItemsBar } from './components/ItemsBar'
import { CategoryModal } from './components/CategoryModal'

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
  } = useMenuData()

  if (!hydrated) return null

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* Header - compact: override mb-6 from shared components */}
      <div className="bg-white border-b shrink-0 px-4 py-1 [&>div]:!mb-1 [&>.flex]:!mb-1">
        <AdminPageHeader
          title="Menu Items"
        />
      </div>

      {/* Categories Bar - Horizontal Scroll */}
      <CategoriesBar
        categories={categories}
        isLoading={isLoading}
        selectedCategory={selectedCategory}
        categoriesScrollRef={categoriesScrollRef}
        onSelectCategory={(id) => {
          setSelectedCategory(id)
          setSelectedItemForEditor(null)
          setSelectedGroupId(null)
          setItemSearch('')
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

      {/* Items Bar - Horizontal Scroll */}
      {selectedCategory && (
        <ItemsBar
          filteredItems={filteredItems}
          selectedCategoryData={selectedCategoryData}
          selectedItemForEditor={selectedItemForEditor}
          dragOverItemId={dragOverItemId}
          itemSearch={itemSearch}
          itemSearchRef={itemSearchRef}
          itemsScrollRef={itemsScrollRef}
          onItemClick={handleItemClick}
          onCreateItem={handleCreateItem}
          onItemSearch={setItemSearch}
          onDragOverItem={setDragOverItemId}
          onCopyModifierGroup={handleCopyModifierGroup}
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
            <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="font-medium">Select a category</p>
                <p className="text-xs mt-1">Click on a category above</p>
              </div>
            </div>
          ) : !selectedItemForEditor ? (
            <div className="h-full flex items-center justify-center text-gray-400 bg-gray-50">
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
              onSelectGroup={setSelectedGroupId}
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
  )
}
