import { db } from '@/lib/db'

/**
 * Soft-delete all temporary seats created for a specific order.
 * Called when an order is paid, closed, or auto-cancelled.
 * Uses soft delete for consistency with project-wide policy.
 */
export async function cleanupTemporarySeats(orderId: string): Promise<void> {
  await db.seat.updateMany({
    where: { sourceOrderId: orderId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
}
