# Audit Regression Guard List
**Source:** Android Bartender Audit 2026-03-03
**Purpose:** Invariants to re-verify after any change to payment, order, shift, or tips code.

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

## Process Safety Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| PR1 | `currentOrderId` restored after process death | `OrderViewModel` (savedStateHandle) | Kill app process mid-order → reopen → active order restored |
| PR2 | Rapid item taps debounced (300ms) | `OrderViewModel.onItemClicked()` | Tap same item 5× quickly → only first tap registers within 300ms window |
| PR3 | Item quantity capped at 999 | `AddItemUseCase` (.coerceAtMost) | Tap same item 1000× → qty stops at 999 |
| PR4 | Close Tab tip field resets on every re-open | `CloseTabSheet` (remember(closeTabNonce)) | Open close-tab, enter tip, dismiss, reopen → tip field is blank |

---

## How to Use This List

1. **Before merging** any PR that touches a file in the "Where Enforced" column, manually walk through the "Test Trigger" scenario on device or in the simulator.
2. **After a schema change** to `Payment`, `Order`, `Shift`, or `TipLedgerEntry` — re-run P1–P5 and T1–T5.
3. **After any event sourcing change** — re-run O2 and O3.

This list is intentionally short. It covers the invariants that were bugs before this audit — the highest re-regression risk.
