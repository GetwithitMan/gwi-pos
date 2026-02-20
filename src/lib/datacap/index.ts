/**
 * Datacap Direct API - Main Exports
 *
 * This barrel file provides clean imports for the Datacap payment system.
 *
 * Usage:
 * ```typescript
 * import { DatacapClient, processSale, openBarTab } from '@/lib/datacap'
 * ```
 */

// ─── Client (Transport Layer) ────────────────────────────────────────────────
export { DatacapClient } from './client'

// ─── Use Cases (Business Logic Layer) ────────────────────────────────────────
export {
  processSale,
  openBarTab,
  closeBarTab,
  voidPayment,
} from './use-cases'

export type {
  ProcessSaleParams,
  OpenBarTabParams,
  CloseBarTabParams,
  VoidPaymentParams,
  SaleResult,
} from './use-cases'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  DatacapConfig,
  DatacapResponse,
  DatacapResult,
  DatacapError,
  DatacapRequestFields,
  DatacapAmountFields,
  DatacapGratuityFields,
  TranCode,
  CmdStatus,
  ResponseOrigin,
  EntryMethod,
  CVM,
  GratuityMode,
  DeviceType,
  CommunicationMode,
  SaleParams,
  PreAuthParams,
  CaptureParams,
  IncrementParams,
  AdjustParams,
  VoidParams,
  ReturnParams,
  DevicePromptParams,
  CollectCardParams,
  DiscoveredDevice,
} from './types'

// ─── Validation & Helpers ─────────────────────────────────────────────────────
export { validateDatacapConfig } from './types'
export {
  validateRequiredFields,
  validateAmounts,
} from './xml-builder'

export {
  parseResponse,
  parseError,
  extractTag,
  extractCardLast4,
  extractPrintData,
  mapCardType,
  mapEntryMethod,
  mapCVM,
} from './xml-parser'

export {
  buildRequest,
  buildAdminRequest,
  buildAmountBlock,
  buildGratuityBlock,
  escapeXml,
  formatAmount,
} from './xml-builder'

// ─── Constants ────────────────────────────────────────────────────────────────
export {
  TRAN_CODES,
  CARD_TYPE_MAP,
  ENTRY_METHOD_MAP,
  CVM_MAP,
  DATACAP_ERROR_CODES,
  POS_PACKAGE_ID,
  LOCAL_ENDPOINT,
  CLOUD_URLS,
  DEFAULT_LOCAL_TIMEOUT_MS,
  DEFAULT_CLOUD_TIMEOUT_MS,
  PAD_RESET_TIMEOUT_MS,
  PARAM_DOWNLOAD_TIMEOUT_MS,
} from './constants'

// ─── Reader Health ───────────────────────────────────────────────────────────
export { getReaderHealth, clearReaderHealth } from './reader-health'
export type { ReaderHealth, ReaderHealthStatus } from './reader-health'

// ─── Helpers ──────────────────────────────────────────────────────────────────
export {
  getDatacapClient,
  requireDatacapClient,
  validateReader,
  parseBody,
  datacapErrorResponse,
} from './helpers'
