import { db } from '@/lib/db'
import { invalidateLocationCache } from '@/lib/location-cache'

const LIQUOR_TYPES = ['liquor', 'drinks']
const FOOD_TYPES = ['food', 'pizza', 'combos']

/**
 * Compute effective tax rate for a location from active TaxRule records.
 * Returns decimal (e.g., 0.10 for 10%). Uses all active non-deleted rules.
 */
export async function computeTaxRuleRate(locationId: string): Promise<number> {
  const rules = await db.taxRule.findMany({
    where: { locationId, deletedAt: null, isActive: true },
    select: { rate: true },
  })
  return rules.reduce((sum, rule) => sum + Number(rule.rate), 0)
}

/**
 * Sync effective TaxRule rates + inclusive flags to Location.settings.tax.
 * Persists defaultRate (exclusive sum), inclusiveTaxRate (inclusive sum),
 * taxInclusiveLiquor, and taxInclusiveFood.
 * Call after any TaxRule create/update/delete.
 */
export async function syncTaxRateToSettings(locationId: string): Promise<void> {
  const rules = await db.taxRule.findMany({
    where: { locationId, deletedAt: null, isActive: true },
    select: { rate: true, isInclusive: true, appliesTo: true, categoryIds: true },
  })

  const exclusiveRules = rules.filter(r => !r.isInclusive)
  const inclusiveRules = rules.filter(r => r.isInclusive)

  const exclusiveRate = exclusiveRules.reduce((sum, r) => sum + Number(r.rate), 0)
  const inclusiveRate = inclusiveRules.reduce((sum, r) => sum + Number(r.rate), 0)

  const defaultRatePercent = Math.round(exclusiveRate * 100 * 10000) / 10000
  const inclusiveRatePercent = Math.round(inclusiveRate * 100 * 10000) / 10000

  // Derive taxInclusiveLiquor / taxInclusiveFood from inclusive rules
  let taxInclusiveLiquor = false
  let taxInclusiveFood = false

  for (const rule of inclusiveRules) {
    if (rule.appliesTo === 'all') {
      taxInclusiveLiquor = true
      taxInclusiveFood = true
      break
    }
    if (rule.appliesTo === 'category' && rule.categoryIds) {
      const catIds = Array.isArray(rule.categoryIds) ? rule.categoryIds : []
      // Load categories to check types
      if (catIds.length > 0) {
        const cats = await db.category.findMany({
          where: { id: { in: catIds as string[] } },
          select: { categoryType: true },
        })
        for (const cat of cats) {
          if (cat.categoryType && LIQUOR_TYPES.includes(cat.categoryType)) taxInclusiveLiquor = true
          if (cat.categoryType && FOOD_TYPES.includes(cat.categoryType)) taxInclusiveFood = true
        }
      }
    }
  }

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })
  if (!location) return

  const currentSettings = (location.settings as Record<string, unknown>) || {}
  const updatedSettings = {
    ...currentSettings,
    tax: {
      ...(currentSettings.tax as Record<string, unknown> | undefined),
      defaultRate: defaultRatePercent,
      inclusiveTaxRate: inclusiveRatePercent,
      taxInclusiveLiquor,
      taxInclusiveFood,
    },
  }

  await db.location.update({
    where: { id: locationId },
    data: { settings: updatedSettings },
  })

  invalidateLocationCache(locationId)
}
