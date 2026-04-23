/**
 * T8b — POST /api/loyalty/adjust
 *
 * Verifies:
 *   1. Requires LOYALTY_ADJUST permission (403 without it).
 *   2. Valid positive adjustment creates exactly one LoyaltyTransaction with
 *      type='admin_adjustment' and increments both loyaltyPoints + lifetimePoints.
 *   3. Negative adjustment decrements loyaltyPoints, leaves lifetimePoints
 *      unchanged (tier preservation).
 *   4. Rejects malformed input (missing reason, zero delta, bad types).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

// Track raw SQL invocations. Tagged-template invocation looks like
//   tx.$queryRaw`SELECT ...`  -> call args = [strings, ...exprs]
const rawCalls: { fn: string; strings: string[]; args: unknown[] }[] = []

// Default customer state — tests can overwrite before invoking.
let currentCustomer = { loyaltyPoints: 100, lifetimePoints: 100 }

function makeTx() {
  return {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
      const sql = strings.join('?')
      rawCalls.push({ fn: '$queryRaw', strings: [...strings], args })
      // SELECT ... FOR UPDATE — initial row lock
      if (/SELECT "id", "loyaltyPoints", "lifetimePoints"/.test(sql) && /FOR UPDATE/.test(sql)) {
        return Promise.resolve([{ id: args[0], loyaltyPoints: currentCustomer.loyaltyPoints, lifetimePoints: currentCustomer.lifetimePoints }])
      }
      // Post-update read-back
      if (/SELECT "loyaltyPoints", "lifetimePoints" FROM "Customer"/.test(sql)) {
        return Promise.resolve([{ loyaltyPoints: currentCustomer.loyaltyPoints, lifetimePoints: currentCustomer.lifetimePoints }])
      }
      return Promise.resolve([])
    }),
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
      const sql = strings.join('?')
      rawCalls.push({ fn: '$executeRaw', strings: [...strings], args })
      // UPDATE Customer
      if (/UPDATE "Customer"/.test(sql)) {
        // Parse whether we're doing a positive (includes lifetimePoints) or negative (GREATEST) adjust.
        if (/"lifetimePoints"\s*=\s*"lifetimePoints"\s*\+/.test(sql)) {
          const delta = Number(args[0])
          currentCustomer.loyaltyPoints += delta
          currentCustomer.lifetimePoints += delta
        } else if (/GREATEST\(0, "loyaltyPoints"/.test(sql)) {
          const delta = Number(args[0])
          currentCustomer.loyaltyPoints = Math.max(0, currentCustomer.loyaltyPoints + delta)
          // lifetimePoints intentionally unchanged
        }
      }
      // INSERT LoyaltyTransaction — no DB state change needed for the mock
      return Promise.resolve(1)
    }),
  }
}

const mockTransaction = vi.fn(async (fn: any) => fn(makeTx()))

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: (fn: any, _opts?: unknown) => mockTransaction(fn),
  },
}))

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: any) => handler,
}))

// Permission + actor mocks — swapped per test via the refs below.
const authResult: { current: any } = {
  current: { authorized: true, employee: { id: 'emp-1' } },
}
const actorResult: { current: any } = {
  current: { employeeId: 'emp-1', locationId: 'loc-1', fromSession: true },
}

vi.mock('@/lib/api-auth', () => ({
  getActorFromRequest: vi.fn(async () => actorResult.current),
  requirePermission: vi.fn(async () => authResult.current),
}))

vi.mock('@/lib/auth-utils', () => ({
  PERMISSIONS: { LOYALTY_ADJUST: 'loyalty.adjust' },
  hasPermission: () => true,
}))

vi.mock('@/lib/cloud-notify', () => ({
  notifyDataChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sync/outage-safe-write', () => ({
  pushUpstream: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
      status: init?.status ?? 200,
    }),
  },
}))

// ─── Import route after mocks ─────────────────────────────────────────────────

import { POST } from '@/app/api/loyalty/adjust/route'

function makeRequest(body: Record<string, unknown>) {
  return { json: async () => body } as any
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findInsertCall() {
  return rawCalls.find(
    (c) => c.fn === '$executeRaw' && c.strings.some((s) => s.includes('INSERT INTO "LoyaltyTransaction"')),
  )
}

function findUpdateCall() {
  return rawCalls.find(
    (c) => c.fn === '$executeRaw' && c.strings.some((s) => s.includes('UPDATE "Customer"')),
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/loyalty/adjust', () => {
  beforeEach(() => {
    rawCalls.length = 0
    currentCustomer = { loyaltyPoints: 100, lifetimePoints: 100 }
    authResult.current = { authorized: true, employee: { id: 'emp-1' } }
    actorResult.current = { employeeId: 'emp-1', locationId: 'loc-1', fromSession: true }
  })

  it('returns 403 when actor lacks LOYALTY_ADJUST permission', async () => {
    authResult.current = { authorized: false, error: 'Permission denied', status: 403 }
    const req = makeRequest({ customerId: 'cust-1', points: 10, reason: 'goodwill' })
    const res: any = await POST(req)
    expect(res._status).toBe(403)
    expect(res._body.code).toBe('PERMISSION_DENIED')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 when reason is missing', async () => {
    const req = makeRequest({ customerId: 'cust-1', points: 10 })
    const res: any = await POST(req)
    expect(res._status).toBe(400)
    expect(res._body.error).toMatch(/reason/i)
  })

  it('returns 400 when points is zero', async () => {
    const req = makeRequest({ customerId: 'cust-1', points: 0, reason: 'noop' })
    const res: any = await POST(req)
    expect(res._status).toBe(400)
  })

  it('returns 400 when points is not an integer', async () => {
    const req = makeRequest({ customerId: 'cust-1', points: 1.5, reason: 'x' })
    const res: any = await POST(req)
    expect(res._status).toBe(400)
  })

  it('returns 400 when customerId is missing', async () => {
    const req = makeRequest({ points: 10, reason: 'x' })
    const res: any = await POST(req)
    expect(res._status).toBe(400)
  })

  it('creates exactly one LoyaltyTransaction(type=admin_adjustment) on a valid positive adjustment', async () => {
    const req = makeRequest({ customerId: 'cust-1', points: 50, reason: 'goodwill bonus', employeeId: 'emp-1' })
    const res: any = await POST(req)

    expect(res._status).toBe(200)
    // Balance moved by +50; lifetime also increased.
    expect(currentCustomer.loyaltyPoints).toBe(150)
    expect(currentCustomer.lifetimePoints).toBe(150)

    const insert = findInsertCall()
    expect(insert).toBeTruthy()
    const sql = insert!.strings.join('?')
    expect(sql).toContain('INSERT INTO "LoyaltyTransaction"')
    // type column is hard-coded into the SQL template as 'admin_adjustment'
    expect(sql).toContain("'admin_adjustment'")

    // exactly one insert
    const allInserts = rawCalls.filter(
      (c) => c.fn === '$executeRaw' && c.strings.some((s) => s.includes('INSERT INTO "LoyaltyTransaction"')),
    )
    expect(allInserts).toHaveLength(1)

    // Response payload carries audit fields
    expect(res._body.data.actualDelta).toBe(50)
    expect(res._body.data.balanceBefore).toBe(100)
    expect(res._body.data.balanceAfter).toBe(150)
    expect(res._body.data.reason).toBe('goodwill bonus')
  })

  it('negative adjustment decrements balance but leaves lifetimePoints unchanged', async () => {
    const req = makeRequest({ customerId: 'cust-1', points: -30, reason: 'correction' })
    const res: any = await POST(req)

    expect(res._status).toBe(200)
    expect(currentCustomer.loyaltyPoints).toBe(70)       // 100 - 30
    expect(currentCustomer.lifetimePoints).toBe(100)     // unchanged — tier preserved

    // The UPDATE SQL used for negative adjustments must use GREATEST(0, ...)
    // and must NOT touch lifetimePoints.
    const update = findUpdateCall()
    expect(update).toBeTruthy()
    const sql = update!.strings.join('?')
    expect(sql).toContain('GREATEST(0, "loyaltyPoints"')
    expect(sql).not.toMatch(/"lifetimePoints"\s*=\s*"lifetimePoints"\s*\+/)

    expect(res._body.data.actualDelta).toBe(-30)
    expect(res._body.data.lifetimeBefore).toBe(100)
    expect(res._body.data.lifetimeAfter).toBe(100)
  })

  it('negative adjustment larger than balance clamps to zero and reports actualDelta', async () => {
    currentCustomer = { loyaltyPoints: 20, lifetimePoints: 100 }
    const req = makeRequest({ customerId: 'cust-1', points: -50, reason: 'dispute' })
    const res: any = await POST(req)

    expect(res._status).toBe(200)
    expect(currentCustomer.loyaltyPoints).toBe(0)
    expect(currentCustomer.lifetimePoints).toBe(100)
    expect(res._body.data.balanceAfter).toBe(0)
    expect(res._body.data.actualDelta).toBe(-20) // clamped — only 20 points actually removed
    expect(res._body.data.requestedDelta).toBe(-50)
  })
})
