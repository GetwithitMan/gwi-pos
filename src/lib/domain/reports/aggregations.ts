/**
 * Report Aggregation Utilities — PURE functions
 *
 * Common calculations shared across report routes:
 * average ticket, turn time, monetary rounding.
 *
 * NO DB access, NO side effects, NO framework imports.
 */

/**
 * Calculate average ticket (revenue per order).
 *
 * Returns 0 when orderCount is 0 to avoid NaN/Infinity.
 */
export function calculateAverageTicket(totalRevenue: number, orderCount: number): number {
  if (orderCount <= 0) return 0
  return roundMoney(totalRevenue / orderCount)
}

/**
 * Calculate turn time in minutes between order creation and payment.
 *
 * Returns null if paidAt is missing (order still open).
 */
export function calculateTurnTime(createdAt: Date, paidAt: Date | null): number | null {
  if (!paidAt) return null
  return (paidAt.getTime() - createdAt.getTime()) / (1000 * 60)
}

/**
 * Round a monetary amount to 2 decimal places.
 *
 * Single canonical replacement for 241+ inline occurrences of
 * `Math.round(x * 100) / 100` across 33 report files.
 *
 * Also exported from revenue.ts for import convenience.
 */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}
