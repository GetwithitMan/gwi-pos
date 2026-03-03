import { db } from '@/lib/db'
import { invalidateLocationCache } from '@/lib/location-cache'

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
 * Sync the effective TaxRule rate to Location.settings.tax.defaultRate.
 * Call after any TaxRule create/update/delete so order calculations stay correct.
 */
export async function syncTaxRateToSettings(locationId: string): Promise<void> {
  const effectiveRate = await computeTaxRuleRate(locationId)
  const ratePercent = Math.round(effectiveRate * 100 * 10000) / 10000 // avoid float drift

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
      defaultRate: ratePercent,
    },
  }

  await db.location.update({
    where: { id: locationId },
    data: { settings: updatedSettings },
  })

  invalidateLocationCache(locationId)
}
