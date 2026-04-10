import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

// The route uses both `db` (local PG) and `adminDb` (admin queries).
// `db` is used for: category, table, orderType, pricingOptionGroup, modifierGroup
// `adminDb` is used for: menuItem, employee, order

const mockDb = vi.hoisted(() => ({
  category: { findMany: vi.fn() },
  table: { findMany: vi.fn() },
  orderType: { findMany: vi.fn() },
  pricingOptionGroup: { findMany: vi.fn() },
  modifierGroup: { findMany: vi.fn() },
}))

const mockAdminDb = vi.hoisted(() => ({
  menuItem: { findMany: vi.fn() },
  employee: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
}))

const mockAuthenticateTerminal = vi.hoisted(() => vi.fn())

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb, adminDb: mockAdminDb }))

vi.mock('@/lib/terminal-auth', () => ({
  authenticateTerminal: mockAuthenticateTerminal,
}))

// withAuth wraps the handler; pass through for tests
vi.mock('@/lib/api-auth-middleware', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) => handler ?? _opts,
}))

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

/** Stub all db/adminDb findMany calls to return empty results */
function stubEmptyDefaults() {
  mockDb.category.findMany.mockResolvedValue([])
  mockDb.table.findMany.mockResolvedValue([])
  mockDb.orderType.findMany.mockResolvedValue([])
  mockDb.pricingOptionGroup.findMany.mockResolvedValue([])
  mockDb.modifierGroup.findMany.mockResolvedValue([])
  mockAdminDb.menuItem.findMany.mockResolvedValue([])
  mockAdminDb.employee.findMany.mockResolvedValue([])
  mockAdminDb.order.findMany.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sync/delta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when Authorization header is missing', async () => {
    mockAuthenticateTerminal.mockResolvedValue({
      error: NextResponse.json({ error: 'Authorization required' }, { status: 401 }),
    })

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/authorization required/i)
  })

  it('returns 401 when terminal token is invalid', async () => {
    mockAuthenticateTerminal.mockResolvedValue({
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    })

    const res = await GET(makeRequest({ since: '1000' }, { Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid token/i)
  })

  it('returns 400 when since parameter is missing', async () => {
    mockAuthenticateTerminal.mockResolvedValue({ terminal: TERMINAL_STUB })

    const res = await GET(makeRequest({}, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/since.*required/i)
  })

  it('returns 400 when since parameter is not a valid timestamp', async () => {
    mockAuthenticateTerminal.mockResolvedValue({ terminal: TERMINAL_STUB })

    const res = await GET(makeRequest({ since: 'not-a-number' }, { Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid since/i)
  })

  it('returns only records updated after the since timestamp', async () => {
    mockAuthenticateTerminal.mockResolvedValue({ terminal: TERMINAL_STUB })
    stubEmptyDefaults()

    const sinceMs = Date.now() - 60_000
    const updatedMenu = [{ id: 'mi-1', name: 'Updated Fries', price: null, cost: null, pricePerWeightUnit: null, ownedModifierGroups: [] }]
    const updatedCategories = [{ id: 'cat-1', name: 'Updated Apps' }]
    const updatedEmployees = [{ id: 'emp-1', firstName: 'Jane', role: { id: 'r1', name: 'Server', permissions: {} } }]

    mockAdminDb.menuItem.findMany.mockResolvedValue(updatedMenu)
    mockDb.category.findMany.mockResolvedValue(updatedCategories)
    mockAdminDb.employee.findMany.mockResolvedValue(updatedEmployees)
    mockDb.table.findMany.mockResolvedValue([])
    mockDb.orderType.findMany.mockResolvedValue([])
    mockAdminDb.order.findMany.mockResolvedValue([])

    const res = await GET(makeRequest(
      { since: String(sinceMs) },
      { Authorization: 'Bearer valid-token' },
    ))
    const json = await res.json()

    expect(res.status).toBe(200)
    const { data } = json
    expect(data.menuItems).toHaveLength(1)
    expect(data.menuItems[0]).toMatchObject({ id: 'mi-1', name: 'Updated Fries' })
    expect(data.categories).toEqual(updatedCategories)
    expect(data.employees).toEqual(updatedEmployees)
    expect(data.tables).toEqual([])
    expect(data.orderTypes).toEqual([])
    expect(data.orders).toEqual([])
    expect(data.syncVersion).toEqual(expect.any(Number))
  })

  it('passes the since Date as updatedAt gt filter to all queries', async () => {
    mockAuthenticateTerminal.mockResolvedValue({ terminal: TERMINAL_STUB })
    stubEmptyDefaults()
    const sinceMs = 1700000000000

    await GET(makeRequest(
      { since: String(sinceMs) },
      { Authorization: 'Bearer valid-token' },
    ))

    const expectedSince = new Date(sinceMs)

    // adminDb models: menuItem, employee, order
    for (const model of [mockAdminDb.menuItem, mockAdminDb.employee, mockAdminDb.order]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationId: 'loc-1',
            updatedAt: { gt: expectedSince },
          }),
        }),
      )
    }

    // db models: category, table, orderType
    for (const model of [mockDb.category, mockDb.table, mockDb.orderType]) {
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
