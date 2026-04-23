import { describe, it, expect, vi } from 'vitest'
import { computeLoyaltyEarn, makePrismaTierLookup } from '../compute-earn'
import type { LoyaltySettings } from '@/lib/settings/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseSettings(overrides: Partial<LoyaltySettings> = {}): LoyaltySettings {
  return {
    enabled: true,
    pointsPerDollar: 1,
    earnOnSubtotal: true,
    earnOnTips: false,
    minimumEarnAmount: 0,
    redemptionEnabled: true,
    pointsPerDollarRedemption: 100,
    minimumRedemptionPoints: 100,
    maximumRedemptionPercent: 50,
    showPointsOnReceipt: true,
    welcomeBonus: 0,
    ...overrides,
  }
}

const noTier = async () => 1.0
const fixedTier = (m: number) => async () => m
const throwingTier = async () => {
  throw new Error('LoyaltyTier table missing')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeLoyaltyEarn', () => {
  it('awards 0 points when loyalty disabled', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 100,
      total: 110,
      tipTotal: 5,
      loyaltySettings: baseSettings({ enabled: false }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(0)
    expect(result.loyaltyEarningBase).toBe(0)
    expect(result.loyaltyTierMultiplier).toBe(1.0)
  })

  it('earns on subtotal at 1 point per $1 (round)', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.49,
      total: 50.00,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1, earnOnSubtotal: true, earnOnTips: false }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    // Math.round(42.49) = 42
    expect(result.loyaltyEarningBase).toBe(42.49)
    expect(result.pointsEarned).toBe(42)
    expect(result.loyaltyTierMultiplier).toBe(1.0)
  })

  it('earns on total when earnOnSubtotal=false', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.49,
      total: 50.00,
      tipTotal: 0,
      loyaltySettings: baseSettings({ earnOnSubtotal: false }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.loyaltyEarningBase).toBe(50.00)
    expect(result.pointsEarned).toBe(50)
  })

  it('includes tips in earn base when earnOnTips=true', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 100,
      total: 118,
      tipTotal: 18,
      loyaltySettings: baseSettings({ earnOnSubtotal: true, earnOnTips: true }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    // base = subtotal 100 + tip 18 = 118
    expect(result.loyaltyEarningBase).toBe(118)
    expect(result.pointsEarned).toBe(118)
  })

  it('applies pointsPerDollar multiplier', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 10,
      total: 10,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 5 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(50)
  })

  it('applies tier multiplier when customer has a tier', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 100,
      total: 100,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: 'tier-gold',
      lookupTierMultiplier: fixedTier(1.5),
    })
    expect(result.loyaltyTierMultiplier).toBe(1.5)
    // 100 * 1 * 1.5 = 150
    expect(result.pointsEarned).toBe(150)
  })

  it('skips earn when base is below minimumEarnAmount', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 3,
      total: 5,
      tipTotal: 0,
      loyaltySettings: baseSettings({ minimumEarnAmount: 5, earnOnSubtotal: true }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(0)
    expect(result.loyaltyEarningBase).toBe(3)
  })

  it('honors minimumEarnAmount when threshold is met exactly', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 5,
      total: 5,
      tipTotal: 0,
      loyaltySettings: baseSettings({ minimumEarnAmount: 5 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(5)
  })

  it('falls back to 1.0x when tier lookup throws', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 100,
      total: 100,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      customerLoyaltyTierId: 'tier-missing',
      lookupTierMultiplier: throwingTier,
    })
    expect(result.loyaltyTierMultiplier).toBe(1.0)
    expect(result.pointsEarned).toBe(100)
  })

  it('treats missing tier row (multiplier 0) as 1.0x', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 100,
      total: 100,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      customerLoyaltyTierId: 'tier-empty',
      lookupTierMultiplier: async () => 0,
    })
    expect(result.loyaltyTierMultiplier).toBe(1.0)
    expect(result.pointsEarned).toBe(100)
  })

  it('online cart earns identically to POS cart for same inputs', async () => {
    const settings = baseSettings({
      pointsPerDollar: 2,
      earnOnSubtotal: true,
      earnOnTips: false,
      minimumEarnAmount: 5,
    })

    // Simulate POS path
    const pos = await computeLoyaltyEarn({
      subtotal: 75.50,
      total: 80.00,
      tipTotal: 4.50,
      loyaltySettings: settings,
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })

    // Simulate online path — same numbers routed through the same engine
    const online = await computeLoyaltyEarn({
      subtotal: 75.50,
      total: 80.00,
      tipTotal: 4.50,
      loyaltySettings: settings,
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })

    expect(online.pointsEarned).toBe(pos.pointsEarned)
    expect(online.loyaltyEarningBase).toBe(pos.loyaltyEarningBase)
    expect(online.loyaltyTierMultiplier).toBe(pos.loyaltyTierMultiplier)
    // Sanity: 75.50 * 2 = 151
    expect(pos.pointsEarned).toBe(151)
  })

  it('tier multiplier applied online (Gold 1.5x)', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 40,
      total: 40,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: 'tier-gold',
      lookupTierMultiplier: fixedTier(1.5),
    })
    expect(result.pointsEarned).toBe(60) // 40 * 1 * 1.5
  })

  it('minimum-earn threshold applied online (below threshold => 0 pts)', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 4.99,
      total: 4.99,
      tipTotal: 0,
      loyaltySettings: baseSettings({ minimumEarnAmount: 5 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(0)
  })

  it('handles null/undefined subtotal + total safely', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: null,
      total: undefined,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.loyaltyEarningBase).toBe(0)
    expect(result.pointsEarned).toBe(0)
  })
})

describe('makePrismaTierLookup', () => {
  it('returns tier multiplier from $queryRaw result', async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([{ pointsMultiplier: 2.5 }]),
    }
    const lookup = makePrismaTierLookup(client)
    const m = await lookup('tier-1')
    expect(m).toBe(2.5)
    expect(client.$queryRaw).toHaveBeenCalledOnce()
  })

  it('returns 1.0 when no rows', async () => {
    const client = { $queryRaw: vi.fn().mockResolvedValue([]) }
    const lookup = makePrismaTierLookup(client)
    expect(await lookup('tier-missing')).toBe(1.0)
  })

  it('propagates $queryRaw errors so caller can fall back gracefully', async () => {
    const client = { $queryRaw: vi.fn().mockRejectedValue(new Error('table does not exist')) }
    const lookup = makePrismaTierLookup(client)
    await expect(lookup('any')).rejects.toThrow('table does not exist')
  })
})
