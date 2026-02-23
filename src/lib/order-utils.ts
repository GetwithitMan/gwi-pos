/**
 * order-utils.ts — Single source of truth for order-related utilities
 *
 * Contains:
 * - Temp ID generation and detection
 * - Item payload builder (client → API mapping)
 * - Delay/hold state helpers
 * - Reopened order detection
 */

// ════════════════════════════════════════════════════════════════
// TEMP ID MANAGEMENT
// ════════════════════════════════════════════════════════════════

const TEMP_ID_PREFIX = 'temp_'

/** Generate a temporary item ID for client-side items not yet saved to DB */
export function generateTempItemId(): string {
  return `${TEMP_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/** Check if an ID is a temporary client-side ID (not yet persisted) */
export function isTempId(id: string | undefined | null): boolean {
  if (!id) return true
  // Support both new 'temp_' prefix and legacy 'item_' prefix
  return id.startsWith(TEMP_ID_PREFIX) || id.startsWith('item_') || id.startsWith('local-')
}

// ════════════════════════════════════════════════════════════════
// ITEM PAYLOAD BUILDER
// ════════════════════════════════════════════════════════════════

interface StoreOrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: Array<{
    id: string
    modifierId?: string | null
    name: string
    price: number
    preModifier?: string | null
    depth?: number
    commissionAmount?: number
    parentModifierId?: string | null
    spiritTier?: string | null
    linkedBottleProductId?: string | null
  }>
  ingredientModifications?: Array<{
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: { modifierId: string; name: string; price: number }
  }>
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  isHeld?: boolean
  delayMinutes?: number | null
  blockTimeMinutes?: number | null
  pourSize?: string | null       // T-006
  pourMultiplier?: number | null // T-006
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pizzaConfig?: any
  sourceTableId?: string
}

/**
 * Build the canonical API payload for an order item.
 * Use this EVERYWHERE items are sent to POST /api/orders or POST /api/orders/{id}/items.
 * This is the SINGLE place where store item → API payload mapping happens.
 */
export function buildOrderItemPayload(item: StoreOrderItem, options?: { includeCorrelationId?: boolean }) {
  return {
    menuItemId: item.menuItemId,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    ...(options?.includeCorrelationId ? { correlationId: item.id } : {}),
    modifiers: item.modifiers.map(mod => ({
      modifierId: mod.modifierId || mod.id || '',
      name: mod.name,
      price: Number(mod.price),
      depth: mod.depth ?? 0,
      preModifier: mod.preModifier ?? null,
      spiritTier: mod.spiritTier ?? null,
      linkedBottleProductId: mod.linkedBottleProductId ?? null,
      parentModifierId: mod.parentModifierId ?? null,
    })),
    ingredientModifications: item.ingredientModifications?.map(ing => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      modificationType: ing.modificationType,
      priceAdjustment: ing.priceAdjustment,
      swappedTo: ing.swappedTo,
    })),
    specialNotes: item.specialNotes || null,
    seatNumber: item.seatNumber || null,
    courseNumber: item.courseNumber || null,
    isHeld: item.isHeld || false,
    delayMinutes: item.delayMinutes || null,
    blockTimeMinutes: item.blockTimeMinutes || null,
    pourSize: item.pourSize ?? null,
    pourMultiplier: item.pourMultiplier ?? null,
    pizzaConfig: item.pizzaConfig,
  }
}

// ════════════════════════════════════════════════════════════════
// DELAY / HOLD STATE HELPERS
// ════════════════════════════════════════════════════════════════

interface DelayableItem {
  delayMinutes?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  sentToKitchen?: boolean
  isHeld?: boolean
  kitchenStatus?: string
}

/** Item has no delay and no hold — fires immediately on Send */
export function isImmediate(item: DelayableItem): boolean {
  return !item.isHeld && (!item.delayMinutes || item.delayMinutes <= 0)
}

/** Item has a delay preset but timer hasn't started yet (pre-Send) */
export function isDelayedPending(item: DelayableItem): boolean {
  return !!(item.delayMinutes && item.delayMinutes > 0 && !item.delayStartedAt && !item.delayFiredAt)
}

/** Item has an active countdown timer running (post-Send, pre-fire) */
export function isOnDelayTimer(item: DelayableItem): boolean {
  return !!(
    item.delayMinutes && item.delayMinutes > 0 &&
    item.delayStartedAt &&
    !item.delayFiredAt &&
    !item.sentToKitchen
  )
}

/** Item's delay has completed and it was fired to kitchen */
export function isDelayFired(item: DelayableItem): boolean {
  return !!(
    item.delayMinutes && item.delayMinutes > 0 &&
    (item.delayFiredAt || item.sentToKitchen)
  )
}

// ════════════════════════════════════════════════════════════════
// ORDER STATE HELPERS
// ════════════════════════════════════════════════════════════════

interface ReopenableOrder {
  reopenedAt?: string | null
  reopenReason?: string | null
}

/** Check if an order was reopened after being closed */
export function isReopened(order: ReopenableOrder | null | undefined): boolean {
  return !!order?.reopenedAt
}

// ════════════════════════════════════════════════════════════════
// FETCH & MERGE ORDER (split-order aware)
// ════════════════════════════════════════════════════════════════

export interface MergedOrderData {
  /** Raw API response (top-level order) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
  /** Merged items (from split children if split, otherwise from order itself) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[]
  subtotal: number
  taxTotal: number
  tipTotal: number
  total: number
}

/** Merge split ticket data into a flat items array with totals */
function mergeSplitTickets(
  splitRes: Response,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ items: any[]; subtotal: number; taxTotal: number; tipTotal: number; total: number } | null> {
  return splitRes.json().then(rawSplit => {
    const splitData = rawSplit.data ?? rawSplit
    const splits = splitData.splitOrders || []
    if (!Array.isArray(splits) || splits.length === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = []
    let subtotal = 0, taxTotal = 0, tipTotal = 0, total = 0
    for (const split of splits) {
      const label = split.displayNumber || split.orderNumber
      for (const item of (split.items || [])) {
        items.push({
          ...item,
          menuItemId: item.menuItemId || item.id,
          kitchenStatus: item.isSent || item.isCompleted ? 'sent' : 'pending',
          modifiers: (item.modifiers || []).map((m: { id: string; name: string; price: number; preModifier?: string }) => ({
            ...m,
            modifierId: m.id,
          })),
          splitLabel: String(label),
        })
      }
      subtotal += Number(split.subtotal) || 0
      taxTotal += Number(split.taxTotal) || 0
      tipTotal += Number(split.tipTotal) || 0
      total += Number(split.total) || 0
    }
    return { items, subtotal, taxTotal, tipTotal, total }
  }).catch(err => {
    console.error('[fetchAndMergeOrder] Failed to parse split tickets:', err)
    return null
  })
}

/**
 * Fetch an order by ID and, if it's a split parent, fetch all child split
 * tickets and merge their items/totals into a single combined view.
 *
 * Used by FloorPlanHome's orderToLoad effect and handleTableTap to avoid
 * duplicating the split-merge logic in two places.
 *
 * @param opts.view - API view mode (default: 'panel' for lightweight fetch)
 * @param opts.knownStatus - If caller already knows the order status, pass it
 *   to enable parallel fetch of split tickets (saves one sequential round-trip)
 */
export async function fetchAndMergeOrder(
  orderId: string,
  opts?: { view?: string; knownStatus?: string },
): Promise<MergedOrderData | null> {
  const view = opts?.view || 'panel'
  const isSplit = opts?.knownStatus === 'split'

  // Fast path: caller knows it's a split order — fire both fetches in parallel
  if (isSplit) {
    const [res, splitRes] = await Promise.all([
      fetch(`/api/orders/${orderId}?view=${view}`),
      fetch(`/api/orders/${orderId}/split-tickets`),
    ])

    if (!res.ok) return null
    const raw = await res.json()
    const data = raw.data ?? raw

    const merged = splitRes.ok ? await mergeSplitTickets(splitRes) : null

    return {
      raw: data,
      items: merged?.items ?? data.items ?? [],
      subtotal: merged?.subtotal ?? (Number(data.subtotal) || 0),
      taxTotal: merged?.taxTotal ?? (Number(data.taxTotal) || 0),
      tipTotal: merged?.tipTotal ?? (Number(data.tipTotal) || 0),
      total: merged?.total ?? (Number(data.total) || 0),
    }
  }

  // Default path: fetch order first, then split tickets if needed
  const res = await fetch(`/api/orders/${orderId}?view=${view}`)
  if (!res.ok) return null

  const raw = await res.json()
  const data = raw.data ?? raw

  let mergedItems = data.items || []
  let mergedSubtotal = Number(data.subtotal) || 0
  let mergedTax = Number(data.taxTotal) || 0
  let mergedTip = Number(data.tipTotal) || 0
  let mergedTotal = Number(data.total) || 0

  if (data.status === 'split') {
    try {
      const splitRes = await fetch(`/api/orders/${orderId}/split-tickets`)
      if (splitRes.ok) {
        const merged = await mergeSplitTickets(splitRes)
        if (merged) {
          mergedItems = merged.items
          mergedSubtotal = merged.subtotal
          mergedTax = merged.taxTotal
          mergedTip = merged.tipTotal
          mergedTotal = merged.total
        }
      }
    } catch (err) {
      console.error('[fetchAndMergeOrder] Failed to fetch split tickets:', err)
    }
  }

  return {
    raw: data,
    items: mergedItems,
    subtotal: mergedSubtotal,
    taxTotal: mergedTax,
    tipTotal: mergedTip,
    total: mergedTotal,
  }
}
