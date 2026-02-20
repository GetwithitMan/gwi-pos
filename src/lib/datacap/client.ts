// Datacap Direct API — Client
// Handles all communication with Datacap devices (local HTTP) and cloud (HTTPS + Basic Auth)
// Every monetary transaction auto-calls EMVPadReset after completion

import { db } from '@/lib/db'
import type {
  DatacapConfig,
  DatacapRequestFields,
  DatacapResponse,
  DatacapResult,
  DatacapError,
  SaleParams,
  PreAuthParams,
  CaptureParams,
  IncrementParams,
  AdjustParams,
  VoidParams,
  ReturnParams,
  DevicePromptParams,
  CollectCardParams,
  PartialReversalParams,
  SaleByRecordParams,
  PreAuthByRecordParams,
  AuthOnlyParams,
  TranCode,
} from './types'
import { validateDatacapConfig } from './types'
import { buildRequest, buildAdminRequest } from './xml-builder'
import { parseResponse, parseError } from './xml-parser'
import { getSequenceNo, updateSequenceNo } from './sequence'
import { assertReaderHealthy, markReaderHealthy, markReaderDegraded, clearReaderHealth } from './reader-health'
import { simulateResponse } from './simulator'
import { SIMULATED_DEFAULTS } from './simulated-defaults' // 🚨 SIMULATED_DEFAULTS — remove for go-live
import {
  LOCAL_ENDPOINT,
  POS_PACKAGE_ID,
  DEFAULT_LOCAL_TIMEOUT_MS,
  DEFAULT_CLOUD_TIMEOUT_MS,
  PAD_RESET_TIMEOUT_MS,
  PARAM_DOWNLOAD_TIMEOUT_MS,
  TRAN_CODES,
} from './constants'
import { logger } from '@/lib/logger'

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Classify network errors as retryable or not
 * Maps Node.js error codes to clear error messages with retry guidance
 */
function classifyNetworkError(error: unknown, readerId?: string): DatacapError {
  if (!(error instanceof Error)) {
    return {
      code: 'UNKNOWN_ERROR',
      text: 'Unknown error occurred',
      description: String(error),
      isRetryable: false,
    }
  }

  const errorCode = (error as Error & { code?: string }).code
  const errorName = error.name

  // Timeout errors
  if (errorName === 'AbortError' || errorCode === 'ETIMEDOUT') {
    return {
      code: 'DATACAP_TIMEOUT',
      text: 'Request timed out',
      description: error.message,
      isRetryable: true,
    }
  }

  // Connection refused (reader is off or unreachable)
  if (errorCode === 'ECONNREFUSED') {
    return {
      code: 'DATACAP_CONNECTION_REFUSED',
      text: 'Connection refused - reader may be offline',
      description: `Cannot connect to payment reader${readerId ? ` (${readerId})` : ''}. Check that device is powered on and network connection is active.`,
      isRetryable: true,
    }
  }

  // Network unreachable (network is down)
  if (errorCode === 'ENETUNREACH') {
    return {
      code: 'DATACAP_NETWORK_UNREACHABLE',
      text: 'Network unreachable',
      description: 'Cannot reach payment network. Check WiFi/Ethernet connection.',
      isRetryable: true,
    }
  }

  // Host not found (DNS issue or wrong IP)
  if (errorCode === 'ENOTFOUND') {
    return {
      code: 'DATACAP_HOST_NOT_FOUND',
      text: 'Payment reader not found',
      description: `Cannot find payment reader${readerId ? ` at configured address (${readerId})` : ''}. Check IP address configuration.`,
      isRetryable: false, // Config issue, not network
    }
  }

  // Generic network error
  return {
    code: 'DATACAP_NETWORK_ERROR',
    text: 'Network error',
    description: error.message || 'Unknown network error',
    isRetryable: true,
  }
}

/**
 * Wrap a Datacap operation in Result pattern
 * Converts exceptions and Datacap errors into typed DatacapResult
 */
async function wrapDatacapOperation<T extends DatacapResponse>(
  operation: () => Promise<T>,
  operationName: string,
  readerId?: string
): Promise<DatacapResult<T>> {
  try {
    const response = await operation()

    // Check if response contains a Datacap-level error (declined, error status, etc.)
    const error = parseError(response)
    if (error) {
      logger.warn('datacap', `${operationName} returned error`, { code: error.code, text: error.text, readerId })
      return {
        success: false,
        response: null,
        error,
      }
    }

    // Success
    return {
      success: true,
      response,
      error: null,
    }
  } catch (err) {
    // Network error or exception
    let error: DatacapError

    if (err && typeof err === 'object' && 'code' in err && 'text' in err) {
      // Already a classified DatacapError from classifyNetworkError
      error = err as DatacapError
    } else {
      // Unexpected error - wrap it
      error = classifyNetworkError(err, readerId)
    }

    logger.error('datacap', `${operationName} threw exception`, err, { readerId, code: error.code })
    return {
      success: false,
      response: null,
      error,
    }
  }
}

// ─── Reader Info ─────────────────────────────────────────────────────────────

interface ReaderInfo {
  id: string
  ipAddress: string
  port: number
  merchantId?: string | null
  communicationMode: string
  cloudUsername?: string | null
  cloudPassword?: string | null
}

async function getReaderInfo(readerId: string): Promise<ReaderInfo> {
  const reader = await db.paymentReader.findUnique({
    where: { id: readerId },
    select: {
      id: true,
      ipAddress: true,
      port: true,
      merchantId: true,
      communicationMode: true,
      cloudUsername: true,
      cloudPassword: true,
    },
  })
  if (!reader) throw new Error(`Payment reader not found: ${readerId}`)
  return reader as ReaderInfo
}

// ─── DatacapClient ───────────────────────────────────────────────────────────

export class DatacapClient {
  private config: DatacapConfig

  constructor(config: DatacapConfig) {
    // Validate configuration based on communication mode
    validateDatacapConfig(config)
    this.config = config
  }

  // ─── Transport Layer ─────────────────────────────────────────────────────

  private async sendLocal(reader: ReaderInfo, xml: string, timeoutMs?: number): Promise<DatacapResponse> {
    const timeout = timeoutMs || this.config.localTimeoutMs || DEFAULT_LOCAL_TIMEOUT_MS
    const url = `http://${reader.ipAddress}:${reader.port}${LOCAL_ENDPOINT}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      logger.debug('[datacap] Sending request to local reader', { readerId: reader.id, url, timeout })

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xml,
        signal: controller.signal,
      })

      if (!res.ok) {
        logger.error('datacap', `Local reader HTTP error: ${res.status}`, undefined, { readerId: reader.id })
        throw new Error(`Local reader responded with HTTP ${res.status}`)
      }

      const responseXml = await res.text()
      const response = parseResponse(responseXml)
      logger.debug('[datacap] Received response from local reader', { readerId: reader.id, cmdStatus: response.cmdStatus })
      return response
    } catch (error: unknown) {
      // Classify and throw network errors with context
      const classified = classifyNetworkError(error, reader.id)
      logger.error('datacap', `Local reader error: ${classified.text}`, error, { readerId: reader.id, code: classified.code })
      throw classified
    } finally {
      clearTimeout(timer)
    }
  }

  private async sendCloud(xml: string, timeoutMs?: number): Promise<DatacapResponse> {
    if (!this.config.cloudUrl) throw new Error('Cloud URL not configured')
    if (!this.config.cloudUsername || !this.config.cloudPassword) {
      throw new Error('Cloud credentials not configured')
    }

    const timeout = timeoutMs || this.config.cloudTimeoutMs || DEFAULT_CLOUD_TIMEOUT_MS
    const credentials = Buffer.from(`${this.config.cloudUsername}:${this.config.cloudPassword}`).toString('base64')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      logger.debug('[datacap] Sending request to cloud', { url: this.config.cloudUrl, timeout })

      const res = await fetch(this.config.cloudUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Authorization': `Basic ${credentials}`,
        },
        body: xml,
        signal: controller.signal,
      })

      if (!res.ok) {
        logger.error('datacap', `Cloud server HTTP error: ${res.status}`, undefined, { url: this.config.cloudUrl })
        throw new Error(`Cloud server responded with HTTP ${res.status}`)
      }

      const responseXml = await res.text()
      const response = parseResponse(responseXml)
      logger.debug('[datacap] Received response from cloud', { cmdStatus: response.cmdStatus })
      return response
    } catch (error: unknown) {
      // Classify and throw network errors
      const classified = classifyNetworkError(error)
      logger.error('datacap', `Cloud server error: ${classified.text}`, error, { code: classified.code })
      throw classified
    } finally {
      clearTimeout(timer)
    }
  }

  private async send(reader: ReaderInfo, xml: string, timeoutMs?: number): Promise<DatacapResponse> {
    const mode = reader.communicationMode || this.config.communicationMode

    // Simulated mode — no network calls
    if (mode === 'simulated') {
      // Extract tranCode and simScenario from XML for simulator
      const tranCodeMatch = xml.match(/<TranCode>([^<]+)<\/TranCode>/)
      const tranCode = (tranCodeMatch?.[1] || 'EMVPadReset') as TranCode
      const scenarioMatch = xml.match(/<SimScenario>([^<]+)<\/SimScenario>/)
      const simScenario = scenarioMatch?.[1] as 'decline' | 'error' | 'partial' | undefined

      // Extract additional fields from XML so simulator can produce accurate responses
      const purchaseMatch = xml.match(/<Purchase>([\d.]+)<\/Purchase>/)
      const gratuityMatch = xml.match(/<Gratuity>([\d.]+)<\/Gratuity>/)
      const customerCodeMatch = xml.match(/<CustomerCode>([^<]+)<\/CustomerCode>/)
      const forceOffline = /<ForceOffline>Yes<\/ForceOffline>/i.test(xml)
      const recordNoMatch = xml.match(/<RecordNo>([^<]+)<\/RecordNo>/)
      const invoiceMatch = xml.match(/<InvoiceNo>([^<]+)<\/InvoiceNo>/)

      const simXml = simulateResponse(tranCode, {
        merchantId: '',
        operatorId: '',
        tranCode,
        invoiceNo: invoiceMatch?.[1],
        recordNo: recordNoMatch?.[1],
        customerCode: customerCodeMatch?.[1],
        amounts: purchaseMatch
          ? {
              purchase: parseFloat(purchaseMatch[1]),
              gratuity: gratuityMatch ? parseFloat(gratuityMatch[1]) : undefined,
            }
          : undefined,
      }, {
        decline: simScenario === 'decline',
        error: simScenario === 'error',
        partial: simScenario === 'partial',
        forceOffline,
      })
      return parseResponse(simXml)
    }

    if (mode === 'local') {
      return this.sendLocal(reader, xml, timeoutMs)
    }

    if (mode === 'cloud') {
      return this.sendCloud(xml, timeoutMs)
    }

    // local_with_cloud_fallback
    try {
      return await this.sendLocal(reader, xml, timeoutMs)
    } catch (localError) {
      logger.warn('datacap', 'Local failed, trying cloud fallback', { readerId: reader.id })
      return this.sendCloud(xml, timeoutMs)
    }
  }

  // ─── Pad Reset Wrapper ───────────────────────────────────────────────────
  // CRITICAL: Every monetary transaction MUST be followed by EMVPadReset

  private async withPadReset<T>(
    readerId: string,
    fn: (reader: ReaderInfo, seqNo: string) => Promise<T>
  ): Promise<T> {
    // Refuse transactions on degraded readers — operator must resolve first
    assertReaderHealthy(readerId)

    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)

    let result: T
    try {
      result = await fn(reader, seqNo)
    } finally {
      // Always pad reset, even if the transaction failed
      try {
        await this.padReset(readerId)
        markReaderHealthy(readerId)
      } catch (resetError) {
        const reason = resetError instanceof Error ? resetError.message : 'Pad reset failed'
        markReaderDegraded(readerId, reason)
        logger.error('datacap', `Pad reset failed — reader marked degraded`, resetError, { readerId })
      }
    }

    return result
  }

  // ─── Field Builder ───────────────────────────────────────────────────────

  private buildBaseFields(reader: ReaderInfo, seqNo: string): Partial<DatacapRequestFields> {
    const isSimulated = (reader.communicationMode || this.config.communicationMode) === 'simulated'
    return {
      merchantId: reader.merchantId || this.config.merchantId || (isSimulated ? SIMULATED_DEFAULTS.merchantId : undefined),
      operatorId: this.config.operatorId || (isSimulated ? SIMULATED_DEFAULTS.operatorId : undefined),
      posPackageId: this.config.posPackageId || POS_PACKAGE_ID,
      sequenceNo: seqNo,
      acctNo: 'SecureDevice',
      tranDeviceId: 0,
    }
  }

  // ─── Update Sequence From Response ───────────────────────────────────────

  private async handleResponse(readerId: string, response: DatacapResponse): Promise<DatacapResponse> {
    if (response.sequenceNo) {
      await updateSequenceNo(readerId, response.sequenceNo)
    }
    return response
  }

  // ─── Transaction Methods ─────────────────────────────────────────────────

  /**
   * Process an EMV card sale transaction
   *
   * @param readerId - Payment reader ID
   * @param params - Sale parameters (invoice, amounts, tip mode, etc.)
   * @returns Datacap response with authorization details
   * @throws DatacapError if transaction fails
   *
   * @example
   * ```typescript
   * const response = await client.sale('reader-1', {
   *   invoiceNo: 'ORD-123',
   *   amounts: { purchase: 25.00, gratuity: 5.00 },
   *   tipMode: 'suggestive',
   *   tipSuggestions: [15, 18, 20, 25]
   * })
   * ```
   */
  async sale(readerId: string, params: SaleParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.SALE,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        amounts: params.amounts,
        partialAuth: params.allowPartialAuth !== false ? 'Allow' : 'Deny',
        recordNumberRequested: params.requestRecordNo !== false,
        frequency: 'OneTime',
        cardHolderId: 'Allow_V2',
        customerCode: params.customerCode,
        forceOffline: params.forceOffline,
      }

      // Tip handling
      if (params.tipMode === 'suggestive') {
        fields.gratuity = {
          mode: 'SuggestivePrompt',
          suggestions: params.tipSuggestions || [15, 18, 20, 25],
          showTotal: true,
        }
      } else if (params.tipMode === 'prompt') {
        fields.gratuity = { mode: 'Prompt' }
      } else if (params.tipMode === 'included' && params.amounts.gratuity) {
        // Gratuity already in amounts — no special block needed
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Open a pre-authorization hold on a card (for bar tabs, etc.)
   *
   * @param readerId - Payment reader ID
   * @param params - Pre-auth parameters (invoice, amount)
   * @returns Datacap response with recordNo for future capture/adjustment
   * @throws DatacapError if transaction fails
   *
   * @example
   * ```typescript
   * const response = await client.preAuth('reader-1', {
   *   invoiceNo: 'TAB-456',
   *   amount: 50.00
   * })
   * // Use response.recordNo for later capture/void
   * ```
   */
  async preAuth(readerId: string, params: PreAuthParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.PRE_AUTH,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        amounts: { purchase: params.amount },
        partialAuth: 'Allow',
        recordNumberRequested: params.requestRecordNo !== false,
        frequency: 'OneTime',
        cardHolderId: 'Allow_V2',
        forceOffline: params.forceOffline,
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Capture a pre-authorized hold (close a bar tab)
   *
   * @param readerId - Payment reader ID
   * @param params - Capture parameters (recordNo, purchase amount, optional gratuity)
   * @returns Datacap response with final authorization
   * @throws DatacapError if capture fails
   *
   * @example
   * ```typescript
   * const response = await client.preAuthCapture('reader-1', {
   *   recordNo: '123456',
   *   purchaseAmount: 45.00,
   *   gratuityAmount: 9.00
   * })
   * ```
   */
  async preAuthCapture(readerId: string, params: CaptureParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.CAPTURE,
        recordNo: params.recordNo,
        amounts: {
          purchase: params.purchaseAmount,
          gratuity: params.gratuityAmount,
        },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Increase a pre-authorized hold amount (for running tabs)
   *
   * @param readerId - Payment reader ID
   * @param params - Increment parameters (recordNo, additional amount)
   * @returns Datacap response confirming new hold amount
   * @throws DatacapError if increment fails
   */
  async incrementalAuth(readerId: string, params: IncrementParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.INCREMENT,
        recordNo: params.recordNo,
        amounts: { purchase: params.additionalAmount },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Adjust gratuity on a completed transaction (add tip after close)
   *
   * @param readerId - Payment reader ID
   * @param params - Adjustment parameters (recordNo, purchase amount, new gratuity amount)
   * @returns Datacap response confirming adjustment
   * @throws DatacapError if adjustment fails
   */
  async adjustGratuity(readerId: string, params: AdjustParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.ADJUST,
        recordNo: params.recordNo,
        amounts: {
          purchase: params.purchaseAmount,
          gratuity: params.gratuityAmount,
        },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Void a completed sale transaction (releases hold, refunds customer)
   *
   * @param readerId - Payment reader ID
   * @param params - Void parameters (recordNo from original transaction)
   * @returns Datacap response confirming void
   * @throws DatacapError if void fails
   */
  async voidSale(readerId: string, params: VoidParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.VOID_SALE,
        recordNo: params.recordNo,
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Void a return/refund transaction
   *
   * @param readerId - Payment reader ID
   * @param params - Void parameters (recordNo from original return)
   * @returns Datacap response confirming void
   * @throws DatacapError if void fails
   */
  async voidReturn(readerId: string, params: VoidParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.VOID_RETURN,
        recordNo: params.recordNo,
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Process a refund with card present (EMVReturn) or by recordNo (ReturnByRecordNo)
   *
   * @param readerId - Payment reader ID
   * @param params - Return parameters (amount, optional recordNo for card-not-present)
   * @returns Datacap response with refund confirmation
   * @throws DatacapError if return fails
   */
  async emvReturn(readerId: string, params: ReturnParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)

      // Card present → EMVReturn (customer dips/taps)
      // Card not present → ReturnByRecordNo (use stored token)
      const cardPresent = params.cardPresent !== false
      const tranCode = cardPresent ? TRAN_CODES.RETURN : TRAN_CODES.RETURN_BY_RECORD

      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        amounts: { purchase: params.amount },
        recordNo: params.recordNo,
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Collect card data without charging (for card-on-file, etc.)
   *
   * @param readerId - Payment reader ID
   * @param params - Optional parameters (placeholder amount for card read)
   * @returns Datacap response with card token and last4
   * @throws DatacapError if card read fails
   */
  async collectCardData(readerId: string, params?: CollectCardParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.COLLECT_CARD,
        amounts: { purchase: params?.placeholderAmount || 0.01 },
        cardHolderId: 'Allow_V2',
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Partially reverse a pre-auth hold (reduce hold amount)
   * Datacap test case 7.7 — PartialReversalByRecordNo
   *
   * @param readerId - Payment reader ID
   * @param params - Reversal parameters (recordNo, reversalAmount)
   * @returns Datacap response confirming reduced hold
   */
  async partialReversal(readerId: string, params: PartialReversalParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.PARTIAL_REVERSAL,
        recordNo: params.recordNo,
        amounts: { purchase: params.reversalAmount },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Process a sale using a stored Datacap vault token (card not present)
   * Datacap test case 8.1 — SaleByRecordNo
   *
   * @param readerId - Payment reader ID
   * @param params - Sale parameters (recordNo, invoiceNo, amount, optional gratuity)
   * @returns Datacap response with authorization
   */
  async saleByRecordNo(readerId: string, params: SaleByRecordParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.SALE_BY_RECORD,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        recordNo: params.recordNo,
        amounts: {
          purchase: params.amount,
          gratuity: params.gratuityAmount,
        },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Pre-authorize using a stored Datacap vault token (card not present)
   * Datacap test case 8.3 — PreAuthByRecordNo
   *
   * @param readerId - Payment reader ID
   * @param params - Pre-auth parameters (recordNo, invoiceNo, amount)
   * @returns Datacap response with new auth hold
   */
  async preAuthByRecordNo(readerId: string, params: PreAuthByRecordParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.PRE_AUTH_BY_RECORD,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        recordNo: params.recordNo,
        amounts: { purchase: params.amount },
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  /**
   * Zero-dollar authorization — validates a card without charging it
   * Datacap test case 17.0 — EMVAuthOnly
   *
   * @param readerId - Payment reader ID
   * @param params - Auth-only parameters (invoiceNo for tracking)
   * @returns Datacap response confirming card is valid
   */
  async authOnly(readerId: string, params: AuthOnlyParams): Promise<DatacapResponse> {
    return this.withPadReset(readerId, async (reader, seqNo) => {
      const base = this.buildBaseFields(reader, seqNo)
      const fields: DatacapRequestFields = {
        ...base,
        merchantId: base.merchantId!,
        operatorId: base.operatorId!,
        tranCode: TRAN_CODES.AUTH_ONLY,
        invoiceNo: params.invoiceNo,
        refNo: params.invoiceNo,
        amounts: { purchase: 0.00 },
        recordNumberRequested: true,
        frequency: 'OneTime',
        cardHolderId: 'Allow_V2',
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

  // ─── Device Control ──────────────────────────────────────────────────────

  /**
   * Reset the payment terminal to idle state
   *
   * CRITICAL: This is automatically called after every monetary transaction.
   * Only call manually for device troubleshooting or ping operations.
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response confirming reset
   * @throws DatacapError if reset fails
   */
  async padReset(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.PAD_RESET,
    }

    const xml = buildRequest(fields)
    const padResetTimeout = this.config.padResetTimeoutMs || PAD_RESET_TIMEOUT_MS
    const response = await this.send(reader, xml, padResetTimeout)
    // A successful manual pad reset clears any degraded state
    if (response.cmdStatus === 'Success') {
      clearReaderHealth(readerId)
    }
    return this.handleResponse(readerId, response)
  }

  /**
   * Download configuration parameters to the payment terminal
   *
   * Used during terminal setup or after configuration changes.
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response confirming parameter download
   * @throws DatacapError if download fails
   */
  async paramDownload(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.PARAM_DOWNLOAD,
    }

    const xml = buildRequest(fields)
    const response = await this.send(reader, xml, PARAM_DOWNLOAD_TIMEOUT_MS)
    return this.handleResponse(readerId, response)
  }

  // ─── Batch Operations ────────────────────────────────────────────────────

  /**
   * Get batch summary (transaction count and totals for current batch)
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response with batch item count and totals
   * @throws DatacapError if summary retrieval fails
   */
  async batchSummary(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.BATCH_SUMMARY,
    }

    const xml = buildAdminRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  /**
   * Close the current batch and settle transactions
   *
   * Typically run at end-of-day (EOD). Settles all transactions with the processor.
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response with batch close confirmation
   * @throws DatacapError if batch close fails
   */
  async batchClose(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.BATCH_CLOSE,
    }

    const xml = buildAdminRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  // ─── Store-and-Forward (SAF) ─────────────────────────────────────────────

  /**
   * Query the reader's SAF queue statistics
   * Returns count and total amount of transactions stored offline on the reader
   * Datacap certification test 18.2
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response with safCount and safAmount
   */
  async safStatistics(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.SAF_STATISTICS,
    }

    const xml = buildAdminRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  /**
   * Forward all offline-stored SAF transactions to the processor
   * Called when connectivity is restored or manually by admin
   * Datacap certification test 18.3
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response with safForwarded count
   */
  async safForwardAll(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.SAF_FORWARD_ALL,
    }

    const xml = buildAdminRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  // ─── Device Prompts ──────────────────────────────────────────────────────

  /**
   * Display suggestive tip prompt on payment terminal
   *
   * @param readerId - Payment reader ID
   * @param suggestions - Optional tip percentages (default: [15, 18, 20, 25])
   * @returns Datacap response with selected tip amount
   * @throws DatacapError if prompt fails
   */
  async getSuggestiveTip(readerId: string, suggestions?: number[]): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.SUGGESTIVE_TIP,
      gratuitySuggestions: (suggestions || [15, 18, 20, 25]).join(','),
    }

    const xml = buildRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  /**
   * Capture signature on payment terminal
   *
   * @param readerId - Payment reader ID
   * @returns Datacap response with base64-encoded signature data
   * @throws DatacapError if signature capture fails
   */
  async getSignature(readerId: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.SIGNATURE,
    }

    const xml = buildRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  /**
   * Display yes/no prompt on payment terminal
   *
   * @param readerId - Payment reader ID
   * @param promptText - Question to display
   * @returns Datacap response with user selection
   * @throws DatacapError if prompt fails
   */
  async getYesNo(readerId: string, promptText: string): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.YES_NO,
      promptText,
    }

    const xml = buildRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }

  /**
   * Display multiple choice prompt on payment terminal
   *
   * @param readerId - Payment reader ID
   * @param promptText - Question to display
   * @param buttonLabels - Array of button labels (max 4)
   * @returns Datacap response with selected button index
   * @throws DatacapError if prompt fails
   */
  async getMultipleChoice(readerId: string, promptText: string, buttonLabels: string[]): Promise<DatacapResponse> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)
    const base = this.buildBaseFields(reader, seqNo)

    const fields: DatacapRequestFields = {
      ...base,
      merchantId: base.merchantId!,
      operatorId: base.operatorId!,
      tranCode: TRAN_CODES.MULTIPLE_CHOICE,
      promptText,
      buttonLabels,
    }

    const xml = buildRequest(fields)
    const response = await this.send(reader, xml)
    return this.handleResponse(readerId, response)
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDatacapClient(config: DatacapConfig): DatacapClient {
  return new DatacapClient(config)
}
