# Tip Adjustment Flow

End-to-end flow for post-payment tip adjustments, chargebacks, and CFD tip collection.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/adjust-tip/route.ts` | PATCH endpoint for tip adjustment |
| `src/app/api/orders/batch-adjust-tips/route.ts` | Batch tip adjustment for multiple orders |
| `src/lib/domain/tips/tip-ledger.ts` | `postToTipLedger()` — immutable ledger entries |
| `src/lib/domain/tips/tip-chargebacks.ts` | `handleTipChargeback()` — reversal on void/refund |
| `src/lib/datacap/client.ts` | `adjustGratuity()` — Datacap AdjustByRecordNo |
| `src/components/orders/AdjustTipModal.tsx` | UI modal for tip adjustment |
| `src/components/tips/TipAdjustmentOverlay.tsx` | UI overlay component |

## Post-Payment Tip Adjustment Window

Tips can be adjusted within **24 hours** of order close. After that, the adjust-tip endpoint rejects the request:

```typescript
if (order.closedAt) {
  const hoursSinceClose = (Date.now() - new Date(order.closedAt).getTime()) / (1000 * 60 * 60)
  if (hoursSinceClose > 24) {
    return err('Cannot adjust tip more than 24 hours after order close')
  }
}
```

Additional guards:
- Cannot adjust tips on voided or cancelled orders
- Cannot increase tips on gift card payments (balance already consumed)
- Tip cap: 500% of base amount (`payment.amount * 5`). If base is $0, no tip allowed.
- Requires `TIPS_PERFORM_ADJUSTMENTS` permission (manager-level)

## Datacap AdjustByRecordNo Call

For card payments that have a `datacapRecordNo` and `paymentReaderId`, the tip adjustment is sent to Datacap BEFORE updating the local database:

1. Get `DatacapClient` for the location
2. Call `client.adjustGratuity(readerId, { recordNo, purchaseAmount, gratuityAmount })`
3. This sends `TranCode: AdjustByRecordNo` to the reader
4. If Datacap approves: proceed with local DB update
5. If Datacap declines: return error, do NOT update local DB
6. If Datacap unreachable: return 503, do NOT update local DB

This "Datacap-first" approach ensures the local ledger never diverges from the processor. The `adjustGratuity` call is wrapped in `withPadReset()`, which automatically resets the reader afterward.

## Tip Increase vs Reduction

Both increases and reductions follow the same flow. The difference is in the ledger entry type:

| Direction | Datacap Call | Ledger Entry |
|-----------|-------------|--------------|
| Increase | `adjustGratuity(newHigherAmount)` | `CREDIT` with `sourceType: 'ADJUSTMENT'` |
| Reduction | `adjustGratuity(newLowerAmount)` | `DEBIT` with `sourceType: 'ADJUSTMENT'` |

The delta is calculated as `newTipAmount - oldTipAmount`. A positive delta creates CREDIT entries; a negative delta creates DEBIT entries.

## Database Updates (Inside Transaction)

The adjust-tip endpoint runs inside a `$transaction` with a `FOR UPDATE` lock on the Payment row to prevent concurrent adjustments:

1. `SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE` (row lock)
2. Validate order status, time window, tip cap
3. Call Datacap `adjustGratuity` (while lock is held)
4. Update `Payment.tipAmount` and `Payment.totalAmount`
5. Recalculate `Order.tipTotal` from all payments
6. Recalculate `Order.total` (subtotal + tax - discounts + tipTotal + donations + convenienceFee)

## Tip Chargeback on Void/Refund

When a payment is voided or refunded, `handleTipChargeback()` in `tip-chargebacks.ts` reverses the tip allocation. Two policies are available, controlled by location settings (`settings.tipBank.chargebackPolicy`):

### Policy 1: BUSINESS_ABSORBS

- The tip stays in each employee's ledger
- The business absorbs the loss
- TipTransaction records are soft-deleted for audit
- No DEBIT entries created
- Simplest for staff, most expensive for the business

### Policy 2: EMPLOYEE_CHARGEBACK

- Proportional DEBIT entries reverse each employee's original CREDIT
- Original CREDIT entries are found via `sourceId` = `tipTransaction.id`
- Each employee's debit is proportional to their share of the original allocation
- Last entry absorbs rounding remainder

**Negative balance protection:** If `settings.tipBank.allowNegativeBalances` is false, each debit is capped at the employee's current balance. The uncollectable remainder is tracked in `flaggedForReviewCents`.

**Partial refund support:** Pass `tipReductionCents` to reverse only a portion of the tip (for partial refunds). The reduction is distributed proportionally across all CREDIT entries.

## TipDebt Creation for Chargebacks

When an employee's balance cannot cover their chargeback amount (negative balance protection is on), a `TipDebt` record is created:

```typescript
db.tipDebt.create({
  data: {
    locationId,
    employeeId,
    originalAmountCents: remainderCents,
    remainingCents: remainderCents,
    sourcePaymentId: paymentId,
    sourceType: 'CHARGEBACK',
    status: 'open',
  }
})
```

TipDebt statuses: `open`, `partial`, `recovered`

### Auto-Reclaim on Future Tips

When a new CREDIT is posted to an employee's ledger (they earn a new tip), the `autoReclaimTipDebts()` function in `tip-ledger.ts` automatically:

1. Finds open debts for the employee (oldest first, FIFO)
2. Posts DEBIT entries to reclaim from the credit amount
3. Updates `TipDebt.remainingCents` and status
4. Stops when the credit is fully consumed or all debts are satisfied

This means tip debts are automatically recovered from future earnings without manual intervention.

## TipLedger Immutability

**INVARIANT-6:** TipLedgerEntry records are IMMUTABLE. The system never updates or deletes existing entries. All changes are expressed as new entries:

- Tip increase: new CREDIT entry with `sourceType: 'ADJUSTMENT'`
- Tip decrease: new DEBIT entry with `sourceType: 'ADJUSTMENT'`
- Chargeback: new DEBIT entry with `sourceType: 'CHARGEBACK'`
- Transfer: DEBIT on source employee, CREDIT on destination employee
- Payout: DEBIT entry with `sourceType: 'PAYOUT_CASH'` or `'PAYOUT_PAYROLL'`

The `TipLedger.currentBalanceCents` is a cached running total, updated atomically with each new entry via `{ increment: signedAmount }`. The `recalculateBalance()` function can verify the cached value against the sum of all entries.

### Ledger Entry Source Types

| sourceType | Created By |
|-----------|-----------|
| `DIRECT_TIP` | Single-employee tip allocation |
| `TIP_GROUP` | Group tip pool allocation |
| `ROLE_TIPOUT` | Automatic role-based tip-out at shift close |
| `MANUAL_TRANSFER` | Manager-initiated tip transfer between employees |
| `PAYOUT_CASH` | Cash payout to employee |
| `PAYOUT_PAYROLL` | Payroll payout |
| `CHARGEBACK` | Void/refund reversal |
| `ADJUSTMENT` | Post-payment tip adjustment (increase or decrease) |
| `DELIVERY_REALLOCATION` | Delivery tip reallocation |

## CFD Tip Collection Integration

The customer-facing display (CFD) can collect tips via the Datacap `GetSuggestiveTip` prompt:

1. POS calls `client.getSuggestiveTip(readerId, suggestions)` with configurable percentage/dollar amounts
2. Reader displays tip options on the customer-facing screen
3. Customer selects a tip amount on the reader
4. Response includes the selected tip amount
5. POS adds the tip to the payment before capture

Default suggestions: `[15%, 18%, 20%, 25%]` (percentages) or `[$1, $2, $3]` (dollar amounts for checks under `$15`).

These defaults are in `constants.ts`:
- `DEFAULT_TIP_SUGGESTIONS = [15, 18, 20, 25]`
- `DEFAULT_TIP_DOLLAR_SUGGESTIONS = [1, 2, 3]`
- `DEFAULT_TIP_DOLLAR_THRESHOLD = 15`

## Adjust-Tip Ledger Delta Flow

After a successful adjustment, the endpoint posts proportional delta entries to the tip ledger (fire-and-forget):

1. Find the existing `TipTransaction` for the payment
2. Find all original CREDIT entries (with `sourceType: 'DIRECT_TIP'` or `'TIP_GROUP'`)
3. Calculate each employee's proportional share of the delta
4. Post a CREDIT (increase) or DEBIT (decrease) for each employee via `postToTipLedger()`
5. Update the `TipTransaction.amountCents` to reflect the new total
6. Last entry absorbs rounding remainder

Each ledger entry includes an `idempotencyKey` with format `tip-adjust:{orderId}:{paymentId}:{employeeId}:{timestamp}` to prevent double-posting if the fire-and-forget retries.

## Event and Sync Side Effects

After a tip adjustment, the endpoint fires (all fire-and-forget):

1. `dispatchOrderTotalsUpdate()` — cross-terminal total sync
2. `dispatchOrderSummaryUpdated()` — order list refresh
3. `dispatchOpenOrdersChanged()` — triggers order list rebuild
4. `emitOrderEvent('PAYMENT_APPLIED')` — event sourcing
5. `pushUpstream()` — Neon sync
6. If in outage mode: queues Payment and Order to `OutageQueueEntry`
7. Creates audit log entry: `action: 'tip_adjusted'` with old/new amounts and reason

Split orders: if the order is a split child, the parent order's `tipTotal` is also recalculated from all child payments.
