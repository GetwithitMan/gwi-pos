# Audit Regression Guard List
**Source:** Android Bartender Audit 2026-03-03
**Purpose:** 31 invariants to re-verify after any change to payment, order, shift, tips, or permission code.

If a future PR touches the areas below, check the corresponding invariant before merging.

---

## Payment Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| P1 | Cannot pay with PENDING (unsent) kitchen items | `PayOrderUseCase.ensureOrderReadyForPayment()` + `POST /api/orders/[id]/pay` | Add item, don't send, attempt payment |
| P2 | Partial cash payment moves order to `in_progress` | `POST /api/orders/[id]/pay` (partial branch) | Pay $5 on a $20 order |
| P3 | `appliedPayments` seeded from CONFIRMED `PaymentLogEntity` on PaymentSheet open | `OrderViewModel.showPayment()` | Close + reopen PaymentSheet mid-payment |
| P4 | Item add rejected if any payment is `pending` or `completed` | `POST /api/orders/[id]/items` | Open payment sheet, attempt add item from another terminal |
| P5 | Voided payment syncs to all terminals via socket | `OrderSyncController.handlePaymentProcessed()` | Void payment on web POS → check Android terminal |

## Order Mutation Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| O1 | Comp/void blocked after any completed payment | `POST /api/orders/[id]/comp-void` + `POST /api/orders/[id]/items/[itemId]` | Pay order, attempt comp/void |
| O2 | Every order mutation emits an event via `emitOrderEvent()` | All mutation routes | Check `order_events` table after any mutation |
| O3 | Kitchen status changes are event-sourced (not direct Room writes) | `OrderSyncController.handleKdsItemStatus()` | Mark item fired in KDS → replay events → kitchen status preserved |

## Shift / Clock Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| S1 | Clock-out blocked during active card payment | `OrderViewModel.clockOut()` (isProcessingPayment guard) | Start payment, attempt clock out |
| S2 | Shift close 409 parsed into open-order count + manager override flag | `OrderViewModel.closeShift()` (Moshi parse of ShiftCloseErrorBody) | Close shift with open orders → confirm count shows in sheet |
| S3 | Shift close sheet shows pending tip count before user taps Close | `OrderViewModel.showShiftClose()` (getPendingTips call) | Have pending tips, open shift close → count visible |
| S4 | Manager override button appears when `requiresManagerOverride=true` | `ShiftCloseSheet` | Trigger 409 with open orders on an employee who needs override |

## Tips Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| T1 | Pending tips scoped to current shift in shift-close sheet | `OrderViewModel.showShiftClose()` passes `shiftId` | Tips from prior shift must NOT appear in shift-close count |
| T2 | Tip edits rejected after shift closed >24h | `POST /api/tips/adjustments` (shift.endedAt check) | Attempt tip edit on payment from shift closed yesterday |
| T3 | Tip edit UI disabled and warns on locked-shift payments | `TipEntrySheet` (shiftEditLocked) | Open TipEntrySheet for payment from old closed shift |
| T4 | Tips >50% of order total show amber warning on Android | `PaymentSheet`, `CloseTabSheet`, `TipEntrySheet` | Enter tip that exceeds half the order total |
| T5 | Tips >200% of payment base rejected server-side | `POST /api/tips/adjustments` (200% guard) | Submit extreme tip via API |

## UI / UX Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| U1 | $0 order (after comp/discount) shows "Complete / No Charge" button, hides Cash/Card/Other | `SendButtonRow` (total == 0L branch) | Apply 100% discount → payment row replaced |
| U2 | Tab list shows Open/Closed badge + balance due per row | `TabListSheet` | Open tabs with partial payments visible |
| U3 | Seat split warns when unassigned items exist | `SplitCheckSheet` (showUnassignedWarning) | Split by seat with items that have no seat number |
| U4 | Spirit dialog cannot be dismissed by tapping the scrim | `SpiritSelectionDialog` (dismissOnClickOutside=false) | Tap outside spirit dialog |
| U5 | Modifier sheet blocks swipe-down when any selection has been made | `ModifierSheet` (hasPartialSelection guard) | Make modifier selections, swipe down → blocked |
| U6 | Single-option required modifier groups auto-select on sheet open | `ModifierSheet` (LaunchedEffect) | Open modifier sheet for item with 1-option required group |
| U7 | Tab nickname capped at 30 chars with counter | `NewTabDialog` | Type >30 chars in Known As field |
| U8 | Pending tips empty state is clear in My Tips screen | `MyTipsScreen` (Pending Tips tab) | Clear all pending tips → "No pending tips / You're all set" message |
| U9 | Persistent amber banner shown when send-to-kitchen fails | `OrderMainContent` (criticalError state) | Simulate send failure → banner persists until ✕ tapped |

## Dual Pricing Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| DP1 | Android and web order panel MUST display identical cash and card totals for the same Order ID. Canonical rule: `cardTotal = cashTotal × (1 + cashDiscountPercent/100)` — surcharge is applied POST-TAX to the full cash total, not pre-tax to the subtotal. Any change to order panel price display on either platform must verify this invariant. Established: 2026-03-03. | `OrderViewModel.recalcSurcharge()` (Android); `usePricing.ts` (web) | Compare same Order ID side-by-side on Android panel and web order panel — cash totals must match, card totals must match |
| DP2 | `recalcSurcharge()` base must be `order.total` (post-tax cash total), never `subtotal - discountTotal` (pre-tax). The missing `subtotal × pct × taxRate` cross-term causes customer-visible divergence. | `OrderViewModel.recalcSurcharge()` | Order with tax: verify `surchargeTotal = cashTotal × pct/100`, not `(subtotal-discount) × pct/100` |
| DP3 | No "Card Fee", "Non-Cash Adjustment", or separate surcharge line may appear in any UI surface (Android totals, Android PaymentSheet, web order panel, web receipt) when dual pricing is active. Card price is the primary/advertised price; cash total is a secondary breakdown. Any change to totals display on either platform must verify this invariant. Established: 2026-03-03. | `OrderTotalsSection.kt` (Android); `Receipt.tsx` + `OrderPanel.tsx` (web) | Enable dual pricing, place a card order → confirm: (1) no fee/surcharge line anywhere, (2) card total shown first/prominently, (3) cash breakdown secondary. Cross-check same Order ID on Android and web. |
| DP4 | All UI surfaces that display dual-pricing totals (order panel, payment sheet, payment buttons) must derive their values from the **same shared source**: Android = `OrderUiState` fields; Web POS = props from `usePricing`. No surface may compute its own `cardTotal` or `cashTotal` from a separate data path. `"Save $X by paying with cash!"` savings message is **required** (not a DP3 violation) and must appear inside the expandable totals section when dual pricing is active. Established: 2026-03-03. | `OrderTotalsSection.kt`, `SendButtonRow.kt`, `PaymentSheet.kt` (all read from `OrderUiState`); `OrderPanelActions.tsx` (all read from `usePricing` props) | Enable dual pricing: open order panel + payment sheet side-by-side → cash and card totals must be identical across all three composables on Android, and across web panel + payment processor view. |

## Process Safety Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| PR1 | `currentOrderId` restored after process death | `OrderViewModel` (savedStateHandle) | Kill app process mid-order → reopen → active order restored |
| PR2 | Rapid item taps debounced (300ms) | `OrderViewModel.onItemClicked()` | Tap same item 5× quickly → only first tap registers within 300ms window |
| PR3 | Item quantity capped at 999 | `AddItemUseCase` (.coerceAtMost) | Tap same item 1000× → qty stops at 999 |
| PR4 | Close Tab tip field resets on every re-open | `CloseTabSheet` (remember(closeTabNonce)) | Open close-tab, enter tip, dismiss, reopen → tip field is blank |

## Permission Security Invariants

| ID | Invariant | How to verify |
|----|-----------|---------------|
| PS1 | Adding items to another employee's order requires POS_EDIT_OTHERS_ORDERS | POST /api/orders/[id]/items without permission → 403 |
| PS2 | Any item submitted with a price differing from its menu price by >$0.01 requires MGR_OPEN_ITEMS (except weight-based, pizza, and timed-rental items) | POST items with custom price without permission → 403 |
| PS3 | Editing an order item that has left 'pending' kitchen status (sent/cooking/ready/delivered) requires MGR_EDIT_SENT_ITEMS | PUT /api/orders/[id]/items/[itemId] on sent item without permission → 403 |
| PS4 | Shift close with absolute cash variance >$5 requires MGR_CASH_VARIANCE_OVERRIDE; response includes code: 'VARIANCE_OVERRIDE_REQUIRED' and variance amount | PUT /api/shifts/[id] close with large variance without permission → 403 with code |
| PS5 | Tax exemption (isTaxExempt=true) on an Order requires MGR_TAX_EXEMPT; once set, calculateOrderTotals and calculateSimpleOrderTotals both apply taxRate=0 for all subsequent recalculations | Set isTaxExempt without permission → 403; verify taxTotal=0 after setting |

## Sync & Security Hardening (2026-03-10)

> Added after comprehensive 6-agent penetration test. These invariants protect against data loss, double-charging, and auth bypass.

### Payment Safety (5)
- **PAY1**: Tip amount MUST NOT exceed 500% of payment amount — enforced in pay/route.ts post-Zod validation
- **PAY2**: Split child payments MUST NOT exceed parent order total — aggregate check against all completed sibling payments
- **PAY3**: PendingDeduction with status `succeeded` or `dead` MUST NOT be reset to `pending` on re-pay — prevents double inventory deduction
- **PAY4**: All Payment mutations on NUC (adjust-tip, refund, void) MUST set `lastMutatedBy: 'local'` — required for upstream sync replication
- **PAY5**: All Order total mutations on NUC (tip adjust, refund tip reduction, commission recalc) MUST set `lastMutatedBy: 'local'`

### Sync Safety (5)
- **SYNC1**: Downstream sync HWM (`maxSyncedAt`) MUST only advance for successfully synced rows — failed rows must retry on next cycle
- **SYNC2**: FulfillmentEvent creation in `handleCloudFulfillment` MUST check for existing events by orderId — prevents duplicate printing
- **SYNC3**: `handleCloudDeduction` MUST NOT use SELECT-before-INSERT pattern — rely solely on `ON CONFLICT ("orderId") DO NOTHING`
- **SYNC4**: Socket dispatch in downstream sync MUST emit at most one `dispatchOpenOrdersChanged` per location per sync cycle — prevents client-side event storms
- **SYNC5**: Upstream sync `syncedAt` stamps MUST be individually try/caught — one failure must not block stamping of other rows in the batch

### Cellular Auth (4)
- **AUTH1**: `CELLULAR_CLAIM_KEY` env var MUST be non-empty for cellular-exchange endpoint to function — returns 503 if unconfigured
- **AUTH2**: `isRevokedFromDb()` MUST be fail-closed — DB errors return `true` (revoked), not `false` (allowed)
- **AUTH3**: `x-device-fingerprint` header MUST be validated when JWT contains `deviceFingerprint` — omitting header = 401 rejection
- **AUTH4**: Proxy `matchesRouteList()` MUST normalize paths via `normalizePath()` — prevents path traversal bypass of HARD_BLOCKED routes

### Inventory (2)
- **INV1**: `deductInventoryForOrder()` MUST return `success: false` when a paid/closed order has 0 items — prevents false-succeeded deductions when OrderItems haven't synced yet
- **INV2**: Modifier creation API MUST return 409 (not 500) on unique constraint violation — Prisma error code P2002 check in catch block

## Tax-Inclusive Pricing Invariants (2026-03-15)

> Added after full-stack tax-inclusive implementation across 3 repos. These invariants prevent tax miscalculation for locations with tax-inclusive pricing.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| TAX1 | `isTaxInclusive` MUST be stamped on OrderItem at creation and NEVER re-resolved after — it survives splits, transfers, comps, voids | `prepareItemData()` in `item-calculations.ts`; `isItemTaxInclusive()` in `order-calculations.ts` | Enable inclusive pricing, add item, split order, transfer item → `isTaxInclusive` unchanged throughout |
| TAX2 | Items with no `categoryType` (manual charges, open items) MUST default to `isTaxInclusive: false` (exclusive) | `isItemTaxInclusive()` — returns `false` when `categoryType` is null/undefined | Add open-price item with no category on inclusive location → exclusive tax applied |
| TAX3 | `calculateSplitTax()` with `inclusiveSubtotal = 0` MUST return `taxFromInclusive = 0` (pure no-op for exclusive-only locations) | `order-calculations.ts:405` — guard `inclusiveSubtotal > 0` | All-exclusive location: verify `taxFromInclusive = 0` on every order |
| TAX4 | Every DB write of `taxTotal` MUST also write `taxFromInclusive` and `taxFromExclusive` — no path may store one without the other | All order mutation routes, split routes, comp/void operations | Audit any route that calls `tx.order.update` with `taxTotal` — both split fields must be present |
| TAX5 | `total = subtotal + taxFromExclusive - discount + tip` — inclusive tax is NEVER added to total | `calculateOrderTotals()` line 288; all split domain files; checkout engine | Place order with only inclusive items → total equals subtotal (tax backed out, not added) |
| TAX6 | `taxInclusiveLiquor` and `taxInclusiveFood` are derived from DB TaxRule records in bootstrap, not stored as user settings | `bootstrap/route.ts` lines 273-312 | Change TaxRule `isInclusive` → bootstrap returns updated flags on next device sync |
| TAX7 | Changing TaxRule.isInclusive does NOT retroactively update existing OrderItem.isTaxInclusive stamps — only new items get the new treatment | By design — `isTaxInclusive` locked at creation | Toggle inclusive flag, verify existing open order items unchanged, new items get new flag |
| TAX8 | `calculateSplitTax()` with `inclusiveTaxRate = undefined` MUST fall back to `taxRate` (backward compat for locations without separate inclusive rate) | `order-calculations.ts:404` — `inclRate = inclusiveTaxRate ?? taxRate` | Location with single tax rule: verify `calculateSplitTax` uses same rate for both |
| TAX9 | Android `TaxSplitHelper.compute()` MUST produce identical output to server `calculateSplitTax()` for the same inputs — verified by golden parity tests | `TaxSplitHelper.kt`; `order-calculations.ts` | Run same 10+ test vectors on both platforms → outputs match to the cent |

---

## How to Use This List

1. **Before merging** any PR that touches a file in the "Where Enforced" column, manually walk through the "Test Trigger" scenario on device or in the simulator.
2. **After a schema change** to `Payment`, `Order`, `Shift`, or `TipLedgerEntry` — re-run P1–P5 and T1–T5.
3. **After any event sourcing change** — re-run O2 and O3.

The original 31 invariants cover bugs found during the Android bartender audit (2026-03-03). The 16 sync & security invariants (2026-03-10) cover vulnerabilities found during the 6-agent penetration test. The 9 tax-inclusive invariants (2026-03-15) cover the full-stack tax-inclusive pricing implementation. All 56 represent the highest re-regression risk.
