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
