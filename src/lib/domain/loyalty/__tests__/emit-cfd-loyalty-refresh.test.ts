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
  _shouldEmitForCustomer,
  _resetRateLimitForTests,
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
// Rate limiter
// ---------------------------------------------------------------------------

describe('emitCfdLoyaltyRefresh — rate limit', () => {
  it('coalesces calls beyond 10/sec for the same customerId', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < 10; i++) {
      expect(_shouldEmitForCustomer('cust-1', now + i)).toBe(true)
    }
    // 11th call within the same window should be coalesced.
    expect(_shouldEmitForCustomer('cust-1', now + 10)).toBe(false)
    expect(_shouldEmitForCustomer('cust-1', now + 100)).toBe(false)
  })

  it('does NOT coalesce calls for different customerIds', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < 10; i++) {
      expect(_shouldEmitForCustomer('cust-A', now + i)).toBe(true)
    }
    // Different customer — fresh bucket.
    expect(_shouldEmitForCustomer('cust-B', now + 10)).toBe(true)
  })

  it('admits new calls after the rate-limit window expires', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < 10; i++) {
      _shouldEmitForCustomer('cust-1', now + i)
    }
    // Still within window — blocked.
    expect(_shouldEmitForCustomer('cust-1', now + 500)).toBe(false)
    // Past the 1-second window — allowed again.
    expect(_shouldEmitForCustomer('cust-1', now + 1500)).toBe(true)
  })

  it('skips dispatch when rate-limited (integration with main fn)', async () => {
    mockCustomerFindFirst.mockResolvedValue(baseCustomer)

    // Burn the bucket.
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      _shouldEmitForCustomer('cust-1', now)
    }

    await emitCfdLoyaltyRefresh({ customerId: 'cust-1', locationId: 'loc-1' })

    expect(mockCustomerFindFirst).not.toHaveBeenCalled()
    expect(mockDispatchLoyaltyBalance).not.toHaveBeenCalled()
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
