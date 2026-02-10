/**
 * Tip Payouts Domain Logic (Skill 251)
 *
 * Functions for cashing out tips, running batch payroll payouts,
 * querying payable balances, and viewing payout history.
 *
 * All payout operations flow through postToTipLedger() so every dollar
 * is traceable via immutable ledger entries.
 */

import { db } from '@/lib/db'
import { getOrCreateLedger, postToTipLedger } from './tip-ledger'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CashOutResult {
  success: boolean
  payoutAmountCents: number
  previousBalanceCents: number
  newBalanceCents: number
  ledgerEntryId: string
}

export interface BatchPayoutResult {
  totalPaidOutCents: number
  employeeCount: number
  entries: Array<{
    employeeId: string
    employeeName: string
    amountCents: number
    ledgerEntryId: string
  }>
}

export interface PayableEmployee {
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  roleName: string
  currentBalanceCents: number
}

export interface PayoutEntry {
  id: string
  employeeId: string
  amountCents: number
  sourceType: string
  memo: string | null
  shiftId: string | null
  createdAt: Date
}

// ─── Cash Out ────────────────────────────────────────────────────────────────

/**
 * Cash out tips for a single employee.
 *
 * If no amountCents is provided, the full current balance is paid out.
 * Validates that the employee has sufficient balance before proceeding.
 */
export async function cashOutTips(params: {
  locationId: string
  employeeId: string
  amountCents?: number
  shiftId?: string
  approvedById?: string
  memo?: string
}): Promise<CashOutResult> {
  const { locationId, employeeId, amountCents, shiftId, approvedById, memo } = params

  // Ensure ledger exists and get current balance
  const ledger = await getOrCreateLedger(locationId, employeeId)
  const previousBalanceCents = ledger.currentBalanceCents

  // Determine payout amount: provided value or full balance
  const payoutCents = amountCents !== undefined ? amountCents : previousBalanceCents

  // Validate positive payout
  if (payoutCents <= 0) {
    return {
      success: false,
      payoutAmountCents: 0,
      previousBalanceCents,
      newBalanceCents: previousBalanceCents,
      ledgerEntryId: '',
    }
  }

  // Validate sufficient balance
  if (previousBalanceCents < payoutCents) {
    return {
      success: false,
      payoutAmountCents: 0,
      previousBalanceCents,
      newBalanceCents: previousBalanceCents,
      ledgerEntryId: '',
    }
  }

  // Build memo with approval info if provided
  const entryMemo = approvedById
    ? memo
      ? `${memo} (approved by: ${approvedById})`
      : `Cash payout (approved by: ${approvedById})`
    : memo || 'Cash payout'

  // Post debit to ledger
  const result = await postToTipLedger({
    locationId,
    employeeId,
    amountCents: payoutCents,
    type: 'DEBIT',
    sourceType: 'PAYOUT_CASH',
    shiftId,
    memo: entryMemo,
  })

  return {
    success: true,
    payoutAmountCents: payoutCents,
    previousBalanceCents,
    newBalanceCents: result.newBalanceCents,
    ledgerEntryId: result.id,
  }
}

// ─── Batch Payroll Payout ────────────────────────────────────────────────────

/**
 * Process payroll payouts for multiple employees at once.
 *
 * If no employeeIds are provided, all employees at the location with
 * positive balances are included.
 */
export async function batchPayrollPayout(params: {
  locationId: string
  processedById: string
  employeeIds?: string[]
  memo?: string
}): Promise<BatchPayoutResult> {
  const { locationId, processedById, employeeIds, memo } = params

  // Build where clause for ledgers with positive balance
  const whereClause: Record<string, unknown> = {
    locationId,
    currentBalanceCents: { gt: 0 },
    deletedAt: null,
  }

  if (employeeIds && employeeIds.length > 0) {
    whereClause.employeeId = { in: employeeIds }
  }

  // Fetch all qualifying ledgers with employee info
  const ledgers = await db.tipLedger.findMany({
    where: whereClause,
    select: {
      employeeId: true,
      currentBalanceCents: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
  })

  if (ledgers.length === 0) {
    return {
      totalPaidOutCents: 0,
      employeeCount: 0,
      entries: [],
    }
  }

  const payrollMemo = memo || `Payroll payout (processed by: ${processedById})`

  // Process each employee's payout
  const entries: BatchPayoutResult['entries'] = []
  let totalPaidOutCents = 0

  for (const ledger of ledgers) {
    const result = await postToTipLedger({
      locationId,
      employeeId: ledger.employeeId,
      amountCents: ledger.currentBalanceCents,
      type: 'DEBIT',
      sourceType: 'PAYOUT_PAYROLL',
      memo: payrollMemo,
    })

    const employeeName = ledger.employee.displayName
      || `${ledger.employee.firstName} ${ledger.employee.lastName}`

    entries.push({
      employeeId: ledger.employeeId,
      employeeName,
      amountCents: ledger.currentBalanceCents,
      ledgerEntryId: result.id,
    })

    totalPaidOutCents += ledger.currentBalanceCents
  }

  return {
    totalPaidOutCents,
    employeeCount: entries.length,
    entries,
  }
}

// ─── Payable Balances ────────────────────────────────────────────────────────

/**
 * Get all employees at a location with positive tip balances.
 * Returns sorted by balance descending (highest owed first).
 */
export async function getPayableBalances(
  locationId: string
): Promise<PayableEmployee[]> {
  const ledgers = await db.tipLedger.findMany({
    where: {
      locationId,
      currentBalanceCents: { gt: 0 },
      deletedAt: null,
    },
    select: {
      employeeId: true,
      currentBalanceCents: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          role: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      currentBalanceCents: 'desc',
    },
  })

  return ledgers.map((ledger) => ({
    employeeId: ledger.employeeId,
    firstName: ledger.employee.firstName,
    lastName: ledger.employee.lastName,
    displayName: ledger.employee.displayName,
    roleName: ledger.employee.role.name,
    currentBalanceCents: ledger.currentBalanceCents,
  }))
}

// ─── Payout History ──────────────────────────────────────────────────────────

/**
 * Get payout history (cash and payroll payouts) with optional filters.
 * Returns paginated results sorted by most recent first.
 */
export async function getPayoutHistory(params: {
  locationId: string
  employeeId?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}): Promise<{ entries: PayoutEntry[]; total: number }> {
  const { locationId, employeeId, dateFrom, dateTo, limit, offset } = params

  const where: Record<string, unknown> = {
    locationId,
    sourceType: { in: ['PAYOUT_CASH', 'PAYOUT_PAYROLL'] },
    deletedAt: null,
  }

  if (employeeId) {
    where.employeeId = employeeId
  }

  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) {
      (where.createdAt as Record<string, unknown>).gte = dateFrom
    }
    if (dateTo) {
      (where.createdAt as Record<string, unknown>).lte = dateTo
    }
  }

  const [entries, total] = await db.$transaction([
    db.tipLedgerEntry.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        amountCents: true,
        sourceType: true,
        memo: true,
        shiftId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit || 50,
      skip: offset || 0,
    }),
    db.tipLedgerEntry.count({ where }),
  ])

  return { entries, total }
}

// ─── CC Fee Calculation ──────────────────────────────────────────────────────

/**
 * Calculate the net tip amount after deducting a credit card processing fee.
 *
 * Pure function -- no database interaction.
 *
 * @param tipAmountCents - The gross tip amount in cents
 * @param ccFeePercent - The CC fee percentage (e.g., 3.5 for 3.5%)
 * @returns The net amount and the fee amount, both in cents
 */
export function calculateNetTipAfterCCFee(
  tipAmountCents: number,
  ccFeePercent: number
): { netAmountCents: number; feeAmountCents: number } {
  const feeAmountCents = Math.round(tipAmountCents * ccFeePercent / 100)
  const netAmountCents = tipAmountCents - feeAmountCents

  return { netAmountCents, feeAmountCents }
}
