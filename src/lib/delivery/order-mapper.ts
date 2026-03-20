/**
 * Third-Party Delivery Order Mapper
 *
 * Maps incoming delivery platform orders (DoorDash, UberEats, Grubhub)
 * to POS Order format. Attempts fuzzy name matching against local menu items.
 * If no match found, creates a generic OrderItem with the platform name/price.
 *
 * Platform tips do NOT enter tip banking — they're paid out by the platform, not the venue.
 */

import { db } from '@/lib/db'

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeliveryPlatform = 'doordash' | 'ubereats' | 'grubhub'

export interface PlatformItem {
  name: string
  quantity: number
  price: number            // Unit price from platform
  modifiers?: string[]     // Modifier names from platform
  specialInstructions?: string
  externalId?: string      // Platform-specific item ID
}

export interface MappedOrderItem {
  menuItemId: string | null    // null = generic item (no menu match)
  name: string
  quantity: number
  price: number                // Unit price
  modifiers: string[]
  specialInstructions?: string
  isGeneric: boolean           // true = no local menu item match found
}

export interface MappedOrder {
  items: MappedOrderItem[]
  subtotal: number
  tax: number
  total: number
  orderType: string            // e.g. 'delivery_doordash'
}

// ─── Fuzzy Match Helpers ────────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy comparison.
 * Lowercases, removes punctuation, collapses whitespace.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Simple fuzzy match score (0-1). Higher = better match.
 * Uses normalized containment + Levenshtein proximity for short strings.
 */
function fuzzyScore(platformName: string, menuName: string): number {
  const a = normalize(platformName)
  const b = normalize(menuName)

  // Exact match
  if (a === b) return 1.0

  // One contains the other
  if (a.includes(b) || b.includes(a)) return 0.8

  // Word overlap score
  const aWords = new Set(a.split(' '))
  const bWords = new Set(b.split(' '))
  const intersection = [...aWords].filter(w => bWords.has(w))
  const union = new Set([...aWords, ...bWords])
  const jaccard = intersection.length / union.size

  return jaccard
}

const FUZZY_THRESHOLD = 0.6  // Minimum score to consider a match

// ─── Main Mapper ────────────────────────────────────────────────────────────

/**
 * Map a third-party platform order to POS order format.
 *
 * @param platformItems - Items from the delivery platform webhook
 * @param platform - Which platform ('doordash' | 'ubereats' | 'grubhub')
 * @param locationId - POS location ID for menu item lookup
 * @param taxRate - Tax rate to apply (0 = no tax override)
 */
export async function mapThirdPartyOrder(
  platformItems: PlatformItem[],
  platform: DeliveryPlatform,
  locationId: string,
  taxRate: number = 0,
): Promise<MappedOrder> {
  // Load local menu items for fuzzy matching
  const menuItems = await db.menuItem.findMany({
    where: {
      category: { locationId },
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      price: true,
    },
  })

  const mapped: MappedOrderItem[] = []
  let subtotal = 0

  for (const item of platformItems) {
    // Try to find a matching menu item by name
    let bestMatch: { id: string; name: string; price: number } | null = null
    let bestScore = 0

    for (const mi of menuItems) {
      const score = fuzzyScore(item.name, mi.name)
      if (score > bestScore && score >= FUZZY_THRESHOLD) {
        bestScore = score
        bestMatch = { id: mi.id, name: mi.name, price: Number(mi.price) }
      }
    }

    const itemTotal = item.price * item.quantity

    if (bestMatch) {
      // Matched a local menu item
      mapped.push({
        menuItemId: bestMatch.id,
        name: bestMatch.name,
        quantity: item.quantity,
        price: item.price,          // Use platform price (may differ from local)
        modifiers: item.modifiers || [],
        specialInstructions: item.specialInstructions,
        isGeneric: false,
      })
    } else {
      // No match — create generic item with platform name/price
      mapped.push({
        menuItemId: null,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        modifiers: item.modifiers || [],
        specialInstructions: item.specialInstructions,
        isGeneric: true,
      })
    }

    subtotal += itemTotal
  }

  // Note: delivery orders currently assume all items are tax-exclusive
  const tax = taxRate > 0 ? Math.round(subtotal * (taxRate / 100) * 100) / 100 : 0
  const total = Math.round((subtotal + tax) * 100) / 100

  return {
    items: mapped,
    subtotal: Math.round(subtotal * 100) / 100,
    tax,
    total,
    orderType: `delivery_${platform}`,
  }
}

// ─── Platform-Specific Normalizers ──────────────────────────────────────────

/**
 * Normalize DoorDash order items from webhook payload.
 *
 * DoorDash nests items inside categories:
 *   { categories: [{ name, items: [{ name, price, quantity, extras: [{ name, options: [{ name, price }] }] }] }] }
 *
 * Accepts the full webhook payload OR just the order object.
 * Flatmaps categories[].items[] and extras[].options[] for modifiers.
 * Prices arrive in cents — converted to dollars here.
 */
export function normalizeDoorDashItems(payload: Record<string, unknown>): PlatformItem[] {
  const order = (payload.order || payload) as Record<string, unknown>
  const categories = (order.categories || []) as Array<Record<string, unknown>>

  // Fallback: if no categories, try the old flat items path for backward compat
  if (categories.length === 0) {
    const flatItems = (order.order_items || order.items || []) as Array<Record<string, unknown>>
    return flatItems.map(item => ({
      name: String(item.name || item.title || ''),
      quantity: Number(item.quantity || 1),
      price: Number(item.price || item.unit_price || 0) / 100,
      modifiers: ((item.extra_options || item.modifiers || []) as Array<Record<string, unknown>>)
        .map(m => String(m.name || m.title || '')),
      specialInstructions: String(item.special_instructions || ''),
      externalId: String(item.merchant_supplied_id || item.id || ''),
    }))
  }

  const items: PlatformItem[] = []
  for (const cat of categories) {
    const catItems = (cat.items || []) as Array<Record<string, unknown>>
    for (const item of catItems) {
      const extras = (item.extras || []) as Array<Record<string, unknown>>
      const modifiers: string[] = []
      for (const extra of extras) {
        const options = (extra.options || []) as Array<Record<string, unknown>>
        for (const opt of options) {
          modifiers.push(String(opt.name || ''))
        }
      }

      items.push({
        name: String(item.name || ''),
        quantity: Number(item.quantity || 1),
        price: Number(item.price || 0) / 100, // cents to dollars
        modifiers,
        externalId: String(item.merchant_supplied_id || item.id || ''),
      })
    }
  }
  return items
}

/**
 * Normalize UberEats order items from webhook payload.
 */
export function normalizeUberEatsItems(payload: Record<string, unknown>): PlatformItem[] {
  const cart = payload.cart as Record<string, unknown> | undefined
  const items = (cart?.items || payload.items || []) as Array<Record<string, unknown>>
  return items.map(item => ({
    name: String(item.title || item.name || ''),
    quantity: Number(item.quantity || 1),
    price: Number((item.price as Record<string, unknown>)?.amount || item.price || 0) / 100,  // UberEats sends cents
    modifiers: ((item.selected_modifier_groups || []) as Array<Record<string, unknown>>)
      .flatMap(g => ((g.selected_items || []) as Array<Record<string, unknown>>)
        .map(m => String(m.title || m.name || ''))),
    specialInstructions: String(item.special_instructions || ''),
  }))
}

/**
 * Normalize Grubhub order items from webhook payload.
 */
export function normalizeGrubhubItems(payload: Record<string, unknown>): PlatformItem[] {
  const items = (payload.line_items || payload.items || []) as Array<Record<string, unknown>>
  return items.map(item => ({
    name: String(item.name || item.item_name || ''),
    quantity: Number(item.quantity || 1),
    price: Number(item.price || item.unit_price || 0) / 100,  // Grubhub sends cents
    modifiers: ((item.options || item.modifiers || []) as Array<Record<string, unknown>>)
      .map(m => String(m.name || '')),
    specialInstructions: String(item.special_instructions || item.special_request || ''),
  }))
}
