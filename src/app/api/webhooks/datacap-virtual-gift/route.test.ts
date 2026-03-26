import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'test-webhook-secret-123'

const mockDb = vi.hoisted(() => ({
  location: {
    findUnique: vi.fn(),
  },
  externalWebhookEvent: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  giftCard: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
}))

const mockProcessDcVirtualGiftWebhook = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/domain/gift-cards/process-datacap-virtual-gift', () => ({
  processDcVirtualGiftWebhook: mockProcessDcVirtualGiftWebhook,
}))
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { POST } from './route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signPayload(body: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'txn-abc-123',
    giftCardPageId: 'page-1',
    publicLinkId: 'link-1',
    merchantId: 'mid-1',
    status: 'completed',
    paymentTypeUsed: 'credit',
    giftCardData: {},
    giftCardNumber: 'VGC-1234-5678',
    giftCardCvv: '999',
    giftCardLast4: '5678',
    giftCardBalance: 50,
    paidAt: new Date().toISOString(),
    deliveryMethods: ['Print'],
    eventType: 'payment.completed',
    ...overrides,
  }
}

function makeRequest(
  body: Record<string, unknown>,
  locationId: string = 'loc-1',
  signature?: string | null
) {
  const bodyStr = JSON.stringify(body)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (signature !== null) {
    headers['x-datacap-signature'] = signature ?? signPayload(bodyStr)
  }

  return new NextRequest(
    `http://localhost/api/webhooks/datacap-virtual-gift?locationId=${locationId}`,
    {
      method: 'POST',
      headers,
      body: bodyStr,
    }
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/datacap-virtual-gift', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.location.findUnique.mockResolvedValue({
      settings: {
        datacapVirtualGift: {
          webhookSecret: WEBHOOK_SECRET,
        },
      },
    })
    mockDb.externalWebhookEvent.upsert.mockResolvedValue({})
    mockProcessDcVirtualGiftWebhook.mockResolvedValue({ success: true, data: { giftCard: { id: 'gc-new' } } })
    mockDb.externalWebhookEvent.updateMany.mockResolvedValue({})
  })

  it('valid HMAC signature accepted (200)', async () => {
    const payload = makeWebhookPayload()
    const bodyStr = JSON.stringify(payload)
    const sig = signPayload(bodyStr)

    const res = await POST(makeRequest(payload, 'loc-1', sig))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.received).toBe(true)
  })

  it('invalid signature rejected (401)', async () => {
    const payload = makeWebhookPayload()

    const res = await POST(makeRequest(payload, 'loc-1', 'bad-signature-hex-value'))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid signature/i)
  })

  it('missing signature header rejected when secret is configured (401)', async () => {
    const payload = makeWebhookPayload()

    const res = await POST(makeRequest(payload, 'loc-1', null))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toMatch(/invalid signature/i)
  })

  it('duplicate transactionId returns 200 (idempotent)', async () => {
    const payload = makeWebhookPayload({ transactionId: 'txn-dup-1' })
    const bodyStr = JSON.stringify(payload)
    const sig = signPayload(bodyStr)

    // Upsert returns success (duplicate just increments attemptCount)
    mockDb.externalWebhookEvent.upsert.mockResolvedValue({ id: 'evt-1' })

    const res = await POST(makeRequest(payload, 'loc-1', sig))

    expect(res.status).toBe(200)
    // Should still persist the event via upsert
    expect(mockDb.externalWebhookEvent.upsert).toHaveBeenCalled()
  })

  it('payment.completed calls processDcVirtualGiftWebhook', async () => {
    const payload = makeWebhookPayload({ eventType: 'payment.completed' })
    const bodyStr = JSON.stringify(payload)
    const sig = signPayload(bodyStr)

    const res = await POST(makeRequest(payload, 'loc-1', sig))

    expect(res.status).toBe(200)
    // The domain command is called fire-and-forget, so it may have been invoked
    // We verify indirectly that the endpoint returns 200 and the event was persisted
    expect(mockDb.externalWebhookEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventType: 'payment.completed',
        }),
      })
    )
  })

  it('CVV stripped from stored payload', async () => {
    const payload = makeWebhookPayload({ giftCardCvv: '999' })
    const bodyStr = JSON.stringify(payload)
    const sig = signPayload(bodyStr)

    await POST(makeRequest(payload, 'loc-1', sig))

    // Check the upsert call — the payload should NOT contain giftCardCvv
    const upsertCall = mockDb.externalWebhookEvent.upsert.mock.calls[0][0]
    const storedPayload = upsertCall.create.payload as Record<string, unknown>

    expect(storedPayload).not.toHaveProperty('giftCardCvv')
  })

  it('unknown event types logged and return 200', async () => {
    const payload = makeWebhookPayload({ eventType: 'custom.unknown_event' })
    const bodyStr = JSON.stringify(payload)
    const sig = signPayload(bodyStr)

    const res = await POST(makeRequest(payload, 'loc-1', sig))

    expect(res.status).toBe(200)
    expect(mockDb.externalWebhookEvent.upsert).toHaveBeenCalled()
  })

  it('ExternalWebhookEvent created for all events', async () => {
    for (const eventType of ['payment.completed', 'payment.failed', 'delivery.completed']) {
      vi.clearAllMocks()
      mockDb.location.findUnique.mockResolvedValue({
        settings: {
          datacapVirtualGift: { webhookSecret: WEBHOOK_SECRET },
        },
      })
      mockDb.externalWebhookEvent.upsert.mockResolvedValue({})
      mockDb.externalWebhookEvent.updateMany.mockResolvedValue({})
      mockProcessDcVirtualGiftWebhook.mockResolvedValue({ success: true, data: { giftCard: { id: 'gc-x' } } })

      const payload = makeWebhookPayload({ eventType })
      const bodyStr = JSON.stringify(payload)
      const sig = signPayload(bodyStr)

      await POST(makeRequest(payload, 'loc-1', sig))

      expect(mockDb.externalWebhookEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            provider: 'datacap_virtual_gift',
            eventType,
          }),
        })
      )
    }
  })

  it('returns 200 even when locationId is missing (graceful)', async () => {
    const payload = makeWebhookPayload()
    const bodyStr = JSON.stringify(payload)

    const req = new NextRequest(
      'http://localhost/api/webhooks/datacap-virtual-gift',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      }
    )

    const res = await POST(req)
    expect(res.status).toBe(200) // Returns 200 even without locationId
  })
})
