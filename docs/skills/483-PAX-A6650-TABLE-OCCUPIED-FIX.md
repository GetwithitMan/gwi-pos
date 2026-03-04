# Skill 481 — PAX A6650: TABLE_OCCUPIED Stale Table State Fix

**Date:** 2026-03-04
**Repo:** `gwi-pax-a6650`
**Commit:** `27e232b`

---

## Problem

The table grid showed "Available" (green) for a table that had an active order on the server. Tapping it produced a raw JSON error bubble: `{"error":"Table already has an active order","code":"TABLE_OCCUPIED",...}` with no way to proceed.

**Root causes:**

1. **Stale local cache**: Table occupancy is derived from `cached_orders` in Room. If an order was created on another terminal while this device was offline or between SyncWorker delta runs, the local DB never received it — table stays green permanently until the next scheduled sync.

2. **No TABLE_OCCUPIED recovery**: `CreateOrderUseCase` returned a generic `Failure` on `BusinessError`. `TableHomeViewModel` had a `/* TODO: show error */` comment — meaning the raw JSON from the HTTP response error body was bubbled up as-is.

---

## Fix

### `domain/usecase/CreateOrderUseCase.kt`
- Injected `OrderSyncRepository`
- On `CommandResult.BusinessError`: parse `cmd.message` as JSON; if `code == "TABLE_OCCUPIED"`, extract `details.existingOrderId`
- Call `orderSyncRepository.fetchAndCacheFullOrder(existingOrderId)` to pull the existing order from server into local cache
- Return `UseCaseResult.Success(existing)` — ViewModel navigates to the existing order rather than showing an error
- If fetch fails, fall through to the generic failure path

```kotlin
is CommandResult.BusinessError -> {
    val existingOrderId = parseTableOccupiedOrderId(cmd.message)
    if (existingOrderId != null) {
        val existing = try { orderSyncRepo.fetchAndCacheFullOrder(existingOrderId) } catch (e: Exception) { null }
        if (existing != null) return UseCaseResult.Success(existing)
    }
    return UseCaseResult.Failure(Exception(cmd.message))
}
```

### `ui/table/TableHomeViewModel.kt`
- Injected `OrderSyncRepository`
- `init {}` now fires `orderSyncRepository.refreshOpenOrders()` on a background coroutine — pulls all open orders from server on screen entry, correcting stale table state within ~1s of opening the table grid
- Added `errorMessage: String?` to `TableUiState` + `clearError()` function
- `createOrder()` failure branch: logs the error + sets `errorMessage = "Could not open table. Please try again."` instead of silent TODO

### `ui/table/TableHomeScreen.kt`
- Added `LaunchedEffect(uiState.errorMessage)` → `snackbarHostState.showSnackbar(msg)` + `viewModel.clearError()`
- Snackbar host was already wired — this just consumes the new `errorMessage` field

---

## Why Not Just Fix the Socket Event?

The real-time socket pipeline for ORDER_CREATED events from other terminals IS correctly implemented in `OrderSyncController` → `ingestRemoteEvent()`. The stale state occurs specifically when:
- A socket event was missed (device was offline when order was created)
- The device connected after the order already existed (ORDER_CREATED event already emitted, not repeated)

The `refreshOpenOrders()` on screen entry is the correct fallback for this case — it's a lightweight REST call that syncs all open orders and takes ~200ms on LAN.

The TABLE_OCCUPIED recovery is a belt-and-suspenders fix: even if the table somehow shows stale after the refresh, tapping it silently opens the right order instead of showing an error.

---

## Behavior After Fix

| Scenario | Before | After |
|----------|--------|-------|
| Tap Available table that's actually occupied | Raw JSON error, stuck | Navigates directly to the existing order |
| Open table screen while another terminal has open orders | Stale "Available" badges | Refreshes within ~1s; shows correct occupancy |
| Genuine create failure (not TABLE_OCCUPIED) | Raw JSON snackbar | "Could not open table. Please try again." snackbar |
