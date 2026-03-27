/**
 * Comp/Void Domain Module
 *
 * Business logic for comp, void, and restore operations on order items.
 *
 * Three buckets:
 * - Pure calculations: calculateItemTotal, calculateSubtotalSplit, buildOrderTotals, etc.
 * - Validation (pure + orchestration): validateOrderForCompVoid, validateItemForCompVoid, etc.
 * - Operations (TxClient param): applyCompVoid, applyRestore
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  TxClient,
  CompVoidInput,
  RestoreInput,
  RecalcTotalsInput,
  OrderTotals,
  ParentTotals,
  CardPaymentInfo,
  CompVoidTxResult,
  RestoreTxResult,
  ValidationError,
  ItemForValidation,
  OrderForValidation,
  ApprovalSettings,
  SecuritySettings,
} from './types'

// ─── Pure Calculations ──────────────────────────────────────────────────────

export {
  calculateItemTotal,
  calculateSubtotalSplit,
  buildOrderTotals,
  calculateCommissionTotal,
  exceedsThreshold,
  isEmployeeMealReason,
} from './calculations'

// ─── Validation ─────────────────────────────────────────────────────────────

export {
  validateOrderForCompVoid,
  validateVersion,
  validateItemForCompVoid,
  validateSentItemVoid,
  validateItemForRestore,
  validateVoidApproval,
  validateVoid2FA,
  validateSplitParent,
  validateRemoteApproval,
  validateReasonPreset,
} from './validation'

// ─── Operations ─────────────────────────────────────────────────────────────

export {
  applyCompVoid,
  applyRestore,
} from './comp-void-operations'
