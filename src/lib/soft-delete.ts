/**
 * Soft-delete cascade helpers.
 *
 * Atomic soft-delete that marks the parent record AND all child records
 * with `deletedAt` inside a single Prisma transaction.
 */

import type { PrismaClient } from '@prisma/client'

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Soft-delete an Order and all of its child records atomically.
 *
 * Sets `deletedAt` on:
 *  - Order
 *  - OrderItem
 *  - OrderItemModifier (via orderItem relation)
 *  - Payment
 *  - OrderDiscount
 *  - OrderItemDiscount (via orderItem relation)
 *
 * Call inside `db.$transaction(async (tx) => { ... })`.
 */
export async function softDeleteOrder(tx: Tx, orderId: string): Promise<void> {
  const now = new Date()

  await Promise.all([
    tx.order.update({
      where: { id: orderId },
      data: { deletedAt: now },
    }),

    tx.orderItem.updateMany({
      where: { orderId, deletedAt: null },
      data: { deletedAt: now },
    }),

    tx.orderItemModifier.updateMany({
      where: { orderItem: { orderId }, deletedAt: null },
      data: { deletedAt: now },
    }),

    tx.payment.updateMany({
      where: { orderId, deletedAt: null },
      data: { deletedAt: now },
    }),

    tx.orderDiscount.updateMany({
      where: { orderId, deletedAt: null },
      data: { deletedAt: now },
    }),

    tx.orderItemDiscount.updateMany({
      where: { orderItem: { orderId }, deletedAt: null },
      data: { deletedAt: now },
    }),
  ])
}

/**
 * Soft-delete a single OrderItem and its child modifiers/discounts atomically.
 */
export async function softDeleteOrderItem(tx: Tx, orderItemId: string): Promise<void> {
  const now = new Date()

  await Promise.all([
    tx.orderItem.update({
      where: { id: orderItemId },
      data: { deletedAt: now },
    }),

    tx.orderItemModifier.updateMany({
      where: { orderItemId, deletedAt: null },
      data: { deletedAt: now },
    }),

    tx.orderItemDiscount.updateMany({
      where: { orderItemId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ])
}
