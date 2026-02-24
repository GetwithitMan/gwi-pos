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
}))

vi.mock('@/lib/with-venue', () => ({
  withVenue: (handler: Function) => handler,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

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
  })

  it('returns token, terminal, and location on valid pairing', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.count.mockResolvedValue(0)
    mockDb.terminal.update.mockResolvedValue({
      ...TERMINAL_STUB,
      isPaired: true,
      receiptPrinter: null,
    })

    const res = await POST(makeRequest({
      pairingCode: 'ABC123',
      locationId: 'loc-1',
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

  it('returns 400 when locationId is missing', async () => {
    const res = await POST(makeRequest({ pairingCode: 'ABC123' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/locationId/i)
  })

  it('returns 400 when pairing code is missing', async () => {
    const res = await POST(makeRequest({ locationId: 'loc-1' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/pairing code/i)
  })

  it('returns 400 when no terminal matches the pairing code', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({ pairingCode: 'WRONG', locationId: 'loc-1' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid pairing code/i)
  })

  it('returns 400 when pairing code is expired', async () => {
    mockDb.terminal.findFirst.mockResolvedValue({
      ...TERMINAL_STUB,
      pairingCodeExpiresAt: new Date(Date.now() - 60_000), // past
    })

    const res = await POST(makeRequest({ pairingCode: 'ABC123', locationId: 'loc-1' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/expired/i)
  })

  it('returns 403 with LIMIT_EXCEEDED when 20 terminals are already paired', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.count.mockResolvedValue(20)

    const res = await POST(makeRequest({ pairingCode: 'ABC123', locationId: 'loc-1' }))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.code).toBe('LIMIT_EXCEEDED')
    expect(json.current).toBe(20)
    expect(json.limit).toBe(20)
  })

  it('stores the platform field correctly for each valid value', async () => {
    for (const platform of ['BROWSER', 'ANDROID', 'IOS'] as const) {
      vi.clearAllMocks()
      mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
      mockDb.terminal.count.mockResolvedValue(0)
      mockDb.terminal.update.mockResolvedValue({ ...TERMINAL_STUB, platform, receiptPrinter: null })

      await POST(makeRequest({ pairingCode: 'ABC123', locationId: 'loc-1', platform }))

      expect(mockDb.terminal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform }),
        }),
      )
    }
  })

  it('defaults platform to ANDROID when an invalid value is supplied', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.count.mockResolvedValue(0)
    mockDb.terminal.update.mockResolvedValue({ ...TERMINAL_STUB, receiptPrinter: null })

    await POST(makeRequest({ pairingCode: 'ABC123', locationId: 'loc-1', platform: 'INVALID' }))

    expect(mockDb.terminal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platform: 'ANDROID' }),
      }),
    )
  })

  it('clears pairing code after successful pair', async () => {
    mockDb.terminal.findFirst.mockResolvedValue(TERMINAL_STUB)
    mockDb.terminal.count.mockResolvedValue(0)
    mockDb.terminal.update.mockResolvedValue({ ...TERMINAL_STUB, receiptPrinter: null })

    await POST(makeRequest({ pairingCode: 'ABC123', locationId: 'loc-1' }))

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
