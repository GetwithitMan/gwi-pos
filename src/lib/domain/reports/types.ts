/**
 * Reports Domain Types
 *
 * Pure data types for report calculations.
 * NO framework imports — these are domain-only.
 */

// ─── Revenue ────────────────────────────────────────────────────────────────

/** Order-level fields needed for revenue calculation */
export interface RevenueOrder {
  status: string
  subtotal: number | string
  taxTotal: number | string
  taxFromInclusive?: number | string | null
  taxFromExclusive?: number | string | null
  discountTotal: number | string
  total: number | string
}

/** Breakdown of tax by type (inclusive vs exclusive) */
export interface TaxBreakdown {
  totalTax: number
  taxFromInclusive: number
  taxFromExclusive: number
}

/** Surcharge calculation inputs */
export interface SurchargeInput {
  subtotal: number
  surchargePercent: number
}

// ─── Labor ──────────────────────────────────────────────────────────────────

/** Minimal time clock entry for labor cost calculation */
export interface TimeClockEntryForLabor {
  regularHours: number | string | null
  overtimeHours: number | string | null
  hourlyRate: number | string
  breakMinutes?: number | null
}

/** Aggregated labor summary */
export interface LaborSummary {
  totalRegularHours: number
  totalOvertimeHours: number
  totalHours: number
  totalBreakMinutes: number
  totalLaborCost: number
  shiftCount: number
}

// ─── Aggregations ───────────────────────────────────────────────────────────

/** Turn time calculation input */
export interface TurnTimeInput {
  createdAt: Date
  paidAt: Date | null
}
