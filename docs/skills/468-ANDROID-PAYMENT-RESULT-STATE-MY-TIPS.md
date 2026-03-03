# Skill 468 — Android Payment Result State + My Tips Screen

**Date:** 2026-03-02
**Repo affected:** `gwi-android-register`
**Commit:** `da56a18` — 22 files, +1732 / −381

---

## What Was Done

### 1. Payment Result State

The `PaymentSheet` previously dismissed itself immediately on a successful payment. This left the
cashier with no visual confirmation of what was approved or how much. The new model keeps the
sheet open and displays an explicit result state.

**New fields in `OrderUiState`:**
```kotlin
val paymentApprovedAmountCents: Long? = null
val paymentDeclineReason: String?     = null
```

**`clearPaymentResult()` helper in `OrderViewModel`:**
```kotlin
fun clearPaymentResult() {
    _uiState.update { it.copy(paymentApprovedAmountCents = null, paymentDeclineReason = null) }
}
```

**`payCash` / `payCard` flow:**
- On success → `_uiState.update { it.copy(paymentApprovedAmountCents = roundedRemaining) }`
  → sheet remains open showing a green approved state
- Cashier taps "Done" → `dismissPayment()` → `clearPaymentResult()`
- On decline → `paymentDeclineReason` set; sheet shows red declined state

**`dismissPayment()`** also clears both fields so the sheet opens clean on the next payment.

### 2. My Tips Employee View

A new `ui/tips/` package gives each employee a quick view of their own tip history directly
from the POS register.

#### Files Added

| File | Lines | Purpose |
|------|-------|---------|
| `ui/tips/MyTipsScreen.kt` | ~495 | Main list screen |
| `ui/tips/MyTipsViewModel.kt` | ~230 | Data fetching + state |
| `ui/tips/TipEntrySheet.kt` | ~289 | Detail bottom sheet |

#### `MyTipsScreen`
- Summary cards row: **Total**, **Cash**, **Card** tip totals for the selected period
- Date-filter chips: Today / Week / Month / All
- `LazyColumn` of tip rows: order number, table, amount, method pill, timestamp
- Tap a row → opens `TipEntrySheet`

#### `MyTipsViewModel`
- Fetches tip entries via `GwiApiService` endpoint with `employeeId` + `locationId` + date range
- `TipsUiState(entries, isLoading, error, totalCents, cashCents, cardCents)`
- `setFilter(filter)` reloads data for the selected period

#### `TipEntrySheet`
- Full-width bottom sheet: order # + table name, tip amount (large green), payment method badge
- Optional: notes, order totals context, timestamp

#### Navigation Wiring

**`Screen.kt`:**
```kotlin
object MyTips : Screen("my_tips/{employeeId}") {
    fun createRoute(employeeId: String) = "my_tips/$employeeId"
    val arguments = listOf(navArgument("employeeId") { type = NavType.StringType })
}
```

**`AppNavigation.kt`:** composable for `Screen.MyTips` route; back-nav on close.

**`PosHeader.kt`:** "My Tips" `IconButton` (or text button) calls `onNavigateToMyTips(employeeId)`.

**`OrderScreen.kt`:** receives `onNavigateToMyTips` lambda; passed down from `MainActivity` →
`AppNavigation` → `OrderScreen`.

---

## Files Changed

| File | Change |
|------|--------|
| `ui/tips/MyTipsScreen.kt` | New |
| `ui/tips/MyTipsViewModel.kt` | New |
| `ui/tips/TipEntrySheet.kt` | New |
| `ui/navigation/Screen.kt` | + `MyTips` route |
| `ui/navigation/AppNavigation.kt` | + `MyTipsScreen` composable |
| `ui/pos/OrderScreen.kt` | + `onNavigateToMyTips` callback |
| `ui/pos/OrderMainContent.kt` | Passes callback down |
| `ui/pos/OrderSheets.kt` | Wires payment result callbacks |
| `ui/pos/OrderViewModel.kt` | + payment result fields + `clearPaymentResult()` |
| `ui/pos/components/PaymentSheet.kt` | Major rewrite — approved/declined result states |
| `ui/pos/components/PosHeader.kt` | + "My Tips" action |
| `ui/pos/components/NewTabDialog.kt` | UI polish |
| `ui/pos/components/SplitCheckSheet.kt` | Minor |
| `ui/pos/components/TabListSheet.kt` | Minor |
| `data/remote/GwiApiService.kt` | + tips endpoint |
| `data/remote/dto/OrderDtos.kt` | + tip DTOs |
| `data/remote/dto/ServerOrderMapper.kt` | Minor |
| `data/repository/OrderMutationRepository.kt` | Minor |
| `di/DatabaseModule.kt` | Minor |
| `domain/OrderState.kt` | Minor |
| `data/local/AppDatabase.kt` | Version bump |
| `data/local/entity/CachedOrderEntity.kt` | Minor |

---

## Related Skills

- **Skill 250** — Tip Ledger Foundation (NUC/POS tip data model)
- **Skill 466** — Gift Card Payment (adjacent payment flow work)
- **Skill 467** — Card-Insert Detection UI (same commit session)
