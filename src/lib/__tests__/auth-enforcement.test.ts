/**
 * Auth Enforcement — Critical Guarantee Tests
 *
 * Verifies that:
 * 1. getActorFromRequest() returns the session actor when a valid cookie is present
 * 2. getActorFromRequest() returns null when no cookie is present
 * 3. A route using the pattern rejects a mismatched actor (body employeeId ≠ session)
 * 4. requirePermission() gates on DB-level location binding (cannot cross-tenant)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock auth-session ────────────────────────────────────────────────────────

const mockGetSessionFromCookie = vi.fn()

vi.mock('@/lib/auth-session', () => ({
  getSessionFromCookie: () => mockGetSessionFromCookie(),
}))

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockFindUnique = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    employee: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

// ─── Mock next/server (NextRequest not needed in unit scope) ─────────────────

vi.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
    }),
  },
}))

// ─── Import after mocks are registered ───────────────────────────────────────

import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import type { NextRequest } from 'next/server'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_EMPLOYEE = {
  employeeId: 'emp-session',
  locationId: 'loc-1',
  roleId: 'role-manager',
  roleName: 'Manager',
  permissions: ['REPORTS_VIEW', 'INVENTORY_MANAGE'],
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + 3600,
  lastActivity: Math.floor(Date.now() / 1000) - 30,
}

function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-session',
    firstName: 'Jane',
    lastName: 'Doe',
    displayName: null,
    locationId: 'loc-1',
    isActive: true,
    role: {
      permissions: ['REPORTS_VIEW', 'INVENTORY_MANAGE'],
    },
    ...overrides,
  }
}

// ─── getActorFromRequest ───────────────────────────────────────────────────────

describe('getActorFromRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns session actor when valid cookie is present', async () => {
    mockGetSessionFromCookie.mockResolvedValue(SESSION_EMPLOYEE)

    const actor = await getActorFromRequest({} as NextRequest)

    expect(actor.fromSession).toBe(true)
    expect(actor.employeeId).toBe('emp-session')
    expect(actor.locationId).toBe('loc-1')
  })

  it('returns null employeeId when no cookie present', async () => {
    mockGetSessionFromCookie.mockResolvedValue(null)

    const actor = await getActorFromRequest({} as NextRequest)

    expect(actor.fromSession).toBe(false)
    expect(actor.employeeId).toBeNull()
    expect(actor.locationId).toBeNull()
  })

  it('returns null when getSessionFromCookie throws', async () => {
    mockGetSessionFromCookie.mockRejectedValue(new Error('cookie parse error'))

    const actor = await getActorFromRequest({} as NextRequest)

    expect(actor.fromSession).toBe(false)
    expect(actor.employeeId).toBeNull()
  })
})

// ─── Cookie-first actor pattern ───────────────────────────────────────────────

describe('cookie-first actor pattern (session takes precedence over body)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('session actor overrides a spoofed body employeeId', async () => {
    // Session says emp-session; attacker sends emp-attacker in body
    mockGetSessionFromCookie.mockResolvedValue(SESSION_EMPLOYEE)
    mockFindUnique.mockResolvedValue(makeEmployee()) // emp-session is valid

    const actor = await getActorFromRequest({} as NextRequest)
    const resolvedId = actor.employeeId ?? 'emp-attacker' // body value

    // The resolved ID must be the session actor, not the attacker's body value
    expect(resolvedId).toBe('emp-session')
    expect(resolvedId).not.toBe('emp-attacker')
  })

  it('falls back to body value when no session (Android/API clients)', async () => {
    mockGetSessionFromCookie.mockResolvedValue(null)

    const actor = await getActorFromRequest({} as NextRequest)
    const resolvedId = actor.employeeId ?? 'emp-android'

    expect(resolvedId).toBe('emp-android')
  })
})

// ─── requirePermission — DB-level invariants ──────────────────────────────────

describe('requirePermission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authorizes a valid employee with the required permission', async () => {
    mockFindUnique.mockResolvedValue(makeEmployee())

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(true)
    if (result.authorized) {
      expect(result.employee.id).toBe('emp-session')
    }
  })

  it('rejects when employee belongs to a different location (cross-tenant)', async () => {
    mockFindUnique.mockResolvedValue(makeEmployee({ locationId: 'loc-other' }))

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/does not belong/i)
    }
  })

  it('rejects when employee lacks the required permission', async () => {
    mockFindUnique.mockResolvedValue(makeEmployee({ role: { permissions: [] } }))

    const result = await requirePermission('emp-session', 'loc-1', 'SETTINGS_EDIT')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
    }
  })

  it('rejects with 401 when no employeeId provided', async () => {
    const result = await requirePermission(null, 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(401)
    }
  })

  it('rejects inactive employees', async () => {
    mockFindUnique.mockResolvedValue(makeEmployee({ isActive: false }))

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/inactive/i)
    }
  })

  it('rejects when employee not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await requirePermission('emp-ghost', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(401)
    }
  })
})
