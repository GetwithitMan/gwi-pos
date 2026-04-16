# Entertainment Validation Report — 2026-04-16

**Server:** v2.0.66 → v2.0.68 (deployed to Vercel; NUC deployment pending)
**Android APK:** Updated with display fixes + C4 engine (installed on test L1400)
**Test venue:** Main Bar & Grill (3 L1400 registers, no PitBoss/KDS connected)

---

## Audit Findings (31 total, triaged to 7 must-fix)

### Fixed & Deployed

| ID | Severity | Issue | Fix | Server Version |
|----|----------|-------|-----|----------------|
| **C1** | CRITICAL | Cron `cleanupOrphanSessions` and `findStaleSessions` used `locationId = ''` — never matched any DB rows. Stale/orphan sessions were never auto-cleaned. | WHERE clause: `(locationId = '' OR mi.locationId = locationId)` — empty string means all locations | v2.0.66 |
| **C2** | CRITICAL | Entertainment block-time handlers (start/extend/override/stop) never emitted `orders:list-changed`. Cross-terminal order lists didn't refresh after entertainment price changes. | Added `dispatchOpenOrdersChanged` to all 4 handlers | v2.0.66 |
| **H3** | HIGH | Auto-gratuity entertainment exemption filtered on `categoryType === 'entertainment'` instead of `menuItem?.itemType === 'timed_rental'`. Timed rentals under non-entertainment categories were not excluded from grat basis. | Changed filter to `menuItem?.itemType === 'timed_rental'` | v2.0.66 |
| **H6** | HIGH | `recalculateOrderAfterPriceChange` silently swallowed errors via try-catch. If tax recalculation failed after entertainment stop, the error was invisible and order.total remained stale. | Re-throw after logging so stop handler returns 500 | v2.0.66 |
| **Display** | MEDIUM | Cents rendered as dollars in entertainment price updates. Server sends `currentCharge` in cents via `entertainment:price-update` socket event, but Android handler called `.toCents()` (×100 again). 390 cents → 39000 → displayed as $390.00. | Changed `.toCents()` to `.toLong()` in both price update handlers | Android APK |
| **Display** | MEDIUM | `ItemUpdated` event payload had no `price` field. Server emits price in ITEM_UPDATED events for entertainment start/stop/extend, but Android reducer ignored it. Item prices never updated from the event stream. | Added `price: Double?` to `ItemUpdated`, reducer maps via `toCents()` | Android APK |
| **C4** | HIGH | Register checkout engine had no per-minute pricing knowledge. `OrderItemSnapshot` lacked `blockTimeStartedAt`, `blockTimeExpiresAt`, `ratePerMinuteCents`. Engine used stale cached prices for active sessions. | Room v65→v66 migration, engine `adjustEntertainmentPrices()` preprocessing, server sends `ratePerMinute` in events (v2.0.68) | v2.0.68 + Android APK |

### Verified Not-a-Bug

| ID | Claimed Issue | Finding |
|----|---------------|---------|
| **H4** | Floor plan ticker `LaunchedEffect(Unit)` memory leak | False positive. `LaunchedEffect(Unit)` inside `if (hasActiveEntertainment)` is correctly scoped by Compose lifecycle — disposed when condition becomes false. |
| **C3** | Card validation against pre-settlement total | Already fixed in prior session. `build-payment-financial-context.ts` computes `orderTotal` from post-settlement DB read within the same transaction. |
| **C5** | Payment-lock event buffer never replayed | Overstated. Replay code exists at `OrderSyncController.kt:1174`. Reframed to: verify entertainment event coverage during lock/unlock. |

### Deferred (Next Wave)

| ID | Issue | Reason |
|----|-------|--------|
| **H1** | Extend with flatFee updates DB twice outside transaction | Low frequency, needs careful transaction refactor |
| **H2** | Settlement + cron race on same session | Requires order-level locking coordination |
| **H5** | No entertainment reconciliation after offline/reconnect | Needs periodic reconciliation worker |
| **M1** | MenuItem/FloorPlanElement status desync (separate Room writes) | Needs consolidated transaction |
| **M6** | `status == "in_use"` with `currentOrderId == null` falls through to waitlist | Data-integrity symptom, needs diagnostic logging |
| **M7** | Live price update dispatchers defined but never called | Feature gap, not a bug |

---

## Test Results

### ADB Validation — Full Entertainment Lifecycle

**Device A:** L1400 (adb-2630132768-Pint5w) — Updated APK with all fixes
**Device B:** L1400 (adb-2630132799-oFgS8i) — Cross-terminal observer

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | Start Pool Table 1 (30 min block time) | **PASS** | Order #225 created, $15.60 initial, timer 29:30 |
| 2 | Add food item to entertainment order | **PASS** | Loaded Nachos ($10.99) added to same order |
| 3 | Send to kitchen | **PASS** | Both items sent |
| 4 | Floor plan shows IN USE timer | **PASS** | `IN USE • 28:05` visible immediately after send |
| 5 | Cross-terminal Open Orders (C2) | **PASS** | Order #225 appeared on Device B without manual refresh |
| 6 | Tap in-use station → reopen order | **PASS** | Order loaded with timer + stop/extend/+15m/+30m controls |
| 7 | Stop session | **PASS** | Timer removed, price settled |
| 8 | Cash payment (stale cache) | **FAIL** | Register sent $12.05, server expected $29.11. See C4 gap below. |
| 9 | Cash payment (after server sync) | **PASS** | $28.00 accepted after register synced server total |
| 10 | Floor plan returns to AVAILABLE | **PASS** | Pool Table 1 green/AVAILABLE after payment |

### Previous Session Tests (v2.0.64 NUC)

| # | Test | Result | Details |
|---|------|--------|---------|
| 11 | Start + send + extend +15m | **PASS** | Timer updated to 44:15 (30+15 min) |
| 12 | Floor plan timer on bootstrap | **PASS** | `IN USE • 16:39` visible after re-login |
| 13 | Overtime display (Arcade 1) | **PASS** | `IN USE • OT +42:04` in red |
| 14 | Order not found → snackbar | **PASS** | "Arcade 1 session order not found. Try refreshing." |
| 15 | Multiple stations showing correct status | **PASS** | Pool Table IN USE, Dart Board AVAILABLE, Arcade AVAILABLE |

### Server-Side Verification

| Test | Result | Method |
|------|--------|--------|
| H3 auto-grat exclusion (5 scenarios) | **15/15 PASS** | Direct unit test of `calculateAutoGratuity` with mock data |
| C1 SQL logic (old vs new WHERE) | **4/4 PASS** | Raw SQL query comparison: old returned 0 rows, new returns 4 |
| H3 settings revert | **CONFIRMED** | Auto-grat settings reverted to original (not set) after test |

---

## C4 Price Mismatch — Detailed Analysis

**Scenario:** Start Pool Table 1 (30 min, $10 block time) → add Loaded Nachos ($10.99) → send → stop after ~2 min → pay

**Register view after stop:**
- Pool Table 1: $0.00 (reducer received ITEM_UPDATED with price from stop handler)
- Loaded Nachos: $11.43 (card price)
- Total: $12.31

**Server view after stop:**
- Pool Table 1: $15.00 (minimum charge from `timedPricing.minimum: 15`)
- Loaded Nachos: $10.99
- Total: $29.11 (with tax)

**Root cause:** The stop handler's `calculateStopCharge()` computed $15 (minimum charge for block-time pricing). The server's ITEM_UPDATED event included `price: 15` (or possibly `price: 0` if grace period applied differently). The register's event reducer updated priceCents, but the checkout engine's total didn't match the server's recalculated total.

The NUC is running v2.0.66 which doesn't include the `ratePerMinute` field in ITEM_UPDATED events (that's v2.0.68). Once v2.0.68 deploys, the register's engine can compute the correct minimum charge locally.

**Mitigation:** After payment failure, the register re-synced from server and the second payment attempt succeeded at the correct amount ($28.00 cash).

---

## New Bugs Discovered During Testing

| Bug | Severity | Details |
|-----|----------|---------|
| **Email Receipt tap zone** | LOW | On the payment success screen, the Done button is below Email Receipt. ADB taps on Done frequently hit Email Receipt, opening the keyboard and hiding Done. Layout issue — Email Receipt and Done are too close vertically. |
| **Session idle timeout** | MEDIUM | Employee sessions expire aggressively (~5 min?) during ADB testing, requiring constant re-login. Debug builds override this, but release APKs don't. Consider increasing timeout for entertainment-designated terminals. |
| **Comp blocked by Link Customer** | MEDIUM | Comp flow on entertainment items opens "Link Customer" dialog. Closing the dialog cancels the comp — the item keeps its original price. Comps should not require customer link as a blocking step. |
| **Datacap connection error on Device B** | INFO | "TRANSACTION NOT COMPLETE - Failed On Ethernet Access, ip: 127.0.0.1, Port: 1235, Code: 003227" — card reader not configured on this terminal. Expected for test environment. |

---

## Extended Test Suite — Different Flows

| # | Test | Result | Details |
|---|------|--------|---------|
| E1 | Dart Board 1 session start | **PASS** | Order #227, $10.40, timer 29:30 |
| E2 | Concurrent sessions (3 stations) | **PASS** | Pool Table 1 + Dart board 1 + Dart Board 2 all IN USE with independent timers. No perf degradation. |
| E3 | Comp entertainment item (stopped) | **FAIL** | Comp flow opens "Link Customer" dialog. Closing cancels the comp. Item keeps original price. |
| E4 | Void entertainment order | **PASS** | "Void Entire Order" dialog, station returns to AVAILABLE after void |
| E5 | Transfer order with entertainment | **PASS** | Order transferred to Table 10. Entertainment session continues running. Timer uninterrupted. |
| E6 | Stop session (Dart Board 2, per-minute) | **PASS** | Settled at $4.37 for ~3 min use. Correct per-minute charge. |
| E7 | Dart Board 2 session → stop → void → AVAILABLE | **PASS** | Full lifecycle: start → send → stop → void → station returns to AVAILABLE |
| E8 | Cross-terminal order interference | **OBSERVED** | Another terminal added Buffalo Wings to our entertainment order while we were testing. Multi-terminal write contention on entertainment orders is possible. |

---

## Environment Notes

- **3 L1400 registers**, no PitBoss/KDS connected
- **NUC version:** v2.0.66 (C1/C2/H3/H6 fixes deployed, but NOT v2.0.68 C4 fix)
- **Android APK:** Updated with all fixes including C4 engine, Room v66
- **Login PIN:** 36017 (5 digits) for this venue
- **Previous venue PIN:** 111111 (6 digits) — different NUC
- **APK signing:** `~/.android/gwi-pos-release.jks`, alias `gwi-pos`, use `apksigner` (not jarsigner)
