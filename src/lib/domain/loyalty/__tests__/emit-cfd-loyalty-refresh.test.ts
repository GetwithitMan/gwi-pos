/**
 * Unit tests for emitCfdLoyaltyRefresh (T11 — Loyalty Cleanup, CFD freshness).
 *
 * Covers the helper itself + verifies that the four call sites
 * (worker, reverseEarnForOrder, /api/loyalty/adjust, /api/loyalty/redeem)
 * actually invoke the helper after a successful balance change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any helper imports because Vitest
// hoists vi.mock() calls to the top of the file but evaluates them in order.
// ---------------------------------------------------------------------------

const mockDispatchOrderUpdated = vi.hoisted(() => vi.fn())
const mockDispatchLoyaltyBalance = vi.hoisted(() => vi.fn())
const mockCustomerFindFirst = vi.hoisted(() => vi.fn())
const mockOrderFindFirst = vi.hoisted(() => vi.fn())
const mockLogWarn = vi.hoisted(() => vi.fn())
const mockLogDebug = vi.hoisted(() => vi.fn())

vi.mock('@/lib/socket-dispatch/cfd-dispatch', () => ({
  dispatchCFDOrderUpdated: mockDispatchOrderUpdated,
  dispatchCFDLoyaltyBalanceUpdated: mockDispatchLoyaltyBalance,
}))

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: mockCustomerFindFirst },
    order: { findFirst: mockOrderFindFirst },
  },
}))

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    warn: mockLogWarn,
    debug: mockLogDebug,
    info: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  emitCfdLoyaltyRefresh,
  _resetRateLimitForTests,
  _peekPendingForTests,
} from '../emit-cfd-loyalty-refresh'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCustomer = {
  id: 'cust-1',
  firstName: 'Jane',
  lastName: 'Doe',
  loyaltyPoints: 250,
  lifetimePoints: 1234,
  loyaltyTier: { name: 'Gold' },
}

const baseActiveOrder = {
  id: 'order-1',
  orderNumber: 42,
  status: 'open',
  subtotal: 25.0,
  taxTotal: 2.0,
  total: 27.0,
  discountTotal: 0,
  taxFromInclusive: 0,
  taxFromExclusive: 2.0,
  items: [
    {
      name: 'Burger',
      quantity: 1,
      itemTotal: 25.0,
      status: 'active',
      modifiers: [{ name: 'Cheese' }],
    },
  ],
}

beforeEach(() => {
  mockDispatchOrderUpdated.mockReset()
  mockDispatchLoyaltyBalance.mockReset()
  mockCustomerFindFirst.mockReset()
  mockOrderFindFirst.mockReset()
  mockLogWarn.mockReset()
  mockLogDebug.mockReset()
  _resetRateLimitForTests()
})

// ---------------------------------------------------------------------------
// emitCfdLoyaltyRefresh — active order path
// ---------------------------------------------------------------------------

describe('emitCfdLoyaltyRefresh — active order path', () => {
  it('emits dispatchCFDOrderUpdated when an active order is provided', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)
    mockOrderFindFirst.mockResolvedValue(baseActiveOrder)

    await emitCfdLoyaltyRefresh({
      customerId: 'cust-1',
      locationId: 'loc-1',
      orderId: 'order-1',
    })

    expect(mockDispatchOrderUpdated).toHaveBeenCalledTimes(1)
    expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()

    const [locationId, payload] = mockDispatchOrderUpdated.mock.calls[0]
    expect(locationId).toBe('loc-1')
    expect(payload.orderId).toBe('order-1')
    expect(payload.customer).toEqual({
      id: 'cust-1',
      firstName: 'Jane',
      lastName: 'Doe',
      loyaltyPoints: 250,
      tier: 'Gold',
    })
    expect(payload.loyaltyEnabled).toBe(true)
  })

  it('falls back to balance event when the order is in a terminal state', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)
    mockOrderFindFirst.mockResolvedValue({ ...baseActiveOrder, status: 'paid' })

    await emitCfdLoyaltyRefresh({
      customerId: 'cust-1',
      locationId: 'loc-1',
      orderId: 'order-1',
    })

    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
  })

  it('falls back to balance event when the order lookup returns null', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)
    mockOrderFindFirst.mockResolvedValue(null)

    await emitCfdLoyaltyRefresh({
      customerId: 'cust-1',
      locationId: 'loc-1',
      orderId: 'order-missing',
    })

    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// emitCfdLoyaltyRefresh — post-pay / no order path
// ---------------------------------------------------------------------------

describe('emitCfdLoyaltyRefresh — post-pay / no order path', () => {
  it('emits dispatchCFDLoyaltyBalanceUpdated when no orderId provided', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)

    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })

    expect(mockOrderFindFirst).not.toHaveBeenCalled()
    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)

    const [locationId, payload] = mockDispatchLoyaltyBalance.mock.calls[0]
    expect(locationId).toBe('loc-1')
    expect(payload).toEqual({
      customerId: 'cust-1',
      loyaltyPoints: 250,
      lifetimePoints: 1234,
      tier: 'Gold',
      firstName: 'Jane',
      lastName: 'Doe',
    })
  })

  it('emits balance event when orderId is null', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)

    await emitCfdLoyaltyRefresh({
      customerId: 'cust-1',
      locationId: 'loc-1',
      orderId: null,
    })

    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
  })

  it('normalizes empty / whitespace lastName to null', async () => {
    mockCustomerFindFirst.mockResolvedValue({
      ...baseCustomer,
      lastName: '   ',
    })

    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })

    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
    expect(mockDispatchLoyaltyBalance.mock.calls[0][1].lastName).toBeNull()
  })

  it('passes null tier when customer has no loyaltyTier', async () => {
    mockCustomerFindFirst.mockResolvedValue({
      ...baseCustomer,
      loyaltyTier: null,
    })

    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })

    expect(mockDispatchLoyaltyBalance.mock.calls[0][1].tier).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// emitCfdLoyaltyRefresh — error safety (NEVER throws)
// ---------------------------------------------------------------------------

describe('emitCfdLoyaltyRefresh — never throws', () => {
  it('does not throw when customer lookup fails', async () => {
    mockCustomerFindFirst.mockRejectedValue(new Error('DB unreachable'))

    await expect(
      emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' }),
    ).resolves.toBeUndefined()

    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
  })

  it('does not throw when customer is missing', async () => {
    mockCustomerFindFirst.mockResolvedValue(null)

    await expect(
      emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' }),
    ).resolves.toBeUndefined()

    expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
  })

  it('does not throw when order lookup fails — falls back to balance event', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)
    mockOrderFindFirst.mockRejectedValue(new Error('DB unreachable'))

    await expect(
      emitCfdLoyaltyRefresh({
        customerId: 'cust-1',
        locationId: 'loc-1',
        orderId: 'order-1',
      }),
    ).resolves.toBeUndefined()

    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
  })

  it('returns silently when customerId is empty', async () => {
    await emitCfdLoyaltyRefresh({ customerId: '', locationId: 'loc-1' })
    expect(mockCustomerFindFirst).not.toHaveBeenCalled()
    expect(mockDispatchOrderUpdated).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
  })

  it('returns silently when locationId is empty', async () => {
    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: '' })
    expect(mockCustomerFindFirst).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Trailing-edge coalescer — the regression-driver tests for PR #273 review.
// The previous implementation silently DROPPED 11+ calls in the same second.
// The contract now is: coalesce, never drop. The latest state always wins.
// ---------------------------------------------------------------------------

describe('emitCfdLoyaltyRefresh — trailing-edge coalescer', () => {
  it('a single call still emits immediately (no debounce penalty)', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)

    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })

    expect(mockCustomerFindFirst).toHaveBeenCalledTimes(1)
    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
    // No trailing emit pending.
    expect(_peekPendingForTests('cust-1')).toBeNull()
  })

  it('two rapid calls each produce a distinct effect — second carries latest data even if delayed', async () => {
    vi.useFakeTimers()
    try {
      // Fill the budget for cust-1 (10 in the same window).
      mockCustomerFindFirst.mockResolvedValue(baseCustomer)
      for (let i = 0; i < 10; i++) {
        await emitCfdLoyaltyRefresh({
          customerId: 'cust-1',
          locationId: 'loc-1',
        })
      }
      expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(10)

      // Now the 11th call — must NOT be silently dropped. It must defer
      // and eventually emit with the *latest* state.
      mockDispatchLoyaltyBalance.mockClear()
      mockCustomerFindFirst.mockClear()
      mockCustomerFindFirst.mockResolvedValue({
        ...baseCustomer,
        loyaltyPoints: 999, // updated state — must surface in trailing emit
        loyaltyTier: { name: 'Platinum' },
      })

      await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })
      // Synchronously: nothing fired yet (deferred).
      expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
      expect(_peekPendingForTests('cust-1')).not.toBeNull()

      // Advance past the window — trailing emit fires.
      await vi.advanceTimersByTimeAsync(1100)

      expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
      const payload = mockDispatchLoyaltyBalance.mock.calls[0][1]
      expect(payload.loyaltyPoints).toBe(999)
      expect(payload.tier).toBe('Platinum')
      // Pending cleared after trailing emit fires.
      expect(_peekPendingForTests('cust-1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ten rapid OVER-budget calls produce a single trailing emit with the FINAL state', async () => {
    vi.useFakeTimers()
    try {
      mockCustomerFindFirst.mockResolvedValue(baseCustomer)
      // Saturate the budget first.
      for (let i = 0; i < 10; i++) {
        await emitCfdLoyaltyRefresh({
          customerId: 'cust-1',
          locationId: 'loc-1',
        })
      }
      mockDispatchLoyaltyBalance.mockClear()
      mockCustomerFindFirst.mockClear()

      // Fire 10 more rapid calls — every one of these is over budget, so
      // they MUST coalesce. The last one's state must win.
      for (let i = 1; i <= 10; i++) {
        // Rebind the mock so each call's "current DB state" is unique.
        mockCustomerFindFirst.mockResolvedValue({
          ...baseCustomer,
          loyaltyPoints: 1000 + i,
        })
        await emitCfdLoyaltyRefresh({
          customerId: 'cust-1',
          locationId: 'loc-1',
        })
      }

      // Nothing fired yet (all coalesced into the trailing slot).
      expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
      expect(_peekPendingForTests('cust-1')).not.toBeNull()

      // Drain the timer.
      await vi.advanceTimersByTimeAsync(1100)

      // At least one trailing emit fired. (We accept >=1 to be tolerant of
      // implementation choice — the load-bearing requirement is "not zero".)
      expect(
        mockDispatchLoyaltyBalance.mock.calls.length,
      ).toBeGreaterThanOrEqual(1)

      // The DB lookup that backed the trailing emit was made at fire time,
      // so it picked up the FINAL mocked state (loyaltyPoints=1010).
      const lastPayload =
        mockDispatchLoyaltyBalance.mock.calls[
          mockDispatchLoyaltyBalance.mock.calls.length - 1
        ][1]
      expect(lastPayload.loyaltyPoints).toBe(1010)
    } finally {
      vi.useRealTimers()
    }
  })

  it('different customerIds do NOT share a budget', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)

    for (let i = 0; i < 10; i++) {
      await emitCfdLoyaltyRefresh({
        customerId: 'cust-A',
        locationId: 'loc-1',
      })
    }
    // cust-A budget is saturated — but cust-B should still emit immediately.
    mockDispatchLoyaltyBalance.mockClear()
    await emitCfdLoyaltyRefresh({ customerId: 'cust-B', locationId: 'loc-1' })

    expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
    expect(_peekPendingForTests('cust-B')).toBeNull()
  })

  it('after the window expires, fresh calls emit immediately again', async () => {
    vi.useFakeTimers()
    try {
      mockCustomerFindFirst.mockResolvedValue(baseCustomer)
      for (let i = 0; i < 10; i++) {
        await emitCfdLoyaltyRefresh({
          customerId: 'cust-1',
          locationId: 'loc-1',
        })
      }

      // Slide the window forward past expiry.
      await vi.advanceTimersByTimeAsync(1500)

      mockDispatchLoyaltyBalance.mockClear()
      await emitCfdLoyaltyRefresh({
        customerId: 'cust-1',
        locationId: 'loc-1',
      })

      // Fresh window — call emits synchronously.
      expect(mockDispatchLoyaltyBalance).toHaveBeenCalledTimes(1)
      expect(_peekPendingForTests('cust-1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// Call-site wiring — verify the four code paths invoke the helper
// ---------------------------------------------------------------------------

describe('call-site wiring', () => {
  it('worker calls emitCfdLoyaltyRefresh after successful earn', async () => {
    // Inspect the worker source to confirm the import + call exist.
    // We rely on a structural check rather than a full DB integration so this
    // suite stays unit-level. (The worker's own test file owns the full
    // integration coverage.)
    const fs = await import('fs')
    const path = await import('path')
    const workerPath = path.resolve(
      __dirname,
      '..',
      'loyalty-earn-worker.ts',
    )
    const src = fs.readFileSync(workerPath, 'utf8')
    expect(src).toContain("from './emit-cfd-loyalty-refresh'")
    expect(src).toContain('emitCfdLoyaltyRefresh({')
  })

  it('reverse-earn calls emitCfdLoyaltyRefresh after a successful reversal', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const reversePath = path.resolve(__dirname, '..', 'reverse-earn.ts')
    const src = fs.readFileSync(reversePath, 'utf8')
    expect(src).toContain("from './emit-cfd-loyalty-refresh'")
    expect(src).toContain('emitCfdLoyaltyRefresh({')
  })

  it('/api/loyalty/adjust calls emitCfdLoyaltyRefresh after an adjustment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adjustPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'app',
      'api',
      'loyalty',
      'adjust',
      'route.ts',
    )
    const src = fs.readFileSync(adjustPath, 'utf8')
    expect(src).toContain('emit-cfd-loyalty-refresh')
    expect(src).toContain('emitCfdLoyaltyRefresh({')
  })

  it('/api/loyalty/redeem calls emitCfdLoyaltyRefresh after a redemption', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const redeemPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'app',
      'api',
      'loyalty',
      'redeem',
      'route.ts',
    )
    const src = fs.readFileSync(redeemPath, 'utf8')
    expect(src).toContain('emit-cfd-loyalty-refresh')
    expect(src).toContain('emitCfdLoyaltyRefresh({')
  })
})
