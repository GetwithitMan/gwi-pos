# Android Bartender Audit — TODO List
**Date:** 2026-03-03
**Source:** World's Worst Bartender audit — 5 parallel agents, full front-end simulation

---

## 🔴 CRITICAL — Financial Loss or Complete Dead-End

- [ ] **C1 — Pay order with unsent kitchen items**
  Block payment if any items are still in PENDING (unsent) status. Add check in `ensureOrderReadyForPayment()`. Show error: "Send all items to kitchen before payment."

- [ ] **C2 — Voided items NOT subtracted from order total**
  `recomputeTotals()` must fire after every `COMP_VOID_APPLIED` event in the OrderReducer. Currently, customer can be charged full price for voided food.

- [ ] **C3 — Half-paid cash order can be abandoned**
  Lock order in DB as "awaiting balance" during partial payment. Persist `appliedPayments` to Room (currently ViewModel-only, lost on crash). Block sheet dismissal until balance = $0.

- [ ] **C4 — Clock out with open orders = permanent deadlock**
  Show blocking orders by name/number in the 409 error. Add manager PIN → force close flow with audit trail. No recovery path currently exists.

- [ ] **C5 — No manager override / force close anywhere**
  Build manager-PIN-gated force clock-out and force shift close. Employee is currently bricked when C4 occurs.

---

## 🟠 HIGH — Significant Workflow Failure

- [ ] **H1 — Pending Tips and Shift Close are disconnected**
  ShiftCloseSheet and MyTips are two separate systems with no link. Shift close API never checks pending card tips. Show pending tip count in shift summary. Soft-block (warning) or hard-block close if pending tips exist.

- [ ] **H2 — No active tab indicator in tab list**
  Currently no highlight/checkmark showing which tab is selected. Bartender can add items to wrong tab. Selected tab needs visual indicator.

- [ ] **H3 — Close Tab sheet doesn't show pre-auth hold amount**
  No warning when tip pushes total above hold → cryptic decline. Show "Pre-auth hold: $X" in CloseTabSheet. Warn when tip will exceed it.

- [ ] **H4 — Duplicate card detection missing**
  Same card can open multiple tabs simultaneously. Check open tabs for matching card token/last4 before opening new tab.

- [ ] **H5 — Spirit selection swipe-dismiss is silent**
  Dismiss spirit dialog without selecting → item not added, zero feedback. Show toast "Spirit not selected — item not added" or hold item in pending state.

- [ ] **H6 — Modifier sheet swipe-dismiss loses all work silently**
  Swipe down on modifier sheet → all selections gone, no warning, item not added. Add "Discard changes?" confirmation dialog on swipe-dismiss.

- [ ] **H7 — No Edit button for unsent modified items**
  `showEditItemModifiers()` exists in ViewModel but is never wired to any UI button. Bartender must void + re-add to fix a wrong modifier. Wire Edit button to unsent items.

- [ ] **H8 — Race condition: clock-out during active card payment**
  `clockOut()` never checks `isProcessingPayment`. Gate clock-out and shift close behind active payment check.

- [ ] **H9 — Adding items to a paid split check corrupts local state**
  Paid splits show no visual lock. Local outbox event inserted before server rejects. Mark paid splits read-only. Disable Add Item for paid orders.

- [ ] **H10 — Shift summary shows no blockers before API rejects**
  Load and display "Open Orders: X" and "Pending Tips: X" in shift close summary BEFORE user taps Close. Currently 409 error is the only signal.

---

## 🟡 MEDIUM — Friction, Data Risk, or Bad UX

- [ ] **M1 — $0 total order has no "Complete / No Charge" button**
  After 100% discount or full comp, bill = $0 but no shortcut to close. Add "Complete Order (No Charge)" button when total = $0.

- [ ] **M2 — No max tip validation anywhere**
  PaymentSheet, CloseTabSheet, TipEntrySheet all accept any tip amount. Add cap or warning for tips exceeding a reasonable % (e.g., warn if tip > 50% of order total).

- [ ] **M3 — Close Tab tip field retains value on re-open**
  Dismiss close tab sheet, reopen → stale tip amount still in field. Zero-out `tipState` on `dismissCloseTab()`.

- [ ] **M4 — No quantity cap on item tapping**
  Can tap same item 100 times with no guard. Add warning or confirmation dialog when qty exceeds 10 (or configurable max).

- [ ] **M5 — Pending tips not scoped to current shift**
  Tips from prior shifts appear in Pending Tips list. Scope `GET /api/tips/pending-tips` to current shift (add `shiftId` param).

- [ ] **M6 — Tip editing has no time boundary**
  Can edit tips from shifts closed weeks ago. Enforce "immutable after shift close" — own shift only for self-service edits.

- [ ] **M7 — Unassigned items in seat split create a ghost check**
  Split by seat with unassigned items creates an "Unassigned" check without warning. Show explicit warning: "X items have no seat — they'll go on a shared check."

- [ ] **M8 — Merge attempted on partially-paid splits without warning**
  UI allows selecting paid orders for merge. Add pre-merge validation check: warn or block if any selected order is paid.

- [ ] **M9 — Multi-tier spirit stacking**
  Can select spirits from multiple tier groups on one drink (e.g., call + premium + top shelf). Clarify intent: are tiers mutually exclusive? If yes, enforce single spirit selection across all tier groups.

- [ ] **M10 — Two discounts can be applied to same order**
  No UI guard. Server behavior (stack vs. replace) unclear. Define and enforce the rule. Show existing discount before allowing second.

- [ ] **M11 — Tab state not persisted via savedStateHandle**
  `currentOrderId` lost on device rotation or process death. Persist via `savedStateHandle` to survive config changes.

- [ ] **M12 — Rapid taps on modifier items cause sheet clobber**
  `onItemClicked()` has no mutex. Fast double-tap races and overwrites sheet state. Add deduplication or a short cooldown on item tap.

- [ ] **M13 — Snackbar errors queue silently**
  High-speed errors queue but early messages are gone before bartender sees them. Consider a persistent error banner for critical errors (payment declined, send failed).

---

## ⚪ LOW — Minor Polish

- [ ] **L1 — No tabNickname character limit**
  "Known As" field accepts unlimited characters. Cap at 30 chars with counter.

- [ ] **L2 — Required modifier with one option not auto-selected**
  Single-option required groups still require manual tap. Auto-select when group has exactly 1 option and minSelections = 1.

- [ ] **L3 — No "all pending tips cleared" confirmation**
  After entering all pending tips, no feedback that the list is clear before shift close. Show "No pending tips — you're ready to close" state clearly.

- [ ] **L4 — No loading indicator during tab selection**
  Nothing indicates a tab is loading between tap and content appearing in the order panel.

---

## Counts
| Severity | Count |
|---|---|
| 🔴 Critical | 5 |
| 🟠 High | 10 |
| 🟡 Medium | 13 |
| ⚪ Low | 4 |
| **Total** | **32** |
