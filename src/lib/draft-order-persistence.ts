/**
 * Draft Order Persistence
 *
 * Saves the in-progress order to localStorage before session expiry / logout,
 * keyed by locationId + employeeId. On next login the POS can offer to restore.
 */

const DRAFT_KEY_PREFIX = 'gwi-pos-draft-order'

function buildKey(locationId: string, employeeId: string): string {
  return `${DRAFT_KEY_PREFIX}:${locationId}:${employeeId}`
}

export interface DraftOrder {
  savedAt: string
  orderType: string
  orderTypeId?: string
  tableId?: string
  tableName?: string
  tabName?: string
  guestCount: number
  items: Array<{
    menuItemId: string
    name: string
    price: number
    quantity: number
    modifiers: Array<{ id: string; name: string; price: number; groupName?: string }>
    seatNumber?: number
    courseNumber?: number
    specialNotes?: string
    pourSize?: string | null
    pourMultiplier?: number | null
  }>
  notes?: string
}

/**
 * Save the current order store snapshot to localStorage.
 * Returns true if a draft was actually saved (i.e. there were items).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOrderItem = Record<string, any>

export function saveDraftOrder(
  locationId: string,
  employeeId: string,
  order: {
    orderType: string
    orderTypeId?: string
    tableId?: string
    tableName?: string
    tabName?: string
    guestCount: number
    items: AnyOrderItem[]
    notes?: string
  },
): boolean {
  if (!order.items || order.items.length === 0) return false

  const draft: DraftOrder = {
    savedAt: new Date().toISOString(),
    orderType: order.orderType,
    orderTypeId: order.orderTypeId,
    tableId: order.tableId,
    tableName: order.tableName,
    tabName: order.tabName,
    guestCount: order.guestCount,
    items: order.items.map((item) => ({
      menuItemId: (item.menuItemId as string) || '',
      name: (item.name as string) || '',
      price: (item.price as number) || 0,
      quantity: (item.quantity as number) || 1,
      modifiers: Array.isArray(item.modifiers)
        ? (item.modifiers as Array<{ id: string; name: string; price: number; groupName?: string }>).map((m) => ({
            id: m.id,
            name: m.name,
            price: m.price,
            groupName: m.groupName,
          }))
        : [],
      seatNumber: item.seatNumber as number | undefined,
      courseNumber: item.courseNumber as number | undefined,
      specialNotes: item.specialNotes as string | undefined,
      pourSize: (item.pourSize as string | null) ?? null,
      pourMultiplier: (item.pourMultiplier as number | null) ?? null,
    })),
    notes: order.notes,
  }

  try {
    localStorage.setItem(buildKey(locationId, employeeId), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/**
 * Retrieve a saved draft for a given employee/location. Returns null if none exists.
 */
export function getDraftOrder(locationId: string, employeeId: string): DraftOrder | null {
  try {
    const raw = localStorage.getItem(buildKey(locationId, employeeId))
    if (!raw) return null

    const draft: DraftOrder = JSON.parse(raw)

    // Expire drafts older than 24 hours
    const age = Date.now() - new Date(draft.savedAt).getTime()
    if (age > 24 * 60 * 60 * 1000) {
      clearDraftOrder(locationId, employeeId)
      return null
    }

    return draft
  } catch {
    return null
  }
}

/**
 * Remove a saved draft (called after restore or explicit discard).
 */
export function clearDraftOrder(locationId: string, employeeId: string): void {
  try {
    localStorage.removeItem(buildKey(locationId, employeeId))
  } catch {
    // Ignore storage errors
  }
}
