import { db } from '@/lib/db'

/**
 * Hard-delete all temporary seats created for a specific order.
 * Called when an order is paid, closed, or auto-cancelled.
 * Temp seats are ephemeral — no soft delete needed.
 */
export async function cleanupTemporarySeats(orderId: string): Promise<void> {
  await db.seat.deleteMany({
    where: { sourceOrderId: orderId },
  })
}
