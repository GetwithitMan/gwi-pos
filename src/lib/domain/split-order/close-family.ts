/**
 * Split Family Closure — Unified Split Checks
 *
 * Handles closing a split family when fully paid and reopening
 * children when a payment is voided (Scenario 7).
 *
 * closeSplitFamily():
 *   1. Mark all unpaid active DESCENDANTS as superseded (NOT the root)
 *   2. Close family root with status='paid', paidAt, closedAt
 *   3. Emit ORDER_CLOSED event on root only
 *
 * unsupersedeChildren():
 *   1. Find children where supersededBy = voidedOrderId
 *   2. Clear splitResolution, supersededBy, supersededAt
 *   3. Emit ORDER_REOPENED on each
 *   4. Return IDs of unsuperseded children
 */

import * as OrderRepository from '@/lib/repositories/order-repository'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { createChildLogger } from '@/lib/logger'
import type { TxClient } from './types'

const log = createChildLogger('split-family')

// ─── Close Family ───────────────────────────────────────────────────────────

/**
 * Close a split family after it is fully paid.
 * Supersedes all unpaid active descendants, then marks the root as paid.
 */
export async function closeSplitFamily(
  tx: TxClient,
  familyRootId: string,
  locationId: string,
): Promise<void> {
  const now = new Date()

  // 1. Mark all unpaid active DESCENDANTS as superseded (NOT the root itself)
  const superseded = await tx.order.updateMany({
    where: {
      OR: [
        { parentOrderId: familyRootId },
        { splitFamilyRootId: familyRootId },
      ],
      id: { not: familyRootId },
      status: { notIn: ['paid', 'voided', 'cancelled'] },
      splitResolution: null,
    },
    data: {
      splitResolution: 'superseded',
      supersededBy: familyRootId,
      supersededAt: now,
    },
  })

  log.info(
    { familyRootId, supersededCount: superseded.count },
    'Superseded unpaid descendants for family closure',
  )

  // 2. Close family root — separate explicit update
  await OrderRepository.updateOrder(familyRootId, locationId, {
    status: 'paid',
    paidAt: now,
    closedAt: now,
  }, tx)

  // 3. Emit ORDER_CLOSED event on root only (fire-and-forget)
  void emitOrderEvent(locationId, familyRootId, 'ORDER_CLOSED', {
    closedStatus: 'paid',
    reason: 'Split family fully paid',
  }).catch(err => log.error({ err, familyRootId }, 'Failed to emit ORDER_CLOSED for family root'))
}

// ─── Unsupersede (Void/Reopen) ─────────────────────────────────────────────

/**
 * Unsupersede children that were resolved by a specific order (typically
 * the parent after a pay-remaining that is now being voided).
 *
 * Per Invariant 9: only unsupersede children whose `supersededBy` matches
 * the voided order. Children superseded by a different order are left resolved.
 *
 * Returns the IDs of children that were unsuperseded.
 */
export async function unsupersedeChildren(
  tx: TxClient,
  voidedOrderId: string,
  familyRootId: string,
  locationId: string,
): Promise<string[]> {
  // 1. Find children that were superseded by the voided order
  const affectedChildren = await tx.order.findMany({
    where: {
      OR: [
        { parentOrderId: familyRootId },
        { splitFamilyRootId: familyRootId },
      ],
      supersededBy: voidedOrderId,
      deletedAt: null,
    },
    select: { id: true },
  })

  const childIds = affectedChildren.map(c => c.id)

  if (childIds.length === 0) {
    log.debug({ voidedOrderId, familyRootId }, 'No children to unsupersede')
    return []
  }

  // 2. Clear resolution fields on matched children
  await tx.order.updateMany({
    where: {
      id: { in: childIds },
    },
    data: {
      splitResolution: null,
      supersededBy: null,
      supersededAt: null,
    },
  })

  log.info(
    { voidedOrderId, familyRootId, unsupersededCount: childIds.length, childIds },
    'Unsuperseded children after payment void',
  )

  // 3. Emit ORDER_REOPENED on each unsuperseded child (fire-and-forget)
  for (const childId of childIds) {
    void emitOrderEvent(locationId, childId, 'ORDER_REOPENED', {
      reason: `Payment voided on order ${voidedOrderId}`,
    }).catch(err => log.error({ err, childId }, 'Failed to emit ORDER_REOPENED for unsuperseded child'))
  }

  return childIds
}
