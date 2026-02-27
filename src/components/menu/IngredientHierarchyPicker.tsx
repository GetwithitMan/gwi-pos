'use client'

import { useState, useEffect } from 'react'

export interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
  categoryName: string | null
  categoryId: string | null
  parentIngredientId: string | null
  parentName: string | null
  needsVerification: boolean
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
  needsVerification?: boolean
}

type HierarchyData = Record<string, {
  category: IngredientCategory
  baseIngredients: IngredientLibraryItem[]
  parents: Record<string, {
    parent: IngredientLibraryItem | null
    prepItems: IngredientLibraryItem[]
  }>
}>

interface IngredientHierarchyPickerProps {
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories: IngredientCategory[]
  searchTerm: string
  onSearchChange: (term: string) => void
  searchPlaceholder?: string
  /** Label for the action button on prep items (e.g., "Link", "+ Add") */
  actionLabel: string
  /** Color scheme for action button: 'purple' | 'green' */
  actionColor?: 'purple' | 'green'
  /** Called when user clicks the action button on a prep item */
  onAction: (ingredientId: string) => void
  /** IDs to exclude from the list (already added ingredients) */
  excludeIds?: Set<string>
  /** Show total available count in category headers */
  showAvailableCount?: boolean
  /** Max height for the scrollable list */
  maxHeight?: string
  /** Show the "New Category" creation form */
  showCategoryCreation?: boolean
  /** Show the inventory item creation form per category */
  showInventoryCreation?: boolean
  // Creation callbacks (shared state from parent)
  creatingNewCategory: boolean
  setCreatingNewCategory: (v: boolean) => void
  newCategoryName: string
  setNewCategoryName: (v: string) => void
  onCreateCategory: () => void
  creatingInventoryInCategory: string | null
  setCreatingInventoryInCategory: (v: string | null) => void
  newInventoryName: string
  setNewInventoryName: (v: string) => void
  onCreateInventoryItem: (categoryId: string) => void
  creatingPrepUnderParent: string | null
  setCreatingPrepUnderParent: (v: string | null) => void
  newPrepName: string
  setNewPrepName: (v: string) => void
  onCreatePrepItem: (parentId: string, categoryId: string) => void
  creatingIngredientLoading: boolean
  /** Label for the prep item create button (e.g., "Create & Link", "Create & Add", "Create") */
  createPrepLabel?: string
}

function buildHierarchy(
  ingredientsLibrary: IngredientLibraryItem[],
  ingredientCategories: IngredientCategory[],
  searchTerm: string = ''
): HierarchyData {
  const hierarchy: HierarchyData = {}

  const filteredIngredients = searchTerm.trim()
    ? ingredientsLibrary.filter(ing =>
        ing.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : ingredientsLibrary

  const baseIngredients = filteredIngredients.filter(ing => !ing.parentIngredientId)
  const prepItems = filteredIngredients.filter(ing => ing.parentIngredientId)

  const relevantCategoryIds = searchTerm.trim()
    ? new Set([...baseIngredients, ...prepItems].map(p => p.categoryId).filter(Boolean) as string[])
    : new Set(ingredientCategories.map(c => c.id))

  ingredientCategories
    .filter(cat => cat.isActive && (relevantCategoryIds.size === 0 || relevantCategoryIds.has(cat.id)))
    .forEach(cat => {
      hierarchy[cat.id] = { category: cat, baseIngredients: [], parents: {} }
    })

  baseIngredients.forEach(base => {
    const catId = base.categoryId || 'uncategorized'
    if (!hierarchy[catId]) {
      hierarchy[catId] = {
        category: {
          id: 'uncategorized', code: 0, name: 'Uncategorized',
          icon: null, color: null, sortOrder: 999, isActive: true, ingredientCount: 0,
        },
        baseIngredients: [],
        parents: {},
      }
    }
    hierarchy[catId].baseIngredients.push(base)
  })

  prepItems.forEach(prep => {
    const catId = prep.categoryId || 'uncategorized'
    if (!hierarchy[catId]) {
      hierarchy[catId] = {
        category: {
          id: 'uncategorized', code: 0, name: 'Uncategorized',
          icon: null, color: null, sortOrder: 999, isActive: true, ingredientCount: 0,
        },
        baseIngredients: [],
        parents: {},
      }
    }
    const parentId = prep.parentIngredientId || 'standalone'
    if (!hierarchy[catId].parents[parentId]) {
      const parentIng = ingredientsLibrary.find(i => i.id === prep.parentIngredientId)
      hierarchy[catId].parents[parentId] = { parent: parentIng || null, prepItems: [] }
    }
    hierarchy[catId].parents[parentId].prepItems.push(prep)
  })

  return hierarchy
}

// Inline prep item creation form
function InlinePrepItemForm({
  parentId,
  categoryId,
  newPrepName,
  setNewPrepName,
  onCreatePrepItem,
  onCancel,
  creatingIngredientLoading,
  createLabel,
}: {
  parentId: string
  categoryId: string
  newPrepName: string
  setNewPrepName: (v: string) => void
  onCreatePrepItem: (parentId: string, categoryId: string) => void
  onCancel: () => void
  creatingIngredientLoading: boolean
  createLabel: string
}) {
  return (
    <div className="px-3 py-2 bg-green-50 border-b border-green-200">
      <input
        type="text"
        value={newPrepName}
        onChange={(e) => setNewPrepName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCreatePrepItem(parentId, categoryId)
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="New prep item name..."
        className="w-full px-2 py-1 text-xs border rounded mb-1"
        autoFocus
        disabled={creatingIngredientLoading}
      />
      <div className="flex gap-1">
        <button
          onClick={() => onCreatePrepItem(parentId, categoryId)}
          className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          disabled={!newPrepName.trim() || creatingIngredientLoading}
        >
          {createLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
          disabled={creatingIngredientLoading}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function IngredientHierarchyPicker({
  ingredientsLibrary,
  ingredientCategories,
  searchTerm,
  onSearchChange,
  searchPlaceholder = 'Search ingredients...',
  actionLabel,
  actionColor = 'green',
  onAction,
  excludeIds,
  showAvailableCount = false,
  maxHeight = 'max-h-96',
  showCategoryCreation = true,
  showInventoryCreation = true,
  creatingNewCategory,
  setCreatingNewCategory,
  newCategoryName,
  setNewCategoryName,
  onCreateCategory,
  creatingInventoryInCategory,
  setCreatingInventoryInCategory,
  newInventoryName,
  setNewInventoryName,
  onCreateInventoryItem,
  creatingPrepUnderParent,
  setCreatingPrepUnderParent,
  newPrepName,
  setNewPrepName,
  onCreatePrepItem,
  creatingIngredientLoading,
  createPrepLabel = 'Create',
}: IngredientHierarchyPickerProps) {
  // Own expand/collapse state — no state bleed between picker instances
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const toggleParent = (parentId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  // Auto-expand on search
  useEffect(() => {
    if (searchTerm.trim()) {
      const hierarchy = buildHierarchy(ingredientsLibrary, ingredientCategories, searchTerm)
      const categoriesToExpand = new Set<string>()
      const parentsToExpand = new Set<string>()

      Object.entries(hierarchy).forEach(([catId, catData]) => {
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
  }, [searchTerm, ingredientsLibrary, ingredientCategories])

  const actionBtnClass = actionColor === 'purple'
    ? 'bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800'
    : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'

  const hierarchy = buildHierarchy(ingredientsLibrary, ingredientCategories, searchTerm)
  const sortedCategories = Object.values(hierarchy).sort((a, b) =>
    a.category.sortOrder - b.category.sortOrder
  )

  // Handle prep form cancel via Escape — clear parent selection
  const handlePrepCancel = () => {
    setCreatingPrepUnderParent(null)
    setNewPrepName('')
  }

  return (
    <>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        className="w-full px-2 py-1 text-xs border rounded mb-1"
        autoFocus
      />

      {/* New Category inline form */}
      {showCategoryCreation && (
        creatingNewCategory ? (
          <div className="px-2 py-1.5 bg-amber-50 border border-amber-200 rounded mb-1">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreateCategory()
                if (e.key === 'Escape') { setCreatingNewCategory(false); setNewCategoryName('') }
              }}
              placeholder="New category name..."
              className="w-full px-2 py-1 text-xs border rounded mb-1"
              autoFocus
              disabled={creatingIngredientLoading}
            />
            <div className="flex gap-1">
              <button
                onClick={onCreateCategory}
                className="flex-1 px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                disabled={!newCategoryName.trim() || creatingIngredientLoading}
              >
                Create Category
              </button>
              <button
                onClick={() => { setCreatingNewCategory(false); setNewCategoryName('') }}
                className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                disabled={creatingIngredientLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreatingNewCategory(true)}
            className="w-full px-2 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 mb-1 font-medium"
          >
            + New Category
          </button>
        )
      )}

      <div className={`${maxHeight} overflow-y-auto space-y-0.5`}>
        {sortedCategories.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-2">
            {searchTerm ? 'No matching ingredients' : 'No ingredient categories found'}
          </div>
        ) : (
          sortedCategories.map(({ category, baseIngredients: catBase, parents }) => {
            const isExpanded = expandedCategories.has(category.id)

            // Build unified list
            const inventoryItems = catBase
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(base => ({
                item: base,
                children: (parents[base.id]?.prepItems || [])
                  .filter(pr => !excludeIds?.has(pr.id))
                  .sort((a, b) => a.name.localeCompare(b.name)),
              }))

            const baseIds = new Set(catBase.map(b => b.id))
            const orphanParents = Object.entries(parents)
              .filter(([pid]) => !baseIds.has(pid))
              .map(([pid, { parent: p, prepItems }]) => ({
                item: p,
                parentId: pid,
                children: prepItems
                  .filter(pr => !excludeIds?.has(pr.id))
                  .sort((a, b) => a.name.localeCompare(b.name)),
              }))
              .filter(g => g.children.length > 0)
              .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))

            // Compute available count if needed
            const totalAvailable = showAvailableCount
              ? (inventoryItems.filter(iv => !excludeIds?.has(iv.item.id)).length
                + inventoryItems.reduce((sum, iv) => sum + iv.children.length, 0)
                + orphanParents.reduce((sum, op) => sum + op.children.length, 0))
              : 0

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

                  {showAvailableCount && (
                    <span className="text-[9px] text-gray-400 font-normal">{totalAvailable}</span>
                  )}

                  {/* Unverified count badge */}
                  {(() => {
                    const baseUnverified = catBase.filter(b => b.needsVerification).length
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

                  {showInventoryCreation && (
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
                  )}
                </div>

                {/* Inline Inventory Item Creation Form */}
                {showInventoryCreation && creatingInventoryInCategory === category.id && (
                  <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                    <input
                      type="text"
                      value={newInventoryName}
                      onChange={(e) => setNewInventoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onCreateInventoryItem(category.id)
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
                        onClick={() => onCreateInventoryItem(category.id)}
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
                    {/* Inventory items (BLUE) */}
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
                            {hasChildren && (
                              <span className="text-[9px] text-blue-400 shrink-0">{children.length} prep</span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); if (!isBaseExpanded) toggleParent(base.id); setCreatingPrepUnderParent(base.id) }}
                              className="text-[11px] text-green-600 hover:text-green-700 font-bold shrink-0 px-1"
                              title="Add prep item"
                            >+</button>
                          </div>
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
                                    onClick={() => onAction(prep.id)}
                                    className={`px-2.5 py-0.5 text-[9px] font-bold rounded shrink-0 ${actionBtnClass}`}
                                  >
                                    {actionLabel}
                                  </button>
                                </div>
                              ))}
                              {creatingPrepUnderParent === base.id ? (
                                <InlinePrepItemForm
                                  parentId={base.id}
                                  categoryId={category.id}
                                  newPrepName={newPrepName}
                                  setNewPrepName={setNewPrepName}
                                  onCancel={handlePrepCancel}
                                  onCreatePrepItem={onCreatePrepItem}
                                  creatingIngredientLoading={creatingIngredientLoading}
                                  createLabel={createPrepLabel}
                                />
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

                    {/* Orphan parents (BLUE header + GREEN children) */}
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
                                    onClick={() => onAction(prep.id)}
                                    className={`px-2.5 py-0.5 text-[9px] font-bold rounded shrink-0 ${actionBtnClass}`}
                                  >
                                    {actionLabel}
                                  </button>
                                </div>
                              ))}
                              {creatingPrepUnderParent === pid ? (
                                <InlinePrepItemForm
                                  parentId={pid}
                                  categoryId={category.id}
                                  newPrepName={newPrepName}
                                  setNewPrepName={setNewPrepName}
                                  onCancel={handlePrepCancel}
                                  onCreatePrepItem={onCreatePrepItem}
                                  creatingIngredientLoading={creatingIngredientLoading}
                                  createLabel={createPrepLabel}
                                />
                              ) : (
                                <button
                                  onClick={() => setCreatingPrepUnderParent(pid)}
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
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
