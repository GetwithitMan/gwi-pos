/**
 * Variation Fingerprinting for PMix Level 1 Drill-Down.
 *
 * Groups order items by "how they were built" — same modifiers, same pre-modifiers,
 * same ingredient modifications, same pour size = same variation.
 *
 * A "standard" item has no modifiers, no ingredient mods, no pour size override.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariationModifier {
  name: string
  preModifier: string | null
  spiritTier: string | null
  isNoneSelection: boolean
  isCustomEntry: boolean
  customEntryName: string | null
  swapTargetName: string | null
  quantity: number
}

export interface VariationIngredientMod {
  ingredientName: string
  modificationType: string
  swappedToModifierName: string | null
}

export interface VariationModifierPrice {
  name: string
  price: number
  preModifier: string | null
  spiritTier: string | null
}

export interface TransformedOrderItem {
  quantity: number
  itemTotal: number
  costAtSale: number | null
  pourSize: string | null
  modifiers: VariationModifier[]
  ingredientModifications: VariationIngredientMod[]
  modifierPrices: VariationModifierPrice[]
}

export interface VariationGroup {
  fingerprint: string
  label: string
  quantitySold: number
  totalRevenue: number
  totalCost: number
  avgRevenue: number
  avgCost: number
  margin: number
  modifiers: VariationModifier[]
  ingredientModifications: VariationIngredientMod[]
  pourSize: string | null
  avgModifierRevenue: number
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic string fingerprint for an order item's "build".
 * Two items with the same fingerprint were configured identically.
 */
export function computeVariationFingerprint(item: TransformedOrderItem): string {
  const parts: string[] = []

  // Pour size
  if (item.pourSize) {
    parts.push(`pour:${item.pourSize}`)
  }

  // Modifiers — sorted for determinism
  const modParts = item.modifiers
    .filter(m => !m.isNoneSelection) // "None" selections don't define a variation
    .map(m => {
      const prefix = m.preModifier ? `${m.preModifier}:` : ''
      const tier = m.spiritTier ? `[${m.spiritTier}]` : ''
      const qty = m.quantity > 1 ? `x${m.quantity}` : ''
      const swap = m.swapTargetName ? `→${m.swapTargetName}` : ''
      const custom = m.isCustomEntry && m.customEntryName ? `{${m.customEntryName}}` : ''
      const name = m.isCustomEntry ? (m.customEntryName || 'custom') : m.name
      return `${prefix}${name}${tier}${swap}${qty}${custom}`
    })
    .sort()

  if (modParts.length > 0) {
    parts.push(`mods:${modParts.join('+')}`)
  }

  // Ingredient modifications — sorted for determinism
  const ingParts = item.ingredientModifications
    .filter(im => im.modificationType !== 'standard')
    .map(im => {
      const swap = im.swappedToModifierName ? `→${im.swappedToModifierName}` : ''
      return `${im.modificationType}:${im.ingredientName}${swap}`
    })
    .sort()

  if (ingParts.length > 0) {
    parts.push(`ing:${ingParts.join('+')}`)
  }

  return parts.length === 0 ? 'standard' : parts.join('|')
}

/**
 * Build a human-readable label from a fingerprint's constituent modifiers.
 */
function buildVariationLabel(item: TransformedOrderItem): string {
  const parts: string[] = []

  if (item.pourSize) {
    parts.push(item.pourSize.charAt(0).toUpperCase() + item.pourSize.slice(1))
  }

  for (const m of item.modifiers) {
    if (m.isNoneSelection) continue
    const prefix = m.preModifier ? `${m.preModifier.charAt(0).toUpperCase() + m.preModifier.slice(1)} ` : ''
    const name = m.isCustomEntry ? (m.customEntryName || 'Custom') : m.name
    const tier = m.spiritTier ? ` (${m.spiritTier.replace('_', ' ')})` : ''
    const swap = m.swapTargetName ? ` sub ${m.swapTargetName}` : ''
    const qty = m.quantity > 1 ? ` x${m.quantity}` : ''
    parts.push(`${prefix}${name}${tier}${swap}${qty}`)
  }

  for (const im of item.ingredientModifications) {
    if (im.modificationType === 'standard') continue
    const swap = im.swappedToModifierName ? ` for ${im.swappedToModifierName}` : ''
    parts.push(`${im.modificationType} ${im.ingredientName}${swap}`)
  }

  return parts.length === 0 ? 'Standard (no modifications)' : parts.join(', ')
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Group transformed order items by their variation fingerprint.
 * Returns sorted by quantitySold descending.
 */
export function groupByVariation(
  items: TransformedOrderItem[],
  baseItemCost: number,
): VariationGroup[] {
  const groups = new Map<string, {
    fingerprint: string
    label: string
    items: TransformedOrderItem[]
    pourSize: string | null
    modifiers: VariationModifier[]
    ingredientModifications: VariationIngredientMod[]
  }>()

  for (const item of items) {
    const fingerprint = computeVariationFingerprint(item)

    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        fingerprint,
        label: buildVariationLabel(item),
        items: [],
        pourSize: item.pourSize,
        modifiers: item.modifiers.filter(m => !m.isNoneSelection),
        ingredientModifications: item.ingredientModifications.filter(im => im.modificationType !== 'standard'),
      })
    }

    groups.get(fingerprint)!.items.push(item)
  }

  const result: VariationGroup[] = []

  for (const group of Array.from(groups.values())) {
    const quantitySold = group.items.reduce((sum, i) => sum + i.quantity, 0)
    const totalRevenue = group.items.reduce((sum, i) => sum + i.itemTotal, 0)
    const totalModifierRevenue = group.items.reduce((sum, i) => {
      return sum + i.modifierPrices.reduce((ms, mp) => ms + mp.price, 0)
    }, 0)
    const totalCost = group.items.reduce((sum, i) => {
      return sum + (i.costAtSale != null ? i.costAtSale * i.quantity : baseItemCost * i.quantity)
    }, 0)
    const avgRevenue = quantitySold > 0 ? totalRevenue / quantitySold : 0
    const avgCost = quantitySold > 0 ? totalCost / quantitySold : 0
    const margin = totalRevenue > 0
      ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 1000) / 10
      : 0

    result.push({
      fingerprint: group.fingerprint,
      label: group.label,
      quantitySold,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      avgRevenue: Math.round(avgRevenue * 100) / 100,
      avgCost: Math.round(avgCost * 100) / 100,
      margin,
      modifiers: group.modifiers,
      ingredientModifications: group.ingredientModifications,
      pourSize: group.pourSize,
      avgModifierRevenue: quantitySold > 0
        ? Math.round((totalModifierRevenue / quantitySold) * 100) / 100
        : 0,
    })
  }

  // Sort by quantity descending (most popular first)
  result.sort((a, b) => b.quantitySold - a.quantitySold)

  return result
}
