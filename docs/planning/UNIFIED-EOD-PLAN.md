# Unified EOD (End of Day) System — Implementation Plan

> **Goal:** One EOD flow, one behavior, all platforms. Manual "Close Day" = early trigger.
> Automated cron = same thing at scheduled time. Android/PAX/Web all see and participate identically.

---

## Current State (Problems)

| Problem | Root Cause |
|---------|-----------|
| Order numbers never reset to #1 | `MAX(orderNumber)` query has no business day filter in `/api/orders` |
| Cron batch close is partial | `/api/cron/eod-batch-close` doesn't roll over stale orders or emit `eod:reset-complete` |
| Manual + cron can double-fire | No shared idempotency — manual reset has no guard, cron has its own |
| Tabs with cards not auto-captured | Neither EOD path captures pre-auths |
| Android has no EOD awareness | No socket listeners, no overlay, no "Close Day" action |
| Two different socket events | `eod:reset-complete` (manual) vs `eod:auto-batch-complete` (cron) |

---

## Architecture: Unified EOD

```
                    ┌─────────────────────┐
                    │   executeEodReset()  │  ← Single shared function
                    │   (src/lib/eod.ts)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼────────┐ ┌────▼─────┐  ┌───────▼────────┐
     │ POST /eod/reset │ │ GET cron │  │ Android/PAX    │
     │ (manager btn)   │ │ (04:00)  │  │ "Close Day"    │
     │ Permission-gated│ │ Auto     │  │ calls POST too │
     └────────┬────────┘ └────┬─────┘  └───────┬────────┘
              │               │                │
              └───────────────┴────────────────┘
                              │
                    Socket: eod:reset-complete
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        Web POS          Android          PAX
        (overlay)        (overlay)       (overlay)
```

**Key principle:** `executeEodReset()` is extracted to `src/lib/eod.ts`. Both the manual endpoint and the cron call the same function. One idempotency guard. One socket event. One audit log action.

---

## Phases

### Phase 1 — Fix Order Number Reset (Server Only)

**Files:** 3 server files
**Risk:** Low — additive WHERE clause

Add business day filter to `MAX(orderNumber)` query in all order creation paths.

#### 1a. `src/app/api/orders/route.ts` — Lines 140-142 AND 499-501

**Before:**
```sql
SELECT "orderNumber" FROM "Order"
WHERE "locationId" = $1 AND "parentOrderId" IS NULL
ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE
```

**After:**
```sql
SELECT "orderNumber" FROM "Order"
WHERE "locationId" = $1
  AND "parentOrderId" IS NULL
  AND "createdAt" >= $2
  AND "createdAt" < $3
ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE
```

Where `$2` = `businessDay.start`, `$3` = `businessDay.end` from `getCurrentBusinessDay(dayStartTime)`.

The `businessDayStart` variable already exists at line ~76 (draft path) and ~460 (full path) — just pass it to the query.

#### 1b. `src/app/api/orders/replay-cart-events/route.ts`

Same fix — add business day filter to MAX(orderNumber) query.

#### 1c. `src/app/api/public/orders/route.ts`

Same fix for online ordering order creation.

#### 1d. Remove unique constraint conflict

The existing unique index `Order_locationId_orderNumber_unique` is global (not per-day). After this fix, order #1 will exist for each business day. The index needs to include `businessDayDate`:

```sql
DROP INDEX IF EXISTS "Order_locationId_orderNumber_unique";
CREATE UNIQUE INDEX "Order_locationId_orderNumber_businessDay_unique"
ON "Order" ("locationId", "orderNumber", "businessDayDate")
WHERE "parentOrderId" IS NULL;
```

New migration: `scripts/migrations/023-order-number-per-business-day.js`

---

### Phase 2 — Extract Unified EOD Function

**Files:** 3 server files (new `src/lib/eod.ts`, modify cron + reset routes)

#### 2a. Create `src/lib/eod.ts`

Extract all shared logic into one function:

```typescript
export interface EodResetOptions {
  locationId: string
  employeeId?: string      // null for cron-triggered
  triggeredBy: 'manual' | 'cron'
  dryRun?: boolean
  autoCaptureTabs?: boolean // from settings
  autoGratuityPercent?: number // from settings
}

export interface EodResetResult {
  tablesReset: number
  rolledOverOrders: number
  entertainmentReset: number
  tabsCaptured: number
  tabsCapturedAmount: number
  tabsDeclined: number
  tabsRolledOver: number    // tabs without cards
  batchCloseSuccess: boolean
  businessDay: string
  alreadyRanToday: boolean  // idempotency hit
}

export async function executeEodReset(options: EodResetOptions): Promise<EodResetResult>
```

**The function does (in order):**

1. **Idempotency check** — Query `auditLog` for `action='eod_reset_completed'` with matching `businessDay` for this location. If found, return `{ alreadyRanToday: true }` with previous stats.

2. **Tab auto-capture** (if `autoCaptureTabs` enabled):
   - Find all `bar_tab` orders with `status='open'` AND authorized `OrderCard`
   - For each: call `preAuthCapture()` via Datacap with `purchaseAmount = order.total`, `gratuityAmount = total * autoGratuityPercent`
   - On success: close the order (create Payment, update Order status)
   - On decline: mark as `tabStatus='declined_capture'`, flag walkout
   - Tabs without cards: leave open, mark rolled over

3. **Roll over stale orders** — Find open orders from before current business day. Update `rolledOverAt` + `rolledOverFrom`. Emit `ORDER_METADATA_UPDATED` events.

4. **Reset orphaned tables** — Tables with `status='occupied'` but no open orders → `available`.

5. **Clean entertainment** — Reset timed_rental items in `in_use`, clear floor plan, expire waitlist.

6. **Datacap batch close** (if `autoBatchClose` enabled) — Call `batchClose()` per reader.

7. **Walkout detection** — Call `detectPotentialWalkouts()`.

8. **Write audit log** — Single `eod_reset_completed` entry with full stats.

9. **Emit socket event** — `eod:reset-complete` with stats payload.

10. **Write last-batch.json** (NUC only) — For MC heartbeat.

#### 2b. Refactor `POST /api/eod/reset`

Replace inline logic with:
```typescript
const result = await executeEodReset({
  locationId,
  employeeId,
  triggeredBy: 'manual',
  dryRun,
  autoCaptureTabs: locSettings.eod?.autoCaptureTabs,
  autoGratuityPercent: locSettings.eod?.autoGratuityPercent,
})
```

Keep the dry-run preview path (GET) as-is — it just returns counts without executing.

#### 2c. Refactor `GET /api/cron/eod-batch-close`

Replace per-location inline logic with the same call:
```typescript
const result = await executeEodReset({
  locationId: loc.id,
  triggeredBy: 'cron',
  autoCaptureTabs: locSettings.eod?.autoCaptureTabs,
  autoGratuityPercent: locSettings.eod?.autoGratuityPercent,
})
```

Remove the cron's own table/entertainment/walkout logic — it's all in `executeEodReset()` now. Keep only the timing window check and location iteration.

#### 2d. Retire `eod:auto-batch-complete` socket event

Both paths now emit `eod:reset-complete`. Remove `eod:auto-batch-complete` everywhere.

---

### Phase 3 — Tab Auto-Capture at EOD

**Files:** `src/lib/eod.ts`, `src/lib/settings.ts`

#### 3a. New settings

Add to `EodSettings` interface in `settings.ts`:

```typescript
interface EodSettings {
  autoBatchClose?: boolean        // existing
  batchCloseTime?: string         // existing
  autoCaptureTabs?: boolean       // NEW — capture pre-auth tabs at EOD
  autoGratuityPercent?: number    // NEW — auto-gratuity % on unclosed tabs (e.g., 20)
  rolloverUncardedTabs?: boolean  // NEW — roll over tabs without cards (default true)
}
```

#### 3b. Capture logic in `executeEodReset()`

```
For each open bar_tab with authorized OrderCard:
  1. Calculate finalAmount = order.total
  2. Calculate gratuity = finalAmount * (autoGratuityPercent / 100)
  3. Call datacapClient.preAuthCapture(card.readerId, {
       recordNo: card.recordNo,
       purchaseAmount: finalAmount,
       gratuityAmount: gratuity
     })
  4. On Approved:
     - Create Payment record
     - Update Order: status='paid', tabStatus='closed', paidAt=now
     - Update OrderCard: status='captured'
     - Emit ORDER_CLOSED event
  5. On Declined:
     - Update Order: tabStatus='declined_capture'
     - Flag as potential walkout
     - Log to audit trail
  6. On Error (timeout/network):
     - Leave tab open, mark rolled over
     - Log warning — manager must review
```

**Safety:** Each capture is wrapped in try/catch. A failed capture never blocks the rest of EOD.

#### 3c. Settings UI

Add toggle to Settings > Payments > "End of Day" section:
- "Auto-close tabs with cards at EOD" checkbox
- "Auto-gratuity %" input (0-30%, default 20%)
- Warning: "Unclosed tabs will be charged at their current total plus the auto-gratuity percentage."

---

### Phase 4 — Android EOD Participation

**Files:** ~8 Android files across register + PAX

#### 4a. Socket event listener

`SocketEvents.kt`:
```kotlin
const val EOD_RESET_COMPLETE = "eod:reset-complete"
```

`SocketManager.kt` — add `registerEodListeners()`:
```kotlin
socket.on(SocketEvents.EOD_RESET_COMPLETE) { args ->
  val data = args.firstOrNull() as? JSONObject ?: return@on
  dispatchEvent(SocketEvent.EodResetComplete(data))
}
```

#### 4b. EOD overlay in OrderViewModel

When `EodResetComplete` event received:
- Set `eodSummary` state in `OrderUiState`
- Refresh open orders (numbers will start at #1)
- Show dismissable overlay/banner with stats

`OrderUiState`:
```kotlin
val eodSummary: EodSummary? = null  // non-null = show overlay
```

```kotlin
data class EodSummary(
  val rolledOverOrders: Int,
  val tablesReset: Int,
  val tabsCaptured: Int,
  val businessDay: String,
)
```

#### 4c. EOD overlay UI

`EodOverlay.kt` — composable shown over the order panel:
```
┌──────────────────────────┐
│  ✓ End of Day Complete   │
│                          │
│  ↻ 3 orders rolled over  │
│  ⊞ 5 tables reset        │
│  💳 2 tabs auto-charged   │
│                          │
│  Business Day: 03/11     │
│                          │
│         [Dismiss]        │
└──────────────────────────┘
```

#### 4d. "Close Day" action (manager only)

In the POS header menu (kebab/overflow), add "Close Day" option:
- Gated by `manager.close_day` permission
- Shows confirmation dialog: "This will close the business day, capture open tabs, and reset tables."
- Calls `POST /api/eod/reset` with `{ locationId, employeeId }`
- On success, triggers same overlay as socket event

#### 4e. Order age badges in open orders

`OpenOrdersPanel.kt` already shows `order.ageMinutes` as plain text ("· 45m"). Enhance with color:
- < 60 min: green
- < 240 min (4h): yellow/amber
- < 480 min (8h): orange
- ≥ 480 min: red
- Rolled over: red "Rolled Over" badge

---

### Phase 5 — PAX Mirrors Register

**Files:** ~5 PAX files (same patterns as register)

- Same socket listener for `eod:reset-complete`
- Same overlay UI (compact for handheld screen)
- NO "Close Day" button — handhelds receive notification only
- Same order age badge colors in open orders

---

## Settings Summary

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| `eod.autoBatchClose` | MC-managed | `false` | Run Datacap batch at scheduled time |
| `eod.batchCloseTime` | MC-managed | `"04:00"` | When cron triggers (local time) |
| `eod.autoCaptureTabs` | MC-managed | `false` | Auto-charge tabs with cards at EOD |
| `eod.autoGratuityPercent` | MC-managed | `20` | Auto-grat % on captured tabs |
| `businessDay.dayStartTime` | MC-managed | `"04:00"` | When the business day rolls over |

---

## Socket Event (Unified)

**Event:** `eod:reset-complete`
**Emitted by:** `executeEodReset()` (both manual + cron)
**Payload:**
```typescript
{
  rolledOverOrders: number
  tablesReset: number
  entertainmentReset: number
  tabsCaptured: number
  tabsCapturedAmount: number  // total $ captured
  tabsDeclined: number
  tabsRolledOver: number
  batchCloseSuccess: boolean
  businessDay: string         // "2026-03-11"
  triggeredBy: 'manual' | 'cron'
}
```

**Consumed by:** Web POS (dashboard overlay + floor plan overlay), Android (EodOverlay), PAX (EodOverlay)

---

## Migration

`scripts/migrations/023-order-number-per-business-day.js`:
```javascript
// 1. Drop old global unique index
// 2. Create new per-business-day unique index
// 3. Guard: columnExists/indexExists checks
```

---

## File Change Summary

| Phase | Repo | Files | Lines (est.) |
|-------|------|-------|-------------|
| 1 | gwi-pos | 4 (orders route ×2 paths, replay-cart, public/orders, migration) | ~60 |
| 2 | gwi-pos | 3 (new eod.ts, refactor reset route, refactor cron route) | ~350 |
| 3 | gwi-pos | 2 (eod.ts capture logic, settings.ts + settings UI) | ~200 |
| 4 | register | 8 (SocketEvents, SocketManager, OrderViewModel, OrderUiState, OrderSlice, EodOverlay, PosHeader, OpenOrdersPanel) | ~250 |
| 5 | pax | 5 (same pattern as register, compact UI) | ~200 |
| **Total** | 3 repos | **~22 files** | **~1,060** |

---

## Execution Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4+5 (parallel)
  │           │          │          │
  │           │          │          └─ Android + PAX (can parallelize)
  │           │          └─ Tab capture (depends on unified function)
  │           └─ Extract eod.ts (core refactor)
  └─ Order number fix (standalone, ship immediately)
```

**Phase 1** can ship independently — it's a pure bug fix.
**Phases 2+3** ship together — the unified function + tab capture.
**Phases 4+5** ship after server is done — client consumption.

---

## Test Scenarios

1. **Order number reset:** Create orders, wait past business day boundary, create more → numbers start at #1
2. **Manual EOD:** Manager clicks "Close Day" → tabs captured, orders rolled over, tables reset, overlay on all terminals
3. **Auto EOD:** Let cron fire at batch time → identical behavior to manual
4. **Double-fire guard:** Manual reset, then cron fires → cron sees audit log, skips (alreadyRanToday)
5. **Tab with card:** Open tab with pre-auth → EOD captures at total + auto-grat → Payment created
6. **Tab declined:** Pre-auth capture declined → tab flagged as walkout, rolled over
7. **Tab without card:** Open tab, no card → rolled over (no charge attempt)
8. **Android overlay:** EOD fires from web → Android shows overlay with stats
9. **Android "Close Day":** Manager triggers from Android → same result as web
10. **PAX notification:** EOD fires → PAX shows compact overlay
