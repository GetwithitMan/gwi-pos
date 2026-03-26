import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('datacap-virtual-gift')

// Datacap Virtual Gift API Client — Manages hosted gift card storefront pages
// REST over HTTPS with Basic Auth to Datacap's PayLink endpoint
// Used for creating/managing virtual gift card purchase pages

// ─── Base URLs ────────────────────────────────────────────────────────────────

const PAYLINK_URLS = {
  cert:       'https://paylink-cert.dcap.com',
  production: 'https://paylink.dcap.com',
} as const

const USER_AGENT = 'GWI-POS/1.0.0'
const REQUEST_TIMEOUT_MS = 10_000  // 10s — page operations are slower than payment transactions

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VirtualGiftPageConfig {
  displayProperties: {
    merchantName: string
    merchantLogo?: string
    headerText?: string
    descriptionText?: string
    thankYouMessage?: string
    termsAndConditions?: string
    presetAmounts?: number[]
    minAmount?: number
    maxAmount?: number
    allowCustomAmount?: boolean
  }
  customizationProperties?: {
    primaryColor?: string
    secondaryColor?: string
    backgroundColor?: string
    fontFamily?: string
    borderRadius?: string
    logoPosition?: 'left' | 'center' | 'right'
  }
  paymentTypes: ('credit' | 'debit' | 'ach' | 'apple_pay' | 'google_pay')[]
  supportedDeliveryMethods: string[]
  widgetOptions?: {
    showPreview?: boolean
    showRecipientFields?: boolean
    showMessageField?: boolean
    showScheduleDelivery?: boolean
    maxMessageLength?: number
  }
  webhookEndpoints?: {
    paymentCompleted?: string
    paymentFailed?: string
    deliveryCompleted?: string
  }
}

export interface VirtualGiftPageResponse {
  giftCardPageId: string
  publicLinkId: string
  publicLinkUrl: string
  publicLinkQRCodeUrl: string
  publicLinkEmbeddedUrl: string
  status: 'Active' | 'Archived'
  paymentTypes: string[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  displayProperties: Record<string, unknown>
  customizationProperties: Record<string, unknown>
  supportedDeliveryMethods: string[]
}

export interface VirtualGiftWebhookPayload {
  transactionId: string
  giftCardPageId: string
  publicLinkId: string
  merchantId: string
  status: string
  paymentTypeUsed: string
  giftCardData: Record<string, unknown>
  giftCardNumber: string
  // NEVER log or store giftCardCvv
  giftCardCvv?: string
  giftCardLast4: string
  giftCardBalance: number
  paidAt: string
  deliveryMethods: string[]
  recipientName?: string
  recipientEmail?: string
  recipientPhone?: string
  purchaserName?: string
  message?: string
}

export interface VirtualGiftTransaction {
  transactionId: string
  status: string
  amount: number
  paymentTypeUsed: string
  giftCardLast4: string
  paidAt: string
  deliveryStatus: string
}

// ─── Raw API Shapes (PascalCase from Datacap) ────────────────────────────────

interface RawPageResponse {
  GiftCardPageId?: string
  PublicLinkId?: string
  PublicLinkUrl?: string
  PublicLinkQRCodeUrl?: string
  PublicLinkEmbeddedUrl?: string
  Status?: string
  PaymentTypes?: string[]
  CreatedAt?: string
  UpdatedAt?: string
  ArchivedAt?: string | null
  DisplayProperties?: Record<string, unknown>
  CustomizationProperties?: Record<string, unknown>
  SupportedDeliveryMethods?: string[]
}

// ─── Error Class ──────────────────────────────────────────────────────────────

export class VirtualGiftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'VirtualGiftApiError'
  }
}

// ─── Response Mapper ──────────────────────────────────────────────────────────

function mapPageResponse(raw: RawPageResponse): VirtualGiftPageResponse {
  return {
    giftCardPageId:        raw.GiftCardPageId        ?? '',
    publicLinkId:          raw.PublicLinkId           ?? '',
    publicLinkUrl:         raw.PublicLinkUrl          ?? '',
    publicLinkQRCodeUrl:   raw.PublicLinkQRCodeUrl    ?? '',
    publicLinkEmbeddedUrl: raw.PublicLinkEmbeddedUrl  ?? '',
    status:                (raw.Status as VirtualGiftPageResponse['status']) ?? 'Active',
    paymentTypes:          raw.PaymentTypes           ?? [],
    createdAt:             raw.CreatedAt              ?? '',
    updatedAt:             raw.UpdatedAt              ?? '',
    archivedAt:            raw.ArchivedAt             ?? null,
    displayProperties:     raw.DisplayProperties      ?? {},
    customizationProperties: raw.CustomizationProperties ?? {},
    supportedDeliveryMethods: raw.SupportedDeliveryMethods ?? [],
  }
}

// ─── VirtualGiftClient ───────────────────────────────────────────────────────

export class VirtualGiftClient {
  private readonly ecommerceMid: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(ecommerceMid: string, apiKey: string, environment: 'cert' | 'production' = 'cert') {
    if (!ecommerceMid) {
      throw new Error('ecommerceMid is required for VirtualGiftClient')
    }
    if (!apiKey) {
      throw new Error('apiKey is required for VirtualGiftClient')
    }

    this.ecommerceMid = ecommerceMid
    this.apiKey = apiKey
    this.baseUrl = environment === 'production' ? PAYLINK_URLS.production : PAYLINK_URLS.cert
  }

  // ─── Auth Header ───────────────────────────────────────────────────────────

  private buildAuth(): string {
    const credentials = Buffer.from(`${this.ecommerceMid}:${this.apiKey}`).toString('base64')
    return `Basic ${credentials}`
  }

  // ─── Core Request ──────────────────────────────────────────────────────────

  private async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Authorization': this.buildAuth(),
      'User-Agent':    USER_AGENT,
      'Accept':        'application/json',
    }

    let serializedBody: string | undefined
    if (body !== undefined) {
      serializedBody = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: serializedBody,
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new VirtualGiftApiError(
          'Datacap Virtual Gift API timed out (10s). Please retry.',
          408
        )
      }
      throw err
    } finally {
      clearTimeout(timer)
    }

    let rawJson: T
    try {
      rawJson = (await res.json()) as T
    } catch {
      throw new VirtualGiftApiError(
        `Datacap Virtual Gift API returned non-JSON response (HTTP ${res.status})`,
        res.status
      )
    }

    if (res.ok) {
      return rawJson
    }

    const errorBody = rawJson as Record<string, unknown>
    const message = (errorBody?.Message as string) || (errorBody?.message as string) || res.statusText
    throw new VirtualGiftApiError(
      `Datacap Virtual Gift API error: ${message} (HTTP ${res.status})`,
      res.status,
      errorBody
    )
  }

  // ─── Page Operations ───────────────────────────────────────────────────────

  /**
   * Create a new gift card storefront page.
   * POST /api/v1/giftcard
   */
  async createGiftCardPage(config: VirtualGiftPageConfig): Promise<VirtualGiftPageResponse> {
    log.info('Creating Datacap Virtual Gift page')
    const raw = await this.request<RawPageResponse>('POST', '/api/v1/giftcard', {
      DisplayProperties: config.displayProperties,
      CustomizationProperties: config.customizationProperties ?? {},
      PaymentTypes: config.paymentTypes,
      SupportedDeliveryMethods: ['Print'],  // Hardcoded — we handle email/SMS ourselves
      WidgetOptions: config.widgetOptions ?? {},
      WebhookEndpoints: config.webhookEndpoints ?? {},
    })
    return mapPageResponse(raw)
  }

  /**
   * Get the status and config of an existing gift card page.
   * GET /api/v1/giftcard/{pageId}
   */
  async getGiftCardPage(pageId: string): Promise<VirtualGiftPageResponse> {
    const raw = await this.request<RawPageResponse>('GET', `/api/v1/giftcard/${encodeURIComponent(pageId)}`)
    return mapPageResponse(raw)
  }

  /**
   * Update an existing gift card page configuration.
   * PUT /api/v1/giftcard/{pageId}
   */
  async updateGiftCardPage(pageId: string, config: Partial<VirtualGiftPageConfig>): Promise<VirtualGiftPageResponse> {
    log.info({ pageId }, 'Updating Datacap Virtual Gift page')
    const body: Record<string, unknown> = {}
    if (config.displayProperties) body.DisplayProperties = config.displayProperties
    if (config.customizationProperties) body.CustomizationProperties = config.customizationProperties
    if (config.paymentTypes) body.PaymentTypes = config.paymentTypes
    if (config.widgetOptions) body.WidgetOptions = config.widgetOptions
    if (config.webhookEndpoints) body.WebhookEndpoints = config.webhookEndpoints
    // Always enforce our delivery method policy
    body.SupportedDeliveryMethods = ['Print']

    const raw = await this.request<RawPageResponse>('PUT', `/api/v1/giftcard/${encodeURIComponent(pageId)}`, body)
    return mapPageResponse(raw)
  }

  /**
   * Archive (deactivate) a gift card page.
   * PUT /api/v1/giftcard/{pageId}/archive
   */
  async archiveGiftCardPage(pageId: string): Promise<VirtualGiftPageResponse> {
    log.info({ pageId }, 'Archiving Datacap Virtual Gift page')
    const raw = await this.request<RawPageResponse>('PUT', `/api/v1/giftcard/${encodeURIComponent(pageId)}/archive`)
    return mapPageResponse(raw)
  }

  /**
   * Get transactions for a gift card page.
   * GET /api/v1/giftcard/{pageId}/transactions
   */
  async getPageTransactions(pageId: string): Promise<VirtualGiftTransaction[]> {
    const raw = await this.request<Record<string, unknown>[]>('GET', `/api/v1/giftcard/${encodeURIComponent(pageId)}/transactions`)
    return (raw || []).map((t) => ({
      transactionId:   (t.TransactionId as string)   ?? '',
      status:          (t.Status as string)           ?? '',
      amount:          (t.Amount as number)            ?? 0,
      paymentTypeUsed: (t.PaymentTypeUsed as string)  ?? '',
      giftCardLast4:   (t.GiftCardLast4 as string)    ?? '',
      paidAt:          (t.PaidAt as string)            ?? '',
      deliveryStatus:  (t.DeliveryStatus as string)   ?? '',
    }))
  }

  /**
   * Retry delivery for a specific transaction.
   * PUT /api/v1/giftcard/{pageId}/{transactionId}/retryDelivery
   */
  async retryDelivery(pageId: string, transactionId: string): Promise<Record<string, unknown>> {
    log.info({ pageId, transactionId }, 'Retrying delivery for Virtual Gift transaction')
    return this.request('PUT', `/api/v1/giftcard/${encodeURIComponent(pageId)}/${encodeURIComponent(transactionId)}/retryDelivery`)
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _virtualGiftClient: VirtualGiftClient | null = null

/**
 * Return the shared VirtualGiftClient singleton.
 * Constructed lazily from environment variables.
 *
 * Throws if DATACAP_ECOMMERCE_MID or DATACAP_ECOMMERCE_API_KEY are missing.
 */
export function getVirtualGiftClient(): VirtualGiftClient {
  if (!_virtualGiftClient) {
    const mid = process.env.DATACAP_ECOMMERCE_MID
    const apiKey = process.env.DATACAP_ECOMMERCE_API_KEY
    const env = (process.env.DATACAP_ECOMMERCE_ENV ?? 'cert') as 'cert' | 'production'

    if (!mid) {
      throw new Error(
        'DATACAP_ECOMMERCE_MID environment variable is not set. ' +
        'Set it to your Datacap eCommerce Merchant ID before using VirtualGiftClient.'
      )
    }
    if (!apiKey) {
      throw new Error(
        'DATACAP_ECOMMERCE_API_KEY environment variable is not set. ' +
        'Set it to your Datacap eCommerce API key before using VirtualGiftClient.'
      )
    }

    _virtualGiftClient = new VirtualGiftClient(mid, apiKey, env)
  }
  return _virtualGiftClient
}

/**
 * Create a VirtualGiftClient with explicit credentials.
 * Used by MC proxy routes that pass per-venue credentials.
 * NOT cached — creates a new instance each time.
 */
export function createVirtualGiftClient(
  ecommerceMid: string,
  apiKey: string,
  environment: 'cert' | 'production' = 'cert'
): VirtualGiftClient {
  return new VirtualGiftClient(ecommerceMid, apiKey, environment)
}
