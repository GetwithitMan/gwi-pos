/**
 * Tax Rule & Category Cache
 *
 * In-memory caches for tax rules and categories used during order creation.
 * These are queried on every order POST and item POST but rarely change.
 *
 * TTL: 5 minutes (matches location-cache.ts pattern)
 * Invalidation: Call invalidateTaxCache() when tax rules or categories change.
 */

import { db } from '@/lib/db'

interface TaxRule {
  appliesTo: string | null
  categoryIds: unknown
}

interface CategoryEntry {
  id: string
  categoryType: string | null
}

interface CacheEntry<T> {
  data: T
  expiry: number
}

const TAX_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const taxRuleCache = new Map<string, CacheEntry<TaxRule[]>>()
const categoryCache = new Map<string, CacheEntry<CategoryEntry[]>>()

/**
 * Get inclusive tax rules for a location (cached, 5-min TTL).
 * Used by order creation to determine tax-inclusive pricing.
 */
export async function getCachedInclusiveTaxRules(locationId: string): Promise<TaxRule[]> {
  const cached = taxRuleCache.get(locationId)
  if (cached && Date.now() < cached.expiry) return cached.data

  const rules = await db.taxRule.findMany({
    where: { locationId, isActive: true, isInclusive: true, deletedAt: null },
    select: { appliesTo: true, categoryIds: true },
  })

  taxRuleCache.set(locationId, { data: rules, expiry: Date.now() + TAX_CACHE_TTL })
  return rules
}

/**
 * Get all categories for a location (cached, 5-min TTL).
 * Used by order creation to map categoryId → categoryType for tax-inclusive checks.
 */
export async function getCachedCategories(locationId: string): Promise<CategoryEntry[]> {
  const cached = categoryCache.get(locationId)
  if (cached && Date.now() < cached.expiry) return cached.data

  const categories = await db.category.findMany({
    where: { locationId, deletedAt: null },
    select: { id: true, categoryType: true },
  })

  categoryCache.set(locationId, { data: categories, expiry: Date.now() + TAX_CACHE_TTL })
  return categories
}

/**
 * Invalidate tax caches for a location.
 * Call when tax rules or categories are created/updated/deleted.
 */
export function invalidateTaxCache(locationId?: string): void {
  if (locationId) {
    taxRuleCache.delete(locationId)
    categoryCache.delete(locationId)
  } else {
    taxRuleCache.clear()
    categoryCache.clear()
  }
}
