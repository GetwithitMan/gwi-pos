# Flow: Offline Card Payment (Store-and-Forward)

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A card payment is attempted while the NUC cannot reach the Datacap processor — the reader stores the transaction locally and the order closes normally.

**Why it matters:** Money integrity under adverse network conditions. SAF ensures the venue can continue taking card payments during a temporary processor outage, without double-charging customers or losing transactions. The venue bears the risk of fraud for SAF transactions — this must be communicated clearly.

**Scope:** `gwi-pos` (Datacap client, SAF API, payment logic, admin UI), `gwi-android-register` (payment flow, SAF status sync). Note: "offline" here means the NUC's connection to Datacap's processing network is down — Android can still reach the NUC fine.

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | SAF is a Datacap reader capability — no POS feature flag required. `PaymentReader.communicationMode` must be `'local'` (production). Simulated mode returns `safCount: 0` and does not queue transactions. |
| Hardware required | Datacap VP3300 or VP3350 reader with local SAF storage; receipt printer (fire-and-forget) |
| Permissions required | `pos.card_payments` for SAF capture; `HARDWARE_MANAGE` (Manager) for SAF statistics and forward operations |
| Online / offline state | NUC LAN connection to reader is UP (reader is reachable). NUC connection to Datacap cloud / processor is DOWN. Android-to-NUC connection is irrelevant to SAF. |
| Prior state | Open order with positive `totalCents`; shift must be open; no already-pending SAF void on the same order |

---

## 3. Sequence (Happy Path)

### SAF Capture (at payment time)

```
1.  [CLIENT]      Server taps "Charge" in PaymentSheet
                  idempotencyKey UUID generated on client

2.  [API]         POST /api/orders/[id]/pay
                  → requirePermission('pos.card_payments')
                  → load OrderSnapshot, verify isClosed: false
                  → create PaymentIntent record (before network call)
                  → dual pricing surcharge calculated via src/lib/pricing.ts

3.  [API]         DatacapClient.processSale({ amount, idempotencyKey, readerId })
                  → TCP to reader on LAN (up to 60s local timeout)
                  → Reader detects Datacap processor is unreachable
                  → Reader queues transaction in local SAF storage
                  → Reader returns: TextResponse: "STORED",
                    StoredOffline: true, RespCode: "A" (approved offline)

4.  [DB]          db.payment.create {
                    orderId, locationId, employeeId,
                    amount: cardTotalCents, tipAmount: 0 (SAF skips CFD tip),
                    paymentMethod: 'credit'|'debit',
                    cardBrand, cardLast4, authCode: null,
                    datacapRecordNo,
                    entryMethod: 'Chip'|'Tap'|'Swipe',
                    status: 'completed',
                    isOfflineCapture: true,
                    offlineCapturedAt: NOW(),
                    offlineTerminalId: terminalId,
                    safStatus: 'APPROVED_SAF_PENDING_UPLOAD',
                    pricingMode: 'card',
                    idempotencyKey
                  }

5.  [EVENTS]      void emitOrderEvent(locationId, orderId, 'PAYMENT_APPLIED', {
                    paymentId, amountCents, paymentMethod
                  }).catch(console.error)

6.  [SNAPSHOT]    Reducer applies PAYMENT_APPLIED → OrderSnapshot updated
                  { paidAmountCents += amount, status: 'paid', isClosed: true }
                  emitOrderEvent('ORDER_CLOSED', { closedAt }) if fully paid

7.  [BROADCAST]   emitToLocation(locationId, 'order:event',
                    { type: 'PAYMENT_APPLIED', ... })
                  emitToLocation(locationId, 'payment:applied',
                    { orderId, paymentId, status: 'completed' })
                  (NO cfd:approved — CFD tip collection is skipped in SAF path)

8.  [SIDE EFFECTS — all fire-and-forget]
                  void allocateTipsForPayment(paymentId).catch(console.error)
                  void printReceipt(orderId, {
                    offlineCapture: true,
                    notice: "OFFLINE CAPTURE — TRANSACTION PENDING UPLOAD"
                  }).catch(console.error)
```

### SAF Statistics Check (manager, on-demand)

```
9.  [CLIENT]      Manager opens /settings/hardware/payment-readers
                  Taps "Check" on a reader's SAF queue widget

10. [API]         GET /api/datacap/saf/statistics?locationId=&readerId=
                  → requirePermission(Manager)
                  → DatacapClient.safStatistics(readerId)
                  → TCP to reader: SAF_Statistics command
                  Response: { safCount: 3, safAmount: 142.50, hasPending: true }

11. [CLIENT]      UI shows amber badge: "3 pending · $142.50"
                  "Forward Now" button enabled
```

### SAF Forward (processor connectivity restored)

```
12. [CLIENT]      Manager taps "Forward Now" (or system auto-triggers on reconnect)

13. [API]         POST /api/datacap/saf/forward { locationId, readerId }
                  → requirePermission(Manager)
                  → DatacapClient.safForwardAll(readerId)
                  → TCP to reader: SAF_ForwardAll command
                  → Reader pushes all queued transactions to Datacap processor
                  Response: { success: true, safForwarded: 3 }

14. [DB]          db.payment.updateMany({
                    where: {
                      locationId,
                      safStatus: 'APPROVED_SAF_PENDING_UPLOAD',
                      isOfflineCapture: true
                    },
                    data: {
                      safStatus: 'UPLOAD_SUCCESS',
                      safUploadedAt: NOW()
                    }
                  })

15. [CLIENT]      SAF widget shows green "Clear" — pending count reset to 0
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `PAYMENT_APPLIED` (OrderEvent) | `{ paymentId, amountCents, paymentMethod }` | `emitter.ts` | Android, POS UI, reports | After Payment record created (step 4) |
| `ORDER_CLOSED` (OrderEvent) | `{ closedAt }` | `emitter.ts` | Android, POS UI | Immediately after PAYMENT_APPLIED if fully paid |
| `payment:applied` (socket) | `{ orderId, paymentId, status: 'completed' }` | `socket-dispatch.ts` | POS orders list, Android | After PAYMENT_APPLIED event |
| `order:event` (socket) | `{ type: 'PAYMENT_APPLIED', orderId, serverSequence }` | `emitter.ts` | All terminals in location room | After DB persist |

**Note:** `cfd:tip-prompt` and `cfd:approved` are NOT emitted in the SAF path. The reader cannot communicate with Datacap to complete a standard EMVSale approval loop, so CFD tip collection is bypassed.

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Payment` | New row: `isOfflineCapture: true`, `offlineCapturedAt`, `offlineTerminalId`, `safStatus: 'APPROVED_SAF_PENDING_UPLOAD'`, `status: 'completed'` | Step 4 |
| `OrderEvent` | New row: `type: 'PAYMENT_APPLIED'` | Step 5 |
| `OrderSnapshot` | `paidAmountCents`, `isClosed: true`, `lastEventSequence` | Step 6 |
| `Payment` (on forward) | `safStatus: 'UPLOAD_SUCCESS'`, `safUploadedAt` | Step 14 |
| `Payment` (on forward fail) | `safStatus: 'UPLOAD_FAILED'` or `'NEEDS_ATTENTION'`, `safError` | Step 14 (error path) |

**Snapshot rebuild points:** Step 6 — after `PAYMENT_APPLIED` event and `ORDER_CLOSED` event.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **SAF forward fails** | `safForwardAll()` returns error. `Payment.safStatus` set to `'UPLOAD_FAILED'`, `safError` populated. Amber badge remains on hardware settings page. Manager may retry. Already-settled transactions are not affected. |
| **Void of SAF payment (before forwarding)** | SAF transactions must be voided BEFORE forwarding. Manager calls `POST /api/orders/[id]/void-payment` while `safStatus: 'APPROVED_SAF_PENDING_UPLOAD'`. Datacap `VoidSaleByRecordNo` is issued to the reader to remove from SAF queue. `handleTipChargebacks()` reverses any tip ledger entries. |
| **Void of SAF payment (after forwarding)** | Once `safStatus: 'UPLOAD_SUCCESS'`, the transaction is in Datacap's batch. Standard void path applies: `VoidSaleByRecordNo` if batch unsettled, `EMVReturn` if batch settled. |
| **Multi-SAF batch** | `SAF_ForwardAll` flushes the entire queue in one command — partial forwarding is not supported. All `Payment` records with `APPROVED_SAF_PENDING_UPLOAD` are updated to `UPLOAD_SUCCESS` on success. |
| **Duplicate SAF forward** | `SAF_ForwardAll` is idempotent at the reader level — forwarding an already-uploaded transaction returns a harmless response. The `safStatus` update is idempotent because it only updates `APPROVED_SAF_PENDING_UPLOAD` records. |
| **Batch close with pending SAF** | `GET /api/datacap/batch` returns `hasSAFPending: true`. The batch close UI warns managers before initiating settlement. Settling with unforwarded SAF transactions risks losing them. |
| **24-hour Visa/MC network rule** | Visa/MC require SAF transactions to be uploaded within 24 hours. The batch warning exists to help managers comply. If not uploaded within 24 hours, the transaction may be rejected when forwarded. |
| **Card stolen or declined on forward** | When the reader forwards a SAF transaction and the processor declines it (e.g., stolen card discovered post-capture), the reader returns a failure response. `safStatus` is set to `'NEEDS_ATTENTION'`. The venue bears this loss — the customer already left and the transaction was captured offline. There is no automatic recovery. |
| **Android offline to NUC during SAF** | SAF is a NUC-to-Datacap concern. Android does not participate in the SAF forward path. Android sees the payment as `isOfflineCapture: true` via standard payment sync (`POST /api/payments/sync`). |
| **Reader not reachable for SAF statistics** | `GET /api/datacap/saf/statistics` "Check" button is disabled when POS has no network connection to the reader. If TCP connection times out, API returns 503 with reader offline message. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1]** SAF applies ONLY to card-present Datacap transactions via a physical reader. Cash, gift card, house account, and card-not-present payments are never SAF-eligible. `safStatus` is `null` on those `Payment` records.
- **[INVARIANT-2]** NEVER attempt `SAF_ForwardAll` during active payment processing. Forwarding during a live transaction can corrupt the SAF queue sequence.
- **[INVARIANT-3]** NEVER double-forward. The `APPROVED_SAF_PENDING_UPLOAD → UPLOAD_SUCCESS` state transition is one-way. Do not re-run `POST /api/datacap/saf/forward` on a reader whose `safCount` is already 0 during the same session.
- **[INVARIANT-4]** A void of a SAF payment MUST happen before forwarding. Once forwarded (`UPLOAD_SUCCESS`), reversal follows the standard void/refund path based on settlement status.
- **[INVARIANT-5]** The `Payment` record (with `isOfflineCapture: true`) is created on the NUC at the moment of SAF capture — BEFORE the receipt is printed. The order closes normally. SAF does not defer order closure.
- **[INVARIANT-6]** The `forceOffline` flag in `src/lib/datacap/xml-builder.ts` is for certification testing ONLY (`<ForceOffline>Yes</ForceOffline>`). NEVER set `forceOffline: true` in production payment flows.
- **[INVARIANT-7]** Managers must be warned of pending SAF transactions before batch settlement (`hasSAFPending: true` check in `GET /api/datacap/batch`). Settling without forwarding risks losing offline transactions.

If you break an invariant, the fix is: inspect `Payment` records with `safStatus = 'APPROVED_SAF_PENDING_UPLOAD'` and `isOfflineCapture = true`; verify reader SAF queue count via `GET /api/datacap/saf/statistics`; do not attempt forward if a live transaction is in progress.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/store-and-forward.md` | SAF data model, `forceOffline` flag, statistics/forward API |
| `docs/features/payments.md` | `Payment` model SAF fields, `isOfflineCapture`, `idempotencyKey` |
| `docs/features/hardware.md` | `PaymentReader` model, `communicationMode`, reader health |
| `docs/features/offline-sync.md` | Android SAF state sync via `POST /api/payments/sync` |
| `docs/guides/PAYMENTS-RULES.md` | Datacap-only rule, money-first philosophy, `communicationMode: 'local'` |
| `docs/flows/card-payment.md` | Normal card payment flow — SAF is the divergent path from step 3 |

### Features Involved
- **Store-and-Forward** — SAF queue, `SAF_Statistics`, `SAF_ForwardAll`, `safStatus` lifecycle
- **Payments** — `Payment` record creation, `isOfflineCapture` flag, idempotency, void/refund path
- **Hardware** — Datacap VP3300/VP3350 reader, TCP communication, LAN connectivity
- **Offline Sync** — Android payment sync, `offlineIntentId` deduplication, SAF status propagation

---

*Last updated: 2026-03-03*
