/**
 * Payment Input Normalization
 *
 * Converts legacy/Android flat payment format to the normalized { payments: [...] } shape.
 * PURE function — no DB, no side effects.
 */

/**
 * Normalize legacy / Android offline-sync payment format.
 *
 * Old callers (and PendingPayment offline queue) send a flat object:
 *   { paymentMethodId: "cash", amount: 123, tipAmount: 0, employeeId: "..." }
 * Android native sends:
 *   { paymentMethod: "cash", amount: 159.12, tipAmount: 0, employeeId: "..." }
 * The Zod schema expects:
 *   { payments: [{ method: "cash", amount: 123 }], employeeId: "..." }
 *
 * Transform the flat shape so both formats are accepted.
 */
export function normalizePaymentInput(body: Record<string, unknown>): Record<string, unknown> {
  if (body.payments || !(body.paymentMethodId || body.paymentMethod || body.method || body.amount)) {
    return body
  }

  const method = body.paymentMethodId || body.paymentMethod || body.method || 'cash'
  return {
    payments: [{
      method,
      amount: body.amount,
      ...(body.tipAmount !== undefined ? { tipAmount: body.tipAmount } : {}),
      ...(body.amountTendered !== undefined ? { amountTendered: body.amountTendered } : {}),
      ...(body.cardBrand !== undefined ? { cardBrand: body.cardBrand } : {}),
      ...(body.cardLast4 !== undefined ? { cardLast4: body.cardLast4 } : {}),
      // Map Android PaymentReconciliationWorker fields
      ...(body.authCode !== undefined ? { authCode: body.authCode } : {}),
      ...(body.recordNo !== undefined ? { datacapRecordNo: body.recordNo } : {}),
      ...(body.datacapRecordNo !== undefined ? { datacapRecordNo: body.datacapRecordNo } : {}),
      // House account / gift card fields
      ...(body.houseAccountId !== undefined ? { houseAccountId: body.houseAccountId } : {}),
      ...(body.giftCardId !== undefined ? { giftCardId: body.giftCardId } : {}),
      ...(body.giftCardNumber !== undefined ? { giftCardNumber: body.giftCardNumber } : {}),
    }],
    ...(body.employeeId ? { employeeId: body.employeeId } : {}),
    ...(body.terminalId ? { terminalId: body.terminalId } : {}),
    ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
  }
}
