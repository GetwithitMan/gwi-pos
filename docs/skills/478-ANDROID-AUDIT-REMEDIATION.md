# Skill 478 — Android Audit Remediation

**Date:** 2026-03-03
**Repos affected:** `gwi-android-register`, `gwi-pos`
**Android commits:** `625ddd1` → `007bb79`
**POS commits:** `a0089ba` → `2af4b7e`
**Source audit:** Skill 474 / `docs/planning/ANDROID-AUDIT-TODO.md`

---

## What Was Done

Systematic verify → minimal delta → ship remediation of all 31 actionable findings from the Android Bartender Audit. Each finding was verified against the actual codebase before implementation. No speculative changes.

---

## Critical Fixes (C1, C3, C4, C5)

### C1 — Payment blocked on unsent kitchen items
- `PayOrderUseCase.ensureOrderReadyForPayment()`: returns failure if any item has `KitchenStatus.PENDING`
- `POST /api/orders/[id]/pay`: UNSENT_KITCHEN_ITEMS guard added before payment loop
- Error shown: "Send all items to kitchen before payment."

### C3 — Partial payment durability
- `OrderViewModel.showPayment()`: seeds `appliedPayments` from `PaymentLogDao.getForOrderByStatus(orderId, "CONFIRMED")` on open (skipped if already seeded)
- `POST /api/orders/[id]/pay`: partial payment now sets order status to `in_progress`
- `PaymentLogDao`: new `getForOrderByStatus(orderId, status)` query added

### C4 — Shift close shows open order count
- `OrderViewModel.showShiftClose()`: pre-loads open order count from local `openOrders` cache
- `ShiftCloseSheet`: amber info row shows "Open orders: N" with count
- `OrderUiState`: `shiftCloseOpenOrderCount: Int?` field added

### C5 — Manager override for shift close
- `OrderViewModel.closeShift()`: accepts `forceClose: Boolean`, parses 409 via Moshi into `ShiftCloseErrorBody`
- `ShiftCloseSheet`: Manager Override button visible when `requiresManagerOverride = true`
- `OrderUiState`: `shiftCloseRequiresManagerOverride: Boolean` field added

---

## High Fixes (H1–H10)

### H1 — Pending tips in shift close
- `showShiftClose()` calls `getPendingTips(locId, empId, shiftId = openShift.id)`
- `OrderUiState`: `shiftClosePendingTipCount: Int = 0` field added
- `ShiftCloseSheet`: green "Pending tips: N" section with "Review Tips" button → navigates to MyTipsScreen
- Callback threaded: `OrderScreen` → `OrderScreenSheets` → `ShiftCloseSheet`

### H2 — Tab list status + balance
- `TabListSheet`: "Open" (green) / "Closed" (gray) badge per row
- Amber "Due $X.XX" label when `total - paidAmount > 0`
- Closed tab rows displayed at 25% opacity

### H3 — Duplicate card detection
- Verified design: single-tier dialog prevents per-interaction stacking (M9 companion)

### H5 — Spirit dialog dismiss safety
- `SpiritSelectionDialog`: `properties = DialogProperties(dismissOnClickOutside = false)`
- Scrim tap no longer closes the dialog; back button and Cancel still work

### H6 — Modifier sheet dismiss safety
- `ModifierSheet`: `hasPartialSelection` derived state (`selectedByGroup` or `selectedIngredients` non-empty)
- `onDismissRequest`: `{ if (!hasPartialSelection) onDismiss() }` — swipe blocked during selection

### H8 — Clock-out during payment
- `OrderViewModel.clockOut()`: early return with feedback if `isProcessingPayment`

### H9 — In-flight payment blocks item adds
- `POST /api/orders/[id]/items`: `hasActivePayment` now checks `status === 'completed' || 'pending'`
- Previously only blocked on `completed`

### H10 — Shift close pre-validation (verified DONE)
- Open order count already shown via C4 fix; pending tips via H1 fix

---

## Medium Fixes (M1–M13)

| ID | Fix |
|----|-----|
| M1 | "Complete / No Charge" green button replaces Cash/Card/Other when `total == 0L && itemCount > 0`; uses `POST /api/orders/[id]/pay` with amount=0 |
| M2 | Amber warning on all 3 tip sheets when tip > 50% of order total; server hard-rejects >200% via adjustments endpoint |
| M3 | `closeTabNonce` in `OrderUiState` increments on `showCloseTab()`; `remember(closeTabNonce)` in `CloseTabSheet` resets tip field |
| M4 | `AddItemUseCase` qty bump: `.coerceAtMost(999)` |
| M5 | `GET /api/tips/pending-tips` accepts optional `?shiftId=`; `showShiftClose()` passes `openShift.id`; `GwiApiService.getPendingTips()` gains `shiftId` param |
| M6 | `POST /api/tips/adjustments` rejects if shift closed >24h; `TipEntrySheet` disables Save + shows warning; `shiftClosedAt` added to both DTOs |
| M7 | `SplitCheckSheet`: intercepts "Split by Seat" if unassigned items exist; `AlertDialog` "N items have no seat — they will go on a shared check. Split anyway?" |
| M8 | Verified DONE — server rejects paid-order merges with 400 |
| M9 | Deferred by design: single-tier spirit selection enforced by dialog UI |
| M10 | `DiscountSheet`: amber banner "Discount already applied: $X.XX. Applying a new one will replace it." when `existingDiscount != null` |
| M11 | `currentOrderId` persisted to `savedStateHandle`; restored on ViewModel recreation; `distinctUntilChanged` collector in `init` |
| M12 | `onItemClicked()`: 300ms debounce via `lastItemClickMs` field |
| M13 | `criticalError: String?` in `OrderUiState`; `sendToKitchen()` sets it on `SyncFailed` / `Failure`; amber animated banner in `OrderMainContent` with ✕ dismiss |

---

## Low Fixes (L1–L4)

| ID | Fix |
|----|-----|
| L1 | `NewTabDialog`: tab nickname capped at 30 chars; `onValueChange` guard + supporting text counter (amber at ≥25) |
| L2 | `ModifierSheet`: `LaunchedEffect` auto-selects single-option required groups on open; skips groups restored from `initialModifiers` |
| L3 | `MyTipsScreen` pending-tips empty state: green "No pending tips" title + "You're all set to close your shift." subtitle |
| L4 | Verified DONE — `isLoadingItems` already drives skeleton placeholder rows in `OrderPanel` |

---

## Architectural Fixes

### KDS status event-sourced (H3)
- `OrderSyncController.handleKdsItemStatus()`: replaced direct `orderItemDao.updateItemKitchenStatus()` with `ITEM_UPDATED` event → `replayAndProject()`
- `OrderItemDao`: new `getOrderIdForItem(itemId)` query
- Falls back to direct write if `orderId` not found (safe degradation)

### Voided payment sync (H4)
- `OrderSyncController`: new `handlePaymentProcessed()` for `status == "voided"` — inserts `PAYMENT_VOIDED` event → `replayAndProject()`
- Non-voided events still handled by ViewModel

---

## Documents Added
- `docs/planning/AUDIT-CLOSURE-2026-03-03.md` — 1-page closure note
- `docs/planning/AUDIT_REGRESSION.md` — 26-invariant regression guard checklist
