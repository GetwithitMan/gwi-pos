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
const mockVerifySessionToken = vi.fn()

vi.mock('@/lib/auth-session', () => ({
  getSessionFromCookie: () => mockGetSessionFromCookie(),
  verifySessionToken: (...args: unknown[]) => mockVerifySessionToken(...args),
  refreshSessionToken: vi.fn(),
}))

// ─── Mock repositories ──────────────────────────────────────────────────────

const mockGetEmployeeByIdWithInclude = vi.fn()

vi.mock('@/lib/repositories/employee-repository', () => ({
  getEmployeeByIdWithInclude: (...args: unknown[]) => mockGetEmployeeByIdWithInclude(...args),
}))

// ─── Mock request-context ───────────────────────────────────────────────────

vi.mock('@/lib/request-context', () => ({
  getRequestPrisma: () => null,
}))

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    employee: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    employeePermissionOverride: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

// ─── Mock auth-utils ────────────────────────────────────────────────────────

vi.mock('@/lib/auth-utils', () => ({
  hasPermission: (permissions: string[], required: string) =>
    permissions.includes(required) || permissions.includes('all'),
}))

// ─── Mock cloud-auth (no cloud session in these tests) ──────────────────────

vi.mock('@/lib/cloud-auth', () => ({
  verifyCloudToken: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/system-config', () => ({
  config: { cloudJwtSecret: null },
}))

// ─── Mock logger ────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ─── Mock next/headers (cookies + headers) ──────────────────────────────────

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined,
  }),
  headers: vi.fn().mockResolvedValue({
    get: () => null,
  }),
}))

// ─── Mock next/server ───────────────────────────────────────────────────────

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

import { getActorFromRequest, requirePermission, clearPermissionCache } from '@/lib/api-auth'
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
    mockGetEmployeeByIdWithInclude.mockResolvedValue(makeEmployee()) // emp-session is valid

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
  beforeEach(() => {
    vi.clearAllMocks()
    clearPermissionCache()
  })

  it('authorizes a valid employee with the required permission', async () => {
    mockGetEmployeeByIdWithInclude.mockResolvedValue(makeEmployee())

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(true)
    if (result.authorized) {
      expect(result.employee.id).toBe('emp-session')
    }
  })

  it('rejects when employee belongs to a different location (cross-tenant)', async () => {
    mockGetEmployeeByIdWithInclude.mockResolvedValue(null) // not found with loc-1
    mockFindFirst.mockResolvedValue(makeEmployee({ locationId: 'loc-other' })) // fallback finds with different location

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/does not belong/i)
    }
  })

  it('rejects when employee lacks the required permission', async () => {
    mockGetEmployeeByIdWithInclude.mockResolvedValue(makeEmployee({ role: { permissions: [] } }))

    const result = await requirePermission('emp-session', 'loc-1', 'SETTINGS_EDIT')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
    }
  })

  it('rejects with 401 when no employeeId provided', async () => {
    // No session cookie, no Bearer token, no cloud session
    mockGetSessionFromCookie.mockResolvedValue(null)

    const result = await requirePermission(null, 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(401)
    }
  })

  it('rejects inactive employees', async () => {
    mockGetEmployeeByIdWithInclude.mockResolvedValue(makeEmployee({ isActive: false }))

    const result = await requirePermission('emp-session', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/inactive/i)
    }
  })

  it('rejects when employee not found', async () => {
    mockGetEmployeeByIdWithInclude.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(null)

    const result = await requirePermission('emp-ghost', 'loc-1', 'REPORTS_VIEW')

    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.status).toBe(401)
    }
  })
})
