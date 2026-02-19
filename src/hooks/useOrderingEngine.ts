'use client'

/**
 * useOrderingEngine — Unified ordering coordination hook
 *
 * Eliminates duplicate item-add logic, modifier callback wiring, and
 * compatibility shims across FloorPlanHome, BartenderView, and orders/page.tsx.
 *
 * Composes existing shared hooks (useOrderStore, useActiveOrder, useOrderPanelItems,
 * usePricing) and adds the missing "glue layer" for item selection → modal → store.
 */

import { useCallback, useState, useRef } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'
import type { PizzaOrderConfig } from '@/types'

// ============================================================================
// TYPES
// ============================================================================

/** Menu item shape accepted by the engine (superset of fields used across views) */
export interface EngineMenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  categoryType?: string
  hasModifiers?: boolean
  isPizza?: boolean
  itemType?: string // 'standard' | 'combo' | 'timed_rental' | 'pizza'
  applyPourToModifiers?: boolean
  modifierGroupCount?: number
}

/** Modifier shape returned by ModifierModal and stored on order items */
export interface EngineModifier {
  id: string
  name: string
  price: number
  depth?: number
  preModifier?: string | null
  modifierId?: string | null
  spiritTier?: string | null
  linkedBottleProductId?: string | null
  parentModifierId?: string | null
}

/** Ingredient modification shape */
export interface EngineIngredientMod {
  ingredientId: string
  name: string
  modificationType: string
  priceAdjustment: number
  swappedTo?: { modifierId: string; name: string; price: number }
}

/** What the engine needs the parent to provide for modifier modal integration */
export type OnOpenModifiers = (
  item: EngineMenuItem,
  onComplete: (modifiers: EngineModifier[], ingredientMods?: EngineIngredientMod[]) => void,
  existingModifiers?: EngineModifier[],
  existingIngredientMods?: EngineIngredientMod[]
) => void

/** What the engine needs the parent to provide for pizza builder */
export type OnOpenPizzaBuilder = (
  item: EngineMenuItem,
  onComplete: (config: PizzaOrderConfig) => void
) => void

/** What the engine needs the parent to provide for timed rental rate picker */
export type OnOpenTimedRental = (
  item: EngineMenuItem,
  onComplete: (price: number, blockMinutes: number) => void
) => void

/** Pending item waiting for modal completion */
export interface PendingItem {
  type: 'modifier' | 'pizza' | 'timed_rental'
  menuItem: EngineMenuItem
  existingModifiers?: EngineModifier[]
  existingIngredientMods?: EngineIngredientMod[]
  editingItemId?: string // If editing an existing order item's modifiers
}

/** Options for the ordering engine */
export interface UseOrderingEngineOptions {
  locationId: string
  employeeId?: string

  // View-specific context
  seatNumber?: number
  sourceTableId?: string
  defaultOrderType?: string
  tableId?: string
  guestCount?: number

  // Modal callbacks (provided by parent page that renders the modals)
  onOpenModifiers?: OnOpenModifiers
  onOpenPizzaBuilder?: OnOpenPizzaBuilder
  onOpenTimedRental?: OnOpenTimedRental
}

// ============================================================================
// HOOK
// ============================================================================

export function useOrderingEngine(options: UseOrderingEngineOptions) {
  const {
    locationId,
    seatNumber,
    sourceTableId,
    defaultOrderType = 'dine_in',
    tableId,
    guestCount,
    onOpenModifiers,
    onOpenPizzaBuilder,
    onOpenTimedRental,
  } = options

  // Use refs for values that change frequently to avoid stale closures
  const seatNumberRef = useRef(seatNumber)
  seatNumberRef.current = seatNumber
  const sourceTableIdRef = useRef(sourceTableId)
  sourceTableIdRef.current = sourceTableId
  const tableIdRef = useRef(tableId)
  tableIdRef.current = tableId
  const guestCountRef = useRef(guestCount)
  guestCountRef.current = guestCount
  const defaultOrderTypeRef = useRef(defaultOrderType)
  defaultOrderTypeRef.current = defaultOrderType

  // Pending item state for modal coordination
  const [pendingItem, setPendingItem] = useState<PendingItem | null>(null)

  // Quantity multiplier — defaults to 1, auto-resets after each item add
  const [quantityMultiplier, setQuantityMultiplier] = useState(1)
  const quantityMultiplierRef = useRef(1)
  quantityMultiplierRef.current = quantityMultiplier

  /** Reset multiplier back to 1 */
  const resetQuantity = useCallback(() => {
    setQuantityMultiplier(1)
  }, [])

  /**
   * Ensure an order exists in the store before adding items.
   */
  const ensureOrder = useCallback(() => {
    const store = useOrderStore.getState()
    if (!store.currentOrder) {
      store.startOrder(defaultOrderTypeRef.current, {
        locationId,
        tableId: tableIdRef.current || undefined,
        guestCount: guestCountRef.current || 1,
      })
    }
  }, [locationId])

  /**
   * Add an item directly to the store (bypasses modal).
   * Used for simple items without modifiers, spirit tier quick-select, pour sizes, etc.
   */
  const addItemDirectly = useCallback((item: {
    menuItemId: string
    name: string
    price: number
    quantity?: number
    modifiers?: EngineModifier[]
    ingredientModifications?: EngineIngredientMod[]
    categoryType?: string
    blockTimeMinutes?: number
    blockTimeStartedAt?: string
    blockTimeExpiresAt?: string
  }) => {
    ensureOrder()
    const store = useOrderStore.getState()
    store.addItem({
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      modifiers: (item.modifiers || []).map(m => ({
        id: m.id || m.modifierId || '',
        modifierId: m.modifierId || m.id,
        name: m.name,
        price: Number(m.price),
        depth: m.depth ?? 0,
        preModifier: m.preModifier ?? null,
        spiritTier: m.spiritTier ?? null,
        linkedBottleProductId: m.linkedBottleProductId ?? null,
        parentModifierId: m.parentModifierId ?? null,
      })),
      ingredientModifications: item.ingredientModifications?.map(mod => ({
        ingredientId: mod.ingredientId,
        name: mod.name,
        modificationType: mod.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
        priceAdjustment: mod.priceAdjustment,
        swappedTo: mod.swappedTo,
      })),
      seatNumber: seatNumberRef.current || undefined,
      sourceTableId: sourceTableIdRef.current || undefined,
      sentToKitchen: false,
      categoryType: item.categoryType,
      blockTimeMinutes: item.blockTimeMinutes ?? null,
      blockTimeStartedAt: item.blockTimeStartedAt ?? null,
      blockTimeExpiresAt: item.blockTimeExpiresAt ?? null,
    })

    // Haptic feedback
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10)
    }

    // Auto-reset quantity multiplier after adding an item
    if (quantityMultiplierRef.current > 1) {
      setQuantityMultiplier(1)
    }
  }, [ensureOrder])

  /**
   * Handle modifier modal completion — adds item to store with selected modifiers.
   */
  const handleModifiersComplete = useCallback((
    modifiers: EngineModifier[],
    ingredientMods?: EngineIngredientMod[]
  ) => {
    const pending = pendingItem
    if (!pending || pending.type !== 'modifier') return

    if (pending.editingItemId) {
      // Editing existing item's modifiers
      const store = useOrderStore.getState()
      store.updateItem(pending.editingItemId, {
        modifiers: modifiers.map(m => ({
          id: m.id || m.modifierId || '',
          modifierId: m.modifierId || m.id,
          name: m.name,
          price: Number(m.price),
          depth: m.depth ?? 0,
          preModifier: m.preModifier ?? null,
          spiritTier: m.spiritTier ?? null,
          linkedBottleProductId: m.linkedBottleProductId ?? null,
          parentModifierId: m.parentModifierId ?? null,
        })),
        ingredientModifications: ingredientMods?.map(mod => ({
          ingredientId: mod.ingredientId,
          name: mod.name,
          modificationType: mod.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
          priceAdjustment: mod.priceAdjustment,
          swappedTo: mod.swappedTo,
        })),
      })
    } else {
      // Adding new item with modifiers
      addItemDirectly({
        menuItemId: pending.menuItem.id,
        name: pending.menuItem.name,
        price: pending.menuItem.price,
        modifiers,
        ingredientModifications: ingredientMods,
        categoryType: pending.menuItem.categoryType,
      })
    }

    setPendingItem(null)
  }, [pendingItem, addItemDirectly])

  /**
   * Handle pizza builder completion — adds pizza item to store.
   */
  const handlePizzaComplete = useCallback((config: PizzaOrderConfig) => {
    const pending = pendingItem
    if (!pending || pending.type !== 'pizza') return

    // Build modifiers from pizza config
    const pizzaModifiers: EngineModifier[] = []
    pizzaModifiers.push({ id: config.sizeId, name: 'Size', price: config.priceBreakdown.sizePrice })
    pizzaModifiers.push({ id: config.crustId, name: 'Crust', price: config.priceBreakdown.crustPrice })

    if (config.sauces && config.sauces.length > 0) {
      config.sauces.forEach(s => {
        pizzaModifiers.push({ id: s.sauceId, name: `${s.name} (${s.amount})`, price: s.price || 0 })
      })
    } else if (config.sauceId) {
      pizzaModifiers.push({ id: config.sauceId, name: `Sauce (${config.sauceAmount})`, price: config.priceBreakdown.saucePrice })
    }

    if (config.cheeses && config.cheeses.length > 0) {
      config.cheeses.forEach(c => {
        pizzaModifiers.push({ id: c.cheeseId, name: `${c.name} (${c.amount})`, price: c.price || 0 })
      })
    } else if (config.cheeseId) {
      pizzaModifiers.push({ id: config.cheeseId, name: `Cheese (${config.cheeseAmount})`, price: config.priceBreakdown.cheesePrice })
    }

    config.toppings.forEach(t => {
      const sectionStr = t.sections ? `sections: ${t.sections.length}` : ''
      pizzaModifiers.push({ id: t.toppingId, name: `${t.name}${sectionStr ? ` (${sectionStr})` : ''}`, price: t.price })
    })

    addItemDirectly({
      menuItemId: pending.menuItem.id,
      name: pending.menuItem.name,
      price: config.totalPrice,
      modifiers: pizzaModifiers,
      categoryType: pending.menuItem.categoryType,
    })

    setPendingItem(null)
  }, [pendingItem, addItemDirectly])

  /**
   * Handle timed rental rate selection — adds entertainment item to store.
   */
  const handleTimedRentalComplete = useCallback((price: number, blockMinutes: number) => {
    const pending = pendingItem
    if (!pending || pending.type !== 'timed_rental') return

    addItemDirectly({
      menuItemId: pending.menuItem.id,
      name: pending.menuItem.name,
      price,
      categoryType: pending.menuItem.categoryType,
      blockTimeMinutes: blockMinutes,
    })

    setPendingItem(null)
  }, [pendingItem, addItemDirectly])

  /**
   * Unified menu item tap handler.
   *
   * Checks item type (timed rental, pizza, regular), checks for default modifiers,
   * and either adds directly or triggers a modal via pendingItem / onOpen* callbacks.
   */
  const handleMenuItemTap = useCallback(async (item: EngineMenuItem) => {
    // Block adding items to a split parent — must select a split first
    const currentStatus = useOrderStore.getState().currentOrder?.status
    if (currentStatus === 'split') {
      toast.warning('Select a split check or add a new one')
      return
    }

    // 1. Timed rental → open rate picker
    if (item.itemType === 'timed_rental') {
      if (onOpenTimedRental) {
        setPendingItem({ type: 'timed_rental', menuItem: item })
        onOpenTimedRental(item, (price: number, blockMinutes: number) => {
          // Called by the modal — add to store
          ensureOrder()
          const store = useOrderStore.getState()
          store.addItem({
            menuItemId: item.id,
            name: item.name,
            price,
            quantity: 1,
            modifiers: [],
            seatNumber: seatNumberRef.current || undefined,
            sourceTableId: sourceTableIdRef.current || undefined,
            sentToKitchen: false,
            categoryType: item.categoryType,
            blockTimeMinutes: blockMinutes,
            blockTimeStartedAt: null,
            blockTimeExpiresAt: null,
          })
          setPendingItem(null)
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10)
        })
      }
      return
    }

    // 2. Pizza → open pizza builder
    if (item.isPizza) {
      if (onOpenPizzaBuilder) {
        setPendingItem({ type: 'pizza', menuItem: item })
        onOpenPizzaBuilder(item, (config: PizzaOrderConfig) => {
          // Build modifiers from pizza config
          const pizzaModifiers: EngineModifier[] = []
          pizzaModifiers.push({ id: config.sizeId, name: 'Size', price: config.priceBreakdown.sizePrice })
          pizzaModifiers.push({ id: config.crustId, name: 'Crust', price: config.priceBreakdown.crustPrice })

          if (config.sauces && config.sauces.length > 0) {
            config.sauces.forEach(s => {
              pizzaModifiers.push({ id: s.sauceId, name: `${s.name} (${s.amount})`, price: s.price || 0 })
            })
          } else if (config.sauceId) {
            pizzaModifiers.push({ id: config.sauceId, name: `Sauce (${config.sauceAmount})`, price: config.priceBreakdown.saucePrice })
          }

          if (config.cheeses && config.cheeses.length > 0) {
            config.cheeses.forEach(c => {
              pizzaModifiers.push({ id: c.cheeseId, name: `${c.name} (${c.amount})`, price: c.price || 0 })
            })
          } else if (config.cheeseId) {
            pizzaModifiers.push({ id: config.cheeseId, name: `Cheese (${config.cheeseAmount})`, price: config.priceBreakdown.cheesePrice })
          }

          config.toppings.forEach(t => {
            const sectionStr = t.sections ? `sections: ${t.sections.length}` : ''
            pizzaModifiers.push({ id: t.toppingId, name: `${t.name}${sectionStr ? ` (${sectionStr})` : ''}`, price: t.price })
          })

          ensureOrder()
          const store = useOrderStore.getState()
          store.addItem({
            menuItemId: item.id,
            name: item.name,
            price: config.totalPrice,
            quantity: 1,
            modifiers: pizzaModifiers.map(m => ({
              id: m.id, name: m.name, price: m.price, depth: 0,
              preModifier: null, spiritTier: null, linkedBottleProductId: null, parentModifierId: null,
            })),
            seatNumber: seatNumberRef.current || undefined,
            sourceTableId: sourceTableIdRef.current || undefined,
            sentToKitchen: false,
            categoryType: item.categoryType,
          })
          setPendingItem(null)
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10)
        })
      }
      return
    }

    // 3. Item with modifiers → check defaults, possibly open modal
    if (item.hasModifiers && onOpenModifiers) {
      // Try auto-fill with defaults first
      try {
        const res = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
        if (res.ok) {
          const { data: groups } = await res.json()
          if (groups && groups.length > 0) {
            const defaultMods: EngineModifier[] = []
            let allRequiredSatisfied = true

            for (const group of groups) {
              const defaults = (group.modifiers || []).filter((m: { isDefault?: boolean }) => m.isDefault)
              defaults.forEach((m: { id: string; name: string; price?: number }) => {
                defaultMods.push({ id: m.id, name: m.name, price: Number(m.price || 0), depth: 0 })
              })
              if (group.isRequired && group.minSelections > 0 && defaults.length < group.minSelections) {
                allRequiredSatisfied = false
              }
            }

            // Defaults satisfy all requirements → add directly, skip modal
            if (allRequiredSatisfied && defaultMods.length > 0) {
              addItemDirectly({
                menuItemId: item.id,
                name: item.name,
                price: item.price,
                quantity: quantityMultiplierRef.current,
                modifiers: defaultMods,
                categoryType: item.categoryType,
              })
              return
            }
          }
        }
      } catch (e) {
        console.error('Failed to check modifier defaults:', e)
      }

      // Defaults don't cover requirements → open modifier modal
      // Capture the multiplier now since it resets after add
      const qtyForModifiers = quantityMultiplierRef.current
      setPendingItem({ type: 'modifier', menuItem: item })
      onOpenModifiers(item, (modifiers, ingredientMods) => {
        addItemDirectly({
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: qtyForModifiers,
          modifiers,
          ingredientModifications: ingredientMods,
          categoryType: item.categoryType,
        })
        setPendingItem(null)
      })
      return
    }

    // 4. Simple item → add directly (with quantity multiplier)
    addItemDirectly({
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: quantityMultiplierRef.current,
      categoryType: item.categoryType,
    })
  }, [onOpenModifiers, onOpenPizzaBuilder, onOpenTimedRental, addItemDirectly, ensureOrder])

  /**
   * Open modifier modal for editing an existing order item's modifiers.
   */
  const handleEditItemModifiers = useCallback((
    itemId: string,
    menuItem: EngineMenuItem,
    existingModifiers?: EngineModifier[],
    existingIngredientMods?: EngineIngredientMod[]
  ) => {
    if (!onOpenModifiers) return

    setPendingItem({
      type: 'modifier',
      menuItem,
      existingModifiers,
      existingIngredientMods,
      editingItemId: itemId,
    })

    onOpenModifiers(menuItem, (newModifiers, ingredientMods) => {
      // Update the existing item's modifiers in the store
      const store = useOrderStore.getState()
      store.updateItem(itemId, {
        modifiers: newModifiers.map(m => ({
          id: m.id || m.modifierId || '',
          modifierId: m.modifierId || m.id,
          name: m.name,
          price: Number(m.price),
          depth: m.depth ?? 0,
          preModifier: m.preModifier ?? null,
          spiritTier: m.spiritTier ?? null,
          linkedBottleProductId: m.linkedBottleProductId ?? null,
          parentModifierId: m.parentModifierId ?? null,
        })),
        ingredientModifications: ingredientMods?.map(mod => ({
          ingredientId: mod.ingredientId,
          name: mod.name,
          modificationType: mod.modificationType as 'no' | 'lite' | 'on_side' | 'extra' | 'swap',
          priceAdjustment: mod.priceAdjustment,
          swappedTo: mod.swappedTo,
        })),
      })
      setPendingItem(null)
    }, existingModifiers, existingIngredientMods)
  }, [onOpenModifiers])

  /**
   * Simple edit handler — just needs an item ID.
   * Pulls all data from the store so views don't need to construct EngineMenuItem.
   */
  const handleEditItem = useCallback((itemId: string) => {
    const storeItem = useOrderStore.getState().currentOrder?.items.find(i => i.id === itemId)
    if (!storeItem) return
    const engineItem: EngineMenuItem = {
      id: storeItem.menuItemId,
      name: storeItem.name,
      price: storeItem.price,
      categoryId: '',
      categoryType: storeItem.categoryType,
      hasModifiers: true,
    }
    handleEditItemModifiers(
      itemId,
      engineItem,
      (storeItem.modifiers || []) as EngineModifier[],
      (storeItem.ingredientModifications || []) as EngineIngredientMod[],
    )
  }, [handleEditItemModifiers])

  /**
   * Cancel pending modal (e.g., user closes modifier modal without selecting).
   */
  const cancelPending = useCallback(() => {
    setPendingItem(null)
  }, [])

  return {
    // Item selection
    handleMenuItemTap,
    addItemDirectly,

    // Quantity multiplier
    quantityMultiplier,
    setQuantityMultiplier,
    resetQuantity,

    // Modal coordination
    pendingItem,
    handleModifiersComplete,
    handlePizzaComplete,
    handleTimedRentalComplete,
    handleEditItemModifiers,
    handleEditItem,
    cancelPending,

    // Store access
    ensureOrder,
  }
}
