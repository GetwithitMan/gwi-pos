import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock db before importing the helper.
// ---------------------------------------------------------------------------

const mockQueryRaw = vi.hoisted(() => vi.fn())
const mockExecuteRaw = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  },
}))

// crypto.randomUUID is predictable in tests but we mostly just read the
// argument so no mocking needed.

import { reverseEarnForOrder } from '../reverse-earn'

// ---------------------------------------------------------------------------
// Helpers — the raw-SQL tagged templates the helper calls come in a specific
// order. We queue the responses in order of invocation.
//
// The helper issues the following queries in this exact order on the happy
// path (earn exists, idempotency clean, customer exists, program has tiers):
//   1) SELECT earn transaction
//   2) SELECT existing reversal (idempotency check)
//   3) SELECT customer + order number
//   4) UPDATE Customer (executeRaw)
//   5) INSERT LoyaltyTransaction reversal (executeRaw)
//   6) SELECT LoyaltyTier rows (only if programId)
//   7) UPDATE Customer SET tierId (executeRaw) — only if tier differs
//   8) INSERT LoyaltyTransaction tier_change (executeRaw) — only if tier differs
// ---------------------------------------------------------------------------

function queueQueryResponses(responses: unknown[]) {
  mockQueryRaw.mockReset()
  for (const r of responses) {
    mockQueryRaw.mockImplementationOnce(() => Promise.resolve(r))
  }
}

function resetExecute() {
  mockExecuteRaw.mockReset()
  mockExecuteRaw.mockImplementation(() => Promise.resolve(1))
}

beforeEach(() => {
  mockQueryRaw.mockReset()
  resetExecute()
})

describe('reverseEarnForOrder — core contract', () => {
  it('full void: reverses exactly one earn event and updates customer', async () => {
    queueQueryResponses([
      // 1) earn row
      [{ id: 'earn-1', points: 10, customerId: 'cust-1' }],
      // 2) no existing reversal
      [],
      // 3) customer snapshot
      [{
        id: 'cust-1',
        loyaltyPoints: 10,
        lifetimePoints: 10,
        loyaltyTierId: null,
        loyaltyProgramId: null,
        orderNumber: 42,
      }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 10,
      isPartial: false,
      employeeId: 'emp-1',
    })

    expect(result.reversed).toBe(true)
    expect(result.pointsReversed).toBe(10)
    expect(result.customerId).toBe('cust-1')
    // Customer UPDATE + reversal INSERT
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2)
  })

  it('partial refund: reverses proportionally with Math.round', async () => {
    // Earned 10 points on $100. Refund $33 → Math.round(10 * 33/100) = 3.
    queueQueryResponses([
      [{ id: 'earn-1', points: 10, customerId: 'cust-1' }],
      [], // no existing reversal
      [{
        id: 'cust-1',
        loyaltyPoints: 10,
        lifetimePoints: 10,
        loyaltyTierId: null,
        loyaltyProgramId: null,
        orderNumber: 42,
      }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'refund',
      refundAmount: 33,
      originalPaymentAmount: 100,
      isPartial: true,
    })

    expect(result.reversed).toBe(true)
    expect(result.pointsReversed).toBe(3)
  })

  it('partial refund: rounds half up using Math.round', async () => {
    // 10 points on $100, refund $25 → 10 * 0.25 = 2.5 → Math.round → 3
    queueQueryResponses([
      [{ id: 'earn-1', points: 10, customerId: 'cust-1' }],
      [],
      [{
        id: 'cust-1',
        loyaltyPoints: 10,
        lifetimePoints: 10,
        loyaltyTierId: null,
        loyaltyProgramId: null,
        orderNumber: 1,
      }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'refund',
      refundAmount: 25,
      originalPaymentAmount: 100,
      isPartial: true,
    })

    expect(result.pointsReversed).toBe(3)
  })
})

describe('reverseEarnForOrder — idempotency', () => {
  it('double-void is a no-op when reversal already exists', async () => {
    queueQueryResponses([
      [{ id: 'earn-1', points: 10, customerId: 'cust-1' }],
      // Existing reversal present
      [{ id: 'rev-prev' }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 10,
      isPartial: false,
    })

    expect(result.reversed).toBe(false)
    expect(result.alreadyReversed).toBe(true)
    expect(mockExecuteRaw).not.toHaveBeenCalled()
  })

  it('no earn transaction found: returns reversed=false without writes', async () => {
    queueQueryResponses([
      [], // no earn row
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 10,
      isPartial: false,
    })

    expect(result.reversed).toBe(false)
    expect(result.pointsReversed).toBe(0)
    expect(mockExecuteRaw).not.toHaveBeenCalled()
  })

  it('zero points earn: returns reversed=false without writes', async () => {
    queueQueryResponses([
      [{ id: 'earn-1', points: 0, customerId: 'cust-1' }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 10,
      isPartial: false,
    })

    expect(result.reversed).toBe(false)
    expect(mockExecuteRaw).not.toHaveBeenCalled()
  })
})

describe('reverseEarnForOrder — tier demotion', () => {
  it('demotes tier when lifetimePoints falls below current tier threshold', async () => {
    // Customer is currently on Gold (min 2000). Earn reversal of 100 points
    // drops them from 2050 to 1950 lifetime → should land on Silver (min 500).
    queueQueryResponses([
      // earn
      [{ id: 'earn-1', points: 100, customerId: 'cust-1' }],
      // no existing reversal
      [],
      // customer snapshot
      [{
        id: 'cust-1',
        loyaltyPoints: 2050,
        lifetimePoints: 2050,
        loyaltyTierId: 'tier-gold',
        loyaltyProgramId: 'prog-1',
        orderNumber: 99,
      }],
      // tiers (sorted DESC by minimumPoints)
      [
        { id: 'tier-platinum', name: 'Platinum', minimumPoints: 5000 },
        { id: 'tier-gold',     name: 'Gold',     minimumPoints: 2000 },
        { id: 'tier-silver',   name: 'Silver',   minimumPoints: 500  },
      ],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 100,
      isPartial: false,
    })

    expect(result.reversed).toBe(true)
    expect(result.pointsReversed).toBe(100)
    expect(result.tierDemoted).toEqual({ from: 'Gold', to: 'Silver' })
    // Writes: customer UPDATE + reversal INSERT + tier UPDATE + tier_change INSERT = 4
    expect(mockExecuteRaw).toHaveBeenCalledTimes(4)
  })

  it('does not demote when reversal keeps customer above current tier', async () => {
    // Gold (min 2000). 2500 → 2450 = still Gold.
    queueQueryResponses([
      [{ id: 'earn-1', points: 50, customerId: 'cust-1' }],
      [],
      [{
        id: 'cust-1',
        loyaltyPoints: 2500,
        lifetimePoints: 2500,
        loyaltyTierId: 'tier-gold',
        loyaltyProgramId: 'prog-1',
        orderNumber: 99,
      }],
      [
        { id: 'tier-gold',   name: 'Gold',   minimumPoints: 2000 },
        { id: 'tier-silver', name: 'Silver', minimumPoints: 500  },
      ],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 50,
      isPartial: false,
    })

    expect(result.reversed).toBe(true)
    expect(result.tierDemoted).toBeUndefined()
    // Only Customer UPDATE + reversal INSERT (no tier writes)
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2)
  })

  it('demotes all the way to no tier if lifetime drops below every threshold', async () => {
    // Silver (min 500). 520 → 420 = below any tier.
    queueQueryResponses([
      [{ id: 'earn-1', points: 100, customerId: 'cust-1' }],
      [],
      [{
        id: 'cust-1',
        loyaltyPoints: 520,
        lifetimePoints: 520,
        loyaltyTierId: 'tier-silver',
        loyaltyProgramId: 'prog-1',
        orderNumber: 77,
      }],
      [
        { id: 'tier-gold',   name: 'Gold',   minimumPoints: 2000 },
        { id: 'tier-silver', name: 'Silver', minimumPoints: 500  },
      ],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'void',
      originalPaymentAmount: 100,
      isPartial: false,
    })

    expect(result.reversed).toBe(true)
    expect(result.tierDemoted).toEqual({ from: 'Silver', to: null })
  })
})

describe('reverseEarnForOrder — comp-void source', () => {
  it('accepts comp-void source and records description accordingly', async () => {
    queueQueryResponses([
      [{ id: 'earn-1', points: 5, customerId: 'cust-1' }],
      [],
      [{
        id: 'cust-1',
        loyaltyPoints: 5,
        lifetimePoints: 5,
        loyaltyTierId: null,
        loyaltyProgramId: null,
        orderNumber: 12,
      }],
    ])

    const result = await reverseEarnForOrder({
      orderId: 'order-1',
      locationId: 'loc-1',
      paymentId: 'pay-1',
      source: 'comp-void',
      originalPaymentAmount: 5,
      isPartial: false,
    })

    expect(result.reversed).toBe(true)
    expect(result.pointsReversed).toBe(5)
  })
})
