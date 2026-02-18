'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS } from '@/lib/constants'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { RecipeBuilder } from '@/components/menu/RecipeBuilder'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'

interface SpiritCategory {
  id: string
  name: string
  displayName?: string | null
  description?: string | null
  sortOrder: number
  isActive: boolean
  bottleCount: number
  modifierGroupCount: number
}

interface BottleProduct {
  id: string
  name: string
  brand?: string | null
  displayName?: string | null
  spiritCategoryId: string
  spiritCategory: {
    id: string
    name: string
    displayName?: string | null
  }
  tier: string
  bottleSizeMl: number
  bottleSizeOz?: number | null
  unitCost: number
  pourSizeOz?: number | null
  poursPerBottle?: number | null
  pourCost?: number | null
  currentStock: number
  lowStockAlert?: number | null
  isActive: boolean
  inventoryItemId?: string | null
  inventoryStock?: number | null // Stock in oz from linked InventoryItem
  hasMenuItem: boolean
  linkedMenuItems: {
    id: string
    name: string
    price: number
    isActive: boolean
    sortOrder: number
    category: { id: string; name: string }
  }[]
}

type TabType = 'bottles' | 'drinks' | 'modifiers'

function LiquorBuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [activeTab, setActiveTab] = useState<TabType>('bottles')
  const [isLoading, setIsLoading] = useState(true)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  // Data state
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [menuCategories, setMenuCategories] = useState<{ id: string; name: string; itemCount: number }[]>([])
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [modifierGroups, setModifierGroups] = useState<any[]>([])
  const [selectedModifierGroup, setSelectedModifierGroup] = useState<any | null>(null)

  // Modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showBottleModal, setShowBottleModal] = useState(false)
  const [showCreateMenuItemModal, setShowCreateMenuItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SpiritCategory | null>(null)
  const [editingBottle, setEditingBottle] = useState<BottleProduct | null>(null)
  const [bottleForMenuItem, setBottleForMenuItem] = useState<BottleProduct | null>(null)

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [tierFilter, setTierFilter] = useState<string>('')

  // Drag and drop state
  const [draggedBottleId, setDraggedBottleId] = useState<string | null>(null)
  const [dragOverBottleId, setDragOverBottleId] = useState<string | null>(null)

  // Flash animation for recently restored items
  const [flashingBottleId, setFlashingBottleId] = useState<string | null>(null)

  // Socket ref for real-time updates
  const socketRef = useRef<any>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/liquor-builder')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  // Socket connection for real-time updates (shared socket)
  useEffect(() => {
    const socket = getSharedSocket()
    socketRef.current = socket

    const onConnect = () => {
      socket.emit('join_station', {
        locationId: employee?.location?.id || '',
        tags: [],
        terminalId: getTerminalId(),
      })
    }

    const onMenuUpdated = () => {
      loadBottlesRef.current?.()
    }

    socket.on('connect', onConnect)
    socket.on('menu:updated', onMenuUpdated)

    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('menu:updated', onMenuUpdated)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [])


  const loadData = async () => {
    setIsLoading(true)
    try {
      const [categoriesData] = await Promise.all([loadCategories(), loadBottles(), loadDrinks(), loadModifierGroups()])
      // Auto-select first category to reduce screen clutter
      if (categoriesData && categoriesData.length > 0 && !categoryFilter) {
        setCategoryFilter(categoriesData[0].id)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const loadCategories = async () => {
    const res = await fetch('/api/liquor/categories')
    if (res.ok) {
      const data = await res.json()
      setCategories(data)
      return data as SpiritCategory[]
    }
    return [] as SpiritCategory[]
  }

  const loadBottles = async () => {
    const res = await fetch(`/api/liquor/bottles?_t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setBottles(data)
    }
  }

  const loadDrinks = async () => {
    const res = await fetch('/api/menu')
    if (res.ok) {
      const data = await res.json()
      const liquorItems = data.items.filter((item: any) => item.categoryType === 'liquor')
      setDrinks(liquorItems)
      // Load liquor-type menu categories (Beer, Cocktails, etc.)
      const liquorCats = data.categories.filter((c: any) => c.categoryType === 'liquor')
      setMenuCategories(liquorCats.map((c: any) => ({ id: c.id, name: c.name, itemCount: c.itemCount ?? 0 })))
    }
  }

  const loadModifierGroups = async () => {
    const res = await fetch('/api/menu/modifiers')
    if (res.ok) {
      const data = await res.json()
      // Filter to only liquor modifier groups
      const liquorGroups = data.modifierGroups.filter((g: any) =>
        g.modifierTypes && g.modifierTypes.includes('liquor')
      )
      setModifierGroups(liquorGroups)
      if (liquorGroups.length > 0 && !selectedModifierGroup) {
        setSelectedModifierGroup(liquorGroups[0])
      }
    }
  }

  // Refs for load functions to avoid stale closures in socket listener
  const loadBottlesRef = useRef<(() => Promise<void>) | null>(null)
  loadBottlesRef.current = loadBottles

  const getTierLabel = (tier: string) => {
    return SPIRIT_TIERS.find(t => t.value === tier)?.label || tier
  }

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      well: 'bg-gray-100 text-gray-700',
      call: 'bg-blue-100 text-blue-700',
      premium: 'bg-purple-100 text-purple-700',
      top_shelf: 'bg-amber-100 text-amber-700',
    }
    return colors[tier] || 'bg-gray-100 text-gray-700'
  }

  // Filter bottles
  const filteredBottles = bottles.filter(b => {
    if (categoryFilter && b.spiritCategoryId !== categoryFilter) return false
    if (tierFilter && b.tier !== tierFilter) return false
    return true
  })

  // Handle drag and drop reordering
  const handleDragStart = (bottleId: string) => {
    setDraggedBottleId(bottleId)
  }

  const handleDragOver = (e: React.DragEvent, bottleId: string) => {
    e.preventDefault()
    if (bottleId !== draggedBottleId) {
      setDragOverBottleId(bottleId)
    }
  }

  const handleDragEnd = () => {
    setDraggedBottleId(null)
    setDragOverBottleId(null)
  }

  const handleDrop = async (targetBottleId: string) => {
    if (!draggedBottleId || draggedBottleId === targetBottleId) {
      handleDragEnd()
      return
    }

    const draggedBottle = filteredBottles.find(b => b.id === draggedBottleId)
    const targetBottle = filteredBottles.find(b => b.id === targetBottleId)

    // Only reorder if both have menu items
    if (!draggedBottle?.hasMenuItem || !targetBottle?.hasMenuItem) {
      handleDragEnd()
      return
    }

    const draggedMenuItem = draggedBottle.linkedMenuItems[0]
    const targetMenuItem = targetBottle.linkedMenuItems[0]

    if (!draggedMenuItem || !targetMenuItem) {
      handleDragEnd()
      return
    }

    // Swap their positions
    const draggedPosition = draggedMenuItem.sortOrder
    const targetPosition = targetMenuItem.sortOrder

    // Update both menu items
    await Promise.all([
      fetch(`/api/menu/items/${draggedMenuItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: targetPosition }),
      }),
      fetch(`/api/menu/items/${targetMenuItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: draggedPosition }),
      }),
    ])

    handleDragEnd()
    loadBottles()
  }

  if (!isAuthenticated) return null

  // Check if this is a fresh setup (no data)
  const isEmptySetup = categories.length === 0 && bottles.length === 0 && menuCategories.length === 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Compact Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Liquor Builder</h1>
            <p className="text-xs text-gray-500">Manage bottles, categories & recipes</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/menu" className="text-xs text-blue-600 hover:underline">← Back to Menu</Link>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : isEmptySetup ? (
        /* Getting Started Guide */
        <div className="max-w-2xl mx-auto p-6">
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-xl font-bold mb-2">Getting Started</h2>
            <p className="text-gray-600 text-sm mb-6">Set up your liquor inventory in 3 steps:</p>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold shrink-0">1</div>
                <div className="flex-1">
                  <h3 className="font-semibold">Create Spirit Categories</h3>
                  <p className="text-sm text-gray-600 mb-2">Tequila, Vodka, Whiskey, Rum, Gin, etc.</p>
                  <Button size="sm" onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}>
                    + Add Category
                  </Button>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">2</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-500">Add Your Bottles</h3>
                  <p className="text-sm text-gray-400">Add bottles with cost, size, and tier (well/call/premium/top shelf)</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">3</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-500">Set Up Cocktail Recipes</h3>
                  <p className="text-sm text-gray-400">Link bottles to cocktails for cost tracking</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main Interface */
        <div className="flex h-[calc(100vh-57px)]">
          {/* Left Sidebar - Categories + Quick Add */}
          <div className="w-48 bg-white border-r flex flex-col shrink-0">
            <div className="p-2 border-b">
              <button
                onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}
                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded"
              >
                + Add Category
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {/* Menu Categories (Beer, Cocktails, etc.) */}
              {menuCategories.length > 0 && (
                <>
                  <div className="text-[10px] uppercase text-gray-400 font-medium px-2 mb-1">Menu Categories</div>
                  {menuCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => { setActiveTab('drinks'); }}
                      className="w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between hover:bg-gray-100"
                    >
                      <span className="truncate">{cat.name}</span>
                      <span className="text-xs text-gray-400">{cat.itemCount}</span>
                    </button>
                  ))}
                </>
              )}
              {/* Spirit Categories (Vodka, Whiskey, etc.) */}
              <div className="text-[10px] uppercase text-gray-400 font-medium px-2 mb-1 mt-3">Spirit Categories</div>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setCategoryFilter(cat.id); setActiveTab('bottles'); }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ${
                    categoryFilter === cat.id ? 'bg-purple-100 text-purple-700' : 'hover:bg-gray-100'
                  }`}
                >
                  <span className="truncate">{cat.name}</span>
                  <span className="text-xs text-gray-400">{cat.bottleCount}</span>
                </button>
              ))}
              {categoryFilter && (
                <button
                  onClick={() => setCategoryFilter('')}
                  className="w-full text-left px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear filter
                </button>
              )}
            </div>
            {/* Quick Stats */}
            <div className="p-2 border-t bg-gray-50 text-xs">
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">Bottles:</span>
                <span className="font-medium">{bottles.length}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">Modifiers:</span>
                <span className="font-medium">{modifierGroups.length}</span>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs + Actions Bar */}
            <div className="bg-white border-b px-3 py-2 flex items-center justify-between shrink-0">
              <div className="flex gap-1">
                {[
                  { id: 'bottles', label: 'Bottles', count: filteredBottles.length },
                  { id: 'drinks', label: 'Drinks', count: drinks.length },
                  { id: 'modifiers', label: 'Modifiers', count: modifierGroups.length },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      activeTab === tab.id
                        ? 'bg-purple-100 text-purple-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {tab.label}
                    <span className="ml-1 text-xs opacity-70">({tab.count})</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {activeTab === 'bottles' && (
                  <>
                    <select
                      value={tierFilter}
                      onChange={e => setTierFilter(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value="">All Tiers</option>
                      {SPIRIT_TIERS.map(tier => (
                        <option key={tier.value} value={tier.value}>{tier.label}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={() => { setEditingBottle(null); setShowBottleModal(true); }}>
                      + Bottle
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-3">
              {/* Bottles Tab */}
              {activeTab === 'bottles' && (
                filteredBottles.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-2">No bottles {categoryFilter ? 'in this category' : 'yet'}</p>
                    <Button size="sm" onClick={() => { setEditingBottle(null); setShowBottleModal(true); }}>
                      + Add Bottle
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* ON POS Section */}
                    <div className="bg-white rounded-lg border-2 border-green-200 overflow-hidden">
                      <div className="bg-green-500 text-white px-4 py-2 font-semibold flex items-center gap-2">
                        <span>✓</span>
                        <span>On POS Menu</span>
                        <span className="ml-auto bg-green-600 px-2 py-0.5 rounded text-sm">
                          {filteredBottles.filter(b => b.hasMenuItem).length} items
                        </span>
                      </div>
                      {filteredBottles.filter(b => b.hasMenuItem).length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                          No bottles on POS yet. Click a bottle below to add it.
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-green-50 text-xs border-b border-green-200">
                            <tr>
                              <th className="w-8 px-1"></th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Product</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-700">Tier</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Size</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Cost</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Pours</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Pour $</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Price</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Profit</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Margin</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Stock</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-700">Position</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-700">Hide</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredBottles.filter(b => b.hasMenuItem).map((bottle, idx) => {
                              const isLowStock = bottle.lowStockAlert && bottle.currentStock <= bottle.lowStockAlert
                              const menuItem = bottle.linkedMenuItems?.[0]
                              const menuPrice = menuItem?.price || 0
                              const pourCost = bottle.pourCost || 0
                              const profit = menuPrice > 0 && pourCost > 0 ? menuPrice - pourCost : 0
                              const margin = menuPrice > 0 && pourCost > 0 ? ((menuPrice - pourCost) / menuPrice) * 100 : 0
                              const position = menuItem?.sortOrder || null

                              const isDragging = draggedBottleId === bottle.id
                              const isDragOver = dragOverBottleId === bottle.id

                              const isFlashing = flashingBottleId === bottle.id

                              return (
                                <tr
                                  key={bottle.id}
                                  draggable={true}
                                  onDragStart={() => handleDragStart(bottle.id)}
                                  onDragOver={(e) => handleDragOver(e, bottle.id)}
                                  onDragEnd={handleDragEnd}
                                  onDrop={() => handleDrop(bottle.id)}
                                  className={`cursor-pointer border-b border-green-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-green-50/50'} hover:bg-green-100 ${!bottle.isActive ? 'opacity-50' : ''} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-purple-500' : ''} ${isFlashing ? 'animate-flash-green' : ''}`}
                                  onClick={() => { setEditingBottle(bottle); setShowBottleModal(true); }}
                                >
                                  <td className="px-1 py-2 text-center">
                                    <span className="cursor-grab text-gray-400 hover:text-gray-600">⋮⋮</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="font-medium">{bottle.name}</div>
                                    {bottle.brand && <div className="text-xs text-gray-500">{bottle.brand}</div>}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      bottle.tier === 'well' ? 'bg-gray-200 text-gray-700' :
                                      bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                                      bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                                      'bg-amber-100 text-amber-700'
                                    }`}>
                                      {bottle.tier === 'well' ? 'WELL' :
                                       bottle.tier === 'call' ? 'CALL' :
                                       bottle.tier === 'premium' ? 'PREM' :
                                       'TOP'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-600">{bottle.bottleSizeMl}ml</td>
                                  <td className="px-3 py-2 text-right text-red-600 font-medium">{formatCurrency(bottle.unitCost)}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{bottle.poursPerBottle || '-'}</td>
                                  <td className="px-3 py-2 text-right text-red-600">{pourCost ? formatCurrency(pourCost) : '-'}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(menuPrice)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <span className="text-green-600 font-semibold">{formatCurrency(profit)}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={`font-semibold ${
                                      margin >= 75 ? 'text-green-600' :
                                      margin >= 65 ? 'text-yellow-600' :
                                      'text-red-600'
                                    }`}>
                                      {margin.toFixed(0)}%
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={isLowStock ? 'text-red-600 font-bold' : 'text-gray-700'}>
                                      {bottle.currentStock}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <input
                                      type="number"
                                      min="1"
                                      defaultValue={position || ''}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter') {
                                          const newPosition = parseInt((e.target as HTMLInputElement).value) || 1
                                          await fetch(`/api/menu/items/${menuItem!.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ sortOrder: newPosition }),
                                          })
                                          loadBottles()
                                        }
                                      }}
                                      onBlur={async (e) => {
                                        const newPosition = parseInt(e.target.value) || 1
                                        if (newPosition !== position) {
                                          await fetch(`/api/menu/items/${menuItem!.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ sortOrder: newPosition }),
                                          })
                                          loadBottles()
                                        }
                                      }}
                                      className="w-14 px-2 py-1 text-center text-sm border border-gray-300 rounded bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                      placeholder="#"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation()
                                        await fetch(`/api/menu/items/${menuItem!.id}`, {
                                          method: 'PUT',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                                        })
                                        await loadBottles()
                                                                  }}
                                      className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 px-2 py-1 rounded text-xs"
                                      title="Hide from POS"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* NOT ON POS Section */}
                    <div className="bg-white rounded-lg border-2 border-gray-300 overflow-hidden">
                      <div className="bg-gray-500 text-white px-4 py-2 font-semibold flex items-center gap-2">
                        <span>○</span>
                        <span>Not on POS</span>
                        <span className="text-gray-300 text-sm ml-2">Out of season / Out of stock</span>
                        <span className="ml-auto bg-gray-600 px-2 py-0.5 rounded text-sm">
                          {filteredBottles.filter(b => !b.hasMenuItem).length} items
                        </span>
                      </div>
                      {filteredBottles.filter(b => !b.hasMenuItem).length === 0 ? (
                        <div className="p-6 text-center text-gray-500">
                          All bottles are on POS!
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-100 text-xs border-b border-gray-200">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-600">Tier</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">Size</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">Cost</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">Pours</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">Pour $</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">Stock</th>
                              <th className="px-3 py-2 text-center font-medium text-gray-600">Add to POS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredBottles.filter(b => !b.hasMenuItem).map((bottle, idx) => {
                              const isLowStock = bottle.lowStockAlert && bottle.currentStock <= bottle.lowStockAlert
                              const pourCost = bottle.pourCost || 0

                              return (
                                <tr
                                  key={bottle.id}
                                  className={`cursor-pointer border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100 ${!bottle.isActive ? 'opacity-50' : ''}`}
                                  onClick={() => { setEditingBottle(bottle); setShowBottleModal(true); }}
                                >
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-gray-700">{bottle.name}</div>
                                    {bottle.brand && <div className="text-xs text-gray-400">{bottle.brand}</div>}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      bottle.tier === 'well' ? 'bg-gray-200 text-gray-700' :
                                      bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                                      bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                                      'bg-amber-100 text-amber-700'
                                    }`}>
                                      {bottle.tier === 'well' ? 'WELL' :
                                       bottle.tier === 'call' ? 'CALL' :
                                       bottle.tier === 'premium' ? 'PREM' :
                                       'TOP'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-500">{bottle.bottleSizeMl}ml</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(bottle.unitCost)}</td>
                                  <td className="px-3 py-2 text-right text-gray-500">{bottle.poursPerBottle || '-'}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">{pourCost ? formatCurrency(pourCost) : '-'}</td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={isLowStock ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                      {bottle.currentStock}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation()
                                        // First try to restore a soft-deleted menu item
                                        const restoreRes = await fetch(`/api/liquor/bottles/${bottle.id}/restore-menu-item`, {
                                          method: 'POST',
                                        })
                                        if (restoreRes.ok) {
                                          // Set flashing state before loading data
                                          setFlashingBottleId(bottle.id)
                                          await loadBottles()
                                                                        // Clear flash after animation
                                          setTimeout(() => setFlashingBottleId(null), 2000)
                                        } else {
                                          // No deleted item to restore, open modal to create new one
                                          setEditingBottle(bottle)
                                          setShowBottleModal(true)
                                        }
                                      }}
                                      className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 font-medium"
                                    >
                                      + Add to POS
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )
              )}

              {/* Drinks Tab */}
              {activeTab === 'drinks' && (
                <div className="flex h-full">
                  {/* Left: Drinks List */}
                  <div className="w-80 bg-white border-r overflow-y-auto">
                    <div className="p-3 space-y-1">
                      {drinks.map(drink => (
                        <div
                          key={drink.id}
                          onClick={() => setSelectedDrink(drink)}
                          className={`p-3 rounded cursor-pointer transition-colors ${
                            selectedDrink?.id === drink.id
                              ? 'bg-purple-50 border-2 border-purple-500'
                              : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                          }`}
                        >
                          <div className="font-medium text-sm">{drink.name}</div>
                          <div className="text-xs text-gray-600 mt-1">{formatCurrency(drink.price)}</div>
                          {drink.hasRecipe && (
                            <div className="text-xs text-green-600 mt-1">✓ {drink.recipeIngredientCount} bottles</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Drink Editor with Recipe */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {selectedDrink ? (
                      <div className="bg-white rounded-lg border p-6">
                        <h2 className="text-2xl font-bold mb-2">{selectedDrink.name}</h2>
                        <p className="text-xl text-gray-600 mb-6">{formatCurrency(selectedDrink.price)}</p>

                        <RecipeBuilder
                          menuItemId={selectedDrink.id}
                          menuItemPrice={selectedDrink.price}
                          isExpanded={true}
                          onToggle={() => {}}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        <p>Select a drink to edit recipe</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modifiers Tab */}
              {activeTab === 'modifiers' && (
                <div className="flex h-full">
                  {/* Left Panel - Modifier Groups List */}
                  <div className="w-80 bg-white border-r p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Liquor Modifier Groups</h3>
                      <p className="text-xs text-gray-500">Mixers, Garnishes, Ice, Spirit Upgrades</p>
                    </div>
                    {modifierGroups.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 text-sm">
                        <p>No liquor modifiers yet</p>
                        <p className="text-xs mt-2">Create modifier groups in the Modifiers admin</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {modifierGroups.map(group => (
                          <div
                            key={group.id}
                            onClick={() => setSelectedModifierGroup(group)}
                            className={`p-3 rounded-lg cursor-pointer transition-colors border ${
                              selectedModifierGroup?.id === group.id
                                ? 'bg-purple-50 border-purple-500'
                                : 'bg-gray-50 hover:bg-gray-100 border-transparent'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-medium text-sm">{group.name}</h4>
                              {group.isSpiritGroup && <span className="text-lg">🥃</span>}
                            </div>
                            <p className="text-xs text-gray-500">
                              {group.modifiers.length} options
                              {group.isRequired && <span className="ml-2 text-red-500">Required</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push('/menu')}
                        className="w-full"
                      >
                        Manage in Menu Builder →
                      </Button>
                    </div>
                  </div>

                  {/* Right Panel - Selected Group Details */}
                  <div className="flex-1 p-6">
                    {selectedModifierGroup ? (
                      <div className="bg-white rounded-lg border p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <div className="flex items-center gap-3">
                              <h2 className="text-xl font-bold">{selectedModifierGroup.name}</h2>
                              {selectedModifierGroup.isSpiritGroup && (
                                <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                                  Spirit Upgrade Group
                                </span>
                              )}
                            </div>
                            {selectedModifierGroup.displayName && (
                              <p className="text-sm text-gray-500 mt-1">{selectedModifierGroup.displayName}</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => router.push('/menu')}
                          >
                            Edit in Menu Builder
                          </Button>
                        </div>

                        <div className="grid grid-cols-4 gap-4 mb-6">
                          <div className="bg-gray-50 p-3 rounded">
                            <p className="text-xs text-gray-500">Min Selections</p>
                            <p className="font-semibold">{selectedModifierGroup.minSelections}</p>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <p className="text-xs text-gray-500">Max Selections</p>
                            <p className="font-semibold">{selectedModifierGroup.maxSelections}</p>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <p className="text-xs text-gray-500">Required</p>
                            <p className="font-semibold">{selectedModifierGroup.isRequired ? 'Yes' : 'No'}</p>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <p className="text-xs text-gray-500">Allow Stacking</p>
                            <p className="font-semibold">{selectedModifierGroup.allowStacking ? 'Yes' : 'No'}</p>
                          </div>
                        </div>

                        <h3 className="font-semibold mb-3">Modifiers ({selectedModifierGroup.modifiers.length})</h3>
                        <div className="space-y-2">
                          {selectedModifierGroup.modifiers.map((mod: any) => (
                            <div
                              key={mod.id}
                              className={`p-3 rounded border flex items-center justify-between ${
                                mod.isActive ? 'bg-white' : 'bg-gray-100 opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {mod.spiritTier && (
                                  <span className="px-2 py-0.5 rounded text-xs text-white font-medium bg-purple-600">
                                    {mod.spiritTier.replace('_', ' ').toUpperCase()}
                                  </span>
                                )}
                                {mod.isDefault && (
                                  <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                                    Default
                                  </span>
                                )}
                                <span className={mod.isActive ? 'font-medium' : 'line-through'}>{mod.name}</span>
                              </div>
                              <div className="text-sm">
                                {mod.price > 0 ? (
                                  <span className="text-green-600 font-medium">+{formatCurrency(mod.price)}</span>
                                ) : (
                                  <span className="text-gray-400">No charge</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {selectedModifierGroup.linkedItems && selectedModifierGroup.linkedItems.length > 0 && (
                          <>
                            <h3 className="font-semibold mt-6 mb-3">Used by Items</h3>
                            <div className="flex flex-wrap gap-2">
                              {selectedModifierGroup.linkedItems.map((item: any) => (
                                <span key={item.id} className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                                  {item.name}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500">
                        Select a modifier group to view details
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onSave={async (data) => {
            const method = editingCategory ? 'PUT' : 'POST'
            const url = editingCategory ? `/api/liquor/categories/${editingCategory.id}` : '/api/liquor/categories'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            if (res.ok) {
              await loadCategories()
              setShowCategoryModal(false)
              setEditingCategory(null)
            }
          }}
          onDelete={editingCategory ? async () => {
            if (!confirm('Delete this category?')) return
            const res = await fetch(`/api/liquor/categories/${editingCategory.id}`, { method: 'DELETE' })
            if (res.ok) {
              await loadCategories()
              setShowCategoryModal(false)
              setEditingCategory(null)
            } else {
              const err = await res.json()
              toast.error(err.error || 'Failed to delete')
            }
          } : undefined}
          onClose={() => { setShowCategoryModal(false); setEditingCategory(null); }}
        />
      )}

      {/* Bottle Modal */}
      {showBottleModal && (
        <BottleModal
          bottle={editingBottle}
          categories={categories}
          onSave={async (data) => {
            const method = editingBottle ? 'PUT' : 'POST'
            const url = editingBottle ? `/api/liquor/bottles/${editingBottle.id}` : '/api/liquor/bottles'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            if (res.ok) {
              await loadBottles()
              setShowBottleModal(false)
              setEditingBottle(null)
            }
          }}
          onDelete={editingBottle ? async () => {
            if (!confirm('Delete this bottle?')) return
            const res = await fetch(`/api/liquor/bottles/${editingBottle.id}`, { method: 'DELETE' })
            if (res.ok) {
              await loadBottles()
              setShowBottleModal(false)
              setEditingBottle(null)
            } else {
              const err = await res.json()
              toast.error(err.error || 'Failed to delete')
            }
          } : undefined}
          onClose={() => { setShowBottleModal(false); setEditingBottle(null); }}
          onMenuItemChange={async () => {
            await loadBottles()
          }}
        />
      )}


      {/* Create Menu Item Modal */}
      {showCreateMenuItemModal && bottleForMenuItem && (
        <CreateMenuItemModal
          bottle={bottleForMenuItem}
          onSave={async (data) => {
            const res = await fetch(`/api/liquor/bottles/${bottleForMenuItem.id}/create-menu-item`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            if (res.ok) {
              await loadBottles()
              setShowCreateMenuItemModal(false)
              setBottleForMenuItem(null)
            } else {
              const err = await res.json()
              toast.error(err.error || 'Failed to create menu item')
            }
          }}
          onClose={() => { setShowCreateMenuItemModal(false); setBottleForMenuItem(null); }}
        />
      )}

    </div>
  )
}

// Category Modal Component
function CategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: {
  category: SpiritCategory | null
  onSave: (data: { name: string; displayName?: string; description?: string; isActive?: boolean }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [displayName, setDisplayName] = useState(category?.displayName || '')
  const [description, setDescription] = useState(category?.description || '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name, displayName: displayName || undefined, description: description || undefined, isActive })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={category ? 'Edit Category' : 'New Spirit Category'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Tequila, Vodka, Rum"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Optional display name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              rows={2}
            />
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>
          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Saving...' : category ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
    </Modal>
  )
}

// Bottle Modal Component
function BottleModal({
  bottle,
  categories,
  onSave,
  onDelete,
  onClose,
  onMenuItemChange,
}: {
  bottle: BottleProduct | null
  categories: SpiritCategory[]
  onSave: (data: any) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  onMenuItemChange?: () => void
}) {
  const [name, setName] = useState(bottle?.name || '')
  const [brand, setBrand] = useState(bottle?.brand || '')
  const [spiritCategoryId, setSpiritCategoryId] = useState(bottle?.spiritCategoryId || categories[0]?.id || '')
  const [tier, setTier] = useState(bottle?.tier || 'well')
  const [bottleSizeMl, setBottleSizeMl] = useState(bottle?.bottleSizeMl?.toString() || '750')
  const [unitCost, setUnitCost] = useState(bottle?.unitCost?.toString() || '')
  const [pourSizeOz, setPourSizeOz] = useState(bottle?.pourSizeOz?.toString() || '')
  const [currentStock, setCurrentStock] = useState(bottle?.currentStock?.toString() || '0')
  const [lowStockAlert, setLowStockAlert] = useState(bottle?.lowStockAlert?.toString() || '')
  const [isActive, setIsActive] = useState(bottle?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  // POS Menu state
  const [showOnPOS, setShowOnPOS] = useState(bottle?.hasMenuItem ?? false)
  const [menuPrice, setMenuPrice] = useState(bottle?.linkedMenuItems?.[0]?.price?.toString() || '')
  const [savingMenu, setSavingMenu] = useState(false)

  // Calculate pour metrics preview
  const effectivePourSizeOz = pourSizeOz ? parseFloat(pourSizeOz) : LIQUOR_DEFAULTS.pourSizeOz
  const bottleMl = parseInt(bottleSizeMl) || 0
  const cost = parseFloat(unitCost) || 0
  const poursPerBottle = bottleMl > 0 ? Math.floor(bottleMl / (effectivePourSizeOz * LIQUOR_DEFAULTS.mlPerOz)) : 0
  const pourCost = poursPerBottle > 0 ? cost / poursPerBottle : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !spiritCategoryId || !bottleSizeMl || !unitCost) return
    setSaving(true)
    await onSave({
      name,
      brand: brand || undefined,
      spiritCategoryId,
      tier,
      bottleSizeMl: parseInt(bottleSizeMl),
      unitCost: parseFloat(unitCost),
      pourSizeOz: pourSizeOz ? parseFloat(pourSizeOz) : undefined,
      currentStock: parseInt(currentStock) || 0,
      lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : undefined,
      isActive,
    })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={bottle ? 'Edit Bottle' : 'New Bottle Product'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron Silver"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={e => setBrand(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Spirit Category *</label>
              <select
                value={spiritCategoryId}
                onChange={e => setSpiritCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tier *</label>
              <select
                value={tier}
                onChange={e => setTier(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {SPIRIT_TIERS.map(t => (
                  <option key={t.value} value={t.value}>{t.label} - {t.description}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bottle Size (mL) *</label>
              <select
                value={bottleSizeMl}
                onChange={e => setBottleSizeMl(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {BOTTLE_SIZES.map(size => (
                  <option key={size.value} value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit Cost ($) *</label>
              <input
                type="number"
                step="0.01"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., 42.99"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pour Size (oz)</label>
              <input
                type="number"
                step="0.25"
                value={pourSizeOz}
                onChange={e => setPourSizeOz(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder={`Default: ${LIQUOR_DEFAULTS.pourSizeOz}`}
              />
            </div>
          </div>

          {/* Calculated Preview */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 mb-2">Calculated Metrics</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Pours per Bottle:</span>
                <span className="ml-2 font-bold text-blue-900">{poursPerBottle}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Cost:</span>
                <span className="ml-2 font-bold text-green-600">{formatCurrency(pourCost)}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Size:</span>
                <span className="ml-2 font-bold text-blue-900">{effectivePourSizeOz} oz</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Current Stock (bottles)</label>
              <input
                type="number"
                value={currentStock}
                onChange={e => setCurrentStock(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Low Stock Alert</label>
              <input
                type="number"
                value={lowStockAlert}
                onChange={e => setLowStockAlert(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Alert when below this"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>

          {/* Show on POS Menu */}
          {bottle && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-purple-900">Show on POS Menu</h4>
                <button
                  type="button"
                  onClick={async () => {
                    if (!showOnPOS) {
                      // Turning ON - need a price
                      if (!menuPrice || parseFloat(menuPrice) <= 0) {
                        // Set a suggested price based on 75% margin
                        const suggested = pourCost > 0 ? Math.ceil(pourCost / 0.25) : 0
                        setMenuPrice(suggested.toString())
                      }
                      setShowOnPOS(true)
                    } else {
                      // Turning OFF - remove from POS
                      if (bottle.linkedMenuItems?.[0]?.id) {
                        setSavingMenu(true)
                        await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                        })
                        setSavingMenu(false)
                        onMenuItemChange?.()
                      }
                      setShowOnPOS(false)
                      setMenuPrice('')
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    showOnPOS ? 'bg-purple-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showOnPOS ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {showOnPOS && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-purple-800 mb-1">Sell Price *</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.25"
                        value={menuPrice}
                        onChange={e => setMenuPrice(e.target.value)}
                        className="flex-1 border rounded-lg px-3 py-2"
                        placeholder="e.g., 8.00"
                      />
                      <button
                        type="button"
                        disabled={savingMenu || !menuPrice || parseFloat(menuPrice) <= 0}
                        onClick={async () => {
                          if (!menuPrice || parseFloat(menuPrice) <= 0) return
                          setSavingMenu(true)

                          if (bottle.linkedMenuItems?.[0]?.id) {
                            // Update existing
                            await fetch(`/api/menu/items/${bottle.linkedMenuItems[0].id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ price: parseFloat(menuPrice) }),
                            })
                          } else {
                            // Create new
                            await fetch(`/api/liquor/bottles/${bottle.id}/create-menu-item`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ price: parseFloat(menuPrice) }),
                            })
                          }

                          setSavingMenu(false)
                          onMenuItemChange?.()
                        }}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {savingMenu ? '...' : bottle.hasMenuItem ? 'Update' : 'Add to POS'}
                      </button>
                    </div>
                  </div>

                  {/* Margin preview */}
                  {menuPrice && parseFloat(menuPrice) > 0 && pourCost > 0 && (
                    <div className="text-sm text-purple-700">
                      Margin: <span className={`font-bold ${
                        ((parseFloat(menuPrice) - pourCost) / parseFloat(menuPrice)) * 100 >= 70
                          ? 'text-green-600'
                          : 'text-yellow-600'
                      }`}>
                        {(((parseFloat(menuPrice) - pourCost) / parseFloat(menuPrice)) * 100).toFixed(0)}%
                      </span>
                      {' '}(Profit: {formatCurrency(parseFloat(menuPrice) - pourCost)})
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim() || !spiritCategoryId || !unitCost}>
                {saving ? 'Saving...' : bottle ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
    </Modal>
  )
}

// Create Menu Item Modal Component
function CreateMenuItemModal({
  bottle,
  onSave,
  onClose,
}: {
  bottle: BottleProduct
  onSave: (data: { price: number; name?: string }) => Promise<void>
  onClose: () => void
}) {
  const [price, setPrice] = useState('')
  const [name, setName] = useState(bottle.name)
  const [saving, setSaving] = useState(false)

  // Suggest prices based on pour cost with different margins
  const pourCost = bottle.pourCost || 0
  const suggestedPrices = [
    { margin: 70, price: Math.ceil(pourCost / 0.30) },
    { margin: 75, price: Math.ceil(pourCost / 0.25) },
    { margin: 80, price: Math.ceil(pourCost / 0.20) },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!price || parseFloat(price) <= 0) return
    setSaving(true)
    await onSave({ price: parseFloat(price), name: name !== bottle.name ? name : undefined })
    setSaving(false)
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Menu Item" size="md">
        <p className="text-sm text-gray-500 mb-4">
          Create a POS menu item for <strong>{bottle.name}</strong>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Bottle Info */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Category:</span>
              <span className="font-medium">{bottle.spiritCategory.name}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Tier:</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                bottle.tier === 'well' ? 'bg-gray-100 text-gray-700' :
                bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {bottle.tier.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Pour Cost:</span>
              <span className="font-medium text-green-600">{formatCurrency(pourCost)}</span>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Menu Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={bottle.name}
            />
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-medium mb-1">Sell Price *</label>
            <input
              type="number"
              step="0.25"
              value={price}
              onChange={e => setPrice(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., 8.00"
              required
            />
          </div>

          {/* Suggested Prices */}
          {pourCost > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-2">Suggested prices (by profit margin):</label>
              <div className="flex gap-2">
                {suggestedPrices.map(({ margin, price: suggested }) => (
                  <button
                    key={margin}
                    type="button"
                    onClick={() => setPrice(suggested.toString())}
                    className={`flex-1 px-2 py-1.5 text-sm border rounded hover:bg-gray-50 ${
                      parseFloat(price) === suggested ? 'border-purple-500 bg-purple-50' : ''
                    }`}
                  >
                    <div className="font-medium">{formatCurrency(suggested)}</div>
                    <div className="text-xs text-gray-500">{margin}% margin</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Profit Preview */}
          {price && parseFloat(price) > 0 && pourCost > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-green-700">Gross Profit:</span>
                <span className="font-bold text-green-700">
                  {formatCurrency(parseFloat(price) - pourCost)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Profit Margin:</span>
                <span className="font-bold text-green-700">
                  {(((parseFloat(price) - pourCost) / parseFloat(price)) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !price || parseFloat(price) <= 0}>
              {saving ? 'Creating...' : 'Create Menu Item'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}

export default function LiquorBuilderPage() {
  return (
    <>
      <style jsx global>{`
        @keyframes flash-green {
          0%, 100% { background-color: transparent; }
          25% { background-color: #22c55e; }
          50% { background-color: #86efac; }
          75% { background-color: #22c55e; }
        }
        .animate-flash-green {
          animation: flash-green 0.5s ease-in-out 2;
        }
      `}</style>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
        <LiquorBuilderContent />
      </Suspense>
    </>
  )
}
