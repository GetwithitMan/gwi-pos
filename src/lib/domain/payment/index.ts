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

export { normalizePaymentInput, normalizePaymentRequest } from './normalize'
export type { PaymentRequestContext } from './normalize'

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

// ─── Guards (Idempotency & Concurrency) ────────────────────────────────────

export {
  checkOrphanedDatacapSales,
  checkIdempotencyByKeyGuard,
  checkIdempotencyByRecordNoGuard,
  checkAmountTimeDedup,
  checkSafDuplicate,
  checkAlreadyPaid,
} from './guards/check-idempotency'

export type {
  ExistingPayment,
  PaymentInputForDedup,
  GuardResult,
} from './guards/check-idempotency'

export { acquirePendingCaptureLock } from './guards/check-pending-capture'
export type { PendingCaptureResult } from './guards/check-pending-capture'

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
