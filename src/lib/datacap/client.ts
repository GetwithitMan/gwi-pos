// Datacap Direct API — Client
// Handles all communication with Datacap devices (local HTTP) and cloud (HTTPS + Basic Auth)
// Every monetary transaction auto-calls EMVPadReset after completion

import { db } from '@/lib/db'
import type {
  DatacapConfig,
  DatacapRequestFields,
  DatacapResponse,
  SaleParams,
  PreAuthParams,
  CaptureParams,
  IncrementParams,
  AdjustParams,
  VoidParams,
  ReturnParams,
  DevicePromptParams,
  CollectCardParams,
  TranCode,
} from './types'
import { buildRequest, buildAdminRequest } from './xml-builder'
import { parseResponse } from './xml-parser'
import { getSequenceNo, updateSequenceNo } from './sequence'
import { simulateResponse } from './simulator'
import {
  LOCAL_ENDPOINT,
  POS_PACKAGE_ID,
  DEFAULT_LOCAL_TIMEOUT_MS,
  DEFAULT_CLOUD_TIMEOUT_MS,
  PAD_RESET_TIMEOUT_MS,
  PARAM_DOWNLOAD_TIMEOUT_MS,
  TRAN_CODES,
} from './constants'

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
    this.config = config
  }

  // ─── Transport Layer ─────────────────────────────────────────────────────

  private async sendLocal(reader: ReaderInfo, xml: string, timeoutMs?: number): Promise<DatacapResponse> {
    const timeout = timeoutMs || this.config.localTimeoutMs || DEFAULT_LOCAL_TIMEOUT_MS
    const url = `http://${reader.ipAddress}:${reader.port}${LOCAL_ENDPOINT}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xml,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`Local reader responded with HTTP ${res.status}`)
      }

      const responseXml = await res.text()
      return parseResponse(responseXml)
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Local reader timeout after ${timeout}ms`)
      }
      throw error
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
        throw new Error(`Cloud server responded with HTTP ${res.status}`)
      }

      const responseXml = await res.text()
      return parseResponse(responseXml)
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Cloud server timeout after ${timeout}ms`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async send(reader: ReaderInfo, xml: string, timeoutMs?: number): Promise<DatacapResponse> {
    const mode = reader.communicationMode || this.config.communicationMode

    // Simulated mode — no network calls
    if (mode === 'simulated') {
      // Extract tranCode from XML for simulator
      const tranCodeMatch = xml.match(/<TranCode>([^<]+)<\/TranCode>/)
      const tranCode = (tranCodeMatch?.[1] || 'EMVPadReset') as TranCode
      const simXml = simulateResponse(tranCode, { merchantId: '', operatorId: '', tranCode })
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
      console.warn('[Datacap] Local failed, trying cloud fallback:', localError)
      return this.sendCloud(xml, timeoutMs)
    }
  }

  // ─── Pad Reset Wrapper ───────────────────────────────────────────────────
  // CRITICAL: Every monetary transaction MUST be followed by EMVPadReset

  private async withPadReset<T>(
    readerId: string,
    fn: (reader: ReaderInfo, seqNo: string) => Promise<T>
  ): Promise<T> {
    const reader = await getReaderInfo(readerId)
    const seqNo = await getSequenceNo(readerId)

    let result: T
    try {
      result = await fn(reader, seqNo)
    } finally {
      // Always pad reset, even if the transaction failed
      try {
        await this.padReset(readerId)
      } catch (resetError) {
        console.error('[Datacap] Pad reset failed after transaction:', resetError)
      }
    }

    return result
  }

  // ─── Field Builder ───────────────────────────────────────────────────────

  private buildBaseFields(reader: ReaderInfo, seqNo: string): Partial<DatacapRequestFields> {
    return {
      merchantId: reader.merchantId || this.config.merchantId,
      operatorId: this.config.operatorId,
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
      }

      const xml = buildRequest(fields)
      const response = await this.send(reader, xml)
      return this.handleResponse(readerId, response)
    })
  }

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

  // ─── Device Control ──────────────────────────────────────────────────────

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
    const response = await this.send(reader, xml, PAD_RESET_TIMEOUT_MS)
    return this.handleResponse(readerId, response)
  }

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

  // ─── Device Prompts ──────────────────────────────────────────────────────

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
