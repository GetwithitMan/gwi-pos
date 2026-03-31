/**
 * Tab domain socket dispatchers
 *
 * Handles: tab updated, tab closed, tab status update, tab items updated.
 */

import { MOBILE_EVENTS } from '@/types/multi-surface'
import {
  log,
  emitToLocation,
} from './emit-helpers'

/**
 * Dispatch tab updated event
 *
 * Called after tab status changes (opened, closed, captured).
 * Notifies all terminals to refresh tab state.
 */
export async function dispatchTabUpdated(
  locationId: string,
  data: { orderId: string; status?: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'tab:updated', data)
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch tab:updated')
    return false
  }
}

// Mobile: notify phone that tab was successfully closed
export function dispatchTabClosed(locationId: string, data: { orderId: string; total: number; tipAmount: number }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, data).catch((err) => log.error({ err }, 'Failed to dispatch tab closed'))
}

// Mobile: update phone with current tab status
export function dispatchTabStatusUpdate(locationId: string, data: { orderId: string; status: string }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_STATUS_UPDATE, data).catch((err) => log.error({ err }, 'Failed to dispatch tab status update'))
}

// Mobile: notify phone that tab items were updated
export function dispatchTabItemsUpdated(locationId: string, data: { orderId: string; itemCount: number }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_ITEMS_UPDATED, data).catch((err) => log.error({ err }, 'Failed to dispatch tab items updated'))
}
