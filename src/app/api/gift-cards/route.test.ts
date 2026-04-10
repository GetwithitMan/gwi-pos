import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  giftCard: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  location: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn((fn: (db: typeof mockDb) => unknown) => fn(mockDb)),
  $queryRawUnsafe: vi.fn(),
}))

const mockAllocatePooledGiftCard = vi.hoisted(() => vi.fn())
const mockActivateGiftCard = vi.hoisted(() => vi.fn())
const mockSendGiftCardEmail = vi.hoisted(() => vi.fn())
const mockNotifyDataChanged = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/api-auth-middleware', () => ({
  withAuth: (_perm: string, handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/cloud-notify', () => ({ notifyDataChanged: mockNotifyDataChanged }))
vi.mock('@/lib/gift-card-email', () => ({ sendGiftCardEmail: mockSendGiftCardEmail }))
vi.mock('@/lib/settings', () => ({
  parseSettings: vi.fn((settings: unknown) => {
    const s = settings as Record<string, unknown> | null
    return {
      payments: s?.payments || { giftCardPoolMode: 'open' },
    }
  }),
}))
vi.mock('@/lib/domain/gift-cards/allocate-pooled-gift-card', () => ({
  allocatePooledGiftCard: mockAllocatePooledGiftCard,
}))
vi.mock('@/lib/domain/gift-cards/activate-gift-card', () => ({
  activateGiftCard: mockActivateGiftCard,
}))

// ---------------------------------------------------------------------------
// Import the route handlers
// ---------------------------------------------------------------------------
import { GET, POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/gift-cards')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/gift-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CARD_STUB = {
  id: 'gc-1',
  locationId: 'loc-1',
  cardNumber: 'GC-AAAA-BBBB-CCCC-DDDD',
  initialBalance: { toNumber: () => 50 },
  currentBalance: { toNumber: () => 50 },
  status: 'active',
  source: 'manual',
  _count: { transactions: 1 },
  createdAt: new Date(),
}

const AUTH_CTX = {
  auth: { locationId: 'loc-1', employeeId: 'emp-1' },
}

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------

describe('GET /api/gift-cards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns cards filtered by locationId', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([CARD_STUB])

    const res = await GET(makeGetRequest({ locationId: 'loc-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data[0]).toHaveProperty('cardNumber', 'GC-AAAA-BBBB-CCCC-DDDD')
    expect(mockDb.giftCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locationId: 'loc-1' }),
      })
    )
  })

  it('returns 400 when locationId is missing', async () => {
    const res = await GET(makeGetRequest({}))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/locationId/i)
  })

  it('filters by status', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([])

    await GET(makeGetRequest({ locationId: 'loc-1', status: 'frozen' }))

    expect(mockDb.giftCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'frozen' }),
      })
    )
  })

  it('filters by search term (card number)', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([])

    await GET(makeGetRequest({ locationId: 'loc-1', search: 'GC-AAAA' }))

    expect(mockDb.giftCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ cardNumber: { contains: 'GC-AAAA' } }),
          ]),
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — POST
// ---------------------------------------------------------------------------

describe('POST /api/gift-cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.location.findUnique.mockResolvedValue({
      name: 'Test Venue',
      address: '123 Main St',
      settings: { payments: { giftCardPoolMode: 'open' } },
    })
    mockSendGiftCardEmail.mockResolvedValue(undefined)
  })

  it('creates gift card with amount in open mode', async () => {
    mockDb.giftCard.findUnique.mockResolvedValue(null) // no collision
    mockDb.giftCard.create.mockResolvedValue({
      id: 'gc-new',
      cardNumber: 'GC-1234-5678-9012-3456',
      initialBalance: 25,
      currentBalance: 25,
      status: 'active',
      source: 'manual',
      transactions: [{ id: 'txn-1', type: 'purchase', amount: 25 }],
    })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ amount: 25, orderId: 'order-1' }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data).toHaveProperty('cardNumber')
    expect(json.data.initialBalance).toBe(25)
  })

  it('returns 400 when amount is missing', async () => {
    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ orderId: 'order-1' }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/amount/i)
  })

  it('returns 400 when amount is zero or negative', async () => {
    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ amount: 0, orderId: 'order-1' }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/positive amount/i)
  })

  it('in pool mode calls allocatePooledGiftCard', async () => {
    mockDb.location.findUnique.mockResolvedValue({
      name: 'Pool Venue',
      address: '456 Pool St',
      settings: { payments: { giftCardPoolMode: 'pool' } },
    })
    mockAllocatePooledGiftCard.mockResolvedValue({ success: true, cardId: 'gc-pool-1' })
    mockActivateGiftCard.mockResolvedValue({
      success: true,
      data: {
        id: 'gc-pool-1',
        cardNumber: 'POOL-0001',
        initialBalance: 50,
        currentBalance: 50,
        status: 'active',
      },
    })
    mockDb.giftCard.update = vi.fn()

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ amount: 50, orderId: 'order-2' }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(mockAllocatePooledGiftCard).toHaveBeenCalled()
    expect(mockActivateGiftCard).toHaveBeenCalledWith(
      expect.anything(),
      'gc-pool-1',
      50,
      'emp-1',
      expect.any(Object)
    )
  })

  it('in pool mode with empty pool returns 400', async () => {
    mockDb.location.findUnique.mockResolvedValue({
      name: 'Pool Venue',
      address: '456 Pool St',
      settings: { payments: { giftCardPoolMode: 'pool' } },
    })
    mockAllocatePooledGiftCard.mockResolvedValue({
      success: false,
      error: 'No card numbers available in the pool. Import more card numbers.',
    })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ amount: 50, orderId: 'order-3' }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/pool/i)
  })

  it('sends email when recipientEmail is provided (fire-and-forget)', async () => {
    mockDb.giftCard.findUnique.mockResolvedValue(null)
    mockDb.giftCard.create.mockResolvedValue({
      id: 'gc-email',
      cardNumber: 'GC-EMAIL-TEST',
      initialBalance: 30,
      currentBalance: 30,
      status: 'active',
      source: 'manual',
      transactions: [{ id: 'txn-e', type: 'purchase', amount: 30 }],
    })

    await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({
        amount: 30,
        recipientEmail: 'test@example.com',
        recipientName: 'Jane',
        orderId: 'order-4',
      }),
      AUTH_CTX
    )

    expect(mockSendGiftCardEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'test@example.com',
        recipientName: 'Jane',
        cardCode: 'GC-EMAIL-TEST',
        balance: 30,
      })
    )
  })

  it('with source manual when open mode', async () => {
    mockDb.giftCard.findUnique.mockResolvedValue(null)
    mockDb.giftCard.create.mockResolvedValue({
      id: 'gc-src',
      cardNumber: 'GC-SRC-TEST',
      initialBalance: 20,
      currentBalance: 20,
      status: 'active',
      source: 'manual',
      transactions: [],
    })

    await (POST as (...args: unknown[]) => Promise<Response>)(
      makePostRequest({ amount: 20, orderId: 'order-5' }),
      AUTH_CTX
    )

    expect(mockDb.giftCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'manual' }),
      })
    )
  })
})
