/**
 * Split Order Validation — validates split family balances before payment.
 */

import { NextResponse } from 'next/server'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { toNumber } from '@/lib/pricing'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('pay-split')

interface SplitValidationResult {
  splitPayRemainingOverride: number | null
}

/**
 * Validate split-pay-remaining for parent orders with status 'split'.
 * Returns the remaining family balance override, or null if not a split parent.
 */
export async function validateSplitParent(
  tx: any,
  order: { id: string; status: string; locationId: string },
): Promise<{ earlyReturn: NextResponse } | SplitValidationResult> {
  if (order.status !== 'split') {
    return { splitPayRemainingOverride: null }
  }

  const { computeSplitFamilyBalance } = await import('@/lib/domain/split-order/family-balance')
  const { closeSplitFamily } = await import('@/lib/domain/split-order/close-family')
  const family = await computeSplitFamilyBalance(tx, order.id, order.locationId)

  if (family.remainingBalance <= 0) {
    await closeSplitFamily(tx, order.id, order.locationId)
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      orderId: order.id,
      message: 'Split family already fully paid',
    } }) }
  }

  log.info({ orderId: order.id, remaining: family.remainingBalance, familyTotal: family.familyTotal }, 'Split parent pay-remaining')
  return { splitPayRemainingOverride: family.remainingBalance }
}

/**
 * Validate that a split child payment won't exceed the parent order total.
 * Also validates the parent order is still in split state.
 */
export async function validateSplitChild(
  tx: any,
  order: { id: string; parentOrderId: string | null; locationId: string },
  payments: Array<{ amount: number }>,
): Promise<{ earlyReturn: NextResponse } | null> {
  if (!order.parentOrderId) return null

  // Lock the parent order row to prevent concurrent split payments from racing
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.parentOrderId} FOR UPDATE`

  const parentOrder = await OrderRepository.getOrderByIdWithSelect(
    order.parentOrderId, order.locationId, { status: true, total: true }, tx
  )
  if (!parentOrder || parentOrder.status !== 'split') {
    return { earlyReturn: NextResponse.json(
      { error: 'Parent order is no longer in split state' },
      { status: 400 }
    ) }
  }

  // FIX F5: Use base `amount` (excludes tips) instead of `totalAmount`.
  const allSplitPayments = await tx.payment.aggregate({
    where: {
      order: { parentOrderId: order.parentOrderId },
      locationId: order.locationId,
      status: 'completed',
    },
    _sum: { amount: true },
  })
  const existingPaidTotal = toNumber(allSplitPayments._sum.amount ?? 0)
  const parentTotal = toNumber(parentOrder.total)
  const thisSplitPaymentTotal = payments.reduce((sum, p) => sum + p.amount, 0)

  // Tolerance accounts for penny rounding accumulation across multiple splits.
  // Each split can introduce at most ~$0.01 of rounding error.
  const siblingCount = await tx.order.count({ where: { parentOrderId: order.parentOrderId, deletedAt: null } })
  const roundingTolerance = Math.max(0.01, siblingCount * 0.01)
  if (existingPaidTotal + thisSplitPaymentTotal > parentTotal + roundingTolerance) {
    return { earlyReturn: NextResponse.json(
      { error: `Total split payments ($${(existingPaidTotal + thisSplitPaymentTotal).toFixed(2)}) would exceed original order total ($${parentTotal.toFixed(2)})` },
      { status: 400 }
    ) }
  }

  return null
}
