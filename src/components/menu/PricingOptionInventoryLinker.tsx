'use client'

import { useState, useEffect, useCallback } from 'react'
import { IngredientHierarchyPicker } from './IngredientHierarchyPicker'
import type { IngredientLibraryItem } from './IngredientHierarchyPicker'
import { toast } from '@/stores/toast-store'

const USAGE_UNITS = ['each', 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'] as const

interface InventoryLink {
  id: string
  prepItemId: string | null
  inventoryItemId: string | null
  ingredientId?: string | null
  prepItem?: { name: string; unitCost: number | null } | null
  inventoryItem?: { name: string; unitCost: number | null } | null
  ingredient?: { id: string; name: string; unit: string | null } | null
  usageQuantity: number
  usageUnit: string
  calculatedCost: number | null
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

interface PricingOptionInventoryLinkerProps {
  optionId: string
  itemId: string
  groupId: string
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories: IngredientCategory[]
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onCategoryCreated?: (category: IngredientCategory) => void
  locationId: string
}

export function PricingOptionInventoryLinker({
  optionId,
  itemId,
  groupId,
  ingredientsLibrary,
  ingredientCategories,
  onIngredientCreated,
  onCategoryCreated,
  locationId,
}: PricingOptionInventoryLinkerProps) {
  const [expanded, setExpanded] = useState(false)
  const [links, setLinks] = useState<InventoryLink[]>([])
  const [loading, setLoading] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  // Picker state
  const [searchTerm, setSearchTerm] = useState('')

  // Ingredient creation state (required by IngredientHierarchyPicker)
  const [creatingNewCategory, setCreatingNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingInventoryInCategory, setCreatingInventoryInCategory] = useState<string | null>(null)
  const [newInventoryName, setNewInventoryName] = useState('')
  const [creatingPrepUnderParent, setCreatingPrepUnderParent] = useState<string | null>(null)
  const [newPrepName, setNewPrepName] = useState('')
  const [creatingIngredientLoading, setCreatingIngredientLoading] = useState(false)

  const basePath = `/api/menu/items/${itemId}/pricing-options/${groupId}/options/${optionId}/inventory-links`

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(basePath)
      if (!res.ok) throw new Error('Failed to load')
      const raw = await res.json()
      setLinks(raw.data ?? [])
    } catch {
      // Silent on first load — endpoint may not exist yet
    } finally {
      setLoading(false)
    }
  }, [basePath])

  // Fetch when expanded
  useEffect(() => {
    if (expanded) {
      fetchLinks()
    }
  }, [expanded, fetchLinks])

  const handleAddLink = async (ingredientId: string) => {
    setShowPicker(false)
    setSearchTerm('')

    // Optimistic: add a placeholder
    const libItem = ingredientsLibrary.find(i => i.id === ingredientId)
    const optimisticId = `temp-${Date.now()}`
    const optimisticLink: InventoryLink = {
      id: optimisticId,
      prepItemId: null,
      inventoryItemId: null,
      prepItem: { name: libItem?.name ?? 'Adding...', unitCost: null },
      usageQuantity: 1,
      usageUnit: 'each',
      calculatedCost: null,
    }
    setLinks(prev => [...prev, optimisticLink])

    try {
      const res = await fetch(basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId, usageQuantity: 1, usageUnit: 'each' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to add link' }))
        toast.error(err.error || 'Failed to add link')
        // Rollback optimistic
        setLinks(prev => prev.filter(l => l.id !== optimisticId))
        return
      }
      const raw = await res.json()
      const newLink = raw.data
      // Replace optimistic with real
      setLinks(prev => prev.map(l => l.id === optimisticId ? newLink : l))
    } catch {
      toast.error('Failed to add inventory link')
      setLinks(prev => prev.filter(l => l.id !== optimisticId))
    }
  }

  const handleRemoveLink = async (linkId: string) => {
    // Optimistic removal
    const removed = links.find(l => l.id === linkId)
    setLinks(prev => prev.filter(l => l.id !== linkId))

    try {
      const res = await fetch(`${basePath}/${linkId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to remove link')
        if (removed) setLinks(prev => [...prev, removed])
      }
    } catch {
      toast.error('Failed to remove link')
      if (removed) setLinks(prev => [...prev, removed])
    }
  }

  const handleUpdateLink = async (linkId: string, data: { usageQuantity?: number; usageUnit?: string }) => {
    // Optimistic update
    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, ...data } : l))

    try {
      const res = await fetch(`${basePath}/${linkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        toast.error('Failed to update link')
        fetchLinks()
        return
      }
      const raw = await res.json()
      const updated = raw.data
      if (updated) {
        setLinks(prev => prev.map(l => l.id === linkId ? updated : l))
      }
    } catch {
      toast.error('Failed to update link')
      fetchLinks()
    }
  }

  // Ingredient creation callbacks
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    setCreatingIngredientLoading(true)
    try {
      const res = await fetch('/api/ingredient-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, name: newCategoryName.trim(), needsVerification: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create category')
        return
      }
      const { data } = await res.json()
      onCategoryCreated?.(data)
      setNewCategoryName('')
      setCreatingNewCategory(false)
      setCreatingInventoryInCategory(data.id)
      toast.success(`Created "${data.name}"`)
    } catch {
      toast.error('Failed to create category')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  const handleCreateInventoryItem = async (categoryId: string) => {
    if (!newInventoryName.trim()) return
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
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create inventory item')
        return
      }
      const { data } = await res.json()
      onIngredientCreated?.(data)
      setNewInventoryName('')
      setCreatingInventoryInCategory(null)
      setCreatingPrepUnderParent(data.id)
      toast.success(`Created "${data.name}" -- now add a prep item`)
    } catch {
      toast.error('Failed to create inventory item')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  const handleCreatePrepItem = async (parentId: string, categoryId: string) => {
    if (!newPrepName.trim()) return
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
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create prep item')
        return
      }
      const { data } = await res.json()
      onIngredientCreated?.(data)
      setNewPrepName('')
      setCreatingPrepUnderParent(null)

      // Auto-link the newly created prep item
      await handleAddLink(data.id)
      toast.success(`Created and linked "${data.name}"`)
    } catch {
      toast.error('Failed to create prep item')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  const totalCost = links.reduce((sum, l) => sum + (l.calculatedCost ?? 0), 0)
  const linkedIds = new Set(links.map(l => l.prepItemId ?? l.inventoryItemId).filter(Boolean) as string[])

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 font-medium"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Link Inventory
        {links.length > 0 && (
          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">
            {links.length}
          </span>
        )}
        {totalCost > 0 && (
          <span className="text-[10px] text-gray-500 font-normal ml-1">
            (${totalCost.toFixed(2)})
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-2 border-l-2 border-purple-200 pl-2 space-y-1.5">
          {loading ? (
            <div className="text-[11px] text-gray-400 py-1">Loading...</div>
          ) : (
            <>
              {/* Linked items list */}
              {links.length > 0 ? (
                <div className="space-y-1">
                  {links.map(link => (
                    <LinkedItemRow
                      key={link.id}
                      link={link}
                      onRemove={() => handleRemoveLink(link.id)}
                      onUpdate={(data) => handleUpdateLink(link.id, data)}
                    />
                  ))}
                  {totalCost > 0 && (
                    <div className="flex items-center justify-between pt-1 border-t border-purple-100">
                      <span className="text-[10px] font-semibold text-gray-500">Total cost</span>
                      <span className="text-[11px] font-bold text-gray-700">${totalCost.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-gray-400 py-0.5">No inventory linked yet.</p>
              )}

              {/* Add button / picker toggle */}
              {showPicker ? (
                <div className="bg-purple-50 border border-purple-200 rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-purple-700">Select Prep Item</span>
                    <button
                      type="button"
                      onClick={() => { setShowPicker(false); setSearchTerm('') }}
                      className="text-[10px] text-gray-400 hover:text-red-500"
                    >
                      Close
                    </button>
                  </div>
                  <IngredientHierarchyPicker
                    ingredientsLibrary={ingredientsLibrary}
                    ingredientCategories={ingredientCategories}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    searchPlaceholder="Search prep items..."
                    actionLabel="Link"
                    actionColor="purple"
                    onAction={handleAddLink}
                    excludeIds={linkedIds}
                    maxHeight="max-h-48"
                    showCategoryCreation={true}
                    showInventoryCreation={true}
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
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-[11px] text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Prep Item
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// --- Linked Item Row (inline editable) ---

function LinkedItemRow({
  link,
  onRemove,
  onUpdate,
}: {
  link: InventoryLink
  onRemove: () => void
  onUpdate: (data: { usageQuantity?: number; usageUnit?: string }) => void
}) {
  const name = link.prepItem?.name ?? link.inventoryItem?.name ?? link.ingredient?.name ?? 'Unknown'
  const isTemp = link.id.startsWith('temp-')

  const [qty, setQty] = useState(String(link.usageQuantity))
  const [unit, setUnit] = useState(link.usageUnit)

  // Sync from parent
  useEffect(() => {
    setQty(String(link.usageQuantity))
    setUnit(link.usageUnit)
  }, [link.usageQuantity, link.usageUnit])

  const handleQtyBlur = () => {
    const parsed = parseFloat(qty)
    if (isNaN(parsed) || parsed <= 0) {
      setQty(String(link.usageQuantity))
      return
    }
    if (parsed !== link.usageQuantity) {
      onUpdate({ usageQuantity: parsed })
    }
  }

  const handleUnitChange = (newUnit: string) => {
    setUnit(newUnit)
    if (newUnit !== link.usageUnit) {
      onUpdate({ usageUnit: newUnit })
    }
  }

  return (
    <div className={`flex items-center gap-1.5 py-0.5 ${isTemp ? 'opacity-50' : ''}`}>
      <span className="text-[8px] px-1 py-0.5 bg-green-600 text-white rounded font-bold shrink-0">PREP</span>
      <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0" title={name}>
        {name}
      </span>

      {/* Quantity input */}
      <input
        type="number"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={handleQtyBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        step="0.01"
        min="0.01"
        disabled={isTemp}
        className="w-12 px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
      />

      {/* Unit dropdown */}
      <select
        value={unit}
        onChange={(e) => handleUnitChange(e.target.value)}
        disabled={isTemp}
        className="px-1 py-0.5 border border-gray-200 rounded text-[11px] focus:ring-1 focus:ring-purple-400 focus:border-purple-400 bg-white"
      >
        {USAGE_UNITS.map(u => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>

      {/* Cost display */}
      {link.calculatedCost != null && link.calculatedCost > 0 ? (
        <span className="text-[10px] text-gray-500 shrink-0 w-12 text-right">
          ${link.calculatedCost.toFixed(2)}
        </span>
      ) : (
        <span className="text-[10px] text-gray-300 shrink-0 w-12 text-right">--</span>
      )}

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={isTemp}
        className="p-0.5 text-gray-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-30"
        title="Remove link"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
