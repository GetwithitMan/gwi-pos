import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  terminal: { findFirst: vi.fn() },
  menuItem: { findMany: vi.fn() },
  category: { findMany: vi.fn() },
  employee: { findMany: vi.fn() },
  table: { findMany: vi.fn() },
  orderType: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
}))

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: Function) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

// ---------------------------------------------------------------------------
import { GET } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params?: Record<string, string>, headers?: Record<string, string>) {
  const url = new URL('http://localhost/api/sync/delta')
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { ...headers },
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

describe('GET /api/sync/delta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/authorization required/i)
  })

  it('returns 401 when terminal token is invalid', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(null)

    const res = await GET(makeRequest({ since: '1000' }, { Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid token/i)
  })

  it('returns 400 when since parameter is missing', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const res = await GET(makeRequest({}, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/since.*required/i)
  })

  it('returns 400 when since parameter is not a valid timestamp', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const res = await GET(makeRequest({ since: 'not-a-number' }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid since/i)
  })

  it('returns only records updated after the since timestamp', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const sinceMs = Date.now() - 60_000
    const updatedMenu = [{ id: 'mi-1', name: 'Updated Fries' }]
    const updatedCategories = [{ id: 'cat-1', name: 'Updated Apps' }]
    const updatedEmployees = [{ id: 'emp-1', firstName: 'Jane', role: { id: 'r1', name: 'Server', permissions: {} } }]

    mockDb.menuItem.findMany.mockResolvedValue(updatedMenu)
    mockDb.category.findMany.mockResolvedValue(updatedCategories)
    mockDb.employee.findMany.mockResolvedValue(updatedEmployees)
    mockDb.table.findMany.mockResolvedValue([])
    mockDb.orderType.findMany.mockResolvedValue([])
    mockDb.order.findMany.mockResolvedValue([])

    const res = await GET(makeRequest(
      { since: String(sinceMs) },
      { Authorization: 'Bearer valid-token' },
    ))
    const json = await res.json()

    expect(res.status).toBe(200)
    const { data } = json
    expect(data.menuItems).toEqual(updatedMenu)
    expect(data.categories).toEqual(updatedCategories)
    expect(data.employees).toEqual(updatedEmployees)
    expect(data.tables).toEqual([])
    expect(data.orderTypes).toEqual([])
    expect(data.orders).toEqual([])
    expect(data.syncVersion).toEqual(expect.any(Number))
  })

  it('passes the since Date as updatedAt gt filter to all queries', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    const sinceMs = 1700000000000

    mockDb.menuItem.findMany.mockResolvedValue([])
    mockDb.category.findMany.mockResolvedValue([])
    mockDb.employee.findMany.mockResolvedValue([])
    mockDb.table.findMany.mockResolvedValue([])
    mockDb.orderType.findMany.mockResolvedValue([])
    mockDb.order.findMany.mockResolvedValue([])

    await GET(makeRequest(
      { since: String(sinceMs) },
      { Authorization: 'Bearer valid-token' },
    ))

    const expectedSince = new Date(sinceMs)

    // All model queries should filter by updatedAt > since and locationId
    for (const model of [mockDb.menuItem, mockDb.category, mockDb.employee, mockDb.table, mockDb.orderType, mockDb.order]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'loc-1',
            updatedAt: { gt: expectedSince },
          }),
        }),
      )
    }
  })
})
