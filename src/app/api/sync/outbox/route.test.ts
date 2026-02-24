import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const { mockDb, mockTx } = vi.hoisted(() => {
  const mockTx = {
    $queryRawUnsafe: vi.fn(),
    order: { create: vi.fn() },
  }
  const mockDb = {
    terminal: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
    $transaction: vi.fn((fn: Function) => fn(mockTx)),
  }
  return { mockDb, mockTx }
})

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: Function) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/socket-server', () => ({
  emitToLocation: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/sync/outbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const TERMINAL_STUB = {
  id: 'term-1',
  locationId: 'loc-1',
  name: 'Register 1',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/sync/outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no existing order, next orderNumber is 1
    mockTx.$queryRawUnsafe.mockResolvedValue([])
    mockDb.order.findFirst.mockResolvedValue(null)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest({ orders: [] }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/authorization required/i)
  })

  it('returns 401 when terminal token is invalid', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({ orders: [] }, { Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid token/i)
  })

  it('creates an order with generated orderNumber and returns synced structure', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.order.findFirst.mockResolvedValue(null) // not a duplicate

    const createdOrder = { id: 'order-srv-1', orderNumber: 1, offlineId: 'offline-1' }
    mockTx.$queryRawUnsafe.mockResolvedValue([{ orderNumber: 5 }]) // last order was #5
    mockTx.order.create.mockResolvedValue(createdOrder)

    const res = await POST(makeRequest({
      orders: [{
        offlineId: 'offline-1',
        employeeId: 'emp-1',
        status: 'open',
        subtotal: 10.5,
        tax: 0.87,
        total: 11.37,
        items: [{ menuItemId: 'mi-1', name: 'Burger', quantity: 1, price: 10.5 }],
      }],
    }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.synced.orders).toHaveLength(1)
    expect(json.data.synced.orders[0]).toEqual({
      offlineId: 'offline-1',
      serverId: 'order-srv-1',
    })
    expect(json.data.errors).toHaveLength(0)

    // Verify orderNumber is incremented from last (5 → 6)
    expect(mockTx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderNumber: 6,
          locationId: 'loc-1',
          offlineId: 'offline-1',
          employeeId: 'emp-1',
        }),
      }),
    )
  })

  it('is idempotent — same offlineId does not create a duplicate', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    // Simulate order already synced
    const existingOrder = { id: 'order-srv-1', offlineId: 'offline-1' }
    mockDb.order.findFirst.mockResolvedValue(existingOrder)

    const res = await POST(makeRequest({
      orders: [{ offlineId: 'offline-1', employeeId: 'emp-1', subtotal: 10, tax: 0, total: 10 }],
    }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.synced.orders).toEqual([
      { offlineId: 'offline-1', serverId: 'order-srv-1' },
    ])
    // $transaction should NOT have been called — skip creation for existing order
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('returns { synced, errors } structure', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.order.findFirst.mockResolvedValue(null)

    mockTx.$queryRawUnsafe.mockResolvedValue([])
    mockTx.order.create.mockResolvedValue({ id: 'order-1', offlineId: 'off-1' })

    const res = await POST(makeRequest({
      orders: [{ offlineId: 'off-1', employeeId: 'emp-1', subtotal: 5, tax: 0, total: 5 }],
    }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(json.data).toHaveProperty('synced')
    expect(json.data).toHaveProperty('errors')
    expect(json.data.synced).toHaveProperty('orders')
    expect(Array.isArray(json.data.errors)).toBe(true)
  })

  it('handles empty orders array gracefully', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const res = await POST(makeRequest({ orders: [] }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.synced.orders).toHaveLength(0)
    expect(json.data.errors).toHaveLength(0)
  })

  it('records error for order missing offlineId', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const res = await POST(makeRequest({
      orders: [{ employeeId: 'emp-1', subtotal: 5, tax: 0, total: 5 }],
    }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.errors).toHaveLength(1)
    expect(json.data.errors[0]).toMatchObject({
      offlineId: 'unknown',
      error: expect.stringMatching(/offlineId.*required/i),
    })
  })

  it('syncs multiple orders in a single request', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.order.findFirst.mockResolvedValue(null)

    mockTx.$queryRawUnsafe.mockResolvedValue([])
    let callCount = 0
    mockTx.order.create.mockImplementation(() => {
      callCount++
      return Promise.resolve({ id: `order-${callCount}`, offlineId: `off-${callCount}` })
    })

    const res = await POST(makeRequest({
      orders: [
        { offlineId: 'off-1', employeeId: 'emp-1', subtotal: 5, tax: 0, total: 5 },
        { offlineId: 'off-2', employeeId: 'emp-1', subtotal: 8, tax: 0.66, total: 8.66 },
      ],
    }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(json.data.synced.orders).toHaveLength(2)
    expect(json.data.errors).toHaveLength(0)
  })
})
