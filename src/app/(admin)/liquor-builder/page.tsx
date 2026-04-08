'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { SpiritCategory, BottleProduct } from './types'
import { CategoryModal } from './CategoryModal'
import { CreateMenuItemModal } from './CreateMenuItemModal'
import { MenuCategoryModal } from './MenuCategoryModal'
import { DrinkListPanel } from './DrinkListPanel'
import { DrinkEditor } from './DrinkEditor'
import { ModifierTemplatesPanel } from './ModifierTemplatesPanel'
import { normalizePourSizes, DEFAULT_POUR_SIZES, PourSizeConfig } from './liquor-builder-utils'

function LiquorBuilderContent() {
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
  const [enabledPourSizes, setEnabledPourSizes] = useState<Record<string, PourSizeConfig>>({})
  const [defaultPourSize, setDefaultPourSize] = useState<string>('standard')
  const [applyPourToModifiers, setApplyPourToModifiers] = useState(false)
  const [hideDefaultOnPos, setHideDefaultOnPos] = useState(false)

  // Modifier group editor state (inline in Drinks tab)
  const [selectedModGroupId, setSelectedModGroupId] = useState<string | null>(null)
  const [modGroupRefreshKey, setModGroupRefreshKey] = useState(0)
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

  // ─── DATA LOADING ───────────────────────────────────────────────

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
      const liquorCats = data.data.categories.filter((c: any) => c.categoryType === 'liquor')
      setMenuCategories(liquorCats.map((c: any) => ({ id: c.id, name: c.name, itemCount: c.itemCount ?? 0, color: c.color || '#8b5cf6' })))
    }
  }

  const loadModifierGroups = async () => {
    const res = await fetch('/api/menu/modifier-templates?type=liquor')
    if (res.ok) {
      const data = await res.json()
      const templates = data.data || []
      const mappedGroups = templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        displayName: null,
        modifierTypes: t.modifierTypes || ['liquor'],
        minSelections: t.minSelections,
        maxSelections: t.maxSelections,
        isRequired: t.isRequired,
        allowStacking: t.allowStacking ?? false,
        isSpiritGroup: false,
        modifiers: (t.modifiers || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          price: m.price,
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: m.extraPrice,
          sortOrder: m.sortOrder,
          isDefault: m.isDefault,
        })),
      }))
      setModifierGroups(mappedGroups)
      return mappedGroups
    }
    return []
  }

  // ─── DRINK SELECTION / LOADING ─────────────────────────────────

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
      toast.error('Failed to load drink recipe')
    }
  }

  const reloadDrinkModifiers = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups`)
      if (res.ok) {
        const data = await res.json()
        setDrinkModifierGroups(data.data || [])
      }
    } catch {
      setDrinkModifierGroups([])
      toast.error('Failed to load modifier groups')
    }
  }
  const reloadDrinkModifiersRef = useRef(reloadDrinkModifiers)
  reloadDrinkModifiersRef.current = reloadDrinkModifiers

  // Load drink fields + modifier groups when selection changes
  useEffect(() => {
    if (!selectedDrink) return
    setEditingDrinkName(selectedDrink.name)
    setEditingDrinkPrice(String(selectedDrink.price))
    const normalized = normalizePourSizes(selectedDrink.pourSizes ?? null)
    delete normalized['standard']
    setEnabledPourSizes(normalized)
    setDefaultPourSize(selectedDrink.defaultPourSize || 'standard')
    setApplyPourToModifiers(selectedDrink.applyPourToModifiers || false)
    setHideDefaultOnPos(selectedDrink.pourSizes?._hideDefaultOnPos === true)
    setSelectedModGroupId(null)
    setShowBottleLinkPicker(false)
    setBottleLinkSearch('')
    setRecipeExpanded(false)
    const pourOz = selectedDrink.linkedPourSizeOz ?? selectedDrink.linkedBottlePourSizeOz ?? ''
    setEditingPourSize(pourOz ? String(pourOz) : '')
    setSpiritGroupId(null)
    setSpiritEntries([])
    const loadAsync = async () => {
      await Promise.all([
        reloadDrinkModifiersRef.current(selectedDrink.id),
        loadDrinkRecipe(selectedDrink.id),
      ])
    }
    loadAsync()
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
    } else if (selectedDrink) {
      fetch(`/api/modifiers/spirit-groups?locationId=${selectedDrink.locationId || ''}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          const shared = data?.data?.[0]
          if (shared) {
            setSpiritGroupId(shared.id)
            setSpiritEntries(
              shared.modifiers.map((m: any) => ({
                id: m.id,
                bottleProductId: m.linkedBottleProductId || '',
                bottleName: m.linkedBottleProduct?.name || m.name,
                tier: m.spiritTier || 'call',
                price: Number(m.price) || 0,
                isDefault: m.isDefault || false,
              }))
            )
          } else {
            setSpiritGroupId(null)
            setSpiritEntries([])
          }
        })
        .catch(err => {
          console.warn('liquor builder spirit fetch failed:', err)
          setSpiritGroupId(null)
          setSpiritEntries([])
        })
    } else {
      setSpiritGroupId(null)
      setSpiritEntries([])
    }
  }, [drinkModifierGroups, selectedDrink])

  // Refs for load functions to avoid stale closures in socket listener
  const loadBottlesRef = useRef<(() => Promise<void>) | null>(null)
  loadBottlesRef.current = loadBottles

  // ─── SPIRIT TIER HELPERS ──────────────────────────────────────

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
      setSpiritEntries(prev => prev.map(e => ({ ...e, isDefault: e.id === modifierId })))
    }
  }

  // ─── DRINK CRUD CALLBACKS ─────────────────────────────────────

  const handleSaveDrink = async () => {
    if (!selectedDrink) return
    setSavingDrink(true)
    try {
      const price = parseFloat(editingDrinkPrice) || 0
      const hasPourSizes = Object.keys(enabledPourSizes).length > 0
      const pourSizesData = hasPourSizes
        ? { ...enabledPourSizes, ...(hideDefaultOnPos ? { _hideDefaultOnPos: true as const } : {}) }
        : null
      const res = await fetch(`/api/menu/items/${selectedDrink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingDrinkName.trim(),
          price,
          pourSizes: pourSizesData,
          defaultPourSize: hasPourSizes ? defaultPourSize : null,
          applyPourToModifiers,
        }),
      })
      if (res.ok) {
        await loadDrinks()
        setSelectedDrink((prev: any) => prev ? { ...prev, name: editingDrinkName.trim(), price, pourSizes: pourSizesData, defaultPourSize: hasPourSizes ? defaultPourSize : null } : prev)
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
        const defaultPour = bottle?.pourSizeOz ? String(Number(bottle.pourSizeOz)) : '1.5'
        setEditingPourSize(defaultPour)
        loadDrinkRecipe(selectedDrink.id)
        toast.success(`Linked to ${bottle?.name || 'bottle'}`)
      } else {
        toast.error('Failed to link bottle')
      }
    } finally {
      setLinkingBottle(false)
    }
  }

  const handleCreateInlineBottle = async () => {
    if (!inlineBottleName.trim() || !inlineBottleCategoryId || !inlineBottleCost) return
    setCreatingInlineBottle(true)
    try {
      const inlineCat = categories.find(c => c.id === inlineBottleCategoryId)
      const inlineCatType = inlineCat?.categoryType || 'spirit'
      const derivedContainerType = inlineCatType === 'beer' ? 'can' : 'bottle'
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
          containerType: derivedContainerType,
          needsVerification: true,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        const bottleId = result.data?.id
        toast.success(`Created "${inlineBottleName.trim()}" (needs verification)`)
        await loadBottles()
        if (bottleId) {
          await linkDrinkToBottle(bottleId)
        }
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

  // Pour size helpers
  const togglePourSize = (size: string) => {
    if (size === 'standard') return
    const newSizes = { ...enabledPourSizes }
    if (newSizes[size]) {
      delete newSizes[size]
      if (defaultPourSize === size) {
        setDefaultPourSize('standard')
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

  const updatePourSizeCustomPrice = (size: string, customPrice: number | null) => {
    setEnabledPourSizes(prev => ({ ...prev, [size]: { ...prev[size], customPrice } }))
  }

  // Modifier template attach handler
  const handleAttachGroup = async (group: any) => {
    if (!selectedDrink) return
    const res = await fetch(`/api/menu/items/${selectedDrink.id}/modifier-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: group.id, name: group.name }),
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
  }

  // DrinkListPanel callbacks
  const handleDrinkListToggleAvailability = async (drink: any) => {
    await fetch(`/api/menu/items/${drink.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAvailable: !drink.isAvailable }),
    })
    await loadDrinks()
    if (selectedDrink?.id === drink.id) setSelectedDrink(null)
  }

  const handleDrinkListRemove = async (drink: any) => {
    if (!confirm(`Remove "${drink.name}" from the POS?`)) return
    await fetch(`/api/menu/items/${drink.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletedAt: new Date().toISOString() }),
    })
    await loadDrinks()
    if (selectedDrink?.id === drink.id) setSelectedDrink(null)
  }

  // DrinkEditor 86/remove callbacks (operate on selectedDrink)
  const handleEditorToggleAvailability = async () => {
    if (!selectedDrink) return
    const newAvail = !selectedDrink.isAvailable
    await fetch(`/api/menu/items/${selectedDrink.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAvailable: newAvail }),
    })
    await loadDrinks()
    setSelectedDrink((prev: any) => prev ? { ...prev, isAvailable: newAvail } : prev)
  }

  const handleEditorRemoveDrink = async () => {
    if (!selectedDrink) return
    if (!confirm(`Remove "${selectedDrink.name}" from the POS?`)) return
    await fetch(`/api/menu/items/${selectedDrink.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletedAt: new Date().toISOString() }),
    })
    await loadDrinks()
    setSelectedDrink(null)
  }

  // Filter drinks by selected menu category, alphabetized
  const filteredDrinks = (selectedMenuCategoryId
    ? drinks.filter((d: any) => d.categoryId === selectedMenuCategoryId)
    : drinks
  ).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))

  if (!hydrated) return null

  const isEmptySetup = menuCategories.length === 0 && drinks.length === 0

  // ─── RENDER ─────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header -- Row 1: title + back + inventory link */}
      <div className="bg-white border-b shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
          <h1 className="text-base font-bold">🥃 Liquor Builder</h1>
          <div className="flex items-center gap-3">
            <Link href="/liquor-inventory" className="text-xs text-purple-600 hover:underline">Manage Inventory →</Link>
            <Link href="/menu" className="text-xs text-blue-600 hover:underline">← Back to Menu</Link>
          </div>
        </div>
        {/* Row 2: POS category pills */}
        <div className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] uppercase text-gray-900 font-medium shrink-0 mr-1">POS Tabs:</span>
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
        <div className="text-center py-8 text-gray-900">Loading...</div>
      ) : isEmptySetup ? (
        /* Getting Started Guide */
        <div className="max-w-2xl mx-auto p-6">
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-xl font-bold mb-2">Getting Started</h2>
            <p className="text-gray-600 text-sm mb-6">Set up your bar menu in 3 steps:</p>

            <div className="space-y-4">
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

              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">2</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Add Your Bottles</h3>
                  <p className="text-sm text-gray-600">Go to <Link href="/liquor-inventory" className="text-purple-500 underline">Liquor Inventory</Link> to add bottles with cost, size, and tier</p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 opacity-60">
                <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold shrink-0">3</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Create Drink Items</h3>
                  <p className="text-sm text-gray-600">Add drinks, set prices, build recipes, and configure spirit upgrades</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main Interface -- Item-First Layout */
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT: Item List */}
          <DrinkListPanel
            filteredDrinks={filteredDrinks}
            selectedDrink={selectedDrink}
            selectedMenuCategoryId={selectedMenuCategoryId}
            menuCategories={menuCategories}
            onSelectDrink={setSelectedDrink}
            onToggleAvailability={handleDrinkListToggleAvailability}
            onRemoveDrink={handleDrinkListRemove}
            onNewItem={() => {
              setBottleForMenuItem(null)
              setShowCreateMenuItemModal(true)
            }}
            onClearCategoryFilter={() => { setSelectedMenuCategoryId(''); setSelectedDrink(null) }}
          />

          {/* CENTER: Item Editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedDrink ? (
              <DrinkEditor
                selectedDrink={selectedDrink}
                editingDrinkName={editingDrinkName}
                editingDrinkPrice={editingDrinkPrice}
                savingDrink={savingDrink}
                enabledPourSizes={enabledPourSizes}
                defaultPourSize={defaultPourSize}
                applyPourToModifiers={applyPourToModifiers}
                hideDefaultOnPos={hideDefaultOnPos}
                isDualPricingEnabled={isDualPricingEnabled}
                cashDiscountPct={cashDiscountPct}
                spiritEntries={spiritEntries}
                savingSpirit={savingSpirit}
                bottles={bottles}
                categories={categories}
                drinkModifierGroups={drinkModifierGroups}
                modGroupRefreshKey={modGroupRefreshKey}
                selectedModGroupId={selectedModGroupId}
                editingPourSize={editingPourSize}
                savingPourSize={savingPourSize}
                showBottleLinkPicker={showBottleLinkPicker}
                bottleLinkSearch={bottleLinkSearch}
                linkingBottle={linkingBottle}
                expandedPickerCats={expandedPickerCats}
                recipeExpanded={recipeExpanded}
                locationId={employee?.location?.id || ''}
                showInlineBottleForm={showInlineBottleForm}
                inlineBottleName={inlineBottleName}
                inlineBottleBrand={inlineBottleBrand}
                inlineBottleCategoryId={inlineBottleCategoryId}
                inlineBottleTier={inlineBottleTier}
                inlineBottleSizeMl={inlineBottleSizeMl}
                inlineBottleCost={inlineBottleCost}
                creatingInlineBottle={creatingInlineBottle}
                setEditingDrinkName={setEditingDrinkName}
                setEditingDrinkPrice={setEditingDrinkPrice}
                setEnabledPourSizes={setEnabledPourSizes}
                setDefaultPourSize={setDefaultPourSize}
                setApplyPourToModifiers={setApplyPourToModifiers}
                setHideDefaultOnPos={setHideDefaultOnPos}
                setSelectedModGroupId={setSelectedModGroupId}
                setModGroupRefreshKey={setModGroupRefreshKey}
                setEditingPourSize={setEditingPourSize}
                setShowBottleLinkPicker={setShowBottleLinkPicker}
                setBottleLinkSearch={setBottleLinkSearch}
                setExpandedPickerCats={setExpandedPickerCats}
                setRecipeExpanded={setRecipeExpanded}
                setShowInlineBottleForm={setShowInlineBottleForm}
                setInlineBottleName={setInlineBottleName}
                setInlineBottleBrand={setInlineBottleBrand}
                setInlineBottleCategoryId={setInlineBottleCategoryId}
                setInlineBottleTier={setInlineBottleTier}
                setInlineBottleSizeMl={setInlineBottleSizeMl}
                setInlineBottleCost={setInlineBottleCost}
                onSaveDrink={handleSaveDrink}
                onToggleAvailability={handleEditorToggleAvailability}
                onRemoveDrink={handleEditorRemoveDrink}
                onLinkBottle={linkDrinkToBottle}
                onUnlinkBottle={unlinkDrinkFromBottle}
                onSavePourSize={savePourSize}
                onCreateInlineBottle={handleCreateInlineBottle}
                onTogglePourSize={togglePourSize}
                onUpdatePourSizeLabel={updatePourSizeLabel}
                onUpdatePourSizeMultiplier={updatePourSizeMultiplier}
                onUpdatePourSizeCustomPrice={updatePourSizeCustomPrice}
                onAddSpiritBottle={addSpiritBottle}
                onUpdateSpiritEntryPrice={updateSpiritEntryPrice}
                onRemoveSpiritEntry={removeSpiritEntry}
                onSetSpiritEntryDefault={setSpiritEntryDefault}
                reloadDrinkModifiers={reloadDrinkModifiers}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600">
                <p>Select a drink to edit</p>
              </div>
            )}
          </div>

          {/* RIGHT: Modifier Templates */}
          <ModifierTemplatesPanel
            modifierGroups={modifierGroups}
            selectedDrink={selectedDrink}
            drinkModifierGroups={drinkModifierGroups}
            attachingGroupId={attachingGroupId}
            onAttachGroup={handleAttachGroup}
            setAttachingGroupId={setAttachingGroupId}
          />
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
            const containerType = (bottleForMenuItem as any)?.containerType
            let defaultPourSizes = null
            let defaultPourSizeKey = null
            if (containerType === 'can' || containerType === 'bottle') {
              defaultPourSizes = null
            } else if (containerType === 'draft') {
              defaultPourSizes = { pint: { label: 'Pint', multiplier: 1.0 }, half_pint: { label: 'Half Pint', multiplier: 0.5 } }
              defaultPourSizeKey = 'pint'
            } else if (containerType === 'glass') {
              defaultPourSizes = { glass: { label: 'Glass', multiplier: 1.0 }, bottle: { label: 'Bottle', multiplier: 1.0 } }
              defaultPourSizeKey = 'glass'
            } else if (bottleForMenuItem) {
              defaultPourSizes = { shot: { label: 'Shot', multiplier: 1.0 }, double: { label: 'Double', multiplier: 2.0 }, tall: { label: 'Tall', multiplier: 1.5 } }
              defaultPourSizeKey = 'shot'
            }

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

            await Promise.all([loadDrinks(), loadBottles()])

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
              headers: { 'Content-Type': 'application/json', 'x-employee-id': employee?.id || '' },
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
            const res = await fetch(`/api/menu/categories/${editingMenuCategory.id}`, { method: 'DELETE', headers: { 'x-employee-id': employee?.id || '' } })
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
