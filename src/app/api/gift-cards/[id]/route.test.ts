import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  giftCard: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn((fn: (db: typeof mockDb) => unknown) => fn(mockDb)),
}))

const mockFreezeGiftCard = vi.hoisted(() => vi.fn())
const mockUnfreezeGiftCard = vi.hoisted(() => vi.fn())
const mockAdjustGiftCardBalance = vi.hoisted(() => vi.fn())
const mockNotifyDataChanged = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/api-auth-middleware', () => ({
  withAuth: (_perm: string, handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/cloud-notify', () => ({ notifyDataChanged: mockNotifyDataChanged }))
vi.mock('@/lib/domain/gift-cards/freeze-gift-card', () => ({
  freezeGiftCard: mockFreezeGiftCard,
  unfreezeGiftCard: mockUnfreezeGiftCard,
}))
vi.mock('@/lib/domain/gift-cards/adjust-gift-card-balance', () => ({
  adjustGiftCardBalance: mockAdjustGiftCardBalance,
}))
vi.mock('@/lib/domain/gift-cards/schemas', () => ({
  freezeCardSchema: {
    safeParse: (data: Record<string, unknown>) => {
      if (!data.reason || (typeof data.reason === 'string' && data.reason.trim().length === 0)) {
        return { success: false, error: { issues: [{ message: 'Reason is required for freezing a card' }] } }
      }
      return { success: true, data: { reason: data.reason } }
    },
  },
  adjustBalanceSchema: {
    safeParse: (data: Record<string, unknown>) => {
      if (!data.notes || (typeof data.notes === 'string' && data.notes.trim().length === 0)) {
        return { success: false, error: { issues: [{ message: 'Notes are required for balance adjustments' }] } }
      }
      return { success: true, data: { amount: data.amount, notes: data.notes } }
    },
  },
}))
vi.mock('@/generated/prisma/client', () => ({
  Prisma: {
    Decimal: class MockDecimal {
      private value: number
      constructor(v: number | string) { this.value = Number(v) }
      add(other: { value?: number } & { toNumber?: () => number }) {
        const otherVal = typeof other?.value === 'number' ? other.value : Number(other)
        return new MockDecimal(this.value + otherVal)
      }
      sub(other: { value?: number } & { toNumber?: () => number }) {
        const otherVal = typeof other?.value === 'number' ? other.value : Number(other)
        return new MockDecimal(this.value - otherVal)
      }
      negated() { return new MockDecimal(-this.value) }
      greaterThan(other: { value?: number } & { toNumber?: () => number }) {
        const otherVal = typeof other?.value === 'number' ? other.value : Number(other)
        return this.value > otherVal
      }
      isZero() { return this.value === 0 }
      toNumber() { return this.value }
      toFixed(n: number) { return this.value.toFixed(n) }
      toString() { return String(this.value) }
    },
  },
}))

// ---------------------------------------------------------------------------
// Import the route handlers
// ---------------------------------------------------------------------------
import { GET, PUT } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(id: string, params?: Record<string, string>) {
  const url = new URL(`http://localhost/api/gift-cards/${id}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

function makePutRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/gift-cards/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CARD_STUB = {
  id: 'gc-1',
  locationId: 'loc-1',
  cardNumber: 'GC-AAAA-BBBB-CCCC-DDDD',
  initialBalance: 50,
  currentBalance: 25,
  status: 'active',
  expiresAt: null,
  transactions: [
    { id: 'txn-1', type: 'purchase', amount: 50, balanceBefore: 0, balanceAfter: 50, createdAt: new Date() },
    { id: 'txn-2', type: 'redemption', amount: -25, balanceBefore: 50, balanceAfter: 25, createdAt: new Date() },
  ],
}

const PARAMS_PROMISE = (id: string) => Promise.resolve({ id })

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------

describe('GET /api/gift-cards/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns card with transactions by ID', async () => {
    mockDb.giftCard.findUnique.mockResolvedValueOnce(CARD_STUB)

    const res = await GET(makeGetRequest('gc-1'), { params: PARAMS_PROMISE('gc-1') })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveProperty('cardNumber', 'GC-AAAA-BBBB-CCCC-DDDD')
    expect(json.data.transactions).toHaveLength(2)
    expect(json.data.initialBalance).toBe(50)
    expect(json.data.currentBalance).toBe(25)
  })

  it('looks up by card number (case-insensitive)', async () => {
    // First findUnique by ID returns null
    mockDb.giftCard.findUnique.mockResolvedValueOnce(null)
    // Second findUnique by cardNumber returns card
    mockDb.giftCard.findUnique.mockResolvedValueOnce(CARD_STUB)

    const res = await GET(makeGetRequest('gc-aaaa-bbbb-cccc-dddd'), {
      params: PARAMS_PROMISE('gc-aaaa-bbbb-cccc-dddd'),
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveProperty('cardNumber', 'GC-AAAA-BBBB-CCCC-DDDD')
    // Verify the second call used uppercase
    expect(mockDb.giftCard.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardNumber: 'GC-AAAA-BBBB-CCCC-DDDD' },
      })
    )
  })

  it('lazily expires cards past expiresAt', async () => {
    const expiredCard = {
      ...CARD_STUB,
      expiresAt: new Date(Date.now() - 86_400_000), // yesterday
    }
    mockDb.giftCard.findUnique.mockResolvedValueOnce(expiredCard)
    mockDb.giftCard.update.mockResolvedValue({})

    const res = await GET(makeGetRequest('gc-1'), { params: PARAMS_PROMISE('gc-1') })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe('expired')
    expect(mockDb.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'expired' },
      })
    )
  })

  it('returns 404 for nonexistent card', async () => {
    mockDb.giftCard.findUnique.mockResolvedValue(null)

    const res = await GET(makeGetRequest('gc-missing'), { params: PARAMS_PROMISE('gc-missing') })
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// Tests — PUT
// ---------------------------------------------------------------------------

describe('PUT /api/gift-cards/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  // ─── Freeze / Unfreeze ──────────────────────────────────────────────────────

  it('freeze: sets status frozen, creates transaction', async () => {
    mockFreezeGiftCard.mockResolvedValue({
      success: true,
      data: { id: 'gc-1', locationId: 'loc-1', status: 'frozen', initialBalance: 50, currentBalance: 25 },
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'freeze', reason: 'Suspected fraud', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe('frozen')
    expect(mockFreezeGiftCard).toHaveBeenCalledWith(mockDb, 'gc-1', 'Suspected fraud', 'emp-1')
  })

  it('unfreeze: sets status active, creates transaction', async () => {
    mockUnfreezeGiftCard.mockResolvedValue({
      success: true,
      data: { id: 'gc-1', locationId: 'loc-1', status: 'active', initialBalance: 50, currentBalance: 25 },
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'unfreeze', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe('active')
    expect(mockUnfreezeGiftCard).toHaveBeenCalledWith(mockDb, 'gc-1', 'emp-1')
  })

  // ─── Reload ─────────────────────────────────────────────────────────────────

  it('reload: increases balance, creates transaction', async () => {
    const cardForReload = {
      id: 'gc-1',
      locationId: 'loc-1',
      status: 'active',
      currentBalance: { add: (v: unknown) => ({ toNumber: () => 75 }), toNumber: () => 25 },
    }
    mockDb.giftCard.findUnique.mockResolvedValue(cardForReload)
    mockDb.giftCard.update.mockResolvedValue({
      id: 'gc-1',
      locationId: 'loc-1',
      status: 'active',
      initialBalance: 50,
      currentBalance: 75,
      transactions: [{ id: 'txn-r', type: 'reload', amount: 50 }],
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'reload', amount: 50, employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.currentBalance).toBe(75)
    expect(mockDb.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactions: expect.objectContaining({
            create: expect.objectContaining({ type: 'reload' }),
          }),
        }),
      })
    )
  })

  // ─── Adjust ─────────────────────────────────────────────────────────────────

  it('adjust: positive adjustment increases balance', async () => {
    mockAdjustGiftCardBalance.mockResolvedValue({
      success: true,
      data: { id: 'gc-1', locationId: 'loc-1', initialBalance: 50, currentBalance: 60, status: 'active' },
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'adjust', amount: 10, notes: 'Goodwill credit', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.currentBalance).toBe(60)
    expect(mockAdjustGiftCardBalance).toHaveBeenCalledWith(mockDb, 'gc-1', 10, 'Goodwill credit', 'emp-1')
  })

  it('adjust: negative adjustment decreases balance', async () => {
    mockAdjustGiftCardBalance.mockResolvedValue({
      success: true,
      data: { id: 'gc-1', locationId: 'loc-1', initialBalance: 50, currentBalance: 15, status: 'active' },
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'adjust', amount: -10, notes: 'Correction', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.currentBalance).toBe(15)
  })

  it('adjust: requires notes (returns 400 without)', async () => {
    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'adjust', amount: 10, employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/notes/i)
  })

  it('adjust: reactivates depleted card on positive adjustment', async () => {
    mockAdjustGiftCardBalance.mockResolvedValue({
      success: true,
      data: { id: 'gc-1', locationId: 'loc-1', initialBalance: 50, currentBalance: 10, status: 'active' },
    })

    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'adjust', amount: 10, notes: 'Reactivation credit', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe('active')
  })

  // ─── Invalid Action ─────────────────────────────────────────────────────────

  it('returns 400 for invalid action', async () => {
    const res = await (PUT as (...args: unknown[]) => Promise<Response>)(
      makePutRequest('gc-1', { action: 'invalid_action', employeeId: 'emp-1' }),
      { params: PARAMS_PROMISE('gc-1') }
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid action/i)
  })
})
