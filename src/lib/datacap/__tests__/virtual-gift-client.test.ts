import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

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
import { VirtualGiftClient } from '../virtual-gift-client'
import type { VirtualGiftPageConfig } from '../virtual-gift-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<VirtualGiftPageConfig> = {}): VirtualGiftPageConfig {
  return {
    displayProperties: {
      merchantName: 'Test Venue',
      headerText: 'Buy a Gift Card',
      presetAmounts: [25, 50, 100],
    },
    paymentTypes: ['credit'],
    supportedDeliveryMethods: ['Print'],
    ...overrides,
  }
}

function mockFetchResponse(body: Record<string, unknown>, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VirtualGiftClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('constructor throws when ecommerceMid is missing', () => {
    expect(() => new VirtualGiftClient('', 'api-key', 'cert')).toThrow(/ecommerceMid/i)
  })

  it('constructor throws when apiKey is missing', () => {
    expect(() => new VirtualGiftClient('mid-123', '', 'cert')).toThrow(/apiKey/i)
  })

  describe('createGiftCardPage', () => {
    it('sends correct request body', async () => {
      const client = new VirtualGiftClient('mid-123', 'api-key-456', 'cert')
      mockFetchResponse({
        GiftCardPageId: 'page-1',
        PublicLinkId: 'link-1',
        PublicLinkUrl: 'https://paylink-cert.dcap.com/page-1',
        PublicLinkQRCodeUrl: 'https://paylink-cert.dcap.com/page-1/qr',
        PublicLinkEmbeddedUrl: 'https://paylink-cert.dcap.com/page-1/embed',
        Status: 'Active',
        PaymentTypes: ['credit'],
        SupportedDeliveryMethods: ['Print'],
      })

      const result = await client.createGiftCardPage(makeConfig())

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://paylink-cert.dcap.com/api/v1/giftcard')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body)
      expect(body.DisplayProperties).toEqual(expect.objectContaining({
        merchantName: 'Test Venue',
      }))
      expect(result.giftCardPageId).toBe('page-1')
      expect(result.publicLinkUrl).toBe('https://paylink-cert.dcap.com/page-1')
    })

    it('supportedDeliveryMethods always includes "Print"', async () => {
      const client = new VirtualGiftClient('mid-123', 'api-key-456', 'cert')
      mockFetchResponse({
        GiftCardPageId: 'page-2',
        SupportedDeliveryMethods: ['Print'],
      })

      await client.createGiftCardPage(makeConfig({
        supportedDeliveryMethods: ['Email', 'SMS'], // caller requests Email/SMS
      }))

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      // Our implementation hardcodes ['Print'] regardless of input
      expect(body.SupportedDeliveryMethods).toEqual(['Print'])
    })
  })

  describe('auth header', () => {
    it('correctly formatted (Basic auth with base64)', async () => {
      const client = new VirtualGiftClient('mid-123', 'api-key-456', 'cert')
      mockFetchResponse({ GiftCardPageId: 'page-1' })

      await client.createGiftCardPage(makeConfig())

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>
      const expectedCredentials = Buffer.from('mid-123:api-key-456').toString('base64')
      expect(headers['Authorization']).toBe(`Basic ${expectedCredentials}`)
    })
  })

  describe('environment resolution', () => {
    it('cert environment uses cert base URL', async () => {
      const client = new VirtualGiftClient('mid-123', 'key', 'cert')
      mockFetchResponse({ GiftCardPageId: 'p1' })

      await client.createGiftCardPage(makeConfig())

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('paylink-cert.dcap.com')
    })

    it('production environment uses production base URL', async () => {
      const client = new VirtualGiftClient('mid-123', 'key', 'production')
      mockFetchResponse({ GiftCardPageId: 'p1' })

      await client.createGiftCardPage(makeConfig())

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('paylink.dcap.com')
      expect(url).not.toContain('paylink-cert')
    })
  })

  describe('error handling', () => {
    it('throws VirtualGiftApiError on non-200 response', async () => {
      const client = new VirtualGiftClient('mid-123', 'key', 'cert')
      mockFetchResponse({ Message: 'Unauthorized' }, 401)

      await expect(client.createGiftCardPage(makeConfig())).rejects.toThrow(/Unauthorized/)
    })

    it('includes status code in error', async () => {
      const client = new VirtualGiftClient('mid-123', 'key', 'cert')
      mockFetchResponse({ Message: 'Not Found' }, 404)

      try {
        await client.createGiftCardPage(makeConfig())
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(404)
      }
    })
  })
})
