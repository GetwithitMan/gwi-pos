/**
 * Tip Ledger Domain Logic (Skill 250)
 *
 * Core functions for the TipLedger system — every employee gets a "bank account"
 * for tips. ALL tip flows (direct tips, group pools, role tip-outs, manual transfers,
 * payouts, chargebacks) resolve to immutable ledger entries (credits and debits).
 *
 * This makes every dollar traceable and every balance explainable.
 */

import { db } from '@/lib/db'

// ─── Types ───────────────────────────────────────────────────────────────────

export type LedgerEntryType = 'CREDIT' | 'DEBIT'

export type LedgerSourceType =
  | 'DIRECT_TIP'
  | 'TIP_GROUP'
  | 'ROLE_TIPOUT'
  | 'MANUAL_TRANSFER'
  | 'PAYOUT_CASH'
  | 'PAYOUT_PAYROLL'
  | 'CHARGEBACK'
  | 'ADJUSTMENT'

export interface PostToLedgerParams {
  locationId: string
  employeeId: string
  amountCents: number
  type: LedgerEntryType
  sourceType: LedgerSourceType
  sourceId?: string
  memo?: string
  shiftId?: string
  orderId?: string
  adjustmentId?: string
}

export interface LedgerEntryResult {
  id: string
  ledgerId: string
  employeeId: string
  type: LedgerEntryType
  amountCents: number
  sourceType: LedgerSourceType
  newBalanceCents: number
}

export interface LedgerEntriesFilter {
  dateFrom?: Date
  dateTo?: Date
  sourceType?: LedgerSourceType
  limit?: number
  offset?: number
}

export interface LedgerEntry {
  id: string
  type: string
  amountCents: number
  sourceType: string
  sourceId: string | null
  memo: string | null
  shiftId: string | null
  orderId: string | null
  adjustmentId: string | null
  createdAt: Date
}

export interface LedgerBalance {
  employeeId: string
  currentBalanceCents: number
  ledgerId: string
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get or create a TipLedger for an employee.
 * Lazy-creates on first tip interaction — no upfront migration needed.
 */
export async function getOrCreateLedger(
  locationId: string,
  employeeId: string
): Promise<{ id: string; currentBalanceCents: number }> {
  // Try to find existing ledger
  const existing = await db.tipLedger.findUnique({
    where: { employeeId },
    select: { id: true, currentBalanceCents: true },
  })

  if (existing) return existing

  // Create new ledger with zero balance
  const ledger = await db.tipLedger.create({
    data: {
      locationId,
      employeeId,
    },
    select: { id: true, currentBalanceCents: true },
  })

  return ledger
}

/**
 * Post a credit or debit entry to an employee's tip ledger.
 * Creates the entry and atomically updates the cached balance.
 *
 * @returns The created entry and new balance
 */
export async function postToTipLedger(
  params: PostToLedgerParams
): Promise<LedgerEntryResult> {
  const {
    locationId,
    employeeId,
    amountCents,
    type,
    sourceType,
    sourceId,
    memo,
    shiftId,
    orderId,
    adjustmentId,
  } = params

  // Ensure ledger exists
  const ledger = await getOrCreateLedger(locationId, employeeId)

  // Calculate the signed amount: CREDIT = positive, DEBIT = negative
  const signedAmount = type === 'CREDIT' ? Math.abs(amountCents) : -Math.abs(amountCents)

  // Atomic: create entry + update balance in a transaction
  const [entry, updatedLedger] = await db.$transaction([
    db.tipLedgerEntry.create({
      data: {
        locationId,
        ledgerId: ledger.id,
        employeeId,
        type,
        amountCents: signedAmount,
        sourceType,
        sourceId,
        memo,
        shiftId,
        orderId,
        adjustmentId,
      },
    }),
    db.tipLedger.update({
      where: { id: ledger.id },
      data: {
        currentBalanceCents: {
          increment: signedAmount,
        },
      },
    }),
  ])

  return {
    id: entry.id,
    ledgerId: ledger.id,
    employeeId,
    type,
    amountCents: signedAmount,
    sourceType: sourceType as LedgerSourceType,
    newBalanceCents: updatedLedger.currentBalanceCents,
  }
}

/**
 * Get the current cached balance for an employee.
 * Fast read — no aggregation needed.
 */
export async function getLedgerBalance(
  employeeId: string
): Promise<LedgerBalance | null> {
  const ledger = await db.tipLedger.findUnique({
    where: { employeeId },
    select: {
      id: true,
      employeeId: true,
      currentBalanceCents: true,
    },
  })

  if (!ledger) return null

  return {
    employeeId: ledger.employeeId,
    currentBalanceCents: ledger.currentBalanceCents,
    ledgerId: ledger.id,
  }
}

/**
 * Get ledger entries for an employee with optional filters.
 */
export async function getLedgerEntries(
  employeeId: string,
  filters?: LedgerEntriesFilter
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const where: Record<string, unknown> = {
    employeeId,
    deletedAt: null,
  }

  if (filters?.sourceType) {
    where.sourceType = filters.sourceType
  }

  if (filters?.dateFrom || filters?.dateTo) {
    where.createdAt = {}
    if (filters.dateFrom) {
      (where.createdAt as Record<string, unknown>).gte = filters.dateFrom
    }
    if (filters.dateTo) {
      (where.createdAt as Record<string, unknown>).lte = filters.dateTo
    }
  }

  const [entries, total] = await db.$transaction([
    db.tipLedgerEntry.findMany({
      where,
      select: {
        id: true,
        type: true,
        amountCents: true,
        sourceType: true,
        sourceId: true,
        memo: true,
        shiftId: true,
        orderId: true,
        adjustmentId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    }),
    db.tipLedgerEntry.count({ where }),
  ])

  return { entries, total }
}

/**
 * Recalculate balance from all entries (integrity check).
 * Use this to verify the cached `currentBalanceCents` is accurate.
 * If mismatch detected, fixes the cached value.
 *
 * @returns The recalculated balance and whether a fix was applied
 */
export async function recalculateBalance(
  employeeId: string
): Promise<{ calculatedCents: number; cachedCents: number; fixed: boolean }> {
  const ledger = await db.tipLedger.findUnique({
    where: { employeeId },
    select: { id: true, currentBalanceCents: true },
  })

  if (!ledger) {
    return { calculatedCents: 0, cachedCents: 0, fixed: false }
  }

  // Sum all non-deleted entries
  const result = await db.tipLedgerEntry.aggregate({
    where: {
      ledgerId: ledger.id,
      deletedAt: null,
    },
    _sum: {
      amountCents: true,
    },
  })

  const calculatedCents = result._sum.amountCents || 0
  const cachedCents = ledger.currentBalanceCents

  if (calculatedCents !== cachedCents) {
    // Fix the drift
    await db.tipLedger.update({
      where: { id: ledger.id },
      data: { currentBalanceCents: calculatedCents },
    })

    return { calculatedCents, cachedCents, fixed: true }
  }

  return { calculatedCents, cachedCents, fixed: false }
}

// ─── Conversion Helpers ──────────────────────────────────────────────────────

/**
 * Convert dollars (Decimal) to cents (Int).
 * The existing tip system uses Decimal dollars; the ledger uses Int cents.
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * Convert cents (Int) to dollars for display.
 */
export function centsToDollars(cents: number): number {
  return cents / 100
}
