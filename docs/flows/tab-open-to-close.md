# Flow: Tab Open to Close

> **When to read this:** Before changing any feature listed in Section 8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A bartender opens a bar tab for a customer -- either by swiping/dipping a card (card-present) or by name only (name-only tab).

**Why it matters:** Money integrity. The pre-authorization hold is a real financial instrument. If a tab is closed without capturing, or captured for the wrong amount, or if a tip is recorded before the capture settles, money is lost or mismatch occurs between the card network and the database. The entire sequence must be deterministic and auditable.

**Scope:** `gwi-pos` (API, tab UI, Datacap client, socket dispatch), `gwi-android-register` (NewTabDialog, TabListSheet, PaymentManager), `gwi-cfd` (CFDTipScreen on tab close).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `tabsEnabled` on location settings; incremental auth threshold (default 80%) configurable |
| Hardware required | Datacap VP3300/VP3350 card reader on LAN; receipt printer (optional) |
| Permissions required | `POS_ACCESS` to open; `POS_CARD_PAYMENTS` to close; `TAB_TRANSFER` (High) to transfer; `TAB_WRITEOFF` (Critical) to write off walkout |
| Online / offline state | NUC must be reachable for all Datacap pre-auth and capture calls; cannot open card-based tabs offline |
| Prior state | An `Order` shell must exist (created via `POST /api/orders`) or is created inline by the tab flow; no unsent items may exist when closing |

---

## 3. Sequence (Happy Path)

### Phase A -- Tab Open (Card-Present, EMVPreAuth)

**Route:** `POST /api/orders/[id]/open-tab`
**Source:** `src/app/api/orders/[id]/open-tab/route.ts`
**UI Component:** `CardFirstTabFlow` (`src/components/tabs/CardFirstTabFlow.tsx`)

```
1. [CLIENT]       Bartender taps "New Tab" -- CardFirstTabFlow auto-starts on mount
                  Component status: 'preparing' -> 'reading'

2. [API]          POST /api/orders/{id}/open-tab { readerId, employeeId }
                  -> requirePermission(employeeId, locationId, POS_ACCESS)
                  -> Optimistic concurrency check (expectedOrderVersion)

3. [GUARD]        EDGE-7: If tabStatus is 'pending_auth' and stale (>5 min),
                  auto-recover to 'open'. If fresh, return 409 "already in progress".

4. [API]          Order.tabStatus set to 'pending_auth' immediately (row lock intent)

5. [API]          client.collectCardData(readerId)
                  -> TCP to reader: CollectCardData command
                  -> Returns: cardholderName, cardType, cardLast4

6. [GUARD]        Stage 1 duplicate check: If collectResponse.recordNo matches an
                  existing OrderCard on an open bar_tab, return 'existing_tab_found'
                  with the existing tab's info. Tab stays open, no duplicate hold.

7. [API]          client.preAuth(readerId, { invoiceNo: orderId, amount, requestRecordNo: true })
                  -> TCP to reader: EMVPreAuth command
                  -> Pre-auth holds: max(orderTotal, $1.00) against card
                  -> Returns: recordNo token, authCode, cardholderName, cardType, cardLast4

8. [GUARD]        If NOT approved: Order.tabStatus -> 'auth_failed', return decline info.
                  If approved but no RecordNo: return 500 error.

9. [DB]           recordTab() -- shared function for duplicate check + atomic creation:
                  a. Stage 2 duplicate check: If recordNo matches existing open tab,
                     void the new hold and return 'existing_tab_found'
                  b. OrderCard created:
                     - recordNo (Datacap token for all future operations)
                     - cardType, cardLast4, cardholderName
                     - authAmount = preAuthAmount
                     - status = 'authorized', isDefault = true
                     - tokenFrequency = 'Recurring'
                     - acqRefData, processData, aid, cvm (chargeback defense data)
                  c. Order updated:
                     - tabStatus = 'open'
                     - tabName = normalized cardholder name (LAST/FIRST -> First Last)
                     - preAuthAmount, preAuthReaderId
                     - version incremented
                  d. emitOrderEvent('TAB_OPENED')
                  e. dispatchTabUpdated(), dispatchTabStatusUpdate()

10. [CLIENT]      CardFirstTabFlow receives result:
                  - approved: true -> status 'done', green checkmark
                  - existing_tab_found -> show existing tab info, offer "Different Card"
                  - declined -> status 'error', "Try Another Card" button

11. [SYNC]        pushUpstream() -- sync to Neon
```

### Phase A (alt) -- Tab Open (Name-Only)

```
1. [CLIENT]       Bartender selects "Name Only" in NewTabModal / NewTabDialog
2. [CLIENT]       "Known As" field required (tabNickname); no card data
3. [API]          POST /api/tabs -> Order created with orderType = 'bar_tab'; no pre-auth
4. [DB]           Order: orderType = 'bar_tab', tabStatus = 'open', tabNickname set,
                  no OrderCard created, no preAuthRecordNo
5. [EVENTS]       emitOrderEvent('ORDER_CREATED') + emitOrderEvent('TAB_OPENED')
6. [BROADCAST]    dispatchTabUpdated({ orderId, status: 'open' })
```

### Phase B -- Items Added During Tab

```
1. [CLIENT]       Bartender adds items to the tab order (standard order flow)
2. [API]          POST /api/orders/[id]/items -> atomic item append
3. [EVENTS]       emitOrderEvent('ITEM_ADDED', payload) per item
4. [SNAPSHOT]     OrderSnapshot.subtotalCents / totalCents updated
```

### Phase B.5 -- Incremental Authorization

**Route:** `POST /api/orders/[id]/auto-increment`
**Source:** `src/app/api/orders/[id]/auto-increment/route.ts`

Fires automatically after items are added. Also available as a manual "Re-Auth" button (`force=true`).

```
1. [TRIGGER]      After item add, system checks if tab total exceeds threshold

2. [CALC]         tabTotal = current order total (WITH tax)
                  thresholdAmount = totalAuthorized * (incrementThresholdPercent / 100)
                  Default threshold: 80% -- so if $100 authorized and tab hits $80, increment fires

3. [CALC]         targetHold = tabTotal * (1 + tipBufferPercent)
                  Default tip buffer: 25% -- hold covers tab total plus likely tip
                  dynamicIncrement = max(targetHold - totalAuthorized, 0)
                  Auto mode: enforce minimum increment (e.g., $25) to avoid frequent small auths
                  Force mode: exact amount needed to reach target

4. [API]          client.incrementalAuth(readerId, { recordNo, additionalAmount })
                  -> Datacap IncrementalAuthByRecordNo -- increases existing hold
                  -> Idempotent: Datacap deduplicates by recordNo within a batch window

5. [DB]           On approval:
                  - OrderCard.authAmount += dynamicIncrement
                  - Order.preAuthAmount = newAuthAmount
                  - Order.incrementAuthFailed = false
                  Socket: dispatchTabUpdated({ orderId, status: 'incremented' })

6. [DB]           On decline:
                  - Order.incrementAuthFailed = true (triggers red badge on terminals)
                  Socket: dispatchTabUpdated({ orderId, status: 'increment_failed' })

7. [SAFETY]       On timeout/network error: ambiguous state logged.
                  Over-holds are low-risk (released at batch close).
                  Next auto-increment recalculates delta from DB state.
```

**Direct increment route:** `POST /api/datacap/increment` provides a lower-level endpoint that takes `recordNo` and `additionalAmount` directly without the auto-threshold logic.

### Phase C -- Tab Close (PreAuthCaptureByRecordNo)

**Route:** `POST /api/orders/[id]/close-tab`
**Source:** `src/app/api/orders/[id]/close-tab/route.ts`

Uses three-phase locking to prevent Datacap network latency from blocking other terminals:

```
1. [CLIENT]       Bartender taps "Close Tab" in tab detail view

2. [AUTH]         requirePermission(employeeId, POS_CARD_PAYMENTS)
                  checkOrderClaim() -- block if another employee has active claim

============ PHASE 1: Short transaction with FOR UPDATE ==================

3. [DB]           validateTabForClose(tx, params):
                  - FOR UPDATE row lock on Order
                  - Verify order is open bar_tab, not already closed/closing
                  - Mark tabStatus = 'closing' (prevents concurrent close attempts)
                  - Return order data with cards

============ BETWEEN PHASES: Pure computation (no lock held) ============

4. [CALC]         computePurchaseAmount(order, dualPricing)
                  - Applies card surcharge if dual pricing enabled
                  parseTipSuggestions(locSettings)
                  resolveAutoGratuity() -- bottle service tier or party-size auto-grat

============ ZERO-TAB HANDLING ($0 purchase amount) =====================

5. [ZERO]         If purchaseAmount <= 0:
                  - For each authorized OrderCard: client.voidSale(readerId, { recordNo })
                  - Record per-card release status (partial failure = 207 status)
                  - Order closed as voided with no payment

============ PHASE 2: Datacap API calls (NO database lock) ==============

6. [SAFETY]       Write _pending_captures record BEFORE calling Datacap
                  (recoverable if Phase 3 fails after capture succeeds)

7. [TIP]          If tipMode = 'device':
                  - client.getSuggestiveTip(readerId, tipSuggestions)
                  - CFD shows tip options, customer selects
                  - Configurable timeout (default 8s), falls back to $0 tip
                  If tipMode = 'receipt': tip = $0 (added later via adjust)
                  If tipMode = 'included': tip = provided tipAmount

8. [API]          client.preAuthCapture(readerId, { recordNo, purchaseAmount, gratuityAmount })
                  -> Datacap PreAuthCaptureByRecordNo -- captures exact amount against hold
                  -> Tries each card in order (default card first)

9. [SAFETY]       If capture fails for a card:
                  - Log ambiguous state (capture may have succeeded on processor)
                  - Fire-and-forget: void/release the pre-auth to free customer's hold
                  - Try next card if available

============ PHASE 3: Short transaction with FOR UPDATE ==================

10. [DB]          recordCaptureSuccess(tx, params):
                  a. FOR UPDATE on Order row
                  b. OrderCard: status = 'captured', capturedAmount, tipAmount, capturedAt
                  c. Order: status = 'paid', tabStatus = 'closed', paidAt, closedAt
                  d. Payment created: amount, tipAmount, totalAmount, authCode,
                     datacapRecordNo, cardBrand, cardLast4, status = 'completed'
                  e. Remaining authorized cards on tab: status = 'voided'

11. [EVENTS]      emitOrderEvent('TAB_CLOSED', { tipCents, adjustedAmountCents })
                  emitOrderEvent('PAYMENT_APPLIED', { paymentId, amount, tip })
                  emitOrderEvent('ORDER_CLOSED', { closedStatus: 'paid' })

12. [SIDE EFFECTS] All fire-and-forget:
                  - allocateTipsForPayment() -> TipLedger credit
                  - Inventory deduction via PendingDeduction
                  - dispatchTabClosed(), dispatchTabUpdated(), dispatchOrderClosed()
                  - Receipt print
```

### Phase D -- Tip Adjustment (AdjustByRecordNo)

**Route:** `POST /api/datacap/adjust`
**Source:** `src/app/api/datacap/adjust/route.ts`

After capture with receipt-based tip (customer writes tip on receipt):

```
1. [CLIENT]       Bartender enters signed receipt tip amount

2. [AUTH]         requirePermission(employeeId, POS_CARD_PAYMENTS)

3. [API]          client.adjustGratuity(readerId, { recordNo, purchaseAmount, gratuityAmount })
                  -> Datacap AdjustByRecordNo -- modifies the captured amount

4. [RESPONSE]     Returns: { approved, adjustedAmount, sequenceNo }
```

The adjust operation modifies the transaction amount in the current open batch. It must be done BEFORE batch close.

### Phase E -- Void Tab (VoidByRecordNo)

To cancel a tab entirely (no charge):

```
1. [CLIENT]       Manager selects "Void Tab"

2. [API]          For each authorized OrderCard:
                  client.voidSale(readerId, { recordNo })
                  -> Datacap VoidSaleByRecordNo -- releases hold on card

3. [DB]           OrderCard.status = 'voided'
                  Order.status = 'voided', tabStatus = 'closed'

4. [EVENTS]       TAB_CLOSED, ORDER_CLOSED events emitted
```

If the tab was already captured (closed), void follows the standard payment void path (see `docs/flows/void-vs-refund.md`).

---

## 4. Tab Expiration

### 7-Day Pre-Auth Window

Card networks (Visa/MC) impose a 7-day hold window for pre-authorizations. After 7 days, the hold automatically falls off the cardholder's account. If the venue attempts to capture after expiry:

- The capture may be declined by the issuing bank
- The capture may succeed but at a downgraded interchange rate
- The venue has reduced chargeback protection

`Order.preAuthExpiresAt` tracks the estimated expiry. The UI (`AuthStatusBadge.tsx`) should warn bartenders as the tab ages.

### EOD Auto-Capture

At end-of-day, `executeEodReset()` auto-captures all open bar tabs with authorized cards:

1. Finds tabs with `status: 'open'`, `orderType: 'bar_tab'`, and at least one `OrderCard` with `status: 'authorized'`
2. Excludes tabs that are `closing` or `pending_auth` (in-progress on another terminal)
3. Applies auto-gratuity (configurable %, default 20%)
4. Calls `preAuthCapture` per tab
5. On decline: marks `tabStatus = 'declined_capture'`, increments retry count
6. On approval: creates Payment, closes order, allocates tips

Tabs with no authorized cards (name-only tabs, cards already voided) are rolled over.

---

## 5. Walkout Scenario

When a tab is abandoned (customer leaves without closing):

1. **EOD detection:** `executeEodReset()` auto-captures the tab with auto-gratuity
2. **Capture declined:** Tab marked `declined_capture`, `captureRetryCount` incremented
3. **Manager flags walkout:** `POST /api/orders/[id]/mark-walkout` creates a `WalkoutRetry` record
4. **Auto-retry:** `GET /api/cron/walkout-retry` retries capture on schedule (fixed interval per `walkoutRetryFrequencyDays`, up to `maxRetries`)
5. **Exhausted:** After max retries, manager writes off via `TAB_WRITEOFF` permission

There is currently no automated scheduler for walkout retries and no write-off API endpoint (see `docs/features/walkout-retry.md` for known gaps).

---

## 6. OrderCard Model and RecordNo Lifecycle

The `OrderCard` model tracks each card associated with a tab:

```
model OrderCard {
  id             String           -- cuid
  locationId     String
  orderId        String           -- the bar tab Order
  readerId       String           -- PaymentReader that processed this card
  recordNo       String           -- Datacap RecordNo token (THE KEY)
  cardType       String           -- VISA, MASTERCARD, AMEX, etc.
  cardLast4      String
  cardholderName String?          -- from chip data, auto-fills tabName
  authAmount     Decimal(10,2)    -- current total authorized (increases with increments)
  isDefault      Boolean          -- primary payment card for this tab
  status         OrderCardStatus  -- authorized | captured | declined | voided | released

  -- Datacap metadata for ByRecordNo operations
  tokenFrequency String?          -- 'OneTime' | 'Recurring'
  acqRefData     String?          -- acquirer reference (some processors require this)
  processData    String?          -- processor routing data
  aid            String?          -- EMV Application ID (chargeback evidence)
  cvm            String?          -- Cardholder Verification Method
  authCode       String?          -- 6-digit authorization code
  refNo          String?          -- Datacap reference number

  -- Capture details (populated at tab close)
  capturedAmount Decimal(10,2)?
  capturedAt     DateTime?
  tipAmount      Decimal(10,2)?
}
```

### RecordNo Lifecycle

| Event | RecordNo Usage |
|-------|---------------|
| Tab opened | `EMVPreAuth` returns `recordNo` -- stored on `OrderCard` |
| Incremental auth | `IncrementalAuthByRecordNo(recordNo, additionalAmount)` |
| Tab close (capture) | `PreAuthCaptureByRecordNo(recordNo, purchaseAmount, gratuityAmount)` |
| Tip adjust | `AdjustByRecordNo(recordNo, purchaseAmount, gratuityAmount)` |
| Tab void | `VoidSaleByRecordNo(recordNo)` |
| Duplicate check | `recordNo` compared against existing open tabs to prevent double-auth |

The `recordNo` is the single token that threads through every Datacap operation on a tab. It is set at pre-auth time and NEVER overwritten.

### Status Transitions

```
authorized  -- (capture approved)  --> captured
authorized  -- (capture declined)  --> (stays authorized, retryable)
authorized  -- (void)              --> voided
authorized  -- ($0 tab release)    --> released
captured    -- (void post-capture) --> voided (standard void path)
```

---

## 7. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `ORDER_CREATED` | `{ locationId, orderId, employeeId, orderType }` | POS API | Android, Backoffice | First event on order |
| `TAB_OPENED` | `{ preAuthId, preAuthAmount, preAuthRecordNo }` | POS API | Android, Backoffice | After ORDER_CREATED |
| `ITEM_ADDED` | `{ itemId, name, priceCents, quantity }` | POS API | Android, KDS | After TAB_OPENED |
| `ORDER_METADATA_UPDATED` | `{ preAuthAmount }` or `{ tabStatus }` | POS API | Android | After increment or status change |
| `PAYMENT_APPLIED` | `{ paymentId, amount, tipAmount, paymentMethod }` | POS API | Android, Backoffice | After Datacap capture |
| `TAB_CLOSED` | `{ orderId, tipCents, adjustedAmountCents }` | POS API | Android, Backoffice | After PAYMENT_APPLIED |
| `ORDER_CLOSED` | `{ closedStatus: 'paid' }` | POS API | Android, KDS, Backoffice | Last event on order |
| `tab:updated` | `{ orderId, status }` | socket-dispatch | All POS clients, Android | After DB write |
| `tab:status-update` | `{ orderId, status }` | socket-dispatch | Tab list components | After DB write |
| `tab:closed` | `{ orderId, total, tipAmount }` | socket-dispatch | Mobile clients | After ORDER_CLOSED |

---

## 8. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Order` | `tabStatus = 'pending_auth'` | Immediately on open-tab request |
| `Order` | `tabStatus = 'open'`, `tabName`, `preAuthAmount`, `preAuthReaderId` | Tab open approved |
| `OrderCard` | Created with `recordNo`, `authAmount`, `status = 'authorized'`, `isDefault = true` | Tab open approved |
| `OrderCard` | `authAmount` increased | Incremental auth approved |
| `Order` | `preAuthAmount` increased, `incrementAuthFailed` cleared | Incremental auth approved |
| `Order` | `incrementAuthFailed = true` | Incremental auth declined |
| `Order` | `tabStatus = 'closing'` | Phase 1 of close-tab |
| `OrderCard` | `status = 'captured'`, `capturedAmount`, `tipAmount`, `capturedAt` | Tab close captured |
| `Order` | `status = 'paid'`, `tabStatus = 'closed'`, `paidAt`, `closedAt` | Tab close captured |
| `Payment` | Created: `status = 'completed'`, `tipAmount`, `datacapRecordNo` | Tab close captured |
| `TipLedgerEntry` | Created (IMMUTABLE): `type = CREDIT`, `sourceType = DIRECT_TIP` | After capture, fire-and-forget |
| `WalkoutRetry` | Created with `nextRetryAt`, `retryCount = 0`, `status = 'pending'` | Walkout path only |

---

## 9. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Duplicate card on open tab** | Two-stage duplicate detection: Stage 1 after CollectCardData, Stage 2 after PreAuth. New hold is voided, existing tab returned. |
| **Name-only tab close** | No Datacap capture -- bartender processes payment via standard `POST /api/orders/[id]/pay` (cash or manual card entry). |
| **Card declined on capture** | Tab remains open with `tabStatus = 'declined_capture'`. Can be retried. After max retries, manager flags walkout. |
| **Incremental auth race** | If tab spend surpasses threshold between items, IncrementalAuth fires automatically. If declined, red badge shown but tab continues. |
| **Multiple cards on one tab** | Multiple `OrderCard` records. Default card tried first on capture. If it fails, fallback cards tried in order. |
| **Tab transferred between employees** | `POST /api/tabs/[id]/transfer` updates `Order.employeeId`. Tip ownership transfers. |
| **Unsent items at close** | `close-tab` guards against this -- returns 409 if undelivered items exist. |
| **Pre-auth expiry (7 days)** | Capture may fail. System should warn before expiry (AuthStatusBadge.tsx). |
| **Concurrent close attempts** | Phase 1 `FOR UPDATE` row lock + `tabStatus = 'closing'` prevents double-capture. Second terminal gets 409. |
| **Capture timeout (ambiguous state)** | Capture logged for reconciliation. Pre-auth void attempted (fire-and-forget). Tab retryable. |
| **Stale pending_auth (EDGE-7)** | If `pending_auth` older than 5 minutes, auto-recovered to `open`. |
| **Device tip prompt timeout** | Falls back to $0 tip after configurable timeout (default 8s). Bartender adjusts later via `/api/datacap/adjust`. |
| **Zero-amount tab** | Pre-auth released (not captured). Per-card release with partial failure handling. |

---

## 10. Invariants (Never Break These)

- **[TAB-1]** Pre-auth MUST be captured within Datacap's hold window (7 days). If `preAuthExpiresAt` is exceeded, capture may fail.
- **[TAB-2]** Tip MUST be recorded in the TipLedger AFTER the Datacap capture call completes and the Payment record is written. Never credit tip before capture.
- **[TAB-3]** NEVER close a tab with unsent items. The close-tab API must check and block.
- **[TAB-4]** Tab total on capture MUST match the calculated order total. `PreAuthCaptureByRecordNo` receives the exact final amount.
- **[TAB-5]** `TipLedgerEntry` records are IMMUTABLE -- never update or delete. Corrections are delta entries.
- **[TAB-6]** `OrderCard.recordNo` is the key to all Datacap operations on that card. Set at pre-auth time, NEVER overwritten.
- **[TAB-7]** `tabName` (cardholder name from chip) is read-only after collection. `tabNickname` is always editable.
- **[TAB-8]** A tab with `isWalkout = true` must follow the walkout retry path, never a direct close-tab call.
- **[TAB-9]** Three-phase locking: Datacap API calls MUST happen outside database transactions to prevent lock contention.

---

## 11. Dependencies & Cross-Refs

| Doc | Why |
|-----|-----|
| `docs/features/tabs.md` | Full tabs feature spec, data model, business rules |
| `docs/features/payments.md` | Datacap pre-auth/capture transaction types |
| `docs/features/tips.md` | TipLedger immutability, allocateTipsForPayment() |
| `docs/guides/PAYMENTS-RULES.md` | Datacap-only rule, communicationMode |
| `docs/flows/void-vs-refund.md` | Reversal path after tab close |
| `docs/flows/batch-settlement.md` | EOD auto-capture and batch close |

### Key Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/open-tab/route.ts` | Tab open: CollectCardData + EMVPreAuth |
| `src/app/api/orders/[id]/close-tab/route.ts` | Tab close: three-phase PreAuthCapture |
| `src/app/api/orders/[id]/auto-increment/route.ts` | Auto-increment after item add |
| `src/app/api/datacap/increment/route.ts` | Direct incremental auth endpoint |
| `src/app/api/datacap/adjust/route.ts` | Tip adjustment via AdjustByRecordNo |
| `src/lib/datacap/use-cases.ts` | `openBarTab()`, `closeBarTab()`, `voidPayment()` |
| `src/lib/datacap/client.ts` | TCP transport: preAuth, preAuthCapture, incrementalAuth, voidSale, adjustGratuity |
| `src/lib/domain/tab-close/` | Pure functions: validateTabForClose, computePurchaseAmount, recordCaptureSuccess |
| `src/components/tabs/CardFirstTabFlow.tsx` | React UI component for card-first tab open |
| `src/lib/datacap/record-tab.ts` | Shared recordTab() for duplicate check + OrderCard creation |
| `src/lib/eod.ts` | EOD auto-capture of open tabs at batch close |

---

*Last updated: 2026-03-29*
