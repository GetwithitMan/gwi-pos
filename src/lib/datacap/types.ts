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
  // Local connection
  defaultPort?: number
  // Cloud connection
  cloudUrl?: string
  cloudUsername?: string
  cloudPassword?: string
  // Timeouts
  localTimeoutMs?: number   // Default: 60000 (60s for card interaction)
  cloudTimeoutMs?: number   // Default: 30000
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
  // Collect card data (no charge)
  collectData?: boolean
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

// ─── Transaction Parameters ──────────────────────────────────────────────────

export interface SaleParams {
  invoiceNo: string
  amounts: DatacapAmountFields
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
  requestRecordNo?: boolean
  allowPartialAuth?: boolean
}

export interface PreAuthParams {
  invoiceNo: string
  amount: number
  requestRecordNo?: boolean
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

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface DiscoveredDevice {
  serialNumber: string
  ipAddress: string
  port: number
  deviceType?: DeviceType
}
