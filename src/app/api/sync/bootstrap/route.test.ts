import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  terminal: { findFirst: vi.fn() },
  category: { findMany: vi.fn() },
  employee: { findMany: vi.fn() },
  table: { findMany: vi.fn() },
  orderType: { findMany: vi.fn() },
  location: { findUnique: vi.fn() },
  paymentReader: { findMany: vi.fn() },
  printer: { findMany: vi.fn() },
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

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/sync/bootstrap', {
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

describe('GET /api/sync/bootstrap', () => {
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

    const res = await GET(makeRequest({ Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid token/i)
  })

  it('returns full bootstrap data structure for authenticated request', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)

    const mockCategories = [
      { id: 'cat-1', name: 'Appetizers', menuItems: [{ id: 'mi-1', name: 'Fries' }] },
    ]
    const mockEmployees = [
      { id: 'emp-1', firstName: 'John', lastName: 'Doe', displayName: 'John D', pin: '1234', locationId: 'loc-1', role: { id: 'role-1', name: 'Server', permissions: {} } },
    ]
    const mockTables = [{ id: 'tbl-1', name: 'Table 1' }]
    const mockOrderTypes = [{ id: 'ot-1', name: 'Dine In' }]
    const mockLocation = { id: 'loc-1', name: 'Main', settings: { tax: { defaultRate: 8.25 } }, timezone: 'America/Chicago' }
    const mockPaymentReaders = [{ id: 'pr-1', name: 'Reader 1' }]
    const mockPrinters = [{ id: 'prt-1', name: 'Kitchen Printer' }]

    mockDb.category.findMany.mockResolvedValue(mockCategories)
    mockDb.employee.findMany.mockResolvedValue(mockEmployees)
    mockDb.table.findMany.mockResolvedValue(mockTables)
    mockDb.orderType.findMany.mockResolvedValue(mockOrderTypes)
    mockDb.location.findUnique.mockResolvedValue(mockLocation)
    mockDb.paymentReader.findMany.mockResolvedValue(mockPaymentReaders)
    mockDb.printer.findMany.mockResolvedValue(mockPrinters)

    const res = await GET(makeRequest({ Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    const { data } = json

    // Verify full bootstrap structure
    expect(data).toHaveProperty('menu')
    expect(data.menu.categories).toEqual(mockCategories)
    expect(data).toHaveProperty('employees')
    expect(data.employees).toHaveLength(1)
    expect(data.employees[0]).toMatchObject({ id: 'emp-1', firstName: 'John' })
    expect(data).toHaveProperty('tables')
    expect(data.tables).toEqual(mockTables)
    expect(data).toHaveProperty('orderTypes')
    expect(data.orderTypes).toEqual(mockOrderTypes)
    expect(data).toHaveProperty('taxRate')
    expect(data.taxRate).toBeCloseTo(0.0825)
    expect(data).toHaveProperty('locationSettings')
    expect(data).toHaveProperty('paymentReaders')
    expect(data.paymentReaders).toEqual(mockPaymentReaders)
    expect(data).toHaveProperty('printers')
    expect(data.printers).toEqual(mockPrinters)
    expect(data).toHaveProperty('syncVersion')
    expect(data.syncVersion).toEqual(expect.any(Number))
  })

  it('returns taxRate of 0 when location has no tax settings', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.category.findMany.mockResolvedValue([])
    mockDb.employee.findMany.mockResolvedValue([])
    mockDb.table.findMany.mockResolvedValue([])
    mockDb.orderType.findMany.mockResolvedValue([])
    mockDb.location.findUnique.mockResolvedValue({ id: 'loc-1', name: 'Main', settings: {}, timezone: null })
    mockDb.paymentReader.findMany.mockResolvedValue([])
    mockDb.printer.findMany.mockResolvedValue([])

    const res = await GET(makeRequest({ Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(json.data.taxRate).toBe(0)
  })

  it('queries all data scoped to the terminal locationId', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.category.findMany.mockResolvedValue([])
    mockDb.employee.findMany.mockResolvedValue([])
    mockDb.table.findMany.mockResolvedValue([])
    mockDb.orderType.findMany.mockResolvedValue([])
    mockDb.location.findUnique.mockResolvedValue({ id: 'loc-1', name: 'Main', settings: {}, timezone: null })
    mockDb.paymentReader.findMany.mockResolvedValue([])
    mockDb.printer.findMany.mockResolvedValue([])

    await GET(makeRequest({ Authorization: 'Bearer valid-token' }))

    // Verify location scoping on key queries
    expect(mockDb.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: 'loc-1' }) }),
    )
    expect(mockDb.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: 'loc-1' }) }),
    )
    expect(mockDb.table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: 'loc-1' }) }),
    )
    expect(mockDb.location.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'loc-1' } }),
    )
  })
})
