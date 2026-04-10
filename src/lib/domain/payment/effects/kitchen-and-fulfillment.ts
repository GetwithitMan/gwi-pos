/**
 * Kitchen & Fulfillment Effects
 *
 * - Kitchen auto-send (unsent items)
 */
import { dispatchNewOrder } from '@/lib/socket-dispatch'
import { OrderRouter } from '@/lib/order-router'
import { batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-effects-kitchen')

// ─── 3. Kitchen Auto-Send (Unsent Items) ─────────────────────────────────────

export function autoSendUnsentItems(
  order: any,
  orderId: string,
  unsentItems: any[],
): void {
  if (unsentItems.length === 0) return

  const autoSendIds = unsentItems
    .filter((i: any) => i.menuItem?.itemType !== 'timed_rental')
    .map((i: any) => i.id)
  if (autoSendIds.length === 0) return

  void (async () => {
    try {
      const now = new Date()
      await batchUpdateOrderItemStatus(autoSendIds, 'sent', now)
      const routingResult = await OrderRouter.resolveRouting(orderId, autoSendIds)
      void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      void printKitchenTicketsForManifests(routingResult, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      void deductPrepStockForOrder(orderId, autoSendIds).catch(err => log.warn({ err }, 'Background task failed'))
      void emitOrderEvent(order.locationId, orderId, 'ORDER_SENT', { sentItemIds: autoSendIds })
    } catch (caughtErr) {
      console.error('[pay] Auto-send to kitchen failed:', caughtErr)
    }
  })()
}
