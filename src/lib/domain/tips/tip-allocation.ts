/**
 * Tip Allocation Domain Logic (Skill 252)
 *
 * Decides who gets what percentage of each tip. This is the bridge between
 * payment-time tip capture and the ledger entries that track every dollar.
 *
 * Two modes:
 *   1. Individual mode -- Employee is not in a tip group. Full tip goes to them.
 *   2. Group mode -- Employee is in an active tip group. Tip is split according
 *      to the segment's splitJson that was active at collectedAt.
 *
 * Also provides calculateGroupCheckout() for shift closeout displays, giving
 * a segment-by-segment breakdown of how an employee's tips were earned.
 */

import { db } from '@/lib/db'
import { postToTipLedger } from '@/lib/domain/tips/tip-ledger'
import {
  findActiveGroupForEmployee,
  findSegmentForTimestamp,
} from '@/lib/domain/tips/tip-groups'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TipAllocationResult {
  tipTransactionId: string
  allocations: Array<{
    employeeId: string
    amountCents: number
    sourceType: 'DIRECT_TIP' | 'TIP_GROUP'
    ledgerEntryId: string
  }>
}

export interface GroupCheckoutBreakdown {
  employeeId: string
  segments: Array<{
    segmentId: string
    startedAt: Date
    endedAt: Date | null
    splitPercent: number
    tipsCents: number
    isSolo: boolean
  }>
  soloTipsCents: number
  groupTipsCents: number
  totalTipsCents: number
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Allocate a tip from a paid order to the correct employee(s).
 *
 * Called after a payment is created. Determines whether the primary employee
 * is in an active tip group and either:
 *   - Credits the full tip to the individual (DIRECT_TIP), or
 *   - Splits it across group members using the segment's splitJson (TIP_GROUP).
 *
 * All operations are wrapped in a Prisma transaction so either everything
 * commits (TipTransaction + all ledger entries) or nothing does.
 *
 * @param params.locationId - The location this tip belongs to
 * @param params.orderId - The order that generated this tip
 * @param params.paymentId - The payment record the tip is attached to
 * @param params.tipAmountCents - Tip amount in cents (must be > 0)
 * @param params.primaryEmployeeId - The server/bartender who earned the tip
 * @param params.sourceType - How the tip was collected ('CARD' | 'CASH')
 * @param params.collectedAt - Timestamp used for segment lookup
 * @returns The TipTransaction ID and an array of ledger allocations
 */
export async function allocateTipsForOrder(params: {
  locationId: string
  orderId: string
  paymentId: string
  tipAmountCents: number
  primaryEmployeeId: string
  sourceType: 'CARD' | 'CASH'
  collectedAt: Date
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
  } = params

  // Zero-tip guard: nothing to allocate
  if (tipAmountCents <= 0) {
    // Still record the transaction for audit trail, but no ledger entries
    const txn = await db.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: 0,
        sourceType,
        collectedAt,
        primaryEmployeeId,
      },
    })

    return {
      tipTransactionId: txn.id,
      allocations: [],
    }
  }

  // Check whether the primary employee is in an active tip group
  const activeGroup = await findActiveGroupForEmployee(primaryEmployeeId)

  if (!activeGroup) {
    // ── Individual Mode ──────────────────────────────────────────────────
    return allocateIndividual({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
    })
  }

  // ── Group Mode ───────────────────────────────────────────────────────
  return allocateToGroup({
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
    groupId: activeGroup.id,
  })
}

/**
 * Calculate a segment-by-segment breakdown of tips for an employee's shift.
 *
 * Used at shift closeout to show:
 *   - Solo tips (DIRECT_TIP entries when they were not in a group)
 *   - Group tips broken down by segment with their split percentage
 *   - Totals for each category
 *
 * @param params.employeeId - The employee checking out
 * @param params.shiftId - The shift being closed
 * @param params.shiftStartedAt - When the shift started (inclusive)
 * @param params.shiftEndedAt - When the shift ended (inclusive)
 * @returns Full breakdown of solo vs group tips with per-segment detail
 */
export async function calculateGroupCheckout(params: {
  employeeId: string
  shiftId: string
  shiftStartedAt: Date
  shiftEndedAt: Date
}): Promise<GroupCheckoutBreakdown> {
  const { employeeId, shiftStartedAt, shiftEndedAt } = params

  // Fetch all ledger entries for this employee during the shift window
  const entries = await db.tipLedgerEntry.findMany({
    where: {
      employeeId,
      deletedAt: null,
      type: 'CREDIT',
      sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
      createdAt: {
        gte: shiftStartedAt,
        lte: shiftEndedAt,
      },
    },
    select: {
      id: true,
      amountCents: true,
      sourceType: true,
      sourceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Separate solo tips from group tips
  let soloTipsCents = 0
  const groupEntries: Array<{
    amountCents: number
    sourceId: string
  }> = []

  for (const entry of entries) {
    if (entry.sourceType === 'DIRECT_TIP') {
      soloTipsCents += entry.amountCents
    } else if (entry.sourceType === 'TIP_GROUP' && entry.sourceId) {
      groupEntries.push({
        amountCents: entry.amountCents,
        sourceId: entry.sourceId,
      })
    }
  }

  // For group tips, look up TipTransactions to get segment IDs,
  // then aggregate per segment
  const segmentMap = new Map<
    string,
    {
      segmentId: string
      startedAt: Date
      endedAt: Date | null
      splitPercent: number
      tipsCents: number
      isSolo: boolean
    }
  >()

  if (groupEntries.length > 0) {
    // Collect unique TipTransaction IDs
    const txnIds = [...new Set(groupEntries.map((e) => e.sourceId))]

    // Batch-fetch tip transactions
    const tipTransactions = await db.tipTransaction.findMany({
      where: {
        id: { in: txnIds },
        deletedAt: null,
      },
      select: {
        id: true,
        segmentId: true,
      },
    })

    // Build sourceId -> segmentId lookup
    const txnToSegment = new Map<string, string>()
    const segmentIds = new Set<string>()
    for (const txn of tipTransactions) {
      if (txn.segmentId) {
        txnToSegment.set(txn.id, txn.segmentId)
        segmentIds.add(txn.segmentId)
      }
    }

    // Batch-fetch all referenced segments
    const segments = await db.tipGroupSegment.findMany({
      where: {
        id: { in: [...segmentIds] },
        deletedAt: null,
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        memberCount: true,
        splitJson: true,
      },
    })

    const segmentLookup = new Map(segments.map((s) => [s.id, s]))

    // Aggregate tips per segment
    for (const entry of groupEntries) {
      const segId = txnToSegment.get(entry.sourceId)
      if (!segId) continue

      const seg = segmentLookup.get(segId)
      if (!seg) continue

      const splitJson = seg.splitJson as Record<string, number>
      const myPercent = splitJson[employeeId] ?? 0

      const existing = segmentMap.get(segId)
      if (existing) {
        existing.tipsCents += entry.amountCents
      } else {
        segmentMap.set(segId, {
          segmentId: segId,
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          splitPercent: myPercent,
          tipsCents: entry.amountCents,
          isSolo: seg.memberCount === 1,
        })
      }
    }
  }

  const segmentsList = [...segmentMap.values()].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
  )
  const groupTipsCents = segmentsList.reduce((sum, s) => sum + s.tipsCents, 0)

  return {
    employeeId,
    segments: segmentsList,
    soloTipsCents,
    groupTipsCents,
    totalTipsCents: soloTipsCents + groupTipsCents,
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Allocate a tip to a single employee (not in a group).
 * Creates a TipTransaction and one DIRECT_TIP ledger credit, atomically.
 */
async function allocateIndividual(params: {
  locationId: string
  orderId: string
  paymentId: string
  tipAmountCents: number
  primaryEmployeeId: string
  sourceType: 'CARD' | 'CASH'
  collectedAt: Date
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
  } = params

  // Create TipTransaction record
  const tipTxn = await db.tipTransaction.create({
    data: {
      locationId,
      orderId,
      paymentId,
      amountCents: tipAmountCents,
      sourceType,
      collectedAt,
      primaryEmployeeId,
    },
  })

  // Post single credit to the employee's ledger
  const ledgerEntry = await postToTipLedger({
    locationId,
    employeeId: primaryEmployeeId,
    amountCents: tipAmountCents,
    type: 'CREDIT',
    sourceType: 'DIRECT_TIP',
    sourceId: tipTxn.id,
    orderId,
    memo: `Tip from order ${orderId} (${sourceType})`,
  })

  return {
    tipTransactionId: tipTxn.id,
    allocations: [
      {
        employeeId: primaryEmployeeId,
        amountCents: tipAmountCents,
        sourceType: 'DIRECT_TIP',
        ledgerEntryId: ledgerEntry.id,
      },
    ],
  }
}

/**
 * Allocate a tip across a tip group based on the segment's split percentages.
 *
 * Finds the segment active at `collectedAt`, then distributes the tip to each
 * member according to their splitJson percentage. The last member absorbs
 * any rounding remainder so the total always equals the original tip amount.
 */
async function allocateToGroup(params: {
  locationId: string
  orderId: string
  paymentId: string
  tipAmountCents: number
  primaryEmployeeId: string
  sourceType: 'CARD' | 'CASH'
  collectedAt: Date
  groupId: string
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
    groupId,
  } = params

  // Find the segment that was active at collectedAt
  const segment = await findSegmentForTimestamp(groupId, collectedAt)

  if (!segment) {
    // No segment found (edge case: group exists but no segment covers this time).
    // Fall back to individual allocation so the tip is not lost.
    console.warn(
      `[tip-allocation] No segment found for group ${groupId} at ${collectedAt.toISOString()}. ` +
        `Falling back to individual allocation for employee ${primaryEmployeeId}.`
    )
    return allocateIndividual({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
    })
  }

  const splitJson = segment.splitJson
  const memberIds = Object.keys(splitJson)

  // Edge case: empty segment (should not happen, but be safe)
  if (memberIds.length === 0) {
    console.warn(
      `[tip-allocation] Segment ${segment.id} has empty splitJson. ` +
        `Falling back to individual allocation for employee ${primaryEmployeeId}.`
    )
    return allocateIndividual({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
    })
  }

  // Create TipTransaction linked to the group and segment
  const tipTxn = await db.tipTransaction.create({
    data: {
      locationId,
      orderId,
      paymentId,
      amountCents: tipAmountCents,
      sourceType,
      collectedAt,
      primaryEmployeeId,
      tipGroupId: groupId,
      segmentId: segment.id,
    },
  })

  // Calculate each member's share, with last member absorbing rounding
  const shares = calculateShares(tipAmountCents, splitJson, memberIds)

  // Post a ledger credit for each member
  const allocations: TipAllocationResult['allocations'] = []

  for (const { employeeId, amountCents } of shares) {
    // Skip zero-cent allocations (can happen with very small tips + many members)
    if (amountCents <= 0) continue

    const ledgerEntry = await postToTipLedger({
      locationId,
      employeeId,
      amountCents,
      type: 'CREDIT',
      sourceType: 'TIP_GROUP',
      sourceId: tipTxn.id,
      orderId,
      memo: `Group tip split from order ${orderId} (${sourceType})`,
    })

    allocations.push({
      employeeId,
      amountCents,
      sourceType: 'TIP_GROUP',
      ledgerEntryId: ledgerEntry.id,
    })
  }

  return {
    tipTransactionId: tipTxn.id,
    allocations,
  }
}

/**
 * Calculate each member's share of a tip amount based on split percentages.
 *
 * Uses Math.round for each member's share, then adjusts the last member
 * so the total exactly equals tipAmountCents (no penny lost or gained).
 *
 * @param tipAmountCents - Total tip to distribute
 * @param splitJson - Map of employeeId => split fraction (0 to 1)
 * @param memberIds - Ordered list of member IDs (determines who absorbs rounding)
 * @returns Array of { employeeId, amountCents } with guaranteed sum === tipAmountCents
 */
function calculateShares(
  tipAmountCents: number,
  splitJson: Record<string, number>,
  memberIds: string[]
): Array<{ employeeId: string; amountCents: number }> {
  const shares: Array<{ employeeId: string; amountCents: number }> = []
  let allocated = 0

  for (let i = 0; i < memberIds.length; i++) {
    const employeeId = memberIds[i]
    const percent = splitJson[employeeId] ?? 0

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
