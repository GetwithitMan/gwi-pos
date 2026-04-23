/**
 * T8b — PUT /api/customers/[id] loyaltyPoints/lifetimePoints guard
 *
 * Verifies the orphan-write path from the T8 forensic investigation is closed:
 * a client that sends loyaltyPoints (or lifetimePoints) in the update body must
 * get a 400 back, NOT a silent drop and NOT a write. All loyalty balance changes
 * must go through POST /api/loyalty/adjust so a LoyaltyTransaction row exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockCustomerFindFirst = vi.fn()
const mockCustomerUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    customer: {
      findFirst: (...args: unknown[]) => mockCustomerFindFirst(...args),
      update: (...args: unknown[]) => mockCustomerUpdate(...args),
    },
    orderSnapshot: { count: vi.fn() },
    orderItem: { groupBy: vi.fn() },
    houseAccount: { findFirst: vi.fn() },
    cardProfile: { findMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: any) => handler,
}))

vi.mock('@/lib/location-cache', () => ({
  getLocationId: vi.fn().mockResolvedValue('loc-1'),
}))

vi.mock('@/lib/utils', () => ({
  normalizePhone: (p: string | null | undefined) => p ?? null,
}))

vi.mock('@/lib/api-auth', () => ({
  getActorFromRequest: vi.fn().mockResolvedValue({ employeeId: 'emp-1', locationId: 'loc-1', fromSession: true }),
  requirePermission: vi.fn().mockResolvedValue({ authorized: true, employee: { id: 'emp-1' } }),
}))

vi.mock('@/lib/auth-utils', () => ({
  PERMISSIONS: { CUSTOMERS_EDIT: 'customers.edit' },
  hasPermission: () => true,
}))

vi.mock('@/lib/cloud-notify', () => ({
  notifyDataChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sync/outage-safe-write', () => ({
  pushUpstream: vi.fn(),
}))

vi.mock('@/generated/prisma/client', () => ({
  Prisma: {},
}))

vi.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

// ─── Import route after mocks ─────────────────────────────────────────────────

import { PUT } from '@/app/api/customers/[id]/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PUT /api/customers/[id] — loyalty balance orphan-write guard (T8b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCustomerFindFirst.mockResolvedValue({
      id: 'cust-1',
      locationId: 'loc-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '5551234567',
      loyaltyPoints: 100,
      lifetimePoints: 100,
    })
    mockCustomerUpdate.mockImplementation(async ({ data }: any) => ({
      id: 'cust-1',
      firstName: 'Jane',
      lastName: 'Doe',
      displayName: null,
      email: 'jane@example.com',
      phone: '5551234567',
      notes: null,
      allergies: null,
      favoriteDrink: null,
      favoriteFood: null,
      tags: [],
      loyaltyPoints: 100,
      totalSpent: 0,
      totalOrders: 0,
      averageTicket: 0,
      lastVisit: null,
      marketingOptIn: false,
      birthday: null,
      ...data,
    }))
  })

  it('returns 400 when body contains loyaltyPoints', async () => {
    const req = makeRequest({ locationId: 'loc-1', loyaltyPoints: 530, firstName: 'Jane' })
    const res: any = await PUT(req, { params: Promise.resolve({ id: 'cust-1' }) } as any)
    expect(res._status).toBe(400)
    expect(res._body.error).toMatch(/loyalty/i)
    expect(res._body.error).toMatch(/loyalty\/adjust/i)
    // CRITICAL: no customer.update call may have happened
    expect(mockCustomerUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when body contains lifetimePoints', async () => {
    const req = makeRequest({ locationId: 'loc-1', lifetimePoints: 999 })
    const res: any = await PUT(req, { params: Promise.resolve({ id: 'cust-1' }) } as any)
    expect(res._status).toBe(400)
    expect(res._body.error).toMatch(/loyalty/i)
    expect(mockCustomerUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when body contains both loyaltyPoints and lifetimePoints', async () => {
    const req = makeRequest({ locationId: 'loc-1', loyaltyPoints: 100, lifetimePoints: 999 })
    const res: any = await PUT(req, { params: Promise.resolve({ id: 'cust-1' }) } as any)
    expect(res._status).toBe(400)
    expect(mockCustomerUpdate).not.toHaveBeenCalled()
  })

  it('allows normal updates without loyaltyPoints/lifetimePoints', async () => {
    const req = makeRequest({ locationId: 'loc-1', firstName: 'Janet', notes: 'VIP' })
    const res: any = await PUT(req, { params: Promise.resolve({ id: 'cust-1' }) } as any)
    expect(res._status).toBe(200)
    expect(mockCustomerUpdate).toHaveBeenCalledOnce()
    const dataArg = mockCustomerUpdate.mock.calls[0][0].data
    expect(dataArg).not.toHaveProperty('loyaltyPoints')
    expect(dataArg).not.toHaveProperty('lifetimePoints')
    expect(dataArg.firstName).toBe('Janet')
  })
})
