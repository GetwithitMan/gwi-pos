# Flow: Tab Open to Close

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A bartender opens a bar tab for a customer — either by swiping/dipping a card (card-present) or by name only (name-only tab).

**Why it matters:** Money integrity. The pre-authorization hold is a real financial instrument. If a tab is closed without capturing, or captured for the wrong amount, or if a tip is recorded before the capture settles, money is lost or mismatch occurs between the card network and the database. The entire sequence must be deterministic and auditable.

**Scope:** `gwi-pos` (API, tab UI, Datacap client, socket dispatch), `gwi-android-register` (NewTabDialog, TabListSheet, PaymentManager), `gwi-cfd` (CFDTipScreen on tab close).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `tabsEnabled` on location settings; incremental auth threshold (default 80%) configurable |
| Hardware required | Datacap VP3300/VP3350 card reader on LAN; receipt printer (optional) |
| Permissions required | `TAB_OPEN` (Standard) to open; `TAB_CLOSE` (Standard) to close; `TAB_TRANSFER` (High) to transfer; `TAB_WRITEOFF` (Critical) to write off walkout |
| Online / offline state | NUC must be reachable for all Datacap pre-auth and capture calls; cannot open card-based tabs offline |
| Prior state | An `Order` shell must exist (created via `POST /api/orders`) or is created inline by the tab flow; no unsent items may exist when closing |

---

## 3. Sequence (Happy Path)

### Phase A — Tab Open (Card-Present)

```
1. [CLIENT]       Bartender taps "New Tab" in TabsPanel or NewTabDialog (Android)
2. [CLIENT]       Card-first flow begins: PendingTabAnimation shimmer shown
3. [API]          POST /api/datacap/collect-card → DatacapClient.CollectCardData
                  Reader prompts customer tap/dip/swipe → returns cardholder name + card data
4. [API]          POST /api/orders (if not pre-created) → Order shell with isTab = true
5. [API]          POST /api/orders/[id]/open-tab → DatacapClient.EMVPreAuth
                  Pre-auth holds configurable amount against card
6. [DB]           Order updated: isTab = true, tabStatus = 'open', preAuthId, preAuthAmount,
                  preAuthRecordNo, preAuthLast4, preAuthCardBrand, preAuthExpiresAt
                  OrderCard created: recordNo token, authAmount, status = 'authorized', isDefault = true
7. [EVENTS]       emitOrderEvent(locationId, orderId, 'TAB_OPENED', { preAuthId, preAuthAmount })
8. [SNAPSHOT]     OrderSnapshot rebuilt: isClosed = false, status reflects tab open
9. [BROADCAST]    emitToLocation('tab:updated', { orderId, status: 'open' })
                  socket-dispatch.ts → dispatchTabUpdated()
10. [SIDE EFFECTS] Tab appears in TabsPanel / TabListSheet with 'open' badge;
                   PendingTabAnimation resolves to confirmed state
```

### Phase A (alt) — Tab Open (Name-Only)

```
1. [CLIENT]       Bartender selects "Name Only" in NewTabModal / NewTabDialog
2. [CLIENT]       "Known As" field required (tabNickname); no card data
3. [API]          POST /api/tabs → Order created with isTab = true; no pre-auth call made
4. [DB]           Order: isTab = true, tabStatus = 'open', tabNickname set, no preAuthRecordNo
5. [EVENTS]       emitOrderEvent(locationId, orderId, 'ORDER_CREATED' + 'TAB_OPENED', payloads)
6. [SNAPSHOT]     OrderSnapshot rebuilt
7. [BROADCAST]    emitToLocation('tab:updated', { orderId, status: 'open' })
```

### Phase B — Items Added During Tab

```
1. [CLIENT]       Bartender adds items to the tab order (standard order flow)
2. [API]          POST /api/orders/[id]/items → atomic item append
3. [EVENTS]       emitOrderEvent('ITEM_ADDED', payload) per item
4. [SNAPSHOT]     OrderSnapshot.subtotalCents / totalCents updated
5. [AUTO-MONITOR] System checks: subtotalCents >= (authAmount * incrementalThreshold%)
6. [API]          If threshold breached → POST /api/datacap/increment
                  DatacapClient.IncrementalAuthByRecordNo(OrderCard.recordNo, newAmount)
7. [DB]           OrderCard.authAmount updated with new authorized total
```

### Phase C — Tab Close (Card-Present, CFD Tip Flow)

```
1. [CLIENT]       Bartender taps "Close Tab" in tab detail view
2. [API]          POST /api/orders/[id]/close-tab is initiated
3. [GUARD]        API checks: no unsent items on order (INVARIANT — block if violated)
4. [BROADCAST]    emitToLocation('cfd:tip-prompt', { orderId, tipSuggestions[] })
                  CFD shows CFDTipScreen → customer selects tip
5. [CFD→POS]      cfd:tip-selected event received with tipAmountCents
6. [API]          DatacapClient.PreAuthCaptureByRecordNo(OrderCard.recordNo, finalAmount + tip)
                  Datacap captures the exact amount + tip against stored recordNo token
7. [DB]           Payment record created: status = 'completed', settledAt set
                  OrderCard.status = 'captured', capturedAmount, tipAmount set
                  Order: tabStatus = 'closed'
8. [EVENTS]       emitOrderEvent('PAYMENT_APPLIED', { paymentId, amount, tipAmount })
                  emitOrderEvent('TAB_CLOSED', { orderId, total, tipAmount })
                  emitOrderEvent('ORDER_CLOSED', { orderId })
9. [TIP LEDGER]   allocateTipsForPayment() called fire-and-forget AFTER capture
                  postToTipLedger(CREDIT, DIRECT_TIP) credits bartender's TipLedger
                  TipLedgerEntry created (IMMUTABLE)
10. [SNAPSHOT]    OrderSnapshot rebuilt: isClosed = true, paidAmountCents = totalCents
11. [BROADCAST]   dispatchTabClosed() → emitToLocation('tab:closed', { orderId, total, tipAmount })
                  dispatchTabUpdated() → emitToLocation('tab:updated', { orderId, status: 'closed' })
                  dispatchPaymentProcessed()
12. [SIDE EFFECTS] Receipt printed fire-and-forget; CFD shows cfd:approved → cfd:idle;
                   Tab removed from open tab list on all terminals
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `ORDER_CREATED` | `{ locationId, orderId, employeeId, orderType }` | POS API | Android, Backoffice | First event on order |
| `TAB_OPENED` | `{ preAuthId, preAuthAmount, preAuthRecordNo }` | POS API | Android, Backoffice | After ORDER_CREATED |
| `ITEM_ADDED` | `{ itemId, name, priceCents, quantity }` | POS API | Android, KDS | After TAB_OPENED |
| `PAYMENT_APPLIED` | `{ paymentId, amount, tipAmount, paymentMethod }` | POS API | Android, Backoffice | After Datacap approval |
| `TAB_CLOSED` | `{ orderId, total, tipAmount }` | POS API | Android, Backoffice | After PAYMENT_APPLIED |
| `ORDER_CLOSED` | `{ orderId }` | POS API | Android, KDS, Backoffice | Last event on order |
| `tab:updated` | `{ orderId, status? }` | socket-dispatch.ts | All POS clients, Android | After DB write |
| `tab:closed` | `{ orderId, total, tipAmount }` | socket-dispatch.ts | Mobile clients | After ORDER_CLOSED |
| `cfd:tip-prompt` | `{ orderId, tipSuggestions[] }` | POS API | CFD | Before capture call |
| `cfd:approved` | `{ orderId, cardLast4 }` | POS API | CFD | After capture |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Order` | `isTab = true`, `tabStatus = 'open'`, `preAuthId`, `preAuthAmount`, `preAuthRecordNo`, `preAuthLast4`, `preAuthCardBrand`, `preAuthExpiresAt` | Tab open |
| `OrderCard` | Created with `recordNo`, `authAmount`, `status = 'authorized'`, `isDefault = true` | Tab open |
| `OrderCard` | `status = 'captured'`, `capturedAmount`, `tipAmount`, `capturedAt` | Tab close |
| `Order` | `tabStatus = 'closed'` | Tab close |
| `Payment` | Created: `status = 'completed'`, `settledAt`, `tipAmount`, `datacapRecordNo` | Tab close |
| `TipLedgerEntry` | Created (IMMUTABLE): `type = CREDIT`, `sourceType = DIRECT_TIP`, `amountCents` | After capture, fire-and-forget |
| `TipLedger` | `currentBalanceCents` updated | After ledger entry |
| `OrderSnapshot` | Full rebuild after every `emitOrderEvent()` call | Steps 8, 10 in Phase C |
| `WalkoutRetry` | Created with `nextRetryAt`, `retryCount = 0`, `status = 'pending'` | Walkout path only |

**Snapshot rebuild points:** After TAB_OPENED, after each ITEM_ADDED, after PAYMENT_APPLIED + TAB_CLOSED + ORDER_CLOSED.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Name-only tab close** | No Datacap capture — bartender enters tip manually and processes payment via standard `POST /api/orders/[id]/pay` with cash or manual card entry; no `OrderCard.recordNo` involved |
| **Card declined on capture** | Datacap returns non-Approved status; API returns 422; DB NOT written; tab remains open; manager marks walkout via `POST /api/orders/[id]/mark-walkout`; `WalkoutRetry` created with exponential backoff schedule |
| **Walkout recovery** | `WalkoutRetry` auto-retried via `POST /api/datacap/walkout-retry`; max retries configurable (default 10); after exhaustion manager calls `TAB_WRITEOFF` (`manager.void_payments` required) |
| **Incremental auth race** | If tab spend surpasses 80% threshold between items, `IncrementalAuthByRecordNo` fires automatically; `OrderCard.authAmount` updated; if this fails, tab can still be closed but capture may partially decline |
| **Multiple cards on one tab** | Multiple `OrderCard` records per order; one has `isDefault = true`; capture uses default card's `recordNo`; multi-card badges shown via `MultiCardBadges.tsx` |
| **Tab transferred between employees** | `POST /api/tabs/[id]/transfer` → `Order.employeeId` updated; tip ownership transfers to new bartender; requires `TAB_TRANSFER` permission |
| **Unsent items at close** | `close-tab` API guards against this — returns 409 if order has items that have not been sent to kitchen; bartender must send or void items first |
| **Pre-auth expiry** | `preAuthExpiresAt` tracked; if tab aged beyond Datacap hold window, capture may fail; system should warn before expiry (display logic in `AuthStatusBadge.tsx`) |
| **Customer disputes amount** | After close, manager initiates refund via `POST /api/orders/[id]/refund-payment` (see void-vs-refund.md); `RefundLog` created |
| **Tab nickname conflict** | `tabNickname` is display-only and not unique; `tabName` (from chip) is retained for payment records regardless of nickname |
| **Offline** | Pre-auth and capture both require active network; cannot open or close card tabs offline; name-only tabs can be opened offline but payment requires network |

---

## 7. Invariants (Never Break These)

- **[TAB-1]** Pre-auth MUST be captured within Datacap's hold window. If `preAuthExpiresAt` is exceeded, the capture may fail silently at the card network. The system must warn before expiry.
- **[TAB-2]** Tip MUST be recorded in the TipLedger AFTER the Datacap capture call completes and the Payment record is written. Never credit tip before capture.
- **[TAB-3]** NEVER close a tab with unsent items. The close-tab API must check and block if any `OrderItem` has not been sent to kitchen.
- **[TAB-4]** Tab total on capture MUST match the calculated order total (subtotal + tax + tip). The `PreAuthCaptureByRecordNo` call receives the exact final amount.
- **[TAB-5]** `TipLedgerEntry` records are IMMUTABLE — never update or delete. Corrections are delta entries.
- **[TAB-6]** `OrderCard.recordNo` is the key to all future Datacap operations on that card. It must be stored on `OrderCard` at pre-auth time and never overwritten.
- **[TAB-7]** `tabName` (cardholder name from chip) is read-only after collection. `tabNickname` is always editable. Display priority is: nickname → card name → "Tab #N".
- **[TAB-8]** A tab with `isWalkout = true` must follow the walkout retry path, never a direct close-tab call.

If you break TAB-2 (tip before capture): compensate by posting a DEBIT entry to reverse the credit, then re-credit after confirmed capture. If you break TAB-3: the order will close with kitchen items that were never prepared, causing inventory and reporting errors.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/tabs.md` | Full tabs feature spec, data model, business rules |
| `docs/features/payments.md` | Datacap pre-auth/capture transaction types and rules |
| `docs/features/tips.md` | TipLedger immutability, allocateTipsForPayment(), clock-out guard |
| `docs/features/orders.md` | Order event sourcing, 17 event types, TAB_OPENED / TAB_CLOSED events |
| `docs/guides/PAYMENTS-RULES.md` | Datacap-only rule, communicationMode, payment priority rule |
| `docs/flows/void-vs-refund.md` | Reversal path after tab close (post-settlement refund) |

### Features Involved
- **Tabs** — primary lifecycle owner; drives Order.isTab, OrderCard, WalkoutRetry
- **Payments** — Datacap pre-auth and capture; all card network interaction
- **Orders** — event sourcing; OrderEvent log; OrderSnapshot; item guard
- **Tips** — post-capture tip allocation via TipLedger; immutable ledger entries
- **CFD** — tip prompt on close (cfd:tip-prompt / cfd:tip-selected / cfd:approved)
- **Roles & Permissions** — TAB_OPEN, TAB_CLOSE, TAB_TRANSFER, TAB_WRITEOFF gates

---

*Last updated: 2026-03-03*
