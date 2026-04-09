/**
 * CFD (Customer-Facing Display) socket dispatchers
 *
 * Handles: show order, order detail, payment started, tip prompt,
 * signature request, receipt sent, processing, approved, declined,
 * idle, order updated, charge card, cancel charge.
 */

import { CFD_EVENTS } from '@/types/multi-surface'
import {
  log,
  emitToLocation,
  emitToTerminal,
  toCents,
} from './emit-helpers'

/**
 * Emit to a specific CFD terminal, falling back to location broadcast if the
 * CFD has no active sockets (offline / disconnected).
 *
 * Uses the Socket.IO adapter rooms map (same pattern as emitCriticalToLocation
 * in socket-server.ts) to check for connected sockets without an async
 * fetchSockets() round-trip.
 */
async function emitToCfdOrFallback(
  cfdTerminalId: string,
  locationId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const { globalForSocket } = await import('@/lib/socket-server')
  const room = `terminal:${cfdTerminalId}`
  const roomSockets = globalForSocket.socketServer?.sockets.adapter.rooms.get(room)

  if (roomSockets && roomSockets.size > 0) {
    // CFD is online — emit directly to its terminal room
    void emitToTerminal(cfdTerminalId, event, data).catch((err) =>
      log.error({ err, cfdTerminalId, event }, 'emitToCfdOrFallback: terminal emit failed'))
  } else {
    // CFD is offline — fall back to location broadcast so other CFDs or
    // web dashboards in the same venue can pick it up
    log.warn({ cfdTerminalId, locationId, event }, 'emitToCfdOrFallback: CFD terminal offline, falling back to location broadcast')
    void emitToLocation(locationId, event, data).catch((err) =>
      log.error({ err, locationId, event }, 'emitToCfdOrFallback: location fallback emit failed'))
  }
}

/**
 * Dispatch CFD show-order event
 *
 * Called when the payment modal opens with order data.
 * Sends order line items and totals to the Customer-Facing Display.
 * Includes both dollar fields (web CFD) and cent fields (Android CFD).
 */
export function dispatchCFDShowOrder(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  orderNumber: number
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[] }>
  subtotal: number
  tax: number
  total: number
  taxFromInclusive?: number
  taxFromExclusive?: number
}): void {
  const payload = {
    ...data,
    // Android CFD expects cent-denominated fields
    subtotalCents: toCents(data.subtotal),
    taxCents: toCents(data.tax),
    totalCents: toCents(data.total),
    items: data.items.map((item) => ({
      ...item,
      priceCents: toCents(item.price),
      modifierLines: item.modifiers ?? [],
    })),
    currency: 'USD',
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.SHOW_ORDER, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD show-order skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD show-order-detail event
 *
 * Called just before payment to show the customer a full itemized confirmation
 * on the CFD screen. Includes item names, quantities, prices, and modifiers.
 * Also emits as cfd:show-order so the Android CFD (which doesn't handle
 * show-order-detail separately) displays the latest items and totals.
 */
export function dispatchCFDShowOrderDetail(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  orderNumber: number
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[] }>
  subtotal: number
  tax: number
  total: number
  discountTotal?: number
  taxFromInclusive?: number
  taxFromExclusive?: number
}): void {
  const payload = {
    ...data,
    // Android CFD expects cent-denominated fields
    subtotalCents: toCents(data.subtotal),
    taxCents: toCents(data.tax),
    totalCents: toCents(data.total),
    items: data.items.map((item) => ({
      ...item,
      priceCents: toCents(item.price),
      modifierLines: item.modifiers ?? [],
    })),
    currency: 'USD',
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.SHOW_ORDER_DETAIL, payload)
    // Also emit as show-order so Android CFD picks it up (it doesn't handle show-order-detail)
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.SHOW_ORDER, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD show-order-detail skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD payment-started event
 *
 * Called when the card reader is activated for a transaction.
 * Transitions the CFD from the order screen to the payment screen.
 * Android CFD expects { orderId, totalCents }.
 */
export function dispatchCFDPaymentStarted(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  amount: number
  paymentMethod: string
}): void {
  const payload = {
    ...data,
    totalCents: toCents(data.amount),
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.PAYMENT_STARTED, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD payment-started skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD tip-prompt event
 *
 * Called when the tip selection step is shown to the cashier.
 * Optionally mirrors tip options to the CFD screen.
 * Android CFD expects { totalCents, tipMode, tipOptions (CSV), tipStyle, showNoTip }.
 */
export function dispatchCFDTipPrompt(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  subtotal: number
  suggestedTips: Array<{ label: string; percent: number; amount: number }>
}): void {
  // POS suggested tips are always percent-based
  const tipStyle = 'percent' as const
  const tipOptions = data.suggestedTips.map((t) => t.percent).join(',')
  const payload = {
    ...data,
    totalCents: toCents(data.subtotal),
    tipMode: 'pre_tap',
    tipOptions,           // CSV e.g. "15,18,20,25"
    tipStyle,             // "percent" or "dollar"
    showNoTip: true,      // Always allow "No Tip" option
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.TIP_PROMPT, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD tip-prompt skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD tip-selected event (CFD → Register)
 *
 * Called when the customer selects a tip amount on the Customer-Facing Display.
 * Relays the tip selection to the paired register terminal.
 */
export async function dispatchCFDTipSelected(
  locationId: string,
  cfdTerminalId: string | null | undefined,
  data: { orderId: string; tipAmountCents: number; tipPercent?: number }
): Promise<void> {
  if (cfdTerminalId) {
    // Import here to avoid circular dependencies
    const { cfdToRegisterMap } = await import('@/lib/socket-server')
    const registerId = cfdToRegisterMap.get(cfdTerminalId)

    if (registerId) {
      void emitToTerminal(registerId, CFD_EVENTS.TIP_SELECTED, data).catch((err) =>
        log.error({ err }, 'Failed to relay tip selection to register')
      )
      return
    }
  }

  // Fallback: broadcast to location if no paired register found
  void emitToLocation(locationId, CFD_EVENTS.TIP_SELECTED, data).catch((err) =>
    log.error({ err }, 'Failed to broadcast tip selection')
  )
}

/**
 * Dispatch CFD signature-request event
 *
 * Called when the payment terminal requires a signature from the customer.
 * Transitions the CFD to the signature capture screen.
 * Android CFD expects { amountCents, enabled, thresholdCents }.
 */
export function dispatchCFDSignatureRequest(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  transactionId?: string
  amount?: number
  signatureThreshold?: number
}): void {
  const payload = {
    ...data,
    amountCents: toCents(data.amount ?? 0),
    enabled: true,
    thresholdCents: toCents(data.signatureThreshold ?? 0),
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.SIGNATURE_REQUEST, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD signature-request skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD receipt-sent event
 *
 * Called after a successful payment DB write when the order is fully paid.
 * Transitions the CFD to the receipt/thank-you screen.
 * Android CFD expects { orderId, emailEnabled, smsEnabled, printEnabled, timeoutSeconds }.
 */
export function dispatchCFDReceiptSent(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  total: number
  emailEnabled?: boolean
  smsEnabled?: boolean
  printEnabled?: boolean
  timeoutSeconds?: number
}): void {
  const payload = {
    ...data,
    emailEnabled: data.emailEnabled ?? true,
    smsEnabled: data.smsEnabled ?? true,
    printEnabled: data.printEnabled ?? true,
    timeoutSeconds: data.timeoutSeconds ?? 30,
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.RECEIPT_SENT, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD receipt-sent skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD processing event
 *
 * Called when the card authorization starts (waiting for processor response).
 * Transitions the CFD to the processing spinner screen.
 */
export function dispatchCFDProcessing(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
}): void {
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.PROCESSING, data)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD processing skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD approved event
 *
 * Called when the card payment is approved.
 * Transitions the CFD to the approved/thank-you screen.
 * Android CFD expects { amountCents, last4? }.
 */
export function dispatchCFDApproved(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  last4?: string
  cardType?: string
  tipAmount?: number
  total?: number
}): void {
  const payload = {
    ...data,
    amountCents: toCents(data.total ?? 0),
  }
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.APPROVED, payload)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD approved skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD declined event
 *
 * Called when the card payment is declined.
 * Transitions the CFD to the declined screen with reason text.
 */
export function dispatchCFDDeclined(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  reason: string
}): void {
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.DECLINED, data)
  } else {
    log.debug({ locationId, orderId: data.orderId }, 'CFD declined skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD idle event
 *
 * Called after payment completes (success or cancel) to return CFD to idle screen.
 */
export function dispatchCFDIdle(locationId: string, cfdTerminalId: string | null): void {
  if (cfdTerminalId) {
    void emitToCfdOrFallback(cfdTerminalId, locationId, CFD_EVENTS.IDLE, {})
  } else {
    log.debug({ locationId }, 'CFD idle skipped: no cfdTerminalId provided')
  }
}

/**
 * Dispatch CFD order updated event
 *
 * Called after order mutations (discount, void, merge, comp) so the
 * customer-facing display shows the latest items and totals instantly.
 * Broadcasts to location (all CFDs will filter by orderId).
 * Also emits as cfd:show-order so the Android CFD (which doesn't handle
 * cfd:order-updated) refreshes its display.
 */
export function dispatchCFDOrderUpdated(locationId: string, data: {
  orderId: string
  orderNumber: number
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[]; status?: string }>
  subtotal: number
  tax: number
  total: number
  discountTotal?: number
  taxFromInclusive?: number
  taxFromExclusive?: number
}): void {
  const payload = {
    ...data,
    subtotalCents: toCents(data.subtotal),
    taxCents: toCents(data.tax),
    totalCents: toCents(data.total),
    items: data.items.map((item) => ({
      ...item,
      priceCents: toCents(item.price),
      modifierLines: item.modifiers ?? [],
    })),
    currency: 'USD',
  }
  void emitToLocation(locationId, CFD_EVENTS.ORDER_UPDATED, payload).catch((err) => log.error({ err }, 'CFD order-updated dispatch failed'))
  // Also emit as show-order so Android CFD picks it up (it doesn't handle order-updated)
  void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order (from update) dispatch failed'))
}
