import { db, adminDb } from '@/lib/db'

/**
 * Validate and correct the spirit tier / bottle product link for a modifier selection.
 *
 * When a client sends an order item with a spirit modifier, this ensures the
 * linkedBottleProductId matches what the modifier actually points to in the DB.
 * If the client sent the wrong bottle ID (or none), we correct it server-side.
 */
export async function validateSpiritTier(
  menuItemId: string,
  modifierId: string | null,
  linkedBottleProductId: string | null
): Promise<{ valid: boolean; correctedBottleId: string | null; spiritTier: string | null }> {
  if (!modifierId) return { valid: true, correctedBottleId: linkedBottleProductId, spiritTier: null }

  // Look up the modifier to check if it's in a spirit group
  const modifier = await db.modifier.findUnique({
    where: { id: modifierId },
    select: {
      linkedBottleProductId: true,
      spiritTier: true,
      modifierGroup: {
        select: { isSpiritGroup: true }
      }
    }
  })

  if (!modifier?.modifierGroup?.isSpiritGroup) {
    // Not a spirit modifier — pass through
    return { valid: true, correctedBottleId: linkedBottleProductId, spiritTier: null }
  }

  // It IS a spirit modifier — ensure linkedBottleProductId is correct
  const correctBottleId = modifier.linkedBottleProductId
  if (linkedBottleProductId && linkedBottleProductId === correctBottleId) {
    return { valid: true, correctedBottleId: linkedBottleProductId, spiritTier: modifier.spiritTier }
  }

  // Client sent wrong or missing bottle ID — correct it
  if (correctBottleId && correctBottleId !== linkedBottleProductId) {
    console.log('[liquor-validation]', JSON.stringify({
      event: 'spirit_tier_corrected',
      menuItemId, modifierId,
      clientSent: linkedBottleProductId,
      correctedTo: correctBottleId
    }))
  }

  return { valid: !!correctBottleId, correctedBottleId: correctBottleId, spiritTier: modifier.spiritTier }
}

/**
 * Validate and resolve the pour multiplier for a given menu item and pour size.
 *
 * MenuItem.pourSizes is a JSON field that can be:
 *   { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 }
 * or:
 *   { shot: { multiplier: 1.0, price: 5.99 }, ... }
 *
 * Returns the multiplier (clamped to 0 < x <= 10) or 1.0 as default.
 */
export async function validatePourMultiplier(
  menuItemId: string,
  pourSize: string | null
): Promise<{ valid: boolean; multiplier: number }> {
  if (!pourSize) return { valid: true, multiplier: 1.0 }

  const menuItem = await adminDb.menuItem.findUnique({
    where: { id: menuItemId },
    select: { pourSizes: true }
  })

  const pourSizes = (menuItem?.pourSizes as Record<string, any>) || {}

  const config = pourSizes[pourSize]
  let multiplier = 1.0

  if (typeof config === 'number') {
    multiplier = config
  } else if (config && typeof config === 'object' && config.multiplier !== undefined) {
    multiplier = Number(config.multiplier)
  } else {
    // Fallback defaults
    const defaults: Record<string, number> = { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 }
    multiplier = defaults[pourSize] ?? 1.0
  }

  if (multiplier <= 0 || multiplier > 10) {
    return { valid: false, multiplier: 1.0 }
  }

  return { valid: true, multiplier }
}
