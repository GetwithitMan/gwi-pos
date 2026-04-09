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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SHOW_ORDER_DETAIL, payload).catch((err) => log.error({ err }, 'CFD show-order-detail dispatch failed'))
    // Also emit as show-order so Android CFD picks it up (it doesn't handle show-order-detail)
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order (from detail) dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER_DETAIL, payload).catch((err) => log.error({ err }, 'CFD show-order-detail dispatch failed'))
    void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order (from detail) dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.PAYMENT_STARTED, payload).catch((err) => log.error({ err }, 'CFD payment-started dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.PAYMENT_STARTED, payload).catch((err) => log.error({ err }, 'CFD payment-started dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.TIP_PROMPT, payload).catch((err) => log.error({ err }, 'CFD tip-prompt dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.TIP_PROMPT, payload).catch((err) => log.error({ err }, 'CFD tip-prompt dispatch failed'))
  }
}

/**
 * Dispatch CFD tip-selected event (CFD → Register)
 *
 * Called when the customer selects a tip amount on the Customer-Facing Display.
 * Relays the tip selection to the paired register terminal.
 * This is the reverse direction compared to most CFD dispatches — data flows
 * FROM the CFD TO the register, not FROM the register TO the CFD.
 *
 * When called via API, cfdTerminalId identifies the CFD that received the input.
 * The function looks up the paired register and emits the tip selection there.
 *
 * Android CFD sends { orderId, tipAmountCents, tipPercent? } to the register.
 */
export async function dispatchCFDTipSelected(
  locationId: string,
  cfdTerminalId: string | null | undefined,
  data: { orderId: string; tipAmountCents: number; tipPercent?: number }
): Promise<void> {
  if (!cfdTerminalId) {
    // Without a CFD terminal ID, we cannot identify the paired register
    log.warn({ locationId }, 'CFD tip-selected dispatch: no cfdTerminalId provided, ignoring')
    return
  }

  const payload = {
    ...data,
    // Ensure cents are explicitly included for register
    tipAmountCents: data.tipAmountCents,
  }

  // Import here to avoid circular dependencies
  const { globalForSocket } = await import('@/lib/socket-server')
  const { db } = await import('@/lib/db')

  // Try cached mapping first (no DB query needed)
  const { cfdToRegisterMap } = await import('@/lib/socket-server')
  const cachedRegisterId = cfdToRegisterMap.get(cfdTerminalId)
  if (cachedRegisterId) {
    // Check if the target register is online (has sockets in its terminal room)
    const room = `terminal:${cachedRegisterId}`
    const roomSockets = globalForSocket.socketServer?.sockets.adapter.rooms.get(room)
    if (!roomSockets || roomSockets.size === 0) {
      log.warn({ cfdTerminalId, registerId: cachedRegisterId }, 'CFD tip-selected: paired register is offline')
      return
    }
    void emitToTerminal(cachedRegisterId, CFD_EVENTS.TIP_SELECTED, payload).catch((err) =>
      log.error({ err, cfdTerminalId }, 'CFD tip-selected dispatch failed')
    )
    return
  }

  // Cache miss — fall back to DB lookup with 5s timeout
  try {
    const register = await Promise.race([
      db.terminal.findFirst({
        where: { cfdTerminalId, deletedAt: null },
        select: { id: true },
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('CFD-to-register DB lookup timed out (5s)')), 5000)
      ),
    ])

    if (!register) {
      log.warn({ cfdTerminalId }, 'CFD tip-selected: no paired register found in DB')
      return
    }

    // Populate cache for future relays
    const { setCfdMapping } = await import('@/lib/socket-server')
    setCfdMapping(cfdTerminalId, register.id)

    // Check if the target register is online
    const room = `terminal:${register.id}`
    const roomSockets = globalForSocket.socketServer?.sockets.adapter.rooms.get(room)
    if (!roomSockets || roomSockets.size === 0) {
      log.warn({ cfdTerminalId, registerId: register.id }, 'CFD tip-selected: paired register is offline')
      return
    }

    void emitToTerminal(register.id, CFD_EVENTS.TIP_SELECTED, payload).catch((err) =>
      log.error({ err, cfdTerminalId }, 'CFD tip-selected dispatch failed')
    )
  } catch (err) {
    log.error({ err, cfdTerminalId }, 'CFD tip-selected lookup or dispatch failed')
  }
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SIGNATURE_REQUEST, payload).catch((err) => log.error({ err }, 'CFD signature-request dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SIGNATURE_REQUEST, payload).catch((err) => log.error({ err }, 'CFD signature-request dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.RECEIPT_SENT, payload).catch((err) => log.error({ err }, 'CFD receipt-sent dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.RECEIPT_SENT, payload).catch((err) => log.error({ err }, 'CFD receipt-sent dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.PROCESSING, data).catch((err) => log.error({ err }, 'CFD processing dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.PROCESSING, data).catch((err) => log.error({ err }, 'CFD processing dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.APPROVED, payload).catch((err) => log.error({ err }, 'CFD approved dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.APPROVED, payload).catch((err) => log.error({ err }, 'CFD approved dispatch failed'))
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
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.DECLINED, data).catch((err) => log.error({ err }, 'CFD declined dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.DECLINED, data).catch((err) => log.error({ err }, 'CFD declined dispatch failed'))
  }
}

/**
 * Dispatch CFD idle event
 *
 * Called after payment completes (success or cancel) to return CFD to idle screen.
 */
export function dispatchCFDIdle(locationId: string, cfdTerminalId: string | null): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.IDLE, {}).catch((err) => log.error({ err }, 'CFD idle dispatch failed'))
  } else {
    void emitToLocation(locationId, CFD_EVENTS.IDLE, {}).catch((err) => log.error({ err }, 'CFD idle dispatch failed'))
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
  // Also emit as show-order so Android CFD picks up the update (it doesn't handle order-updated)
  void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER, payload).catch((err) => log.error({ err }, 'CFD show-order (from update) dispatch failed'))
}

