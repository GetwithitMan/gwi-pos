// Datacap Direct API — XML Response Parser
// Parses RStream XML responses from Datacap devices and cloud

import type { DatacapResponse, CmdStatus, ResponseOrigin, EntryMethod, CVM, DatacapError } from './types'
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

  // Single regex to capture all Line tags at once (Line1 through Line36)
  const lineRegex = /<(Line\d+)>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null

  while ((match = lineRegex.exec(xml)) !== null) {
    const tagName = match[1] // e.g., "Line1"
    const value = match[2]?.trim()
    if (value) {
      printData[tagName] = value
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
    rawXml: xml,
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
