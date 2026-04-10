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
  // If payments array exists, normalize field names inside each entry.
  // Android sends { paymentMethod: "cash" } but schema expects { method: "cash" }.
  if (Array.isArray(body.payments)) {
    body.payments = (body.payments as Record<string, unknown>[]).map(p => {
      if (p.paymentMethod && !p.method) {
        return { ...p, method: p.paymentMethod, paymentMethod: undefined }
      }
      if (p.paymentMethodId && !p.method) {
        return { ...p, method: p.paymentMethodId, paymentMethodId: undefined }
      }
      return p
    })
    return body
  }

  if (!(body.paymentMethodId || body.paymentMethod || body.method || body.amount)) {
    return body
  }

  const method = body.paymentMethodId || body.paymentMethod || body.method || 'cash'
  return {
    payments: [{
      method,
      amount: body.amount,
      ...(body.tipAmount !== undefined ? { tipAmount: body.tipAmount } : {}),
      ...(body.amountTendered !== undefined ? { amountTendered: body.amountTendered } : {}),
      ...(body.cardLast4 !== undefined ? { cardLast4: body.cardLast4 } : {}),
      // Map Android PaymentReconciliationWorker fields
      ...(body.authCode !== undefined ? { authCode: body.authCode } : {}),
      ...(body.recordNo !== undefined ? { datacapRecordNo: body.recordNo } : {}),
      ...(body.datacapRecordNo !== undefined ? { datacapRecordNo: body.datacapRecordNo } : {}),
      // Card type / entry method fields (Android sends cardType from Datacap, map to cardBrand)
      ...(body.cardType !== undefined && !body.cardBrand ? { cardBrand: body.cardType } : {}),
      ...(body.cardBrand !== undefined ? { cardBrand: body.cardBrand } : {}),
      ...(body.entryMethod !== undefined ? { entryMethod: body.entryMethod } : {}),
      ...(body.storedOffline !== undefined ? { storedOffline: body.storedOffline } : {}),
      // Pricing tier fields (Payment & Pricing Redesign)
      ...(body.appliedPricingTier !== undefined ? { appliedPricingTier: body.appliedPricingTier } : {}),
      ...(body.detectedCardType !== undefined ? { detectedCardType: body.detectedCardType } : {}),
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
