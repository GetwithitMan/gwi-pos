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

/**
 * Allocate an already-rounded family total across allocation split children.
 *
 * WHY THIS EXISTS — consumer fairness.
 * Rounding each child independently rounds UP more often than not, so the guests
 * collectively pay more than the check. Observed at Monument: a $42.96 check at
 * 10% tax = $47.26, split 2 ways = $23.63 each, each rounded to $24.00 — the
 * house over-collected $0.74 from the table.
 *
 * Instead we round ONCE at the family level and divide that rounded amount, so
 * the children always sum to exactly what the whole check rounds to and no guest
 * is rounded up twice:
 *
 *     47.26 -> 47.00, allocated as 24.00 + 23.00 = 47.00
 *
 * Tax is untouched by any of this — it is computed on the full pre-rounding
 * subtotal and remitted in full. The rounding difference is booked separately as
 * Payment.roundingAdjustment, i.e. it comes out of product revenue, never tax.
 *
 * Uses the largest-remainder method so the allocation is exact, proportional to
 * each child's share (handles uneven/custom_amount splits, not just even ones),
 * increment-aligned (whole dollars, quarters, nickels — whatever the venue set),
 * and deterministic regardless of the order children are paid in.
 *
 * @param familyRoundedCents Rounded payable for the whole family, in cents.
 * @param incrementCents     Rounding increment in cents (100 = $1.00, 25 = $0.25).
 * @param children           Pre-rounding share per child, keyed by splitIndex.
 * @returns Map of splitIndex -> allocated cents. Sums exactly to familyRoundedCents.
 */
export function allocateRoundedFamilyTotal(
  familyRoundedCents: number,
  incrementCents: number,
  children: Array<{ splitIndex: number; shareCents: number }>,
): Map<number, number> {
  const result = new Map<number, number>()
  if (children.length === 0) return result

  const inc = incrementCents > 0 ? incrementCents : 1
  const totalShare = children.reduce((s, c) => s + Math.max(0, c.shareCents), 0)

  // Degenerate: no meaningful shares — split as evenly as the increment allows.
  const weights = totalShare > 0
    ? children.map(c => Math.max(0, c.shareCents) / totalShare)
    : children.map(() => 1 / children.length)

  const totalUnits = Math.round(familyRoundedCents / inc)

  // Floor each child to whole increments, remembering the fractional part.
  const floored = children.map((c, i) => {
    const ideal = totalUnits * weights[i]
    const units = Math.floor(ideal)
    return { splitIndex: c.splitIndex, units, frac: ideal - units }
  })

  let remaining = totalUnits - floored.reduce((s, f) => s + f.units, 0)

  // Largest remainder wins the leftover units; ties break on splitIndex so the
  // result is stable no matter what order the children are paid in.
  const order = [...floored].sort(
    (a, b) => b.frac - a.frac || a.splitIndex - b.splitIndex,
  )
  for (let i = 0; i < order.length && remaining > 0; i++, remaining--) {
    order[i].units += 1
  }

  for (const f of floored) result.set(f.splitIndex, f.units * inc)
  return result
}

/** Rounding increment (in cents) for a venue's priceRounding setting. */
export function roundingIncrementCents(increment: string | undefined | null): number {
  switch (increment) {
    case '0.05': return 5
    case '0.10': return 10
    case '0.25': return 25
    case '0.50': return 50
    case '1.00': return 100
    default: return 1 // 'none' — cent-level, i.e. no effective rounding
  }
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
