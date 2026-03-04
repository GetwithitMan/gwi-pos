export type SpiritTierKey = 'well' | 'call' | 'premium' | 'top_shelf'

export interface SpiritTierOption {
  id: string
  name: string
  price: number | null
  spiritTier: SpiritTierKey
  linkedBottleProductId: string | null
}

export type SpiritTiers = Record<SpiritTierKey, SpiritTierOption[]>

export function buildSpiritTiersFromItem(item: any): SpiritTiers | null {
  const spiritGroup = item.ownedModifierGroups?.find((mg: any) => mg.isSpiritGroup)
  const spiritModifiers = spiritGroup?.modifiers || []
  if (!spiritModifiers.length) return null

  const base: SpiritTiers = { well: [], call: [], premium: [], top_shelf: [] }

  for (const m of spiritModifiers) {
    const tier = m.spiritTier as SpiritTierKey | null
    if (!tier || !(tier in base)) continue
    base[tier].push({
      id: m.id,
      name: m.linkedBottleProduct?.name || m.name,
      price: m.price != null ? Number(m.price) : null,
      spiritTier: tier,
      linkedBottleProductId: m.linkedBottleProductId ?? m.linkedBottleProduct?.id ?? null,
    })
  }

  return base
}

export function normalizeModifier(m: any) {
  return {
    ...m,
    price: m.price != null ? Number(m.price) : 0,
    extraPrice: m.extraPrice != null ? Number(m.extraPrice) : null,
    spiritTier: m.spiritTier ?? null,
    linkedBottleProductId: m.linkedBottleProductId ?? null,
  }
}
