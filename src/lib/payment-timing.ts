// Payment flow timing instrumentation
// Captures 4 timestamps per flow: click → request → gateway → ui_unblocked

export interface PaymentTimingEntry {
  flow: 'send' | 'start_tab' | 'add_to_tab' | 'pay_close'
  t_click: number
  t_request_sent?: number
  t_gateway_response?: number
  t_ui_unblocked?: number
  orderId?: string
  method?: string
  result?: 'success' | 'declined' | 'timeout' | 'error'
}

/** Start a timing session — call on button click / action start */
export function startPaymentTiming(flow: PaymentTimingEntry['flow'], orderId?: string): PaymentTimingEntry {
  return { flow, t_click: performance.now(), orderId }
}

/** Mark when the network request is sent */
export function markRequestSent(entry: PaymentTimingEntry): void {
  entry.t_request_sent = performance.now()
}

/** Mark when the payment gateway responds (card flows only) */
export function markGatewayResponse(entry: PaymentTimingEntry): void {
  entry.t_gateway_response = performance.now()
}

/** Complete timing — logs structured JSON to console */
export function completePaymentTiming(
  entry: PaymentTimingEntry,
  result: PaymentTimingEntry['result'],
  extra?: Record<string, unknown>
): void {
  entry.t_ui_unblocked = performance.now()
  entry.result = result

  const total_ms = Math.round(entry.t_ui_unblocked - entry.t_click)
  const request_to_gateway_ms = entry.t_request_sent != null && entry.t_gateway_response != null
    ? Math.round(entry.t_gateway_response - entry.t_request_sent)
    : undefined
  const gateway_to_ui_ms = entry.t_gateway_response != null
    ? Math.round(entry.t_ui_unblocked - entry.t_gateway_response)
    : undefined

  console.info('[PAYMENT-TIMING]', JSON.stringify({
    flow: entry.flow,
    result: entry.result,
    orderId: entry.orderId,
    method: entry.method,
    total_ms,
    request_to_gateway_ms,
    gateway_to_ui_ms,
    ...extra,
  }))
}
