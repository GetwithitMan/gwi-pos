import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('datacap')

// Datacap Direct API — TypeScript Interfaces
// XML over HTTP to local devices or HTTPS with Basic Auth to Datacap cloud

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TranCode =
  // EMV card-present transactions
  | 'EMVSale'
  | 'EMVReturn'
  | 'EMVPreAuth'
  | 'EMVPreAuthCompletion'
  | 'EMVForceAuth'
  | 'EMVPadReset'
  | 'EMVParamDownload'
  // Record-based (card NOT present — uses stored token)
  | 'PreAuthCaptureByRecordNo'
  | 'IncrementalAuthByRecordNo'
  | 'AdjustByRecordNo'
  | 'VoidSaleByRecordNo'
  | 'VoidReturnByRecordNo'
  | 'ReturnByRecordNo'
  // Device prompts
  | 'GetSuggestiveTip'
  | 'GetSignature'
  | 'GetYesNo'
  | 'GetMultipleChoice'
  // Admin / batch
  | 'BatchSummary'
  | 'BatchClose'
  // Card data collection (no charge)
  | 'CollectCardData'
  // New for certification
  | 'PartialReversalByRecordNo'
  | 'SaleByRecordNo'
  | 'PreAuthByRecordNo'
  | 'EMVAuthOnly'
  | 'SAF_Statistics'
  | 'SAF_ForwardAll'
  // Card lookup (read-only, no charge)
  | 'CardLookup'

export type CmdStatus = 'Approved' | 'Declined' | 'Error' | 'Success'

export type ResponseOrigin = 'Client' | 'Processor' | 'Device'

export type EntryMethod = 'Chip' | 'Tap' | 'Swipe' | 'Manual' | 'Keyed'

export type CVM = 'PIN_VERIFIED' | 'SIGN' | 'NONE' | 'ONLINE_PIN' | 'DEVICE_CVM'

export type GratuityMode = 'SuggestivePrompt' | 'Prompt' | 'PrintBlankLine'

export type DeviceType = 'PAX' | 'INGENICO'

export type CommunicationMode = 'local' | 'cloud' | 'local_with_cloud_fallback'

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DatacapConfig {
  merchantId: string
  operatorId: string
  posPackageId: string
  communicationMode: CommunicationMode
  // Operation environment — routes transactions to cert or production processors
  operationMode?: 'CERT' | 'PROD'
  // Local connection
  defaultPort?: number
  // Cloud connection
  cloudUrl?: string
  cloudUsername?: string
  cloudPassword?: string
  // Timeouts
  localTimeoutMs?: number      // Default: 60000 (60s for card interaction)
  cloudTimeoutMs?: number      // Default: 30000
  padResetTimeoutMs?: number   // Default: PAD_RESET_TIMEOUT_MS (5000ms) — increase for high-latency venues
}

// ─── Request Fields ──────────────────────────────────────────────────────────

export interface DatacapAmountFields {
  purchase?: number
  gratuity?: number
  tax?: number
  cashBack?: number
}

export interface DatacapGratuityFields {
  mode: GratuityMode
  suggestions?: number[]  // e.g., [15, 18, 20, 25] for percentages
  showTotal?: boolean
}

export interface DatacapRequestFields {
  // Required
  merchantId: string
  operatorId: string
  tranCode: TranCode
  // Operation environment — CERT or PROD (routes to cert or production processor)
  operationMode?: 'CERT' | 'PROD'
  // Transaction identifiers
  invoiceNo?: string
  refNo?: string
  sequenceNo?: string
  // Device
  tranDeviceId?: number    // 0=default
  posPackageId?: string
  // Account — almost always 'SecureDevice' for EMV
  acctNo?: string
  // Amounts
  amounts?: DatacapAmountFields
  // Record-based operations (voids, captures, adjustments)
  recordNo?: string
  recordNumberRequested?: boolean
  frequency?: 'OneTime' | 'Recurring'
  // Partial auth
  partialAuth?: 'Allow' | 'Deny'
  // Gratuity / tip
  gratuity?: DatacapGratuityFields
  gratuitySuggestions?: string  // "15,18,20,25"
  // Device prompts
  promptText?: string
  buttonLabels?: string[]
  // Duplicate override
  duplicate?: 'Override'
  // CardholderID for card recognition
  cardHolderId?: 'Allow_V2'
  // Level II data (B2B transactions — lowers interchange rate)
  customerCode?: string   // PO number or customer code (max 17 chars per Datacap spec)
  // Collect card data (no charge)
  collectData?: boolean
  // Force transaction offline (SAF storage on reader — certification test 18.x)
  forceOffline?: boolean
  // Keyed/manual entry fields (card not present — no physical reader)
  expDate?: string         // MMYY format
  cvv?: string             // 3-4 digit CVV/CVC
  avsZipCode?: string      // Billing ZIP code for AVS check
}

// ─── Response ────────────────────────────────────────────────────────────────

export interface DatacapResponse {
  // Status
  cmdStatus: CmdStatus
  dsixReturnCode: string
  responseOrigin: ResponseOrigin
  textResponse: string
  // Transaction identifiers
  sequenceNo?: string
  tranCode?: string
  // Authorization
  authorize?: string        // Amount authorized (string from XML)
  authCode?: string
  refNo?: string
  acqRefData?: string       // Acquirer reference data (settlement routing)
  processData?: string      // Processor-specific routing data
  recordNo?: string         // Token for future operations (voids, captures, adjustments)
  // Card info
  acctNo?: string           // Masked card number (e.g., "***4111")
  cardLast4?: string        // Extracted last 4 digits
  cardType?: string         // Mapped: 'visa', 'mastercard', 'amex', 'discover'
  cardholderName?: string   // From chip data
  cardholderIdHash?: string // CardholderID for recognition
  entryMethod?: EntryMethod
  // EMV data
  aid?: string              // Application Identifier
  cvm?: CVM
  // Partial approval
  isPartialApproval: boolean
  partialAuthApprovalCode?: string
  // Print data
  printData?: Record<string, string>  // Line1 through Line36
  // Gratuity response
  gratuityAmount?: string
  // Batch info
  batchNo?: string
  batchItemCount?: string
  // Signature
  signatureData?: string
  // SAF (Store-and-Forward) fields
  safCount?: string       // Number of transactions queued offline on reader
  safAmount?: string      // Total amount of queued SAF transactions
  safForwarded?: string   // Number forwarded in SAF_ForwardAll response
  storedOffline?: boolean // True when transaction was stored offline (not processed online)
  level2Status?: string   // 'Accepted', 'Rejected', or undefined if not Level II
  // AVS (Address Verification Service) result
  avsResult?: string      // Single char: Y (full match), N (no match), Z (zip only), A (address only), etc.
  // Raw XML for debugging
  rawXml: string
}

// ─── Error ───────────────────────────────────────────────────────────────────

export interface DatacapError {
  code: string
  text: string
  description: string
  isRetryable: boolean
  responseOrigin?: ResponseOrigin
}

// ─── Decline Detail (structured decline/error info for UI) ──────────────────

export interface DeclineDetail {
  /** Raw DSIX 6-digit return code from Datacap (e.g., '100002') */
  returnCode: string
  /** Full detail for staff display: e.g., "Declined: Insufficient Funds (100002)" */
  staffMessage: string
  /** Safe for customer-facing display: e.g., "Card declined. Please try another card." */
  customerMessage: string
  /** Whether the same card can be retried (device errors = yes, hard declines = no) */
  isRetryable: boolean
  /** True when the card was partially approved for less than the requested amount */
  isPartialApproval: boolean
  /** The amount approved (for partial approvals) */
  approvedAmount?: number
  /** The amount originally requested (for partial approvals) */
  requestedAmount?: number
  /** Origin of the response: Client, Processor, or Device */
  responseOrigin?: ResponseOrigin
}

// ─── Transaction Parameters ──────────────────────────────────────────────────

export interface SaleParams {
  invoiceNo: string
  amounts: DatacapAmountFields
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
  requestRecordNo?: boolean
  allowPartialAuth?: boolean
  forceOffline?: boolean  // Force SAF storage (for certification test 18.x)
  // Level II — reduces interchange for B2B cards
  customerCode?: string   // PO number or customer reference (max 17 chars)
  // Note: taxAmount goes in amounts.tax
}

export interface PreAuthParams {
  invoiceNo: string
  amount: number
  requestRecordNo?: boolean
  forceOffline?: boolean
}

export interface CaptureParams {
  recordNo: string
  purchaseAmount: number
  gratuityAmount?: number
}

export interface IncrementParams {
  recordNo: string
  additionalAmount: number
}

export interface AdjustParams {
  recordNo: string
  purchaseAmount: number
  gratuityAmount: number
}

export interface VoidParams {
  recordNo: string
}

export interface ReturnParams {
  amount: number
  recordNo?: string           // If card not present, use stored token
  cardPresent?: boolean       // Default: true (EMVReturn) vs false (ReturnByRecordNo)
  invoiceNo?: string
}

export interface DevicePromptParams {
  promptType: 'tip' | 'yesno' | 'signature' | 'choice'
  promptText?: string
  suggestions?: number[]      // Tip percentages
  buttonLabels?: string[]     // For multiple choice
}

export interface CollectCardParams {
  placeholderAmount?: number  // Small amount for card read (default $0.01)
}

export interface PartialReversalParams {
  recordNo: string
  reversalAmount: number   // Amount to reduce the hold by
}

export interface SaleByRecordParams {
  recordNo: string
  invoiceNo: string
  amount: number
  gratuityAmount?: number
}

export interface PreAuthByRecordParams {
  recordNo: string
  invoiceNo: string
  amount: number
}

export interface AuthOnlyParams {
  invoiceNo: string
  // Zero-dollar auth — validates card without a charge
}

export interface CardLookupResult {
  success: boolean
  cardUsage: string       // 'DEBIT' | 'FSA' | 'OTHER' | ''
  extendedCardInfo: string  // comma-separated: 'Debit', 'Credit', 'CheckCard', etc.
  cardType: string        // 'VISA' | 'M/C' | 'AMEX' | etc.
  isDebit: boolean        // derived: true if cardUsage === 'DEBIT' or extendedCardInfo includes 'Debit'
  error?: string
}

export interface KeyedSaleParams {
  invoiceNo: string
  amounts: DatacapAmountFields
  cardNumber: string       // Full PAN — only last 4 stored after tokenization
  expiryMonth: string      // MM
  expiryYear: string       // YY
  cvv: string              // 3-4 digits
  zipCode?: string         // Billing ZIP for AVS
  requestRecordNo?: boolean
  allowPartialAuth?: boolean
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface DiscoveredDevice {
  serialNumber: string
  ipAddress: string
  port: number
  deviceType?: DeviceType
}

// ─── Result Type Pattern ─────────────────────────────────────────────────────

/**
 * Result pattern for Datacap operations
 *
 * This ensures safe error handling by making errors explicit in the return type.
 * Callers must check the success field before accessing the response.
 *
 * Usage:
 * ```typescript
 * const result = await datacapClient.sale(params)
 * if (result.success) {
 *   log.info('Approved:', result.response.authCode)
 * } else {
 *   log.error('Error:', result.error.text)
 *   if (result.error.isRetryable) {
 *     // retry logic
 *   }
 * }
 * ```
 */
export type DatacapResult<T = DatacapResponse> =
  | { success: true; response: T; error: null }
  | { success: false; response: null; error: DatacapError }

// ─── Configuration Validation ────────────────────────────────────────────────

/**
 * Validate DatacapConfig based on communication mode
 *
 * Ensures required fields are present for the selected mode:
 * - 'local' / 'local_with_cloud_fallback': requires defaultPort
 * - 'cloud' / 'local_with_cloud_fallback': requires cloudUrl, cloudUsername, cloudPassword
 *
 * @throws Error if validation fails with descriptive message
 */
export function validateDatacapConfig(config: DatacapConfig): void {
  const { communicationMode } = config

  // Validate mode is one of the allowed values
  const validModes: CommunicationMode[] = ['local', 'cloud', 'local_with_cloud_fallback']
  if (!validModes.includes(communicationMode)) {
    throw new Error(
      `Invalid communication mode: ${communicationMode}. Must be one of: ${validModes.join(', ')}`
    )
  }

  // Local mode requirements
  if (communicationMode === 'local' || communicationMode === 'local_with_cloud_fallback') {
    if (!config.defaultPort) {
      throw new Error(
        `Communication mode "${communicationMode}" requires defaultPort to be configured`
      )
    }
  }

  // Cloud mode requirements
  if (communicationMode === 'cloud' || communicationMode === 'local_with_cloud_fallback') {
    if (!config.cloudUrl) {
      throw new Error(
        `Communication mode "${communicationMode}" requires cloudUrl to be configured`
      )
    }
    if (!config.cloudUsername || !config.cloudPassword) {
      throw new Error(
        `Communication mode "${communicationMode}" requires cloudUsername and cloudPassword to be configured`
      )
    }
  }
}
