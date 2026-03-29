// Datacap Direct API — XML Response Parser
// Parses RStream XML responses from Datacap devices and cloud

import type { DatacapResponse, CmdStatus, ResponseOrigin, EntryMethod, CVM, DatacapError, DeclineDetail } from './types'
import { CARD_TYPE_MAP, ENTRY_METHOD_MAP, CVM_MAP, DATACAP_ERROR_CODES } from './constants'

// ─── Tag Extraction ──────────────────────────────────────────────────────────

/**
 * Regex pattern cache for tag extraction
 * Prevents creating new regex objects for every tag extraction call
 */
const regexCache = new Map<string, RegExp>()

/**
 * Get or create a cached regex pattern for tag extraction
 */
function getTagRegex(tagName: string): RegExp {
  let regex = regexCache.get(tagName)
  if (!regex) {
    regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i')
    regexCache.set(tagName, regex)
  }
  return regex
}

/**
 * Extract value from XML tag
 * Uses cached regex patterns for better performance
 */
export function extractTag(xml: string, tagName: string): string | undefined {
  // Match <TagName>value</TagName> — handles whitespace and multiline
  const regex = getTagRegex(tagName)
  const match = xml.match(regex)
  if (match && match[1] !== undefined) {
    return match[1].trim()
  }
  return undefined
}

// ─── Card Last 4 Extraction ─────────────────────────────────────────────────

export function extractCardLast4(acctNo: string | undefined): string | undefined {
  if (!acctNo) return undefined
  // Formats: ***4111, ****4111, XXXX-XXXX-XXXX-4111, ************4111
  const match = acctNo.match(/(\d{4})\s*$/)
  return match ? match[1] : undefined
}

// ─── Print Data Extraction ───────────────────────────────────────────────────

/**
 * Extract print data (Line1-Line36) with optimized single-pass regex
 * Much faster than calling extractTag() 36 times
 */
export function extractPrintData(xml: string): Record<string, string> | undefined {
  const printData: Record<string, string> = {}

  // Datacap spec: up to 36 receipt lines, each up to ~200 chars — cap defensively
  const MAX_LINES = 36
  const MAX_CHARS_PER_LINE = 500

  // Single regex to capture all Line tags at once (Line1 through Line36)
  const lineRegex = /<(Line\d+)>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  let lineCount = 0

  while ((match = lineRegex.exec(xml)) !== null) {
    if (lineCount >= MAX_LINES) break
    const tagName = match[1] // e.g., "Line1"
    const value = match[2]?.trim().slice(0, MAX_CHARS_PER_LINE)
    if (value) {
      printData[tagName] = value
      lineCount++
    }
  }

  return Object.keys(printData).length > 0 ? printData : undefined
}

// ─── Card Type Mapping ───────────────────────────────────────────────────────

export function mapCardType(datacapCardType: string | undefined): string | undefined {
  if (!datacapCardType) return undefined
  return CARD_TYPE_MAP[datacapCardType.toUpperCase()] || datacapCardType.toLowerCase()
}

// ─── Entry Method Mapping ────────────────────────────────────────────────────

export function mapEntryMethod(datacapEntryMethod: string | undefined): EntryMethod | undefined {
  if (!datacapEntryMethod) return undefined
  const mapped = ENTRY_METHOD_MAP[datacapEntryMethod.toUpperCase()]
  return (mapped as EntryMethod) || undefined
}

// ─── CVM Mapping ─────────────────────────────────────────────────────────────

export function mapCVM(datacapCVM: string | undefined): CVM | undefined {
  if (!datacapCVM) return undefined
  const mapped = CVM_MAP[datacapCVM.toUpperCase()]
  return (mapped as CVM) || undefined
}

// ─── Main Response Parser ────────────────────────────────────────────────────

export function parseResponse(xml: string): DatacapResponse {
  const cmdStatus = (extractTag(xml, 'CmdStatus') || 'Error') as CmdStatus
  const dsixReturnCode = extractTag(xml, 'DSIXReturnCode') || ''
  const responseOrigin = (extractTag(xml, 'ResponseOrigin') || 'Client') as ResponseOrigin
  const textResponse = extractTag(xml, 'TextResponse') || ''

  // Transaction identifiers
  const sequenceNo = extractTag(xml, 'SequenceNo')
  const tranCode = extractTag(xml, 'TranCode')

  // Authorization
  const authorize = extractTag(xml, 'Authorize')
  const authCode = extractTag(xml, 'AuthCode')
  const refNo = extractTag(xml, 'RefNo')
  const acqRefData = extractTag(xml, 'AcqRefData')
  const processData = extractTag(xml, 'ProcessData')
  const recordNo = extractTag(xml, 'RecordNo')

  // Card info
  const acctNo = extractTag(xml, 'AcctNo')
  const cardLast4 = extractCardLast4(acctNo)
  const rawCardType = extractTag(xml, 'CardType')
  const cardType = mapCardType(rawCardType)
  const cardholderName = extractTag(xml, 'CardholderName') || extractTag(xml, 'CustomerName')
  const cardholderIdHash = extractTag(xml, 'CardholderID')

  // Entry method & EMV data
  const rawEntryMethod = extractTag(xml, 'EntryMethod')
  const entryMethod = mapEntryMethod(rawEntryMethod)
  const aid = extractTag(xml, 'AID')
  const rawCVM = extractTag(xml, 'CVM')
  const cvm = mapCVM(rawCVM)

  // Partial approval detection
  const partialAuthApprovalCode = extractTag(xml, 'PartialAuthApprovalCode')
  const isPartialApproval = partialAuthApprovalCode === 'Y' ||
    partialAuthApprovalCode === 'P' ||
    dsixReturnCode === '000001'

  // Print data (receipt lines)
  const printData = extractPrintData(xml)

  // Gratuity
  const gratuityAmount = extractTag(xml, 'Gratuity') || extractTag(xml, 'GratuityAmount')

  // Batch info
  const batchNo = extractTag(xml, 'BatchNo')
  const batchItemCount = extractTag(xml, 'BatchItemCount')

  // Signature
  const signatureData = extractTag(xml, 'SignatureData')

  // SAF fields
  const safCount = extractTag(xml, 'SAFCount')
  const safAmount = extractTag(xml, 'SAFAmount')
  const safForwarded = extractTag(xml, 'SAFForwarded')
  // Stored offline detection: reader stores transaction when processor unreachable
  // Use explicit tag first; textResponse match is a fallback using exact phrase to avoid false positives
  const storedOffline = extractTag(xml, 'StoredOffline') === 'Yes' ||
    textResponse.toUpperCase().includes('STORED OFFLINE')

  // Level II response
  const level2Status = extractTag(xml, 'Level2Status')

  // AVS (Address Verification Service) result — single char code from processor
  const avsResult = extractTag(xml, 'AVSResult') || extractTag(xml, 'AVS')

  return {
    cmdStatus,
    dsixReturnCode,
    responseOrigin,
    textResponse,
    sequenceNo,
    tranCode,
    authorize,
    authCode,
    refNo,
    acqRefData,
    processData,
    recordNo,
    acctNo,
    cardLast4,
    cardType,
    cardholderName,
    cardholderIdHash,
    entryMethod,
    aid,
    cvm,
    isPartialApproval,
    partialAuthApprovalCode,
    printData,
    gratuityAmount,
    batchNo,
    batchItemCount,
    signatureData,
    safCount,
    safAmount,
    safForwarded,
    storedOffline,
    level2Status,
    avsResult,
    // rawXml is only included in non-production to avoid accumulating sensitive data in logs
    rawXml: process.env.NODE_ENV === 'production' ? '' : xml,
  }
}

// ─── Error Parser ────────────────────────────────────────────────────────────

export function parseError(response: DatacapResponse): DatacapError | null {
  if (response.cmdStatus === 'Approved' || response.cmdStatus === 'Success') {
    return null
  }

  const errorInfo = DATACAP_ERROR_CODES[response.dsixReturnCode]

  if (errorInfo) {
    return {
      code: response.dsixReturnCode,
      text: errorInfo.message,
      description: errorInfo.description,
      isRetryable: errorInfo.isRetryable,
      responseOrigin: response.responseOrigin,
    }
  }

  // Unknown error code — fall back to text response
  return {
    code: response.dsixReturnCode || 'UNKNOWN',
    text: response.textResponse || 'Unknown Error',
    description: `${response.responseOrigin}: ${response.textResponse || 'No additional information'}`,
    isRetryable: false,
    responseOrigin: response.responseOrigin,
  }
}

// ─── Customer-facing message mapping ────────────────────────────────────────

/** Map return code prefixes to customer-safe messages */
const CUSTOMER_MESSAGES: Record<string, string> = {
  '100001': 'Card declined. Please try another payment method.',
  '100002': 'Card declined. Please try another payment method.',
  '100003': 'Card declined. Please try another payment method.',
  '100004': 'Card is expired. Please use a different card.',
  '100005': 'Card could not be read. Please try again or use a different card.',
  '100006': 'This card type is not accepted. Please try another card.',
  '100007': 'Card declined. Please try another payment method.',
  '100008': 'Card was removed too soon. Please try again.',
  '100009': 'This transaction was already processed.',
  '200001': 'Reader is not ready. Please wait a moment.',
  '200002': 'Reader is busy. Please wait a moment.',
  '200003': 'Reader error. Please try again.',
  '200004': 'Reader not found. Please alert staff.',
  '200005': 'Card could not be read. Please try again.',
  '200006': 'Transaction timed out. Please try again.',
  '200007': 'Transaction was cancelled.',
  '300001': 'Unable to process payment. Please try again.',
  '300002': 'Unable to process payment. Please try again in a moment.',
  '300003': 'Connection timed out. Please try again.',
}

const DEFAULT_CUSTOMER_MESSAGE = 'Card declined. Please try another payment method.'
const PARTIAL_CUSTOMER_MESSAGE = 'Card has insufficient funds for the full amount.'

// ─── Decline Detail Builder ─────────────────────────────────────────────────

/**
 * Build a structured DeclineDetail from a Datacap response.
 *
 * This provides both staff-facing and customer-facing messages,
 * plus retry guidance and partial approval info.
 *
 * @param response Parsed DatacapResponse from parseResponse()
 * @param requestedAmount The original requested amount (for partial approval context)
 * @returns DeclineDetail or null if the transaction was fully approved
 */
export function buildDeclineDetail(
  response: DatacapResponse,
  requestedAmount?: number
): DeclineDetail | null {
  // Fully approved — no decline detail needed
  if (
    (response.cmdStatus === 'Approved' || response.cmdStatus === 'Success') &&
    !response.isPartialApproval
  ) {
    return null
  }

  const returnCode = response.dsixReturnCode || 'UNKNOWN'
  const errorInfo = DATACAP_ERROR_CODES[returnCode]
  const isRetryable = errorInfo?.isRetryable ?? false

  // Parse authorized amount for partial approvals
  const approvedAmount = response.authorize
    ? parseFloat(response.authorize)
    : undefined

  // Build staff message — include full detail and return code
  let staffMessage: string
  if (response.isPartialApproval && approvedAmount !== undefined) {
    staffMessage = `Partial Approval: $${approvedAmount.toFixed(2)} of $${(requestedAmount ?? 0).toFixed(2)} approved`
  } else if (errorInfo) {
    staffMessage = `Declined: ${errorInfo.message} (${returnCode})`
  } else if (response.textResponse) {
    staffMessage = `Declined: ${response.textResponse} (${returnCode})`
  } else {
    staffMessage = `Declined (${returnCode})`
  }

  // Build customer message — safe, no codes, no internal detail
  let customerMessage: string
  if (response.isPartialApproval) {
    customerMessage = PARTIAL_CUSTOMER_MESSAGE
  } else {
    customerMessage = CUSTOMER_MESSAGES[returnCode] || DEFAULT_CUSTOMER_MESSAGE
  }

  return {
    returnCode,
    staffMessage,
    customerMessage,
    isRetryable,
    isPartialApproval: response.isPartialApproval,
    approvedAmount: response.isPartialApproval ? approvedAmount : undefined,
    requestedAmount: response.isPartialApproval ? requestedAmount : undefined,
    responseOrigin: response.responseOrigin,
  }
}
