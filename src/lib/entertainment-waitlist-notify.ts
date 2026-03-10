/**
 * Shared helper: auto-notify next waitlist entry when an entertainment item becomes available.
 *
 * Called from:
 * - DELETE /api/entertainment/block-time (manual stop)
 * - POST /api/orders/[id]/pay (payment)
 * - POST /api/orders/[id]/close-tab (tab close)
 * - POST /api/orders/[id]/void-tab (tab void)
 * - POST /api/eod/reset (end of day)
 */
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'

export async function notifyNextWaitlistEntry(
  locationId: string,
  menuItemId: string,
  itemName?: string
): Promise<void> {
  try {
    const floorPlanElement = await db.floorPlanElement.findFirst({
      where: { linkedMenuItemId: menuItemId, deletedAt: null },
      select: { id: true, visualType: true },
    })

    if (!floorPlanElement) return

    const nextWaiting = await db.entertainmentWaitlist.findFirst({
      where: {
        locationId,
        deletedAt: null,
        status: 'waiting',
        OR: [
          { elementId: floorPlanElement.id },
          { visualType: floorPlanElement.visualType },
        ],
      },
      orderBy: { position: 'asc' },
    })

    if (!nextWaiting) return

    await db.entertainmentWaitlist.update({
      where: { id: nextWaiting.id },
      data: { status: 'notified', notifiedAt: new Date() },
    })

    void emitToLocation(locationId, 'entertainment:waitlist-notify', {
      entryId: nextWaiting.id,
      customerName: nextWaiting.customerName,
      elementId: floorPlanElement.id,
      elementName: floorPlanElement.visualType,
      message: `${nextWaiting.customerName || 'Next customer'} — your ${itemName || 'entertainment item'} is now available!`,
    }).catch(() => {})
  } catch (err) {
    console.error('[waitlist-notify] Failed to auto-notify:', err)
  }
}
