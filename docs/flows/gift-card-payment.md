# Flow: Gift Card Payment

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A server selects "Gift Card" as the payment method in the PaymentSheet (web POS or Android), then enters or scans a card number. The system validates the card, deducts the redemption amount atomically, and records the payment against the order.

**Why it matters:** Money integrity. A gift card balance is a liability the venue owes the cardholder. If the balance is decremented without a `GiftCardTransaction` record, or decremented twice for the same order (TOCTOU race), the venue either over-pays or leaves an invalid balance — both damage trust and revenue accuracy.

**Scope:** `gwi-pos` (API, gift card model, pay route, socket server, receipt printer), `gwi-android-register` (PayOrderUseCase, payment flow). CFD is not involved in gift card redemption (no tip prompt).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `settings.payments.acceptGiftCards` must be `true` at the location; otherwise `POST /api/orders/[id]/pay` returns 400 |
| Hardware required | Receipt printer (fire-and-forget, not blocking); no card reader required — gift cards are software-only |
| Permissions required | `pos.cash_payments` (same permission as cash — gift card is treated as a soft-currency tender); `manager.void_payments` only for void path |
| Online / offline state | Gift card redemption REQUIRES NUC connectivity — balance lookup and atomic decrement cannot be deferred offline. Offline gift card payments are not supported. |
| Prior state | An open `GiftCard` with `status: 'active'`, `currentBalance > 0`, and `expiresAt` either null or in the future; an open `Order` with `isClosed: false` and a positive `totalCents` |

---

## 3. Sequence (Happy Path)

```
1.  [CLIENT]      Server opens PaymentSheet on order, selects "Gift Card"
                  Enters card number manually (format GC-XXXX-XXXX-XXXX)
                  or scans barcode/QR (Android: PayOrderUseCase)
                  Client optionally calls GET /api/gift-cards/[number]
                    to show current balance before committing
                  Client generates idempotencyKey (UUID) on pay button press

2.  [API]         POST /api/orders/[id]/pay
                  Body: { payments: [{ method: 'gift_card',
                           amount,
                           giftCardId? | giftCardNumber?,
                           idempotencyKey }] }
                  → withVenue() — resolves locationId from session
                  → check settings.payments.acceptGiftCards (return 400 if false)
                  → validate giftCardId or giftCardNumber is present
                  → load OrderSnapshot — verify isClosed: false

3.  [DB]          db.$transaction (atomic — prevents TOCTOU race):
                    → tx.giftCard.findUnique by id or cardNumber (case-insensitive)
                    → verify giftCard.status === 'active'
                    → verify giftCard.expiresAt is null or future
                       (if expired: update status → 'expired', throw GC_EXPIRED)
                    → verify cardBalance >= paymentAmount
                       (if insufficient: throw GC_INSUFFICIENT:{balance})
                    → tx.giftCard.update:
                        currentBalance: { decrement: paymentAmount }  ← atomic
                        status: newBalance === 0 ? 'depleted' : 'active'
                    → GiftCardTransaction created (nested create inside update):
                        type: 'redemption'
                        amount: -paymentAmount   ← negative for redemptions
                        balanceBefore, balanceAfter
                        orderId, employeeId
                        notes: 'Payment for order #N'

4.  [DB]          Payment record created (after gcResult success):
                    paymentMethod: 'gift_card'
                    amount: paymentAmount
                    status: 'completed'
                    transactionId: 'GC:{cardNumber}'
                    cardLast4: last 4 chars of cardNumber
                    idempotencyKey

5.  [EVENTS]      void emitOrderEvent(locationId, orderId, 'PAYMENT_APPLIED', {
                    paymentId, amountCents: paymentAmount * 100,
                    tipAmountCents: 0,
                    paymentMethod: 'gift_card'
                  }).catch(console.error)

6.  [SNAPSHOT]    Reducer applies PAYMENT_APPLIED →
                  OrderSnapshot { paidAmountCents += paymentAmount * 100,
                    status: 'paid' (if fully paid), isClosed: true,
                    lastEventSequence: N }
                  If paidAmountCents >= totalCents:
                    emitOrderEvent('ORDER_CLOSED', { closedAt })

7.  [BROADCAST]   emitToLocation(locationId, 'order:event',
                    { type: 'PAYMENT_APPLIED', orderId, serverSequence, ... })
                  emitToLocation(locationId, 'payment:applied',
                    { orderId, paymentId, status: 'completed' })
                  dispatchOrderTotalsUpdate(locationId, orderId, totals)
                  dispatchOpenOrdersChanged(locationId, { orderId })
                  dispatchOrderSummaryUpdated(locationId, summary)

8.  [SIDE EFFECTS — all fire-and-forget]
                  void allocateTipsForPayment(paymentId).catch(console.error)
                    → no tip on gift card (tipAmount is 0), but ledger records clean
                  void processInventoryDeductions(orderId).catch(console.error)
                  void printReceipt(orderId, paymentId).catch(console.error)
                    → receipt shows: "Gift Card ending in XXXX"
                    → if partial payment: "Gift Card Balance Remaining: $Y.YY"
                    → TCP to receipt printer, 5s timeout, fire-and-forget
                  void openCashDrawer() — NOT called for gift card payments
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `PAYMENT_APPLIED` (OrderEvent) | `{ paymentId, amountCents, tipAmountCents: 0, paymentMethod: 'gift_card' }` | `emitter.ts` | Android, POS UI, reports | After Payment record created; after GiftCardTransaction created |
| `ORDER_CLOSED` (OrderEvent) | `{ closedAt }` | `emitter.ts` | Android, POS UI | Immediately after PAYMENT_APPLIED if fully paid |
| `payment:applied` (socket) | `{ orderId, paymentId, status: 'completed' }` | `socket-dispatch.ts` | POS orders list, Android order view | After PAYMENT_APPLIED event |
| `order:event` (socket) | `{ type: 'PAYMENT_APPLIED', orderId, serverSequence, ... }` | `emitter.ts` | All terminals in location room | After DB persist |
| `order:totals-updated` (socket) | `{ orderId, subtotal, discountTotal, taxTotal, total }` | `socket-dispatch.ts` | All terminals | After order totals recalculated |
| `order:summary-updated` (socket) | `{ orderId, totalCents, paidAmountCents, ... }` | `socket-dispatch.ts` | Android terminals | After snapshot update |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `GiftCard` | `currentBalance: { decrement: amount }`, `status: 'depleted'` (if zero) | Step 3 (inside DB transaction) |
| `GiftCardTransaction` | New row: `type: 'redemption'`, `amount: -paymentAmount`, `balanceBefore`, `balanceAfter`, `orderId` | Step 3 (nested create inside GiftCard update, same transaction) |
| `Payment` | New row: `status: 'completed'`, `paymentMethod: 'gift_card'`, `transactionId: 'GC:{cardNumber}'`, `cardLast4` | Step 4 |
| `OrderEvent` | New row: `type: 'PAYMENT_APPLIED'`, `serverSequence` | Step 5 |
| `OrderSnapshot` | `paidAmountCents`, `status: 'paid'` (if fully paid), `isClosed: true`, `lastEventSequence` | Step 6 |
| `OrderEvent` (second) | New row: `type: 'ORDER_CLOSED'` | Step 6 (if fully paid) |

**Snapshot rebuild points:** Step 6 — after `PAYMENT_APPLIED` event, and again after `ORDER_CLOSED` event if order becomes fully paid.

**Atomicity guarantee:** Steps 3 (`GiftCard` decrement + `GiftCardTransaction` create) run inside a single `db.$transaction`. If the Payment record creation in Step 4 subsequently fails, the gift card balance has already been decremented. Recovery: use the `GiftCardTransaction` record as proof of payment and create the Payment record manually or via retry.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Insufficient balance** | DB transaction throws `GC_INSUFFICIENT:{balance}`. API returns 400: `{ error: 'Insufficient gift card balance ($X.XX)', currentBalance: X.XX }`. PaymentSheet stays open — server selects split payment to cover remainder with cash or card. |
| **Card not found** | DB transaction throws `GC_NOT_FOUND`. API returns 404. Client sees "Gift card not found" — prompts re-entry of card number. |
| **Card depleted (status: 'depleted')** | Status check in DB transaction throws `GC_STATUS:depleted`. API returns 400. |
| **Card expired (expiresAt in past)** | DB transaction checks `expiresAt`, updates `GiftCard.status → 'expired'`, throws `GC_EXPIRED`. API returns 400: "Gift card has expired". |
| **Card frozen (status: 'frozen')** | Status check blocks transaction. API returns 400: "Gift card is frozen". Manager must unfreeze via `PUT /api/gift-cards/[id]` `{ action: 'unfreeze' }`. |
| **Partial payment (split tender)** | Client sends `amount` less than `totalCents`. Gift card balance decremented by partial amount only. Payment created for partial amount. `OrderSnapshot.paidAmountCents` updated. Order stays open. Remainder collected via cash or card in subsequent payment. Order closes when `paidAmountCents >= totalCents`. |
| **TOCTOU race (two terminals charge same card simultaneously)** | `db.$transaction` serializes the `findUnique` + `update` atomically. The second concurrent request will see the already-decremented balance and fail with `GC_INSUFFICIENT` or `GC_STATUS:depleted`. Only one payment succeeds. |
| **Duplicate pay button press** | `idempotencyKey` checked before the gift card transaction block. If Payment with same key already `status: 'completed'`, return 200 with existing payment — do not decrement balance again. |
| **Printer failure** | `printReceipt()` is fire-and-forget. Gift card balance is already decremented. Order closes normally. Server can reprint from order detail. |
| **`acceptGiftCards` setting off** | API returns 400 immediately before any DB work. No balance is touched. |
| **Offline (NUC unreachable)** | Gift card redemption is not supported offline. There is no outbox/SAF path for gift cards — balance lookups require NUC connectivity. Inform customer to use cash or card if NUC is down. |
| **Refund to gift card** | `PUT /api/gift-cards/[id]` with `{ action: 'refund', amount }` — increments `currentBalance`, reactivates status to `'active'` if was `'depleted'`, creates `GiftCardTransaction` with `type: 'refund'`. This is a separate flow from payment refund/void. |
| **Socket reconnect during payment** | Payment completes server-side regardless of socket state. On client reconnect, `order:event` replay via `GET /api/sync/events` brings snapshot current. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1]** `GiftCardTransaction` MUST be created in the SAME `db.$transaction` as the `GiftCard.currentBalance` decrement. NEVER decrement the balance without a transaction record — it is the audit trail and the only proof of where the value went.
- **[INVARIANT-2]** Gift card balance CANNOT go negative. The balance check (`cardBalance < paymentAmount`) MUST run inside the DB transaction, not outside it. NEVER read-then-write outside a transaction for gift card balance.
- **[INVARIANT-3]** When balance reaches exactly $0, `GiftCard.status` MUST be set to `'depleted'` atomically in the same update. NEVER leave a $0-balance card in `'active'` status.
- **[INVARIANT-4]** Gift card redemptions are stored with a NEGATIVE `amount` in `GiftCardTransaction`. Reloads and refunds are POSITIVE. This sign convention is enforced in the API and must not be reversed.
- **[INVARIANT-5]** The `Payment` record MUST be created BEFORE the receipt is printed or inventory is deducted. Money first, side effects second. If any side effect fails, the payment is already recorded.
- **[INVARIANT-6]** NEVER accept gift card payments when `settings.payments.acceptGiftCards` is false. This check runs before any DB work.
- **[INVARIANT-7]** Gift card payments do NOT call `openCashDrawer()`. NEVER add a cash drawer open to a gift card payment path.
- **[INVARIANT-8]** Gift card payment is OFFLINE-INCOMPATIBLE. NEVER add an outbox or SAF path for gift card redemptions without first solving the balance-sync problem — it is trivially vulnerable to replay attacks.

If you break an invariant, the fix is: check `GiftCardTransaction` records for the card to reconstruct the correct balance, create a manual `adjustment` transaction to correct drift, and verify `Payment` records on the order match the expected redemption amounts.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/payments.md` | Full payment data model, idempotency, multi-tender/split patterns |
| `docs/flows/card-payment.md` | Parallel payment flow structure — gift card follows same PAYMENT_APPLIED event path |
| `docs/features/offline-sync.md` | Confirms gift card is explicitly offline-incompatible; SAF is card-reader only |
| `docs/guides/PAYMENTS-RULES.md` | Money-first rule, fire-and-forget side effects, no double-charge |
| `docs/guides/ORDER-LIFECYCLE.md` | `PAYMENT_APPLIED` and `ORDER_CLOSED` event sourcing model |
| `docs/features/gift-cards.md` | If it exists — full gift card feature doc (purchase, reload, admin) |

### Features Involved
- **Gift Cards** — `GiftCard` model, `GiftCardTransaction` ledger, balance decrement, status lifecycle
- **Payments** — `Payment` record, `PAYMENT_APPLIED` event, idempotency key, multi-tender support
- **Orders** — `PAYMENT_APPLIED` + `ORDER_CLOSED` events, `OrderSnapshot` update, order close logic
- **Hardware** — receipt printer (fire-and-forget, shows remaining balance on receipt)
- **Settings** — `settings.payments.acceptGiftCards` feature flag

---

*Last updated: 2026-03-03*
