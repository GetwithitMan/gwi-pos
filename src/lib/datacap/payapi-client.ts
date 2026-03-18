import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('datacap')

// Datacap PayAPI V2 Client — Card-Not-Present REST API
// REST over HTTPS with Basic Auth to Datacap's PayAPI endpoint
// Used for token-based charges when no physical card reader is present

// ─── Base URLs ────────────────────────────────────────────────────────────────

const PAYAPI_URLS = {
  cert:       'https://pay-cert.dcap.com/v2',
  production: 'https://pay.dcap.com/v2',
} as const

const USER_AGENT = 'GWI-POS/1.0.0'
const PAYAPI_TIMEOUT_MS = 5000  // 5s circuit breaker — fail fast if processor hangs

// ─── Request Interfaces ───────────────────────────────────────────────────────

export interface PayApiSaleRequest {
  token: string       // Datacap OTU or multi-use token
  amount: string      // "15.11" — 2 decimal places
  invoiceNo: string   // unique transaction identifier (use order number as string)
  tip?: string        // "2.50"
  tax?: string        // "1.25"
  cvv?: string        // from tokenization response
  trace?: string      // optional tracking value
  recurringData?: string  // Datacap recurring billing chain data
}

export interface PayApiVoidRequest {
  refNo: string       // in URL
  token: string
  invoiceNo: string
  trace?: string
}

export interface PayApiRefundRequest {
  token: string
  amount: string
  invoiceNo: string
  trace?: string
}

export interface PayApiPreAuthRequest {
  token: string
  amount: string
  invoiceNo: string
  cvv?: string
  trace?: string
}

export interface PayApiCaptureRequest {
  refNo: string       // in URL
  token: string
  amount: string
  invoiceNo: string
  tip?: string
  trace?: string
}

// ─── Response Interface ───────────────────────────────────────────────────────

export interface PayApiResponse {
  status: 'Approved' | 'Declined' | 'Error' | 'Success'
  message: string
  refNo: string
  invoiceNo: string
  amount: string
  authorized: string
  token: string       // reusable multi-use token for storage
  authCode?: string
  account?: string    // masked card number
  brand?: string      // VISA | M/C | DCVR | AMEX | DCLB | JCB | OTHER
  tip?: string
  returnCode: string
  responseOrigin: string
  trace?: string
  recurringData?: string  // Datacap recurring billing chain data from response
}

// ─── Raw API Shape (PascalCase from Datacap) ─────────────────────────────────

interface RawPayApiResponse {
  ResponseOrigin?: string
  ReturnCode?: string
  Status?: string
  Message?: string
  Account?: string
  Brand?: string
  AuthCode?: string
  RefNo?: string
  InvoiceNo?: string
  Amount?: string
  Authorized?: string
  Token?: string
  Tip?: string
  Trace?: string
  RecurringData?: string
}

// ─── Error Class ──────────────────────────────────────────────────────────────

export class PayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: PayApiResponse
  ) {
    super(message)
    this.name = 'PayApiError'
  }
}

// ─── Response Mapper ──────────────────────────────────────────────────────────

function mapResponse(raw: RawPayApiResponse): PayApiResponse {
  return {
    status:         (raw.Status as PayApiResponse['status']) ?? 'Error',
    message:        raw.Message        ?? '',
    refNo:          raw.RefNo          ?? '',
    invoiceNo:      raw.InvoiceNo      ?? '',
    amount:         raw.Amount         ?? '0.00',
    authorized:     raw.Authorized     ?? '0.00',
    token:          raw.Token          ?? '',
    authCode:       raw.AuthCode,
    account:        raw.Account,
    brand:          raw.Brand,
    tip:            raw.Tip,
    returnCode:     raw.ReturnCode     ?? '',
    responseOrigin: raw.ResponseOrigin ?? '',
    trace:          raw.Trace,
    recurringData:  raw.RecurringData,
  }
}

// ─── PayApiClient ─────────────────────────────────────────────────────────────

export class PayApiClient {
  private readonly mid: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor() {
    const env = process.env.DATACAP_PAYAPI_ENV ?? 'cert'

    const mid    = process.env.DATACAP_PAYAPI_MID
    const apiKey = process.env.DATACAP_PAYAPI_KEY

    if (!mid) {
      throw new Error(
        'DATACAP_PAYAPI_MID environment variable is not set. ' +
        'Set it to your Datacap eCommerce Merchant ID before using PayApiClient.'
      )
    }
    if (!apiKey) {
      throw new Error(
        'DATACAP_PAYAPI_KEY environment variable is not set. ' +
        'Set it to your Datacap PayAPI key before using PayApiClient.'
      )
    }

    this.mid    = mid
    this.apiKey = apiKey
    this.baseUrl = env === 'production' ? PAYAPI_URLS.production : PAYAPI_URLS.cert
  }

  // ─── Auth Header ───────────────────────────────────────────────────────────

  private buildAuth(): string {
    const credentials = Buffer.from(`${this.mid}:${this.apiKey}`).toString('base64')
    return `Basic ${credentials}`
  }

  // ─── Core Request ──────────────────────────────────────────────────────────

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: Record<string, string | undefined>
  ): Promise<PayApiResponse> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Authorization': this.buildAuth(),
      'User-Agent':    USER_AGENT,
      'Accept':        'application/json',
    }

    // Strip undefined values from body before sending
    let serializedBody: string | undefined
    if (body !== undefined) {
      const cleanBody: Record<string, string> = {}
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) cleanBody[k] = v
      }
      serializedBody = JSON.stringify(cleanBody)
      headers['Content-Type'] = 'application/json'
    }

    // 5s circuit breaker — fail fast if processor hangs
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAYAPI_TIMEOUT_MS)

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
        throw new PayApiError(
          'Payment processor timed out (5s). Please retry.',
          408
        )
      }
      throw err
    } finally {
      clearTimeout(timer)
    }

    let raw: RawPayApiResponse = {}
    try {
      raw = (await res.json()) as RawPayApiResponse
    } catch {
      // Non-JSON body — treat as error with HTTP status description
      throw new PayApiError(
        `PayAPI returned non-JSON response (HTTP ${res.status})`,
        res.status
      )
    }

    const mapped = mapResponse(raw)

    // Warn if RecurringData was sent but not returned (chain corruption risk)
    if (body?.RecurringData && !mapped.recurringData) {
      log.warn('[PayAPI] WARNING: RecurringData missing from response — chain corruption risk. Preserving old chain.')
    }

    // HTTP 200 = approved/success
    if (res.ok) {
      return mapped
    }

    // HTTP 402 = declined, 400/401/404 = error
    // Do NOT include token or account in the error message (PCI)
    const safeMessage = `PayAPI error: ${mapped.message || res.statusText} (HTTP ${res.status}, ReturnCode ${mapped.returnCode})`
    throw new PayApiError(safeMessage, res.status, mapped)
  }

  // ─── Transaction Methods ───────────────────────────────────────────────────

  /**
   * Charge a card using a Datacap token (OTU or multi-use).
   * POST /credit/sale
   */
  async sale(req: PayApiSaleRequest): Promise<PayApiResponse> {
    return this.request('POST', '/credit/sale', {
      Token:     req.token,
      Amount:    req.amount,
      InvoiceNo: req.invoiceNo,
      Tip:       req.tip,
      Tax:       req.tax,
      CVV:       req.cvv,
      Trace:     req.trace,
      RecurringData: req.recurringData,
    })
  }

  /**
   * Void a completed sale.
   * POST /credit/sale/{RefNo}/void
   */
  async voidSale(req: PayApiVoidRequest): Promise<PayApiResponse> {
    return this.request('POST', `/credit/sale/${encodeURIComponent(req.refNo)}/void`, {
      Token:     req.token,
      InvoiceNo: req.invoiceNo,
      Trace:     req.trace,
    })
  }

  /**
   * Blind refund — return funds to a card without referencing the original sale.
   * POST /credit/return
   */
  async refund(req: PayApiRefundRequest): Promise<PayApiResponse> {
    return this.request('POST', '/credit/return', {
      Token:     req.token,
      Amount:    req.amount,
      InvoiceNo: req.invoiceNo,
      Trace:     req.trace,
    })
  }

  /**
   * Pre-authorize a card (hold funds without capturing).
   * POST /credit/preauth
   */
  async preAuth(req: PayApiPreAuthRequest): Promise<PayApiResponse> {
    return this.request('POST', '/credit/preauth', {
      Token:     req.token,
      Amount:    req.amount,
      InvoiceNo: req.invoiceNo,
      CVV:       req.cvv,
      Trace:     req.trace,
    })
  }

  /**
   * Capture a pre-authorized hold (finalize the charge).
   * PUT /credit/preauth/{RefNo}
   */
  async capture(req: PayApiCaptureRequest): Promise<PayApiResponse> {
    return this.request('PUT', `/credit/preauth/${encodeURIComponent(req.refNo)}`, {
      Token:     req.token,
      Amount:    req.amount,
      InvoiceNo: req.invoiceNo,
      Tip:       req.tip,
      Trace:     req.trace,
    })
  }

  /**
   * Void a pre-authorization before it is captured.
   * POST /credit/preauth/{RefNo}/void
   */
  async voidAuth(req: PayApiVoidRequest): Promise<PayApiResponse> {
    return this.request('POST', `/credit/preauth/${encodeURIComponent(req.refNo)}/void`, {
      Token:     req.token,
      InvoiceNo: req.invoiceNo,
      Trace:     req.trace,
    })
  }

  /**
   * Look up a transaction by its Datacap reference number.
   * GET /credit/{RefNo}
   */
  async getTransaction(refNo: string): Promise<PayApiResponse> {
    return this.request('GET', `/credit/${encodeURIComponent(refNo)}`)
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _payApiClient: PayApiClient | null = null

/**
 * Return the shared PayApiClient singleton.
 * Constructed lazily — reads env vars on first call.
 *
 * Throws if DATACAP_PAYAPI_MID or DATACAP_PAYAPI_KEY are missing.
 */
export function getPayApiClient(): PayApiClient {
  if (!_payApiClient) {
    _payApiClient = new PayApiClient()
  }
  return _payApiClient
}
