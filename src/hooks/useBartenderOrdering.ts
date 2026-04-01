'use client'

import { useCallback, useRef, useState, useMemo } from 'react'
import { toast } from '@/stores/toast-store'
import { useOrderStore } from '@/stores/order-store'
import { useOrderingEngine } from '@/hooks/useOrderingEngine'
import { isTempId } from '@/lib/order-utils'
import type { EngineMenuItem, EnginePricingOption } from '@/hooks/useOrderingEngine'
import type { FavoriteItemData } from '@/components/bartender/FavoriteItem'
import type { BartenderMenuItem, SpiritOption, SpiritTiers } from '@/components/bartender/bartender-settings'

// ============================================================================
// TYPES
// ============================================================================

type MenuItem = BartenderMenuItem

// Pour size display config
const POUR_SIZE_CONFIG: Record<string, { label: string; short: string; color: string }> = {
  shot: { label: 'Shot', short: '1x', color: 'bg-teal-700' },
  double: { label: 'Dbl', short: '2x', color: 'bg-teal-600' },
  tall: { label: 'Tall', short: '1.5x', color: 'bg-teal-500' },
  short: { label: 'Shrt', short: '.75x', color: 'bg-teal-800' },
}

interface UseBartenderOrderingOptions {
  locationId: string
  employeeId: string
  selectedTabId: string | null
  selectedTabIdRef: React.RefObject<string | null>
  onOpenModifiers?: (
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientModifications?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void,
    existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[],
    existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
  ) => void
  onOpenComboBuilder?: (item: MenuItem, onComplete: (modifiers: { id: string; name: string; price: number; depth?: number }[]) => void) => void
  onSelectedTabChange?: (tabId: string | null) => void
  loadedTabIdRef: React.MutableRefObject<string | null>
  onTabRefresh: () => void
}

// ============================================================================
// HOOK
// ============================================================================

export function useBartenderOrdering({
  locationId,
  employeeId,
  selectedTabId,
  selectedTabIdRef,
  onOpenModifiers,
  onOpenComboBuilder,
  onSelectedTabChange,
  loadedTabIdRef,
  onTabRefresh,
}: UseBartenderOrderingOptions) {
  // Pricing option picker state
  const [pricingPickerItem, setPricingPickerItem] = useState<MenuItem | null>(null)
  const pricingPickerCallbackRef = useRef<((option: EnginePricingOption) => void) | null>(null)

  // Spirit tier popup state
  const [spiritPopupItem, setSpiritPopupItem] = useState<MenuItem | null>(null)
  const [selectedSpiritTier, setSelectedSpiritTier] = useState<string | null>(null)

  // Ordering engine
  const engine = useOrderingEngine({
    locationId,
    employeeId,
    defaultOrderType: 'bar_tab',
    onOpenModifiers: onOpenModifiers as ((
      item: EngineMenuItem,
      onComplete: (modifiers: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[], ingredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]) => void,
      existingModifiers?: { id: string; name: string; price: number; depth?: number; preModifier?: string | null }[],
      existingIngredientMods?: { ingredientId: string; name: string; modificationType: string; priceAdjustment: number; swappedTo?: { modifierId: string; name: string; price: number } }[]
    ) => void) | undefined,
    onOpenPricingOptionPicker: (item, onComplete) => {
      pricingPickerCallbackRef.current = onComplete
      setPricingPickerItem(item as unknown as MenuItem)
    },
    onOpenComboBuilder: onOpenComboBuilder as any,
  })

  // ---------------------------------------------------------------------------
  // ITEM TAP HANDLERS
  // ---------------------------------------------------------------------------

  const handleMenuItemTap = useCallback((item: MenuItem) => {
    const engineItem: EngineMenuItem = {
      id: item.id,
      name: item.name,
      price: item.price,
      categoryId: item.categoryId,
      categoryType: item.categoryType,
      hasModifiers: item.hasModifiers,
      itemType: item.itemType,
    }
    engine.handleMenuItemTap(engineItem)
  }, [engine])

  const handleFavoriteTap = useCallback((fav: FavoriteItemData) => {
    const engineItem: EngineMenuItem = {
      id: fav.menuItemId,
      name: fav.name,
      price: fav.price,
      categoryId: '',
      hasModifiers: fav.hasModifiers,
    }
    engine.handleMenuItemTap(engineItem)
  }, [engine])

  // ---------------------------------------------------------------------------
  // SPIRIT TIER HANDLERS
  // ---------------------------------------------------------------------------

  const handleSpiritTierClick = useCallback((item: MenuItem, tier: string) => {
    const tierOptions = item.spiritTiers?.[tier as keyof SpiritTiers]
    if (!tierOptions || tierOptions.length === 0) return

    if (tierOptions.length === 1) {
      const spirit = tierOptions[0]
      engine.addItemDirectly({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        modifiers: [{
          id: spirit.id,
          name: spirit.name,
          price: spirit.price,
          spiritTier: spirit.spiritTier || tier,
          linkedBottleProductId: spirit.linkedBottleProductId || null,
        }],
      })
      return
    }

    setSpiritPopupItem(item)
    setSelectedSpiritTier(tier)
  }, [engine])

  const handleSpiritSelect = useCallback((spirit: SpiritOption) => {
    if (!spiritPopupItem) return

    engine.addItemDirectly({
      menuItemId: spiritPopupItem.id,
      name: spiritPopupItem.name,
      price: spiritPopupItem.price,
      modifiers: [{
        id: spirit.id,
        name: spirit.name,
        price: spirit.price,
        spiritTier: spirit.spiritTier || selectedSpiritTier || null,
        linkedBottleProductId: spirit.linkedBottleProductId || null,
      }],
    })

    setSpiritPopupItem(null)
    setSelectedSpiritTier(null)
  }, [spiritPopupItem, selectedSpiritTier, engine])

  const handleCloseSpiritPopup = useCallback(() => {
    setSpiritPopupItem(null)
    setSelectedSpiritTier(null)
  }, [])

  // ---------------------------------------------------------------------------
  // PRICING OPTION HANDLERS
  // ---------------------------------------------------------------------------

  const handlePricingOptionClick = useCallback((item: MenuItem, option: { id: string; label: string; price: number | null; color: string | null }) => {
    const isVariant = option.price !== null
    const itemName = isVariant ? `${item.name} (${option.label})` : item.name
    const itemPrice = isVariant ? option.price! : item.price
    const pricingOptionLabel = isVariant ? undefined : option.label

    if (item.hasModifiers || item.hasOtherModifiers) {
      engine.handleMenuItemTap({
        id: item.id,
        name: itemName,
        price: itemPrice,
        categoryId: item.categoryId,
        hasModifiers: item.hasModifiers,
        hasPricingOptions: false,
      } as EngineMenuItem)
    } else {
      engine.addItemDirectly({
        menuItemId: item.id,
        name: itemName,
        price: itemPrice,
        pricingOptionId: option.id,
        pricingOptionLabel,
      })
    }
  }, [engine])

  const handlePricingPickerSelect = useCallback((option: EnginePricingOption) => {
    pricingPickerCallbackRef.current?.(option)
    setPricingPickerItem(null)
    pricingPickerCallbackRef.current = null
  }, [])

  const handlePricingPickerClose = useCallback(() => {
    setPricingPickerItem(null)
    pricingPickerCallbackRef.current = null
  }, [])

  // ---------------------------------------------------------------------------
  // POUR SIZE HANDLER
  // ---------------------------------------------------------------------------

  const handlePourSizeClick = useCallback((item: MenuItem, _size: string, pourPrice: number) => {
    const config = POUR_SIZE_CONFIG[_size]
    if (!config) return
    const pourConfig = item.pourSizes?.[_size]
    const multiplier = typeof pourConfig === 'number'
      ? pourConfig
      : (pourConfig as any)?.multiplier ?? 1.0
    engine.addItemDirectly({
      menuItemId: item.id,
      name: `${item.name} (${config.label})`,
      price: pourPrice,
      pourSize: _size,
      pourMultiplier: multiplier,
    })
  }, [engine])

  // ---------------------------------------------------------------------------
  // HOT MODIFIER HANDLER
  // ---------------------------------------------------------------------------

  const handleHotModifierClick = useCallback((item: MenuItem, mod: { id: string; name: string; price: number }) => {
    engine.addItemDirectly({
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      modifiers: [{ id: mod.id, name: mod.name, price: mod.price }],
    })
  }, [engine])

  // ---------------------------------------------------------------------------
  // SEND ITEMS TO TAB
  // ---------------------------------------------------------------------------

  const sendInProgressRef = useRef(false)

  const sendItemsToTab = useCallback(async (orderId: string) => {
    if (sendInProgressRef.current) {
      toast.warning('Already sending')
      return
    }
    sendInProgressRef.current = true

    const freshItems = useOrderStore.getState().currentOrder?.items || []
    const unsavedItems = freshItems.filter(i => !i.sentToKitchen)
    if (unsavedItems.length === 0) {
      sendInProgressRef.current = false
      return
    }

    const itemsToCreate = unsavedItems.filter(i => isTempId(i.id))
    const itemsPayload = itemsToCreate.map(item => ({
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      correlationId: item.id,
      modifiers: item.modifiers?.map(m => ({
        modifierId: m.id,
        name: m.name,
        price: m.price,
      })) || [],
      pricingOptionId: item.pricingOptionId || null,
      pricingOptionLabel: item.pricingOptionLabel || null,
    }))

    toast.success('Order sent')
    useOrderStore.getState().clearOrder()

    const tabIdForReload = orderId
    void (async () => {
      try {
        if (itemsPayload.length > 0) {
          const appendRes = await fetch(`/api/orders/${orderId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsPayload }),
          })

          if (!appendRes.ok) {
            const errorData = await appendRes.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to add items')
          }
        }

        const sendRes = await fetch(`/api/orders/${orderId}/send`, { method: 'POST' })
        if (!sendRes.ok) {
          console.error('[BartenderView] Send to kitchen error:', await sendRes.json().catch(() => ({})))
        }
      } catch (error) {
        console.error('[BartenderView] Background send failed:', error)
        toast.error('Send failed — items may not have reached kitchen')
      } finally {
        sendInProgressRef.current = false
        onTabRefresh()
        if (selectedTabIdRef.current === tabIdForReload) {
          const freshStore = useOrderStore.getState()
          const hasNewUnsent = (freshStore.currentOrder?.items || []).some(i => !i.sentToKitchen)
          if (!hasNewUnsent) {
            try {
              const res = await fetch(`/api/orders/${tabIdForReload}?locationId=${locationId}`)
              if (res.ok) {
                const data = await res.json()
                const order = data.data || data
                useOrderStore.getState().loadOrder({
                  id: order.id,
                  orderNumber: order.orderNumber,
                  orderType: order.orderType || 'bar_tab',
                  tableId: order.tableId || undefined,
                  tableName: order.tableName || order.table?.name || undefined,
                  tabName: order.tabName || undefined,
                  guestCount: order.guestCount || 1,
                  status: order.status || 'open',
                  items: order.items || [],
                  subtotal: Number(order.subtotal) || 0,
                  discountTotal: Number(order.discountTotal) || 0,
                  taxTotal: Number(order.taxTotal) || 0,
                  tipTotal: Number(order.tipTotal) || 0,
                  total: Number(order.total) || 0,
                })
                loadedTabIdRef.current = tabIdForReload
              }
            } catch (reloadErr) {
              console.error('[BartenderView] Failed to reload tab after send:', reloadErr)
            }
          }
        }
      }
    })()
  }, [locationId, selectedTabIdRef, loadedTabIdRef, onTabRefresh])

  return {
    // Engine
    engine,
    // Menu item handlers
    handleMenuItemTap,
    handleFavoriteTap,
    // Spirit handlers
    handleSpiritTierClick,
    handleSpiritSelect,
    handleCloseSpiritPopup,
    spiritPopupItem,
    selectedSpiritTier,
    // Pricing option handlers
    handlePricingOptionClick,
    handlePricingPickerSelect,
    handlePricingPickerClose,
    pricingPickerItem,
    // Pour/modifier handlers
    handlePourSizeClick,
    handleHotModifierClick,
    // Send
    sendItemsToTab,
  }
}
