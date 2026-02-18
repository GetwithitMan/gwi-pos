'use client'

import { useState, useCallback } from 'react'
import { useOrderStore } from '@/stores/order-store'
import type { OrderPanelItemData } from '@/components/orders/OrderPanelItem'
import type { useOrderingEngine } from '@/hooks/useOrderingEngine'
import type { useActiveOrder } from '@/hooks/useActiveOrder'

interface CompVoidItem {
  id: string
  name: string
  price: number
  quantity: number
  modifiers: {
    id: string
    modifierId?: string
    name: string
    price: number
    depth?: number
    preModifier?: string | null
    spiritTier?: string | null
    linkedBottleProductId?: string | null
    parentModifierId?: string | null
  }[]
  status?: string
}

interface UseOrderPanelCallbacksOptions {
  engine: ReturnType<typeof useOrderingEngine>
  activeOrder: ReturnType<typeof useActiveOrder>
  onOpenCompVoid: (item: CompVoidItem) => void
  onOpenResend?: (itemId: string, itemName: string) => void
  onOpenSplit?: (itemId: string) => void
}

/**
 * Unified OrderPanel callbacks — one hook, one source of truth.
 * All callbacks read from Zustand store at call time (never stale).
 */
export function useOrderPanelCallbacks({
  engine,
  activeOrder,
  onOpenCompVoid,
  onOpenResend,
  onOpenSplit,
}: UseOrderPanelCallbacksOptions) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  const onItemClick = useCallback((item: OrderPanelItemData) => {
    const storeItem = useOrderStore.getState().currentOrder?.items.find(i => i.id === item.id)
    if (storeItem?.sentToKitchen) return
    engine.handleEditItem(item.id)
  }, [engine])

  const onItemRemove = useCallback((itemId: string) => {
    // Delete from DB + local state (not just local)
    activeOrder.handleRemoveItem(itemId)
  }, [activeOrder])

  const onQuantityChange = useCallback((itemId: string, delta: number) => {
    const store = useOrderStore.getState()
    const item = store.currentOrder?.items.find(i => i.id === itemId)
    if (!item) return
    const newQty = item.quantity + delta
    if (newQty <= 0) {
      // Delete from DB + local state (not just local)
      activeOrder.handleRemoveItem(itemId)
    } else {
      store.updateItem(itemId, { quantity: newQty })
    }
  }, [activeOrder])

  const onItemHoldToggle = useCallback((itemId: string) => {
    const store = useOrderStore.getState()
    const item = store.currentOrder?.items.find(i => i.id === itemId)
    if (!item) return
    const newHeld = !item.isHeld
    store.updateItem(itemId, {
      isHeld: newHeld,
      // Hold and delay are mutually exclusive
      ...(newHeld ? { delayMinutes: null, delayStartedAt: null, delayFiredAt: null } : {}),
    })
  }, [])

  const onItemNoteEdit = useCallback((itemId: string, currentNote?: string) => {
    activeOrder.openNoteEditor(itemId, currentNote)
  }, [activeOrder.openNoteEditor])

  const onItemCourseChange = useCallback((itemId: string, course: number | null) => {
    useOrderStore.getState().updateItem(itemId, { courseNumber: course ?? undefined })
  }, [])

  const onItemEditModifiers = useCallback((itemId: string) => {
    engine.handleEditItem(itemId)
  }, [engine])

  const onItemCompVoid = useCallback((item: OrderPanelItemData) => {
    onOpenCompVoid({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      quantity: item.quantity,
      modifiers: (item.modifiers || []).map(m => ({
        id: m.id,
        modifierId: m.modifierId ?? undefined,
        name: m.name,
        price: Number(m.price),
        depth: m.depth ?? 0,
        preModifier: m.preModifier ?? null,
        spiritTier: m.spiritTier ?? null,
        linkedBottleProductId: m.linkedBottleProductId ?? null,
        parentModifierId: m.parentModifierId ?? null,
      })),
    })
  }, [onOpenCompVoid])

  const onItemResend = useCallback((item: OrderPanelItemData) => {
    if (onOpenResend) {
      onOpenResend(item.id, item.name)
    } else {
      // Fallback: simple resend without modal
      const store = useOrderStore.getState()
      store.updateItem(item.id, { resendCount: (item.resendCount || 0) + 1 })
    }
  }, [onOpenResend])

  const onItemSplit = useCallback((itemId: string) => {
    onOpenSplit?.(itemId)
  }, [onOpenSplit])

  const onItemSeatChange = useCallback((itemId: string, seat: number | null) => {
    useOrderStore.getState().updateItem(itemId, { seatNumber: seat ?? undefined })
  }, [])

  const onItemToggleExpand = useCallback((id: string) => {
    setExpandedItemId(prev => prev === id ? null : id)
  }, [])

  return {
    expandedItemId,
    onItemClick,
    onItemRemove,
    onQuantityChange,
    onItemHoldToggle,
    onItemNoteEdit,
    onItemCourseChange,
    onItemEditModifiers,
    onItemCompVoid,
    onItemResend,
    onItemSplit,
    onItemSeatChange,
    onItemToggleExpand,
  }
}
