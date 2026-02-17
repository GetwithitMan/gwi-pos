import { useOrderStore } from '@/stores/order-store'

/**
 * Fetch a split order from the API and load it into the Zustand store.
 * Used by both FloorPlanHome and orders/page when opening a child split for editing.
 */
export async function fetchAndLoadSplitOrder(
  splitId: string,
  tableId?: string
): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${splitId}?view=split`)
    if (!res.ok) return false
    const json = await res.json()
    const d = json.data ?? json
    useOrderStore.getState().loadOrder({
      id: splitId,
      orderNumber: d.orderNumber,
      orderType: d.orderType || 'dine_in',
      tableId: d.tableId || tableId || '',
      tabName: d.tabName,
      guestCount: d.guestCount || 1,
      items: d.items || [],
      subtotal: Number(d.subtotal ?? 0),
      taxTotal: Number(d.taxTotal ?? 0),
      tipTotal: Number(d.tipTotal ?? 0),
      total: Number(d.total ?? 0),
      notes: d.notes,
    })
    return true
  } catch (err) {
    console.error('Failed to load split order:', err)
    return false
  }
}
