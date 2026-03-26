import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVenueDb = vi.hoisted(() => ({
  location: {
    findFirst: vi.fn(),
  },
  giftCard: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  getDbForVenue: vi.fn().mockResolvedValue(mockVenueDb),
}))
vi.mock('@/lib/site-api-schemas', () => ({
  GiftCardBalanceSchema: {
    parse: (data: Record<string, unknown>) => {
      if (!data.number || !data.slug) throw new Error('Invalid')
      return { number: data.number, pin: data.pin, slug: data.slug }
    },
  },
}))
vi.mock('@/lib/online-rate-limiter', () => ({
  checkOnlineRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}))

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/public/gift-cards/balance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify(body),
  })
}

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gc-1',
    cardNumber: 'GC-AAAA-BBBB-1234',
    currentBalance: 50,
    status: 'active',
    expiresAt: null,
    frozenAt: null,
    pin: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/public/gift-cards/balance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVenueDb.location.findFirst.mockResolvedValue({ id: 'loc-1' })
  })

  it('returns balance for active card with correct PIN', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({ pin: '1234', currentBalance: 75 })
    )

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      pin: '1234',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.valid).toBe(true)
    expect(json.balance).toBe(75)
    expect(json.last4).toBe('1234')
  })

  it('returns error for wrong PIN', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({ pin: '1234' })
    )

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      pin: '9999',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(false)
    expect(json.reason).toMatch(/invalid pin/i)
  })

  it('returns error for inactive card (depleted)', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({ status: 'depleted' })
    )

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(false)
    expect(json.reason).toMatch(/zero balance/i)
  })

  it('returns error for frozen card', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({ status: 'active', frozenAt: new Date() })
    )

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(false)
    expect(json.reason).toMatch(/suspended/i)
  })

  it('lazily updates expired cards', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({
        status: 'active',
        expiresAt: new Date(Date.now() - 86_400_000), // yesterday
      })
    )
    mockVenueDb.giftCard.updateMany.mockResolvedValue({})

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(false)
    expect(json.reason).toMatch(/expired/i)
    // Verify lazy expiry update was triggered (fire-and-forget)
    expect(mockVenueDb.giftCard.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'expired' },
      })
    )
  })

  it('returns error for card not found', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({
      number: 'GC-DOESNT-EXIST',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(false)
    expect(json.reason).toMatch(/not found/i)
  })

  it('returns active card without PIN when no PIN set', async () => {
    mockVenueDb.giftCard.findFirst.mockResolvedValue(
      makeCard({ pin: null, currentBalance: 100 })
    )

    const res = await POST(makeRequest({
      number: 'GC-AAAA-BBBB-1234',
      slug: 'test-venue',
    }))
    const json = await res.json()

    expect(json.valid).toBe(true)
    expect(json.balance).toBe(100)
  })

  it('returns 400 for invalid request body', async () => {
    const res = await POST(makeRequest({ invalid: true }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid request/i)
  })
})
