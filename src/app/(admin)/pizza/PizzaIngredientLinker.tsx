'use client'

import { useState } from 'react'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import { IngredientHierarchyPicker } from '@/components/menu/IngredientHierarchyPicker'
import type { IngredientLibraryItem, IngredientCategory } from '@/components/menu/IngredientHierarchyPicker'

export interface PizzaIngredientLinkerProps {
  inventoryItemId: string
  setInventoryItemId: (id: string) => void
  selectedItemName: string
  setSelectedItemName: (name: string) => void
  usageQuantity: string
  setUsageQuantity: (val: string) => void
  usageUnit: string
  setUsageUnit: (val: string) => void
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories: IngredientCategory[]
  ingredientInventoryMap: Record<string, string>
  onIngredientCreated: (ingredient: any) => void
  onCategoryCreated: (category: any) => void
  onIngredientDataRefresh: () => void
  /** Label for what component type this is (e.g., "topping", "crust") — used in messages */
  componentLabel?: string
}

export function PizzaIngredientLinker({
  inventoryItemId, setInventoryItemId,
  selectedItemName, setSelectedItemName,
  usageQuantity, setUsageQuantity,
  usageUnit, setUsageUnit,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
  componentLabel = 'item',
}: PizzaIngredientLinkerProps) {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id || ''

  // Picker state
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [creatingNewCategory, setCreatingNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingInventoryInCategory, setCreatingInventoryInCategory] = useState<string | null>(null)
  const [newInventoryName, setNewInventoryName] = useState('')
  const [creatingPrepUnderParent, setCreatingPrepUnderParent] = useState<string | null>(null)
  const [newPrepName, setNewPrepName] = useState('')
  const [creatingIngredientLoading, setCreatingIngredientLoading] = useState(false)

  const handleLinkIngredient = async (ingredientId: string) => {
    const ingredient = ingredientsLibrary.find(i => i.id === ingredientId)
    if (!ingredient) return

    let resolvedInventoryItemId = ingredientInventoryMap[ingredientId]

    if (!resolvedInventoryItemId && ingredient.parentIngredientId) {
      resolvedInventoryItemId = ingredientInventoryMap[ingredient.parentIngredientId]
    }

    // Fallback: search InventoryItem by exact name match
    if (!resolvedInventoryItemId) {
      try {
        const res = await fetch(`/api/inventory/items?search=${encodeURIComponent(ingredient.name)}&activeOnly=true&limit=10`)
        if (res.ok) {
          const data = await res.json()
          const items = data.data || data
          const exact = items.find((i: any) => i.name.toLowerCase() === ingredient.name.toLowerCase())
          if (exact) resolvedInventoryItemId = exact.id
        }
      } catch { /* ignore */ }
    }

    if (resolvedInventoryItemId) {
      setInventoryItemId(resolvedInventoryItemId)
      setSelectedItemName(ingredient.name)
    } else {
      toast.warning(`No matching inventory item for "${ingredient.name}". Create one in Inventory Management first.`)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !locationId) return
    setCreatingIngredientLoading(true)
    try {
      const res = await fetch('/api/ingredient-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newCategoryName.trim(),
          needsVerification: true,
          requestingEmployeeId: employee?.id,
        }),
      })
      if (res.ok) {
        const { data } = await res.json()
        onCategoryCreated(data)
        setNewCategoryName('')
        setCreatingNewCategory(false)
        toast.success(`Created category "${data.name}"`)
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create category')
      }
    } catch { toast.error('Failed to create category') }
    finally { setCreatingIngredientLoading(false) }
  }

  const handleCreateInventoryItem = async (categoryId: string) => {
    if (!newInventoryName.trim() || !locationId) return
    setCreatingIngredientLoading(true)
    try {
      const res = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newInventoryName.trim(),
          categoryId,
          parentIngredientId: null,
          needsVerification: true,
          isBaseIngredient: true,
          requestingEmployeeId: employee?.id,
        }),
      })
      if (res.ok) {
        const { data } = await res.json()
        onIngredientCreated(data)
        setNewInventoryName('')
        setCreatingInventoryInCategory(null)
        toast.success(`Created "${data.name}"`)
        void onIngredientDataRefresh()
      } else if (res.status === 409) {
        const err = await res.json().catch(() => ({}))
        toast.info(`"${err.existing?.name || newInventoryName}" already exists`)
        setNewInventoryName('')
        setCreatingInventoryInCategory(null)
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create ingredient')
      }
    } catch { toast.error('Failed to create ingredient') }
    finally { setCreatingIngredientLoading(false) }
  }

  const handleCreatePrepItem = async (parentId: string, categoryId: string) => {
    if (!newPrepName.trim() || !locationId) return
    setCreatingIngredientLoading(true)
    try {
      const res = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newPrepName.trim(),
          categoryId,
          parentIngredientId: parentId,
          needsVerification: true,
          isBaseIngredient: false,
          requestingEmployeeId: employee?.id,
        }),
      })
      if (res.ok) {
        const { data } = await res.json()
        onIngredientCreated(data)
        setNewPrepName('')
        setCreatingPrepUnderParent(null)
        toast.success(`Created "${data.name}"`)
        void onIngredientDataRefresh()
      } else if (res.status === 409) {
        const err = await res.json().catch(() => ({}))
        toast.info(`"${err.existing?.name || newPrepName}" already exists`)
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create prep item')
      }
    } catch { toast.error('Failed to create prep item') }
    finally { setCreatingIngredientLoading(false) }
  }

  if (selectedItemName && inventoryItemId) {
    return (
      <div className="border-t pt-4 mt-2">
        <p className="text-sm font-semibold text-gray-900 mb-3">Inventory & Cost Tracking</p>
        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg mb-3">
          <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold">LINKED</span>
          <span className="flex-1 text-sm font-medium text-green-800">{selectedItemName}</span>
          <button
            type="button"
            onClick={() => {
              setInventoryItemId('')
              setSelectedItemName('')
              setUsageQuantity('')
            }}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            Unlink
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Usage per Whole Pizza</label>
            <input
              type="number"
              step="0.01"
              value={usageQuantity}
              onChange={(e) => setUsageQuantity(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="2.0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unit</label>
            <select
              value={usageUnit}
              onChange={(e) => setUsageUnit(e.target.value)}
              className="w-full p-2 border rounded-lg"
            >
              <option value="oz">oz</option>
              <option value="g">grams</option>
              <option value="lb">lb</option>
              <option value="kg">kg</option>
              <option value="each">each</option>
              <option value="slice">slices</option>
              <option value="cup">cups</option>
              <option value="tbsp">tbsp</option>
              <option value="tsp">tsp</option>
              <option value="fl_oz">fl oz</option>
            </select>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t pt-4 mt-2">
      <p className="text-sm font-semibold text-gray-900 mb-3">Inventory & Cost Tracking</p>
      <p className="text-xs text-gray-900 mb-2">
        Browse ingredients below and click &quot;Link&quot; to connect this {componentLabel} to an inventory item for cost tracking and automatic deductions.
      </p>
      <IngredientHierarchyPicker
        ingredientsLibrary={ingredientsLibrary}
        ingredientCategories={ingredientCategories}
        searchTerm={ingredientSearch}
        onSearchChange={setIngredientSearch}
        searchPlaceholder="Search ingredients..."
        actionLabel="Link"
        actionColor="green"
        onAction={handleLinkIngredient}
        showAvailableCount
        maxHeight="max-h-64"
        showCategoryCreation
        showInventoryCreation
        creatingNewCategory={creatingNewCategory}
        setCreatingNewCategory={setCreatingNewCategory}
        newCategoryName={newCategoryName}
        setNewCategoryName={setNewCategoryName}
        onCreateCategory={handleCreateCategory}
        creatingInventoryInCategory={creatingInventoryInCategory}
        setCreatingInventoryInCategory={setCreatingInventoryInCategory}
        newInventoryName={newInventoryName}
        setNewInventoryName={setNewInventoryName}
        onCreateInventoryItem={handleCreateInventoryItem}
        creatingPrepUnderParent={creatingPrepUnderParent}
        setCreatingPrepUnderParent={setCreatingPrepUnderParent}
        newPrepName={newPrepName}
        setNewPrepName={setNewPrepName}
        onCreatePrepItem={handleCreatePrepItem}
        creatingIngredientLoading={creatingIngredientLoading}
        createPrepLabel="Create & Link"
      />
    </div>
  )
}
