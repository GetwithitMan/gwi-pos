/**
 * Tips Domain Module (Skills 250–259)
 *
 * Business logic for the Tip Bank Ledger system.
 * All tip movements resolve to immutable ledger entries.
 */

// ─── Tip Ledger ──────────────────────────────────────────────────────────────

export {
  getOrCreateLedger,
  postToTipLedger,
  getLedgerBalance,
  getLedgerEntries,
  recalculateBalance,
  dollarsToCents,
  centsToDollars,
} from './tip-ledger'

export type {
  LedgerEntryType,
  LedgerSourceType,
  PostToLedgerParams,
  LedgerEntryResult,
  LedgerEntriesFilter,
  LedgerEntry,
  LedgerBalance,
} from './tip-ledger'

// ─── Tip Payouts ─────────────────────────────────────────────────────────────

export {
  cashOutTips,
  batchPayrollPayout,
  getPayableBalances,
  getPayoutHistory,
  calculateNetTipAfterCCFee,
} from './tip-payouts'

export type {
  CashOutResult,
  BatchPayoutResult,
  PayableEmployee,
  PayoutEntry,
} from './tip-payouts'

// ─── Tip Groups ───────────────────────────────────────────────────────────────

export {
  getGroupInfo,
  startTipGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  requestJoinGroup,
  approveJoinRequest,
  transferGroupOwnership,
  closeGroup,
  findActiveGroupForEmployee,
  findSegmentForTimestamp,
} from './tip-groups'

export type {
  TipGroupInfo,
  TipGroupMemberInfo,
  TipGroupSegmentInfo,
} from './tip-groups'

// ─── Tip Allocation ─────────────────────────────────────────────────────────

export {
  allocateTipsForOrder,
  calculateGroupCheckout,
} from './tip-allocation'

export type {
  TipAllocationResult,
  GroupCheckoutBreakdown,
} from './tip-allocation'

// ─── Table Ownership ──────────────────────────────────────────────────────────

export {
  getActiveOwnership,
  addOrderOwner,
  removeOrderOwner,
  updateOwnershipSplits,
  adjustAllocationsByOwnership,
} from './table-ownership'

export type {
  OwnershipInfo,
  OwnershipAllocation,
} from './table-ownership'

// ─── Tip Chargebacks ──────────────────────────────────────────────────────────

export {
  handleTipChargeback,
  getLocationTipBankSettings,
} from './tip-chargebacks'

export type {
  ChargebackResult,
} from './tip-chargebacks'

// ─── Tip Recalculation & Adjustments ─────────────────────────────────────────

export {
  performTipAdjustment,
  recalculateGroupAllocations,
  recalculateOrderAllocations,
  getAdjustmentHistory,
} from './tip-recalculation'

export type {
  AdjustmentType,
  AdjustmentContext,
  AdjustmentResult,
  RecalculationResult,
  AdjustmentRecord,
} from './tip-recalculation'

// ─── Payroll Export ─────────────────────────────────────────────────────────

export {
  aggregatePayrollData,
  formatPayrollCSV,
  centsToDollarString,
} from './tip-payroll-export'

export type {
  PayrollEmployeeData,
  PayrollExportData,
} from './tip-payroll-export'

// ─── Tip Compliance ──────────────────────────────────────────────────────────

export {
  checkTipOutCap,
  checkPoolEligibility,
  checkDeclarationMinimum,
  runComplianceChecks,
  formatCentsForDisplay,
} from './tip-compliance'

export type {
  ComplianceWarningLevel,
  ComplianceWarning,
  ComplianceCheckResult,
  ShiftComplianceData,
  TipOutCheckData,
  PoolEligibilityData,
} from './tip-compliance'
