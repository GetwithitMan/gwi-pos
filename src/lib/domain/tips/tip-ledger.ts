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

// ─── Transaction Client Type ─────────────────────────────────────────────────
// Prisma transaction client — pass this to avoid nested transactions.
// When provided, postToTipLedger uses the caller's transaction instead of
// creating its own. This ensures group allocations use a single
// transactions, and ensures group allocations commit atomically.
export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

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
  idempotencyKey?: string
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
 *
 * @param txClient - Optional Prisma transaction client to use instead of db
 */
export async function getOrCreateLedger(
  locationId: string,
  employeeId: string,
  txClient?: TxClient
): Promise<{ id: string; currentBalanceCents: number }> {
  const client = txClient ?? db

  // Try to find existing ledger
  const existing = await client.tipLedger.findUnique({
    where: { locationId_employeeId: { locationId, employeeId } },
    select: { id: true, currentBalanceCents: true },
  })

  if (existing) return existing

  // Create new ledger with zero balance
  const ledger = await client.tipLedger.create({
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
 * @param txClient - Optional Prisma transaction client. When provided, uses
 *   the caller's transaction instead of creating a nested one. This is
 *   REQUIRED when calling from inside another $transaction (e.g. group
 *   allocations that post multiple ledger entries atomically).
 *   When omitted, creates its own $transaction as before (backward compatible).
 *
 * @returns The created entry and new balance
 */
export async function postToTipLedger(
  params: PostToLedgerParams,
  txClient?: TxClient
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
    idempotencyKey,
  } = params

  // ── Idempotency guard (Skill 274) ──────────────────────────────────────────
  // If an idempotency key is provided, check whether this entry was already
  // posted. If so, return the existing result as a no-op (prevents double-post
  // when the fire-and-forget allocation pipeline retries).
  if (idempotencyKey) {
    const client = txClient ?? db
    const existing = await client.tipLedgerEntry.findFirst({
      where: { idempotencyKey, deletedAt: null },
    })
    if (existing) {
      // Read current balance from the ledger for the return value
      const ledger = await client.tipLedger.findFirst({
        where: { employeeId },
        select: { currentBalanceCents: true },
      })
      return {
        id: existing.id,
        ledgerId: existing.ledgerId,
        employeeId: existing.employeeId,
        type: existing.type as LedgerEntryType,
        amountCents: existing.amountCents,
        sourceType: existing.sourceType as LedgerSourceType,
        newBalanceCents: ledger?.currentBalanceCents ?? 0,
      }
    }
  }

  // Calculate the signed amount: CREDIT = positive, DEBIT = negative
  const signedAmount = type === 'CREDIT' ? Math.abs(amountCents) : -Math.abs(amountCents)

  if (txClient) {
    // ── Caller-owned transaction: use their client directly ──────────────
    const ledger = await getOrCreateLedger(locationId, employeeId, txClient)

    const entry = await txClient.tipLedgerEntry.create({
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
        idempotencyKey,
      },
    })

    const updatedLedger = await txClient.tipLedger.update({
      where: { id: ledger.id },
      data: {
        currentBalanceCents: {
          increment: signedAmount,
        },
      },
    })

    // ── Auto-reclaim open TipDebt on CREDIT (Skill 278) ─────────────────
    if (type === 'CREDIT') {
      await autoReclaimTipDebts({
        client: txClient,
        locationId,
        employeeId,
        ledgerId: ledger.id,
        creditCents: Math.abs(amountCents),
      })
    }

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

  // ── Self-owned transaction (backward compatible) ─────────────────────
  const ledger = await getOrCreateLedger(locationId, employeeId)

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
        idempotencyKey,
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

  // ── Auto-reclaim open TipDebt on CREDIT (Skill 278) ─────────────────
  if (type === 'CREDIT') {
    await autoReclaimTipDebts({
      client: db,
      locationId,
      employeeId,
      ledgerId: ledger.id,
      creditCents: Math.abs(amountCents),
    })
  }

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
  const ledger = await db.tipLedger.findFirst({
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
  const ledger = await db.tipLedger.findFirst({
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

// ─── TipDebt Auto-Reclaim (Skill 278) ────────────────────────────────────────

/**
 * When a CREDIT is posted, check if the employee has any open TipDebt records.
 * If so, automatically reclaim by posting DEBIT entries against the credit amount
 * and reducing TipDebt.remainingCents.
 *
 * Debts are processed oldest-first (FIFO). Processing stops when the credit is
 * fully consumed or all debts are satisfied.
 */
async function autoReclaimTipDebts(params: {
  client: TxClient | typeof db
  locationId: string
  employeeId: string
  ledgerId: string
  creditCents: number
}): Promise<void> {
  const { client, locationId, employeeId, ledgerId, creditCents } = params

  // Find open debts for this employee, oldest first
  const openDebts = await client.tipDebt.findMany({
    where: {
      employeeId,
      locationId,
      status: { in: ['open', 'partial'] },
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (openDebts.length === 0) return

  let remainingCredit = creditCents

  for (const debt of openDebts) {
    if (remainingCredit <= 0) break

    const reclaimCents = Math.min(remainingCredit, debt.remainingCents)
    if (reclaimCents <= 0) continue

    const newRemaining = debt.remainingCents - reclaimCents
    const isFullyRecovered = newRemaining <= 0

    // Post a DEBIT entry to reclaim from the employee's ledger
    const signedDebit = -Math.abs(reclaimCents)
    await client.tipLedgerEntry.create({
      data: {
        locationId,
        ledgerId,
        employeeId,
        type: 'DEBIT',
        amountCents: signedDebit,
        sourceType: 'CHARGEBACK',
        sourceId: debt.id,
        memo: `Auto-reclaim TipDebt ${debt.id} (${isFullyRecovered ? 'fully recovered' : 'partial'})`,
      },
    })

    // Update the ledger cached balance
    await client.tipLedger.update({
      where: { id: ledgerId },
      data: {
        currentBalanceCents: { increment: signedDebit },
      },
    })

    // Update the TipDebt record
    await client.tipDebt.update({
      where: { id: debt.id },
      data: {
        remainingCents: newRemaining,
        status: isFullyRecovered ? 'recovered' : 'partial',
        ...(isFullyRecovered ? { recoveredAt: new Date() } : {}),
      },
    })

    remainingCredit -= reclaimCents
  }
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
