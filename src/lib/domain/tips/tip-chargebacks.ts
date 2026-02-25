/**
 * Tip Chargeback Domain Logic (Skill 255 - Phase 6)
 *
 * Handles tip reversal when a payment is voided or refunded.
 * Two policies controlled by location settings:
 *
 *   1. BUSINESS_ABSORBS  -- The tip stays in the employee's ledger. The business
 *      eats the loss. The TipTransaction is soft-deleted for audit.
 *
 *   2. EMPLOYEE_CHARGEBACK -- Proportional DEBIT entries reverse each original
 *      CREDIT. If allowNegativeBalances is false, each debit is capped at the
 *      employee's current balance. Any uncollectable remainder is tracked in
 *      flaggedForReviewCents for manager review.
 *
 * All writes use postToTipLedger() so the cached balance on TipLedger stays
 * accurate and every entry is immutable and traceable.
 */

import { db } from '@/lib/db'
import { postToTipLedger, getLedgerBalance } from '@/lib/domain/tips/tip-ledger'
import type { TipBankSettings } from '@/lib/settings'
import { DEFAULT_SETTINGS } from '@/lib/settings'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChargebackResult {
  policy: 'BUSINESS_ABSORBS' | 'EMPLOYEE_CHARGEBACK'
  tipTransactionId: string
  originalTipCents: number
  chargedBackCents: number
  flaggedForReviewCents: number
  tipDebtIds: string[]
  entries: Array<{
    employeeId: string
    amountCents: number
    ledgerEntryId: string
    cappedAtBalance: boolean
  }>
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Handle tip chargeback when a payment is voided or refunded.
 *
 * Finds TipTransaction(s) for the given paymentId, determines the chargeback
 * policy from location settings, and either absorbs the loss (business) or
 * creates proportional DEBIT entries to reverse each employee's CREDIT.
 *
 * @throws {Error} If no TipTransaction is found for the paymentId
 */
export async function handleTipChargeback(params: {
  locationId: string
  paymentId: string
  memo?: string
}): Promise<ChargebackResult> {
  const { locationId, paymentId, memo } = params

  // ── 1. Find TipTransaction(s) for this payment ─────────────────────────
  const tipTransactions = await db.tipTransaction.findMany({
    where: {
      paymentId,
      locationId,
      deletedAt: null,
    },
  })

  if (tipTransactions.length === 0) {
    throw new Error(
      `[tip-chargebacks] No TipTransaction found for paymentId=${paymentId} in location=${locationId}`
    )
  }

  // Use the first transaction (a payment typically has one TipTransaction)
  const tipTxn = tipTransactions[0]

  // ── 2. Load location settings to get chargeback policy ──────────────────
  const settings = await getLocationTipBankSettings(locationId)
  const policy = settings.chargebackPolicy

  // ── 3. Route to the appropriate handler ─────────────────────────────────
  if (policy === 'BUSINESS_ABSORBS') {
    return handleBusinessAbsorbs(tipTxn, tipTransactions)
  }

  return handleEmployeeChargeback(tipTxn, tipTransactions, settings, memo)
}

// ─── Policy Handlers ─────────────────────────────────────────────────────────

/**
 * BUSINESS_ABSORBS: Soft-delete the TipTransaction(s). The tip stays in
 * each employee's ledger. No DEBIT entries are created.
 */
async function handleBusinessAbsorbs(
  primaryTxn: TipTransactionRecord,
  allTxns: TipTransactionRecord[]
): Promise<ChargebackResult> {
  // Soft-delete all TipTransactions for this payment
  const txnIds = allTxns.map((t) => t.id)
  await db.tipTransaction.updateMany({
    where: { id: { in: txnIds } },
    data: { deletedAt: new Date() },
  })

  return {
    policy: 'BUSINESS_ABSORBS',
    tipTransactionId: primaryTxn.id,
    originalTipCents: Number(primaryTxn.amountCents),
    chargedBackCents: 0,
    flaggedForReviewCents: 0,
    tipDebtIds: [],
    entries: [],
  }
}

/**
 * EMPLOYEE_CHARGEBACK: Find all CREDIT entries from the original allocation
 * and create proportional DEBIT entries to reverse them.
 *
 * If allowNegativeBalances is false, each debit is capped at the employee's
 * current balance. The difference goes into flaggedForReviewCents.
 */
async function handleEmployeeChargeback(
  primaryTxn: TipTransactionRecord,
  allTxns: TipTransactionRecord[],
  settings: TipBankSettings,
  memo?: string
): Promise<ChargebackResult> {
  const txnIds = allTxns.map((t) => t.id)

  // ── Find all CREDIT entries that were created by the original allocation ──
  // The allocation writes entries with sourceId = tipTransaction.id and
  // sourceType IN ['DIRECT_TIP', 'TIP_GROUP'].
  const creditEntries = await db.tipLedgerEntry.findMany({
    where: {
      sourceId: { in: txnIds },
      sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
      type: 'CREDIT',
      deletedAt: null,
    },
  })

  const resultEntries: ChargebackResult['entries'] = []
  let totalChargedBack = 0
  let totalFlaggedForReview = 0

  // ── Create a DEBIT for each CREDIT entry ──────────────────────────────
  for (const credit of creditEntries) {
    // The credit amountCents is stored as a positive signed value
    const originalCreditCents = Number(credit.amountCents)

    // Skip zero or negative entries (should not happen, but be safe)
    if (originalCreditCents <= 0) continue

    let debitCents = originalCreditCents
    let cappedAtBalance = false

    // If negative balances are not allowed, cap at current balance
    if (!settings.allowNegativeBalances) {
      const balance = await getLedgerBalance(credit.employeeId)
      const currentBalance = balance?.currentBalanceCents ?? 0

      if (currentBalance < debitCents) {
        // Cap the debit: can only take what the employee has
        const cappedDebit = Math.max(0, currentBalance)
        const remainder = debitCents - cappedDebit
        totalFlaggedForReview += remainder
        debitCents = cappedDebit
        cappedAtBalance = true
      }
    }

    // Skip if nothing to debit (employee balance is 0 or negative)
    if (debitCents <= 0) {
      totalFlaggedForReview += originalCreditCents
      resultEntries.push({
        employeeId: credit.employeeId,
        amountCents: 0,
        ledgerEntryId: '',
        cappedAtBalance: true,
      })
      continue
    }

    // Post the DEBIT using the standard ledger function
    const chargebackMemo =
      memo ??
      `Chargeback: payment voided/refunded (TipTransaction ${primaryTxn.id})`

    const ledgerResult = await postToTipLedger({
      locationId: credit.locationId,
      employeeId: credit.employeeId,
      amountCents: debitCents,
      type: 'DEBIT',
      sourceType: 'CHARGEBACK',
      sourceId: primaryTxn.id,
      orderId: primaryTxn.orderId,
      memo: chargebackMemo,
    })

    totalChargedBack += debitCents

    resultEntries.push({
      employeeId: credit.employeeId,
      amountCents: debitCents,
      ledgerEntryId: ledgerResult.id,
      cappedAtBalance,
    })
  }

  // ── Create TipDebt records for uncollectable remainders ────────────────
  // Aggregate remainder per employee (one employee may have multiple credits)
  const tipDebtIds: string[] = []
  if (totalFlaggedForReview > 0) {
    const remainderByEmployee = new Map<string, number>()
    for (const entry of resultEntries) {
      if (entry.cappedAtBalance) {
        // Find the original credit for this employee to calculate their remainder
        const originalCredits = creditEntries.filter(
          (c) => c.employeeId === entry.employeeId
        )
        const totalOriginal = originalCredits.reduce(
          (sum, c) => sum + Number(c.amountCents),
          0
        )
        const totalDebited = resultEntries
          .filter((e) => e.employeeId === entry.employeeId)
          .reduce((sum, e) => sum + e.amountCents, 0)
        const remainder = totalOriginal - totalDebited
        if (remainder > 0) {
          remainderByEmployee.set(entry.employeeId, remainder)
        }
      }
    }

    for (const [empId, remainderCents] of remainderByEmployee) {
      const tipDebt = await db.tipDebt.create({
        data: {
          locationId: primaryTxn.locationId,
          employeeId: empId,
          originalAmountCents: remainderCents,
          remainingCents: remainderCents,
          sourcePaymentId: primaryTxn.paymentId ?? primaryTxn.id,
          sourceType: 'CHARGEBACK',
          memo: `Chargeback remainder from payment ${primaryTxn.paymentId ?? primaryTxn.id}`,
          status: 'open',
        },
      })
      tipDebtIds.push(tipDebt.id)
    }
  }

  // ── Soft-delete all TipTransactions for this payment ──────────────────
  await db.tipTransaction.updateMany({
    where: { id: { in: txnIds } },
    data: { deletedAt: new Date() },
  })

  return {
    policy: 'EMPLOYEE_CHARGEBACK',
    tipTransactionId: primaryTxn.id,
    originalTipCents: Number(primaryTxn.amountCents),
    chargedBackCents: totalChargedBack,
    flaggedForReviewCents: totalFlaggedForReview,
    tipDebtIds,
    entries: resultEntries,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the TipBankSettings from a location's JSON settings field.
 * Returns safe defaults if the field is missing or malformed.
 */
export async function getLocationTipBankSettings(
  locationId: string
): Promise<TipBankSettings> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location?.settings) {
    return DEFAULT_SETTINGS.tipBank
  }

  const raw = location.settings as Record<string, unknown>
  const tipBank = raw.tipBank as Partial<TipBankSettings> | undefined

  if (!tipBank) {
    return DEFAULT_SETTINGS.tipBank
  }

  // Merge with defaults so every field is guaranteed present
  return {
    ...DEFAULT_SETTINGS.tipBank,
    ...tipBank,
    tipGuide: {
      ...DEFAULT_SETTINGS.tipBank.tipGuide,
      ...(tipBank.tipGuide || {}),
    },
  }
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/**
 * Shape of a TipTransaction row returned by Prisma findMany.
 * Kept internal — callers use the public ChargebackResult interface.
 */
interface TipTransactionRecord {
  id: string
  locationId: string
  orderId: string
  paymentId: string | null
  tipGroupId: string | null
  segmentId: string | null
  amountCents: number | { toNumber(): number } // Prisma Decimal or number
  sourceType: string
  collectedAt: Date
  primaryEmployeeId: string | null
  createdAt: Date
  deletedAt: Date | null
  syncedAt: Date | null
}
