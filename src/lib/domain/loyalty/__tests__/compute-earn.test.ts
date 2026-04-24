import { describe, it, expect, vi } from 'vitest'
import {
  computeLoyaltyEarn,
  makePrismaTierLookup,
  lookupCustomerRoundingMode,
  resolveRoundingMode,
  applyRounding,
  DEFAULT_LOYALTY_ROUNDING_MODE,
} from '../compute-earn'
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

  it('earns on subtotal at 1 point per $1 (default rounding = floor)', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.49,
      total: 50.00,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1, earnOnSubtotal: true, earnOnTips: false }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    // Math.floor(42.49) = 42 — default mode is 'floor'
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

// ---------------------------------------------------------------------------
// Q1 — Rounding mode (config-driven, default 'floor')
// ---------------------------------------------------------------------------

describe('computeLoyaltyEarn — rounding mode', () => {
  // Use a base of 42.7 so each mode gives a distinct integer:
  //   floor(42.7) = 42, round(42.7) = 43, ceil(42.7) = 43 (round/ceil same)
  // Use 42.4 alongside so round and floor diverge from ceil:
  //   floor(42.4) = 42, round(42.4) = 42, ceil(42.4) = 43

  it('default (no roundingMode passed) floors fractional points', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.7,
      total: 42.7,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
    })
    expect(result.pointsEarned).toBe(42) // Math.floor(42.7)
  })

  it("explicit 'floor' floors fractional points", async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.7,
      total: 42.7,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: 'floor',
    })
    expect(result.pointsEarned).toBe(42)
  })

  it("explicit 'round' uses Math.round semantics", async () => {
    const a = await computeLoyaltyEarn({
      subtotal: 42.7,
      total: 42.7,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: 'round',
    })
    expect(a.pointsEarned).toBe(43) // Math.round(42.7)

    const b = await computeLoyaltyEarn({
      subtotal: 42.4,
      total: 42.4,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: 'round',
    })
    expect(b.pointsEarned).toBe(42) // Math.round(42.4)
  })

  it("explicit 'ceil' rounds fractional points up", async () => {
    const a = await computeLoyaltyEarn({
      subtotal: 42.1,
      total: 42.1,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: 'ceil',
    })
    expect(a.pointsEarned).toBe(43) // Math.ceil(42.1)

    // Whole numbers should be unaffected by mode
    const b = await computeLoyaltyEarn({
      subtotal: 100,
      total: 100,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: 'ceil',
    })
    expect(b.pointsEarned).toBe(100)
  })

  it("unrecognized roundingMode value falls back to default 'floor'", async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.7,
      total: 42.7,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      // Cast through unknown — emulates a venue with bad/legacy data
      roundingMode: 'banker' as unknown as 'floor',
    })
    expect(result.pointsEarned).toBe(42)
  })

  it('null roundingMode falls back to default floor (no LoyaltyProgram configured)', async () => {
    const result = await computeLoyaltyEarn({
      subtotal: 42.7,
      total: 42.7,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: null,
      lookupTierMultiplier: noTier,
      roundingMode: null,
    })
    expect(result.pointsEarned).toBe(42)
  })

  it('rounding applies to the post-multiplier value, not the raw base', async () => {
    // base 10 * pointsPerDollar 1 * tier 1.55 = 15.5
    //   floor = 15, round = 16, ceil = 16
    const floor = await computeLoyaltyEarn({
      subtotal: 10,
      total: 10,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: 'tier-x',
      lookupTierMultiplier: fixedTier(1.55),
      roundingMode: 'floor',
    })
    expect(floor.pointsEarned).toBe(15)

    const round = await computeLoyaltyEarn({
      subtotal: 10,
      total: 10,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: 'tier-x',
      lookupTierMultiplier: fixedTier(1.55),
      roundingMode: 'round',
    })
    expect(round.pointsEarned).toBe(16)

    const ceil = await computeLoyaltyEarn({
      subtotal: 10,
      total: 10,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      customerLoyaltyTierId: 'tier-x',
      lookupTierMultiplier: fixedTier(1.55),
      roundingMode: 'ceil',
    })
    expect(ceil.pointsEarned).toBe(16)
  })
})

describe('rounding helpers', () => {
  it('DEFAULT_LOYALTY_ROUNDING_MODE is floor', () => {
    expect(DEFAULT_LOYALTY_ROUNDING_MODE).toBe('floor')
  })

  it("resolveRoundingMode passes through 'floor', 'round', 'ceil'", () => {
    expect(resolveRoundingMode('floor')).toBe('floor')
    expect(resolveRoundingMode('round')).toBe('round')
    expect(resolveRoundingMode('ceil')).toBe('ceil')
  })

  it('resolveRoundingMode defaults unknown / null / undefined to floor', () => {
    expect(resolveRoundingMode(null)).toBe('floor')
    expect(resolveRoundingMode(undefined)).toBe('floor')
    expect(resolveRoundingMode('')).toBe('floor')
    expect(resolveRoundingMode('FLOOR')).toBe('floor') // case-sensitive on purpose
    expect(resolveRoundingMode('banker')).toBe('floor')
    expect(resolveRoundingMode(42)).toBe('floor')
  })

  it('applyRounding implements all three modes', () => {
    expect(applyRounding(42.7, 'floor')).toBe(42)
    expect(applyRounding(42.4, 'round')).toBe(42)
    expect(applyRounding(42.5, 'round')).toBe(43)
    expect(applyRounding(42.1, 'ceil')).toBe(43)
    expect(applyRounding(42.0, 'ceil')).toBe(42)
    expect(applyRounding(42.0, 'floor')).toBe(42)
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

describe('lookupCustomerRoundingMode', () => {
  it("returns the program's configured mode", async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([{ roundingMode: 'ceil' }]),
    }
    expect(await lookupCustomerRoundingMode(client, 'cust-1')).toBe('ceil')
  })

  it('returns default (floor) when the customer has no program', async () => {
    // LEFT JOIN with no matching LoyaltyProgram row => roundingMode is null
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([{ roundingMode: null }]),
    }
    expect(await lookupCustomerRoundingMode(client, 'cust-1')).toBe('floor')
  })

  it('returns default (floor) when the customer row is missing', async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    }
    expect(await lookupCustomerRoundingMode(client, 'missing')).toBe('floor')
  })

  it('returns default (floor) and swallows errors when LoyaltyProgram table is missing', async () => {
    const client = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('relation "LoyaltyProgram" does not exist')),
    }
    expect(await lookupCustomerRoundingMode(client, 'cust-1')).toBe('floor')
  })

  it('returns default (floor) when the stored value is unrecognized', async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([{ roundingMode: 'banker' }]),
    }
    expect(await lookupCustomerRoundingMode(client, 'cust-1')).toBe('floor')
  })
})
