/**
 * Reporting Domain
 *
 * Aggregates data for sales, labor, and trends.
 *
 * Modules:
 * - R1: Sales (daily, weekly, monthly)
 * - R2: Labor (hours, costs, efficiency)
 * - R3: Product Mix (item performance)
 * - R4: Inventory (usage, variance)
 * - R5: Employee (performance, tips)
 * - R6: Trends (comparisons, forecasting)
 * - R7: Exports (PDF, CSV, Excel)
 */

// Types will be added as we migrate
export type DailySummary = {
  date: Date
  grossSales: number
  netSales: number
  taxCollected: number
  discounts: number
  voids: number
  comps: number
  orderCount: number
  guestCount: number
}

export type ShiftReport = {
  shiftId: string
  employeeId: string
  sales: number
  tips: number
  hours: number
}

// Constants
export const REPORT_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'custom',
] as const

export const EXPORT_FORMATS = [
  'pdf',
  'csv',
  'excel',
  'json',
] as const
