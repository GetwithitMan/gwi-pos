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

// Read actual version from package.json so PayAPI User-Agent reflects the real POS version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _pkg = require('../../../package.json') as { version: string }
const USER_AGENT = `GWI-POS/${_pkg.version}`
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

// ─── ACH Request Interfaces ─────────────────────────────────────────────────

export interface PayApiAchAuthorizeRequest {
  routingNo: string         // 9-digit ABA routing number
  acctNo: string            // Customer account number
  acctType: 'Checking' | 'Savings'
  amount: string            // "15.00" — 2 decimal places
  invoiceNo: string         // unique transaction identifier
  custFirstName?: string
  custLastName?: string
  fullName?: string         // Business name — overrides first/last when provided
  entryClass?: 'Personal' | 'Company' | 'PersonalRecurring' | 'CompanyRecurring'
  token?: string            // Required for recurring authorizations
  trace?: string
  overrideDuplicate?: boolean
  standardEntryClassCode?: 'TEL' | 'PPD' | 'CCD' | 'WEB'
  singleOrRecurring?: 'S' | 'R'
}

export interface PayApiAchReturnRequest {
  refNo: string             // RefNo of original authorize — goes in URL
  routingNo: string
  acctNo: string
  amount: string
  custFirstName: string
  custLastName: string
  entryClass: 'Personal' | 'Company' | 'PersonalRecurring' | 'CompanyRecurring'
  fullName?: string
  acctType?: 'Checking' | 'Savings'
  token?: string
  invoiceNo?: string
  trace?: string
  overrideDuplicate?: boolean
}

export interface PayApiAchVoidRequest {
  refNo: string             // RefNo of original authorize — goes in URL
  token: string             // Required
  custFirstName: string
  custLastName: string
  fullName?: string
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

// ─── ACH Response Interface ─────────────────────────────────────────────────

export interface PayApiAchResponse {
  status: 'Approved' | 'Declined' | 'Error' | 'Success'
  message: string
  refNo: string
  invoiceNo: string
  amount: string
  authorized: string       // Note: Datacap ACH uses "Authorize" field (mapped here)
  token: string            // Reusable multi-use token for recurring
  returnCode: string
  responseOrigin: string
  tranCode?: string        // "Authorize" | "Return" | "Void" | "PayOut"
  acctNo?: string          // Masked account number
  routingNo?: string
  acctType?: string        // "Checking" | "Savings"
  custFirstName?: string
  custLastName?: string
  fullName?: string
  trace?: string
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
  // ACH-specific fields (present in ACH responses)
  Authorize?: string       // ACH uses "Authorize" instead of "Authorized"
  TranCode?: string
  AcctNo?: string          // ACH uses "AcctNo" instead of "Account"
  RoutingNo?: string
  AcctType?: string
  CustFirstName?: string
  CustLastName?: string
  FullName?: string
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

/**
 * Map a raw Datacap ACH response to our normalized ACH response shape.
 * ACH uses "Authorize" instead of "Authorized" and "AcctNo" instead of "Account".
 */
function mapAchResponse(raw: RawPayApiResponse): PayApiAchResponse {
  return {
    status:         (raw.Status as PayApiAchResponse['status']) ?? 'Error',
    message:        raw.Message        ?? '',
    refNo:          raw.RefNo          ?? '',
    invoiceNo:      raw.InvoiceNo      ?? '',
    amount:         raw.Amount         ?? '0.00',
    authorized:     raw.Authorize      ?? '0.00',  // ACH field name
    token:          raw.Token          ?? '',
    returnCode:     raw.ReturnCode     ?? '',
    responseOrigin: raw.ResponseOrigin ?? '',
    tranCode:       raw.TranCode,
    acctNo:         raw.AcctNo,
    routingNo:      raw.RoutingNo,
    acctType:       raw.AcctType,
    custFirstName:  raw.CustFirstName,
    custLastName:   raw.CustLastName,
    fullName:       raw.FullName,
    trace:          raw.Trace,
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

  // ─── ACH Transaction Methods ──────────────────────────────────────────────

  /**
   * Authorize an ACH bank account debit (pull funds).
   * For online ordering: use StandardEntryClassCode='WEB' + SingleOrRecurring='S'.
   * POST /ach/authorize
   */
  async achAuthorize(req: PayApiAchAuthorizeRequest): Promise<PayApiAchResponse> {
    return this.requestAch('POST', '/ach/authorize', {
      RoutingNo:    req.routingNo,
      AcctNo:       req.acctNo,
      AcctType:     req.acctType,
      Amount:       req.amount,
      InvoiceNo:    req.invoiceNo,
      CustFirstName: req.custFirstName,
      CustLastName:  req.custLastName,
      FullName:     req.fullName,
      EntryClass:   req.entryClass ?? 'Personal',
      Token:        req.token,
      Trace:        req.trace,
      OverrideDuplicate: req.overrideDuplicate?.toString(),
      StandardEntryClassCode: req.standardEntryClassCode,
      SingleOrRecurring:      req.singleOrRecurring,
    })
  }

  /**
   * Return/refund a previously processed ACH authorization.
   * Must be within 45 days of the original and cannot exceed original amount.
   * POST /ach/return/{RefNo}
   */
  async achReturn(req: PayApiAchReturnRequest): Promise<PayApiAchResponse> {
    return this.requestAch('POST', `/ach/return/${encodeURIComponent(req.refNo)}`, {
      CustFirstName: req.custFirstName,
      CustLastName:  req.custLastName,
      RoutingNo:     req.routingNo,
      AcctNo:        req.acctNo,
      Amount:        req.amount,
      EntryClass:    req.entryClass,
      FullName:      req.fullName,
      AcctType:      req.acctType,
      Token:         req.token,
      InvoiceNo:     req.invoiceNo,
      Trace:         req.trace,
      OverrideDuplicate: req.overrideDuplicate?.toString(),
    })
  }

  /**
   * Void a previously processed ACH authorization (same day only).
   * POST /ach/authorize/{RefNo}/void
   */
  async achVoid(req: PayApiAchVoidRequest): Promise<PayApiAchResponse> {
    return this.requestAch('POST', `/ach/authorize/${encodeURIComponent(req.refNo)}/void`, {
      Token:         req.token,
      CustFirstName: req.custFirstName,
      CustLastName:  req.custLastName,
      FullName:      req.fullName,
    })
  }

  // ─── ACH Core Request ─────────────────────────────────────────────────────

  /**
   * ACH requests use the same auth/transport as credit but return ACH-shaped responses.
   * ACH uses "Authorize" instead of "Authorized" and "AcctNo" instead of "Account".
   */
  private async requestAch(
    method: 'POST',
    path: string,
    body: Record<string, string | undefined>
  ): Promise<PayApiAchResponse> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Authorization': this.buildAuth(),
      'User-Agent':    USER_AGENT,
      'Accept':        'application/json',
    }

    // Strip undefined values from body before sending
    const cleanBody: Record<string, string> = {}
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) cleanBody[k] = v
    }
    const serializedBody = JSON.stringify(cleanBody)
    headers['Content-Type'] = 'application/json'

    // ACH may take longer than credit — use 10s timeout
    const ACH_TIMEOUT_MS = 10_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACH_TIMEOUT_MS)

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
          'ACH payment processor timed out (10s). Please retry.',
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
      throw new PayApiError(
        `PayAPI ACH returned non-JSON response (HTTP ${res.status})`,
        res.status
      )
    }

    const mapped = mapAchResponse(raw)

    if (res.ok) {
      return mapped
    }

    // Do NOT include acctNo or token in the error message (PCI/bank data)
    const safeMessage = `PayAPI ACH error: ${mapped.message || res.statusText} (HTTP ${res.status}, ReturnCode ${mapped.returnCode})`
    throw new PayApiError(safeMessage, res.status)
  }

  // ─── Account Updater Methods ────────────────────────────────────────────────
  // Datacap Account Updater uses V1 API (not V2) at a different base path.
  // Enrolling a token returns a PID (Payment Account ID) that auto-refreshes
  // card data twice monthly. The PID can be used like any other multi-use token.
  // Supports Visa, Amex, Mastercard, Discover. Interac NOT supported.

  /**
   * Enroll a Datacap token in Account Updater.
   * Returns a PID (Payment Account ID) in the Token field that auto-updates.
   * POST /V1/AccountUpdate/Create
   */
  async accountUpdaterCreate(token: string): Promise<PayApiResponse> {
    return this.requestV1('POST', '/V1/AccountUpdate/Create', { Token: token })
  }

  /**
   * Remove a PID from the Account Updater service.
   * POST /V1/AccountUpdate/Delete
   */
  async accountUpdaterDelete(pid: string): Promise<PayApiResponse> {
    return this.requestV1('POST', '/V1/AccountUpdate/Delete', { Token: pid })
  }

  // ─── V1 Request (Account Updater) ──────────────────────────────────────────
  // Account Updater uses a V1 base path instead of V2.
  // Same auth, same response format, different URL prefix.

  private async requestV1(
    method: 'POST',
    path: string,
    body: Record<string, string>
  ): Promise<PayApiResponse> {
    // V1 endpoints use the root host, not /v2
    const baseHost = this.baseUrl.replace(/\/v2$/, '')
    const url = `${baseHost}${path}`

    const headers: Record<string, string> = {
      'Authorization': this.buildAuth(),
      'User-Agent':    USER_AGENT,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    }

    const serializedBody = JSON.stringify(body)

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
        throw new PayApiError('Account Updater request timed out (5s).', 408)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }

    let raw: RawPayApiResponse = {}
    try {
      // V1 responses may be nested under "application/json" key
      const json = await res.json()
      raw = (json?.['application/json'] ?? json) as RawPayApiResponse
    } catch {
      throw new PayApiError(
        `PayAPI V1 returned non-JSON response (HTTP ${res.status})`,
        res.status
      )
    }

    const mapped = mapResponse(raw)

    if (res.ok) {
      return mapped
    }

    const safeMessage = `PayAPI V1 error: ${mapped.message || res.statusText} (HTTP ${res.status}, ReturnCode ${mapped.returnCode})`
    throw new PayApiError(safeMessage, res.status, mapped)
  }
}

// ─── Status Helpers ──────────────────────────────────────────────────────────

/**
 * PayAPI can return either 'Approved' or 'Success' on a successful transaction.
 * Use this helper everywhere instead of checking status === 'Approved' directly.
 */
export function isPayApiSuccess(status: string): boolean {
  return status === 'Approved' || status === 'Success'
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
