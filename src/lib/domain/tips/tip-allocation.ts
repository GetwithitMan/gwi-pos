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
import { EmployeeRepository, OrderRepository } from '@/lib/repositories'
import { postToTipLedger, dollarsToCents } from '@/lib/domain/tips/tip-ledger'
import type { TxClient } from '@/lib/domain/tips/tip-ledger'
import {
  findActiveGroupForEmployee,
  findSegmentForTimestamp,
} from '@/lib/domain/tips/tip-groups'
import type { TipGroupSegmentInfo } from '@/lib/domain/tips/tip-groups'
import {
  getActiveOwnership,
  adjustAllocationsByOwnership,
} from '@/lib/domain/tips/table-ownership'
import type { OwnershipInfo } from '@/lib/domain/tips/table-ownership'
import type { TipBankSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('tip-allocation')

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch non-voided order items with positive totals for proportional allocation.
 * Used by allocateToGroupProportional() to determine per-segment revenue weights.
 *
 * TODO: Migrate to OrderItemRepository once getItemsForOrderWhere supports select.
 * Needs locationId threaded from allocateToGroupProportional.
 */
async function fetchOrderItemsForAllocation(
  orderId: string,
): Promise<Array<{ itemTotal: number; createdAt: Date }>> {
  const items = await db.orderItem.findMany({
    where: { orderId, deletedAt: null, status: { not: 'voided' }, tipExempt: { not: true } },
    select: { itemTotal: true, createdAt: true },
  })
  return items
    .filter((i) => i.itemTotal !== null && Number(i.itemTotal) > 0)
    .map((i) => ({ itemTotal: Number(i.itemTotal), createdAt: i.createdAt }))
}

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

// ─── Payment Facade ──────────────────────────────────────────────────────────

/**
 * Top-level facade for tip allocation at payment time.
 * Called by the pay route. Handles CC fee deduction, then delegates
 * to allocateTipsForOrder which handles group detection + splits.
 *
 * This is the ONLY function the pay route should call for tips.
 */
export async function allocateTipsForPayment(params: {
  locationId: string
  orderId: string
  primaryEmployeeId: string
  createdPayments: Array<{ id: string; paymentMethod: string; tipAmount: unknown }>
  totalTipsDollars: number
  tipBankSettings: TipBankSettings
  kind?: string  // Skill 277: 'tip' | 'service_charge' | 'auto_gratuity'
}): Promise<TipAllocationResult | null> {
  const {
    locationId,
    orderId,
    primaryEmployeeId,
    createdPayments,
    totalTipsDollars,
    tipBankSettings,
    kind = 'tip',
  } = params

  // Skill 280: Feature flag — skip allocation when tip bank is disabled for this location
  if (!tipBankSettings.enabled) return null

  const tipAmountCents = dollarsToCents(totalTipsDollars)
  if (tipAmountCents <= 0) return null

  // Determine card vs cash tip amounts
  const cardTipDollars = createdPayments
    .filter(p => p.paymentMethod !== 'cash')
    .reduce((sum, p) => sum + Number(p.tipAmount), 0)
  const cardTipCents = dollarsToCents(cardTipDollars)

  // CC Fee Deduction: reduce card tips by processing fee before crediting employee
  let ccFeeAmountCents = 0
  if (
    cardTipCents > 0 &&
    tipBankSettings.deductCCFeeFromTips &&
    tipBankSettings.ccFeePercent > 0
  ) {
    ccFeeAmountCents = Math.round(cardTipCents * tipBankSettings.ccFeePercent / 100)
  }

  const netTipAmountCents = tipAmountCents - ccFeeAmountCents

  // Determine sourceType based on whether card tips exist
  const sourceType: 'CARD' | 'CASH' = cardTipCents > 0 ? 'CARD' : 'CASH'

  // Find a paymentId to link (use the first payment with a tip, or the first payment)
  const paymentWithTip = createdPayments.find(p => Number(p.tipAmount) > 0)
  const paymentId = paymentWithTip?.id || createdPayments[0]?.id || ''

  // Delegate to the allocation pipeline (handles group detection + splits)
  const result = await allocateTipsForOrder({
    locationId,
    orderId,
    paymentId,
    tipAmountCents: netTipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt: new Date(),
    ccFeeAmountCents,
    kind,
  })

  return result
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
  ccFeeAmountCents?: number
  kind?: string  // Skill 277: 'tip' | 'service_charge' | 'auto_gratuity'
  tipBankSettings?: TipBankSettings  // Optional: pass to avoid re-fetching
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
    ccFeeAmountCents,
    kind = 'tip',
    tipBankSettings: providedSettings,
  } = params

  // Primary employee existence guard: if the employee doesn't exist in the DB,
  // downstream ledger inserts will fail on FK constraint and the tip is silently lost.
  // Validate early and log a warning so ops can investigate.
  const primaryEmployee = await EmployeeRepository.getEmployeeByIdWithSelect(
    primaryEmployeeId,
    locationId,
    { id: true },
  )
  if (!primaryEmployee) {
    log.warn({ primaryEmployeeId, orderId }, 'primaryEmployeeId not found in DB — skipping tip allocation to prevent FK constraint failure')
    const txn = await db.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: tipAmountCents,
        sourceType,
        kind,
        collectedAt,
        // primaryEmployeeId is nullable in schema, so omit it when employee doesn't exist
        ccFeeAmountCents: ccFeeAmountCents ?? 0,
        idempotencyKey: `tip-txn:${orderId}:${paymentId}`,
      },
    })
    return { tipTransactionId: txn.id, allocations: [] }
  }

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
        kind,
        collectedAt,
        primaryEmployeeId,
      },
    })

    return {
      tipTransactionId: txn.id,
      allocations: [],
    }
  }

  // ── Idempotency guard (Skill 274) ──────────────────────────────────────────
  // If this order+payment combo was already allocated, return the existing data
  // instead of double-posting. This protects against fire-and-forget retries.
  const idemKey = `tip-txn:${orderId}:${paymentId}`
  const existingTxn = await db.tipTransaction.findFirst({
    where: { idempotencyKey: idemKey, deletedAt: null },
  })
  if (existingTxn) {
    const existingEntries = await db.tipLedgerEntry.findMany({
      where: { sourceId: existingTxn.id, deletedAt: null },
      select: { id: true, employeeId: true, amountCents: true, sourceType: true },
    })
    return {
      tipTransactionId: existingTxn.id,
      allocations: existingEntries.map(e => ({
        employeeId: e.employeeId,
        amountCents: Number(e.amountCents),
        sourceType: e.sourceType as 'DIRECT_TIP' | 'TIP_GROUP',
        ledgerEntryId: e.id,
      })),
    }
  }

  // ── Skill 276: Check for shared table ownership ─────────────────────────
  // If multiple servers co-own this order, split the tip by ownership
  // percentages BEFORE checking for tip groups. Each owner's slice then
  // independently routes through group-or-individual allocation.
  const ownership = await getActiveOwnership(orderId)

  // ── Table Tip Ownership Mode check ─────────────────────────────────────
  // When tableTipOwnershipMode is 'PRIMARY_SERVER_OWNS_ALL' and the order
  // is a dine-in (has tableId), skip ownership-based splitting entirely.
  // The primary server gets 100% of the tip; helpers are paid via tip-out rules.
  let skipOwnership = false
  if (ownership && ownership.owners.length > 1) {
    // Resolve settings: use provided settings or fetch from cache
    let tableTipMode: string = 'ITEM_BASED'
    if (providedSettings) {
      tableTipMode = providedSettings.tableTipOwnershipMode ?? 'ITEM_BASED'
    } else {
      const locationSettings = await getLocationSettings(locationId)
      const parsed = locationSettings ? parseSettings(locationSettings) : null
      tableTipMode = parsed?.tipBank?.tableTipOwnershipMode ?? 'ITEM_BASED'
    }

    if (tableTipMode === 'PRIMARY_SERVER_OWNS_ALL') {
      // Check if the order is table-based (dine-in)
      const order = await OrderRepository.getOrderByIdWithSelect(
        orderId,
        locationId,
        { tableId: true },
      )
      if (order?.tableId) {
        skipOwnership = true
      }
    }
  }

  if (ownership && ownership.owners.length > 1 && !skipOwnership) {
    return allocateWithOwnership({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      ccFeeAmountCents,
      kind,
      ownership,
    })
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
      ccFeeAmountCents,
      kind,
    })
  }

  // ── Proportional per-item allocation (Skill 252+) ────────────────────
  // When tipAttributionTiming is 'per_item', distribute tip proportionally
  // across segments based on when each item was added to the order.
  let resolvedSettings = providedSettings
  if (!resolvedSettings) {
    const locationSettings = await getLocationSettings(locationId)
    const parsed = locationSettings ? parseSettings(locationSettings) : null
    resolvedSettings = parsed?.tipBank ?? undefined
  }
  const timing = resolvedSettings?.tipAttributionTiming ?? 'check_closed'
  if (timing === 'per_item') {
    return allocateToGroupProportional({
      groupId: activeGroup.id,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      locationId,
      sourceType,
      collectedAt,
      ccFeeAmountCents,
      kind,
      idempotencyKey: idemKey,
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
    ccFeeAmountCents,
    kind,
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
    const amt = Number(entry.amountCents)
    if (entry.sourceType === 'DIRECT_TIP') {
      soloTipsCents += amt
    } else if (entry.sourceType === 'TIP_GROUP' && entry.sourceId) {
      groupEntries.push({
        amountCents: amt,
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
 * Skill 276: Allocate a tip across multiple table co-owners.
 *
 * Splits the tip by ownership percentages, then for each owner independently
 * checks whether they are in a tip group:
 *   - If in a group -> delegates that owner's slice to group split logic
 *   - If not in a group -> posts a DIRECT_TIP credit for that owner
 *
 * The entire operation is wrapped in a single $transaction for atomicity.
 * Idempotency keys include the owner suffix to prevent duplicates per owner.
 */
async function allocateWithOwnership(params: {
  locationId: string
  orderId: string
  paymentId: string
  tipAmountCents: number
  primaryEmployeeId: string
  sourceType: 'CARD' | 'CASH'
  collectedAt: Date
  ccFeeAmountCents?: number
  kind?: string
  ownership: OwnershipInfo
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
    ccFeeAmountCents,
    kind = 'tip',
    ownership,
  } = params

  // Use adjustAllocationsByOwnership to split the tip cents by owner percentages
  const ownerSlices = adjustAllocationsByOwnership(
    [{ employeeId: primaryEmployeeId, amountCents: tipAmountCents }],
    ownership
  )

  // If adjustment returned nothing (e.g. zero-tip edge case), record an empty transaction
  if (ownerSlices.length === 0) {
    const txn = await db.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: 0,
        sourceType,
        kind,
        collectedAt,
        primaryEmployeeId,
        ccFeeAmountCents: ccFeeAmountCents ?? 0,
        idempotencyKey: `tip-txn:${orderId}:${paymentId}`,
      },
    })
    return { tipTransactionId: txn.id, allocations: [] }
  }

  // Pre-fetch group membership for each owner outside the transaction to
  // minimize time spent inside the transaction lock
  const ownerGroups = new Map<string, { id: string } | null>()
  for (const slice of ownerSlices) {
    const group = await findActiveGroupForEmployee(slice.employeeId)
    ownerGroups.set(slice.employeeId, group)
  }

  // Wrap everything in a single transaction for atomicity
  const result = await db.$transaction(async (tx: TxClient) => {
    // Create a single TipTransaction for the whole order+payment
    const tipTxn = await tx.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: tipAmountCents,
        sourceType,
        kind,
        collectedAt,
        primaryEmployeeId,
        ccFeeAmountCents: ccFeeAmountCents ?? 0,
        idempotencyKey: `tip-txn:${orderId}:${paymentId}`,
      },
    })

    const allAllocations: TipAllocationResult['allocations'] = []

    for (const slice of ownerSlices) {
      if (slice.amountCents <= 0) continue

      const ownerGroup = ownerGroups.get(slice.employeeId)

      if (ownerGroup) {
        // Owner is in a tip group -- find the active segment and split their slice
        const segment = await findSegmentForTimestamp(ownerGroup.id, collectedAt)

        if (segment) {
          const splitJson = segment.splitJson
          const memberIds = Object.keys(splitJson).sort()

          if (memberIds.length > 0) {
            const shares = calculateShares(slice.amountCents, splitJson, memberIds)

            for (const { employeeId: memberId, amountCents: memberCents } of shares) {
              if (memberCents <= 0) continue

              const ledgerEntry = await postToTipLedger({
                locationId,
                employeeId: memberId,
                amountCents: memberCents,
                type: 'CREDIT',
                sourceType: 'TIP_GROUP',
                sourceId: tipTxn.id,
                orderId,
                memo: `Group tip split (shared table) from order ${orderId} (${sourceType})`,
                idempotencyKey: `tip-ledger:${orderId}:${paymentId}:owner:${slice.employeeId}:group:${memberId}`,
              }, tx)

              allAllocations.push({
                employeeId: memberId,
                amountCents: memberCents,
                sourceType: 'TIP_GROUP',
                ledgerEntryId: ledgerEntry.id,
              })
            }

            continue // Done with this owner's slice
          }
        }

        // Segment not found or empty -- fall through to direct allocation
        log.warn({ groupId: ownerGroup.id, collectedAt: collectedAt.toISOString(), ownerId: slice.employeeId }, 'No segment found for group — falling back to direct allocation for owner')
      }

      // Owner is NOT in a group (or group had no valid segment) -- direct credit
      const ledgerEntry = await postToTipLedger({
        locationId,
        employeeId: slice.employeeId,
        amountCents: slice.amountCents,
        type: 'CREDIT',
        sourceType: 'DIRECT_TIP',
        sourceId: tipTxn.id,
        orderId,
        memo: `Tip from shared table order ${orderId} (${sourceType})`,
        idempotencyKey: `tip-ledger:${orderId}:${paymentId}:owner:${slice.employeeId}`,
      }, tx)

      allAllocations.push({
        employeeId: slice.employeeId,
        amountCents: slice.amountCents,
        sourceType: 'DIRECT_TIP',
        ledgerEntryId: ledgerEntry.id,
      })
    }

    return {
      tipTransactionId: tipTxn.id,
      allocations: allAllocations,
    }
  })

  return result
}

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
  ccFeeAmountCents?: number
  kind?: string  // Skill 277: 'tip' | 'service_charge' | 'auto_gratuity'
}): Promise<TipAllocationResult> {
  const {
    locationId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    sourceType,
    collectedAt,
    ccFeeAmountCents,
    kind = 'tip',
  } = params

  // Create TipTransaction record (Skill 274: idempotency key)
  const tipTxn = await db.tipTransaction.create({
    data: {
      locationId,
      orderId,
      paymentId,
      amountCents: tipAmountCents,
      sourceType,
      kind,
      collectedAt,
      primaryEmployeeId,
      ccFeeAmountCents: ccFeeAmountCents ?? 0,
      idempotencyKey: `tip-txn:${orderId}:${paymentId}`,
    },
  })

  // Post single credit to the employee's ledger (Skill 274: idempotency key)
  const ledgerEntry = await postToTipLedger({
    locationId,
    employeeId: primaryEmployeeId,
    amountCents: tipAmountCents,
    type: 'CREDIT',
    sourceType: 'DIRECT_TIP',
    sourceId: tipTxn.id,
    orderId,
    memo: `Tip from order ${orderId} (${sourceType})`,
    idempotencyKey: `tip-ledger:${orderId}:${paymentId}:${primaryEmployeeId}`,
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
  ccFeeAmountCents?: number
  kind?: string  // Skill 277: 'tip' | 'service_charge' | 'auto_gratuity'
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
    ccFeeAmountCents,
    kind = 'tip',
  } = params

  // Find the segment that was active at collectedAt
  const segment = await findSegmentForTimestamp(groupId, collectedAt)

  if (!segment) {
    // No segment found (edge case: group exists but no segment covers this time).
    // Fall back to individual allocation so the tip is not lost.
    log.warn({ groupId, collectedAt: collectedAt.toISOString(), primaryEmployeeId }, 'No segment found for group — falling back to individual allocation')
    return allocateIndividual({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      ccFeeAmountCents,
      kind,
    })
  }

  const splitJson = segment.splitJson
  const memberIds = Object.keys(splitJson).sort() // Skill 275: deterministic penny allocation

  // Edge case: empty segment (should not happen, but be safe)
  if (memberIds.length === 0) {
    log.warn({ segmentId: segment.id, primaryEmployeeId }, 'Segment has empty splitJson — falling back to individual allocation')
    return allocateIndividual({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      ccFeeAmountCents,
      kind,
    })
  }

  // Calculate each member's share, with last member absorbing rounding
  const shares = calculateShares(tipAmountCents, splitJson, memberIds)

  // ── Single transaction for the entire group allocation (Skill 271) ────
  // Wrapping TipTransaction creation + all ledger posts in one $transaction
  // prevents nested transaction failures and ensures all member
  // credits commit or rollback together.
  const result = await db.$transaction(async (tx: TxClient) => {
    // Create TipTransaction linked to the group and segment (Skill 274: idempotency key)
    const tipTxn = await tx.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: tipAmountCents,
        sourceType,
        kind,
        collectedAt,
        primaryEmployeeId,
        tipGroupId: groupId,
        segmentId: segment.id,
        ccFeeAmountCents: ccFeeAmountCents ?? 0,
        idempotencyKey: `tip-txn:${orderId}:${paymentId}`,
      },
    })

    // Post a ledger credit for each member (using caller's transaction)
    const allocations: TipAllocationResult['allocations'] = []

    for (const { employeeId, amountCents } of shares) {
      // Skip zero-cent allocations (can happen with very small tips + many members)
      if (amountCents <= 0) continue

      // Skill 274: per-member idempotency key
      const ledgerEntry = await postToTipLedger({
        locationId,
        employeeId,
        amountCents,
        type: 'CREDIT',
        sourceType: 'TIP_GROUP',
        sourceId: tipTxn.id,
        orderId,
        memo: `Group tip split from order ${orderId} (${sourceType})`,
        idempotencyKey: `tip-ledger:${orderId}:${paymentId}:${employeeId}`,
      }, tx)  // Pass txClient to avoid nested transactions

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
  })

  return result
}

/**
 * Proportional time-segmented allocation.
 *
 * Each item on the tab contributes to the TipGroupSegment that was active when it
 * was added. Tip is split proportionally: segment gets (segment_items_revenue /
 * order_total_revenue) of the total tip. Then that segment distributes to its
 * members via splitJson.
 *
 * Falls back to single-timestamp allocation (collectedAt) when:
 *  - No items found for the order
 *  - All items map to the same segment
 *  - All items predate the group (no segment found)
 */
async function allocateToGroupProportional(params: {
  groupId: string
  orderId: string
  paymentId: string
  tipAmountCents: number
  primaryEmployeeId: string
  locationId: string
  sourceType: 'CARD' | 'CASH'
  collectedAt: Date
  ccFeeAmountCents?: number
  kind?: string
  idempotencyKey: string
}): Promise<TipAllocationResult> {
  const {
    groupId,
    orderId,
    paymentId,
    tipAmountCents,
    primaryEmployeeId,
    locationId,
    sourceType,
    collectedAt,
    ccFeeAmountCents,
    kind = 'tip',
    idempotencyKey,
  } = params

  // 1. Fetch items for this order
  const items = await fetchOrderItemsForAllocation(orderId)

  // 2. No items → fall back to standard group allocation
  if (items.length === 0) {
    return allocateToGroup({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      groupId,
      ccFeeAmountCents,
      kind,
    })
  }

  // 3. For each item, find the segment active at item.createdAt
  // 4. Build buckets: segmentId → total item revenue in cents
  const buckets = new Map<
    string,
    { segment: TipGroupSegmentInfo | null; totalItemCents: number }
  >()

  for (const item of items) {
    const segment = await findSegmentForTimestamp(groupId, item.createdAt)
    const key = segment ? segment.id : '__none__'
    const itemCents = Math.round(item.itemTotal * 100)

    const existing = buckets.get(key)
    if (existing) {
      existing.totalItemCents += itemCents
    } else {
      buckets.set(key, { segment, totalItemCents: itemCents })
    }
  }

  // 5. Compute total revenue across all buckets
  let orderTotalCents = 0
  for (const bucket of buckets.values()) {
    orderTotalCents += bucket.totalItemCents
  }

  // Guard: if total is zero (shouldn't happen given filter, but be safe)
  if (orderTotalCents <= 0) {
    return allocateToGroup({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      groupId,
      ccFeeAmountCents,
      kind,
    })
  }

  // 6. If only 1 unique non-null segment key (or only '__none__') → fall back
  const nonNoneKeys = [...buckets.keys()].filter((k) => k !== '__none__')
  if (nonNoneKeys.length <= 1) {
    return allocateToGroup({
      locationId,
      orderId,
      paymentId,
      tipAmountCents,
      primaryEmployeeId,
      sourceType,
      collectedAt,
      groupId,
      ccFeeAmountCents,
      kind,
    })
  }

  // 7. Sort bucket keys deterministically for reproducible rounding
  const sortedKeys = [...buckets.keys()].sort()

  // 8–9. Allocate proportionally, last bucket gets remainder
  // Pre-compute per-bucket tip cents
  const bucketAllocations: Array<{
    key: string
    segment: TipGroupSegmentInfo | null
    proportionalCents: number
  }> = []
  let allocatedSoFar = 0

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i]
    const bucket = buckets.get(key)!
    let proportionalCents: number

    if (i === sortedKeys.length - 1) {
      // Last bucket absorbs rounding remainder
      proportionalCents = tipAmountCents - allocatedSoFar
    } else {
      proportionalCents = Math.round(
        (tipAmountCents * bucket.totalItemCents) / orderTotalCents
      )
    }

    allocatedSoFar += proportionalCents
    bucketAllocations.push({
      key,
      segment: bucket.segment,
      proportionalCents,
    })
  }

  // 10. Wrap all DB writes in a single transaction
  const result = await db.$transaction(async (tx: TxClient) => {
    // Create the parent TipTransaction
    const tipTxn = await tx.tipTransaction.create({
      data: {
        locationId,
        orderId,
        paymentId,
        amountCents: tipAmountCents,
        sourceType,
        kind,
        collectedAt,
        primaryEmployeeId,
        tipGroupId: groupId,
        ccFeeAmountCents: ccFeeAmountCents ?? 0,
        idempotencyKey,
      },
    })

    const allAllocations: TipAllocationResult['allocations'] = []

    for (const { key, segment, proportionalCents } of bucketAllocations) {
      if (proportionalCents <= 0) continue

      if (key === '__none__' || !segment) {
        // Items that predate the group → direct tip to primary employee
        const ledgerEntry = await postToTipLedger(
          {
            locationId,
            employeeId: primaryEmployeeId,
            amountCents: proportionalCents,
            type: 'CREDIT',
            sourceType: 'DIRECT_TIP',
            sourceId: tipTxn.id,
            orderId,
            memo: `Proportional tip (pre-group items) from order ${orderId} (${sourceType})`,
            idempotencyKey: `${idempotencyKey}:seg:__none__:${primaryEmployeeId}`,
          },
          tx
        )

        allAllocations.push({
          employeeId: primaryEmployeeId,
          amountCents: proportionalCents,
          sourceType: 'DIRECT_TIP',
          ledgerEntryId: ledgerEntry.id,
        })
      } else {
        // Real segment → distribute among segment members using splitJson
        const splitJson = segment.splitJson
        const memberIds = Object.keys(splitJson).sort()

        if (memberIds.length === 0) {
          // Empty segment (edge case) → direct to primary
          const ledgerEntry = await postToTipLedger(
            {
              locationId,
              employeeId: primaryEmployeeId,
              amountCents: proportionalCents,
              type: 'CREDIT',
              sourceType: 'DIRECT_TIP',
              sourceId: tipTxn.id,
              orderId,
              memo: `Proportional tip (empty segment) from order ${orderId} (${sourceType})`,
              idempotencyKey: `${idempotencyKey}:seg:${segment.id}:${primaryEmployeeId}`,
            },
            tx
          )

          allAllocations.push({
            employeeId: primaryEmployeeId,
            amountCents: proportionalCents,
            sourceType: 'DIRECT_TIP',
            ledgerEntryId: ledgerEntry.id,
          })
          continue
        }

        // Split this segment's proportional cents among its members
        const shares = calculateShares(proportionalCents, splitJson, memberIds)

        // One TipTransaction per segment (not per member)
        const segTxn = await tx.tipTransaction.create({
          data: {
            locationId,
            orderId,
            paymentId,
            amountCents: proportionalCents,
            sourceType,
            kind,
            collectedAt,
            primaryEmployeeId,
            tipGroupId: groupId,
            segmentId: segment.id,
            ccFeeAmountCents: 0,
            idempotencyKey: `${idempotencyKey}:seg:${segment.id}`,
          },
        })

        for (const { employeeId, amountCents } of shares) {
          if (amountCents <= 0) continue

          const ledgerEntry = await postToTipLedger(
            {
              locationId,
              employeeId,
              amountCents,
              type: 'CREDIT',
              sourceType: 'TIP_GROUP',
              sourceId: segTxn.id,
              orderId,
              memo: `Proportional group tip (segment ${segment.id}) from order ${orderId} (${sourceType})`,
              idempotencyKey: `${idempotencyKey}:seg:${segment.id}:${employeeId}`,
            },
            tx
          )

          allAllocations.push({
            employeeId,
            amountCents,
            sourceType: 'TIP_GROUP',
            ledgerEntryId: ledgerEntry.id,
          })
        }
      }
    }

    return {
      tipTransactionId: tipTxn.id,
      allocations: allAllocations,
    }
  })

  return result
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
