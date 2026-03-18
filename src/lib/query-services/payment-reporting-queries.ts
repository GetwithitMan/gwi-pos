/**
 * Payment Reporting Query Service
 *
 * Read-only aggregate queries for payment-related reports:
 * - Payment totals by method (cash, card, gift, house account, etc.)
 * - Tip summaries (banked, collected, tip-outs distributed)
 * - Tip ledger entries for detailed tip reporting
 * - Shift-level payment breakdowns
 *
 * All queries enforce locationId as the first parameter for tenant safety.
 * Uses adminDb (soft-delete filtering only, no tenant scoping overhead).
 */

import { Prisma } from '@/generated/prisma/client'
import { adminDb } from '@/lib/db'
import type { BusinessDayRange } from './order-reporting-queries'

// ─── Tip Ledger Queries ───────────────────────────────────────────────────────

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  role: { select: { name: true } },
} as const

const EMPLOYEE_SELECT_BASIC = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
} as const

/**
 * Fetch tip-out entries (ROLE_TIPOUT type) for the tips report.
 * Returns both DEBIT and CREDIT entries with employee info.
 */
export async function getTipOutEntries(
  locationId: string,
  dateFilter: { createdAt?: { gte?: Date; lte?: Date } },
  employeeId?: string | null,
) {
  const where: Prisma.TipLedgerEntryWhereInput = {
    locationId,
    sourceType: 'ROLE_TIPOUT',
    deletedAt: null,
    ...dateFilter,
  }
  if (employeeId) where.employeeId = employeeId

  return adminDb.tipLedgerEntry.findMany({
    where,
    include: { employee: { select: EMPLOYEE_SELECT } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Fetch banked tip entries (DIRECT_TIP, TIP_GROUP, PAYOUT_CASH, PAYOUT_PAYROLL)
 * for the tips report.
 */
export async function getBankedTipEntries(
  locationId: string,
  dateFilter: { createdAt?: { gte?: Date; lte?: Date } },
  employeeId?: string | null,
) {
  const where: Prisma.TipLedgerEntryWhereInput = {
    locationId,
    deletedAt: null,
    sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP', 'PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
    ...dateFilter,
  }
  if (employeeId) where.employeeId = employeeId

  return adminDb.tipLedgerEntry.findMany({
    where,
    include: { employee: { select: EMPLOYEE_SELECT } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Fetch tip ledger balances for the tips report summary.
 */
export async function getTipLedgerBalances(
  locationId: string,
  employeeId?: string | null,
) {
  const where: Prisma.TipLedgerWhereInput = {
    locationId,
    deletedAt: null,
  }
  if (employeeId) where.employeeId = employeeId

  return adminDb.tipLedger.findMany({
    where,
    select: { employeeId: true, currentBalanceCents: true },
  })
}

/**
 * Fetch counterpart tip-out entries (the other side of a tip-out pair).
 * Used when filtering by employee to show who they gave to / received from.
 */
export async function getTipOutCounterparts(
  locationId: string,
  sourceIds: string[],
  excludeEmployeeId: string,
) {
  if (sourceIds.length === 0) return []

  return adminDb.tipLedgerEntry.findMany({
    where: {
      locationId,
      sourceType: 'ROLE_TIPOUT',
      sourceId: { in: sourceIds },
      deletedAt: null,
      employeeId: { not: excludeEmployeeId },
    },
    include: { employee: { select: EMPLOYEE_SELECT } },
  })
}

/**
 * Fetch shifts with tip data for the tips report.
 */
export async function getShiftsWithTips(
  locationId: string,
  dateFilter?: { endedAt?: { gte?: Date; lte?: Date } },
  employeeId?: string | null,
) {
  const where: Prisma.ShiftWhereInput = {
    locationId,
    status: 'closed',
    grossTips: { not: null },
  }
  if (dateFilter?.endedAt) where.endedAt = dateFilter.endedAt
  if (employeeId) where.employeeId = employeeId

  return adminDb.shift.findMany({
    where,
    include: { employee: { select: EMPLOYEE_SELECT } },
    orderBy: { endedAt: 'desc' },
  })
}

// ─── Tips Banked / Collected / Distributed (Daily Report) ─────────────────────

/**
 * Tips banked today (CREDIT entries for DIRECT_TIP + TIP_GROUP).
 * Used by the daily report.
 */
export async function getTipsBankedInRange(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.tipLedgerEntry.findMany({
    where: {
      locationId,
      type: 'CREDIT',
      sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
      deletedAt: null,
      createdAt: { gte: range.start, lte: range.end },
    },
    take: 10000,
    include: { employee: { select: EMPLOYEE_SELECT_BASIC } },
  })
}

/**
 * Tips collected today (DEBIT entries for PAYOUT_CASH + PAYOUT_PAYROLL).
 * Used by the daily report.
 */
export async function getTipsCollectedInRange(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.tipLedgerEntry.findMany({
    where: {
      locationId,
      type: 'DEBIT',
      sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
      deletedAt: null,
      createdAt: { gte: range.start, lte: range.end },
    },
    take: 10000,
    include: { employee: { select: EMPLOYEE_SELECT_BASIC } },
  })
}

/**
 * Tip shares distributed today (all ROLE_TIPOUT entries in range).
 * Used by the daily report.
 */
export async function getTipSharesDistributedInRange(
  locationId: string,
  range: BusinessDayRange,
) {
  return adminDb.tipLedgerEntry.findMany({
    where: {
      locationId,
      sourceType: 'ROLE_TIPOUT',
      deletedAt: null,
      createdAt: { gte: range.start, lte: range.end },
    },
    take: 10000,
    include: { employee: { select: EMPLOYEE_SELECT_BASIC } },
  })
}

// ─── Shift Payment Queries (shift-summary.ts patterns) ────────────────────────

/**
 * Fetch completed payments by employee during a shift window.
 * Enforces locationId through the order relation.
 */
export async function getShiftPayments(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.payment.findMany({
    where: {
      employeeId,
      status: 'completed',
      processedAt: { gte: startTime, lte: endTime },
      order: { locationId },
    },
    include: {
      order: {
        select: { id: true, orderNumber: true, total: true },
      },
    },
  })
}

/**
 * Fetch drawer-scoped cash payments for shift close (when drawerId is known).
 */
export async function getDrawerCashPayments(
  locationId: string,
  drawerId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.payment.findMany({
    where: {
      drawerId,
      paymentMethod: 'cash',
      status: 'completed',
      processedAt: { gte: startTime, lte: endTime },
      order: { locationId },
    },
    select: {
      amountTendered: true,
      changeGiven: true,
    },
  })
}

/**
 * Fetch SAF pending payments for shift close visibility.
 */
export async function getSAFPendingPayments(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.payment.findMany({
    where: {
      employeeId,
      safStatus: 'APPROVED_SAF_PENDING_UPLOAD',
      processedAt: { gte: startTime, lte: endTime },
      order: { locationId },
    },
    select: { amount: true, tipAmount: true },
  })
}

/**
 * Fetch SAF failed payments for shift close visibility.
 */
export async function getSAFFailedPayments(
  locationId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
) {
  return adminDb.payment.findMany({
    where: {
      employeeId,
      safStatus: { in: ['UPLOAD_FAILED', 'NEEDS_ATTENTION'] },
      processedAt: { gte: startTime, lte: endTime },
      order: { locationId },
    },
    select: { amount: true, tipAmount: true },
  })
}

// ─── Payroll Tip Queries ──────────────────────────────────────────────────────

/**
 * Fetch tip ledger entries by source type, entry type, and date range.
 * Generic helper used by the payroll report for its 7 parallel tip queries.
 */
export async function getTipLedgerEntries(
  locationId: string,
  opts: {
    sourceTypes: string[]
    type?: 'CREDIT' | 'DEBIT'
    dateRange?: { start: Date; end: Date }
    employeeId?: string | null
  },
) {
  const where: Prisma.TipLedgerEntryWhereInput = {
    locationId,
    sourceType: { in: opts.sourceTypes },
    deletedAt: null,
  }
  if (opts.type) where.type = opts.type
  if (opts.dateRange) {
    where.createdAt = { gte: opts.dateRange.start, lte: opts.dateRange.end }
  }
  if (opts.employeeId) where.employeeId = opts.employeeId

  return adminDb.tipLedgerEntry.findMany({ where })
}

// ─── House Account Queries ────────────────────────────────────────────────────

/**
 * Fetch house accounts with charge transactions for aging report.
 */
export async function getHouseAccountsWithCharges(
  locationId: string,
  statusFilter: string,
) {
  return adminDb.houseAccount.findMany({
    where: {
      locationId,
      deletedAt: null,
      status: statusFilter as any,
    },
    include: {
      transactions: {
        where: { deletedAt: null, type: 'charge' },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })
}

/**
 * Fetch the most recent payment transaction per house account.
 */
export async function getLastHouseAccountPayments(
  locationId: string,
  accountIds: string[],
) {
  if (accountIds.length === 0) return []

  return adminDb.houseAccountTransaction.findMany({
    where: {
      locationId,
      deletedAt: null,
      type: 'payment',
      houseAccountId: { in: accountIds },
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['houseAccountId'],
    select: {
      houseAccountId: true,
      createdAt: true,
      amount: true,
    },
  })
}
