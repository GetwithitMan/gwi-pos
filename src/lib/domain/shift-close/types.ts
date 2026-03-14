/**
 * Shift Close Domain Types
 *
 * Pure data types for the shift close service layer.
 */

import { db } from '@/lib/db'

/** Prisma transaction client (same pattern as tips module) */
export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Sales & Labor ──────────────────────────────────────────────────────────

export interface SalesData {
  totalSales: number
  foodSales: number
  barSales: number
  netSales: number
}

export interface LaborCost {
  totalWages: number
  totalHours: number
  employeeCount: number
}

// ─── Shift Summary ──────────────────────────────────────────────────────────

export interface ShiftSummary {
  totalSales: number
  cashSales: number
  cardSales: number
  totalTips: number
  totalCommission: number
  cashReceived: number
  changeGiven: number
  netCashReceived: number
  paidIn: number
  paidOut: number
  orderCount: number
  paymentCount: number
  voidCount: number
  compCount: number
  salesData: SalesData
  safPendingCount: number
  safPendingTotal: number
  safFailedCount: number
  safFailedTotal: number
  laborCost: LaborCost | null
}

// ─── Tip Distribution ───────────────────────────────────────────────────────

export interface TipDistributionInput {
  grossTips: number
  tipOutTotal: number
  netTips: number
  roleTipOuts: { ruleId: string; toRoleId: string; amount: number }[]
  customShares: { toEmployeeId: string; amount: number }[]
}

export interface TipDistributionEntry {
  id: string
  toEmployeeId: string
  toEmployeeName: string
  amount: number
  shareType: string
  ruleName: string | null
  status: string
}

export interface TipDistributionSummary {
  grossTips: number
  tipOutTotal: number
  netTips: number
  entries: TipDistributionEntry[]
}

// ─── Close Shift Orchestration ──────────────────────────────────────────────

export interface ShiftCloseInput {
  shiftId: string
  locationId: string
  employeeId: string
  requestingEmployeeId: string
  effectiveActualCash: number
  /** Raw actualCash from request body (logged in audit; may differ from effectiveActualCash when cashMode=none) */
  rawActualCash?: number
  tipsDeclared?: number
  notes?: string
  currentShiftNotes: string | null
  tipDistribution?: TipDistributionInput
  forceClose?: boolean
  workingRoleId: string | null
  summary: ShiftSummary
  expectedCash: number
  variance: number
  endTime: Date
}

export interface ShiftCloseResult {
  updatedShift: any
  transferredOrderIds: string[]
  autoDistributed: boolean
}
