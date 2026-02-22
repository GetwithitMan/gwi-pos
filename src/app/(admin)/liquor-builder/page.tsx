'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS } from '@/lib/constants'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { RecipeBuilder } from '@/components/menu/RecipeBuilder'
import { ModifierFlowEditor } from '@/components/menu/ModifierFlowEditor'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'
import { SpiritCategory, BottleProduct } from './types'
import { CategoryModal } from './CategoryModal'
import { BottleModal } from './BottleModal'
import { CreateMenuItemModal } from './CreateMenuItemModal'
import { LiquorModifierGroupEditor } from './LiquorModifierGroupEditor'

type TabType = 'bottles' | 'drinks' | 'modifiers'

function LiquorBuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/liquor-builder' })
  const employee = useAuthStore(s => s.employee)
  const [activeTab, setActiveTab] = useState<TabType>('bottles')
  const [isLoading, setIsLoading] = useState(true)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  // Data state
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [menuCategories, setMenuCategories] = useState<{ id: string; name: string; itemCount: number; color: string }[]>([])
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [modifierGroups, setModifierGroups] = useState<any[]>([])
  const [selectedModifierGroup, setSelectedModifierGroup] = useState<any | null>(null)

  // Modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showMenuCategoryModal, setShowMenuCategoryModal] = useState(false)
  const [editingMenuCategory, setEditingMenuCategory] = useState<{ id: string; name: string; color: string } | null>(null)
  const [showBottleModal, setShowBottleModal] = useState(false)
  const [showCreateMenuItemModal, setShowCreateMenuItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SpiritCategory | null>(null)
  const [editingBottle, setEditingBottle] = useState<BottleProduct | null>(null)
  const [bottleForMenuItem, setBottleForMenuItem] = useState<BottleProduct | null>(null)

  // Drink inline editing state
  const [editingDrinkName, setEditingDrinkName] = useState<string>('')
  const [editingDrinkPrice, setEditingDrinkPrice] = useState<string>('')
  const [drinkModifierGroups, setDrinkModifierGroups] = useState<any[]>([])
  const [savingDrink, setSavingDrink] = useState(false)

  // Pour size editing state
  const [enabledPourSizes, setEnabledPourSizes] = useState<Record<string, { label: string; multiplier: number }>>({})
  const [defaultPourSize, setDefaultPourSize] = useState<string>('standard')
  const [applyPourToModifiers, setApplyPourToModifiers] = useState(false)

  // Modifier group editor state (inline in Drinks tab)
  const [selectedModGroupId, setSelectedModGroupId] = useState<string | null>(null)
  const [modGroupRefreshKey, setModGroupRefreshKey] = useState(0)
  const [addingGroup, setAddingGroup] = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [attachingGroupId, setAttachingGroupId] = useState<string | null>(null)

  // Spirit tier editor state
  const [spiritMode, setSpiritMode] = useState(false)
  const [spiritGroupId, setSpiritGroupId] = useState<string | null>(null)
  const [spiritEntries, setSpiritEntries] = useState<Array<{
    id?: string
    bottleProductId: string
    bottleName: string
    tier: string
    price: number
  }>>([])
  const [savingSpirit, setSavingSpirit] = useState(false)

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [tierFilter, setTierFilter] = useState<string>('')
  const [selectedMenuCategoryId, setSelectedMenuCategoryId] = useState<string>('')

  // Drag and drop state
  const [draggedBottleId, setDraggedBottleId] = useState<string | null>(null)
  const [dragOverBottleId, setDragOverBottleId] = useState<string | null>(null)

  // Flash animation for recently restored items
  const [flashingBottleId, setFlashingBottleId] = useState<string | null>(null)

  // Socket ref for real-time updates
  const socketRef = useRef<any>(null)

  useEffect(() => {
    loadData()
  }, [])

  // Socket connection for real-time updates (shared socket)
  useEffect(() => {
    if (!employee?.location?.id) return

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
  }, [employee?.location?.id])


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
      const liquorItems = data.data.items.filter((item: any) => item.categoryType === 'liquor')
      setDrinks(liquorItems)
      // Load liquor-type menu categories (Beer, Cocktails, etc.)
      const liquorCats = data.data.categories.filter((c: any) => c.categoryType === 'liquor')
      setMenuCategories(liquorCats.map((c: any) => ({ id: c.id, name: c.name, itemCount: c.itemCount ?? 0, color: c.color || '#8b5cf6' })))
    }
  }

  const loadModifierGroups = async () => {
    const res = await fetch('/api/menu/modifiers')
    if (res.ok) {
      const data = await res.json()
      // Filter to only liquor modifier groups
      const liquorGroups = data.data.modifierGroups.filter((g: any) =>
        g.modifierTypes && g.modifierTypes.includes('liquor')
      )
      setModifierGroups(liquorGroups)
      if (liquorGroups.length > 0 && !selectedModifierGroup) {
        setSelectedModifierGroup(liquorGroups[0])
      }
      return liquorGroups
    }
    return []
  }

  const addModifierGroup = async () => {
    const res = await fetch('/api/menu/modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Group', modifierTypes: ['liquor'] }),
    })
    if (res.ok) {
      const data = await res.json()
      const groups = await loadModifierGroups()
      const newGroup = (groups as any[]).find((g: any) => g.id === data.data?.id)
      setSelectedModifierGroup(newGroup || null)
    } else {
      toast.error('Failed to create modifier group')
    }
  }

  const deleteModifierGroup = async (groupId: string) => {
    const res = await fetch(`/api/menu/modifiers/${groupId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Group deleted')
      const groups = await loadModifierGroups()
      setSelectedModifierGroup((groups as any[])[0] || null)
    } else {
      toast.error('Failed to delete group')
    }
  }

  // Pour size helpers
  const DEFAULT_POUR_SIZES: Record<string, { label: string; multiplier: number }> = {
    standard: { label: 'Standard Pour', multiplier: 1.0 },
    shot: { label: 'Shot', multiplier: 1.0 },
    double: { label: 'Double', multiplier: 2.0 },
    tall: { label: 'Tall', multiplier: 1.5 },
    short: { label: 'Short', multiplier: 0.75 },
  }

  const normalizePourSizes = (data: Record<string, number | { label: string; multiplier: number }> | null): Record<string, { label: string; multiplier: number }> => {
    if (!data) return {}
    const result: Record<string, { label: string; multiplier: number }> = {}
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number') {
        result[key] = { label: DEFAULT_POUR_SIZES[key]?.label || key, multiplier: value }
      } else {
        result[key] = value
      }
    }
    return result
  }

  const togglePourSize = (size: string) => {
    const newSizes = { ...enabledPourSizes }
    if (newSizes[size]) {
      delete newSizes[size]
      if (defaultPourSize === size && Object.keys(newSizes).length > 0) {
        setDefaultPourSize(Object.keys(newSizes)[0])
      }
    } else {
      newSizes[size] = { ...DEFAULT_POUR_SIZES[size] }
    }
    setEnabledPourSizes(newSizes)
  }

  const updatePourSizeLabel = (size: string, label: string) => {
    setEnabledPourSizes(prev => ({ ...prev, [size]: { ...prev[size], label } }))
  }

  const updatePourSizeMultiplier = (size: string, multiplier: number) => {
    setEnabledPourSizes(prev => ({ ...prev, [size]: { ...prev[size], multiplier } }))
  }

  // Reload modifier groups for the selected drink (called after group edits)
  const reloadDrinkModifiers = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups`)
      if (res.ok) {
        const data = await res.json()
        setDrinkModifierGroups(data.data || [])
      }
    } catch {
      setDrinkModifierGroups([])
    }
  }
  const reloadDrinkModifiersRef = useRef(reloadDrinkModifiers)
  reloadDrinkModifiersRef.current = reloadDrinkModifiers

  // Load drink fields + modifier groups when selection changes
  useEffect(() => {
    if (!selectedDrink) return
    setEditingDrinkName(selectedDrink.name)
    setEditingDrinkPrice(String(selectedDrink.price))
    setEnabledPourSizes(normalizePourSizes(selectedDrink.pourSizes ?? null))
    setDefaultPourSize(selectedDrink.defaultPourSize || 'standard')
    setApplyPourToModifiers(selectedDrink.applyPourToModifiers || false)
    setSelectedModGroupId(null)
    setShowGroupPicker(false)
    // Reset spirit state until modifiers are loaded
    setSpiritMode(false)
    setSpiritGroupId(null)
    setSpiritEntries([])
    reloadDrinkModifiersRef.current(selectedDrink.id)
  }, [selectedDrink?.id])

  // Update spirit state when drink modifier groups are (re)loaded
  useEffect(() => {
    const spiritGroup = drinkModifierGroups.find((mg: any) => mg.isSpiritGroup)
    if (spiritGroup) {
      setSpiritGroupId(spiritGroup.id)
      setSpiritMode(true)
      setSpiritEntries(
        spiritGroup.modifiers.map((m: any) => ({
          id: m.id,
          bottleProductId: m.linkedBottleProductId || '',
          bottleName: m.linkedBottleProduct?.name || m.name,
          tier: m.spiritTier || 'call',
          price: m.price,
        }))
      )
    } else {
      setSpiritGroupId(null)
      setSpiritEntries([])
      // Don't force-reset spiritMode — user may have toggled it manually
    }
  }, [drinkModifierGroups])

  // Spirit tier helpers
  const ensureSpiritGroup = async (itemId: string): Promise<string | null> => {
    if (spiritGroupId) return spiritGroupId
    const res = await fetch(`/api/menu/items/${itemId}/modifier-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Spirit Upgrades', isSpiritGroup: true, maxSelections: 1 }),
    })
    if (res.ok) {
      const data = await res.json()
      const gid = data.data?.id || null
      setSpiritGroupId(gid)
      return gid
    }
    return null
  }

  const addSpiritBottle = async (tier: string, bottleId: string) => {
    if (!selectedDrink || !bottleId) return
    const bottle = bottles.find((b: any) => b.id === bottleId)
    if (!bottle) return
    setSavingSpirit(true)
    try {
      const groupId = await ensureSpiritGroup(selectedDrink.id)
      if (!groupId) { toast.error('Failed to create spirit group'); return }
      const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${groupId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bottle.name,
          price: 0,
          spiritTier: tier,
          linkedBottleProductId: bottleId,
          allowNo: false,
          allowLite: false,
          allowOnSide: false,
          allowExtra: false,
        }),
      })
      if (res.ok) {
        await reloadDrinkModifiersRef.current(selectedDrink.id)
      } else {
        toast.error('Failed to add bottle')
      }
    } finally {
      setSavingSpirit(false)
    }
  }

  const updateSpiritEntryPrice = async (modifierId: string, price: number) => {
    if (!selectedDrink || !spiritGroupId) return
    const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${spiritGroupId}/modifiers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifierId, price }),
    })
    if (res.ok) {
      setSpiritEntries(prev => prev.map(e => e.id === modifierId ? { ...e, price } : e))
    }
  }

  const removeSpiritEntry = async (modifierId: string) => {
    if (!selectedDrink || !spiritGroupId) return
    const res = await fetch(
      `/api/menu/items/${selectedDrink.id}/modifier-groups/${spiritGroupId}/modifiers?modifierId=${modifierId}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      setSpiritEntries(prev => prev.filter(e => e.id !== modifierId))
    }
  }

  const handleSaveDrink = async () => {
    if (!selectedDrink) return
    setSavingDrink(true)
    try {
      const price = parseFloat(editingDrinkPrice) || 0
      const pourSizesData = Object.keys(enabledPourSizes).length > 0 ? enabledPourSizes : null
      const res = await fetch(`/api/menu/items/${selectedDrink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingDrinkName.trim(),
          price,
          pourSizes: pourSizesData,
          defaultPourSize: pourSizesData ? defaultPourSize : null,
          applyPourToModifiers,
        }),
      })
      if (res.ok) {
        await loadDrinks()
        setSelectedDrink((prev: any) => prev ? { ...prev, name: editingDrinkName.trim(), price, pourSizes: pourSizesData, defaultPourSize: pourSizesData ? defaultPourSize : null } : prev)
        toast.success('Saved')
      } else {
        toast.error('Failed to save')
      }
    } finally {
      setSavingDrink(false)
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

  // Filter drinks by selected menu category
  const filteredDrinks = selectedMenuCategoryId
    ? drinks.filter((d: any) => d.categoryId === selectedMenuCategoryId)
    : drinks

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

  if (!hydrated) return null

  // Check if this is a fresh setup (no data)
  const isEmptySetup = categories.length === 0 && bottles.length === 0 && menuCategories.length === 0

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header — Row 1: title + back */}
      <div className="bg-white border-b shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
          <h1 className="text-base font-bold">🥃 Liquor Builder</h1>
          <Link href="/menu" className="text-xs text-blue-600 hover:underline">← Back to Menu</Link>
        </div>
        {/* Row 2: POS category pills (what shows on front-end bar tabs) */}
        <div className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] uppercase text-gray-400 font-medium shrink-0 mr-1">POS Tabs:</span>
          {menuCategories.map(cat => {
            const isActive = selectedMenuCategoryId === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => {
                  if (isActive) {
                    setSelectedMenuCategoryId('')
                    setCategoryFilter('')
                    setActiveTab('bottles')
                  } else {
                    setSelectedMenuCategoryId(cat.id)
                    const matchingSpirit = categories.find(c => c.name.toLowerCase() === cat.name.toLowerCase())
                    if (matchingSpirit) setCategoryFilter(matchingSpirit.id)
                    setActiveTab(cat.name === 'Cocktails' ? 'drinks' : 'bottles')
                    setSelectedDrink(null)
                  }
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                  isActive ? 'text-white border-transparent shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
                style={isActive ? { backgroundColor: cat.color } : undefined}
              >
                {cat.name}
                <span className="ml-1 opacity-60">{cat.itemCount}</span>
              </button>
            )
          })}
          <button
            onClick={() => { setEditingMenuCategory(null); setShowMenuCategoryModal(true) }}
            className="px-2.5 py-1 text-[10px] text-blue-500 hover:text-blue-700 border border-dashed border-blue-300 rounded-full whitespace-nowrap"
          >
            + Add
          </button>
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
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar — Inventory / Spirits */}
          <div className="w-44 bg-white border-r flex flex-col shrink-0">
            <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
              <span className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Inventory / Spirits</span>
              <button
                onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}
                className="text-[10px] text-blue-600 hover:text-blue-700 font-medium"
              >
                + Category
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {categories.map(cat => {
                const isCocktails = cat.name === 'Cocktails'
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setCategoryFilter(cat.id)
                      if (isCocktails) {
                        const menuCat = menuCategories.find(mc => mc.name.toLowerCase() === cat.name.toLowerCase())
                        if (menuCat) setSelectedMenuCategoryId(menuCat.id)
                        setActiveTab('drinks')
                      } else {
                        setSelectedMenuCategoryId('')
                        setActiveTab('bottles')
                      }
                      setSelectedDrink(null)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                      categoryFilter === cat.id ? 'bg-purple-100 text-purple-700 font-medium' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span className="truncate">{cat.name}</span>
                    <span className="text-xs text-gray-400 ml-1">{cat.bottleCount}</span>
                  </button>
                )
              })}
              {categoryFilter && (
                <button
                  onClick={() => { setCategoryFilter(''); setSelectedMenuCategoryId(''); setActiveTab('bottles') }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear filter
                </button>
              )}
            </div>
            {/* Quick Stats */}
            <div className="p-2 border-t bg-gray-50 text-xs shrink-0">
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">Bottles:</span>
                <span className="font-medium">{bottles.length}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">On POS:</span>
                <span className="font-medium">{bottles.filter(b => b.hasMenuItem).length}</span>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Action Bar — no tabs, just context-aware actions */}
            <div className="bg-white border-b px-3 py-2 flex items-center justify-between shrink-0">
              <div className="text-sm font-medium text-gray-600">
                {activeTab === 'bottles' && (
                  <span>
                    {categoryFilter ? categories.find(c => c.id === categoryFilter)?.name : 'All'} Inventory
                    <span className="ml-2 text-xs text-gray-400 font-normal">({filteredBottles.length} bottles)</span>
                  </span>
                )}
                {activeTab === 'drinks' && (
                  <span>
                    {selectedMenuCategoryId ? menuCategories.find(c => c.id === selectedMenuCategoryId)?.name : 'All'} Drinks
                    <span className="ml-2 text-xs text-gray-400 font-normal">({filteredDrinks.length} items)</span>
                  </span>
                )}
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
              {activeTab === 'bottles' && (() => {
                // Category-aware column labels and helpers
                const viewCat = categories.find(c => c.id === categoryFilter)?.name || ''
                const viewBeer = viewCat === 'Beer'
                const viewWine = viewCat === 'Wine'

                const ML_PER_OZ = LIQUOR_DEFAULTS.mlPerOz

                // Format the Size cell in a human-readable way per bottle type
                const fmtSize = (b: BottleProduct) => {
                  const cat = b.spiritCategory?.name || ''
                  if (cat === 'Beer') {
                    const oz = Math.round(b.bottleSizeMl / ML_PER_OZ)
                    const cLabel = (b as any).containerType === 'draft' ? 'Draft' : (b as any).containerType === 'bottle' ? 'Bottle' : 'Can'
                    return `${oz} oz ${cLabel}`
                  }
                  if (cat === 'Wine') return `${b.bottleSizeMl} mL`
                  return `${b.bottleSizeMl} mL`
                }

                // Subtype badge info for the Product column
                const subtypeBadge = (b: BottleProduct) => {
                  const cat = b.spiritCategory?.name || ''
                  const sub = (b as any).alcoholSubtype as string | null
                  if (!sub) return null
                  if (cat === 'Beer') {
                    const map: Record<string, { emoji: string; label: string; cls: string }> = {
                      domestic: { emoji: '🇺🇸', label: 'Domestic',    cls: 'bg-blue-100 text-blue-700' },
                      import:   { emoji: '🌍', label: 'Import',       cls: 'bg-yellow-100 text-yellow-700' },
                      craft:    { emoji: '🍺', label: 'Craft',        cls: 'bg-orange-100 text-orange-700' },
                      seltzer:  { emoji: '💧', label: 'Seltzer',      cls: 'bg-cyan-100 text-cyan-700' },
                      na:       { emoji: '🚫', label: 'N/A',          cls: 'bg-gray-100 text-gray-600' },
                    }
                    return map[sub] ?? null
                  }
                  if (cat === 'Wine') {
                    const map: Record<string, { emoji: string; label: string; cls: string }> = {
                      red:       { emoji: '🍷', label: 'Red',       cls: 'bg-red-100 text-red-700' },
                      white:     { emoji: '🥂', label: 'White',     cls: 'bg-yellow-100 text-yellow-700' },
                      rose:      { emoji: '🌸', label: 'Rosé',      cls: 'bg-pink-100 text-pink-700' },
                      sparkling: { emoji: '🍾', label: 'Sparkling', cls: 'bg-purple-100 text-purple-700' },
                      dessert:   { emoji: '🍯', label: 'Dessert',   cls: 'bg-amber-100 text-amber-700' },
                    }
                    return map[sub] ?? null
                  }
                  return null
                }

                // Column header labels
                const colPours = viewBeer ? 'Serves' : viewWine ? 'Glasses' : 'Pours'
                const colPourCost = viewBeer ? 'Cost/Unit' : viewWine ? 'Cost/Glass' : 'Pour $'

                return filteredBottles.length === 0 ? (
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
                              <th className="px-3 py-2 text-right font-medium text-gray-700">{colPours}</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">{colPourCost}</th>
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
                                    {(() => { const b = subtypeBadge(bottle); return b ? <span className={`text-xs px-1.5 py-0.5 rounded mt-0.5 inline-block ${b.cls}`}>{b.emoji} {b.label}</span> : null })()}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      bottle.tier === 'well' ? 'bg-gray-200 text-gray-700' :
                                      bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                                      bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                                      'bg-amber-100 text-amber-700'
                                    }`}>
                                      {bottle.tier === 'well' ? (viewBeer ? 'DOM' : viewWine ? 'HOUSE' : 'WELL') :
                                       bottle.tier === 'call' ? (viewBeer ? 'IMP' : viewWine ? 'GLASS' : 'CALL') :
                                       bottle.tier === 'premium' ? (viewBeer ? 'CRFT' : viewWine ? 'RESV' : 'PREM') :
                                       (viewBeer ? 'PREM+' : viewWine ? 'CELLR' : 'TOP')}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-600">{fmtSize(bottle)}</td>
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
                              <th className="px-3 py-2 text-right font-medium text-gray-600">{colPours}</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-600">{colPourCost}</th>
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
                                    {(() => { const b = subtypeBadge(bottle); return b ? <span className={`text-xs px-1.5 py-0.5 rounded mt-0.5 inline-block ${b.cls}`}>{b.emoji} {b.label}</span> : null })()}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      bottle.tier === 'well' ? 'bg-gray-200 text-gray-700' :
                                      bottle.tier === 'call' ? 'bg-blue-100 text-blue-700' :
                                      bottle.tier === 'premium' ? 'bg-purple-100 text-purple-700' :
                                      'bg-amber-100 text-amber-700'
                                    }`}>
                                      {bottle.tier === 'well' ? (viewBeer ? 'DOM' : viewWine ? 'HOUSE' : 'WELL') :
                                       bottle.tier === 'call' ? (viewBeer ? 'IMP' : viewWine ? 'GLASS' : 'CALL') :
                                       bottle.tier === 'premium' ? (viewBeer ? 'CRFT' : viewWine ? 'RESV' : 'PREM') :
                                       (viewBeer ? 'PREM+' : viewWine ? 'CELLR' : 'TOP')}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-500">{fmtSize(bottle)}</td>
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
              })()}

              {/* Drinks Tab */}
              {activeTab === 'drinks' && (
                <div className="flex h-full">
                  {/* Left: Drinks List */}
                  <div className="w-80 bg-white border-r overflow-y-auto flex flex-col">
                    {/* Header row: category name + add button */}
                    <div className="px-3 pt-2 pb-1 flex items-center justify-between border-b shrink-0">
                      <span className="text-xs font-medium text-purple-700">
                        {selectedMenuCategoryId
                          ? `${menuCategories.find((c: any) => c.id === selectedMenuCategoryId)?.name} (${filteredDrinks.length})`
                          : `All Drinks (${filteredDrinks.length})`
                        }
                      </span>
                      <div className="flex items-center gap-2">
                        {selectedMenuCategoryId && (
                          <button
                            onClick={() => { setSelectedMenuCategoryId(''); setSelectedDrink(null) }}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            All
                          </button>
                        )}
                        {selectedMenuCategoryId && (
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/menu/items', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  name: 'New Item',
                                  price: 0,
                                  categoryId: selectedMenuCategoryId,
                                }),
                              })
                              if (res.ok) {
                                const newItem = await res.json()
                                await loadDrinks()
                                setSelectedDrink(newItem)
                              } else {
                                toast.error('Failed to create item')
                              }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            + Add Item
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-1">
                      {filteredDrinks.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">No items in this category</p>
                      ) : (
                        filteredDrinks.map((drink: any) => (
                          <div
                            key={drink.id}
                            onClick={() => setSelectedDrink(drink)}
                            className={`p-3 rounded cursor-pointer transition-colors ${
                              selectedDrink?.id === drink.id
                                ? 'bg-purple-50 border-2 border-purple-500'
                                : !drink.isAvailable
                                ? 'bg-gray-50 border-2 border-transparent opacity-50'
                                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="font-medium text-sm leading-tight">{drink.name}</div>
                              <div className="flex items-center gap-1 shrink-0">
                                {!drink.isAvailable && (
                                  <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-medium">86</span>
                                )}
                                {/* 86 toggle */}
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    await fetch(`/api/menu/items/${drink.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ isAvailable: !drink.isAvailable }),
                                    })
                                    await loadDrinks()
                                    if (selectedDrink?.id === drink.id) setSelectedDrink(null)
                                  }}
                                  title={drink.isAvailable ? '86 this item' : 'Un-86 this item'}
                                  className="text-gray-300 hover:text-orange-500 text-xs px-1 rounded"
                                >
                                  {drink.isAvailable ? '⊘' : '✓'}
                                </button>
                                {/* Hide/delete */}
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!confirm(`Remove "${drink.name}" from the POS?`)) return
                                    await fetch(`/api/menu/items/${drink.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                                    })
                                    await loadDrinks()
                                    if (selectedDrink?.id === drink.id) setSelectedDrink(null)
                                  }}
                                  title="Remove from POS"
                                  className="text-gray-300 hover:text-red-500 text-xs px-1 rounded"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                            <div className="text-xs text-gray-600 mt-0.5">{formatCurrency(drink.price)}</div>
                            {drink.hasRecipe && (
                              <div className="text-xs text-green-600 mt-1">✓ {drink.recipeIngredientCount} bottles</div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right: Drink Editor with Recipe */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {selectedDrink ? (
                      <>
                        {/* Item Editor Card */}
                        <div className="bg-white rounded-lg border p-5">
                          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Item Details</h3>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                              <input
                                type="text"
                                value={editingDrinkName}
                                onChange={e => setEditingDrinkName(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editingDrinkPrice}
                                  onChange={e => setEditingDrinkPrice(e.target.value)}
                                  className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {/* 86 toggle */}
                              <button
                                onClick={async () => {
                                  const newAvail = !selectedDrink.isAvailable
                                  await fetch(`/api/menu/items/${selectedDrink.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ isAvailable: newAvail }),
                                  })
                                  await loadDrinks()
                                  setSelectedDrink((prev: any) => prev ? { ...prev, isAvailable: newAvail } : prev)
                                }}
                                className={`px-3 py-1.5 rounded text-xs font-medium border ${
                                  selectedDrink.isAvailable
                                    ? 'border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600'
                                    : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
                                }`}
                              >
                                {selectedDrink.isAvailable ? '⊘ 86 Item' : '✓ Un-86 Item'}
                              </button>
                              {/* Remove from POS */}
                              <button
                                onClick={async () => {
                                  if (!confirm(`Remove "${selectedDrink.name}" from the POS?`)) return
                                  await fetch(`/api/menu/items/${selectedDrink.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ deletedAt: new Date().toISOString() }),
                                  })
                                  await loadDrinks()
                                  setSelectedDrink(null)
                                }}
                                className="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 text-gray-500 hover:border-red-400 hover:text-red-600"
                              >
                                ✕ Remove
                              </button>
                            </div>
                            <Button
                              size="sm"
                              onClick={handleSaveDrink}
                              disabled={savingDrink || (!editingDrinkName.trim())}
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                              {savingDrink ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </div>

                        {/* Pour Sizes / Spirit Upgrades toggle card */}
                        <div className="bg-white rounded-lg border p-5">
                          {/* Mode toggle */}
                          <label className="flex items-center gap-2 cursor-pointer mb-4">
                            <input
                              type="checkbox"
                              checked={spiritMode}
                              onChange={e => setSpiritMode(e.target.checked)}
                              className="w-4 h-4 text-amber-600 rounded"
                            />
                            <span className="text-sm font-semibold text-gray-700">🥃 Spirit Upgrades</span>
                            <span className="text-xs text-gray-400">(for cocktails — Well/Call/Prem/Top tiers)</span>
                          </label>

                          {spiritMode ? (
                            /* Spirit Tier Editor */
                            <div className="space-y-3">
                              <p className="text-xs text-gray-400">Assign bottles from your inventory to each tier. Guests pick their spirit on the POS.</p>
                              {savingSpirit && <p className="text-xs text-amber-600">Saving...</p>}
                              {(['well', 'call', 'premium', 'top_shelf'] as const).map(tier => {
                                const tierEntries = spiritEntries.filter(e => e.tier === tier)
                                const tierLabel = tier === 'well' ? 'WELL' : tier === 'call' ? 'CALL' : tier === 'premium' ? 'PREMIUM' : 'TOP SHELF'
                                const tierColors: Record<string, string> = {
                                  well: 'border-gray-300 bg-gray-50',
                                  call: 'border-blue-200 bg-blue-50',
                                  premium: 'border-purple-200 bg-purple-50',
                                  top_shelf: 'border-amber-200 bg-amber-50',
                                }
                                const tierTextColor: Record<string, string> = {
                                  well: 'text-gray-700',
                                  call: 'text-blue-700',
                                  premium: 'text-purple-700',
                                  top_shelf: 'text-amber-700',
                                }
                                const addedBottleIds = new Set(tierEntries.map(e => e.bottleProductId))
                                const availableBottles = (bottles as any[]).filter((b: any) => b.tier === tier && !addedBottleIds.has(b.id))
                                return (
                                  <div key={tier} className={`rounded-lg border p-3 ${tierColors[tier]}`}>
                                    <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${tierTextColor[tier]}`}>{tierLabel}</div>
                                    {tierEntries.length === 0 && (
                                      <p className="text-xs text-gray-400 mb-2">No bottles assigned yet</p>
                                    )}
                                    {tierEntries.map(entry => (
                                      <div key={entry.id || entry.bottleProductId} className="flex items-center gap-2 mb-1.5">
                                        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{entry.bottleName}</span>
                                        <span className="text-xs text-gray-400">+$</span>
                                        <input
                                          type="number"
                                          step="0.25"
                                          min="0"
                                          defaultValue={entry.price}
                                          key={`${entry.id}-${entry.price}`}
                                          onBlur={e => {
                                            const price = parseFloat(e.target.value) || 0
                                            if (entry.id && price !== entry.price) {
                                              updateSpiritEntryPrice(entry.id, price)
                                            }
                                          }}
                                          className="w-16 px-2 py-1 text-sm border rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          placeholder="0.00"
                                        />
                                        <button
                                          onClick={() => entry.id && removeSpiritEntry(entry.id)}
                                          className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0"
                                          title="Remove"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                    {availableBottles.length > 0 && (
                                      <select
                                        key={`${tier}-${tierEntries.length}`}
                                        defaultValue=""
                                        onChange={e => {
                                          const bottleId = e.target.value
                                          if (bottleId) addSpiritBottle(tier, bottleId)
                                        }}
                                        disabled={savingSpirit}
                                        className="mt-1 w-full text-xs border rounded px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      >
                                        <option value="">+ Add {tierLabel.charAt(0) + tierLabel.slice(1).toLowerCase()} bottle...</option>
                                        {availableBottles.map((b: any) => (
                                          <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                      </select>
                                    )}
                                    {availableBottles.length === 0 && tierEntries.length === 0 && (
                                      <p className="text-xs text-gray-400 italic">No {tier.replace('_', ' ')} bottles in inventory</p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            /* Pour Size Buttons Editor */
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Pour Size Buttons</h3>
                                <span className="text-xs text-gray-400">Shot / Tall / Short / Double</span>
                              </div>
                              <p className="text-xs text-gray-400 mb-3">Enable size variants for this item. Each multiplies the base price.</p>
                              <div className="space-y-2 mb-3">
                                {Object.entries(DEFAULT_POUR_SIZES).map(([sizeKey, defaults]) => {
                                  const isEnabled = enabledPourSizes[sizeKey] !== undefined
                                  const current = enabledPourSizes[sizeKey]
                                  return (
                                    <div key={sizeKey} className={`p-2.5 border rounded-lg transition-colors ${isEnabled ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={isEnabled}
                                          onChange={() => togglePourSize(sizeKey)}
                                          className="w-4 h-4 text-purple-600 shrink-0"
                                        />
                                        {isEnabled ? (
                                          <>
                                            <input
                                              type="text"
                                              value={current?.label || ''}
                                              onChange={e => updatePourSizeLabel(sizeKey, e.target.value)}
                                              className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                              placeholder="Button label"
                                            />
                                            <div className="flex items-center gap-1 shrink-0">
                                              <input
                                                type="number"
                                                step="0.25"
                                                min="0.25"
                                                defaultValue={current?.multiplier ?? 1}
                                                key={`${sizeKey}-${current?.multiplier}`}
                                                onBlur={e => {
                                                  const num = parseFloat(e.target.value)
                                                  if (!isNaN(num) && num > 0) updatePourSizeMultiplier(sizeKey, num)
                                                  else e.target.value = String(current?.multiplier || 1)
                                                }}
                                                className="w-14 px-1 py-1 text-sm border rounded text-center focus:outline-none focus:ring-1 focus:ring-purple-500"
                                              />
                                              <span className="text-xs text-purple-600">×</span>
                                            </div>
                                            {isEnabled && defaultPourSize === sizeKey && (
                                              <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5 rounded shrink-0">Default</span>
                                            )}
                                            {isEnabled && defaultPourSize !== sizeKey && (
                                              <button
                                                onClick={() => setDefaultPourSize(sizeKey)}
                                                className="text-[10px] text-purple-500 hover:text-purple-700 shrink-0"
                                              >Set default</button>
                                            )}
                                          </>
                                        ) : (
                                          <div className="flex-1 flex items-center justify-between text-gray-400">
                                            <span className="text-sm">{defaults.label}</span>
                                            <span className="text-xs">{defaults.multiplier}×</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                              {Object.keys(enabledPourSizes).length > 0 && (
                                <label className="flex items-center gap-2 cursor-pointer mt-2">
                                  <input
                                    type="checkbox"
                                    checked={applyPourToModifiers}
                                    onChange={e => setApplyPourToModifiers(e.target.checked)}
                                    className="w-4 h-4 text-purple-600"
                                  />
                                  <span className="text-xs text-gray-700">Apply multiplier to spirit upgrade charges too</span>
                                </label>
                              )}
                              {Object.keys(enabledPourSizes).length > 0 && (
                                <p className="text-xs text-gray-400 mt-1 ml-6">
                                  Price on POS: base price × multiplier (e.g. ${(parseFloat(editingDrinkPrice) || 0).toFixed(2)} × 1.5 = ${((parseFloat(editingDrinkPrice) || 0) * 1.5).toFixed(2)} for Tall)
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Modifier Groups — tap a template in the right panel to attach */}
                        <div className="bg-white rounded-lg border overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                            <div>
                              <h3 className="text-sm font-semibold text-gray-700">Modifier Groups</h3>
                              <p className="text-xs text-gray-400 mt-0.5">Tap a template in the right panel → to attach</p>
                            </div>
                          </div>

                          {/* Group list — spirit groups are managed in the Spirit Tier Editor above */}
                          {drinkModifierGroups.filter((mg: any) => !mg.isSpiritGroup).length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-gray-400">
                              <p className="mb-1 font-medium">No modifier groups yet.</p>
                              <p className="text-xs">Tap a template in the Modifier Templates panel on the right →</p>
                            </div>
                          ) : (
                            <div className="divide-y">
                              {drinkModifierGroups.filter((mg: any) => !mg.isSpiritGroup).map((mg: any) => (
                                <button
                                  key={mg.id}
                                  onClick={() => setSelectedModGroupId(selectedModGroupId === mg.id ? null : mg.id)}
                                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                                    selectedModGroupId === mg.id
                                      ? 'bg-purple-50 border-l-4 border-purple-500'
                                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{mg.name}</span>
                                    {mg.isRequired && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Required</span>}
                                  </div>
                                  <div className="flex items-center gap-2 text-gray-400 text-xs">
                                    <span>{mg.modifiers?.length ?? 0} options</span>
                                    <span>{selectedModGroupId === mg.id ? '▲' : '▼'}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Inline ModifierFlowEditor — shows when a group is selected */}
                          {selectedModGroupId && (
                            <div className="border-t bg-gray-50">
                              <ModifierFlowEditor
                                item={{ id: selectedDrink.id, name: editingDrinkName || selectedDrink.name }}
                                selectedGroupId={selectedModGroupId}
                                refreshKey={modGroupRefreshKey}
                                onGroupUpdated={() => {
                                  reloadDrinkModifiersRef.current(selectedDrink.id)
                                  setModGroupRefreshKey(k => k + 1)
                                }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Recipe Builder Card */}
                        <RecipeBuilder
                          menuItemId={selectedDrink.id}
                          menuItemPrice={parseFloat(editingDrinkPrice) || selectedDrink.price}
                          isExpanded={true}
                          onToggle={() => {}}
                        />
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        <p>Select a drink to edit</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Right Panel — Modifier Templates */}
          <div className="w-64 bg-white border-l flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
              <span className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Modifier Templates</span>
              <button
                onClick={addModifierGroup}
                className="text-[10px] text-blue-600 hover:text-blue-700 font-medium"
              >
                + New
              </button>
            </div>

            {selectedModifierGroup ? (
              /* Expanded editor mode */
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="px-3 py-2 border-b bg-purple-50 flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSelectedModifierGroup(null)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    ← Back
                  </button>
                  <span className="text-xs font-medium text-purple-700 truncate">{selectedModifierGroup.name}</span>
                </div>
                <div className="flex-1 overflow-auto">
                  <LiquorModifierGroupEditor
                    key={selectedModifierGroup.id}
                    group={selectedModifierGroup}
                    onSaved={async () => {
                      const groups = await loadModifierGroups()
                      const refreshed = (groups as any[]).find((g: any) => g.id === selectedModifierGroup.id)
                      if (refreshed) setSelectedModifierGroup(refreshed)
                    }}
                    onDelete={() => deleteModifierGroup(selectedModifierGroup.id)}
                  />
                </div>
              </div>
            ) : (
              /* List mode */
              <div className="flex-1 overflow-y-auto p-2">
                {modifierGroups.length === 0 ? (
                  <div className="text-center py-8 text-xs text-gray-400">
                    <p className="mb-2">No modifier templates yet.</p>
                    <p className="text-gray-400 mb-3">Create templates like Mixers, Garnishes, or Ice options here — then attach them to any drink.</p>
                    <button
                      onClick={addModifierGroup}
                      className="text-purple-600 hover:text-purple-700 font-medium"
                    >
                      + Create first template
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {activeTab === 'drinks' && selectedDrink && (
                      <p className="text-[10px] text-purple-600 font-medium px-1 pb-1">
                        Tap to attach to {selectedDrink.name || 'this drink'}:
                      </p>
                    )}
                    {modifierGroups.map((group: any) => {
                      const isAlreadyAdded = activeTab === 'drinks' && selectedDrink &&
                        drinkModifierGroups.some((mg: any) => mg.name === group.name && !mg.isSpiritGroup)
                      return (
                        <button
                          key={group.id}
                          disabled={!!attachingGroupId}
                          onClick={async () => {
                            if (activeTab === 'drinks' && selectedDrink && !group.isSpiritGroup && !isAlreadyAdded) {
                              // Attach template to selected drink
                              setAttachingGroupId(group.id)
                              try {
                                const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ duplicateFromGroupId: group.id, copyFromShared: true, name: group.name }),
                                })
                                if (res.ok) {
                                  const data = await res.json()
                                  await reloadDrinkModifiersRef.current(selectedDrink.id)
                                  setSelectedModGroupId(data.data?.id || null)
                                  setModGroupRefreshKey(k => k + 1)
                                  toast.success(`Added "${group.name}"`)
                                } else {
                                  toast.error('Failed to attach group')
                                }
                              } finally {
                                setAttachingGroupId(null)
                              }
                            } else {
                              // Open editor
                              setSelectedModifierGroup(group)
                            }
                          }}
                          className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                            isAlreadyAdded
                              ? 'bg-green-50 border-green-200 cursor-default'
                              : attachingGroupId === group.id
                              ? 'bg-blue-50 border-blue-300'
                              : activeTab === 'drinks' && selectedDrink && !group.isSpiritGroup
                              ? 'bg-white border-purple-200 hover:bg-purple-50 hover:border-purple-400'
                              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm truncate">{group.name}</span>
                            {group.isSpiritGroup && <span className="text-base shrink-0 ml-1">🥃</span>}
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-xs text-gray-400">{group.modifiers?.length ?? 0} options</span>
                            {isAlreadyAdded ? (
                              <span className="text-xs text-green-600">✓ Added</span>
                            ) : attachingGroupId === group.id ? (
                              <span className="text-xs text-blue-600">Adding...</span>
                            ) : activeTab === 'drinks' && selectedDrink && !group.isSpiritGroup ? (
                              <span className="text-xs text-purple-500">+ Attach</span>
                            ) : (
                              <span className="text-xs text-gray-400">Edit →</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
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

      {/* Menu Category Modal */}
      {showMenuCategoryModal && (
        <MenuCategoryModal
          category={editingMenuCategory}
          onSave={async (data) => {
            const method = editingMenuCategory ? 'PUT' : 'POST'
            const url = editingMenuCategory
              ? `/api/menu/categories/${editingMenuCategory.id}`
              : '/api/menu/categories'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...data, categoryType: 'liquor' }),
            })
            if (res.ok) {
              await loadDrinks()
              setShowMenuCategoryModal(false)
              setEditingMenuCategory(null)
            } else {
              const err = await res.json()
              toast.error(err.error || 'Failed to save category')
            }
          }}
          onDelete={editingMenuCategory ? async () => {
            if (!confirm(`Delete "${editingMenuCategory.name}" and all its items?`)) return
            const res = await fetch(`/api/menu/categories/${editingMenuCategory.id}`, { method: 'DELETE' })
            if (res.ok) {
              await loadDrinks()
              if (selectedMenuCategoryId === editingMenuCategory.id) setSelectedMenuCategoryId('')
              setShowMenuCategoryModal(false)
              setEditingMenuCategory(null)
            } else {
              const err = await res.json()
              toast.error(err.error || 'Failed to delete category')
            }
          } : undefined}
          onClose={() => { setShowMenuCategoryModal(false); setEditingMenuCategory(null) }}
        />
      )}

    </div>
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

// Modal for creating/editing liquor menu categories (Beer, Cocktails, Whiskey, etc.)
function MenuCategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: {
  category: { id: string; name: string; color: string } | null
  onSave: (data: { name: string; color: string }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#8b5cf6')

  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{category ? 'Edit Category' : 'New Menu Category'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Whiskey, Cocktails, Beer"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-9 h-9 rounded-lg transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-500 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          {onDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onSave({ name: name.trim(), color })}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {category ? 'Save Changes' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  )
}
