# Skill 457: Android Payment & Order Lifecycle Hardening

**Date:** 2026-02-27
**Commit:** `d283f1f`
**Status:** DONE
**Domain:** Android / Payments / Orders / Sync / Real-Time
**Dependencies:** Skills 430-446 (Android Register Foundation)

## Summary

Comprehensive hardening pass on the Android register's payment, order, and sync subsystems. 14 core fixes + 6 post-audit refinements + socket layer optimizations. Addressed critical bugs in payment lifecycle (stale totals, double-tap races, draft payment guards), order state management (process-death guard persistence, closed-order detection), and real-time event handling (Flow-based debounce, conflation, thread offloading).

## Core Fixes (14)

### Payment Lifecycle

| # | Severity | Fix | Detail |
|---|----------|-----|--------|
| 1 | CRITICAL | **payCash stale total** | Total captured AFTER `ensureOrderReadyForPayment()` — `syncPendingItems()` may have changed server-side totals |
| 2 | HIGH | **Draft payment guard** | `ensureOrderReadyForPayment()` checks Room `isOfflineDraft` flag + `draft_` prefix — blocks payment on unsynced drafts |
| 3 | HIGH | **Null order guard** | `ensureOrderReadyForPayment()` returns false with error when `cachedOrderDao.findById()` returns null |
| 4 | HIGH | **syncPendingItems refreshTotals** | Added `refreshTotals()` call after successful item sync — ensures totals reflect server recalculation |
| 5 | HIGH | **PaymentLog IGNORE strategy** | `OnConflictStrategy.IGNORE` on insert — duplicates from crash-retry silently skipped by composite unique index |

### Double-Tap & Race Conditions

| # | Severity | Fix | Detail |
|---|----------|-----|--------|
| 6 | CRITICAL | **addItemMutex** | `kotlinx.coroutines.sync.Mutex` serializes 4 grid-tap add-item variants (`addItem`, `addItemWithPourSize`, `addItemWithSpirit`, `addItemWithPricingOption`). Taps queued, never dropped. Sheet variants unchanged. |
| 7 | HIGH | **Outbox sync guards** | `sendToKitchen`/`payCash`/`payCard` check `outboxDao.countPendingForOrder()` — buttons disabled when `hasPendingSync` |

### Order State Management

| # | Severity | Fix | Detail |
|---|----------|-----|--------|
| 8 | HIGH | **Persisted closed guards** | `recentlyClosedOrderIds` written to SharedPreferences (`gwi_closed_guards`) with wall-clock timestamps, restored on process restart via `restorePersistedClosedGuards()` |
| 9 | MEDIUM | **CLOSED_GUARD_TTL_MS = 90s** | Bumped from 60s — prevents race where server-paid order reappears in Room before cache eviction |
| 10 | MEDIUM | **Double snackbar prevention** | "Closed elsewhere" snackbar only fires in `observeOpenOrdersFromCache` `orderGone` path — not in `handleOrderRemoved` |

### Sync & Connectivity

| # | Severity | Fix | Detail |
|---|----------|-----|--------|
| 11 | HIGH | **Flow-based debounce** | `MutableSharedFlow<Unit>` + `.debounce(150ms)` replaces cancel-restart pattern for socket refresh. Guarantees refresh fires even under continuous event pressure. |
| 12 | MEDIUM | **SystemClock.elapsedRealtime()** | Menu sync throttle uses monotonic clock instead of `System.currentTimeMillis()` — immune to wall-clock jumps |
| 13 | MEDIUM | **refreshCurrentOrder widened catch** | Catches all exceptions (not just IOException) to prevent unhandled crashes |

### Hardware UX

| # | Severity | Fix | Detail |
|---|----------|-----|--------|
| 14 | MEDIUM | **Cash drawer failure snackbar** | `openCashDrawer()` catches exceptions and emits "Cash drawer unavailable — open manually" |

## Post-Audit Refinements (6)

1. **Draft guard via Room field** — `isOfflineDraft` check independent of `draft_` ID prefix convention
2. **cacheOrder semantics** — Reviewed and confirmed correct (no change needed)
3. **refreshCurrentOrder error path** — Widened catch from IOException to Exception
4. **PaymentLog uniqueness** — Documented composite unique index intent with comments
5. **Menu sync monotonic clock** — `SystemClock.elapsedRealtime()` replaces `currentTimeMillis()`
6. **Double snackbar** — Verified single path for "closed elsewhere" message

## Socket Layer Optimizations (4)

| Optimization | Before | After |
|-------------|--------|-------|
| Room open-orders Flow | Raw collect | `.conflate()` — only latest snapshot processed |
| KDS item status Flow | Raw collect | `.conflate()` — collapses rapid status updates |
| KDS + menuItemChanged JSON parsing | Main thread | `withContext(Dispatchers.Default)` |
| Socket refresh trigger | Cancel-restart coroutine | `SharedFlow.debounce(150ms)` — guaranteed delivery |

## Socket.IO Tuning

| Setting | Before | After | Rationale |
|---------|--------|-------|-----------|
| `reconnectionDelay` | 2000ms | 800ms | LAN POS: NUC is 1 hop away |
| `reconnectionDelayMax` | 30000ms | 5000ms | Restaurant Wi-Fi recovers quickly |
| `timeout` | (default 20s) | 12000ms | Explicit, slightly above default 10s |
| `DEDUP_TTL_MS` | 30,000ms | 60,000ms | Higher tolerance for network retries |

## Key New Code Patterns

### addItemMutex (prevents double-tap)
```kotlin
private val addItemMutex = Mutex()

fun addItem(menuItem: MenuItemEntity) {
    viewModelScope.launch {
        addItemMutex.withLock {
            // ... optimistic insert or quantity bump
        }
    }
}
```

### Persisted Closed Guards (survives process death)
```kotlin
private val closedGuardPrefs = appContext.getSharedPreferences("gwi_closed_guards", Context.MODE_PRIVATE)

private fun markOrderLocallyClosed(orderId: String) {
    recentlyClosedOrderIds.add(orderId)
    closedGuardPrefs.edit().putLong(orderId, System.currentTimeMillis()).apply()
    viewModelScope.launch { delay(CLOSED_GUARD_TTL_MS); recentlyClosedOrderIds.remove(orderId) }
}
```

### Flow-based Debounce (guaranteed refresh delivery)
```kotlin
private val refreshRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

init {
    viewModelScope.launch {
        refreshRequests.debounce(SOCKET_DEBOUNCE_MS).collect { refreshOpenOrders() }
    }
}
```

## Files Changed

| File | Lines Changed | What |
|------|--------------|------|
| `OrderViewModel.kt` | +595/-313 | All 14 fixes + 6 refinements + socket optimizations |
| `SocketManager.kt` | +8/-4 | Dedup TTL 30→60s, reconnection tuning |
| `PaymentLogEntity.kt` | +4/-1 | Documented unique index |
| `PaymentLogDao.kt` | +1/-1 | OnConflictStrategy.IGNORE |
| `AppDatabase.kt` | +1/-1 | DB version 25 |
| `OrderRepository.kt` | +12/-8 | CLOSED_STATUSES set, cacheOrder guard |
| `OrderScreen.kt` | +5/-3 | Wiring |
| `ConnectionBanner.kt` | +20/-5 | Pending count + retry button |
| `OrderItemControls.kt` | +6/-0 | Quick pick label display |
| `OrderPanel.kt` | +2/-2 | kitchenStatus filter fix |

**12 files changed, +595/-313 lines**

## Rejected Suggestions

| Suggestion | Source | Why Rejected |
|-----------|--------|-------------|
| Sealed class socket event bus | Audit | Socket.IO client has typed listeners already; 15 collectors cost ~0 |
| OkHttp shared client via `callFactory` | Audit | `IO.Options` in socket.io-client 2.1.0 has no `callFactory` — fabricated API |
| OkHttp 5.x upgrade | Audit | 5.x is still alpha. Current 4.12.0 IS the latest stable |
| Ktor WebSocket migration | Audit | App uses Socket.IO protocol, not raw WebSocket. Would lose reconnection, rooms, event namespacing |
