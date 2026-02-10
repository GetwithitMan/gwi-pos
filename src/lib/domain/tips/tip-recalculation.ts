/**
 * Tip Recalculation & Manager Adjustment Engine (Skill 256)
 *
 * When group membership changes, ownership splits change, or a manager needs
 * to manually adjust tips, the existing ledger entries may no longer reflect
 * the correct distribution. This module provides:
 *
 *   1. performTipAdjustment()          -- Manual manager adjustment with arbitrary deltas
 *   2. recalculateGroupAllocations()   -- Re-derive group tip splits from current segments
 *   3. recalculateOrderAllocations()   -- Re-derive order tip splits from current ownership
 *   4. getAdjustmentHistory()          -- Paginated audit log of all adjustments
 *
 * All delta entries are posted via postToTipLedger() so the cached balance on
 * TipLedger stays accurate and every entry is immutable and traceable.
 *
 * IMPORTANT: postToTipLedger() uses an internal db.$transaction(), so it must
 * NOT be called from within another db.$transaction() block. All functions in
 * this module call postToTipLedger() sequentially outside of transactions.
 */

import { db } from '@/lib/db'
import { postToTipLedger } from './tip-ledger'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdjustmentType =
  | 'group_membership'
  | 'ownership_split'
  | 'clock_fix'
  | 'manual_override'
  | 'tip_amount'

export interface AdjustmentContext {
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface AdjustmentResult {
  adjustmentId: string
  adjustmentType: AdjustmentType
  reason: string
  autoRecalcRan: boolean
  deltaEntries: Array<{
    employeeId: string
    type: 'CREDIT' | 'DEBIT'
    amountCents: number
    ledgerEntryId: string
  }>
}

export interface RecalculationResult {
  adjustmentId: string
  deltaEntries: Array<{
    employeeId: string
    previousCents: number
    newCents: number
    deltaCents: number
    ledgerEntryId: string
  }>
}

export interface AdjustmentRecord {
  id: string
  createdById: string
  reason: string
  adjustmentType: string
  contextJson: string
  autoRecalcRan: boolean
  createdAt: Date
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Perform a manual tip adjustment with explicit employee deltas.
 *
 * A manager specifies which employees gain or lose cents, along with a reason
 * and contextual before/after state. Each positive delta becomes a CREDIT entry
 * and each negative delta becomes a DEBIT entry on the employee's tip ledger.
 *
 * @param params.locationId - The location this adjustment applies to
 * @param params.managerId - The manager performing the adjustment
 * @param params.adjustmentType - Category of adjustment for audit trail
 * @param params.reason - Human-readable reason for the adjustment
 * @param params.context - Before/after state snapshot for audit trail
 * @param params.employeeDeltas - Array of { employeeId, deltaCents } changes to apply
 * @returns The created adjustment record and all ledger entries
 */
export async function performTipAdjustment(params: {
  locationId: string
  managerId: string
  adjustmentType: AdjustmentType
  reason: string
  context: AdjustmentContext
  employeeDeltas?: Array<{ employeeId: string; deltaCents: number }>
}): Promise<AdjustmentResult> {
  const { locationId, managerId, adjustmentType, reason, context, employeeDeltas } = params

  // 1. Create the TipAdjustment record
  const adjustment = await db.tipAdjustment.create({
    data: {
      locationId,
      createdById: managerId,
      reason,
      adjustmentType,
      contextJson: JSON.stringify(context),
      autoRecalcRan: false,
    },
  })

  // 2. Post ledger entries for each delta (sequentially — postToTipLedger uses internal $transaction)
  const deltaEntries: AdjustmentResult['deltaEntries'] = []

  if (employeeDeltas && employeeDeltas.length > 0) {
    for (const delta of employeeDeltas) {
      // Skip zero deltas
      if (delta.deltaCents === 0) continue

      const type: 'CREDIT' | 'DEBIT' = delta.deltaCents > 0 ? 'CREDIT' : 'DEBIT'

      const ledgerEntry = await postToTipLedger({
        locationId,
        employeeId: delta.employeeId,
        amountCents: Math.abs(delta.deltaCents),
        type,
        sourceType: 'ADJUSTMENT',
        adjustmentId: adjustment.id,
        memo: `Manager adjustment: ${reason}`,
      })

      deltaEntries.push({
        employeeId: delta.employeeId,
        type,
        amountCents: ledgerEntry.amountCents,
        ledgerEntryId: ledgerEntry.id,
      })
    }
  }

  return {
    adjustmentId: adjustment.id,
    adjustmentType,
    reason,
    autoRecalcRan: false,
    deltaEntries,
  }
}

/**
 * Recalculate tip group allocations based on the current segment split percentages.
 *
 * When a group's membership or split percentages change (e.g., an employee joins
 * or leaves), the existing ledger entries may no longer reflect the correct
 * distribution. This function:
 *   1. Loads all TipTransactions for the group (optionally filtered by segment)
 *   2. Recalculates what each member SHOULD have received per current splitJson
 *   3. Compares against what was actually credited (existing TIP_GROUP entries)
 *   4. Posts corrective delta entries to bring each employee's allocation in line
 *
 * @param params.locationId - The location this group belongs to
 * @param params.managerId - The manager triggering the recalculation
 * @param params.groupId - The tip group to recalculate
 * @param params.segmentId - Optional: only recalculate for a specific segment
 * @param params.reason - Human-readable reason for the recalculation
 * @returns The adjustment record and all corrective delta entries
 */
export async function recalculateGroupAllocations(params: {
  locationId: string
  managerId: string
  groupId: string
  segmentId?: string
  reason: string
}): Promise<RecalculationResult> {
  const { locationId, managerId, groupId, segmentId, reason } = params

  // 1. Load the TipGroup with segments
  const group = await db.tipGroup.findFirst({
    where: {
      id: groupId,
      deletedAt: null,
    },
    include: {
      segments: {
        where: {
          deletedAt: null,
          ...(segmentId ? { id: segmentId } : {}),
        },
        orderBy: { startedAt: 'asc' },
      },
    },
  })

  if (!group) {
    throw new Error('TIP_GROUP_NOT_FOUND')
  }

  // 2. Load all TipTransactions for this group (filter by segmentId if provided)
  const transactionWhere: Record<string, unknown> = {
    tipGroupId: groupId,
    deletedAt: null,
  }
  if (segmentId) {
    transactionWhere.segmentId = segmentId
  }

  const transactions = await db.tipTransaction.findMany({
    where: transactionWhere,
    orderBy: { collectedAt: 'asc' },
  })

  // Build a segment lookup: segmentId -> splitJson
  const segmentLookup = new Map<string, Record<string, number>>()
  for (const seg of group.segments) {
    segmentLookup.set(seg.id, seg.splitJson as Record<string, number>)
  }

  // 3. For each transaction, calculate what each member SHOULD have received
  //    and compare with what they actually received
  const employeeDeltaMap = new Map<string, { previousCents: number; newCents: number }>()

  for (const txn of transactions) {
    if (!txn.segmentId || txn.amountCents <= 0) continue

    const splitJson = segmentLookup.get(txn.segmentId)
    if (!splitJson) continue

    const memberIds = Object.keys(splitJson)
    if (memberIds.length === 0) continue

    // Calculate what each member SHOULD receive from this transaction
    const expectedShares = calculateShares(txn.amountCents, splitJson, memberIds)

    // Find what each member ACTUALLY received (existing CREDIT entries for this transaction)
    const existingEntries = await db.tipLedgerEntry.findMany({
      where: {
        sourceType: 'TIP_GROUP',
        sourceId: txn.id,
        deletedAt: null,
      },
      select: { employeeId: true, amountCents: true },
    })

    // Build actual-received map (amountCents is signed: positive for CREDIT)
    const actualMap = new Map<string, number>()
    for (const entry of existingEntries) {
      const current = actualMap.get(entry.employeeId) || 0
      actualMap.set(entry.employeeId, current + entry.amountCents)
    }

    // Accumulate deltas per employee across all transactions
    for (const share of expectedShares) {
      const actual = actualMap.get(share.employeeId) || 0
      const existing = employeeDeltaMap.get(share.employeeId) || { previousCents: 0, newCents: 0 }
      existing.previousCents += actual
      existing.newCents += share.amountCents
      employeeDeltaMap.set(share.employeeId, existing)
    }

    // Also account for employees who received credits but are no longer in the expected shares
    for (const [empId, actualCents] of actualMap) {
      if (!expectedShares.some((s) => s.employeeId === empId)) {
        const existing = employeeDeltaMap.get(empId) || { previousCents: 0, newCents: 0 }
        existing.previousCents += actualCents
        // newCents stays 0 for this employee (they should no longer receive anything)
        employeeDeltaMap.set(empId, existing)
      }
    }
  }

  // 4. Build before/after context for audit trail
  const beforeState: Record<string, number> = {}
  const afterState: Record<string, number> = {}
  for (const [empId, data] of employeeDeltaMap) {
    beforeState[empId] = data.previousCents
    afterState[empId] = data.newCents
  }

  // 5. Create TipAdjustment record
  const adjustment = await db.tipAdjustment.create({
    data: {
      locationId,
      createdById: managerId,
      reason,
      adjustmentType: 'group_membership',
      contextJson: JSON.stringify({
        before: { groupId, allocations: beforeState },
        after: { groupId, allocations: afterState },
      }),
      autoRecalcRan: true,
    },
  })

  // 6. Post delta entries for employees whose allocation changed
  const deltaEntries: RecalculationResult['deltaEntries'] = []

  for (const [employeeId, data] of employeeDeltaMap) {
    const deltaCents = data.newCents - data.previousCents
    if (deltaCents === 0) continue

    const type: 'CREDIT' | 'DEBIT' = deltaCents > 0 ? 'CREDIT' : 'DEBIT'

    const ledgerEntry = await postToTipLedger({
      locationId,
      employeeId,
      amountCents: Math.abs(deltaCents),
      type,
      sourceType: 'ADJUSTMENT',
      adjustmentId: adjustment.id,
      memo: `Group recalculation: ${reason}`,
    })

    deltaEntries.push({
      employeeId,
      previousCents: data.previousCents,
      newCents: data.newCents,
      deltaCents,
      ledgerEntryId: ledgerEntry.id,
    })
  }

  return {
    adjustmentId: adjustment.id,
    deltaEntries,
  }
}

/**
 * Recalculate order-level tip allocations based on the current ownership splits.
 *
 * When an order's ownership changes (e.g., a server is added or removed, or
 * split percentages are adjusted), the existing ledger entries may no longer
 * reflect the correct distribution. This function:
 *   1. Loads the active OrderOwnership for the order
 *   2. Loads all TipTransactions for the order
 *   3. Recalculates what each owner SHOULD have received per current share percents
 *   4. Compares against what was actually credited (existing DIRECT_TIP entries)
 *   5. Posts corrective delta entries
 *
 * @param params.locationId - The location this order belongs to
 * @param params.managerId - The manager triggering the recalculation
 * @param params.orderId - The order to recalculate tips for
 * @param params.reason - Human-readable reason for the recalculation
 * @returns The adjustment record and all corrective delta entries
 */
export async function recalculateOrderAllocations(params: {
  locationId: string
  managerId: string
  orderId: string
  reason: string
}): Promise<RecalculationResult> {
  const { locationId, managerId, orderId, reason } = params

  // 1. Load the active OrderOwnership for this order
  const ownership = await db.orderOwnership.findFirst({
    where: {
      orderId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      owners: {
        select: {
          employeeId: true,
          sharePercent: true,
        },
      },
    },
  })

  if (!ownership || ownership.owners.length === 0) {
    throw new Error('NO_ACTIVE_OWNERSHIP')
  }

  // Build ownership split: employeeId -> fraction (0 to 1)
  const ownerSplits: Record<string, number> = {}
  for (const owner of ownership.owners) {
    ownerSplits[owner.employeeId] = owner.sharePercent / 100
  }
  const ownerIds = Object.keys(ownerSplits)

  // 2. Load all TipTransactions for this order
  const transactions = await db.tipTransaction.findMany({
    where: {
      orderId,
      deletedAt: null,
    },
    orderBy: { collectedAt: 'asc' },
  })

  // 3. For each transaction, calculate what each owner SHOULD have received
  //    and compare with what they actually received
  const employeeDeltaMap = new Map<string, { previousCents: number; newCents: number }>()

  for (const txn of transactions) {
    if (txn.amountCents <= 0) continue

    // Calculate expected shares based on current ownership
    const expectedShares = calculateShares(txn.amountCents, ownerSplits, ownerIds)

    // Find what each employee ACTUALLY received for this transaction
    // Look for DIRECT_TIP entries linked to this order with sourceId matching the transaction
    const existingEntries = await db.tipLedgerEntry.findMany({
      where: {
        sourceType: 'DIRECT_TIP',
        orderId,
        sourceId: txn.id,
        deletedAt: null,
      },
      select: { employeeId: true, amountCents: true },
    })

    // Build actual-received map
    const actualMap = new Map<string, number>()
    for (const entry of existingEntries) {
      const current = actualMap.get(entry.employeeId) || 0
      actualMap.set(entry.employeeId, current + entry.amountCents)
    }

    // Accumulate deltas per employee across all transactions
    for (const share of expectedShares) {
      const actual = actualMap.get(share.employeeId) || 0
      const existing = employeeDeltaMap.get(share.employeeId) || { previousCents: 0, newCents: 0 }
      existing.previousCents += actual
      existing.newCents += share.amountCents
      employeeDeltaMap.set(share.employeeId, existing)
    }

    // Account for employees who received credits but are no longer owners
    for (const [empId, actualCents] of actualMap) {
      if (!expectedShares.some((s) => s.employeeId === empId)) {
        const existing = employeeDeltaMap.get(empId) || { previousCents: 0, newCents: 0 }
        existing.previousCents += actualCents
        employeeDeltaMap.set(empId, existing)
      }
    }
  }

  // 4. Build before/after context for audit trail
  const beforeState: Record<string, number> = {}
  const afterState: Record<string, number> = {}
  for (const [empId, data] of employeeDeltaMap) {
    beforeState[empId] = data.previousCents
    afterState[empId] = data.newCents
  }

  // 5. Create TipAdjustment record
  const adjustment = await db.tipAdjustment.create({
    data: {
      locationId,
      createdById: managerId,
      reason,
      adjustmentType: 'ownership_split',
      contextJson: JSON.stringify({
        before: { orderId, allocations: beforeState },
        after: { orderId, allocations: afterState, ownerSplits },
      }),
      autoRecalcRan: true,
    },
  })

  // 6. Post delta entries for employees whose allocation changed
  const deltaEntries: RecalculationResult['deltaEntries'] = []

  for (const [employeeId, data] of employeeDeltaMap) {
    const deltaCents = data.newCents - data.previousCents
    if (deltaCents === 0) continue

    const type: 'CREDIT' | 'DEBIT' = deltaCents > 0 ? 'CREDIT' : 'DEBIT'

    const ledgerEntry = await postToTipLedger({
      locationId,
      employeeId,
      amountCents: Math.abs(deltaCents),
      type,
      sourceType: 'ADJUSTMENT',
      adjustmentId: adjustment.id,
      orderId,
      memo: `Order ownership recalculation: ${reason}`,
    })

    deltaEntries.push({
      employeeId,
      previousCents: data.previousCents,
      newCents: data.newCents,
      deltaCents,
      ledgerEntryId: ledgerEntry.id,
    })
  }

  return {
    adjustmentId: adjustment.id,
    deltaEntries,
  }
}

/**
 * Get paginated adjustment history with optional filters.
 *
 * Returns TipAdjustment records for audit and review purposes. Supports
 * filtering by adjustment type and date range.
 *
 * @param params.locationId - The location to query adjustments for
 * @param params.limit - Maximum records to return (default: 50)
 * @param params.offset - Number of records to skip (default: 0)
 * @param params.adjustmentType - Optional filter by adjustment type
 * @param params.dateFrom - Optional start date (inclusive)
 * @param params.dateTo - Optional end date (inclusive)
 * @returns Paginated list of adjustment records and total count
 */
export async function getAdjustmentHistory(params: {
  locationId: string
  limit?: number
  offset?: number
  adjustmentType?: AdjustmentType
  dateFrom?: Date
  dateTo?: Date
}): Promise<{ adjustments: AdjustmentRecord[]; total: number }> {
  const { locationId, limit = 50, offset = 0, adjustmentType, dateFrom, dateTo } = params

  const where: Record<string, unknown> = {
    locationId,
    deletedAt: null,
  }

  if (adjustmentType) {
    where.adjustmentType = adjustmentType
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

  const [adjustments, total] = await db.$transaction([
    db.tipAdjustment.findMany({
      where,
      select: {
        id: true,
        createdById: true,
        reason: true,
        adjustmentType: true,
        contextJson: true,
        autoRecalcRan: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.tipAdjustment.count({ where }),
  ])

  return { adjustments, total }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Calculate each member's share of a tip amount based on split fractions.
 *
 * Uses Math.round for each member's share, then adjusts the last member
 * so the total exactly equals tipAmountCents (no penny lost or gained).
 *
 * @param tipAmountCents - Total tip to distribute
 * @param splitMap - Map of employeeId => split fraction (0 to 1)
 * @param memberIds - Ordered list of member IDs (determines who absorbs rounding)
 * @returns Array of { employeeId, amountCents } with guaranteed sum === tipAmountCents
 */
function calculateShares(
  tipAmountCents: number,
  splitMap: Record<string, number>,
  memberIds: string[]
): Array<{ employeeId: string; amountCents: number }> {
  const shares: Array<{ employeeId: string; amountCents: number }> = []
  let allocated = 0

  for (let i = 0; i < memberIds.length; i++) {
    const employeeId = memberIds[i]
    const percent = splitMap[employeeId] ?? 0

    if (i === memberIds.length - 1) {
      // Last member absorbs rounding remainder
      shares.push({
        employeeId,
        amountCents: tipAmountCents - allocated,
      })
    } else {
      const share = Math.round(tipAmountCents * percent)
      shares.push({ employeeId, amountCents: share })
      allocated += share
    }
  }

  return shares
}
