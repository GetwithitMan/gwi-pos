/**
 * Shared types for the online ordering modifier system.
 *
 * ModifierGroupData / ModifierOptionData mirror the API response shape
 * from GET /api/online/menu/[itemId].
 */

export interface ModifierGroupData {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  allowNone: boolean
  allowOpenEntry: boolean
  autoAdvance: boolean
  tieredPricingConfig: unknown
  exclusionGroupKey: string | null
  options: ModifierOptionData[]
}

export interface ModifierOptionData {
  id: string
  name: string
  price: number
  priceType: string
  isDefault: boolean
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  swapEnabled: boolean
  swapTargets: unknown
  childModifierGroup: ModifierGroupData | null
}

export type PreModifier = 'regular' | 'no' | 'lite' | 'extra' | 'side'

export interface SelectedModifier {
  modifierId: string
  name: string
  price: number
  quantity: number
  preModifier: PreModifier | null
  depth: number
  childSelections?: Map<string, SelectedModifier[]>
  isCustomEntry?: boolean
  customEntryText?: string
  isNoneSelection?: boolean
}

/** Calculate the effective price of a modifier selection including pre-modifier and tiered pricing adjustments */
export function getModifierPrice(
  option: ModifierOptionData,
  preMod: PreModifier | null,
  quantity: number,
  tieredConfig?: unknown,
  groupSelectionCount?: number
): number {
  if (preMod === 'no') return 0

  // Tiered pricing overrides base price when configured
  if (tieredConfig && groupSelectionCount !== undefined) {
    const config = tieredConfig as { mode: string; tiers?: Array<{ upTo: number; price: number }>; freeThreshold?: number }

    if (config.mode === 'free_threshold' && config.freeThreshold) {
      // First N selections are free
      if (groupSelectionCount <= config.freeThreshold) return 0
    }

    if (config.mode === 'flat_tiers' && config.tiers) {
      // Price depends on how many selected in the group
      for (const tier of [...config.tiers].sort((a, b) => b.upTo - a.upTo)) {
        if (groupSelectionCount <= tier.upTo) {
          const extra = preMod === 'extra' ? option.extraPrice : 0
          return (tier.price + extra) * quantity
        }
      }
    }
  }

  // Standard pricing
  const base = option.price
  const extra = preMod === 'extra' ? option.extraPrice : 0
  return (base + extra) * quantity
}

/** Format price for display (prices are in dollars) */
export function formatModifierPrice(dollars: number): string {
  if (dollars === 0) return ''
  const sign = dollars > 0 ? '+' : ''
  return `${sign}$${dollars.toFixed(2)}`
}
