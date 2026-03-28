import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  giftCard: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/api-auth-middleware', () => ({
  withAuth: (_perm: string, handler: (...args: unknown[]) => unknown) => handler,
}))
vi.mock('@/lib/cloud-notify', () => ({ notifyDataChanged: vi.fn() }))
vi.mock('@/lib/domain/gift-cards/schemas', () => ({
  importCardsSchema: {
    safeParse: (data: Record<string, unknown>) => {
      const cardNumbers = data.cardNumbers as string[] | undefined
      if (!cardNumbers || !Array.isArray(cardNumbers)) {
        return {
          success: false,
          error: { flatten: () => ({ fieldErrors: { cardNumbers: ['Required'] } }) },
        }
      }
      // Validate each card number
      for (const cn of cardNumbers) {
        if (cn.length < 4) {
          return {
            success: false,
            error: { flatten: () => ({ fieldErrors: { cardNumbers: ['Card number must be at least 4 characters'] } }) },
          }
        }
        if (cn.length > 30) {
          return {
            success: false,
            error: { flatten: () => ({ fieldErrors: { cardNumbers: ['Card number must be at most 30 characters'] } }) },
          }
        }
        if (!/^[A-Za-z0-9-]+$/.test(cn)) {
          return {
            success: false,
            error: { flatten: () => ({ fieldErrors: { cardNumbers: ['Card number must be alphanumeric'] } }) },
          }
        }
      }
      return { success: true, data: { cardNumbers, pins: data.pins || [] } }
    },
  },
}))

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/gift-cards/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_CTX = {
  auth: { locationId: 'loc-1', employeeId: 'emp-1' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/gift-cards/import', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses JSON body with card numbers and creates unactivated records', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([]) // no collisions
    mockDb.giftCard.createMany.mockResolvedValue({ count: 3 })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({
        cardNumbers: ['GC-0001', 'GC-0002', 'GC-0003'],
      }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.imported).toBe(3)
    expect(json.skipped).toBe(0)
    expect(json.batchId).toBeTruthy()
    expect(mockDb.giftCard.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            status: 'unactivated',
            source: 'import',
          }),
        ]),
      })
    )
  })

  it('creates unactivated records with batchId', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([])
    mockDb.giftCard.createMany.mockResolvedValue({ count: 2 })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({ cardNumbers: ['GC-1111', 'GC-2222'] }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(json.batchId).toEqual(expect.any(String))
    // Verify batchId was passed to createMany
    expect(mockDb.giftCard.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ batchId: json.batchId }),
        ]),
      })
    )
  })

  it('rejects duplicate card numbers within batch', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([])
    mockDb.giftCard.createMany.mockResolvedValue({ count: 1 })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({ cardNumbers: ['GC-DUPE', 'GC-DUPE', 'GC-UNIQ'] }),
      AUTH_CTX
    )
    const json = await res.json()

    // One should be imported, one skipped as duplicate within batch
    expect(json.imported).toBe(2) // GC-DUPE (first) + GC-UNIQ
    expect(json.skipped).toBe(1) // second GC-DUPE
    expect(json.errors).toContainEqual(
      expect.objectContaining({ error: 'Duplicate within batch' })
    )
  })

  it('skips existing card numbers in DB (collision check)', async () => {
    mockDb.giftCard.findMany.mockResolvedValue([
      { cardNumber: 'GC-EXISTS' },
    ])
    mockDb.giftCard.createMany.mockResolvedValue({ count: 1 })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({ cardNumbers: ['GC-EXISTS', 'GC-NEW-1'] }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
    expect(json.skipped).toBe(1)
    expect(json.errors).toContainEqual(
      expect.objectContaining({ error: 'Card number already exists in database' })
    )
  })

  it('returns correct imported/skipped counts', async () => {
    // 2 exist in DB, 1 duplicate within batch, 2 new
    mockDb.giftCard.findMany.mockResolvedValue([
      { cardNumber: 'GC-DB-1' },
      { cardNumber: 'GC-DB-2' },
    ])
    mockDb.giftCard.createMany.mockResolvedValue({ count: 2 })

    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({
        cardNumbers: ['GC-DB-1', 'GC-DB-2', 'GC-NEW-A', 'GC-NEW-A', 'GC-NEW-B'],
      }),
      AUTH_CTX
    )
    const json = await res.json()

    // 2 DB collisions + 1 batch duplicate = 3 skipped, 2 imported (GC-NEW-A first + GC-NEW-B)
    expect(json.imported).toBe(2)
    expect(json.skipped).toBe(3)
  })

  it('validates card number format (rejects invalid)', async () => {
    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({ cardNumbers: ['!!invalid!!'] }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
  })

  it('returns error when no card numbers provided', async () => {
    const res = await (POST as (...args: unknown[]) => Promise<Response>)(
      makeRequest({ cardNumbers: [] }),
      AUTH_CTX
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/no card numbers/i)
  })
})
