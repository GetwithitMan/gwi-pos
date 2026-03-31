/**
 * Payment domain socket dispatchers
 *
 * Handles: payment processed/voided/refunded, tip allocation,
 * tip groups, gift card balance, card detection.
 */

import {
  log,
  crypto,
  emitToLocation,
  emitCriticalToLocation,
  type DispatchOptions,
} from './emit-helpers'

/**
 * Dispatch payment processed event
 *
 * Called after a successful payment DB write.
 * Notifies all terminals that a payment was processed on an order.
 */
export async function dispatchPaymentProcessed(
  locationId: string,
  data: {
    orderId: string;
    paymentId?: string;
    status: string;
    sourceTerminalId?: string;
    // Enriched fields — allow clients to construct PAYMENT_APPLIED locally without HTTP round-trip
    method?: string;
    amount?: number;
    tipAmount?: number;
    totalAmount?: number;
    employeeId?: string | null;
    isClosed?: boolean;
    cardBrand?: string | null;
    cardLast4?: string | null;
    // Split context — set when paying a split child order
    parentOrderId?: string | null;
    allSiblingsPaid?: boolean;
    // Parent auto-close — set when parent is auto-closed after all siblings paid
    parentAutoClose?: boolean;
  }
): Promise<boolean> {
  try {
    // QoS 1: critical financial event — acknowledged delivery with retry
    // _dedupKey allows clients to dedup if they receive the same event twice (e.g., QoS retry)
    await emitCriticalToLocation(locationId, 'payment:processed', { ...data, _dedupKey: crypto.randomUUID() })
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch payment:processed')
    return false
  }
}

// ==================== Tip Allocation Events ====================

/**
 * Dispatch tips:allocated event after tip allocation completes.
 *
 * Notifies employees at the location that tips have been allocated
 * from a payment, so they can update their tip dashboard without
 * a manual refresh.
 */
export async function dispatchTipAllocated(
  locationId: string,
  payload: {
    orderId: string
    paymentId: string
    allocations: Array<{
      employeeId: string
      amountCents: number
      sourceType: 'DIRECT_TIP' | 'TIP_GROUP'
    }>
    ccFeeCents: number
    netTipCents: number
  },
): Promise<void> {
  try {
    await emitToLocation(locationId, 'tips:allocated', payload)
  } catch (err) {
    log.error({ err }, 'Failed to dispatch tips:allocated')
  }
}

/**
 * Dispatch tip group update event (Skill 252)
 *
 * Called when tip group membership changes, group created/closed, etc.
 * Keeps all bartender terminals in sync with group state.
 */
export async function dispatchTipGroupUpdate(
  locationId: string,
  payload: {
    action: 'created' | 'member-joined' | 'member-left' | 'closed' | 'ownership-transferred' | 'tip-received'
    groupId: string
    employeeId?: string
    employeeName?: string
    newOwnerId?: string
    tipAmountCents?: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'tip-group:updated', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async tip group dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Gift Card Events ====================

/**
 * Dispatch gift-card:balance-changed event to all connected clients.
 *
 * CRITICAL for fraud prevention: prevents double-spend when two terminals
 * see the same stale gift card balance. Emitted after every balance mutation
 * (activation, redemption, reload, refund, adjustment, void restoration).
 */
export async function dispatchGiftCardBalanceChanged(
  locationId: string,
  payload: {
    giftCardId: string
    newBalance: number
  },
): Promise<void> {
  try {
    await emitToLocation(locationId, 'gift-card:balance-changed', {
      ...payload,
      locationId,
    })
  } catch (err) {
    log.error({ err }, 'Failed to dispatch gift-card:balance-changed')
  }
}

