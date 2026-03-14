/**
 * Shift Close Domain Module
 *
 * Business logic for shift close: summary calculations,
 * tip distribution, and close orchestration.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  TxClient,
  SalesData,
  LaborCost,
  ShiftSummary,
  TipDistributionInput,
  TipDistributionEntry,
  TipDistributionSummary,
  ShiftCloseInput,
  ShiftCloseResult,
} from './types'

// ─── Shift Summary ──────────────────────────────────────────────────────────

export { calculateShiftSummary } from './shift-summary'

// ─── Tip Distribution ───────────────────────────────────────────────────────

export {
  processTipDistribution,
  autoProcessTipDistribution,
  getShiftTipDistributionSummary,
} from './tip-distribution'

// ─── Close Shift Orchestration ──────────────────────────────────────────────

export { closeShift } from './close-shift'
