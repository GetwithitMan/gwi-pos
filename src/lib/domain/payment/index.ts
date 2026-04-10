/**
 * Payment Domain Module
 *
 * Business logic for payment processing.
 * All payment methods, validation, and order finalization are defined here.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  TxClient,
  PaymentInput,
  PaymentRecord,
  DrawerAttribution,
  AutoGratuityResult,
  OrderStatusResult,
  OrderUpdateData,
  ReceiptPayment,
  ReceiptData,
} from './types'

// ─── Validation ─────────────────────────────────────────────────────────────

export {
  PaymentInputSchema,
  PaymentRequestSchema,
  checkIdempotencyByKey,
  checkIdempotencyByRecordNo,
  validateTipBounds,
  validatePaymentAmounts,
} from './validation'

export type { IdempotencyCheckResult } from './validation'

// ─── Normalization ──────────────────────────────────────────────────────────

export { normalizePaymentInput } from './normalize'

// ─── Drawer Resolution ─────────────────────────────────────────────────────

export { resolveDrawerForPayment } from './drawer-resolution'

// ─── Auto-Gratuity ──────────────────────────────────────────────────────────

export { calculateAutoGratuity } from './auto-gratuity'

// ─── Payment Methods ────────────────────────────────────────────────────────

export {
  processCashPayment,
  processCardPayment,
  processGiftCardPayment,
  processHouseAccountPayment,
  processLoyaltyPayment,
  processRoomChargePayment,
} from './payment-methods'

export type { PreChargeResult } from './payment-methods'

// ─── Order Finalization ─────────────────────────────────────────────────────

export {
  determineOrderStatus,
  buildOrderUpdate,
  calculatePaidTolerance,
} from './order-finalization'

// ─── Receipt Builder ────────────────────────────────────────────────────────

export { buildReceiptData } from './receipt-builder'

// ─── Payment State Machine ──────────────────────────────────────────────────

export {
  PAYMENT_STATES,
  canTransition,
  transitionPaymentState,
  TERMINAL_PAYMENT_STATES,
  ACTIVE_PAYMENT_STATES,
  isPaymentActive,
  isPaymentTerminal,
  isPaymentSettled,
  ACTIVE_PAYMENT_FILTER,
  SETTLED_PAYMENT_FILTER,
  TERMINAL_PAYMENT_FILTER,
} from './payment-state-machine'

export type { PaymentState } from './payment-state-machine'

// ─── Financial Context Builder ─────────────────────────────────────────────

export { buildPaymentFinancialContext } from './context/build-payment-financial-context'
export type { PaymentFinancialContext, FinancialContextResult, BuildFinancialContextParams } from './context/build-payment-financial-context'

// ─── Executors ─────────────────────────────────────────────────────────────

export { processPaymentLoop } from './executors'
export type { PaymentLoopResult, PaymentLoopParams } from './executors'

// ─── Commit (Phase 5 — post-loop transaction commit) ───────────────────────

export { commitPaymentTransaction } from './commit/commit-payment-transaction'
export type { CommitPaymentParams, CommitPaymentSuccess, CommitPaymentResult } from './commit/commit-payment-transaction'
