'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { SPIRIT_TIERS, LIQUOR_DEFAULTS } from '@/lib/constants'
import { SpiritCategory, BottleProduct } from '@/app/(admin)/liquor-builder/types'
import { CategoryModal } from '@/app/(admin)/liquor-builder/CategoryModal'
import { BottleModal } from '@/app/(admin)/liquor-builder/BottleModal'

// ─── Tier badge display ────────────────────────────────────────────────────────
const BEER_TIER_LABELS: Record<string, string> = {
  well: 'DOM',
  call: 'IMP',
  premium: 'CRFT',
  top_shelf: 'PREM+',
}

const WINE_TIER_LABELS: Record<string, string> = {
  well: 'HOUSE',
  call: 'GLASS',
  premium: 'RESV',
  top_shelf: 'CELLR',
}

const SPIRIT_TIER_LABELS: Record<string, string> = {
  well: 'WELL',
  call: 'CALL',
  premium: 'PREM',
  top_shelf: 'TOP',
}

const TIER_COLORS: Record<string, string> = {
  well: 'bg-gray-200 text-gray-700',
  call: 'bg-blue-100 text-blue-700',
  premium: 'bg-purple-100 text-purple-700',
  top_shelf: 'bg-amber-100 text-amber-700',
}

// ─── Container type display labels ─────────────────────────────────────────────
const CONTAINER_LABELS: Record<string, string> = {
  can: 'Can',
  bottle: 'Btl',
  draft: 'Draft',
  glass: 'Glass',
}

// ─── Subtype badge colors ──────────────────────────────────────────────────────
const SUBTYPE_COLORS: Record<string, string> = {
  // Beer
  domestic: 'bg-blue-50 text-blue-600',
  import: 'bg-teal-50 text-teal-600',
  craft: 'bg-orange-50 text-orange-600',
  seltzer: 'bg-cyan-50 text-cyan-600',
  na: 'bg-gray-100 text-gray-500',
  // Wine
  red: 'bg-red-50 text-red-600',
  white: 'bg-yellow-50 text-yellow-700',
  rose: 'bg-pink-50 text-pink-600',
  sparkling: 'bg-amber-50 text-amber-600',
  dessert: 'bg-orange-50 text-orange-600',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getTierLabel(tier: string, categoryType: string): string {
  const labels = categoryType === 'beer' ? BEER_TIER_LABELS : categoryType === 'wine' ? WINE_TIER_LABELS : SPIRIT_TIER_LABELS
  return labels[tier] || tier.toUpperCase()
}

function formatSize(bottle: BottleProduct, categoryType: string): string {
  const ML_PER_OZ = LIQUOR_DEFAULTS.mlPerOz

  if (categoryType === 'beer') {
    const oz = Math.round((bottle.bottleSizeMl / ML_PER_OZ) * 10) / 10
    const container = CONTAINER_LABELS[bottle.containerType || 'can'] || ''
    return `${oz}oz ${container}`
  }

  return `${bottle.bottleSizeMl}mL`
}

function computePourInfo(bottle: BottleProduct, categoryType: string): {
  poursPerBottle: number | null
  pourCost: number | null
} {
  const ML_PER_OZ = LIQUOR_DEFAULTS.mlPerOz

  if (categoryType === 'beer') {
    // Beer: 1 container = 1 serve
    return { poursPerBottle: 1, pourCost: bottle.unitCost }
  }

  const defaultPour = categoryType === 'wine' ? 5 : LIQUOR_DEFAULTS.pourSizeOz
  const pourOz = bottle.pourSizeOz || defaultPour
  const pours = bottle.bottleSizeMl > 0
    ? Math.floor(bottle.bottleSizeMl / (pourOz * ML_PER_OZ))
    : 0
  const cost = pours > 0 ? bottle.unitCost / pours : 0

  return { poursPerBottle: pours, pourCost: cost }
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface LiquorInventoryProps {
  locationId: string
}

export function LiquorInventory({ locationId }: LiquorInventoryProps) {
  // ─── Data state ──────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ─── Filters ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedTier, setSelectedTier] = useState('')

  // ─── Collapsed sections (categories and products default to collapsed) ────────
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  // ─── Modal state ─────────────────────────────────────────────────────────────
  const [showBottleModal, setShowBottleModal] = useState(false)
  const [editingBottle, setEditingBottle] = useState<BottleProduct | null>(null)
  const [bottleDefaults, setBottleDefaults] = useState<{ brand?: string; spiritCategoryId?: string; tier?: string } | undefined>()
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SpiritCategory | null>(null)

  // ─── Prep item creation ──────────────────────────────────────────────────────
  const [addingPrepForInventoryId, setAddingPrepForInventoryId] = useState<string | null>(null)
  const [prepName, setPrepName] = useState('')
  const [prepOutputUnit, setPrepOutputUnit] = useState('oz')
  const [prepBatchYield, setPrepBatchYield] = useState('1')
  const [prepQuantity, setPrepQuantity] = useState('1.5')
  const [savingPrep, setSavingPrep] = useState(false)

  // ─── Deleted section ─────────────────────────────────────────────────────────
  const [showDeleted, setShowDeleted] = useState(false)

  // ─── Data loading ────────────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/liquor/categories')
      if (response.ok) {
        const data = await response.json()
        setCategories(data.data || data || [])
      }
    } catch (error) {
      console.error('Failed to load spirit categories:', error)
    }
  }, [])

  const loadBottles = useCallback(async () => {
    try {
      const response = await fetch('/api/liquor/bottles')
      if (response.ok) {
        const data = await response.json()
        setBottles(data.data || data || [])
      }
    } catch (error) {
      console.error('Failed to load bottles:', error)
    }
  }, [])

  useEffect(() => {
    const loadAll = async () => {
      setIsLoading(true)
      await Promise.all([loadCategories(), loadBottles()])
      setIsLoading(false)
    }
    loadAll()
  }, [loadCategories, loadBottles])

  // ─── Derived data ────────────────────────────────────────────────────────────

  const activeBottles = useMemo(() => bottles.filter(b => b.isActive), [bottles])
  const deletedBottles = useMemo(() => bottles.filter(b => !b.isActive), [bottles])

  // Group active bottles by spiritCategoryId, then by product (brand)
  const groupedBottles = useMemo(() => {
    const searchLower = search.toLowerCase()

    // Filter bottles by search, category, and tier
    const filtered = activeBottles.filter(bottle => {
      if (search) {
        const matchesName = bottle.name.toLowerCase().includes(searchLower)
        const matchesBrand = bottle.brand?.toLowerCase().includes(searchLower) || false
        if (!matchesName && !matchesBrand) return false
      }
      if (selectedCategoryId && bottle.spiritCategoryId !== selectedCategoryId) return false
      if (selectedTier && bottle.tier !== selectedTier) return false
      return true
    })

    // Build product groups within a set of bottles
    function buildProductGroups(catBottles: BottleProduct[]) {
      const productMap = new Map<string, {
        key: string
        label: string
        brand: string | null
        bottles: BottleProduct[]
        inventoryItem: BottleProduct['inventoryItem'] | null
      }>()

      for (const bottle of catBottles) {
        const groupKey = bottle.brand || bottle.name
        const existing = productMap.get(groupKey)
        if (existing) {
          existing.bottles.push(bottle)
          if (!existing.inventoryItem && bottle.inventoryItem) {
            existing.inventoryItem = bottle.inventoryItem
          }
        } else {
          productMap.set(groupKey, {
            key: groupKey,
            label: groupKey,
            brand: bottle.brand || null,
            bottles: [bottle],
            inventoryItem: bottle.inventoryItem || null,
          })
        }
      }

      // Sort product groups alphabetically
      return Array.from(productMap.values()).sort((a, b) => a.label.localeCompare(b.label))
    }

    // Build groups from categories
    const groups: {
      category: SpiritCategory
      bottles: BottleProduct[]
      productGroups: ReturnType<typeof buildProductGroups>
    }[] = []

    for (const cat of categories) {
      const catBottles = filtered
        .filter(b => b.spiritCategoryId === cat.id)
        .sort((a, b) => {
          const tierOrder = ['well', 'call', 'premium', 'top_shelf']
          const tierA = tierOrder.indexOf(a.tier)
          const tierB = tierOrder.indexOf(b.tier)
          if (tierA !== tierB) return tierA - tierB
          return a.name.localeCompare(b.name)
        })

      if (catBottles.length > 0 || (!search && !selectedCategoryId && !selectedTier)) {
        groups.push({
          category: cat,
          bottles: catBottles,
          productGroups: buildProductGroups(catBottles),
        })
      }
    }

    // Uncategorized bottles
    const uncategorized = filtered.filter(
      b => !categories.some(c => c.id === b.spiritCategoryId)
    )
    if (uncategorized.length > 0) {
      groups.push({
        category: {
          id: '__uncategorized__',
          name: 'Uncategorized',
          categoryType: 'spirit',
          displayName: null,
          description: null,
          sortOrder: 9999,
          isActive: true,
          bottleCount: uncategorized.length,
          modifierGroupCount: 0,
        },
        bottles: uncategorized,
        productGroups: buildProductGroups(uncategorized),
      })
    }

    return groups
  }, [categories, activeBottles, search, selectedCategoryId, selectedTier])

  const totalFilteredBottles = useMemo(
    () => groupedBottles.reduce((sum, g) => sum + g.bottles.length, 0),
    [groupedBottles]
  )

  // ─── Toggle collapse ────────────────────────────────────────────────────────

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }, [])

  const toggleProduct = useCallback((productKey: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      if (next.has(productKey)) {
        next.delete(productKey)
      } else {
        next.add(productKey)
      }
      return next
    })
  }, [])

  // ─── Category CRUD ──────────────────────────────────────────────────────────

  const handleCreateCategory = () => {
    setEditingCategory(null)
    setShowCategoryModal(true)
  }

  const handleEditCategory = (category: SpiritCategory) => {
    setEditingCategory(category)
    setShowCategoryModal(true)
  }

  const handleSaveCategory = async (data: { name: string; categoryType: string; displayName?: string; description?: string; isActive?: boolean }) => {
    try {
      const url = editingCategory
        ? `/api/liquor/categories/${editingCategory.id}`
        : '/api/liquor/categories'
      const method = editingCategory ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, locationId }),
      })

      if (response.ok) {
        toast.success(editingCategory ? 'Category updated' : 'Category created')
        await loadCategories()
        setShowCategoryModal(false)
        setEditingCategory(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save category')
      }
    } catch (error) {
      console.error('Failed to save category:', error)
      toast.error('Failed to save category')
    }
  }

  const handleDeleteCategory = async () => {
    if (!editingCategory) return
    if (!confirm(`Delete "${editingCategory.name}"? Bottles in this category will become uncategorized.`)) return

    try {
      const response = await fetch(`/api/liquor/categories/${editingCategory.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`Category "${editingCategory.name}" deleted`)
        await Promise.all([loadCategories(), loadBottles()])
        setShowCategoryModal(false)
        setEditingCategory(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
    }
  }

  const handleDeleteCategoryFromRow = async (category: SpiritCategory) => {
    const bottleCount = activeBottles.filter(b => b.spiritCategoryId === category.id).length
    const message = bottleCount > 0
      ? `Delete "${category.name}"? ${bottleCount} bottle${bottleCount !== 1 ? 's' : ''} in this category will become uncategorized.`
      : `Delete "${category.name}"?`
    if (!confirm(message)) return

    try {
      const response = await fetch(`/api/liquor/categories/${category.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`Category "${category.name}" deleted`)
        await Promise.all([loadCategories(), loadBottles()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      toast.error('Failed to delete category')
    }
  }

  // ─── Bottle CRUD ─────────────────────────────────────────────────────────────

  const handleCreateBottle = () => {
    setEditingBottle(null)
    setBottleDefaults(undefined)
    setShowBottleModal(true)
  }

  const handleCreateVariantBottle = (product: { brand: string | null; bottles: BottleProduct[] }) => {
    const firstBottle = product.bottles[0]
    setEditingBottle(null)
    setBottleDefaults({
      brand: product.brand || undefined,
      spiritCategoryId: firstBottle?.spiritCategoryId,
      tier: firstBottle?.tier,
    })
    setShowBottleModal(true)
  }

  const handleEditBottle = (bottle: BottleProduct) => {
    setEditingBottle(bottle)
    setBottleDefaults(undefined)
    setShowBottleModal(true)
  }

  const handleSaveBottle = async (data: any) => {
    try {
      const url = editingBottle
        ? `/api/liquor/bottles/${editingBottle.id}`
        : '/api/liquor/bottles'
      const method = editingBottle ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, locationId }),
      })

      if (response.ok) {
        toast.success(editingBottle ? 'Bottle updated' : 'Bottle added to inventory')
        await Promise.all([loadBottles(), loadCategories()])
        setShowBottleModal(false)
        setEditingBottle(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to save bottle')
      }
    } catch (error) {
      console.error('Failed to save bottle:', error)
      toast.error('Failed to save bottle')
    }
  }

  const handleDeleteBottle = async () => {
    if (!editingBottle) return
    if (!confirm(`Delete "${editingBottle.name}"? It will be moved to the Deleted section.`)) return

    try {
      const response = await fetch(`/api/liquor/bottles/${editingBottle.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success(`"${editingBottle.name}" moved to Deleted section`)
        await Promise.all([loadBottles(), loadCategories()])
        setShowBottleModal(false)
        setEditingBottle(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to delete bottle')
      }
    } catch (error) {
      console.error('Failed to delete bottle:', error)
      toast.error('Failed to delete bottle')
    }
  }

  const handleMenuItemChange = async () => {
    // Reload bottles to pick up hasMenuItem changes
    await loadBottles()
  }

  // ─── Prep item CRUD ─────────────────────────────────────────────────────────

  const handleStartAddPrep = (inventoryItemId: string) => {
    setAddingPrepForInventoryId(inventoryItemId)
    setPrepName('')
    setPrepOutputUnit('oz')
    setPrepBatchYield('1')
    setPrepQuantity('1.5')
  }

  const handleCancelAddPrep = () => {
    setAddingPrepForInventoryId(null)
  }

  const handleSavePrep = async (inventoryItemId: string) => {
    if (!prepName.trim()) {
      toast.error('Prep item name is required')
      return
    }
    setSavingPrep(true)
    try {
      const response = await fetch('/api/inventory/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: prepName.trim(),
          batchYield: Number(prepBatchYield) || 1,
          batchUnit: prepOutputUnit,
          outputUnit: prepOutputUnit,
          ingredients: [{
            inventoryItemId,
            quantity: Number(prepQuantity) || 1.5,
            unit: prepOutputUnit,
          }],
        }),
      })

      if (response.ok) {
        toast.success(`Prep item "${prepName.trim()}" created`)
        setAddingPrepForInventoryId(null)
        await loadBottles() // Reload to pick up new prep items
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to create prep item')
      }
    } catch (error) {
      console.error('Failed to create prep item:', error)
      toast.error('Failed to create prep item')
    } finally {
      setSavingPrep(false)
    }
  }

  // ─── Verification ───────────────────────────────────────────────────────────

  const handleVerifyBottle = async (bottle: BottleProduct) => {
    try {
      const response = await fetch(`/api/liquor/bottles/${bottle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needsVerification: false,
          verifiedAt: new Date().toISOString(),
        }),
      })
      if (response.ok) {
        toast.success(`"${bottle.name}" verified`)
        await loadBottles()
      } else {
        toast.error('Failed to verify bottle')
      }
    } catch (error) {
      console.error('Failed to verify bottle:', error)
      toast.error('Failed to verify bottle')
    }
  }

  // ─── Reordering ────────────────────────────────────────────────────────────

  const handleMoveCategory = async (categoryId: string, direction: 'up' | 'down') => {
    const catIds = groupedBottles
      .filter(g => g.category.id !== '__uncategorized__')
      .map(g => g.category.id)
    const idx = catIds.indexOf(categoryId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= catIds.length) return

    // Swap
    const newOrder = [...catIds]
    ;[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]]

    // Optimistic: update categories locally
    setCategories(prev => {
      const updated = [...prev]
      for (let i = 0; i < newOrder.length; i++) {
        const cat = updated.find(c => c.id === newOrder[i])
        if (cat) cat.sortOrder = i
      }
      return updated.sort((a, b) => a.sortOrder - b.sortOrder)
    })

    try {
      await fetch('/api/liquor/categories/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryIds: newOrder }),
      })
    } catch (error) {
      console.error('Failed to reorder categories:', error)
      await loadCategories()
    }
  }

  const handleMoveBottle = async (bottleId: string, direction: 'up' | 'down', categoryBottles: BottleProduct[]) => {
    const bottleIds = categoryBottles.map(b => b.id)
    const idx = bottleIds.indexOf(bottleId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= bottleIds.length) return

    const newOrder = [...bottleIds]
    ;[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]]

    // Optimistic: update sortOrder locally
    setBottles(prev => {
      const updated = [...prev]
      for (let i = 0; i < newOrder.length; i++) {
        const b = updated.find(bt => bt.id === newOrder[i])
        if (b) b.sortOrder = i
      }
      return updated
    })

    try {
      await fetch('/api/liquor/bottles/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bottleIds: newOrder }),
      })
    } catch (error) {
      console.error('Failed to reorder bottles:', error)
      await loadBottles()
    }
  }

  // ─── Restore deleted bottle ──────────────────────────────────────────────────

  const handleRestoreBottle = async (bottle: BottleProduct) => {
    try {
      const response = await fetch(`/api/liquor/bottles/${bottle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })

      if (response.ok) {
        toast.success(`"${bottle.name}" restored`)
        await Promise.all([loadBottles(), loadCategories()])
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to restore bottle')
      }
    } catch (error) {
      console.error('Failed to restore bottle:', error)
      toast.error('Failed to restore bottle')
    }
  }

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading liquor inventory...</div>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquor Inventory</h1>
          <p className="text-gray-600">
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 bg-amber-600 text-white rounded text-xs font-bold">PRODUCT</span>
              <span>&rarr;</span>
              <span className="px-2 py-0.5 bg-white border text-gray-700 rounded text-xs font-bold">BOTTLES</span>
              <span>&rarr;</span>
              <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold">INVENTORY</span>
              <span>&rarr;</span>
              <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">PREP</span>
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateCategory}
            className="px-4 py-2 text-sm font-medium border rounded-lg bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          >
            + Category
          </button>
          <button
            onClick={handleCreateBottle}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            + Bottle
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <input
          type="text"
          placeholder="Search bottles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <select
          value={selectedCategoryId}
          onChange={(e) => setSelectedCategoryId(e.target.value)}
          className="px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.displayName || cat.name}
            </option>
          ))}
        </select>
        <select
          value={selectedTier}
          onChange={(e) => setSelectedTier(e.target.value)}
          className="px-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="">All Tiers</option>
          {SPIRIT_TIERS.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {(search || selectedCategoryId || selectedTier) && (
          <button
            onClick={() => { setSearch(''); setSelectedCategoryId(''); setSelectedTier('') }}
            className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>{totalFilteredBottles} bottle{totalFilteredBottles !== 1 ? 's' : ''}</span>
        <span className="text-gray-300">|</span>
        <span>{categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}</span>
        {(search || selectedCategoryId || selectedTier) && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-amber-600 font-medium">Filtered</span>
          </>
        )}
      </div>

      {/* Category Sections */}
      {groupedBottles.length === 0 && activeBottles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No bottles in inventory</p>
          <p className="text-sm mb-4">Add spirit categories and bottles to get started.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleCreateCategory}
              className="px-4 py-2 text-sm font-medium border rounded-lg bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              + Category
            </button>
            <button
              onClick={handleCreateBottle}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              + Bottle
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedBottles.map((group, groupIdx) => {
            const isCollapsed = !expandedCategories.has(group.category.id)
            const catName = group.category.displayName || group.category.name
            const catType = group.category.categoryType || 'spirit'
            const isBeer = catType === 'beer'
            const isWine = catType === 'wine'
            const unverifiedCount = group.bottles.filter(b => b.needsVerification).length

            return (
              <div key={group.category.id} className={`border rounded-lg overflow-hidden bg-white ${
                unverifiedCount > 0 ? 'border-red-300' : ''
              }`}>
                {/* Category header */}
                <div
                  className={`flex items-center justify-between px-4 py-3 border-b cursor-pointer transition-colors ${
                    unverifiedCount > 0 ? 'bg-red-50 hover:bg-red-100' : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                  onClick={() => toggleCategory(group.category.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-sm select-none">
                      {isCollapsed ? '\u25B6' : '\u25BC'}
                    </span>
                    <span className="font-semibold text-gray-900">{catName}</span>
                    <span className="text-sm text-gray-500">
                      ({group.bottles.length} bottle{group.bottles.length !== 1 ? 's' : ''})
                    </span>
                    {unverifiedCount > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-red-500 text-white rounded-full font-bold animate-pulse">
                        {unverifiedCount} unverified
                      </span>
                    )}
                    {!group.category.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded font-medium">
                        Inactive
                      </span>
                    )}
                  </div>
                  {group.category.id !== '__uncategorized__' && (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {/* Move up/down arrows */}
                      <button
                        onClick={() => handleMoveCategory(group.category.id, 'up')}
                        disabled={groupIdx === 0}
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        {'\u25B2'}
                      </button>
                      <button
                        onClick={() => handleMoveCategory(group.category.id, 'down')}
                        disabled={groupIdx === groupedBottles.length - 1 || groupedBottles[groupIdx + 1]?.category.id === '__uncategorized__'}
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        {'\u25BC'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingBottle(null)
                          setBottleDefaults({ spiritCategoryId: group.category.id })
                          setShowBottleModal(true)
                          if (!expandedCategories.has(group.category.id)) {
                            toggleCategory(group.category.id)
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
                      >
                        + Add Bottle
                      </button>
                      <button
                        onClick={() => handleEditCategory(group.category)}
                        className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCategoryFromRow(group.category)}
                        className="px-3 py-1 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* Product hierarchy tree */}
                {!isCollapsed && (
                  <div className="p-3 space-y-2">
                    {group.bottles.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-400">
                        No bottles in this category
                        {(search || selectedTier) && ' matching current filters'}
                      </div>
                    ) : (
                      group.productGroups.map(product => {
                        const productKey = `${group.category.id}::${product.key}`
                        const isExpanded = expandedProducts.has(productKey)
                        const invItem = product.inventoryItem
                        const prepItems = invItem?.prepItems?.filter(p => p.isActive) || []
                        const stockOz = invItem ? Math.round(invItem.currentStock * 10) / 10 : null
                        const parOz = invItem?.parLevel ? Math.round(invItem.parLevel * 10) / 10 : null
                        const isLowInventory = parOz != null && stockOz != null && stockOz <= parOz
                        const isOutInventory = stockOz != null && stockOz <= 0
                        const productUnverified = product.bottles.some(b => b.needsVerification)

                        return (
                          <div key={productKey}>
                            {/* Product Label Row */}
                            <div
                              className={`flex items-center justify-between px-4 py-2.5 rounded-lg cursor-pointer transition-colors border ${
                                productUnverified
                                  ? 'bg-red-50 border-red-300'
                                  : isExpanded
                                  ? 'bg-amber-50 border-amber-200'
                                  : 'bg-amber-50/50 border-amber-100 hover:bg-amber-50 hover:border-amber-200'
                              }`}
                              onClick={() => toggleProduct(productKey)}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`text-sm select-none flex-shrink-0 ${productUnverified ? 'text-red-400' : 'text-amber-500'}`}>
                                  {isExpanded ? '\u25BC' : '\u25B6'}
                                </span>
                                <span className="font-semibold text-gray-900 truncate">{product.label}</span>
                                <span className="text-xs text-gray-500 flex-shrink-0">
                                  {product.bottles.length} bottle{product.bottles.length !== 1 ? 's' : ''}
                                </span>
                                {productUnverified && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded font-bold flex-shrink-0">
                                    UNVERIFIED
                                  </span>
                                )}
                                {stockOz != null && (
                                  <span className={`text-xs font-medium flex-shrink-0 ${
                                    isOutInventory ? 'text-red-600' : isLowInventory ? 'text-amber-600' : 'text-gray-500'
                                  }`}>
                                    {stockOz} {invItem?.storageUnit || 'oz'}
                                    {isOutInventory && <span className="ml-1 text-[10px] text-red-500 font-bold">OUT</span>}
                                    {isLowInventory && !isOutInventory && <span className="ml-1 text-[10px] text-amber-500 font-bold">LOW</span>}
                                  </span>
                                )}
                              </div>
                              {/* Inline summary for single-bottle products when collapsed */}
                              {!isExpanded && product.bottles.length === 1 && (() => {
                                const b = product.bottles[0]
                                const tl = getTierLabel(b.tier, catType)
                                const tc = TIER_COLORS[b.tier] || 'bg-gray-100 text-gray-600'
                                const sz = formatSize(b, catType)
                                return (
                                  <div className="flex items-center gap-3 text-sm" onClick={e => e.stopPropagation()}>
                                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${tc}`}>{tl}</span>
                                    <span className="text-gray-500">{sz}</span>
                                    <span className="text-gray-500">{formatCurrency(b.unitCost)}</span>
                                    <span className="text-gray-500">{b.currentStock} btl</span>
                                    {b.hasMenuItem && <span className="text-green-600 text-xs font-bold">POS</span>}
                                    <button
                                      onClick={() => handleEditBottle(b)}
                                      className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )
                              })()}
                            </div>

                            {/* Expanded content */}
                            {isExpanded && (
                              <div className="ml-6 mt-1 space-y-1 border-l-2 border-amber-200 pl-3">
                                {/* BOTTLES section */}
                                <div className="flex items-center justify-between px-1 pt-1">
                                  <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                                    Bottles
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCreateVariantBottle(product) }}
                                    className="px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded transition-colors"
                                  >
                                    + Bottle
                                  </button>
                                </div>
                                {product.bottles.map((bottle, bottleIdx) => {
                                  const tierLabel = getTierLabel(bottle.tier, catType)
                                  const tierColor = TIER_COLORS[bottle.tier] || 'bg-gray-100 text-gray-600'
                                  const sizeStr = formatSize(bottle, catType)
                                  const { poursPerBottle, pourCost } = computePourInfo(bottle, catType)
                                  const isLowStock = bottle.lowStockAlert != null && bottle.currentStock <= bottle.lowStockAlert
                                  const isOutOfStock = bottle.currentStock <= 0
                                  const subtypeColor = bottle.alcoholSubtype
                                    ? SUBTYPE_COLORS[bottle.alcoholSubtype] || 'bg-gray-50 text-gray-500'
                                    : ''

                                  return (
                                    <div
                                      key={bottle.id}
                                      className={`flex items-center gap-3 px-3 py-2 border rounded cursor-pointer transition-colors ${
                                        bottle.needsVerification
                                          ? 'bg-red-50 border-red-300 hover:bg-red-100'
                                          : 'bg-white border-gray-200 hover:bg-amber-50/50'
                                      }`}
                                    >
                                      {/* Move arrows */}
                                      <div className="flex flex-col gap-0 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                          onClick={() => handleMoveBottle(bottle.id, 'up', group.bottles)}
                                          disabled={bottleIdx === 0}
                                          className="text-[9px] text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none"
                                          title="Move up"
                                        >{'\u25B2'}</button>
                                        <button
                                          onClick={() => handleMoveBottle(bottle.id, 'down', group.bottles)}
                                          disabled={bottleIdx === group.bottles.length - 1}
                                          className="text-[9px] text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none"
                                          title="Move down"
                                        >{'\u25BC'}</button>
                                      </div>
                                      <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => handleEditBottle(bottle)}>
                                        <span className="text-gray-700 font-medium min-w-[60px]">{sizeStr}</span>
                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${tierColor}`}>{tierLabel}</span>
                                        {bottle.alcoholSubtype && (
                                          <span className={`px-1.5 py-0 text-[10px] font-medium rounded ${subtypeColor}`}>
                                            {bottle.alcoholSubtype}
                                          </span>
                                        )}
                                        {isWine && bottle.vintage && (
                                          <span className="text-[10px] text-gray-400">{bottle.vintage}</span>
                                        )}
                                        <span className="text-gray-600 text-sm">{formatCurrency(bottle.unitCost)}</span>
                                        {!isBeer && poursPerBottle != null && (
                                          <span className="text-gray-500 text-xs">{poursPerBottle} pours</span>
                                        )}
                                        {pourCost != null && pourCost > 0 && (
                                          <span className="text-gray-500 text-xs">{formatCurrency(pourCost)}/pour</span>
                                        )}
                                        <span className={`text-sm font-medium ml-auto ${
                                          isOutOfStock ? 'text-red-600' : isLowStock ? 'text-amber-600' : 'text-gray-700'
                                        }`}>
                                          {bottle.currentStock} btl
                                          {isOutOfStock && <span className="ml-1 text-[10px] text-red-500">OUT</span>}
                                          {isLowStock && !isOutOfStock && <span className="ml-1 text-[10px] text-amber-500">LOW</span>}
                                        </span>
                                        {bottle.needsVerification && (
                                          <span className="px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded font-bold flex-shrink-0">
                                            UNVERIFIED
                                          </span>
                                        )}
                                        {bottle.hasMenuItem && (
                                          <span className="text-green-600 font-bold text-xs flex-shrink-0" title="Listed on POS">
                                            {'\u2713'} POS
                                          </span>
                                        )}
                                      </div>
                                      {/* Verify button */}
                                      {bottle.needsVerification && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleVerifyBottle(bottle) }}
                                          className="px-2 py-1 text-[11px] font-bold text-green-700 bg-green-100 hover:bg-green-200 border border-green-300 rounded transition-colors flex-shrink-0"
                                          title="Mark as verified"
                                        >
                                          Verify
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}

                                {/* INVENTORY ITEM section */}
                                {invItem && (
                                  <>
                                    <div className="text-[10px] font-bold uppercase text-blue-500 tracking-wider px-1 pt-2">
                                      Inventory Item
                                    </div>
                                    <div className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded">
                                      <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase flex-shrink-0">
                                        Inventory
                                      </span>
                                      <span className="font-medium text-gray-900">{invItem.name}</span>
                                      <span className={`text-sm font-medium ${
                                        isOutInventory ? 'text-red-600 font-bold' : isLowInventory ? 'text-amber-600 font-bold' : 'text-gray-700'
                                      }`}>
                                        {stockOz} {invItem.storageUnit || 'oz'}
                                        {isOutInventory && <span className="ml-1 text-[10px] text-red-500">OUT</span>}
                                        {isLowInventory && !isOutInventory && <span className="ml-1 text-[10px] text-amber-500">LOW</span>}
                                      </span>
                                      {parOz != null && (
                                        <span className="text-xs text-gray-500">Par: {parOz} {invItem.storageUnit || 'oz'}</span>
                                      )}
                                      <span className="text-xs text-gray-500 ml-auto">
                                        {formatCurrency(invItem.costPerUnit)}/{invItem.storageUnit || 'oz'}
                                      </span>
                                    </div>
                                  </>
                                )}

                                {/* PREP ITEMS section */}
                                {prepItems.length > 0 && (
                                  <>
                                    <div className="text-[10px] font-bold uppercase text-green-600 tracking-wider px-1 pt-2">
                                      Prep Items
                                    </div>
                                    {prepItems.map(prep => (
                                      <div
                                        key={prep.id}
                                        className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded ml-4"
                                      >
                                        <span className="px-1.5 py-0.5 bg-green-600 text-white rounded text-[10px] font-bold uppercase flex-shrink-0">
                                          Prep
                                        </span>
                                        <span className="font-medium text-gray-900">{prep.name}</span>
                                        <span className="text-xs text-gray-600">
                                          {Number(prep.batchYield)} {prep.outputUnit}
                                        </span>
                                        {prep.costPerUnit != null && (
                                          <span className="text-xs text-gray-500">
                                            {formatCurrency(prep.costPerUnit)}/{prep.outputUnit}
                                          </span>
                                        )}
                                        {prep.isDailyCountItem && (
                                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
                                            Daily Count
                                          </span>
                                        )}
                                        <span className="text-xs text-gray-500 ml-auto">
                                          Stock: {Number(prep.currentPrepStock)} {prep.outputUnit}
                                        </span>
                                      </div>
                                    ))}
                                  </>
                                )}

                                {/* Add Prep Item */}
                                {invItem && addingPrepForInventoryId !== invItem.id && (
                                  <div className="px-3 py-1.5 ml-4">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleStartAddPrep(invItem.id) }}
                                      className="text-xs text-green-600 hover:text-green-800 font-medium"
                                    >
                                      + Add Prep Item
                                    </button>
                                  </div>
                                )}
                                {invItem && addingPrepForInventoryId === invItem.id && (
                                  <div className="ml-4 px-3 py-2 bg-green-50 border border-green-200 rounded space-y-2" onClick={e => e.stopPropagation()}>
                                    <div className="text-[10px] font-bold uppercase text-green-600 tracking-wider">New Prep Item</div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={prepName}
                                        onChange={e => setPrepName(e.target.value)}
                                        placeholder="Prep item name"
                                        className="flex-1 px-2 py-1.5 text-sm border rounded"
                                        autoFocus
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') { e.preventDefault(); handleSavePrep(invItem.id) }
                                          if (e.key === 'Escape') handleCancelAddPrep()
                                        }}
                                      />
                                      <select
                                        value={prepOutputUnit}
                                        onChange={e => setPrepOutputUnit(e.target.value)}
                                        className="px-2 py-1.5 text-sm border rounded w-20"
                                      >
                                        <option value="oz">oz</option>
                                        <option value="ml">mL</option>
                                        <option value="each">each</option>
                                      </select>
                                      <input
                                        type="number"
                                        value={prepQuantity}
                                        onChange={e => setPrepQuantity(e.target.value)}
                                        step="0.25"
                                        min="0.25"
                                        className="px-2 py-1.5 text-sm border rounded w-20"
                                        placeholder="Qty"
                                      />
                                      <button
                                        onClick={() => handleSavePrep(invItem.id)}
                                        disabled={savingPrep || !prepName.trim()}
                                        className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                      >
                                        {savingPrep ? '...' : 'Create'}
                                      </button>
                                      <button
                                        onClick={handleCancelAddPrep}
                                        className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* No results after filtering */}
          {groupedBottles.length > 0 && totalFilteredBottles === 0 && (search || selectedCategoryId || selectedTier) && (
            <div className="text-center py-8 text-gray-500">
              <p>No bottles match the current filters.</p>
              <button
                onClick={() => { setSearch(''); setSelectedCategoryId(''); setSelectedTier('') }}
                className="mt-2 text-amber-600 hover:text-amber-700 text-sm font-medium"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Deleted Items Section */}
      {deletedBottles.length > 0 && (
        <div className="mt-8 border-t-2 border-red-200 pt-4">
          <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-red-500 text-sm">{'\uD83D\uDDD1\uFE0F'}</span>
              <span className="font-semibold text-red-800">
                Deleted Items ({deletedBottles.length})
              </span>
              <span className="text-xs text-red-600">
                Click to {showDeleted ? 'hide' : 'show'} - Restore bottles to active inventory
              </span>
            </div>
            <span className="text-red-500">{showDeleted ? '\u25BC' : '\u25B6'}</span>
          </button>

          {showDeleted && (
            <div className="mt-2 space-y-2 p-3 bg-red-50/50 rounded-lg border border-red-100">
              {deletedBottles.map(bottle => {
                const deletedCatType = bottle.spiritCategory?.categoryType || 'spirit'
                const tierLabel = getTierLabel(bottle.tier, deletedCatType)
                const tierColor = TIER_COLORS[bottle.tier] || 'bg-gray-100 text-gray-600'
                const sizeStr = formatSize(bottle, deletedCatType)

                return (
                  <div
                    key={bottle.id}
                    className="flex items-center justify-between p-3 bg-white rounded border border-red-200"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-red-400 text-sm">{'\uD83D\uDDD1\uFE0F'}</span>
                      <div>
                        <span className="font-medium text-gray-700">{bottle.name}</span>
                        {bottle.brand && (
                          <span className="text-xs text-gray-400 ml-2">{bottle.brand}</span>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">
                            {bottle.spiritCategory?.displayName || bottle.spiritCategory?.name || 'No category'}
                          </span>
                          <span className={`inline-block px-1.5 py-0 text-[10px] font-bold rounded ${tierColor}`}>
                            {tierLabel}
                          </span>
                          <span className="text-xs text-gray-400">{sizeStr}</span>
                          <span className="text-xs text-gray-400">{formatCurrency(bottle.unitCost)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreBottle(bottle)}
                      className="px-3 py-1.5 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors font-medium"
                    >
                      Restore
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}

      {showBottleModal && (
        <BottleModal
          bottle={editingBottle}
          categories={categories.filter(c => c.isActive)}
          onSave={handleSaveBottle}
          onDelete={editingBottle ? handleDeleteBottle : undefined}
          onClose={() => { setShowBottleModal(false); setEditingBottle(null); setBottleDefaults(undefined) }}
          onMenuItemChange={handleMenuItemChange}
          defaultValues={bottleDefaults}
        />
      )}

      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onSave={handleSaveCategory}
          onDelete={editingCategory ? handleDeleteCategory : undefined}
          onClose={() => { setShowCategoryModal(false); setEditingCategory(null) }}
        />
      )}
    </div>
  )
}
