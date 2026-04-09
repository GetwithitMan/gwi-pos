# Flow: Card Payment

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A server initiates card payment on Android register or PAX device — a card transaction is sent to the Datacap reader, approved, and the order is closed.

**Why it matters:** Money integrity. A failed or corrupted payment path means a customer's card is charged but the order is not closed, or the order is closed but no payment is recorded. Either failure damages the venue financially and erodes trust.

**Scope:** `gwi-pos` (API, Datacap client, payment logic, socket server), `gwi-android-register` (card reader interaction, PaymentManager), `gwi-cfd` (tip prompt, approval display).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `dualPricingEnabled` (Location.settings) — determines if surcharge is added for card; `cfdEnabled` for tip-on-CFD path |
| Hardware required | Datacap VP3300 or VP3350 reader on LAN (192.168.x.x); receipt printer (fire-and-forget, not blocking); PAX A3700 CFD (if bar tab tip flow) |
| Permissions required | `pos.card_payments` (standard employee); `manager.void_payments` only for void path |
| Online / offline state | Happy path: NUC can reach Datacap reader over LAN. Offline (NUC can't reach Datacap) → SAF path; see `offline-payment-saf.md` |
| Prior state | An open `Order` with `isClosed: false` and a positive `totalCents`; no unsettled partial payment on same order unless multi-tender intent |

---

## 3. Sequence (Happy Path)

```
1.  [CLIENT]      Server opens PaymentSheet on order, taps "Charge" (card)
                  Client generates idempotencyKey (UUID) on button press
                  (Android: PayOrderUseCase generates key; PAX: equivalent payment flow)

2.  [API]         POST /api/orders/[id]/pay
                  Body: { paymentMethod: 'credit'|'debit', amount, idempotencyKey,
                           pricingMode: 'card', tipAmountCents? }
                  → requirePermission('pos.card_payments')
                  → check idempotencyKey unique (Payment.idempotencyKey @unique)
                  → load OrderSnapshot — verify isClosed: false
                  → create PaymentIntent record (before network call — crash safety)

3.  [API]         Dual pricing surcharge calculation (if dualPricingEnabled):
                  cardTotal = cashTotal × (1 + surcharge%)   [src/lib/pricing.ts]
                  cashDiscountAmount = cardTotal - cashTotal
                  Final charge amount = cardTotal (stored as cents)

4.  [SIDE EFFECT] void emitToLocation(locationId, 'cfd:payment-started',
                    { orderId, total }).catch(console.error)
                  CFD transitions to payment-in-progress screen

5.  [CFD TIP PATH] (bar tab / CFD-enabled locations only)
                  void emitToLocation(locationId, 'cfd:tip-prompt',
                    { orderId, tipSuggestions[] }).catch(console.error)
                  CFD displays tip screen → customer selects tip
                  POS receives 'cfd:tip-selected' { orderId, tipAmountCents }
                  (race-free, 60s timeout — if no selection, proceeds with $0 tip)

6.  [API]         DatacapClient.processSale({
                    amount: cardTotalCents,
                    tipAmount: tipAmountCents,
                    readerId,
                    idempotencyKey
                  })
                  → TCP to reader (LAN, 60s local timeout)
                  → Datacap EMVSale — reader prompts card (chip/tap/swipe)
                  void emitToLocation(locationId, 'cfd:processing',
                    { orderId }).catch(console.error)

7a. [APPROVED]
    [DB]          db.payment.create {
                    orderId, locationId, employeeId,
                    amount: cardTotalCents, tipAmount: tipAmountCents,
                    totalAmount: cardTotalCents + tipAmountCents,
                    paymentMethod: 'credit'|'debit',
                    cardBrand, cardLast4, authCode,
                    datacapRecordNo, datacapRefNumber,
                    entryMethod: 'Chip'|'Tap'|'Swipe',
                    status: 'completed',
                    pricingMode: 'card',
                    cashDiscountAmount,
                    idempotencyKey
                  }

8.  [EVENTS]      void emitOrderEvent(locationId, orderId, 'PAYMENT_APPLIED', {
                    paymentId, amountCents: cardTotalCents,
                    tipAmountCents, paymentMethod: 'credit'
                  }).catch(console.error)

9.  [SNAPSHOT]    Reducer applies PAYMENT_APPLIED →
                  OrderSnapshot { paidAmountCents += cardTotalCents + tip,
                    status: 'paid' (if fully paid), isClosed: true,
                    lastEventSequence: N }
                  If paidAmountCents >= totalCents:
                    emitOrderEvent('ORDER_CLOSED', { closedAt })

10. [BROADCAST]   emitToLocation(locationId, 'order:event',
                    { type: 'PAYMENT_APPLIED', ... })
                  emitToLocation(locationId, 'payment:applied',
                    { orderId, paymentId, status: 'completed' })
                  emitToLocation(locationId, 'cfd:approved',
                    { orderId, cardLast4 })

11. [SIDE EFFECTS — all fire-and-forget]
                  void allocateTipsForPayment(paymentId).catch(console.error)
                    → postToTipLedger(CREDIT, DIRECT_TIP) for server
                  void processInventoryDeductions(orderId).catch(console.error)
                  void printReceipt(orderId, paymentId).catch(console.error)
                    → TCP to receipt printer (fire-and-forget, 5s timeout)
                  void openCashDrawer() — NOT called for card payments
                  void emitToLocation(locationId, 'cfd:receipt-sent',
                    { orderId }).catch(console.error)

7b. [DECLINED]
    [API]         Datacap returns declined response
                  Payment record NOT created (or set to status: 'failed')
                  void emitToLocation(locationId, 'cfd:declined',
                    { orderId, reason }).catch(console.error)
                  Return 402 to client: { declined: true, reason, displayMessage }
                  PaymentSheet stays open — server can retry or change method
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `PAYMENT_APPLIED` (OrderEvent) | `{ paymentId, amountCents, tipAmountCents, paymentMethod }` | `emitter.ts` | Android, POS UI, reports | After Payment record created |
| `ORDER_CLOSED` (OrderEvent) | `{ closedAt }` | `emitter.ts` | Android, POS UI | Immediately after PAYMENT_APPLIED if fully paid |
| `payment:applied` (socket) | `{ orderId, paymentId, status }` | `socket-dispatch.ts` | POS orders list, Android order view | After PAYMENT_APPLIED event |
| `order:event` (socket) | `{ type: 'PAYMENT_APPLIED', orderId, serverSequence, ... }` | `emitter.ts` | All terminals in location room | After DB persist |
| `cfd:payment-started` (socket) | `{ orderId, total }` | pay route | CFD screen | Before Datacap call |
| `cfd:tip-prompt` (socket) | `{ orderId, tipSuggestions[] }` | pay route | CFD screen | After cfd:payment-started |
| `cfd:processing` (socket) | `{ orderId }` | pay route | CFD screen | After card inserted/tapped |
| `cfd:approved` (socket) | `{ orderId, cardLast4 }` | pay route | CFD screen | After Payment record created |
| `cfd:declined` (socket) | `{ orderId, reason }` | pay route | CFD screen | On Datacap decline response |
| `tip-group:updated` (socket) | `{ action: 'tip-received', tipAmountCents }` | `tip-ledger.ts` | POS tip group UI | After allocateTipsForPayment |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Payment` | New row: `status: 'completed'`, `authCode`, `datacapRecordNo`, `pricingMode`, `cashDiscountAmount` | Step 7a |
| `OrderEvent` | New row: `type: 'PAYMENT_APPLIED'`, `serverSequence` | Step 8 |
| `OrderSnapshot` | `paidAmountCents`, `status: 'paid'`, `isClosed: true`, `lastEventSequence` | Step 9 |
| `OrderEvent` (second) | New row: `type: 'ORDER_CLOSED'` | Step 9 (if fully paid) |
| `TipLedgerEntry` | New CREDIT row for server | Step 11, fire-and-forget |
| `TipTransaction` | New row linking payment to tip allocation | Step 11 |
| `PaymentReaderLog` | Response time, success/failure recorded | After Datacap response |

**Snapshot rebuild points:** Step 9 — after `PAYMENT_APPLIED` event and again after `ORDER_CLOSED` event if order becomes fully paid.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Card declined** | Datacap returns decline code. Payment record not created (or `status: 'failed'`). `cfd:declined` emitted. API returns 402 with reason. PaymentSheet stays open. Server can retry or switch to cash. |
| **Datacap timeout (60s)** | If reader does not respond within 60s local timeout, API returns 504. PaymentIntent record exists for crash recovery. Client retries with same `idempotencyKey` — duplicate payment prevented by `@unique` constraint. |
| **Duplicate pay button press** | `idempotencyKey` checked before Datacap call. If Payment with same key already `status: 'completed'`, return 200 with existing payment — do not charge again. |
| **Printer failure** | `printReceipt()` is fire-and-forget. TCP timeout (5–7s) runs out-of-band. Order closes normally. Server can reprint from order detail. |
| **Partial payment / multi-tender** | Client sends `amount` less than `totalCents`. Payment created for partial amount. `OrderSnapshot.paidAmountCents` updated. Order stays open. Next tender (cash, another card) completes the remainder. Order closes when `paidAmountCents >= totalCents`. |
| **SAF (NUC offline to Datacap)** | Datacap reader detects offline, stores transaction locally (`StoredOffline: true`). Payment created with `isOfflineCapture: true`, `safStatus: 'APPROVED_SAF_PENDING_UPLOAD'`. Receipt printed with "Offline Capture" notice. See `offline-payment-saf.md`. |
| **CFD tip timeout** | 60-second race in `PaymentManager.collectCfdTip()`. If CFD does not respond with `cfd:tip-selected` within 60s, payment proceeds with $0 tip. |
| **Void after payment** | Requires `manager.void_payments` permission. Calls `DatacapClient.voidSaleByRecordNo(datacapRecordNo)`. Creates `PAYMENT_VOIDED` event. `handleTipChargebacks()` reverses tip ledger entries. Settlement status governs void vs refund: unsettled = void, settled = refund. |
| **Socket reconnect during payment** | Payment completes server-side regardless of socket state. On client reconnect, `order:event` replay via `GET /api/sync/events` brings snapshot current. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1]** Datacap is the ONLY card processor. NEVER add Stripe, Square, Braintree, or any other processor. All card payment code lives in `src/lib/datacap/`.
- **[INVARIANT-2]** The `Payment` record MUST be created BEFORE the receipt is printed, tips are allocated, or inventory is deducted. Money first, side effects second. If any side effect fails, the payment is already recorded.
- **[INVARIANT-3]** `idempotencyKey` is generated on the client BEFORE the pay button is tapped. On retry, the SAME key must be sent. This prevents double-charging on network errors.
- **[INVARIANT-4]** Stored prices are CASH prices. Card surcharge is applied at payment time in `src/lib/pricing.ts` — NEVER bake the surcharge into `OrderItem.priceCents`.
- **[INVARIANT-5]** `printReceipt()`, `allocateTipsForPayment()`, and `processInventoryDeductions()` are ALL fire-and-forget. NEVER await them before returning the payment response to the client.
- **[INVARIANT-6]** Tip ledger entries are IMMUTABLE. NEVER update or delete a `TipLedgerEntry`. Corrections post delta entries.
- **[INVARIANT-7]** Tip adjustments are immutable after 24 hours. `POST /api/orders/[id]/adjust-tip` must reject requests where `payment.createdAt` is more than 24 hours ago.
- **[INVARIANT-8]** Settlement status governs the reversal path: unsettled batch → `VoidSaleByRecordNo`; settled batch → `EMVReturn` (refund). NEVER void a settled payment.

If you break an invariant, the fix is: check `SyncAuditEntry` for duplicate payments, run `GET /api/tips/integrity` to detect ledger drift, and reopen the order manually if snapshot diverged.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/payments.md` | Full payment data model, Datacap transaction types, bar tab pre-auth |
| `docs/features/store-and-forward.md` | SAF path — offline capture, `isOfflineCapture`, `safStatus` |
| `docs/features/tips.md` | `allocateTipsForPayment()`, ledger immutability, CFD tip prompt |
| `docs/features/hardware.md` | Reader config, printer fire-and-forget, `PaymentReader` model |
| `docs/features/offline-sync.md` | `SyncAuditEntry`, payment sync endpoint, `offlineIntentId` dedup |
| `docs/guides/PAYMENTS-RULES.md` | Datacap-only rule, dual pricing model, credential flow |
| `docs/flows/offline-payment-saf.md` | Full SAF path when Datacap is unreachable |
| `docs/features/cfd.md` | CFD socket events, tip screen, A3700 pairing |

### Features Involved
- **Payments** — Datacap client, Payment record, dual pricing, idempotency
- **Tips** — `allocateTipsForPayment()`, tip ledger, CFD tip collection
- **Orders** — `PAYMENT_APPLIED` + `ORDER_CLOSED` events, OrderSnapshot update
- **Hardware** — card reader (VP3300/VP3350), receipt printer, cash drawer
- **Store-and-Forward** — SAF offline path, `safStatus` tracking
- **CFD** — `cfd:payment-started`, `cfd:tip-prompt`, `cfd:approved/declined` socket events

---

*Last updated: 2026-03-03*
