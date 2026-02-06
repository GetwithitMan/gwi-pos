'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useCachedFetch } from '@/hooks/useHierarchyCache'
import type { Ingredient } from './IngredientLibrary'

// Extended ingredient type with children
interface HierarchyIngredient extends Ingredient {
  childIngredients?: HierarchyIngredient[]
  childCount?: number
}

// Helper to collect all ingredient IDs including children
function collectAllIds(ingredients: HierarchyIngredient[]): string[] {
  const ids: string[] = []
  for (const ing of ingredients) {
    ids.push(ing.id)
    if (ing.childIngredients) {
      ids.push(...collectAllIds(ing.childIngredients))
    }
  }
  return ids
}

interface IngredientHierarchyProps {
  ingredients: HierarchyIngredient[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEdit: (ingredient: Ingredient) => void
  onDelete: (ingredient: Ingredient) => void
  onAddPreparation: (parent: Ingredient) => void
  onToggleActive: (ingredient: Ingredient) => void
  onVerify?: (ingredient: Ingredient) => void
}

export function IngredientHierarchy({
  ingredients,
  selectedIds,
  onToggleSelect,
  onEdit,
  onDelete,
  onAddPreparation,
  onToggleActive,
  onVerify,
}: IngredientHierarchyProps) {
  // Sort ingredients alphabetically
  const sortedIngredients = useMemo(() =>
    [...ingredients].sort((a, b) => a.name.localeCompare(b.name)),
    [ingredients]
  )

  return (
    <div className="space-y-1">
      {sortedIngredients.map(ingredient => (
        <HierarchyNode
          key={ingredient.id}
          ingredient={ingredient}
          depth={0}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddPreparation={onAddPreparation}
          onToggleActive={onToggleActive}
          onVerify={onVerify}
        />
      ))}
    </div>
  )
}

interface HierarchyNodeProps {
  ingredient: HierarchyIngredient
  depth: number
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEdit: (ingredient: Ingredient) => void
  onDelete: (ingredient: Ingredient) => void
  onAddPreparation: (parent: Ingredient) => void
  onToggleActive: (ingredient: Ingredient) => void
  onVerify?: (ingredient: Ingredient) => void
}

// Type for linked menu items
interface LinkedMenuItem {
  id: string
  menuItem: {
    id: string
    name: string
  }
  quantity?: number
}

// Type for recipe components
interface RecipeComponent {
  id: string
  componentId: string
  component: {
    id: string
    name: string
    standardQuantity?: number | null
    standardUnit?: string | null
    categoryRelation?: {
      id: string
      name: string
      icon?: string | null
      color?: string | null
    } | null
  }
  quantity: number
  unit: string
}

function HierarchyNode({
  ingredient,
  depth,
  selectedIds,
  onToggleSelect,
  onEdit,
  onDelete,
  onAddPreparation,
  onToggleActive,
}: HierarchyNodeProps) {
  // Default to collapsed for cleaner view
  const [isExpanded, setIsExpanded] = useState(false)
  // For prep items: show linked menu items
  const [showLinkedItems, setShowLinkedItems] = useState(false)
  const [linkedItems, setLinkedItems] = useState<LinkedMenuItem[]>([])
  // For inventory items: show recipe components
  const [showRecipe, setShowRecipe] = useState(false)
  const [recipeComponents, setRecipeComponents] = useState<RecipeComponent[]>([])

  // Use caching hooks for data fetching (5 min TTL)
  const linkedItemsCache = useCachedFetch<{ menuItemIngredients: LinkedMenuItem[] }>(5 * 60 * 1000)
  const recipeCache = useCachedFetch<RecipeComponent[]>(5 * 60 * 1000)

  const hasChildren = (ingredient.childIngredients?.length || 0) > 0 || (ingredient.childCount || 0) > 0

  const childCount = ingredient.childIngredients?.length || ingredient.childCount || 0
  const isSelected = selectedIds.has(ingredient.id)

  // Fetch linked menu items when expanded (for prep items) with caching
  const handleToggleLinkedItems = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (showLinkedItems) {
      setShowLinkedItems(false)
      return
    }

    setShowLinkedItems(true)
    if (linkedItems.length === 0) {
      const cacheKey = `linked-items-${ingredient.id}`
      const cached = await linkedItemsCache.fetchWithCache(
        cacheKey,
        async () => {
          const res = await fetch(`/api/ingredients/${ingredient.id}`)
          if (!res.ok) throw new Error('Failed to fetch linked items')
          const data = await res.json()
          return data.data
        }
      )

      if (cached?.menuItemIngredients) {
        setLinkedItems(cached.menuItemIngredients)
      }
    }
  }

  // Fetch recipe components when expanded (for inventory items) with caching
  const handleToggleRecipe = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (showRecipe) {
      setShowRecipe(false)
      return
    }

    setShowRecipe(true)
    if (recipeComponents.length === 0) {
      const cacheKey = `recipe-${ingredient.id}`
      const cached = await recipeCache.fetchWithCache(
        cacheKey,
        async () => {
          const res = await fetch(`/api/ingredients/${ingredient.id}/recipe`)
          if (!res.ok) throw new Error('Failed to fetch recipe')
          const data = await res.json()
          return data.data || []
        }
      )

      if (cached) {
        setRecipeComponents(cached)
      }
    }
  }

  // Row click handler - toggle expand if has children
  const handleRowClick = () => {
    if (hasChildren) {
      setIsExpanded(!isExpanded)
    }
  }

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-200' : ''}>
      <div
        className={`
          rounded border overflow-hidden
          ${depth === 0
            ? (!ingredient.categoryId && ingredient.isBaseIngredient !== false
                ? 'bg-gray-100 border-gray-300 border-dashed' // Uncategorized style
                : 'bg-blue-50 border-blue-200') // Inventory item style
            : 'bg-green-50 border-green-200'}
          ${!ingredient.isActive ? 'opacity-60' : ''}
          ${depth > 0 ? 'ml-1' : ''}
          ${isSelected ? 'ring-2 ring-blue-500 ring-inset' : ''}
          ${hasChildren ? 'cursor-pointer hover:brightness-95' : ''}
        `}
        onClick={handleRowClick}
      >
        {/* Main Row - Compact */}
        <div className="flex items-center px-2 py-1.5">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(ingredient.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-2 flex-shrink-0"
          />

          {/* Expand/Collapse or Leaf Icon */}
          <div className="w-5 flex-shrink-0">
            {hasChildren ? (
              <span className="w-5 h-5 flex items-center justify-center text-gray-500 text-xs">
                {isExpanded ? '▼' : '▶'}
              </span>
            ) : depth > 0 ? (
              <span className="text-gray-400 text-xs">•</span>
            ) : (
              <span className="text-gray-400 text-xs">•</span>
            )}
          </div>

          {/* Category Color Bar (only for root items) */}
          {depth === 0 && ingredient.categoryRelation?.color && (
            <div
              className="w-0.5 h-6 rounded mr-2"
              style={{ backgroundColor: ingredient.categoryRelation.color }}
            />
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Level indicator - full names */}
              {depth === 0 ? (
                // Check if uncategorized (no category and is a base ingredient)
                !ingredient.categoryId && ingredient.isBaseIngredient !== false ? (
                  <span className="px-1.5 py-0.5 bg-gray-400 text-white rounded text-[10px] font-bold uppercase whitespace-nowrap">
                    Unclassified
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase whitespace-nowrap">
                    Inventory Item
                  </span>
                )
              ) : (
                <span className="px-1.5 py-0.5 bg-green-600 text-white rounded text-[10px] font-bold uppercase whitespace-nowrap">
                  Prep Item
                </span>
              )}

              {/* Preparation type badge */}
              {depth > 0 && ingredient.preparationType && (
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] whitespace-nowrap">
                  {ingredient.preparationType}
                </span>
              )}

              {/* Daily count badge */}
              {depth > 0 && (ingredient as { isDailyCountItem?: boolean }).isDailyCountItem && (
                <span className="px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded text-[10px] font-medium whitespace-nowrap border border-amber-400">
                  📋 Daily
                </span>
              )}

              {/* Stock count badge for prep items with daily counting enabled */}
              {depth > 0 && (ingredient as { isDailyCountItem?: boolean; currentPrepStock?: number; lowStockThreshold?: number; criticalStockThreshold?: number }).isDailyCountItem && (() => {
                const ing = ingredient as { currentPrepStock?: number; lowStockThreshold?: number; criticalStockThreshold?: number; standardUnit?: string }
                const stock = ing.currentPrepStock ?? 0
                const critical = ing.criticalStockThreshold ?? 0
                const low = ing.lowStockThreshold ?? 0
                const isCritical = critical > 0 && stock <= critical
                const isLow = !isCritical && low > 0 && stock <= low
                return (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                    isCritical ? 'bg-red-100 text-red-700 border border-red-400' :
                    isLow ? 'bg-yellow-100 text-yellow-700 border border-yellow-400' :
                    'bg-green-100 text-green-700 border border-green-300'
                  }`}>
                    {isCritical ? '🔴' : isLow ? '🟡' : '📦'} {stock} {ing.standardUnit || ''}
                  </span>
                )
              })()}

              {/* Name - clickable to edit */}
              <span
                className="font-medium text-gray-900 truncate text-sm hover:text-blue-600 hover:underline cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(ingredient)
                }}
              >
                {ingredient.name}
              </span>

              {/* Yield Badge */}
              {ingredient.yieldPercent !== null && ingredient.yieldPercent !== undefined && (
                <span className="px-1 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">
                  {Math.round(ingredient.yieldPercent * 100)}%
                </span>
              )}

              {/* Child count inline */}
              {hasChildren && (
                <span className="text-[10px] text-gray-400">
                  ({childCount})
                </span>
              )}

              {/* Status badges - only show if not active */}
              {!ingredient.isActive && (
                <span className="px-1 py-0.5 bg-red-100 text-red-700 rounded text-[10px]">
                  Off
                </span>
              )}
              {ingredient.visibility === 'admin_only' && (
                <span className="px-1 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px]">
                  Admin
                </span>
              )}
              {ingredient.visibility === 'hidden' && (
                <span className="px-1 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                  Hidden
                </span>
              )}

              {/* Portion info inline */}
              {ingredient.standardQuantity && ingredient.standardUnit && (
                <span className="text-[10px] text-gray-400">
                  {ingredient.standardQuantity} {ingredient.standardUnit}
                </span>
              )}
            </div>
          </div>

          {/* Actions - compact */}
          <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
            {/* Add Prep Item button (only for base/inventory items) */}
            {ingredient.isBaseIngredient && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddPreparation(ingredient)}
                className="text-green-700 hover:text-green-800 hover:bg-green-100 h-6 px-2 text-xs"
              >
                +Prep
              </Button>
            )}

            {/* Show recipe button (for inventory items at depth 0) */}
            {depth === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleRecipe}
                className={`h-6 px-2 text-xs ${showRecipe ? 'bg-purple-100 text-purple-700' : 'text-purple-600 hover:bg-purple-50'}`}
                title="Show recipe ingredients"
              >
                📋 Recipe {showRecipe ? '▲' : '▼'}
              </Button>
            )}

            {/* Show linked items button (for prep items) */}
            {depth > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleLinkedItems}
                className={`h-6 px-2 text-xs ${showLinkedItems ? 'bg-indigo-100 text-indigo-700' : 'text-indigo-600 hover:bg-indigo-50'}`}
                title="Show menu items using this ingredient"
              >
                🔗 {showLinkedItems ? '▲' : '▼'}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(ingredient)}
              className="h-6 px-2 text-xs bg-white"
            >
              Edit
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 px-1.5 text-xs"
              onClick={() => onDelete(ingredient)}
            >
              ✕
            </Button>
          </div>
        </div>

        {/* Linked Menu Items Section (for prep items) */}
        {depth > 0 && showLinkedItems && (
          <div className="px-3 py-2 bg-indigo-50 border-t border-indigo-200">
            <div className="text-xs font-medium text-indigo-800 mb-1">
              Menu Items Using This Ingredient:
            </div>
            {linkedItemsCache.loading[`linked-items-${ingredient.id}`] ? (
              <div className="text-xs text-indigo-600">Loading...</div>
            ) : linkedItems.length === 0 ? (
              <div className="text-xs text-indigo-500 italic">No menu items linked yet</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {linkedItems.map(link => (
                  <span
                    key={link.id}
                    className="px-2 py-0.5 bg-white border border-indigo-200 rounded text-xs text-indigo-700"
                  >
                    {link.menuItem.name}
                    {link.quantity && <span className="text-indigo-400 ml-1">×{link.quantity}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recipe Components Section (for inventory items) */}
        {depth === 0 && showRecipe && (
          <div className="px-3 py-2 bg-purple-50 border-t border-purple-200">
            <div className="text-xs font-medium text-purple-800 mb-2">
              Recipe Ingredients:
            </div>
            {recipeCache.loading[`recipe-${ingredient.id}`] ? (
              <div className="text-xs text-purple-600">Loading recipe...</div>
            ) : recipeComponents.length === 0 ? (
              <div className="text-xs text-purple-500 italic">No recipe defined - this item is purchased as-is</div>
            ) : (
              <div className="space-y-1">
                {recipeComponents.map(comp => (
                  <div
                    key={comp.id}
                    className="flex items-center gap-2 px-2 py-1 bg-white border border-purple-200 rounded"
                  >
                    {comp.component.categoryRelation?.color && (
                      <div
                        className="w-1 h-4 rounded"
                        style={{ backgroundColor: comp.component.categoryRelation.color }}
                      />
                    )}
                    <span className="text-xs font-medium text-purple-700">
                      {comp.quantity} {comp.unit}
                    </span>
                    <span className="text-xs text-gray-700">
                      {comp.component.name}
                    </span>
                    {comp.component.categoryRelation && (
                      <span className="text-[10px] text-gray-400">
                        ({comp.component.categoryRelation.name})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Children - sorted alphabetically */}
      {isExpanded && ingredient.childIngredients && ingredient.childIngredients.length > 0 && (
        <div className="mt-1 space-y-1">
          {[...ingredient.childIngredients]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(child => (
              <HierarchyNode
                key={child.id}
                ingredient={child}
                depth={depth + 1}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddPreparation={onAddPreparation}
                onToggleActive={onToggleActive}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// Export grouped hierarchy view
interface GroupedHierarchyProps {
  categories: Array<{
    id: string
    code: number
    name: string
    icon?: string | null
    color?: string | null
    isActive?: boolean
  }>
  ingredients: HierarchyIngredient[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAllInCategory: (categoryId: string, ingredientIds: string[]) => void
  onEdit: (ingredient: Ingredient) => void
  onDelete: (ingredient: Ingredient) => void
  onAddPreparation: (parent: Ingredient) => void
  onToggleActive: (ingredient: Ingredient) => void
  onEditCategory?: (category: { id: string; name: string }) => void
}

// Zoom levels with corresponding scale
const ZOOM_LEVELS = [
  { label: 'XS', scale: 0.75 },
  { label: 'S', scale: 0.875 },
  { label: 'M', scale: 1 },
  { label: 'L', scale: 1.125 },
  { label: 'XL', scale: 1.25 },
]

export function GroupedIngredientHierarchy({
  categories,
  ingredients,
  selectedIds,
  onToggleSelect,
  onSelectAllInCategory,
  onEdit,
  onDelete,
  onAddPreparation,
  onToggleActive,
  onEditCategory,
}: GroupedHierarchyProps) {
  // Zoom state - default to Medium (index 2)
  const [zoomIndex, setZoomIndex] = useState(2)
  const zoom = ZOOM_LEVELS[zoomIndex]

  // Sort categories alphabetically
  const sortedCategories = useMemo(() =>
    [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  )

  // Group ingredients by category
  const grouped = new Map<string, HierarchyIngredient[]>()
  const uncategorized: HierarchyIngredient[] = []

  for (const ing of ingredients) {
    if (ing.categoryId) {
      if (!grouped.has(ing.categoryId)) {
        grouped.set(ing.categoryId, [])
      }
      grouped.get(ing.categoryId)!.push(ing)
    } else {
      uncategorized.push(ing)
    }
  }

  return (
    <div className="space-y-2">
      {/* Zoom Control */}
      <div className="flex items-center justify-end gap-2 mb-2">
        <span className="text-gray-500 text-sm">🔍</span>
        <div className="flex items-center border rounded-lg overflow-hidden">
          {ZOOM_LEVELS.map((level, idx) => (
            <button
              key={level.label}
              onClick={() => setZoomIndex(idx)}
              className={`px-2 py-1 text-xs font-medium transition-colors ${
                idx === zoomIndex
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              } ${idx > 0 ? 'border-l' : ''}`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scaled content wrapper */}
      <div
        style={{
          transform: `scale(${zoom.scale})`,
          transformOrigin: 'top left',
          width: `${100 / zoom.scale}%`,
        }}
        className="space-y-2"
      >
        {/* Categorized ingredients - sorted alphabetically */}
        {sortedCategories.map(category => {
          const categoryIngredients = grouped.get(category.id) || []
          if (categoryIngredients.length === 0) return null

          return (
            <CategoryHierarchySection
              key={category.id}
              category={category}
              ingredients={categoryIngredients}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onSelectAllInCategory={onSelectAllInCategory}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddPreparation={onAddPreparation}
              onToggleActive={onToggleActive}
              onEditCategory={onEditCategory}
            />
          )
        })}

        {/* Uncategorized */}
        {uncategorized.length > 0 && (
          <CategoryHierarchySection
            category={{
              id: 'uncategorized',
            code: 999,
            name: 'Uncategorized',
            icon: '?',
            color: '#6b7280',
          }}
          ingredients={uncategorized}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onSelectAllInCategory={onSelectAllInCategory}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddPreparation={onAddPreparation}
          onToggleActive={onToggleActive}
        />
        )}
      </div>
    </div>
  )
}

interface CategoryHierarchySectionProps {
  category: {
    id: string
    code: number
    name: string
    icon?: string | null
    color?: string | null
    isActive?: boolean
  }
  ingredients: HierarchyIngredient[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAllInCategory: (categoryId: string, ingredientIds: string[]) => void
  onEdit: (ingredient: Ingredient) => void
  onDelete: (ingredient: Ingredient) => void
  onAddPreparation: (parent: Ingredient) => void
  onToggleActive: (ingredient: Ingredient) => void
  onEditCategory?: (category: { id: string; name: string }) => void
}

function CategoryHierarchySection({
  category,
  ingredients,
  selectedIds,
  onToggleSelect,
  onSelectAllInCategory,
  onEdit,
  onDelete,
  onAddPreparation,
  onToggleActive,
  onEditCategory,
}: CategoryHierarchySectionProps) {
  // Default to collapsed - less overwhelming when opening the page
  const [isExpanded, setIsExpanded] = useState(false)

  // Collect all IDs in this category (including children)
  const allIdsInCategory = useMemo(() => collectAllIds(ingredients), [ingredients])

  // Calculate selection state
  const selectedInCategory = useMemo(
    () => allIdsInCategory.filter(id => selectedIds.has(id)).length,
    [allIdsInCategory, selectedIds]
  )
  const allSelectedInCategory = allIdsInCategory.length > 0 && selectedInCategory === allIdsInCategory.length
  const someSelectedInCategory = selectedInCategory > 0 && selectedInCategory < allIdsInCategory.length

  // Count total ingredients including children
  const totalCount = allIdsInCategory.length

  const handleSelectAllInCategory = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectAllInCategory(category.id, allIdsInCategory)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      {/* Category Header - Compact */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ borderLeft: `3px solid ${category.color || '#6b7280'}` }}
      >
        <div className="flex items-center gap-2">
          {/* Select All in Category Checkbox */}
          {allIdsInCategory.length > 0 && (
            <input
              type="checkbox"
              checked={allSelectedInCategory}
              ref={(el) => {
                if (el) el.indeterminate = someSelectedInCategory
              }}
              onChange={() => {}}
              onClick={handleSelectAllInCategory}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              title={`Select all ${allIdsInCategory.length} ingredients in ${category.name}`}
            />
          )}

          <span className="text-lg">{category.icon || '?'}</span>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">
              {category.name}
            </h3>
            <span className="text-xs text-gray-400">
              {ingredients.length} inv / {totalCount - ingredients.length} prep
            </span>
            {selectedInCategory > 0 && (
              <span className="text-xs text-blue-600">
                ({selectedInCategory} sel)
              </span>
            )}
            {category.isActive === false && (
              <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">
                Off
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onEditCategory && category.id !== 'uncategorized' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onEditCategory(category)
              }}
              className="h-6 px-2 text-xs"
            >
              Edit
            </Button>
          )}
          <span className="text-gray-400 text-sm">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Ingredients */}
      {isExpanded && (
        <div className="p-2 border-t bg-gray-50">
          <IngredientHierarchy
            ingredients={ingredients}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddPreparation={onAddPreparation}
            onToggleActive={onToggleActive}
          />
        </div>
      )}
    </div>
  )
}
