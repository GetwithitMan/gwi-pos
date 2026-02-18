'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import Link from 'next/link'

interface Ingredient86Status {
  id: string
  name: string
  category: string
  categoryIcon?: string
  categoryColor?: string
  is86d: boolean
  effectivelyIs86d: boolean
  parentIs86d: boolean
  last86dAt?: string
  showOnQuick86: boolean
  isBaseIngredient: boolean
  parentIngredientId?: string
  parentIngredientName?: string
  childCount: number
  affectedMenuItemsCount: number
  affectedModifiersCount: number
  affectedMenuItems: { id: string; name: string }[]
  affectedModifiers: { id: string; name: string; groupName: string }[]
  totalAffectedCount: number
}

interface CategoryGroup {
  [category: string]: Ingredient86Status[]
}

interface PrepItemsByParent {
  [parentId: string]: Ingredient86Status[]
}

export default function Quick86Page() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const [items, setItems] = useState<Ingredient86Status[]>([])
  const [quickList, setQuickList] = useState<Ingredient86Status[]>([])
  const [byCategory, setByCategory] = useState<CategoryGroup>({})
  const [prepItemsByParent, setPrepItemsByParent] = useState<PrepItemsByParent>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showOnly86d, setShowOnly86d] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState<string | null>(null)
  const [editingQuickList, setEditingQuickList] = useState(false)

  // Fetch 86 status data
  const fetchData = useCallback(async () => {
    if (!locationId) return

    try {
      const params = new URLSearchParams({
        locationId,
        ...(showOnly86d && { showOnly86d: 'true' }),
        ...(search && { search })
      })

      const res = await fetch(`/api/inventory/86-status?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')

      const json = await res.json()
      setItems(json.data.items)
      setQuickList(json.data.quickList || [])
      setByCategory(json.data.byCategory)
      setPrepItemsByParent(json.data.prepItemsByParent || {})

      // Auto-expand categories that have 86'd items
      const categoriesWithOOS = Object.entries(json.data.byCategory as CategoryGroup)
        .filter(([, catItems]) => catItems.some(i => i.is86d || i.effectivelyIs86d))
        .map(([cat]) => cat)
      setExpandedCategories(new Set(categoriesWithOOS))
    } catch (error) {
      console.error('Error fetching 86 status:', error)
      toast.error('Failed to load inventory status')
    } finally {
      setLoading(false)
    }
  }, [locationId, showOnly86d, search])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Toggle 86 status for a single item
  const toggle86 = async (ingredientId: string, newStatus: boolean, itemName: string) => {
    setUpdating(ingredientId)

    try {
      const res = await fetch('/api/inventory/86-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          is86d: newStatus,
          employeeId: employee?.id
        })
      })

      if (!res.ok) throw new Error('Failed to update')

      const json = await res.json()
      toast.success(json.data.message)

      // Refresh data to get updated hierarchy
      await fetchData()
    } catch (error) {
      console.error('Error updating 86 status:', error)
      toast.error(`Failed to update ${itemName}`)
    } finally {
      setUpdating(null)
    }
  }

  // Toggle quick list membership
  const toggleQuickList = async (ingredientId: string, showOnQuick86: boolean, itemName: string) => {
    try {
      const res = await fetch('/api/inventory/86-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId, showOnQuick86 })
      })

      if (!res.ok) throw new Error('Failed to update')

      const json = await res.json()
      toast.success(json.data.message)

      // Update local state
      const updateItem = (item: Ingredient86Status) =>
        item.id === ingredientId ? { ...item, showOnQuick86 } : item

      setItems(prev => prev.map(updateItem))
      setQuickList(prev =>
        showOnQuick86
          ? [...prev, items.find(i => i.id === ingredientId)!].filter(Boolean)
          : prev.filter(i => i.id !== ingredientId)
      )
    } catch (error) {
      console.error('Error updating quick list:', error)
      toast.error(`Failed to update ${itemName}`)
    }
  }

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  // Toggle item expansion (for prep items)
  const toggleItemExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  // Count 86'd items
  const total86d = items.filter(i => i.is86d).length
  const totalEffectively86d = items.filter(i => i.effectivelyIs86d).length

  // Render an item row
  const renderItemRow = (item: Ingredient86Status, isNested = false, showQuickListToggle = false) => {
    const isUpdating = updating === item.id
    const isPrepItem = !!item.parentIngredientId
    const hasChildren = item.childCount > 0
    const isExpanded = expandedItems.has(item.id)
    const prepItems = prepItemsByParent[item.id] || []

    return (
      <div key={item.id}>
        <div
          className={`border-b border-gray-200 last:border-b-0 ${
            item.effectivelyIs86d ? 'bg-red-50' : ''
          } ${isNested ? 'pl-8' : ''}`}
        >
          {/* Item row */}
          <div className="px-4 py-3 flex items-center justify-between gap-2">
            {/* Expand button for items with children */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {hasChildren && (
                <button
                  onClick={() => toggleItemExpand(item.id)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <svg
                    className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {isPrepItem && (
                <span className="text-gray-500 text-xs">└</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium truncate ${
                    item.effectivelyIs86d ? 'text-red-600 line-through' : 'text-gray-900'
                  }`}>
                    {item.name}
                  </span>
                  {isPrepItem && (
                    <span className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                      prep
                    </span>
                  )}
                  {item.parentIs86d && !item.is86d && (
                    <span className="text-xs text-orange-600">
                      (parent 86'd)
                    </span>
                  )}
                  {hasChildren && (
                    <span className="text-xs text-gray-600">
                      ({item.childCount} prep{item.childCount !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {item.totalAffectedCount > 0 && (
                  <span className="text-xs text-gray-600">
                    {item.totalAffectedCount} menu item{item.totalAffectedCount !== 1 ? 's' : ''} affected
                  </span>
                )}
              </div>
            </div>

            {/* Quick list toggle (when editing) */}
            {(showQuickListToggle || editingQuickList) && (
              <button
                onClick={() => toggleQuickList(item.id, !item.showOnQuick86, item.name)}
                className={`p-2 rounded-lg transition-colors ${
                  item.showOnQuick86
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title={item.showOnQuick86 ? 'Remove from Quick List' : 'Add to Quick List'}
              >
                <svg className="w-4 h-4" fill={item.showOnQuick86 ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}

            {/* Toggle button */}
            <button
              onClick={() => toggle86(item.id, !item.is86d, item.name)}
              disabled={isUpdating || item.parentIs86d}
              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                isUpdating
                  ? 'bg-gray-200 text-gray-500 cursor-wait'
                  : item.parentIs86d
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : item.is86d
                      ? 'bg-green-50 text-green-600 hover:bg-green-100'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
              title={item.parentIs86d ? 'Parent ingredient is 86\'d' : undefined}
            >
              {isUpdating ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : item.is86d ? (
                '✅ IN'
              ) : (
                '🔴 OUT'
              )}
            </button>
          </div>
        </div>

        {/* Nested prep items */}
        {hasChildren && isExpanded && prepItems.map(prepItem => renderItemRow(prepItem, true, showQuickListToggle))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
        <div className="text-gray-600 animate-pulse">Loading inventory...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-2xl">🚫</span>
              Quick 86
            </h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {totalEffectively86d > 0 && (
              <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full font-medium">
                {totalEffectively86d} item{totalEffectively86d !== 1 ? 's' : ''} out
              </span>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search ingredients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-4 py-2 pl-10 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <button
            onClick={() => setShowOnly86d(!showOnly86d)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              showOnly86d
                ? 'bg-red-500 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {showOnly86d ? "86'd Only" : 'Show All'}
          </button>

          <button
            onClick={() => setEditingQuickList(!editingQuickList)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              editingQuickList
                ? 'bg-amber-500 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {editingQuickList ? '✓ Done' : '⭐ Edit List'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Quick List Section */}
        {quickList.length > 0 && !search && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg overflow-hidden shadow">
            <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">⭐</span>
                <span className="font-semibold text-amber-700">Quick List</span>
                <span className="text-sm text-amber-600">({quickList.length} items)</span>
              </div>
              {quickList.some(i => i.effectivelyIs86d) && (
                <span className="px-2 py-0.5 text-xs bg-red-50 text-red-600 rounded-full">
                  {quickList.filter(i => i.effectivelyIs86d).length} out
                </span>
              )}
            </div>
            <div>
              {quickList.map(item => renderItemRow(item, false, true))}
            </div>
          </div>
        )}

        {/* All Items by Category */}
        {Object.entries(byCategory).length === 0 ? (
          <div className="text-center py-12 text-gray-600">
            {search ? 'No items match your search' : 'No inventory items found'}
          </div>
        ) : (
          Object.entries(byCategory).map(([category, categoryItems]) => {
            const category86Count = categoryItems.filter(i => i.effectivelyIs86d).length
            const categoryChildCount = categoryItems.reduce((sum, i) => sum + (prepItemsByParent[i.id]?.filter(p => p.effectivelyIs86d).length || 0), 0)
            const totalCategoryOut = category86Count + categoryChildCount
            const isExpanded = expandedCategories.has(category)

            return (
              <div key={category} className="bg-white rounded-lg overflow-hidden border border-gray-200 shadow">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-semibold text-gray-900">{category}</span>
                    <span className="text-sm text-gray-600">({categoryItems.length} items)</span>
                  </div>
                  {totalCategoryOut > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-red-50 text-red-600 rounded-full">
                      {totalCategoryOut} out
                    </span>
                  )}
                </button>

                {/* Category items */}
                {isExpanded && (
                  <div className="border-t border-gray-200">
                    {categoryItems.map(item => renderItemRow(item))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer info */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {items.length} items &bull; {totalEffectively86d} out of stock
          </span>
          <span>
            {editingQuickList ? 'Tap ⭐ to add/remove from Quick List' : 'Expand items to see prep variations'}
          </span>
        </div>
      </div>
    </div>
  )
}
