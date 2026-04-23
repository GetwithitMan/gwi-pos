import { describe, it, expect, vi } from 'vitest'
import { recordOnlineCustomerLoyaltyEarn } from '../record-online-earn'
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

interface Captured {
  queryRawCalls: unknown[][]
  executeRawCalls: unknown[][]
  customerUpdateArgs: unknown[]
}

function makeDb(
  customer: { loyaltyPoints: number; lifetimePoints: number; loyaltyTierId: string | null } | null,
  options: { tierMultiplier?: number; throwOnInsert?: Error } = {},
) {
  const captured: Captured = {
    queryRawCalls: [],
    executeRawCalls: [],
    customerUpdateArgs: [],
  }
  const db = {
    customer: {
      findUnique: vi.fn().mockResolvedValue(customer),
      update: vi.fn().mockImplementation(async (args: unknown) => {
        captured.customerUpdateArgs.push(args)
        return {}
      }),
    },
    $queryRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
      captured.queryRawCalls.push(args)
      // LoyaltyTier lookup returns a row when tierMultiplier provided
      if (options.tierMultiplier != null) {
        return [{ pointsMultiplier: options.tierMultiplier }]
      }
      return []
    }),
    $executeRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
      captured.executeRawCalls.push(args)
      if (options.throwOnInsert) throw options.throwOnInsert
      return 1
    }),
  }
  return { db, captured }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordOnlineCustomerLoyaltyEarn', () => {
  it('returns zeros and does not write LoyaltyTransaction when loyalty disabled', async () => {
    const { db, captured } = makeDb({ loyaltyPoints: 10, lifetimePoints: 10, loyaltyTierId: null })
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1234,
      subtotal: 50,
      total: 55,
      tipTotal: 5,
      loyaltySettings: baseSettings({ enabled: false }),
      employeeId: 'emp-1',
    })
    expect(result.pointsEarned).toBe(0)
    expect(result.transactionId).toBeNull()
    expect(captured.executeRawCalls).toHaveLength(0)
    // Stats still updated (lastVisit/totalSpent/totalOrders) even when 0 points
    expect(captured.customerUpdateArgs).toHaveLength(1)
  })

  it('writes LoyaltyTransaction with POS-parity shape', async () => {
    const { db, captured } = makeDb({ loyaltyPoints: 10, lifetimePoints: 20, loyaltyTierId: null })
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1234,
      subtotal: 100,
      total: 115,
      tipTotal: 15,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      employeeId: 'emp-1',
    })

    // 100 subtotal, earnOnSubtotal=true, earnOnTips=false => 100 base, 100 pts
    expect(result.pointsEarned).toBe(100)
    expect(result.transactionId).toBeTruthy()
    expect(captured.executeRawCalls).toHaveLength(1)

    // SQL insert template fragments (tagged template literal arrays)
    const insertArgs = captured.executeRawCalls[0]
    const sqlParts = (insertArgs[0] as unknown) as string[]
    const interpolated = insertArgs.slice(1) as unknown[]

    const joined = Array.isArray(sqlParts) ? sqlParts.join('') : ''
    expect(joined).toContain('INSERT INTO "LoyaltyTransaction"')
    expect(joined).toContain('"customerId"')
    expect(joined).toContain('"locationId"')
    expect(joined).toContain('"orderId"')
    expect(joined).toContain('"balanceBefore"')
    expect(joined).toContain('"balanceAfter"')
    expect(joined).toContain('"employeeId"')
    expect(joined).toContain("'earn'")

    // Values passed into the tagged template, in order. Match shape (not exact UUID).
    // Order: id, customerId, locationId, orderId, points, balanceBefore, balanceAfter,
    //        description, employeeId, metadata
    expect(interpolated[1]).toBe('cust-1')
    expect(interpolated[2]).toBe('loc-1')
    expect(interpolated[3]).toBe('ord-1')
    expect(interpolated[4]).toBe(100) // points
    expect(interpolated[5]).toBe(10) // balanceBefore (current loyaltyPoints)
    expect(interpolated[6]).toBe(110) // balanceAfter
    expect(interpolated[8]).toBe('emp-1') // employeeId (non-null)
  })

  it('passes null employeeId through (POS parity — employeeId may be null)', async () => {
    const { db, captured } = makeDb({ loyaltyPoints: 0, lifetimePoints: 0, loyaltyTierId: null })
    await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1,
      subtotal: 10,
      total: 10,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      employeeId: null,
    })
    const insertArgs = captured.executeRawCalls[0]
    const interpolated = insertArgs.slice(1) as unknown[]
    expect(interpolated[8]).toBeNull()
  })

  it('applies tier multiplier via LoyaltyTier lookup', async () => {
    const { db } = makeDb(
      { loyaltyPoints: 0, lifetimePoints: 0, loyaltyTierId: 'tier-gold' },
      { tierMultiplier: 1.5 },
    )
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1,
      subtotal: 40,
      total: 40,
      tipTotal: 0,
      loyaltySettings: baseSettings({ pointsPerDollar: 1 }),
      employeeId: null,
    })
    expect(result.loyaltyTierMultiplier).toBe(1.5)
    expect(result.pointsEarned).toBe(60) // 40 * 1 * 1.5
  })

  it('honors minimumEarnAmount online (below threshold => no LoyaltyTransaction)', async () => {
    const { db, captured } = makeDb({ loyaltyPoints: 0, lifetimePoints: 0, loyaltyTierId: null })
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1,
      subtotal: 4.99,
      total: 4.99,
      tipTotal: 0,
      loyaltySettings: baseSettings({ minimumEarnAmount: 5 }),
      employeeId: null,
    })
    expect(result.pointsEarned).toBe(0)
    expect(result.transactionId).toBeNull()
    expect(captured.executeRawCalls).toHaveLength(0)
  })

  it('gracefully degrades when LoyaltyTransaction table is missing', async () => {
    const err = Object.assign(new Error('relation "LoyaltyTransaction" does not exist'), { code: '42P01' })
    const { db } = makeDb(
      { loyaltyPoints: 0, lifetimePoints: 0, loyaltyTierId: null },
      { throwOnInsert: err },
    )
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-1',
      orderId: 'ord-1',
      orderNumber: 1,
      subtotal: 100,
      total: 100,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      employeeId: null,
    })
    // points still credited to Customer, but no LoyaltyTransaction row
    expect(result.pointsEarned).toBe(100)
    expect(result.transactionId).toBeNull()
  })

  it('returns early when customer is missing', async () => {
    const { db, captured } = makeDb(null)
    const result = await recordOnlineCustomerLoyaltyEarn({
      db: db as any,
      locationId: 'loc-1',
      customerId: 'cust-missing',
      orderId: 'ord-1',
      orderNumber: 1,
      subtotal: 50,
      total: 50,
      tipTotal: 0,
      loyaltySettings: baseSettings(),
      employeeId: null,
    })
    expect(result.pointsEarned).toBe(0)
    expect(result.transactionId).toBeNull()
    expect(captured.customerUpdateArgs).toHaveLength(0)
    expect(captured.executeRawCalls).toHaveLength(0)
  })
})
