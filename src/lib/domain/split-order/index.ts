/**
 * Split Order Domain Module
 *
 * Business logic for splitting orders into multiple checks.
 * Supports even, by-item, by-seat, by-table, and custom-amount splits.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type {
  TxClient,
  SplitType,
  SplitRequest,
  SplitSourceOrder,
  SplitOrderItem,
  SplitOrderItemModifier,
  SplitOrderDiscount,
  SplitItemDiscount,
  SplitPayment,
  SplitChildSummary,
  EvenSplitChild,
  EvenSplitResult,
  ItemSplitResult,
  SeatSplitChildSummary,
  SeatSplitResult,
  TableSplitChildSummary,
  TableSplitResult,
  CustomSplitResult,
  GetSplitsResult,
} from './types'

// ─── Even Split ──────────────────────────────────────────────────────────────

export { createEvenSplit } from './even-split'

// ─── Item Split ──────────────────────────────────────────────────────────────

export { createItemSplit } from './item-split'

// ─── Seat Split ──────────────────────────────────────────────────────────────

export { createSeatSplit } from './seat-split'

// ─── Table Split ─────────────────────────────────────────────────────────────

export { createTableSplit } from './table-split'

// ─── Custom Amount Split ─────────────────────────────────────────────────────

export { calculateCustomSplit } from './custom-split'

// ─── Queries ─────────────────────────────────────────────────────────────────

export { getSplitOrders } from './split-queries'

// ─── Discount Distribution (pure policy) ─────────────────────────────────────

export {
  allocateDiscountEvenly,
  allocateDiscountProportionally,
} from './discount-distribution'
