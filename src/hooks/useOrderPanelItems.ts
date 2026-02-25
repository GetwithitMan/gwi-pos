import { useMemo } from 'react'
import { useOrderStore } from '@/stores/order-store'
import type { OrderPanelItemData } from '@/components/orders/OrderPanelItem'

/**
 * Single source of truth for mapping Zustand order store items → OrderPanelItemData[].
 * All views (FloorPlanHome, BartenderView, orders/page) use this instead of their own mappings.
 *
 * @param menuItems - Optional menu items array for timed rental detection
 */
export function useOrderPanelItems(menuItems?: { id: string; itemType?: string }[]): OrderPanelItemData[] {
  const items = useOrderStore(state => state.currentOrder?.items)

  return useMemo(() => {
    if (!items) return []

    return items.map(item => {
      const menuItemInfo = menuItems?.find(m => m.id === item.menuItemId)
      const isTimedRental = menuItemInfo?.itemType === 'timed_rental'

      const kitchenStatus: OrderPanelItemData['kitchenStatus'] = item.isCompleted
        ? 'ready'
        : item.sentToKitchen
        ? 'sent'
        : 'pending'

      return {
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        modifiers: item.modifiers?.map(m => ({
          id: (m.id || m.modifierId) ?? '',
          modifierId: m.modifierId,
          name: m.name,
          price: Number(m.price),
          depth: m.depth ?? 0,
          preModifier: m.preModifier ?? null,
          spiritTier: m.spiritTier ?? null,
          linkedBottleProductId: m.linkedBottleProductId ?? null,
          parentModifierId: m.parentModifierId ?? null,
        })) || [],
        ingredientModifications: item.ingredientModifications,
        specialNotes: item.specialNotes,
        kitchenStatus,
        isHeld: item.isHeld,
        isCompleted: item.isCompleted,
        isTimedRental,
        menuItemId: item.menuItemId,
        blockTimeMinutes: item.blockTimeMinutes ?? undefined,
        blockTimeStartedAt: item.blockTimeStartedAt ?? undefined,
        blockTimeExpiresAt: item.blockTimeExpiresAt ?? undefined,
        seatNumber: item.seatNumber,
        courseNumber: item.courseNumber,
        courseStatus: item.courseStatus,
        status: item.status,
        voidReason: item.voidReason,
        wasMade: item.wasMade,
        sentToKitchen: item.sentToKitchen,
        resendCount: item.resendCount,
        completedAt: item.completedAt,
        createdAt: (item as unknown as Record<string, unknown>).createdAt as string | undefined,
        delayMinutes: item.delayMinutes,
        delayStartedAt: item.delayStartedAt,
        delayFiredAt: item.delayFiredAt,
        itemDiscounts: item.itemDiscounts,
        itemTotal: item.itemTotal,
      }
    })
  }, [items, menuItems])
}
