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
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { calculateCardPrice } from '@/lib/pricing'
import { SpiritCategory, BottleProduct } from './types'
import { CategoryModal } from './CategoryModal'
import { CreateMenuItemModal } from './CreateMenuItemModal'

function LiquorBuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/liquor-builder' })
  const employee = useAuthStore(s => s.employee)
  const [isLoading, setIsLoading] = useState(true)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  // Data state
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [menuCategories, setMenuCategories] = useState<{ id: string; name: string; itemCount: number; color: string }[]>([])
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [modifierGroups, setModifierGroups] = useState<any[]>([])

  // Modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showMenuCategoryModal, setShowMenuCategoryModal] = useState(false)
  const [editingMenuCategory, setEditingMenuCategory] = useState<{ id: string; name: string; color: string } | null>(null)
  const [showCreateMenuItemModal, setShowCreateMenuItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SpiritCategory | null>(null)
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

  // Linked bottle state
  const [showBottleLinkPicker, setShowBottleLinkPicker] = useState(false)
  const [bottleLinkSearch, setBottleLinkSearch] = useState('')
  const [linkingBottle, setLinkingBottle] = useState(false)
  const [expandedPickerCats, setExpandedPickerCats] = useState<Set<string>>(new Set())
  const [recipeExpanded, setRecipeExpanded] = useState(false)
  const [editingPourSize, setEditingPourSize] = useState<string>('')
  const [savingPourSize, setSavingPourSize] = useState(false)

  // Inline bottle creation from picker (backward creation)
  const [showInlineBottleForm, setShowInlineBottleForm] = useState(false)
  const [inlineBottleName, setInlineBottleName] = useState('')
  const [inlineBottleBrand, setInlineBottleBrand] = useState('')
  const [inlineBottleCategoryId, setInlineBottleCategoryId] = useState('')
  const [inlineBottleTier, setInlineBottleTier] = useState('well')
  const [inlineBottleSizeMl, setInlineBottleSizeMl] = useState('750')
  const [inlineBottleCost, setInlineBottleCost] = useState('')
  const [creatingInlineBottle, setCreatingInlineBottle] = useState(false)

  // Spirit tier editor state
  const [spiritMode, setSpiritMode] = useState(false)
  const [spiritGroupId, setSpiritGroupId] = useState<string | null>(null)
  const [spiritEntries, setSpiritEntries] = useState<Array<{
    id?: string
    bottleProductId: string
    bottleName: string
    tier: string
    price: number
    isDefault?: boolean
  }>>([])
  const [savingSpirit, setSavingSpirit] = useState(false)

  // Recipe ingredients for spirit upgrade auto-detection
  const [drinkRecipeIngredients, setDrinkRecipeIngredients] = useState<Array<{
    bottleProductId: string
    bottleName: string
    spiritCategory: string
    spiritCategoryId: string
    tier: string
    pourCost: number
  }>>([])

  // Filter state
  const [selectedMenuCategoryId, setSelectedMenuCategoryId] = useState<string>('')

  // Dual pricing settings
  const { dualPricing } = useOrderSettings()
  const cashDiscountPct = dualPricing.cashDiscountPercent || 4.0
  const isDualPricingEnabled = dualPricing.enabled !== false

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
      await Promise.all([loadCategories(), loadBottles(), loadDrinks(), loadModifierGroups()])
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
      // Filter to only shared liquor templates (not item-owned copies, not spirit groups)
      // Shared templates have no linkedItems (menuItemId is null)
      const liquorGroups = data.data.modifierGroups.filter((g: any) =>
        g.modifierTypes && g.modifierTypes.includes('liquor') &&
        !g.isSpiritGroup &&
        (!g.linkedItems || g.linkedItems.length === 0)
      )
      setModifierGroups(liquorGroups)
      return liquorGroups
    }
    return []
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

  // Load recipe ingredients for spirit upgrade auto-detection
  const loadDrinkRecipe = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/recipe`)
      if (res.ok) {
        const data = await res.json()
        const recipeData = data.data ?? data
        if (recipeData.ingredients) {
          const ingredients = recipeData.ingredients.map((ing: any) => ({
            bottleProductId: ing.bottleProductId,
            bottleName: ing.bottleProduct?.name || '',
            spiritCategory: ing.bottleProduct?.spiritCategory?.name || '',
            spiritCategoryId: ing.bottleProduct?.spiritCategoryId || '',
            tier: ing.bottleProduct?.tier || 'well',
            pourCost: ing.bottleProduct?.pourCost || 0,
          }))
          setDrinkRecipeIngredients(ingredients)
          if (ingredients.length > 0) setRecipeExpanded(true)
        } else {
          setDrinkRecipeIngredients([])
        }
      }
    } catch {
      setDrinkRecipeIngredients([])
    }
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
    // Reset linked bottle picker
    setShowBottleLinkPicker(false)
    setBottleLinkSearch('')
    setRecipeExpanded(false)
    // Initialize pour size from drink data
    const pourOz = selectedDrink.linkedPourSizeOz ?? selectedDrink.linkedBottlePourSizeOz ?? ''
    setEditingPourSize(pourOz ? String(pourOz) : '')
    // Reset spirit state until modifiers are loaded
    setSpiritMode(false)
    setSpiritGroupId(null)
    setSpiritEntries([])
    reloadDrinkModifiersRef.current(selectedDrink.id)
    loadDrinkRecipe(selectedDrink.id)
  }, [selectedDrink?.id])

  // Auto-select newly created item after drinks list reloads
  useEffect(() => {
    if (pendingItemId && drinks.length > 0) {
      const newDrink = drinks.find((d: any) => d.id === pendingItemId)
      if (newDrink) {
        setSelectedDrink(newDrink)
        setPendingItemId(null)
      }
    }
  }, [pendingItemId, drinks])

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
          isDefault: m.isDefault || false,
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

      // Auto-add default WELL modifier from linked bottle or first recipe ingredient
      const defaultWellBottleId = selectedDrink?.linkedBottleProductId || drinkRecipeIngredients[0]?.bottleProductId
      if (gid && defaultWellBottleId) {
        const wellBottle = bottles.find(b => b.id === defaultWellBottleId)
        const wellBottleName = wellBottle?.name || drinkRecipeIngredients[0]?.bottleName
        if (wellBottleName) {
          await fetch(`/api/menu/items/${itemId}/modifier-groups/${gid}/modifiers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: wellBottleName,
              price: 0,
              spiritTier: 'well',
              linkedBottleProductId: defaultWellBottleId,
              isDefault: true,
              allowNo: false,
              allowLite: false,
              allowOnSide: false,
              allowExtra: false,
            }),
          })
        }
      }

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

  const setSpiritEntryDefault = async (modifierId: string) => {
    if (!selectedDrink || !spiritGroupId) return
    const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${spiritGroupId}/modifiers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifierId, isDefault: true }),
    })
    if (res.ok) {
      // API auto-clears other defaults (maxSelections=1), update local state
      setSpiritEntries(prev => prev.map(e => ({ ...e, isDefault: e.id === modifierId })))
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

  const linkDrinkToBottle = async (bottleId: string) => {
    if (!selectedDrink) return
    setLinkingBottle(true)
    try {
      const res = await fetch(`/api/menu/items/${selectedDrink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedBottleProductId: bottleId }),
      })
      if (res.ok) {
        // Auto-create recipe ingredient (1 pour of linked bottle)
        await fetch(`/api/menu/items/${selectedDrink.id}/recipe`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bottleProductId: bottleId,
            pourCount: 1,
            isSubstitutable: true,
          }),
        })

        await loadDrinks()
        const bottle = bottles.find(b => b.id === bottleId)
        setSelectedDrink((prev: any) => prev ? {
          ...prev,
          linkedBottleProductId: bottleId,
          linkedBottleProductName: bottle?.name || null,
          linkedBottleTier: bottle?.tier || null,
          linkedBottlePourCost: bottle?.pourCost ? Number(bottle.pourCost) : null,
          linkedBottleSizeMl: bottle?.bottleSizeMl || null,
          linkedBottleSpiritCategory: bottle?.spiritCategory?.name || null,
        } : prev)
        setShowBottleLinkPicker(false)
        setBottleLinkSearch('')
        // Initialize pour size from bottle default
        const defaultPour = bottle?.pourSizeOz ? String(Number(bottle.pourSizeOz)) : '1.5'
        setEditingPourSize(defaultPour)
        // Reload recipe to reflect the auto-created ingredient
        loadDrinkRecipe(selectedDrink.id)
        toast.success(`Linked to ${bottle?.name || 'bottle'}`)
      } else {
        toast.error('Failed to link bottle')
      }
    } finally {
      setLinkingBottle(false)
    }
  }

  // Create bottle inline from picker (backward creation — marked unverified)
  const handleCreateInlineBottle = async () => {
    if (!inlineBottleName.trim() || !inlineBottleCategoryId || !inlineBottleCost) return
    setCreatingInlineBottle(true)
    try {
      const res = await fetch('/api/liquor/bottles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inlineBottleName.trim(),
          brand: inlineBottleBrand.trim() || undefined,
          spiritCategoryId: inlineBottleCategoryId,
          tier: inlineBottleTier,
          bottleSizeMl: parseInt(inlineBottleSizeMl) || 750,
          unitCost: parseFloat(inlineBottleCost) || 0,
          needsVerification: true,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        const bottleId = result.data?.id
        toast.success(`Created "${inlineBottleName.trim()}" (needs verification)`)
        // Reload bottles, then auto-link
        await loadBottles()
        if (bottleId) {
          await linkDrinkToBottle(bottleId)
        }
        // Reset form
        setShowInlineBottleForm(false)
        setInlineBottleName('')
        setInlineBottleBrand('')
        setInlineBottleCost('')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create bottle')
      }
    } catch (error) {
      console.error('Failed to create inline bottle:', error)
      toast.error('Failed to create bottle')
    } finally {
      setCreatingInlineBottle(false)
    }
  }

  const unlinkDrinkFromBottle = async () => {
    if (!selectedDrink) return
    setLinkingBottle(true)
    try {
      const res = await fetch(`/api/menu/items/${selectedDrink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedBottleProductId: null, linkedPourSizeOz: null }),
      })
      if (res.ok) {
        await loadDrinks()
        setSelectedDrink((prev: any) => prev ? {
          ...prev,
          linkedBottleProductId: null,
          linkedBottleProductName: null,
          linkedBottleTier: null,
          linkedBottlePourCost: null,
          linkedBottlePourSizeOz: null,
          linkedBottleUnitCost: null,
          linkedBottleSizeMl: null,
          linkedBottleSpiritCategory: null,
          linkedPourSizeOz: null,
        } : prev)
        setEditingPourSize('')
        toast.success('Bottle unlinked')
      } else {
        toast.error('Failed to unlink')
      }
    } finally {
      setLinkingBottle(false)
    }
  }

  const savePourSize = async () => {
    if (!selectedDrink) return
    setSavingPourSize(true)
    try {
      const pourOz = parseFloat(editingPourSize) || null
      const res = await fetch(`/api/menu/items/${selectedDrink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedPourSizeOz: pourOz }),
      })
      if (res.ok) {
        await loadDrinks()
        setSelectedDrink((prev: any) => prev ? { ...prev, linkedPourSizeOz: pourOz } : prev)
        toast.success('Pour size saved')
      } else {
        toast.error('Failed to save pour size')
      }
    } finally {
      setSavingPourSize(false)
    }
  }

  // Refs for load functions to avoid stale closures in socket listener
  const loadBottlesRef = useRef<(() => Promise<void>) | null>(null)
  loadBottlesRef.current = loadBottles

  // Filter drinks by selected menu category, alphabetized
  const filteredDrinks = (selectedMenuCategoryId
    ? drinks.filter((d: any) => d.categoryId === selectedMenuCategoryId)
    : drinks
  ).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))

  if (!hydrated) return null

  // Check if this is a fresh setup (no menu categories or drinks)
  const isEmptySetup = menuCategories.length === 0 && drinks.length === 0

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header — Row 1: title + back + inventory link */}
      <div className="bg-white border-b shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
          <h1 className="text-base font-bold">🥃 Liquor Builder</h1>
          <div className="flex items-center gap-3">
            <Link href="/liquor-inventory" className="text-xs text-purple-600 hover:underline">Manage Inventory →</Link>
            <Link href="/menu" className="text-xs text-blue-600 hover:underline">← Back to Menu</Link>
          </div>
        </div>
        {/* Row 2: POS category pills (what shows on front-end bar tabs) */}
        <div className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] uppercase text-gray-400 font-medium shrink-0 mr-1">POS Tabs:</span>
          <button
            onClick={() => {
              setSelectedMenuCategoryId('')
              setSelectedDrink(null)
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
              !selectedMenuCategoryId ? 'bg-gray-800 text-white border-transparent shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            All
            <span className="ml-1 opacity-60">{drinks.length}</span>
          </button>
          {menuCategories.map(cat => {
            const isActive = selectedMenuCategoryId === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => {
                  if (isActive) {
                    setSelectedMenuCategoryId('')
                  } else {
                    setSelectedMenuCategoryId(cat.id)
                  }
                  setSelectedDrink(null)
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
            <p className="text-gray-600 text-sm mb-6">Set up your bar menu in 3 steps:</p>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold shrink-0">1</div>
                <div className="flex-1">
                  <h3 className="font-semibold">Create Menu Categories</h3>
                  <p className="text-sm text-gray-600 mb-2">Cocktails, Beer, Wine, Spirits, etc.</p>
                  <Button size="sm" onClick={() => { setEditingMenuCategory(null); setShowMenuCategoryModal(true); }}>
                    + Add Category
                  </Button>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">2</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-500">Add Your Bottles</h3>
                  <p className="text-sm text-gray-400">Go to <Link href="/liquor-inventory" className="text-purple-500 underline">Liquor Inventory</Link> to add bottles with cost, size, and tier</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">3</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-500">Create Drink Items</h3>
                  <p className="text-sm text-gray-400">Add drinks, set prices, build recipes, and configure spirit upgrades</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main Interface — Item-First Layout */
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT: Item List (w-72) */}
          <div className="w-72 bg-white border-r flex flex-col shrink-0">
            {/* Header row: category name */}
            <div className="px-3 pt-2 pb-1 flex items-center justify-between border-b shrink-0">
              <span className="text-xs font-medium text-purple-700">
                {selectedMenuCategoryId
                  ? `${menuCategories.find((c: any) => c.id === selectedMenuCategoryId)?.name} (${filteredDrinks.length})`
                  : `All Drinks (${filteredDrinks.length})`
                }
              </span>
              {selectedMenuCategoryId && (
                <button
                  onClick={() => { setSelectedMenuCategoryId(''); setSelectedDrink(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  All
                </button>
              )}
            </div>
            {/* Primary "+ New Item" button - always visible */}
            <div className="px-3 py-2 border-b">
              <button
                onClick={() => {
                  setBottleForMenuItem(null)
                  setShowCreateMenuItemModal(true)
                }}
                className="w-full px-3 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <span className="text-lg leading-none">+</span> New Item
              </button>
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
                    {drink.linkedBottleProductName && (
                      <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium text-[10px]">LINKED</span>
                        <span className="truncate">{drink.linkedBottleProductName}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* CENTER: Item Editor (flex-1) */}
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
                      {isDualPricingEnabled && parseFloat(editingDrinkPrice) > 0 && (
                        <p className="text-xs text-indigo-400 mt-1">Card: ${calculateCardPrice(parseFloat(editingDrinkPrice) || 0, cashDiscountPct).toFixed(2)}</p>
                      )}
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

                {/* Linked Bottle — direct bottle linking (like food ingredients) */}
                {selectedDrink.linkedBottleProductId ? (() => {
                  // Compute pour metrics
                  const ML_PER_OZ = 29.5735
                  const effectivePourOz = parseFloat(editingPourSize) || selectedDrink.linkedPourSizeOz || selectedDrink.linkedBottlePourSizeOz || 1.5
                  const bottleSizeMl = selectedDrink.linkedBottleSizeMl || 750
                  const unitCost = selectedDrink.linkedBottleUnitCost || 0
                  const poursPerBottle = Math.floor(bottleSizeMl / (effectivePourOz * ML_PER_OZ))
                  const computedPourCost = poursPerBottle > 0 ? unitCost / poursPerBottle : 0
                  const sellPrice = parseFloat(editingDrinkPrice) || selectedDrink.price || 0
                  const margin = sellPrice > 0 && computedPourCost > 0 ? ((sellPrice - computedPourCost) / sellPrice) * 100 : null
                  const bottleDefaultPour = selectedDrink.linkedBottlePourSizeOz || 1.5

                  return (
                  <div className="bg-green-50 rounded-lg border border-green-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-green-700 uppercase tracking-wide">Linked Bottle</h3>
                      <button
                        onClick={unlinkDrinkFromBottle}
                        disabled={linkingBottle}
                        className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        {linkingBottle ? 'Unlinking...' : 'Unlink'}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="font-semibold text-gray-900">{selectedDrink.linkedBottleProductName}</span>
                      {selectedDrink.linkedBottleSpiritCategory && (
                        <span className="text-xs text-gray-500">{selectedDrink.linkedBottleSpiritCategory}</span>
                      )}
                      {selectedDrink.linkedBottleTier && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          selectedDrink.linkedBottleTier === 'well' ? 'bg-gray-200 text-gray-700'
                          : selectedDrink.linkedBottleTier === 'call' ? 'bg-blue-100 text-blue-700'
                          : selectedDrink.linkedBottleTier === 'premium' ? 'bg-purple-100 text-purple-700'
                          : 'bg-amber-100 text-amber-700'
                        }`}>
                          {selectedDrink.linkedBottleTier === 'top_shelf' ? 'TOP SHELF' : selectedDrink.linkedBottleTier.toUpperCase()}
                        </span>
                      )}
                      {selectedDrink.linkedBottleSizeMl && (
                        <span className="text-xs text-gray-400">{selectedDrink.linkedBottleSizeMl}ml</span>
                      )}
                    </div>

                    {/* POUR configuration — the "prep item" equivalent for liquor */}
                    <div className="bg-white/70 rounded-lg border border-green-200 p-3 mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase font-bold text-green-700 tracking-wide bg-green-200 px-1.5 py-0.5 rounded">POUR</span>
                        <span className="text-xs text-gray-400">bottle default: {bottleDefaultPour}oz</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium text-gray-600">Pour Size:</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="0.25"
                              min="0.25"
                              value={editingPourSize}
                              onChange={e => setEditingPourSize(e.target.value)}
                              className="w-20 px-2 py-1.5 text-sm border rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-green-400"
                              placeholder={String(bottleDefaultPour)}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">oz</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-600">
                          <span>{poursPerBottle} pours/bottle</span>
                          <span>|</span>
                          <span>{formatCurrency(Math.round(computedPourCost * 100) / 100)}/pour</span>
                        </div>
                        <button
                          onClick={savePourSize}
                          disabled={savingPourSize}
                          className="ml-auto px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          {savingPourSize ? 'Saving...' : 'Save Pour'}
                        </button>
                      </div>
                    </div>

                    {/* Cost summary */}
                    <div className="flex items-center gap-4 text-xs text-gray-600 bg-white/60 rounded px-3 py-2">
                      <span>Pour Cost: <strong>{formatCurrency(Math.round(computedPourCost * 100) / 100)}</strong></span>
                      <span>Sell Price: <strong>{formatCurrency(sellPrice)}</strong></span>
                      {margin !== null && (
                        <span>Margin: <strong className={margin >= 70 ? 'text-green-700' : margin >= 50 ? 'text-yellow-700' : 'text-red-700'}>
                          {Math.round(margin)}%
                        </strong></span>
                      )}
                    </div>
                  </div>
                  )
                })() : (
                  <div className={`rounded-lg border-2 border-dashed p-5 transition-colors ${showBottleLinkPicker ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Linked Bottle</h3>
                      {!showBottleLinkPicker && (
                        <button
                          onClick={() => { setShowBottleLinkPicker(true); setExpandedPickerCats(new Set()) }}
                          className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
                        >
                          Link to Bottle
                        </button>
                      )}
                    </div>
                    {!showBottleLinkPicker ? (
                      <p className="text-xs text-gray-400">Link this drink to a bottle from inventory for cost tracking and deductions.</p>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            type="text"
                            placeholder="Search bottles..."
                            value={bottleLinkSearch}
                            onChange={e => setBottleLinkSearch(e.target.value)}
                            autoFocus
                            className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <button
                            onClick={() => { setShowBottleLinkPicker(false); setBottleLinkSearch('') }}
                            className="px-2 py-2 text-gray-400 hover:text-gray-600 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {(() => {
                            const search = bottleLinkSearch.toLowerCase()
                            const filtered = bottles.filter((b: BottleProduct) =>
                              b.name.toLowerCase().includes(search) ||
                              b.spiritCategory?.name?.toLowerCase().includes(search)
                            )
                            // Group by spirit category
                            const grouped = new Map<string, BottleProduct[]>()
                            for (const b of filtered) {
                              const cat = b.spiritCategory?.name || 'Other'
                              if (!grouped.has(cat)) grouped.set(cat, [])
                              grouped.get(cat)!.push(b)
                            }
                            if (grouped.size === 0 && !showInlineBottleForm) {
                              return <p className="text-xs text-gray-400 text-center py-4">No bottles found — create one below</p>
                            }
                            return Array.from(grouped.entries()).map(([catName, catBottles]) => {
                              const isCatExpanded = expandedPickerCats.has(catName) || bottleLinkSearch.length > 0
                              return (
                                <div key={catName}>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPickerCats(prev => {
                                      const next = new Set(prev)
                                      if (next.has(catName)) next.delete(catName)
                                      else next.add(catName)
                                      return next
                                    })}
                                    className="w-full flex items-center gap-2 px-1 py-1.5 hover:bg-gray-50 rounded transition-colors"
                                  >
                                    <span className="text-gray-400 text-[10px] select-none">{isCatExpanded ? '\u25BC' : '\u25B6'}</span>
                                    <span className="text-[10px] uppercase text-gray-400 font-semibold tracking-wide">{catName}</span>
                                    <span className="text-[10px] text-gray-300">{catBottles.length}</span>
                                  </button>
                                  {isCatExpanded && (
                                    <div className="space-y-0.5 ml-3">
                                      {catBottles.map((b: BottleProduct) => (
                                        <button
                                          key={b.id}
                                          onClick={() => linkDrinkToBottle(b.id)}
                                          disabled={linkingBottle}
                                          className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
                                        >
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-gray-800">{b.name}</span>
                                            <div className="flex items-center gap-2">
                                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                b.tier === 'well' ? 'bg-gray-200 text-gray-700'
                                                : b.tier === 'call' ? 'bg-blue-100 text-blue-700'
                                                : b.tier === 'premium' ? 'bg-purple-100 text-purple-700'
                                                : 'bg-amber-100 text-amber-700'
                                              }`}>
                                                {b.tier === 'top_shelf' ? 'TOP SHELF' : b.tier.toUpperCase()}
                                              </span>
                                              {b.pourCost && (
                                                <span className="text-xs text-gray-500">{formatCurrency(Number(b.pourCost))}</span>
                                              )}
                                            </div>
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          })()}
                        </div>

                        {/* Inline bottle creation form */}
                        {!showInlineBottleForm ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowInlineBottleForm(true)
                              if (categories.length > 0 && !inlineBottleCategoryId) {
                                setInlineBottleCategoryId(categories[0].id)
                              }
                            }}
                            className="w-full mt-2 px-3 py-2 text-sm font-medium text-amber-600 border border-amber-300 border-dashed rounded-lg hover:bg-amber-50 transition-colors"
                          >
                            + Create New Bottle
                          </button>
                        ) : (
                          <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                            <div className="text-[10px] font-bold uppercase text-amber-600 tracking-wider">Create Bottle (Unverified)</div>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={inlineBottleName}
                                onChange={e => setInlineBottleName(e.target.value)}
                                placeholder="Bottle name *"
                                className="px-2 py-1.5 text-sm border rounded"
                                autoFocus
                              />
                              <input
                                type="text"
                                value={inlineBottleBrand}
                                onChange={e => setInlineBottleBrand(e.target.value)}
                                placeholder="Brand"
                                className="px-2 py-1.5 text-sm border rounded"
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <select
                                value={inlineBottleCategoryId}
                                onChange={e => setInlineBottleCategoryId(e.target.value)}
                                className="px-2 py-1.5 text-sm border rounded"
                              >
                                <option value="">Category *</option>
                                {categories.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                              <select
                                value={inlineBottleTier}
                                onChange={e => setInlineBottleTier(e.target.value)}
                                className="px-2 py-1.5 text-sm border rounded"
                              >
                                {SPIRIT_TIERS.map(t => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                              <select
                                value={inlineBottleSizeMl}
                                onChange={e => setInlineBottleSizeMl(e.target.value)}
                                className="px-2 py-1.5 text-sm border rounded"
                              >
                                {BOTTLE_SIZES.map(s => (
                                  <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={inlineBottleCost}
                                onChange={e => setInlineBottleCost(e.target.value)}
                                placeholder="Unit cost ($) *"
                                className="flex-1 px-2 py-1.5 text-sm border rounded"
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); handleCreateInlineBottle() }
                                  if (e.key === 'Escape') setShowInlineBottleForm(false)
                                }}
                              />
                              <button
                                type="button"
                                onClick={handleCreateInlineBottle}
                                disabled={creatingInlineBottle || !inlineBottleName.trim() || !inlineBottleCategoryId || !inlineBottleCost}
                                className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                              >
                                {creatingInlineBottle ? '...' : 'Create & Link'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowInlineBottleForm(false)}
                                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                            <p className="text-[10px] text-amber-600">
                              Created bottles are marked as unverified and need to be verified in Liquor Inventory.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Auto-detected Spirit Upgrades from Recipe */}
                {drinkRecipeIngredients.length > 0 && (() => {
                  // Group recipe ingredients by spirit category
                  const recipeCategories = new Map<string, { categoryName: string; baseBottle: typeof drinkRecipeIngredients[0] }>()
                  for (const ing of drinkRecipeIngredients) {
                    if (ing.spiritCategory && !recipeCategories.has(ing.spiritCategory)) {
                      recipeCategories.set(ing.spiritCategory, { categoryName: ing.spiritCategory, baseBottle: ing })
                    }
                  }

                  if (recipeCategories.size === 0) return null

                  return (
                    <div className="bg-white rounded-lg border p-5">
                      <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                        Spirit Upgrades <span className="text-xs font-normal text-gray-400">(auto-detected from recipe)</span>
                      </h3>
                      <div className="space-y-4">
                        {Array.from(recipeCategories.entries()).map(([catName, { baseBottle }]) => {
                          // Find available upgrade bottles in same category at higher tiers
                          const upgradeBottles = bottles.filter(b =>
                            b.spiritCategory.name === catName &&
                            b.id !== baseBottle.bottleProductId &&
                            b.tier !== 'well'
                          )
                          const tierOrder = ['call', 'premium', 'top_shelf'] as const

                          return (
                            <div key={catName} className="border rounded-lg p-3 bg-amber-50/50">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-medium text-gray-800">{catName}</span>
                                <span className="text-xs text-gray-400">base: {baseBottle.bottleName} ({baseBottle.tier}) — {formatCurrency(baseBottle.pourCost)}/pour</span>
                              </div>
                              {tierOrder.map(tier => {
                                const tierBottles = upgradeBottles.filter(b => b.tier === tier)
                                if (tierBottles.length === 0) return null
                                const tierLabel = tier === 'call' ? 'Call' : tier === 'premium' ? 'Premium' : 'Top Shelf'
                                const existingEntry = spiritEntries.find(e => e.tier === tier && tierBottles.some(b => b.id === e.bottleProductId))

                                return (
                                  <div key={tier} className="flex items-center gap-2 ml-2 mb-1.5">
                                    <span className={`text-xs font-medium w-16 ${
                                      tier === 'call' ? 'text-blue-600' : tier === 'premium' ? 'text-purple-600' : 'text-amber-600'
                                    }`}>{tierLabel}:</span>
                                    <select
                                      value={existingEntry?.bottleProductId || ''}
                                      onChange={e => {
                                        const bottleId = e.target.value
                                        if (bottleId) {
                                          addSpiritBottle(tier, bottleId)
                                        }
                                      }}
                                      className="flex-1 text-sm border rounded px-2 py-1.5"
                                    >
                                      <option value="">— Select {tierLabel} —</option>
                                      {tierBottles.map(b => (
                                        <option key={b.id} value={b.id}>
                                          {b.name} (+{formatCurrency((b.pourCost || 0) - baseBottle.pourCost)})
                                        </option>
                                      ))}
                                    </select>
                                    {existingEntry && (
                                      <span className="text-xs text-green-600">&#10003;</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

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
                                {entry.isDefault ? (
                                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700 shrink-0">Default</span>
                                ) : (
                                  <button
                                    onClick={() => entry.id && setSpiritEntryDefault(entry.id)}
                                    className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600 hover:bg-green-50 shrink-0 transition-colors"
                                    title="Set as default spirit"
                                  >
                                    Set default
                                  </button>
                                )}
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
                        <>
                          <p className="text-xs text-gray-400 mt-1 ml-6">
                            Price on POS: base price × multiplier (e.g. ${(parseFloat(editingDrinkPrice) || 0).toFixed(2)} × 1.5 = ${((parseFloat(editingDrinkPrice) || 0) * 1.5).toFixed(2)} for Tall)
                          </p>
                          {isDualPricingEnabled && parseFloat(editingDrinkPrice) > 0 && (
                            <p className="text-xs text-indigo-400 mt-0.5 ml-6">
                              Card: ${calculateCardPrice((parseFloat(editingDrinkPrice) || 0) * 1.5, cashDiscountPct).toFixed(2)} for Tall
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Modifier Groups — tap a template in the right panel to attach (existing) */}
                <div className="bg-white rounded-lg border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700">Modifier Groups</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Tap a template in the right panel to attach, then edit modifiers inline below</p>
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
                      {drinkModifierGroups.filter((mg: any) => !mg.isSpiritGroup).map((mg: any) => {
                        const isExpanded = selectedModGroupId === mg.id
                        return (
                          <div key={mg.id}>
                            <button
                              onClick={() => setSelectedModGroupId(isExpanded ? null : mg.id)}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                                isExpanded
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
                                <span>{isExpanded ? '▲' : '▼'}</span>
                              </div>
                            </button>

                            {/* Inline per-item modifier editing */}
                            {isExpanded && (
                              <div className="bg-gray-50 border-t px-4 py-3">
                                {/* Column headers */}
                                <div className="grid grid-cols-12 gap-2 text-[10px] text-gray-400 px-1 mb-1.5">
                                  <div className="col-span-5">Name</div>
                                  <div className="col-span-3 text-right">+Charge</div>
                                  <div className="col-span-2 text-center">Active</div>
                                  <div className="col-span-2"></div>
                                </div>

                                <div className="space-y-1">
                                  {(mg.modifiers || []).map((mod: any) => (
                                    <div
                                      key={mod.id}
                                      className={`grid grid-cols-12 gap-2 items-center p-1.5 rounded border transition-colors ${
                                        mod.isActive !== false ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-100 opacity-60'
                                      }`}
                                    >
                                      {/* Name */}
                                      <div className="col-span-5">
                                        <input
                                          type="text"
                                          defaultValue={mod.name}
                                          key={`${mod.id}-name-${modGroupRefreshKey}`}
                                          onBlur={async (e) => {
                                            const newName = e.target.value.trim()
                                            if (newName && newName !== mod.name) {
                                              await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ modifierId: mod.id, name: newName }),
                                              })
                                              reloadDrinkModifiersRef.current(selectedDrink.id)
                                            }
                                          }}
                                          className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
                                        />
                                      </div>

                                      {/* Price */}
                                      <div className="col-span-3">
                                        <div className="relative">
                                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                          <input
                                            type="number"
                                            step="0.25"
                                            min="0"
                                            defaultValue={mod.price || 0}
                                            key={`${mod.id}-price-${modGroupRefreshKey}`}
                                            onBlur={async (e) => {
                                              const newPrice = parseFloat(e.target.value) || 0
                                              if (newPrice !== (mod.price || 0)) {
                                                await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                                  method: 'PUT',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ modifierId: mod.id, price: newPrice }),
                                                })
                                                reloadDrinkModifiersRef.current(selectedDrink.id)
                                              }
                                            }}
                                            className="w-full pl-4 pr-1 py-1 text-sm border rounded text-right focus:outline-none focus:ring-1 focus:ring-purple-400"
                                          />
                                        </div>
                                        {isDualPricingEnabled && (mod.price || 0) > 0 && (
                                          <p className="text-xs text-indigo-400 text-right mt-0.5">Card: ${calculateCardPrice(mod.price || 0, cashDiscountPct).toFixed(2)}</p>
                                        )}
                                      </div>

                                      {/* Active toggle */}
                                      <div className="col-span-2 flex justify-center">
                                        <input
                                          type="checkbox"
                                          checked={mod.isActive !== false}
                                          onChange={async (e) => {
                                            await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                              method: 'PUT',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ modifierId: mod.id, isActive: e.target.checked }),
                                            })
                                            reloadDrinkModifiersRef.current(selectedDrink.id)
                                          }}
                                          className="w-4 h-4"
                                          title="Active on POS"
                                        />
                                      </div>

                                      {/* Remove */}
                                      <div className="col-span-2 flex justify-center">
                                        <button
                                          onClick={async () => {
                                            await fetch(
                                              `/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers?modifierId=${mod.id}`,
                                              { method: 'DELETE' }
                                            )
                                            reloadDrinkModifiersRef.current(selectedDrink.id)
                                          }}
                                          className="text-gray-300 hover:text-red-500 text-lg leading-none"
                                          title="Remove option"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* Add option button */}
                                <button
                                  onClick={async () => {
                                    const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups/${mg.id}/modifiers`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ name: 'New Option', price: 0, isActive: true }),
                                    })
                                    if (res.ok) {
                                      reloadDrinkModifiersRef.current(selectedDrink.id)
                                      setModGroupRefreshKey(k => k + 1)
                                    }
                                  }}
                                  className="mt-2 text-xs text-purple-600 hover:text-purple-800 font-medium"
                                >
                                  + Add Option
                                </button>

                                {/* Group-level settings (tiered pricing, etc.) */}
                                <div className="mt-3 pt-3 border-t">
                                  <ModifierFlowEditor
                                    item={{ id: selectedDrink.id, name: editingDrinkName || selectedDrink.name }}
                                    selectedGroupId={mg.id}
                                    refreshKey={modGroupRefreshKey}
                                    onGroupUpdated={() => {
                                      reloadDrinkModifiersRef.current(selectedDrink.id)
                                      setModGroupRefreshKey(k => k + 1)
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Recipe Builder — collapsed by default, auto-expands if drink has recipe */}
                <RecipeBuilder
                  menuItemId={selectedDrink.id}
                  menuItemPrice={parseFloat(editingDrinkPrice) || selectedDrink.price}
                  locationId={employee?.location?.id || ''}
                  isExpanded={recipeExpanded}
                  onToggle={() => setRecipeExpanded(prev => !prev)}
                />

              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                <p>Select a drink to edit</p>
              </div>
            )}
          </div>

          {/* RIGHT: Modifier Templates — slim picker (w-64) */}
          <div className="w-64 bg-white border-l flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Modifier Templates</span>
              </div>
              <Link href="/liquor-modifiers" className="text-[10px] text-purple-600 hover:text-purple-700 font-medium">
                Manage Templates →
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {modifierGroups.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400">
                  <p className="mb-2">No modifier templates yet.</p>
                  <p className="text-gray-400 mb-3">Create templates in the Modifier Templates page, then attach them here.</p>
                  <Link href="/liquor-modifiers" className="text-purple-600 hover:text-purple-700 font-medium">
                    Create templates →
                  </Link>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedDrink && (
                    <p className="text-[10px] text-purple-600 font-medium px-1 pb-1">
                      Tap to attach to {selectedDrink.name || 'this drink'}:
                    </p>
                  )}
                  {modifierGroups.map((group: any) => {
                    const isAlreadyAdded = selectedDrink &&
                      drinkModifierGroups.some((mg: any) => mg.name === group.name && !mg.isSpiritGroup)
                    return (
                      <button
                        key={group.id}
                        disabled={!!attachingGroupId || !selectedDrink || !!isAlreadyAdded}
                        onClick={async () => {
                          if (selectedDrink && !group.isSpiritGroup && !isAlreadyAdded) {
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
                          }
                        }}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                          isAlreadyAdded
                            ? 'bg-green-50 border-green-200 cursor-default'
                            : attachingGroupId === group.id
                            ? 'bg-blue-50 border-blue-300'
                            : selectedDrink
                            ? 'bg-white border-purple-200 hover:bg-purple-50 hover:border-purple-400'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm truncate">{group.name}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-gray-400">{group.modifiers?.length ?? 0} options</span>
                          {isAlreadyAdded ? (
                            <span className="text-xs text-green-600">✓ Added</span>
                          ) : attachingGroupId === group.id ? (
                            <span className="text-xs text-blue-600">Adding...</span>
                          ) : selectedDrink ? (
                            <span className="text-xs text-purple-500">+ Attach</span>
                          ) : (
                            <span className="text-xs text-gray-400">{group.modifiers?.length ?? 0} opts</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
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

      {/* Create Menu Item Modal */}
      {showCreateMenuItemModal && (
        <CreateMenuItemModal
          bottle={bottleForMenuItem}
          menuCategories={menuCategories}
          onSave={async (data) => {
            // Auto-set pour sizes based on container type
            const containerType = (bottleForMenuItem as any)?.containerType
            let defaultPourSizes = null
            let defaultPourSizeKey = null
            if (containerType === 'can' || containerType === 'bottle') {
              // Beer — no pour sizes (single serve)
              defaultPourSizes = null
            } else if (containerType === 'draft') {
              defaultPourSizes = { pint: { label: 'Pint', multiplier: 1.0 }, half_pint: { label: 'Half Pint', multiplier: 0.5 } }
              defaultPourSizeKey = 'pint'
            } else if (containerType === 'glass') {
              defaultPourSizes = { glass: { label: 'Glass', multiplier: 1.0 }, bottle: { label: 'Bottle', multiplier: 1.0 } }
              defaultPourSizeKey = 'glass'
            } else if (bottleForMenuItem) {
              // Spirit — default pour sizes
              defaultPourSizes = { shot: { label: 'Shot', multiplier: 1.0 }, double: { label: 'Double', multiplier: 2.0 }, tall: { label: 'Tall', multiplier: 1.5 } }
              defaultPourSizeKey = 'shot'
            }

            // Create the menu item
            const res = await fetch('/api/menu/items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: data.name,
                price: data.price,
                categoryId: data.categoryId,
                pourSizes: defaultPourSizes,
                defaultPourSize: defaultPourSizeKey,
              }),
            })
            if (!res.ok) {
              const err = await res.json()
              toast.error(err.error || 'Failed to create menu item')
              return
            }
            const newItem = await res.json()
            const itemId = newItem.data?.id || newItem.id

            // If a bottle was selected, create recipe ingredient
            if (data.bottleProductId && itemId) {
              await fetch(`/api/menu/items/${itemId}/recipe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ingredients: [{
                    bottleProductId: data.bottleProductId,
                    pourCount: 1,
                    isSubstitutable: true,
                    sortOrder: 0,
                  }]
                }),
              })
            }

            // Reload data and auto-select new item
            await Promise.all([loadDrinks(), loadBottles()])

            // Select the new item
            if (data.categoryId) setSelectedMenuCategoryId(data.categoryId)
            setPendingItemId(itemId)

            setShowCreateMenuItemModal(false)
            setBottleForMenuItem(null)
            toast.success('Item created!')
          }}
          onClose={() => { setShowCreateMenuItemModal(false); setBottleForMenuItem(null) }}
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
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <LiquorBuilderContent />
    </Suspense>
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
