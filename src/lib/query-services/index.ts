/**
 * Query Services — barrel export
 *
 * Read-only aggregate query modules for reports and dashboards.
 * These are NOT CRUD repositories — they encapsulate complex
 * analytical queries that don't fit the standard repository pattern.
 *
 * Usage:
 *   import { getRevenueSummary, getTipOutEntries } from '@/lib/query-services'
 *
 * All functions enforce locationId as their first parameter for tenant safety.
 */

// ─── Order / Revenue / Dashboard ──────────────────────────────────────────────

export {
  // SQL aggregate queries (daily report)
  getRevenueSummary,
  getSalesByOrderType,
  getCategorySales,
  getCategoryVoids,
  getPaymentSummary,
  getDiscountSummary,
  getWeightBasedSales,
  getEntertainmentSummary,
  getSurchargeBase,

  // Dashboard live metrics
  getTodayRevenueOrders,
  getOpenOrders,
  getVoidedItemsAggregate,
  getCompedItemsAggregate,
  getDiscountTotalAggregate,
  getFailedDeductionCount,

  // Void logs
  getVoidLogs,
  getVoidLogsDetailed,
  getOrderItemNames,

  // Paid in/out
  getPaidInOut,
  getPaidInOutTotals,

  // Gift cards
  getGiftCardTransactions,

  // Categories
  getCategories,

  // CC tip fees
  getCCTipFees,

  // Types
  type RevenueSummaryRow,
  type OrderTypeSummaryRow,
  type CategorySalesRow,
  type CategoryVoidsRow,
  type PaymentSummaryRow,
  type DiscountSummaryRow,
  type WeightSummaryRow,
  type EntertainmentSummaryRow,
  type SurchargeOrderRow,
  type BusinessDayRange,
  type LiveDashboardOrders,
  type TimedQueryResult,
} from './order-reporting-queries'

// ─── Payment / Tips / House Accounts ──────────────────────────────────────────

export {
  // Tips report
  getTipOutEntries,
  getBankedTipEntries,
  getTipLedgerBalances,
  getTipOutCounterparts,
  getShiftsWithTips,

  // Tips daily report
  getTipsBankedInRange,
  getTipsCollectedInRange,
  getTipSharesDistributedInRange,

  // Shift payments
  getShiftPayments,
  getDrawerCashPayments,
  getSAFPendingPayments,
  getSAFFailedPayments,

  // Payroll tips
  getTipLedgerEntries,

  // House accounts
  getHouseAccountsWithCharges,
  getLastHouseAccountPayments,
} from './payment-reporting-queries'

// ─── Labor / Shifts / Payroll ─────────────────────────────────────────────────

export {
  // Time clock
  getTimeClockEntries,
  getOverlappingTimeClockEntries,

  // Employees
  getActiveEmployees,
  getActiveEmployeesWithRoles,

  // Shifts
  getClosedShifts,

  // Shift-level order/item queries
  getShiftOrders,
  getOrderItemsByCategoryType,
  countVoidedItemsForShift,
  countCompedItemsForShift,

  // Shift paid in/out
  getShiftPaidInOut,

  // Labor cost as % of sales
  getSalesTotalForPeriod,

  // Commission
  getCommissionOrders,

  // Payroll time entries
  getPayrollTimeEntries,
} from './labor-reporting-queries'
