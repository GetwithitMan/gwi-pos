/**
 * Split Family Balance Calculator — Unified Split Checks
 *
 * THE single source of truth for split family financial state.
 * Called by: pay route, split route, open orders, merge/rebalance, closure logic.
 *
 * Rules (from spec sections 4 + 6):
 * - Read ceiling from family root's splitFamilyTotal (immutable)
 * - Sum completed payments across root + all non-deleted descendants
 * - Resolved children's payments still count toward paidTotal
 * - Resolved children are NOT independently payable
 * - ItemShare allocations contribute to target check payable total (overlay, not mutation)
 * - isFullyPaid = remainingBalance <= 0.01 (penny tolerance)
 */

import { createChildLogger } from '@/lib/logger'
import { inferSplitClass } from './split-helpers'
import type { TxClient } from './types'

const log = createChildLogger('split-family-balance')

// ─── Split Balance Reconciliation ───────────────────────────────────────────

/**
 * Validate that SUM(child totals) == parent total after a split mutation.
 * Logs a WARNING on drift > $0.01 — does NOT block the operation.
 * Should be called after split transactions commit (fire-and-forget safe).
 */
export async function validateSplitBalance(
  tx: TxClient,
  parentOrderId: string,
): Promise<void> {
  try {
    const parentOrder = await tx.order.findFirst({
      where: { id: parentOrderId, deletedAt: null },
      select: { id: true, total: true, splitFamilyTotal: true },
    })
    if (!parentOrder) return

    const childOrders = await tx.order.findMany({
      where: {
        OR: [
          { parentOrderId },
          { splitFamilyRootId: parentOrderId },
        ],
        deletedAt: null,
        id: { not: parentOrderId },
      },
      select: { id: true, total: true },
    })

    if (childOrders.length === 0) return

    const childSum = childOrders.reduce((sum, c) => sum + Number(c.total), 0)
    const parentTotal = parentOrder.splitFamilyTotal != null
      ? Number(parentOrder.splitFamilyTotal)
      : Number(parentOrder.total)
    const drift = Math.abs(childSum - parentTotal)

    if (drift > 0.01) {
      log.warn(
        {
          parentOrderId,
          parentTotal,
          childSum,
          drift: Math.round(drift * 100) / 100,
          childCount: childOrders.length,
        },
        'Split balance drift detected — SUM(child totals) != parent total',
      )
    }
  } catch (e) {
    // Never let reconciliation validation break the split flow
    log.warn({ err: e, parentOrderId }, 'Split balance validation failed (non-blocking)')
  }
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ChildBalance {
  orderId: string
  splitClass: 'structural' | 'allocation'
  splitMode: string | null
  allocated: number
  paid: number
  remaining: number
  resolution: string | null
}

export interface SplitFamilyBalance {
  familyRootId: string
  familyTotal: number
  paidTotal: number
  remainingBalance: number
  childBalances: ChildBalance[]
  isFullyPaid: boolean
}

// ─── Calculator ─────────────────────────────────────────────────────────────

export async function computeSplitFamilyBalance(
  tx: TxClient,
  familyRootId: string,
  locationId: string,
): Promise<SplitFamilyBalance> {
  // 1. Fetch root order — splitFamilyTotal is the immutable ceiling
  const root = await tx.order.findFirst({
    where: { id: familyRootId, locationId },
    select: {
      id: true,
      total: true,
      splitFamilyTotal: true,
    },
  })

  if (!root) {
    throw new Error(`Split family root ${familyRootId} not found in location ${locationId}`)
  }

  // Use immutable splitFamilyTotal if set (new code). Otherwise, reconstruct
  // from root + children totals (legacy splits where splitFamilyTotal wasn't set).
  // root.total alone is wrong for by-item splits where items were moved to children.
  let familyTotal: number
  if (root.splitFamilyTotal != null) {
    familyTotal = Number(root.splitFamilyTotal)
  } else {
    // Legacy fallback: sum root total + all children totals to get original family total
    const childrenTotalSum = await tx.order.aggregate({
      where: { parentOrderId: familyRootId, deletedAt: null },
      _sum: { total: true },
    })
    familyTotal = Number(root.total) + Number(childrenTotalSum._sum.total ?? 0)
  }

  // 2. Fetch all non-deleted descendants (children + grandchildren via splitFamilyRootId)
  const descendants = await tx.order.findMany({
    where: {
      OR: [
        { parentOrderId: familyRootId },
        { splitFamilyRootId: familyRootId },
      ],
      deletedAt: null,
      // Exclude the root itself (splitFamilyRootId could self-reference in edge cases)
      id: { not: familyRootId },
    },
    select: {
      id: true,
      total: true,
      splitClass: true,
      splitMode: true,
      splitResolution: true,
      status: true,
      _count: { select: { items: { where: { deletedAt: null } } } },
    },
  })

  // 3. Collect all order IDs (root + descendants) for payment query
  const allOrderIds = [familyRootId, ...descendants.map(d => d.id)]

  // Fetch all completed payments across the family in one query
  const completedPayments = await tx.payment.findMany({
    where: {
      orderId: { in: allOrderIds },
      locationId,
      status: 'completed',
    },
    select: {
      orderId: true,
      totalAmount: true,
    },
  })

  // Build payment totals by orderId
  const paymentsByOrder = new Map<string, number>()
  for (const p of completedPayments) {
    const current = paymentsByOrder.get(p.orderId) ?? 0
    paymentsByOrder.set(p.orderId, current + Number(p.totalAmount))
  }

  // 4. Query ItemShare allocations targeting each descendant
  //    Phase 1: ItemShare table may not exist yet, so wrap in try/catch
  const itemSharesByTarget = new Map<string, number>()
  try {
    const itemShares = await (tx as any).itemShare?.findMany?.({
      where: {
        targetOrderId: { in: allOrderIds },
        deletedAt: null,
        splitResolution: null,
      },
      select: {
        targetOrderId: true,
        allocatedAmount: true,
      },
    })
    if (itemShares && Array.isArray(itemShares)) {
      for (const share of itemShares) {
        const current = itemSharesByTarget.get(share.targetOrderId) ?? 0
        itemSharesByTarget.set(share.targetOrderId, current + Number(share.allocatedAmount))
      }
    }
  } catch {
    // ItemShare model doesn't exist yet (pre-migration) — expected in Phase 1
  }

  // 5. Compute per-child balances
  const childBalances: ChildBalance[] = descendants.map(child => {
    const splitClass = (child.splitClass as 'structural' | 'allocation' | null)
      ?? inferSplitClass({ splitClass: child.splitClass, itemCount: child._count.items })

    const childTotal = Number(child.total)
    const itemShareContribution = itemSharesByTarget.get(child.id) ?? 0

    // allocated = child's own total + any ItemShare allocations targeting it
    const allocated = childTotal + itemShareContribution
    const paid = paymentsByOrder.get(child.id) ?? 0
    const remaining = Math.max(0, allocated - paid)

    return {
      orderId: child.id,
      splitClass: splitClass as 'structural' | 'allocation',
      splitMode: child.splitMode as string | null,
      allocated,
      paid,
      remaining,
      resolution: child.splitResolution as string | null,
    }
  })

  // 6. Compute family totals
  //    paidTotal = sum of ALL completed payments across root + all descendants
  //    (resolved children's payments still count)
  let paidTotal = 0
  paymentsByOrder.forEach(amount => {
    paidTotal += amount
  })

  const remainingBalance = Math.max(0, familyTotal - paidTotal)
  // Penny tolerance: consider fully paid if remaining <= $0.01
  const isFullyPaid = remainingBalance <= 0.01

  log.debug(
    { familyRootId, familyTotal, paidTotal, remainingBalance, isFullyPaid, childCount: descendants.length },
    'Computed split family balance',
  )

  return {
    familyRootId,
    familyTotal,
    paidTotal,
    remainingBalance,
    childBalances,
    isFullyPaid,
  }
}
