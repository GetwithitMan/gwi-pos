import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  terminal: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: Function) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/hardware/terminals/heartbeat-native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
}

const TERMINAL_STUB = {
  id: 'term-1',
  locationId: 'loc-1',
  name: 'Register 1',
  category: 'MOBILE',
  staticIp: null,
  roleSkipRules: null,
  forceAllPrints: false,
  receiptPrinter: null,
  deletedAt: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/hardware/terminals/heartbeat-native', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/not authenticated/i)
  })

  it('returns 401 when Authorization header is not a Bearer token', async () => {
    const res = await POST(makeRequest({ Authorization: 'Basic abc123' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/not authenticated/i)
  })

  it('returns 401 when terminal token is invalid (not found)', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({ Authorization: 'Bearer bad-token' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid terminal token/i)
  })

  it('updates lastSeenAt and lastKnownIp and returns success for valid token', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.update.mockResolvedValue(TERMINAL_STUB)

    const res = await POST(makeRequest({ Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.success).toBe(true)
    expect(json.data.terminal).toMatchObject({
      id: 'term-1',
      name: 'Register 1',
      category: 'MOBILE',
    })

    // Verify lastSeenAt update was called
    expect(mockDb.terminal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'term-1' },
        data: expect.objectContaining({
          isOnline: true,
          lastSeenAt: expect.any(Date),
        }),
      }),
    )
  })

  it('returns terminal config fields in response', async () => {
    const terminalWithConfig = {
      ...TERMINAL_STUB,
      roleSkipRules: { manager: true },
      forceAllPrints: true,
      receiptPrinter: { id: 'printer-1', name: 'Kitchen', ipAddress: '192.168.1.100' },
    }
    mockDb.terminal.findFirst.mockResolvedValue(terminalWithConfig)
    mockDb.terminal.update.mockResolvedValue(terminalWithConfig)

    const res = await POST(makeRequest({ Authorization: 'Bearer valid-token' }))
    const json = await res.json()

    expect(json.data.terminal.roleSkipRules).toEqual({ manager: true })
    expect(json.data.terminal.forceAllPrints).toBe(true)
    expect(json.data.terminal.receiptPrinter).toMatchObject({ id: 'printer-1' })
  })

  it('returns 403 with IP_MISMATCH for fixed station with wrong IP', async () => {
    mockDb.terminal.findFirst.mockResolvedValue({
      ...TERMINAL_STUB,
      category: 'FIXED_STATION',
      staticIp: '10.0.0.5',
    })
    mockDb.terminal.update.mockResolvedValue({})

    const res = await POST(makeRequest({
      Authorization: 'Bearer valid-token',
      'x-forwarded-for': '10.0.0.99',
    }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.code).toBe('IP_MISMATCH')
    // Should have called update to un-pair the terminal
    expect(mockDb.terminal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPaired: false,
          isOnline: false,
          deviceToken: null,
        }),
      }),
    )
  })
})
