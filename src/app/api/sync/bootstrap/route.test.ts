import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

// The route uses both `db` (local PG) and `adminDb` (admin queries).
// `db` is used for: category, table, orderType, location, paymentReader, printer,
//   section, floorPlanElement, cfdSettings, taxRule, pizzaTopping, discountRule,
//   voidReason, compReason, scale, modifierGroup
// `adminDb` is used for: employee, order, orderSnapshot

const mockDb = vi.hoisted(() => ({
  category: { findMany: vi.fn() },
  table: { findMany: vi.fn() },
  orderType: { findMany: vi.fn() },
  location: { findUnique: vi.fn() },
  paymentReader: { findMany: vi.fn() },
  printer: { findMany: vi.fn() },
  section: { findMany: vi.fn() },
  floorPlanElement: { findMany: vi.fn() },
  cfdSettings: { findFirst: vi.fn() },
  taxRule: { findMany: vi.fn() },
  pizzaTopping: { findMany: vi.fn() },
  discountRule: { findMany: vi.fn() },
  voidReason: { findMany: vi.fn() },
  compReason: { findMany: vi.fn() },
  scale: { findUnique: vi.fn() },
  modifierGroup: { findMany: vi.fn() },
}))

const mockAdminDb = vi.hoisted(() => ({
  employee: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  orderSnapshot: { findMany: vi.fn() },
}))

const mockAuthenticateTerminal = vi.hoisted(() => vi.fn())

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb, adminDb: mockAdminDb }))

vi.mock('@/lib/terminal-auth', () => ({
  authenticateTerminal: mockAuthenticateTerminal,
}))

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
  cfdTerminalId: null,
  defaultMode: null,
  receiptPrinterId: null,
  kitchenPrinterId: null,
  barPrinterId: null,
  scaleId: null,
}

/** Stub all db/adminDb findMany/findFirst/findUnique calls to return empty results */
function stubEmptyDefaults() {
  mockDb.category.findMany.mockResolvedValue([])
  mockDb.table.findMany.mockResolvedValue([])
  mockDb.orderType.findMany.mockResolvedValue([])
  mockDb.location.findUnique.mockResolvedValue({ id: 'loc-1', name: 'Main', settings: {}, timezone: null })
  mockDb.paymentReader.findMany.mockResolvedValue([])
  mockDb.printer.findMany.mockResolvedValue([])
  mockDb.section.findMany.mockResolvedValue([])
  mockDb.floorPlanElement.findMany.mockResolvedValue([])
  mockDb.cfdSettings.findFirst.mockResolvedValue(null)
  mockDb.taxRule.findMany.mockResolvedValue([])
  mockDb.pizzaTopping.findMany.mockResolvedValue([])
  mockDb.discountRule.findMany.mockResolvedValue([])
  mockDb.voidReason.findMany.mockResolvedValue([])
  mockDb.compReason.findMany.mockResolvedValue([])
  mockDb.scale.findUnique.mockResolvedValue(null)
  mockDb.modifierGroup.findMany.mockResolvedValue([])
  mockAdminDb.employee.findMany.mockResolvedValue([])
  mockAdminDb.order.findMany.mockResolvedValue([])
  mockAdminDb.orderSnapshot.findMany.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sync/bootstrap', () => {
  // The route has a 5s in-memory bootstrap cache keyed by locationId.
  // Each test that needs fresh DB queries uses a unique locationId to avoid cache hits.
  let testLocationCounter = 0

  function uniqueTerminal() {
    testLocationCounter++
    return { ...TERMINAL_STUB, locationId: `loc-${testLocationCounter}` }
  }

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

    const res = await GET(makeRequest({ Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid token/i)
  })

  it('returns full bootstrap data structure for authenticated request', async () => {
    const terminal = uniqueTerminal()
    mockAuthenticateTerminal.mockResolvedValue({ terminal })
    stubEmptyDefaults()

    const mockCategories = [
      {
        id: 'cat-1', name: 'Appetizers', categoryType: 'food',
        menuItems: [{
          id: 'mi-1', name: 'Fries', price: 5.99, cost: null, pricePerWeightUnit: null,
          ownedModifierGroups: [], pricingOptionGroups: [], ingredients: [],
        }],
      },
    ]
    const mockEmployees = [
      { id: 'emp-1', firstName: 'John', lastName: 'Doe', displayName: 'John D', locationId: terminal.locationId, posLayoutSettings: null, role: { id: 'role-1', name: 'Server', permissions: {} } },
    ]
    const mockTables = [{ id: 'tbl-1', name: 'Table 1' }]
    const mockOrderTypes = [{ id: 'ot-1', name: 'Dine In' }]
    const mockLocation = { id: terminal.locationId, name: 'Main', settings: { tax: { defaultRate: 8.25 } }, timezone: 'America/Chicago' }
    const mockPaymentReaders = [{ id: 'pr-1', name: 'Reader 1' }]
    const mockPrinters = [{ id: 'prt-1', name: 'Kitchen Printer' }]

    mockDb.category.findMany.mockResolvedValue(mockCategories)
    mockAdminDb.employee.findMany.mockResolvedValue(mockEmployees)
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
    expect(data.menu.categories).toHaveLength(1)
    expect(data.menu.categories[0].menuItems[0]).toMatchObject({ id: 'mi-1', name: 'Fries' })
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

  it('returns default taxRate when location has no explicit tax settings', async () => {
    // parseSettings merges with defaults (defaultRate: 8.0), so even with
    // empty settings the route returns the default rate (8.0 / 100 = 0.08).
    const terminal = uniqueTerminal()
    mockAuthenticateTerminal.mockResolvedValue({ terminal })
    stubEmptyDefaults()
    mockDb.location.findUnique.mockResolvedValue({ id: terminal.locationId, name: 'Main', settings: {}, timezone: null })

    const res = await GET(makeRequest({ Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(json.data.taxRate).toBeCloseTo(0.08)
  })

  it('queries all data scoped to the terminal locationId', async () => {
    const terminal = uniqueTerminal()
    mockAuthenticateTerminal.mockResolvedValue({ terminal })
    stubEmptyDefaults()
    mockDb.location.findUnique.mockResolvedValue({ id: terminal.locationId, name: 'Main', settings: {}, timezone: null })

    await GET(makeRequest({ Authorization: 'Bearer valid-token' }))

    // Verify location scoping on key queries
    expect(mockDb.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: terminal.locationId }) }),
    )
    expect(mockAdminDb.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: terminal.locationId }) }),
    )
    expect(mockDb.table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: terminal.locationId }) }),
    )
    expect(mockDb.location.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: terminal.locationId } }),
    )
  })
})
