# Audit Closure — Android Bartender Audit
**Date:** 2026-03-03
**Scope:** 32 findings (5 Critical / 10 High / 13 Medium / 4 Low)
**Outcome:** 31 implemented, 1 deferred by design (M9)

---

## Where to Find the Work

| Repo | Commit Range |
|------|-------------|
| `gwi-android-register` | `625ddd1` → `007bb79` |
| `gwi-pos` | `a0089ba` → `2af4b7e` |

---

## Top Behavior Changes (What Ops Will Feel)

### Financial Safety
- **Payment blocked on unsent kitchen items** — Cannot pay an order that has items still in PENDING (unsent) kitchen status. Server + Android both enforce this. Error: "Send all items to kitchen before payment."
- **Partial payments are durable** — `appliedPayments` is seeded from confirmed `PaymentLogEntity` records on PaymentSheet open. Partial cash payment moves order to `in_progress` on the server. Order cannot be abandoned mid-payment.
- **Comp/void blocked after any completed payment** — `comp-void` route now checks for existing completed payments and rejects with `HAS_COMPLETED_PAYMENT`. Items cannot be voided after payment is taken.
- **In-flight payments block item adds** — `POST /api/orders/[id]/items` now rejects if any payment has `status='pending'` (not just `'completed'`). Closes the concurrent-add race window.

### Shift Close
- **409 is parsed, not string-matched** — `closeShift()` parses 409 response via Moshi into `ShiftCloseErrorBody`; displays open order count in ShiftCloseSheet; manager-override button appears when `requiresManagerOverride=true`.
- **Pending tips shown before closing** — ShiftCloseSheet calls `getPendingTips()` scoped to the open shift and shows count + "Review Tips" button. Bartender sees blockers before hitting Close.
- **Clock-out blocked during active payment** — `clockOut()` returns early if `isProcessingPayment` is true.

### Kitchen / KDS
- **Kitchen status is event-sourced** — `kds:item-status` socket events now go through event → reduce → project instead of direct Room writes. Kitchen status survives event replay.

### Tips
- **Pending tips scoped to current shift** — `GET /api/tips/pending-tips` accepts `?shiftId=` param; shift-close sheet passes the open shift ID so the count is accurate.
- **Tip edits time-bounded** — `POST /api/tips/adjustments` rejects edits if the shift closed more than 24 hours ago (403). Android TipEntrySheet disables Save and shows warning.
- **Tip size validation** — Android warns when tip exceeds 50% of order total (soft warning, does not block). Server hard-rejects tips over 200% of payment base.

### Modifier / Menu UX
- **Spirit dialog cannot be scrim-dismissed** — `dismissOnClickOutside=false` on SpiritSelectionDialog. User must tap a spirit or Cancel.
- **Modifier sheet blocks swipe-dismiss during selection** — `hasPartialSelection` guard on ModifierSheet `onDismissRequest`. Swipe-down is blocked once any modifier is selected; Cancel remains.
- **Single-option required groups auto-select** — ModifierSheet `LaunchedEffect` auto-selects the only option when a group has exactly 1 modifier and `minSelections=1`.
- **Spirit tier selection is single-tier by design** — Each spirit-upgrade dialog shows one tier; selecting from multiple tiers requires adding the item separately. M9 confirmed: no stacking.

### Tab / Split
- **Tab list shows Open/Closed status + balance due** — Each row has green "Open" / gray "Closed" badge and amber "Due $X.XX" when balance remains. Closed tabs displayed at reduced opacity.
- **Seat split warns on unassigned items** — AlertDialog: "N items have no seat — they will go on a shared check. Split anyway?" before executing.
- **Merge rejects paid orders** — Server-enforced (was already in place, verified during audit).

### Android Process Safety
- **`currentOrderId` survives process death** — Persisted via `savedStateHandle`; restored on ViewModel recreation.
- **Tap debounce on menu items** — 300 ms debounce prevents sheet clobber from rapid multi-tap.
- **Qty capped at 999** — `AddItemUseCase` uses `.coerceAtMost(999)` on all quantity bumps.

### Payment Void Sync
- **Voided payments sync reactively** — `OrderSyncController` now handles `payment:processed` socket events with `status=voided`, inserts `PAYMENT_VOIDED` event, and re-projects the order. Other terminals see the void without a manual refresh.

---

## Deferred

| Item | Decision |
|------|----------|
| **M9 — Multi-tier spirit stacking** | By design: single-tier selection per item add. No cross-tier stacking allowed. Enforced by the single-tier dialog UI. No code change needed. |

---

## Reference
Full finding list: `docs/planning/ANDROID-AUDIT-TODO.md`
Regression guards: `docs/planning/AUDIT_REGRESSION.md`
