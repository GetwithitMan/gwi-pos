/**
 * Order Event Sourcing — Pure Reducer
 *
 * TypeScript port of the Android OrderReducer.
 * Produces IDENTICAL output to the Kotlin version for the same events.
 * All state transitions are immutable (spread operators, never mutate).
 */

import {
  type OrderState,
  type OrderEventPayload,
  type OrderLineItem,
  type OrderPayment,
  type ItemDiscount,
  type OrderDiscount,
  emptyOrderState,
} from './types'

// ── Guard helper ─────────────────────────────────────────────────────

/**
 * If the order is closed, return state unchanged.
 * Otherwise execute fn() and return its result.
 */
function guardClosed(state: OrderState, fn: () => OrderState): OrderState {
  if (state.isClosed) return state
  return fn()
}

// ── Event handlers ───────────────────────────────────────────────────

function handleOrderCreated(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ORDER_CREATED' }>['payload']
): OrderState {
  return {
    ...state,
    locationId: payload.locationId,
    employeeId: payload.employeeId,
    orderType: payload.orderType,
    tableId: payload.tableId ?? null,
    tabName: payload.tabName ?? null,
    guestCount: payload.guestCount,
    orderNumber: payload.orderNumber,
    displayNumber: payload.displayNumber ?? null,
    status: 'open',
  }
}

function handleItemAdded(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ITEM_ADDED' }>['payload']
): OrderState {
  // Idempotent — if lineItemId already exists, no-op
  if (state.items[payload.lineItemId] !== undefined) return state

  const newItem: OrderLineItem = {
    lineItemId: payload.lineItemId,
    menuItemId: payload.menuItemId,
    name: payload.name,
    priceCents: payload.priceCents,
    quantity: payload.quantity ?? 1,
    modifiersJson: payload.modifiersJson ?? null,
    specialNotes: payload.specialNotes ?? null,
    seatNumber: payload.seatNumber ?? null,
    courseNumber: payload.courseNumber ?? null,
    isHeld: payload.isHeld ?? false,
    soldByWeight: payload.soldByWeight ?? false,
    weight: payload.weight ?? null,
    weightUnit: payload.weightUnit ?? null,
    unitPriceCents: payload.unitPriceCents ?? null,
    grossWeight: payload.grossWeight ?? null,
    tareWeight: payload.tareWeight ?? null,
    pricingOptionId: payload.pricingOptionId ?? null,
    pricingOptionLabel: payload.pricingOptionLabel ?? null,
    costAtSaleCents: payload.costAtSaleCents ?? null,
    pourSize: payload.pourSize ?? null,
    pourMultiplier: payload.pourMultiplier ?? null,
    status: 'active',
    isCompleted: false,
    resendCount: 0,
    kitchenStatus: null,
    delayMinutes: null,
    itemDiscounts: {},
  }

  return {
    ...state,
    items: {
      ...state.items,
      [newItem.lineItemId]: newItem,
    },
  }
}

function handleItemRemoved(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ITEM_REMOVED' }>['payload']
): OrderState {
  if (state.items[payload.lineItemId] === undefined) return state

  const { [payload.lineItemId]: _removed, ...remainingItems } = state.items
  return {
    ...state,
    items: remainingItems,
  }
}

function handleItemUpdated(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ITEM_UPDATED' }>['payload']
): OrderState {
  const existing = state.items[payload.lineItemId]
  if (existing === undefined) return state

  const updatedItem: OrderLineItem = {
    ...existing,
    ...(payload.isHeld != null ? { isHeld: payload.isHeld } : {}),
    ...(payload.specialNotes != null ? { specialNotes: payload.specialNotes } : {}),
    ...(payload.courseNumber != null ? { courseNumber: payload.courseNumber } : {}),
    ...(payload.seatNumber != null ? { seatNumber: payload.seatNumber } : {}),
    ...(payload.quantity != null ? { quantity: payload.quantity } : {}),
    ...(payload.delayMinutes != null ? { delayMinutes: payload.delayMinutes } : {}),
    ...(payload.kitchenStatus != null ? { kitchenStatus: payload.kitchenStatus } : {}),
    ...(payload.status != null ? { status: payload.status } : {}),
    ...(payload.isCompleted != null ? { isCompleted: payload.isCompleted } : {}),
    ...(payload.resendCount != null ? { resendCount: payload.resendCount } : {}),
  }

  return {
    ...state,
    items: {
      ...state.items,
      [payload.lineItemId]: updatedItem,
    },
  }
}

function handleOrderSent(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ORDER_SENT' }>['payload']
): OrderState {
  const sendAll = payload.sentItemIds.length === 0
  const sentSet = new Set(payload.sentItemIds)

  const updatedItems: Record<string, OrderLineItem> = {}
  for (const [id, item] of Object.entries(state.items)) {
    const shouldProcess = sendAll || sentSet.has(id)
    if (shouldProcess && !item.isHeld && item.kitchenStatus !== 'FIRED' && item.status === 'active') {
      updatedItems[id] = {
        ...item,
        kitchenStatus: 'FIRED',
        isHeld: false,
      }
    } else {
      updatedItems[id] = item
    }
  }

  return {
    ...state,
    status: state.status === 'open' ? 'sent' : state.status,
    items: updatedItems,
  }
}

function handlePaymentApplied(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'PAYMENT_APPLIED' }>['payload']
): OrderState {
  // Idempotent — if paymentId already exists, no-op
  if (state.payments[payload.paymentId] !== undefined) return state

  const newPayment: OrderPayment = {
    paymentId: payload.paymentId,
    method: payload.method,
    amountCents: payload.amountCents,
    tipCents: payload.tipCents ?? 0,
    totalCents: payload.totalCents,
    cardBrand: payload.cardBrand ?? null,
    cardLast4: payload.cardLast4 ?? null,
    status: payload.status ?? 'approved',
  }

  return {
    ...state,
    payments: {
      ...state.payments,
      [newPayment.paymentId]: newPayment,
    },
  }
}

function handlePaymentVoided(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'PAYMENT_VOIDED' }>['payload']
): OrderState {
  const existing = state.payments[payload.paymentId]
  if (existing === undefined) return state

  return {
    ...state,
    payments: {
      ...state.payments,
      [payload.paymentId]: {
        ...existing,
        status: 'voided',
      },
    },
  }
}

function handleOrderClosed(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ORDER_CLOSED' }>['payload']
): OrderState {
  return {
    ...state,
    status: payload.closedStatus ?? 'paid',
    isClosed: true,
  }
}

function handleOrderReopened(state: OrderState): OrderState {
  return {
    ...state,
    status: 'open',
    isClosed: false,
  }
}

function handleDiscountApplied(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'DISCOUNT_APPLIED' }>['payload']
): OrderState {
  if (payload.lineItemId != null) {
    // Item-level discount
    const existing = state.items[payload.lineItemId]
    if (existing === undefined) return state

    const itemDiscount: ItemDiscount = {
      discountId: payload.discountId,
      amountCents: payload.amountCents,
      percent: payload.type === 'percent' ? payload.value : null,
      reason: payload.reason ?? null,
    }

    return {
      ...state,
      items: {
        ...state.items,
        [payload.lineItemId]: {
          ...existing,
          itemDiscounts: {
            ...existing.itemDiscounts,
            [payload.discountId]: itemDiscount,
          },
        },
      },
    }
  } else {
    // Order-level discount
    const orderDiscount: OrderDiscount = {
      discountId: payload.discountId,
      type: payload.type,
      value: payload.value,
      amountCents: payload.amountCents,
      reason: payload.reason ?? null,
    }

    return {
      ...state,
      discounts: {
        ...state.discounts,
        [payload.discountId]: orderDiscount,
      },
    }
  }
}

function handleDiscountRemoved(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'DISCOUNT_REMOVED' }>['payload']
): OrderState {
  if (payload.lineItemId != null) {
    // Item-level discount removal
    const existing = state.items[payload.lineItemId]
    if (existing === undefined) return state

    const { [payload.discountId]: _removed, ...remainingDiscounts } = existing.itemDiscounts

    return {
      ...state,
      items: {
        ...state.items,
        [payload.lineItemId]: {
          ...existing,
          itemDiscounts: remainingDiscounts,
        },
      },
    }
  } else {
    // Order-level discount removal
    const { [payload.discountId]: _removed, ...remainingDiscounts } = state.discounts

    return {
      ...state,
      discounts: remainingDiscounts,
    }
  }
}

function handleTabOpened(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'TAB_OPENED' }>['payload']
): OrderState {
  return {
    ...state,
    tabStatus: 'open',
    hasPreAuth: payload.preAuthId != null,
    cardLast4: payload.cardLast4 ?? state.cardLast4,
    tabName: payload.tabName ?? state.tabName,
  }
}

function handleTabClosed(state: OrderState): OrderState {
  return {
    ...state,
    tabStatus: 'closed',
  }
}

function handleGuestCountChanged(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'GUEST_COUNT_CHANGED' }>['payload']
): OrderState {
  return {
    ...state,
    guestCount: payload.count,
  }
}

function handleNoteChanged(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'NOTE_CHANGED' }>['payload']
): OrderState {
  return {
    ...state,
    notes: payload.note ?? null,
  }
}

function handleOrderMetadataUpdated(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'ORDER_METADATA_UPDATED' }>['payload']
): OrderState {
  return {
    ...state,
    ...(payload.tabName != null ? { tabName: payload.tabName } : {}),
    ...(payload.tableId != null ? { tableId: payload.tableId } : {}),
    ...(payload.tableName != null ? { tableName: payload.tableName } : {}),
    ...(payload.employeeId != null ? { employeeId: payload.employeeId } : {}),
  }
}

function handleCompVoidApplied(
  state: OrderState,
  payload: Extract<OrderEventPayload, { type: 'COMP_VOID_APPLIED' }>['payload']
): OrderState {
  if (payload.lineItemId == null) return state

  const existing = state.items[payload.lineItemId]
  if (existing === undefined) return state

  let newStatus: string
  switch (payload.action) {
    case 'comp':
      newStatus = 'comped'
      break
    case 'void':
      newStatus = 'voided'
      break
    case 'unvoid':
    case 'uncomp':
      newStatus = 'active'
      break
    default:
      newStatus = existing.status
  }

  return {
    ...state,
    items: {
      ...state.items,
      [payload.lineItemId]: {
        ...existing,
        status: newStatus,
      },
    },
  }
}

// ── Main reducer ─────────────────────────────────────────────────────

/**
 * Pure reducer — handles all 17 event types.
 * Never mutates state; always returns a new object.
 *
 * Guard policy:
 * - NOT guarded (always execute): ORDER_CREATED, PAYMENT_VOIDED,
 *   ORDER_CLOSED, ORDER_REOPENED, TAB_CLOSED
 * - Guarded (no-op when closed): all other 12 types
 */
export function reduce(state: OrderState, event: OrderEventPayload): OrderState {
  switch (event.type) {
    case 'ORDER_CREATED':
      return handleOrderCreated(state, event.payload)

    case 'ITEM_ADDED':
      return guardClosed(state, () => handleItemAdded(state, event.payload))

    case 'ITEM_REMOVED':
      return guardClosed(state, () => handleItemRemoved(state, event.payload))

    case 'ITEM_UPDATED':
      return guardClosed(state, () => handleItemUpdated(state, event.payload))

    case 'ORDER_SENT':
      return guardClosed(state, () => handleOrderSent(state, event.payload))

    case 'PAYMENT_APPLIED':
      return guardClosed(state, () => handlePaymentApplied(state, event.payload))

    case 'PAYMENT_VOIDED':
      return handlePaymentVoided(state, event.payload)

    case 'ORDER_CLOSED':
      return handleOrderClosed(state, event.payload)

    case 'ORDER_REOPENED':
      return handleOrderReopened(state)

    case 'DISCOUNT_APPLIED':
      return guardClosed(state, () => handleDiscountApplied(state, event.payload))

    case 'DISCOUNT_REMOVED':
      return guardClosed(state, () => handleDiscountRemoved(state, event.payload))

    case 'TAB_OPENED':
      return guardClosed(state, () => handleTabOpened(state, event.payload))

    case 'TAB_CLOSED':
      return handleTabClosed(state)

    case 'GUEST_COUNT_CHANGED':
      return guardClosed(state, () => handleGuestCountChanged(state, event.payload))

    case 'NOTE_CHANGED':
      return guardClosed(state, () => handleNoteChanged(state, event.payload))

    case 'ORDER_METADATA_UPDATED':
      return guardClosed(state, () => handleOrderMetadataUpdated(state, event.payload))

    case 'COMP_VOID_APPLIED':
      return guardClosed(state, () => handleCompVoidApplied(state, event.payload))

    default: {
      // Exhaustive check — TypeScript will error if a case is missing
      const _exhaustive: never = event
      return state
    }
  }
}

// ── Replay ───────────────────────────────────────────────────────────

/**
 * Replays an ordered list of events from an empty state to produce
 * the current OrderState. Equivalent to Android's OrderReducer.replay().
 */
export function replay(orderId: string, events: OrderEventPayload[]): OrderState {
  return events.reduce<OrderState>(reduce, emptyOrderState(orderId))
}
