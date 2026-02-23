# Payment UX Research — GWI POS

Reference doc for implementation agents. Covers latency best practices, Datacap constraints from actual code, current flow bottlenecks, and monitoring approach.

---

## 1. Payment Latency Best Practices

### Optimistic UI Patterns for POS

| Action | Can Show Success Before Server Confirms? | Why |
|--------|------------------------------------------|-----|
| Send to Kitchen | **Yes** — close modal instantly | Worst case: item re-sends (idempotent via `SELECT FOR UPDATE` lock). User sees "Sent!" immediately. |
| Cash Payment | **Yes** — close modal, kick drawer | Cash is offline; no gateway round-trip. Server write is bookkeeping. |
| Card Payment (EMV Sale) | **No** — must wait for Approved/Declined | Gateway is the authority. Show a non-blocking spinner on the button, but never fake "Approved." |
| Start Tab (PreAuth) | **Partial** — show "Reading card..." inline, keep order screen usable | The order already exists. The tab open is additive. Auth result updates a badge/status chip. |
| Add To Tab (Increment) | **Yes** — add items immediately | IncrementalAuth fires in background (`POST /auto-increment`). If it fails, a badge warns the server. Items are already on the order. |
| Tip Adjust | **Yes** — update UI immediately | DB-only operation, no gateway call. Fire-and-forget socket dispatch. |

### Non-Blocking Spinner States

A payment button should cycle through three visual states:
1. **Idle** — tappable, full color
2. **Processing** — spinner overlay, disabled (no double-tap), text changes to "Processing..."
3. **Result** — green check (Approved) or red X (Declined) for 1.5s, then reset

The button must never freeze the entire screen. Other UI (back button, order list) stays interactive.

### Background Processing (Fire-and-Forget After UI Unblocks)

These currently run after the pay response is sent (confirmed in `pay/route.ts`):
- `deductInventoryForOrder()` — inventory deductions
- `allocateTipsForPayment()` — tip bank pipeline
- `triggerCashDrawer()` — ESC/POS cash kick
- `dispatchOpenOrdersChanged()` — socket broadcast
- `dispatchFloorPlanUpdate()` — table status
- `emitCloudEvent('order_paid')` — backoffice sync
- `cleanupTemporarySeats()` — seat cleanup
- `dispatchCFDReceiptSent()` — CFD thank-you screen

All use `void fn().catch(console.error)` pattern — correct.

### Pre-Auth Tab Lifecycle

```
Open Tab:  CollectCardData → EMVPreAuth($1+) → store recordNo → "Tab Open"
Add Items: Normal item add → POST /auto-increment (background) → IncrementalAuthByRecordNo
Close Tab: PreAuthCaptureByRecordNo(finalAmount + tip) → mark order paid
Cancel:    VoidSaleByRecordNo(recordNo) → release hold
```

### Timeout & Double-Charge Prevention

**Current idempotency:**
- `pay/route.ts` accepts `idempotencyKey` (optional). If provided and a completed payment with that key exists, returns the existing payment data without reprocessing.
- `send/route.ts` uses `SELECT ... FOR UPDATE` row lock — concurrent sends see 0 pending items and short-circuit.

**Gaps to address:**
- `idempotencyKey` is optional — client should always send one (UUID generated on button press).
- `open-tab/route.ts` has no explicit idempotency key, but does check for existing `OrderCard` with same `recordNo`.
- `auto-increment/route.ts` has no idempotency guard — safe because IncrementalAuth is additive (Datacap deduplicates by recordNo + amount within a window).

---

## 2. Datacap Constraints (From Code)

### Two APIs, Two Protocols

| | Direct API (EMV / Card-Present) | PayAPI V2 (Card-Not-Present) |
|---|---|---|
| **Transport** | XML over HTTP to local reader IP | REST/JSON over HTTPS to `pay.dcap.com` |
| **Auth** | None (local) or Basic Auth (cloud) | Basic Auth (MID:APIKey) |
| **File** | `client.ts` (1117 lines) | `payapi-client.ts` (441 lines) |
| **Timeout** | 60s local / 30s cloud (card interaction) | 5s circuit breaker (no card interaction) |
| **Token type** | `recordNo` (Datacap vault ID) | `token` (OTU or multi-use DC4 token) |

### Pre-Auth Flow (Card-Present via Direct API)

```
EMVPreAuth  →  response.recordNo (vault token for future ops)
                response.authCode
                response.cardLast4, cardType, cardholderName
```

Subsequent operations use `recordNo`:
- `IncrementalAuthByRecordNo` — increase hold
- `PreAuthCaptureByRecordNo` — finalize charge (with gratuity)
- `VoidSaleByRecordNo` — release hold
- `AdjustByRecordNo` — change tip after capture
- `PartialReversalByRecordNo` — reduce hold amount

### Incremental Auth Details

- TranCode: `IncrementalAuthByRecordNo`
- Input: `recordNo` + `additionalAmount` (delta, not new total)
- Triggers when: `tabTotal >= totalAuthorized * incrementThresholdPercent/100` (default 80%)
- Default increment: `$25` minimum or exact amount needed (whichever is larger)
- Tip buffer: `incrementTipBufferPercent` (default 25%) — holds extra for expected gratuity
- Max tab alert: `$500` default — warns manager

### Sale vs PreAuth+Capture Paths

| Scenario | Path Used |
|----------|-----------|
| Quick pay (dine-in, takeout) | `EMVSale` — single charge, no hold |
| Bar tab open | `EMVPreAuth` → `IncrementalAuthByRecordNo` (0..N) → `PreAuthCaptureByRecordNo` |
| Card-not-present (online, stored card) | PayAPI `sale` or `preauth` → `capture` |

### Token Handling

- **Direct API `recordNo`**: Persisted in `OrderCard.recordNo` and `Payment.datacapRecordNo`. Valid for the batch lifetime (until `BatchClose`). Used for voids, captures, adjustments.
- **PayAPI `token`**: Returned as `DC4:...` string. OTU (one-time-use) from tokenization or multi-use after first charge. Stored in `Payment.transactionId` via `datacapRefNumber`.

### Timeout Behavior

| Context | Timeout | Source |
|---------|---------|--------|
| PayAPI REST calls | **5s** (`PAYAPI_TIMEOUT_MS`) | `AbortController` in `payapi-client.ts:273` |
| Local EMV reader | **60s** (`DEFAULT_LOCAL_TIMEOUT_MS`) | Customer interacts with reader |
| Cloud EMV | **30s** (`DEFAULT_CLOUD_TIMEOUT_MS`) | Cloud relay to local reader |
| Pad Reset | **5s** (`PAD_RESET_TIMEOUT_MS`) | Quick device reset |
| Param Download | **120s** | Slow config push |
| Reader health gate | Instant rejection | `assertReaderHealthy()` — degraded readers refuse transactions |

**Every monetary transaction** auto-calls `EMVPadReset` after completion (success or failure). If pad reset fails, reader is marked **degraded** and all future transactions are blocked until manual reset succeeds.

---

## 3. Current Flow Summary

### Send to Kitchen (`POST /api/orders/[id]/send`)

1. `SELECT ... FOR UPDATE` locks order row (prevents duplicate sends)
2. Filter pending, non-held items via `getEligibleKitchenItems()`
3. Batch update items → `kitchenStatus: 'sent'` + `firedAt: now`
4. Transition `draft → open` on first send
5. Route to KDS stations via `OrderRouter.resolveRouting()`
6. **Fire-and-forget**: socket dispatch, kitchen print, prep stock deduction, audit log

**Bottleneck**: The `FOR UPDATE` lock + item status updates are ~50-100ms. No gateway call. UI should optimistically close immediately.

### Start Tab (`POST /api/orders/[id]/open-tab`)

1. Set `tabStatus: 'pending_auth'` on order (immediate DB write)
2. `CollectCardData` on reader → get cardholder name, card type, last4
3. Check for existing tab with same recordNo (duplicate detection)
4. `EMVPreAuth` for `max(orderTotal, $1)`
5. If declined → set `tabStatus: 'auth_failed'`, dispatch socket, return error
6. If approved → create `OrderCard` + update order with auth fields (transaction)
7. Dispatch `tab:updated` + `orders:list-changed` sockets

**Bottleneck**: Steps 2-4 are **card interaction** — 5-30s depending on reader speed and customer. The UI blocks on `pending_auth` status for this entire duration. This is the primary UX target.

### Add To Tab — Auto-Increment (`POST /api/orders/[id]/auto-increment`)

1. Fetch order + cards + settings
2. Check if `autoIncrementEnabled` (skip if disabled)
3. Calculate: `tabTotal >= totalAuthorized * threshold%`?
4. If below threshold → return `below_threshold` (no network call)
5. If at threshold → `IncrementalAuthByRecordNo` for delta amount
6. If approved → update `OrderCard.authAmount` + `Order.preAuthAmount`
7. Dispatch `tab:updated` socket

**Bottleneck**: `IncrementalAuthByRecordNo` is a **record-based** (no card interaction) call — should be <2s. Currently fires on every item-add API call from client. The call itself is fast but it's synchronous in the request.

### Pay/Close (`POST /api/orders/[id]/pay`)

1. Single fetch: order + payments + items + employee + table + location + customer
2. $0 order check → close immediately if all voided
3. Zod validation of payment inputs
4. Idempotency check (if key provided, return existing payment)
5. Permission check (`requireAnyPermission`)
6. For each payment: build record, handle method-specific logic (cash rounding, dual pricing, gift card tx, house account tx, loyalty points)
7. **Atomic transaction**: create payments + update order status + audit logs + loyalty points
8. **Fire-and-forget** (all post-response): inventory, tips, cash drawer, table reset, seat cleanup, socket dispatches, cloud events, CFD receipt

**Bottleneck**: Step 7 is the DB transaction — typically 30-100ms. For card payments, the gateway call happens **before** this route is called (client-side EMV flow via Direct API). The pay route receives `datacapRecordNo` / `datacapRefNumber` as proof of authorization. No gateway round-trip in pay route itself.

**Key insight**: The pay route is already fast for card payments because gateway auth happens client-side before calling pay. The main UX concern is the modal staying open during the DB transaction.

---

## 4. Monitoring Approach

### 4 Timestamps Per Payment Flow

| Timestamp | Where Captured | Field Name |
|-----------|---------------|------------|
| `t_click` | Client (button press) | `clickedAt` in fetch body or header |
| `t_request_sent` | Client (fetch start) | `performance.now()` before fetch |
| `t_gateway_response` | Server (after Datacap returns) | Existing `withTiming` in pay route |
| `t_ui_unblocked` | Client (modal closes / spinner stops) | `performance.now()` after response |

### Metrics to Track

| Metric | Formula | Target |
|--------|---------|--------|
| **Click-to-unblock (user-felt latency)** | `t_ui_unblocked - t_click` | p50 < 500ms (cash), p50 < 3s (card) |
| **Gateway round-trip** | `t_gateway_response - t_request_sent` | p95 < 5s (EMV), p95 < 2s (PayAPI) |
| **Server processing** | Existing `withTiming` spans | p95 < 200ms (db-fetch + db-pay) |
| **Timeout rate** | `count(DATACAP_TIMEOUT) / total_transactions` | < 1% |
| **Gateway error rate** | `count(Declined + Error) / total_transactions` | < 5% |
| **Pad reset failure rate** | `count(degraded markers) / total_transactions` | < 0.1% |

### Where to Instrument

**Already exists:**
- `withTiming` wrapper on `pay/route.ts` and `send/route.ts` — captures `db-fetch` and `db-pay` spans
- `logReaderTransaction()` in `client.ts:withPadReset` — logs `responseTimeMs`, `success`, `errorCode`, `tranType` per reader transaction (fire-and-forget to DB)
- `reader-health.ts` — tracks reader degraded/healthy state

**Needs adding:**
- Client-side: `t_click` and `t_ui_unblocked` timestamps in payment store (Zustand)
- Client-side: pass `x-client-click-ts` header with fetch (single header, zero-cost)
- Server-side: log `t_click → t_response_sent` delta for end-to-end latency
- Dashboard: aggregate `logReaderTransaction` rows into p50/p95/p99 per flow type

### Reader Health Integration

The existing `reader-health.ts` + `logReaderTransaction()` infrastructure is sufficient for per-reader monitoring. Each transaction already logs:
- `locationId`, `readerId`
- `responseTimeMs` (gateway round-trip)
- `success` (boolean)
- `errorCode` (string, first 100 chars)
- `tranType` (EMVSale, EMVPreAuth, IncrementalAuthByRecordNo, etc.)

This data can be aggregated by the backoffice reporting layer without any additional instrumentation on the POS side.
