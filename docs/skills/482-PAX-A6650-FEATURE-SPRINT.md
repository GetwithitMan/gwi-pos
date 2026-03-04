# Skill 480 — GWI PAX A6650 Feature Sprint

**Date:** 2026-03-04
**Repos affected:** `gwi-pax-a6650`, `gwi-pos`, `gwi-android-register`
**gwi-pos commit:** `605f127`
**gwi-pax-a6650 commits:** `ada799b`, `ff91590`
**gwi-android-register commits:** `c6095de`, `a20f565`

---

## Scope

Eight-phase feature sprint for the PAX A6650 handheld POS, implemented by a 4-agent parallel team. Covers printer routing, QuickBar sync, data correctness, diagnostics, item actions, and operational UX.

---

## Phase 0 — Data Correctness + Diagnostics

### 0A — Delete-item guard
- Every item delete asserts `itemId != null` before execution
- Row count checked after delete — logs ERROR if ≠ 1
- Prevents full-order wipe from accidental `deleteByOrderId` without itemId guard

### 0B — Add-item failure logging + UX
- `addItem` failure path now logs: `orderId`, `employeeId`, connectivity state, error
- `HandheldOrderUiState.snackbarMessage` field added
- Snackbar shown on add-item failure instead of silent drop

### 0C — Diagnostics Screen (`ui/diagnostics/DiagnosticsScreen.kt`)
- Hidden admin screen accessible via long-press on terminal info
- Sections: Pairing (baseUrl, locationId, terminalId, mode), Employee (id, role), SyncMeta (key values: taxRate, cashDiscountPercent, receiptPrinterId, kitchenPrinterId, barPrinterId), DB Counts (categories, menuItems by showOnPOS, pricingOptions, spiritGroups, modifierGroups, tables, printers), Outbox (pendingCount, deadLetterCount, lastError)
- "Refresh" button + "Copy All" to clipboard for bug reports

---

## Phase 1 — Per-Terminal IP Printer Assignment

### POS Server (`gwi-pos`)
- `prisma/schema.prisma`: Added `kitchenPrinterId`/`kitchenPrinter` and `barPrinterId`/`barPrinter` to Terminal model; back-relations `terminalsKitchen`/`terminalsBar` on Printer
- `scripts/nuc-pre-migrate.js`: ALTER TABLE Terminal for both new columns
- `src/app/api/sync/bootstrap/route.ts`: `terminalConfig` now returns `receiptPrinterId`, `kitchenPrinterId`, `barPrinterId`
- `src/app/(admin)/settings/hardware/terminals/page.tsx`: Kitchen Printer + Bar Printer Select dropdowns in handheld terminal card; TestPrintButton for each

### Android Handheld (`gwi-pax-a6650`)
- `data/remote/dto/SyncDto.kt`: `TerminalConfigDto` gets 3 printer ID fields
- `sync/BootstrapWorker.kt`: saves `receiptPrinterId`, `kitchenPrinterId`, `barPrinterId` to SyncMeta
- `data/local/dao/PrinterDao.kt`: `syncPrinters()` + `findById()` added
- `printer/PrinterManager.kt`: terminal-assigned printer lookup via SyncMeta; falls back to role default if ID not found; returns error "No printer assigned to this terminal" if neither found

### Android Register (`gwi-android-register`)
- Same TerminalConfigDto + BootstrapWorker + PrinterManager changes applied

---

## Phase 2 — QuickBar Editor (Per-Employee, Synced)

### POS Server (`gwi-pos`)
- `prisma/schema.prisma`: `QuickBarPreference` (per-employee, unique on employeeId) and `QuickBarDefault` (per-location, unique on locationId) models added
- `scripts/nuc-pre-migrate.js`: CREATE TABLE for both models with indexes
- `GET/PUT /api/employees/[id]/quick-bar`: returns `{ itemIds, defaultItemIds }`; PUT upserts preference
- `GET/PUT /api/location/quick-bar/default`: manager-gated (SETTINGS_MENU); GET/PUT location default set

### Android Handheld (`gwi-pax-a6650`)
- `data/remote/dto/QuickBarDto.kt` (new): `QuickBarResponse`, `QuickBarRequest`
- `data/remote/GwiApiService.kt`: 4 QuickBar endpoints added
- `HandheldOrderViewModel.kt`: `loadQuickBarFromServer()` (server-first, SharedPreferences fallback); `toggleQuickBarItem()` (max 12, snackbar on overflow); `reorderQuickBarItem()`; `resetQuickBarToDefault()`; debounced 500ms auto-save
- `ui/order/components/QuickBarEditorSheet.kt` (new): ModalBottomSheet — current items as draggable chips (X to remove), search field, 3-col grid of available items, Reset/Done footer; indigo chip styling matching QuickBar register
- `HandheldOrderScreen.kt`: `onEdit = { viewModel.showQuickBarEditor() }` (replaced TODO)

### Android Register (`gwi-android-register`)
- `data/remote/dto/QuickBarDto.kt` (new): same DTOs
- `data/remote/GwiApiService.kt`: 4 QuickBar endpoints added
- `ui/pos/OrderViewModel.kt`: `loadQuickBar()` tries server first, falls back to SharedPreferences; `addToQuickBar()`/`removeFromQuickBar()` fire-and-forget server sync after SharedPreferences write

---

## Phase 3 — Dead Letter Actionable Modal

### Android Handheld (`gwi-pax-a6650`)
- `data/local/dao/OutboxDao.kt`: `resetDeadLetters()` resets failed entries to PENDING; `observeDeadLetterCount()` Flow added
- `data/repository/OrderQueryRepository.kt`: `getDeadLetterEntries()`, `clearDeadLetters()`, `retryDeadLetters()` (resets + re-enqueues OutboxWorker), `observeDeadLetterCount()` Flow
- `HandheldOrderViewModel.kt`: `showDeadLetterModal`, `deadLetterEntries`, `deadLetterCount` in UiState; auto-opens modal when count transitions 0→N; `openDeadLetterModal()`, `dismissDeadLetterModal()`, `retryDeadLetters()`, `clearDeadLetters()`
- `ui/order/components/HandheldOrderPanel.kt`: dead-letter badge wrapped in `Modifier.clickable`; `onDeadLetterTap: () -> Unit` parameter added
- `ui/order/components/DeadLetterModal.kt` (new): shows failed entries (type + error); "Retry All" re-enqueues OutboxWorker + dismisses; "Clear" confirms data loss then deletes; "Dismiss"

---

## Phase 4 — Item Long-Press Actions (Note, Comp, Void)

### POS Server (`gwi-pos`)
- `POST /api/orders/[id]/items/[itemId]/note`: updates `OrderItem.specialNotes`; emits `ITEM_UPDATED` event; requires order ownership

### Android Handheld (`gwi-pax-a6650`)
- `data/remote/GwiApiService.kt`: `addItemNote()` endpoint added
- `data/remote/dto/ItemNoteRequest.kt` (new): `{ note: String }`
- `data/repository/OrderMutationRepository.kt`: `addItemNote()` calls API + records `ITEM_UPDATED` confirmed event
- `HandheldOrderViewModel.kt`: `itemActionsItem`, `itemNoteDialogVisible` in UiState; `showItemActions()`, `dismissItemActions()`, `addItemNote()`, `compItem()`, `voidItem()`
- `ui/order/components/HandheldOrderPanel.kt`: `combinedClickable(onLongClick)` on each item row; `onItemLongPress: (String) -> Unit` parameter
- `ui/order/components/ItemActionsSheet.kt` (new): ModalBottomSheet — item header + price; Add/Edit Note (inline text field dialog); Comp Item + Void Item (role-gated via PermissionEvaluator, reason dialog); disabled rows show "Manager approval required" when lacking permission

### PermissionEvaluator (`gwi-pax-a6650`)
- `util/PermissionEvaluator.kt` (new): parses employee.permissions JSON; `canCompItems`, `canVoidItems`, `canApplyDiscounts`, `canRefund`, `canEditSentItems`, `canOpenItems` convenience checks
- `HandheldOrderUiState`: `canCompItems`, `canVoidItems` loaded on employee login

---

## Phase 5 — Operational UX

### Clock-in delay
- Login success delay reduced 3000ms → 1200ms

### Mode switch chip
- One-tap Table↔Tab switch chip added to HandheldOrderScreen top bar
- Calls `tokenProvider.saveMode()` + navigation event → pops to TableHome or TabHome

### Force logout
- "Switch Employee" button available from ModeSelectionScreen, TableHome, TabHome (was already partially present; confirmed wired)

---

## Phase 6 — Payment Recovery

### Declined overlay Retry button
- `HandheldOrderViewModel.retryPayment()`: clears `paymentDeclineReason` + `paymentApprovedAmountCents`, re-shows payment sheet in initial state
- "Try Again" button added to DeclinedContent in PaymentSheet

### Kiosk cancel
- `PAYMENT_CANCEL` socket event added to SocketManager
- `SocketManager.emitPaymentCancel()` helper
- `KioskIdleViewModel.cancelPendingPayment()` emits socket event + clears pending state
- Red Cancel FAB shown in KioskIdleScreen when `pendingPaymentRequest != null`

---

## Key Architecture Notes

- **Printer routing**: terminal-assigned IDs stored in SyncMeta (`receiptPrinterId`, `kitchenPrinterId`, `barPrinterId`); fallback chain: SyncMeta ID → role default → error
- **QuickBar sync**: server is source of truth when online; SharedPreferences used offline; server sync is fire-and-forget on every change
- **PermissionEvaluator**: reads cached employee.permissions JSON; evaluated at login time, stored in UiState — no runtime DB lookups per action
- **Dead letter recovery**: OutboxWorker re-enqueued via WorkManager on retry; "Clear" is destructive and warns user

---

## Verification Checklist

1. **Printer**: Assign kitchen printer to HANDHELD terminal in admin → bootstrap device → send order → kitchen ticket prints to assigned IP
2. **QuickBar sync**: Add items on register → open same employee on handheld → same items visible
3. **QuickBar reset**: Owner sets default → employee taps Reset → gets owner's set
4. **Dead letter**: Force 4xx error in outbox → badge turns red + modal auto-opens → Retry re-enqueues; Clear removes with warning
5. **Item long-press**: Long-press sent item → sheet opens → Note saves (visible in POS order panel); Comp/Void fires to server
6. **Mode switch**: Tap ↔ chip → navigates to other mode home without going through ModeSelection
7. **Payment retry**: Decline overlay shows "Try Again" → tapping re-opens payment sheet fresh
