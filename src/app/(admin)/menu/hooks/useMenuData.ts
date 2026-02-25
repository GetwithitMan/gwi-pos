'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'
import type { Category, MenuItem, ModifierGroup, Printer, KDSScreen, IngredientCategory, IngredientLibraryItem } from '../types'

export function useMenuData() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [ingredientsLibrary, setIngredientsLibrary] = useState<IngredientLibraryItem[]>([])
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [kdsScreens, setKdsScreens] = useState<KDSScreen[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)
  const [selectedItemForEditor, setSelectedItemForEditor] = useState<MenuItem | null>(null)
  const [selectedTreeNode, setSelectedTreeNode] = useState<{ type: string; id: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null)
  const [itemSearch, setItemSearch] = useState('')
  const itemSearchRef = useRef<HTMLInputElement>(null)

  // "/" keyboard shortcut to focus search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        itemSearchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Keep selected item in sync when items reload (e.g. after editing name/price)
  useEffect(() => {
    if (selectedItemForEditor && items.length > 0) {
      const fresh = items.find(i => i.id === selectedItemForEditor.id)
      if (fresh && (fresh.name !== selectedItemForEditor.name || fresh.price !== selectedItemForEditor.price)) {
        setSelectedItemForEditor(fresh)
      }
    }
  }, [items, selectedItemForEditor])

  // Refs for scroll containers
  const categoriesScrollRef = useRef<HTMLDivElement>(null)
  const itemsScrollRef = useRef<HTMLDivElement>(null)

  // Define loadMenu first so it can be used in useEffects
  const loadMenu = useCallback(async () => {
    try {
      const locationId = employee?.location?.id
      const [menuResponse, ingredientsResponse, ingredientCategoriesResponse, printersResponse, kdsResponse] = await Promise.all([
        fetch('/api/menu', {
          cache: 'no-store',
        }),
        locationId ? fetch(`/api/ingredients?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/ingredient-categories?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/hardware/printers?locationId=${locationId}`) : Promise.resolve(null),
        locationId ? fetch(`/api/hardware/kds-screens?locationId=${locationId}`) : Promise.resolve(null)
      ])

      if (menuResponse.ok) {
        const data = await menuResponse.json()
        // Liquor categories are managed exclusively in the Liquor Builder — exclude them here
        setCategories(data.data.categories.filter((c: any) => c.categoryType !== 'liquor'))
        // Exclude liquor items (their category won't be selectable anyway, but filter defensively)
        const liquorCategoryIds = new Set(
          data.data.categories
            .filter((c: any) => c.categoryType === 'liquor')
            .map((c: any) => c.id)
        )
        setItems([...data.data.items.filter((item: any) => !liquorCategoryIds.has(item.categoryId))])
      }

      // Shared modifier groups are deprecated — modifiers are now item-owned
      // Modifier management is handled in ItemEditor
      setModifierGroups([])

      if (ingredientsResponse?.ok) {
        const ingData = await ingredientsResponse.json()
        const ingredients = (ingData.data || []).map((ing: any) => ({
          ...ing,
          categoryName: ing.categoryRelation?.name || ing.category || null,
          categoryId: ing.categoryId || null,
          parentName: ing.parentIngredient?.name || null,
          needsVerification: ing.needsVerification || false,
        }))
        setIngredientsLibrary(ingredients)
      }

      if (ingredientCategoriesResponse?.ok) {
        const catData = await ingredientCategoriesResponse.json()
        setIngredientCategories(catData.data || [])
      }

      if (printersResponse?.ok) {
        const printerData = await printersResponse.json()
        setPrinters(printerData.data.printers || [])
      }

      if (kdsResponse?.ok) {
        const kdsData = await kdsResponse.json()
        setKdsScreens(kdsData.data.screens || [])
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id])

  // Create ref to avoid stale closures
  const loadMenuRef = useRef(loadMenu)
  loadMenuRef.current = loadMenu

  // Initial load
  useEffect(() => {
    loadMenuRef.current()
  }, [])

  // Refresh menu when switching categories (especially for entertainment status updates)
  useEffect(() => {
    if (selectedCategory) {
      loadMenuRef.current()
    }
  }, [selectedCategory])

  // Auto-select item from ?item=ID URL param (e.g. deep-link from Liquor Builder)
  useEffect(() => {
    if (isLoading || items.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const itemId = params.get('item')
    if (!itemId || selectedItemForEditor?.id === itemId) return
    const target = items.find(i => i.id === itemId)
    if (target) {
      setSelectedCategory(target.categoryId)
      setSelectedItemForEditor(target)
    }
  }, [isLoading, items])

  // Real-time entertainment status updates + ingredient library via shared socket
  const selectedCategoryType = categories.find(c => c.id === selectedCategory)?.categoryType
  useEffect(() => {
    if (!employee?.location?.id) return

    const socket = getSharedSocket()
    const locationId = employee.location.id

    // Join location room (shared socket may already be joined, but additive is fine)
    const onConnect = () => {
      socket.emit('join_station', {
        locationId,
        tags: [],
        terminalId: getTerminalId(),
      })
    }

    // Entertainment status handler
    const onEntertainmentChanged = (event: {
      itemId: string
      entertainmentStatus: 'available' | 'in_use' | 'reserved' | 'maintenance'
      currentOrderId: string | null
      expiresAt: string | null
    }) => {
      setItems(prev => prev.map(item =>
        item.id === event.itemId
          ? {
              ...item,
              entertainmentStatus: event.entertainmentStatus,
              currentOrderId: event.currentOrderId,
            }
          : item
      ))
    }

    // Ingredient library handler
    const onIngredientUpdate = (data: { ingredient: IngredientLibraryItem }) => {
      setIngredientsLibrary(prev => {
        const exists = prev.some(ing => ing.id === data.ingredient.id)
        if (exists) return prev
        return [...prev, data.ingredient]
      })
    }

    socket.on('connect', onConnect)
    socket.on('entertainment:status-changed', onEntertainmentChanged)
    socket.on('ingredient:library-update', onIngredientUpdate)

    if (socket.connected) {
      onConnect()
    }

    // Refresh on visibility changes (useful when tab returns)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMenuRef.current()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      socket.off('connect', onConnect)
      socket.off('entertainment:status-changed', onEntertainmentChanged)
      socket.off('ingredient:library-update', onIngredientUpdate)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      releaseSharedSocket()
    }
  }, [employee?.location?.id])

  // Handler for cross-item modifier group copy
  const handleCopyModifierGroup = async (groupId: string, sourceItemId: string, targetItemId: string, groupName: string) => {
    try {
      const response = await fetch(`/api/menu/items/${targetItemId}/modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duplicateFromGroupId: groupId,
          copyFromItemId: sourceItemId,
        }),
      })

      if (response.ok) {
        // Show success toast
        const targetItem = items.find(i => i.id === targetItemId)
        toast.success(`Copied "${groupName}" to "${targetItem?.name}"`)

        // Refresh menu
        await loadMenu()
        setRefreshKey(prev => prev + 1)

        // If the target item is currently selected, refresh will show the new group
      } else {
        const errData = await response.json().catch(() => ({}))
        toast.error(errData.error || 'Failed to copy modifier group')
      }
    } catch (error) {
      console.error('Error copying modifier group:', error)
      toast.error('Failed to copy modifier group')
    }
  }

  const handleSaveCategory = async (categoryData: Partial<Category>) => {
    try {
      const method = editingCategory ? 'PUT' : 'POST'
      const url = editingCategory
        ? `/api/menu/categories/${editingCategory.id}`
        : '/api/menu/categories'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryData),
      })

      if (response.ok) {
        loadMenu()
        setShowCategoryModal(false)
        setEditingCategory(null)
      }
    } catch (error) {
      console.error('Failed to save category:', error)
      toast.error('Failed to save category')
    }
  }


  const handleDeleteCategory = (id: string) => {
    setConfirmAction({
      title: 'Delete Category',
      message: 'Delete this category and all its items?',
      action: async () => {
        try {
          await fetch(`/api/menu/categories/${id}`, { method: 'DELETE' })
          loadMenu()
          if (selectedCategory === id) {
            setSelectedCategory(categories[0]?.id || null)
          }
        } catch (error) {
          console.error('Failed to delete category:', error)
          toast.error('Failed to delete category')
        }
      },
    })
  }

  const handleDeleteItem = (id: string) => {
    setConfirmAction({
      title: 'Delete Item',
      message: 'Delete this item?',
      action: async () => {
        try {
          await fetch(`/api/menu/items/${id}`, { method: 'DELETE' })
          loadMenu()
        } catch (error) {
          console.error('Failed to delete item:', error)
          toast.error('Failed to delete item')
        }
      },
    })
  }

  const handleToggleItem86 = async (item: MenuItem) => {
    try {
      await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      })
      loadMenu()
    } catch (error) {
      console.error('Failed to toggle 86:', error)
      toast.error('Failed to update 86 status')
    }
  }

  const handleIngredientCreated = useCallback((ingredient: any) => {
    // Normalize POST response to match GET mapping shape
    // POST returns raw Prisma data with nested relations (categoryRelation, parentIngredient)
    // GET mapping flattens these into categoryName, parentName etc.
    const normalized: IngredientLibraryItem = {
      ...ingredient,
      categoryName: ingredient.categoryRelation?.name || ingredient.category || null,
      categoryId: ingredient.categoryId || null,
      parentName: ingredient.parentIngredient?.name || null,
      parentIngredientId: ingredient.parentIngredientId || null,
      needsVerification: ingredient.needsVerification ?? true,
      allowNo: ingredient.allowNo ?? true,
      allowLite: ingredient.allowLite ?? true,
      allowExtra: ingredient.allowExtra ?? true,
      allowOnSide: ingredient.allowOnSide ?? false,
      allowSwap: ingredient.allowSwap ?? false,
      extraPrice: ingredient.extraPrice ?? 0,
      swapModifierGroupId: ingredient.swapGroupId || null,
      swapUpcharge: ingredient.swapUpcharge ?? 0,
    }

    // Optimistic local update
    setIngredientsLibrary(prev => {
      const exists = prev.some(ing => ing.id === normalized.id)
      if (exists) return prev
      return [...prev, normalized]
    })

    // Dispatch socket event to other terminals
    fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ingredient:library-update',
        data: { ingredient: normalized },
      }),
    }).catch(err => {
      console.error('Failed to broadcast ingredient update:', err)
    })
  }, [])

  const handleCategoryCreated = useCallback((category: IngredientCategory) => {
    setIngredientCategories(prev => {
      const exists = prev.some(c => c.id === category.id)
      if (exists) return prev
      return [...prev, category]
    })
  }, [])

  const filteredItems = items.filter(item => {
    if (item.categoryId !== selectedCategory) return false
    if (itemSearch && !item.name.toLowerCase().includes(itemSearch.toLowerCase())) return false
    return true
  })
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)

  // Stable click handler for items in the horizontal scroll — avoids creating closures per item
  const handleItemClick = useCallback((item: MenuItem) => {
    if (selectedCategoryData?.categoryType === 'entertainment') {
      router.push(`/timed-rentals?item=${item.id}`)
    } else {
      setSelectedItemForEditor(item)
      setSelectedGroupId(null)
    }
  }, [selectedCategoryData?.categoryType, router])

  // Handler for creating a new item
  const handleCreateItem = async () => {
    if (selectedCategoryData?.categoryType === 'entertainment') {
      router.push('/timed-rentals')
    } else {
      // Create a new blank item and open it in ItemEditor
      try {
        const response = await fetch('/api/menu/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'New Item',
            price: 0,
            categoryId: selectedCategory,
          }),
        })
        if (response.ok) {
          const { data: newItem } = await response.json()
          loadMenu()
          // Select the new item to open it in ItemEditor
          setSelectedItemForEditor(newItem)
          setSelectedGroupId(null)
        } else {
          toast.error('Failed to create item')
        }
      } catch (error) {
        console.error('Failed to create item:', error)
        toast.error('Failed to create item')
      }
    }
  }

  return {
    // State
    categories,
    items,
    modifierGroups,
    ingredientsLibrary,
    ingredientCategories,
    printers,
    kdsScreens,
    selectedCategory,
    isLoading,
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
    selectedCategoryType,
    filteredItems,
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
  }
}
