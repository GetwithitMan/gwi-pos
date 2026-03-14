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
