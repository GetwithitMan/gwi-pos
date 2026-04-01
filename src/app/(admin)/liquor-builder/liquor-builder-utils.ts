// Pure utility functions and constants for the Liquor Builder page

export const DEFAULT_POUR_SIZES: Record<string, { label: string; multiplier: number }> = {
  standard: { label: 'Standard Pour', multiplier: 1.0 },
  shot: { label: 'Shot', multiplier: 1.0 },
  double: { label: 'Double', multiplier: 2.0 },
  tall: { label: 'Tall', multiplier: 1.5 },
  short: { label: 'Short', multiplier: 0.75 },
}

export type PourSizeConfig = { label: string; multiplier: number; customPrice?: number | null }

export const normalizePourSizes = (
  data: Record<string, number | boolean | PourSizeConfig> | null
): Record<string, PourSizeConfig> => {
  if (!data) return {}
  const result: Record<string, PourSizeConfig> = {}
  for (const [key, value] of Object.entries(data)) {
    // Skip metadata keys (prefixed with _)
    if (key.startsWith('_')) continue
    if (typeof value === 'boolean') continue
    if (typeof value === 'number') {
      result[key] = { label: DEFAULT_POUR_SIZES[key]?.label || key, multiplier: value }
    } else {
      result[key] = { ...value }
    }
  }
  return result
}

export const ML_PER_OZ = 29.5735

export const TIER_COLORS: Record<string, string> = {
  well: 'border-gray-300 bg-gray-50',
  call: 'border-blue-200 bg-blue-50',
  premium: 'border-purple-200 bg-purple-50',
  top_shelf: 'border-amber-200 bg-amber-50',
}

export const TIER_TEXT_COLORS: Record<string, string> = {
  well: 'text-gray-900',
  call: 'text-blue-700',
  premium: 'text-purple-700',
  top_shelf: 'text-amber-700',
}

export const TIER_BADGE_COLORS: Record<string, string> = {
  well: 'bg-gray-200 text-gray-900',
  call: 'bg-blue-100 text-blue-700',
  premium: 'bg-purple-100 text-purple-700',
  top_shelf: 'bg-amber-100 text-amber-700',
}

export function getTierLabel(tier: string): string {
  switch (tier) {
    case 'well': return 'WELL'
    case 'call': return 'CALL'
    case 'premium': return 'PREMIUM'
    case 'top_shelf': return 'TOP SHELF'
    default: return tier.toUpperCase()
  }
}

export function getTierBadgeText(tier: string): string {
  return tier === 'top_shelf' ? 'TOP SHELF' : tier.toUpperCase()
}
