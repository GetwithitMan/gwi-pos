// Datacap Direct API — Constants
// Static values, error codes, and defaults

import type { TranCode } from './types'

// ─── Transaction Codes ───────────────────────────────────────────────────────

export const TRAN_CODES: Record<string, TranCode> = {
  // EMV card-present
  SALE: 'EMVSale',
  RETURN: 'EMVReturn',
  PRE_AUTH: 'EMVPreAuth',
  PRE_AUTH_COMPLETION: 'EMVPreAuthCompletion',
  FORCE_AUTH: 'EMVForceAuth',
  PAD_RESET: 'EMVPadReset',
  PARAM_DOWNLOAD: 'EMVParamDownload',
  // Record-based (card NOT present)
  CAPTURE: 'PreAuthCaptureByRecordNo',
  INCREMENT: 'IncrementalAuthByRecordNo',
  ADJUST: 'AdjustByRecordNo',
  VOID_SALE: 'VoidSaleByRecordNo',
  VOID_RETURN: 'VoidReturnByRecordNo',
  RETURN_BY_RECORD: 'ReturnByRecordNo',
  // Device prompts
  SUGGESTIVE_TIP: 'GetSuggestiveTip',
  SIGNATURE: 'GetSignature',
  YES_NO: 'GetYesNo',
  MULTIPLE_CHOICE: 'GetMultipleChoice',
  // Admin
  BATCH_SUMMARY: 'BatchSummary',
  BATCH_CLOSE: 'BatchClose',
  // Card data
  COLLECT_CARD: 'CollectCardData',
  // Certification additions
  PARTIAL_REVERSAL: 'PartialReversalByRecordNo',
  SALE_BY_RECORD: 'SaleByRecordNo',
  PRE_AUTH_BY_RECORD: 'PreAuthByRecordNo',
  AUTH_ONLY: 'EMVAuthOnly',
  // Store-and-Forward (SAF)
  SAF_STATISTICS: 'SAF_Statistics',
  SAF_FORWARD_ALL: 'SAF_ForwardAll',
} as const

// ─── Monetary TranCodes (require pad reset after) ────────────────────────────

export const MONETARY_TRAN_CODES: Set<TranCode> = new Set([
  'EMVSale',
  'EMVReturn',
  'EMVPreAuth',
  'EMVPreAuthCompletion',
  'EMVForceAuth',
  'PreAuthCaptureByRecordNo',
  'IncrementalAuthByRecordNo',
  'AdjustByRecordNo',
  'VoidSaleByRecordNo',
  'VoidReturnByRecordNo',
  'ReturnByRecordNo',
  'CollectCardData',
  'PartialReversalByRecordNo',
  'SaleByRecordNo',
  'PreAuthByRecordNo',
  'EMVAuthOnly',
])

// ─── Error Codes ─────────────────────────────────────────────────────────────

export interface ErrorCodeInfo {
  message: string
  description: string
  isRetryable: boolean
}

export const DATACAP_ERROR_CODES: Record<string, ErrorCodeInfo> = {
  '000000': { message: 'Success', description: 'Transaction approved', isRetryable: false },
  '000001': { message: 'Partial Approval', description: 'Approved for less than requested amount', isRetryable: false },

  // Declines
  '100001': { message: 'Declined', description: 'Card declined by issuer', isRetryable: false },
  '100002': { message: 'Insufficient Funds', description: 'Not enough balance on card', isRetryable: false },
  '100003': { message: 'Over Limit', description: 'Card has exceeded credit limit', isRetryable: false },
  '100004': { message: 'Expired Card', description: 'Card is expired', isRetryable: false },
  '100005': { message: 'Invalid Card', description: 'Card number is invalid', isRetryable: false },
  '100006': { message: 'Restricted Card', description: 'Card type not accepted', isRetryable: false },
  '100007': { message: 'Do Not Honor', description: 'Issuer declined without specific reason', isRetryable: false },
  '100008': { message: 'Card Removed', description: 'Card was removed before completion', isRetryable: true },
  '100009': { message: 'Duplicate Transaction', description: 'Same card, amount, and time detected', isRetryable: false },

  // Device errors
  '200001': { message: 'Device Not Ready', description: 'Reader is not ready for transactions', isRetryable: true },
  '200002': { message: 'Device Busy', description: 'Reader is processing another transaction', isRetryable: true },
  '200003': { message: 'Device Error', description: 'Hardware error on reader', isRetryable: true },
  '200004': { message: 'No Device', description: 'Reader not found at configured address', isRetryable: true },
  '200005': { message: 'Card Read Error', description: 'Could not read card data', isRetryable: true },
  '200006': { message: 'Timeout', description: 'Transaction timed out waiting for card', isRetryable: true },
  '200007': { message: 'Cancelled', description: 'Transaction cancelled by operator', isRetryable: false },

  // Communication errors
  '300001': { message: 'Communication Error', description: 'Could not reach processor', isRetryable: true },
  '300002': { message: 'Host Unavailable', description: 'Processor host is down', isRetryable: true },
  '300003': { message: 'Connection Timeout', description: 'Connection to processor timed out', isRetryable: true },

  // Config errors
  '400001': { message: 'Invalid Merchant', description: 'Merchant ID not recognized', isRetryable: false },
  '400002': { message: 'Invalid Terminal', description: 'Terminal ID not configured', isRetryable: false },
  '400003': { message: 'Param Download Required', description: 'Device needs EMVParamDownload', isRetryable: false },

  // Batch errors
  '500001': { message: 'Batch Empty', description: 'No transactions in current batch', isRetryable: false },
  '500002': { message: 'Batch Error', description: 'Error closing batch', isRetryable: true },
} as const

// ─── Card Type Mapping ───────────────────────────────────────────────────────

export const CARD_TYPE_MAP: Record<string, string> = {
  'VISA': 'visa',
  'MASTERCARD': 'mastercard',
  'MC': 'mastercard',
  'AMEX': 'amex',
  'AMERICAN EXPRESS': 'amex',
  'DISCOVER': 'discover',
  'DISC': 'discover',
  'DINERS': 'diners',
  'DINERS CLUB': 'diners',
  'JCB': 'jcb',
  'UNIONPAY': 'unionpay',
  'CUP': 'unionpay',
  'DEBIT': 'debit',
  'EBT': 'ebt',
}

// ─── Entry Method Mapping ────────────────────────────────────────────────────

export const ENTRY_METHOD_MAP: Record<string, string> = {
  'CHIP': 'Chip',
  'CONTACTLESS': 'Tap',
  'SWIPED': 'Swipe',
  'KEYED': 'Manual',
  'MANUAL': 'Manual',
  'FALLBACK': 'Swipe',     // Chip fallback to swipe
  'QRCODE': 'Tap',         // QR-based payment
}

// ─── CVM Mapping ─────────────────────────────────────────────────────────────

export const CVM_MAP: Record<string, string> = {
  'PIN': 'PIN_VERIFIED',
  'PIN_VERIFIED': 'PIN_VERIFIED',
  'SIGNATURE': 'SIGN',
  'SIGN': 'SIGN',
  'NO_CVM': 'NONE',
  'NONE': 'NONE',
  'ONLINE_PIN': 'ONLINE_PIN',
  'DEVICE': 'DEVICE_CVM',
}

// ─── Network Constants ───────────────────────────────────────────────────────

export const DEFAULT_PORTS: Record<string, number> = {
  PAX: 8080,
  INGENICO: 80,
}

export const CLOUD_URLS = {
  test: 'https://cloud-test.dcap.com/ProcessEMVTransaction/',
  prod: 'https://cloud-prod.dcap.com/ProcessEMVTransaction/',
} as const

export const LOCAL_ENDPOINT = '/ProcessEMVTransaction/'

export const DISCOVERY_PORT = 9001
export const DISCOVERY_RETRIES = 30
export const DISCOVERY_RETRY_DELAY_MS = 500

// ─── POS Identity ────────────────────────────────────────────────────────────

export const POS_PACKAGE_ID = 'GWI-POS:1.0'

// ─── Default Sequence Number ─────────────────────────────────────────────────

export const DEFAULT_SEQUENCE_NO = '0010010010'

// ─── Timeouts ────────────────────────────────────────────────────────────────

export const DEFAULT_LOCAL_TIMEOUT_MS = 60000   // 60s — customer has to interact with reader
export const DEFAULT_CLOUD_TIMEOUT_MS = 30000   // 30s — cloud should be faster
export const PAD_RESET_TIMEOUT_MS = 5000        // 5s — pad reset is quick
export const PARAM_DOWNLOAD_TIMEOUT_MS = 120000 // 2min — param download is slow
export const PAYAPI_TIMEOUT_MS = 5000           // 5s — REST API calls, no card interaction

// ─── Tip Defaults ────────────────────────────────────────────────────────────

export const DEFAULT_TIP_SUGGESTIONS = [15, 18, 20, 25]
export const DEFAULT_TIP_DOLLAR_SUGGESTIONS = [1, 2, 3]
export const DEFAULT_TIP_DOLLAR_THRESHOLD = 15  // Under $15 → show dollar amounts

// ─── Pre-Auth Defaults ───────────────────────────────────────────────────────

export const DEFAULT_PRE_AUTH_AMOUNT = 1           // $1 hold
export const DEFAULT_INCREMENT_THRESHOLD = 80      // 80% of auth
export const DEFAULT_INCREMENT_AMOUNT = 25         // $25 increment
export const DEFAULT_MAX_TAB_ALERT = 500           // Alert manager at $500
