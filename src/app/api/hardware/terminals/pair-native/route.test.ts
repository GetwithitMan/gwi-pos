import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock objects exist before vi.mock factories run
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  terminal: {
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  $executeRaw: vi.fn(() => Promise.resolve()),
}))

const mockCheckDeviceLimit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/cloud-notify', () => ({
  notifyDataChanged: vi.fn(),
}))
vi.mock('@/lib/sync/outage-safe-write', () => ({
  pushUpstream: vi.fn(),
}))
vi.mock('@/lib/get-client-ip', () => ({
  getClientIp: vi.fn().mockReturnValue('10.0.0.1'),
}))
vi.mock('@/lib/api-response', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (data: unknown) => NextResponse.json({ data }, { status: 200 }),
    err: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
  }
})
vi.mock('@/lib/device-limits', () => ({
  checkDeviceLimit: (...args: unknown[]) => mockCheckDeviceLimit(...args),
}))

// ---------------------------------------------------------------------------
// Import the route handler (withVenue is already a pass-through)
// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/hardware/terminals/pair-native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const TERMINAL_STUB = {
  id: 'term-1',
  locationId: 'loc-1',
  pairingCode: 'ABC123',
  pairingCodeExpiresAt: new Date(Date.now() + 60_000), // future
  category: 'MOBILE',
  staticIp: null,
  name: 'Register 1',
  roleSkipRules: null,
  forceAllPrints: false,
  platform: 'ANDROID',
  receiptPrinter: null,
  deletedAt: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/hardware/terminals/pair-native', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: device limit allows
    mockCheckDeviceLimit.mockResolvedValue({ allowed: true, current: 1, limit: 20 })
  })

  it('returns token, terminal, and location on valid pairing', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.update.mockResolvedValue({
      ...TERMINAL_STUB,
      isPaired: true,
      receiptPrinter: null,
    })

    const res = await POST(makeRequest({
      pairingCode: 'ABC123',
      platform: 'ANDROID',
      deviceFingerprint: 'fp-1',
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveProperty('token')
    expect(json.data.token).toEqual(expect.any(String))
    expect(json.data.token.length).toBe(64) // 32 bytes hex
    expect(json.data.terminal).toMatchObject({ id: 'term-1', name: 'Register 1' })
    expect(json.data.location).toEqual({ id: 'loc-1' })
  })

  it('returns 400 when pairing code is missing', async () => {
    const res = await POST(makeRequest({ platform: 'ANDROID' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/pairing code/i)
  })

  it('returns 400 when no terminal matches the pairing code', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({ pairingCode: 'WRONG', platform: 'ANDROID' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid pairing code/i)
  })

  it('returns 400 when pairing code is expired', async () => {
    mockDb.terminal.findFirst.mockResolvedValue({
      ...TERMINAL_STUB,
      pairingCodeExpiresAt: new Date(Date.now() - 60_000), // past
    })

    const res = await POST(makeRequest({ pairingCode: 'ABC123', platform: 'ANDROID' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/expired/i)
  })

  it('returns 403 with DEVICE_LIMIT_EXCEEDED when limit reached', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockCheckDeviceLimit.mockResolvedValue({
      allowed: false,
      current: 20,
      limit: 20,
      upgradeMessage: 'Device limit reached. Upgrade your plan for more terminals.',
    })

    const res = await POST(makeRequest({ pairingCode: 'ABC123', platform: 'ANDROID' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.code).toBe('DEVICE_LIMIT_EXCEEDED')
    expect(json.current).toBe(20)
    expect(json.limit).toBe(20)
  })

  it('returns 400 for invalid platform', async () => {
    const res = await POST(makeRequest({ pairingCode: 'ABC123', platform: 'INVALID' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid platform/i)
  })

  it('stores the platform field correctly for each valid value', async () => {
    for (const platform of ['BROWSER', 'ANDROID', 'IOS'] as const) {
      vi.clearAllMocks()
      mockCheckDeviceLimit.mockResolvedValue({ allowed: true, current: 1, limit: 20 })
      mockDb.terminal.findFirst
        .mockResolvedValueOnce(TERMINAL_STUB) // main lookup
        .mockResolvedValue(null) // previous device lookup
      mockDb.terminal.update.mockResolvedValue({ ...TERMINAL_STUB, platform, receiptPrinter: null })

      await POST(makeRequest({ pairingCode: 'ABC123', platform }))

      expect(mockDb.terminal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform }),
        }),
      )
    }
  })

  it('clears pairing code after successful pair', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.update.mockResolvedValue({ ...TERMINAL_STUB, receiptPrinter: null })

    await POST(makeRequest({ pairingCode: 'ABC123', platform: 'ANDROID' }))

    expect(mockDb.terminal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pairingCode: null,
          pairingCodeExpiresAt: null,
          isPaired: true,
        }),
      }),
    )
  })
})
