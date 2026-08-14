/**
 * Split Check Helpers — Unified Split Checks
 *
 * Semantic helpers for split class detection. Use these everywhere
 * instead of checking parentOrderId or itemCount.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type SplitClass = 'structural' | 'allocation'
export type SplitMode = 'by_item' | 'by_seat' | 'by_table' | 'even' | 'custom_amount'
export type SplitResolution = 'superseded' | 'merged_back' | 'merged_into_other'

// ─── Predicates ─────────────────────────────────────────────────────────────

export function isAllocationSplit(order: { splitClass?: string | null }): boolean {
  return order.splitClass === 'allocation'
}

export function isStructuralSplit(order: { splitClass?: string | null }): boolean {
  return order.splitClass === 'structural'
}

export function isResolvedSplit(order: { splitResolution?: string | null }): boolean {
  return order.splitResolution != null
}

export function isSplitFamilyRoot(order: { splitFamilyTotal?: unknown | null; status?: string }): boolean {
  return order.splitFamilyTotal != null
}

/**
 * True when an order's money columns must NOT be rebuilt from its event stream.
 *
 * Allocation split children (even / custom_amount) are amount-only: they hold
 * zero OrderItem rows by design and their total is authored at split time by
 * even-split.ts. Replaying their stream yields subtotal/total = 0, so bridging
 * that back silently destroys real money — and lets the pay route close them
 * as a "$0 balance" with no Payment row. See the ingester's Order bridge.
 *
 * Structural children (by_item / by_seat / by_table) genuinely own their items
 * and MUST keep being recomputed.
 */
export function shouldSkipMoneyBridge(
  order: { splitClass?: string | null; parentOrderId?: string | null; itemCount?: number } | null
): boolean {
  if (!order) return false                // order doesn't exist yet — create needs money fields
  if (!order.parentOrderId) return false  // not a split child at all
  return inferSplitClass(order) === 'allocation'
}

// ─── Migration Bridge ───────────────────────────────────────────────────────

/**
 * Runtime fallback for legacy splits without explicit splitClass.
 * Stored splitClass ALWAYS wins. This is a migration bridge only.
 */
export function inferSplitClass(order: { splitClass?: string | null; itemCount?: number }): SplitClass | null {
  if (order.splitClass) return order.splitClass as SplitClass
  // Legacy fallback: children with items = structural, without = allocation
  if (order.itemCount != null && order.itemCount > 0) return 'structural'
  return 'allocation'
}
