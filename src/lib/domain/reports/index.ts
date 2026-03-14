/**
 * Reports Domain Module
 *
 * Centralizes duplicated report calculations that were previously
 * inlined across 51 report routes (~14,400 lines, ~40% duplication).
 *
 * All exports are PURE functions — no DB, no side effects.
 */

// ─── Revenue ────────────────────────────────────────────────────────────────

export {
  REVENUE_ORDER_STATUSES,
  isRevenueOrder,
  calculateSurchargeAmount,
  calculateTaxBreakdown,
  roundMoney,
} from './revenue'

// ─── Labor ──────────────────────────────────────────────────────────────────

export {
  DEFAULT_OVERTIME_MULTIPLIER,
  calculateLaborCost,
  calculateLaborSummary,
} from './labor'

// ─── Aggregations ───────────────────────────────────────────────────────────

export {
  calculateAverageTicket,
  calculateTurnTime,
  // roundMoney also exported from revenue — not re-exported from aggregations
  // to avoid duplicate export. Consumers import roundMoney from this barrel.
} from './aggregations'

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  RevenueOrder,
  TaxBreakdown,
  SurchargeInput,
  TimeClockEntryForLabor,
  LaborSummary,
  TurnTimeInput,
} from './types'
