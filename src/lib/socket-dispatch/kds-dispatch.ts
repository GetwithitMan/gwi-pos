/**
 * KDS (Kitchen Display System) socket dispatchers
 *
 * Handles: item status changes, order bumps, order forwarding,
 * multi-clear between KDS screens.
 */

import {
  log,
  emitToLocation,
  emitToTags,
  type DispatchOptions,
} from './emit-helpers'

/**
 * Dispatch item status change (cooking/ready/served)
 *
 * Called when an item's status is updated on a KDS screen.
 * Propagates to expo and all other listening stations.
 */
export async function dispatchItemStatus(
  locationId: string,
  payload: {
    orderId: string
    itemId: string
    status: string
    stationId: string
    updatedBy: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await Promise.all([
        emitToTags(['expo'], 'kds:item-status', payload, locationId),
        emitToLocation(locationId, 'kds:item-status', payload),
      ])
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch batch item status changes
 *
 * Called when multiple items' statuses are updated in a single operation (e.g., bump entire order).
 * Reduces from N events per order (one per item) to 1 event with all item updates.
 * Propagates to expo and all other listening stations.
 * Eliminates socket event flooding when bumping 10+ item orders.
 */
export async function dispatchItemsStatusChanged(
  locationId: string,
  payload: {
    orderId: string
    stationId: string
    updatedBy: string
    items: Array<{
      itemId: string
      status: string
    }>
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await Promise.all([
        emitToTags(['expo'], 'kds:items-status-changed', payload, locationId),
        emitToLocation(locationId, 'kds:items-status-changed', payload),
      ])
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order bumped event
 *
 * Called when an order is bumped from a KDS station.
 * Notifies expo and other stations to update their displays.
 */
export async function dispatchOrderBumped(
  locationId: string,
  payload: {
    orderId: string
    stationId: string
    bumpedBy: string
    allItemsServed: boolean
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await Promise.all([
        emitToTags(['expo'], 'kds:order-bumped', payload, locationId),
        emitToLocation(locationId, 'kds:order-bumped', payload),
      ])
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order forwarded event (KDS screen-to-screen communication)
 *
 * Emitted when a Kitchen screen bumps and has a send_to_next link.
 * Target screens (e.g., Expo) listen for this to show forwarded items.
 */
export async function dispatchOrderForwarded(
  locationId: string,
  payload: {
    eventId: string
    orderId: string
    itemIds: string[]
    targetScreenId: string
    sourceScreenId: string
    linkType: string
    bumpAction: string
    resetStrikethroughs: boolean
    bumpedBy: string
    locationId: string
    timestamp: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'kds:order-forwarded', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch order forwarded')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order-forwarded dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch multi-clear event (KDS screen-to-screen communication)
 *
 * Emitted when a source screen bumps and has a multi_clear link.
 * Target screens apply the configured bump action to matching items.
 */
/**
 * Dispatch items-voided event to KDS screens
 *
 * Called when items are voided from POS after being sent to kitchen.
 * KDS screens should remove/strike these items and optionally show the reason.
 */
export async function dispatchItemsVoided(
  locationId: string,
  payload: {
    orderId: string
    itemIds: string[]
    reason: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'kds:items-voided', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch items-voided')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async items-voided dispatch failed'))
    return true
  }

  return doEmit()
}

export async function dispatchMultiClear(
  locationId: string,
  payload: {
    eventId: string
    orderId: string
    itemIds: string[]
    targetScreenId: string
    sourceScreenId: string
    bumpAction: string
    locationId: string
    timestamp: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'kds:multi-clear', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch multi-clear')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async multi-clear dispatch failed'))
    return true
  }

  return doEmit()
}
