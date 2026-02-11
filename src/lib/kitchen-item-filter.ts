/**
 * Shared kitchen item eligibility filter.
 *
 * Used by both the send route (/api/orders/[id]/send) and the kitchen print
 * route (/api/print/kitchen) to determine which order items are eligible for
 * kitchen processing or printing.
 *
 * Rules:
 *  - Held items (`isHeld: true`) are ALWAYS excluded.
 *  - When `filterItemIds` is provided, only those specific items are returned
 *    (selective fire / selective print). Held items are still excluded.
 *  - When no `filterItemIds`, eligible items must:
 *      1. Match the expected `kitchenStatus` (caller decides: 'pending' for send, 'sent' for print)
 *      2. Not be held
 *      3. Not have an active delay (`delayMinutes > 0`)
 */

export interface KitchenFilterableItem {
  id: string
  kitchenStatus: string
  isHeld: boolean
  isCompleted?: boolean
  delayMinutes?: number | null
}

export interface KitchenFilterOptions {
  /** If provided, only return items with these IDs (selective fire / selective print) */
  filterItemIds?: string[] | null
  /** The kitchen status to match when no filterItemIds. Default: 'pending' */
  expectedStatus?: string
  /** Whether to also exclude completed items. Default: false */
  excludeCompleted?: boolean
}

/**
 * Returns the subset of items eligible for kitchen send or print.
 *
 * @param items - All order items to filter
 * @param options - Filtering options
 * @returns Filtered items eligible for kitchen
 */
export function getEligibleKitchenItems<T extends KitchenFilterableItem>(
  items: T[],
  options: KitchenFilterOptions = {}
): T[] {
  const {
    filterItemIds = null,
    expectedStatus = 'pending',
    excludeCompleted = false,
  } = options

  // Selective fire/print: only the requested items, still excluding held
  if (filterItemIds && filterItemIds.length > 0) {
    return items.filter(item =>
      filterItemIds.includes(item.id) && !item.isHeld
    )
  }

  // Default path: status match + not held + not delayed + optionally not completed
  return items.filter(item =>
    item.kitchenStatus === expectedStatus &&
    !item.isHeld &&
    (!item.delayMinutes || item.delayMinutes <= 0) &&
    (!excludeCompleted || !item.isCompleted)
  )
}
