# GWI POS — Known Bugs Register

> **This file is the source of truth for all unresolved bugs.**
> Before working in any area, scan your section. Before closing a bug, update its status here.
> When a bug is confirmed fixed, mark it ✅ FIXED with the commit hash.

*Last updated: 2026-03-21*

---

## How to Use This File

- **Starting a task?** Find your feature section. If bugs exist, read them before touching code.
- **Found a new bug?** Add it here with severity + affected files + reproduction steps.
- **Fixed a bug?** Change status to ✅ FIXED + commit hash. Do NOT delete the entry.

---

## CRITICAL — Production Blockers

These will cause visible data loss or payment failure at a live venue.

---

### BUG-C1 — Card Decline + Cancel Destroys Entire Tab
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Tabs, Payments
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-1)
**Affected files:** `PaymentModal.tsx`, `DatacapPaymentProcessor.tsx`, `OrderPanelActions.tsx`

**What happens:** When a card is run on a bar tab, fails, and the bartender hits "Cancel" — the entire tab is destroyed. All items are lost. Staff must re-ring from scratch.

**What should happen:** Cancel only cancels the payment attempt. The tab and all items remain. A "Try Again" or "Pay Cash Instead" option appears.

**Root cause theory:** The cancel handler on `PaymentModal` / `DatacapPaymentProcessor` is calling order close/delete instead of just aborting the payment intent.

**Impact:** Every failed card attempt at the bar risks losing the entire order.

---

### BUG-C2 — Extra Seats Disappear on Page Refresh
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Floor Plan, Orders
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-2)
**Affected files:** `src/domains/floor-plan/seats/`, Zustand floor plan store hydration

**What happens:** Server adds a 5th seat to a 4-top during service. Page refreshes (network hiccup, logout timeout, browser reload). Extra seats vanish from UI. Data is still in DB but not reloaded into Zustand state.

**What should happen:** Seats hydrate from DB on every page load / store init.

**Impact:** Split checks break mid-service when seats vanish. Staff must add seats again, causing order panel confusion.

---

## HIGH — Should Fix Before Pilot

---

### BUG-H3 — Downstream Sync HWM Gap (Menu Items / Modifiers Not Syncing)
**Status:** ✅ FIXED (commit pending)
**Feature:** Offline Sync
**Affected files:** `src/lib/sync/downstream-sync-worker.ts`, `src/lib/sync/sync-config.ts`

**What happened:** Menu items and modifier groups added via the web back office were not syncing to NUCs. Items appeared duplicated on NUCs that already had them with different CUIDs.

**Root cause (HWM gap):** When no persisted HWM existed, `initHighWaterMarks()` used `MAX(updatedAt)` from local PG. This skipped Neon rows with timestamps before the local max that had different IDs (dual-DB transition). Additionally, no unique constraint on ModifierGroup or Modifier business keys allowed unlimited duplication.

**Fix:**
1. `initHighWaterMarks()` now uses epoch fallback (full re-sync on first run)
2. Business-key conflict resolution added for ModifierGroup + Modifier in `sync-config.ts`
3. Migration 043: automated dedup + unique constraints for ModifierGroup/Modifier
4. CellularDevice table existence check cached to eliminate log spam

**Production fix:** Fruita Grill NUC manually deduped + HWM reset. Counts now match Neon: 314 items, 49 groups, 303 modifiers.

---

### BUG-H1 — Pizza Builder Non-Functional
**Status:** ✅ RESOLVED
**Feature:** Pizza Builder
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-3)
**Affected files:** `src/app/api/menu/route.ts`, `src/hooks/useOrderingEngine.ts`, `src/app/(pos)/orders/hooks/useOrderHandlers.ts`

**Root causes found and fixed:**
1. **`/api/menu` missing `isPizza` field** (ROOT CAUSE): The main menu endpoint (`/api/menu/route.ts`) did not return `isPizza` or `hasModifiers` for pizza items. Since `FloorPlanHome` loads menu data from this endpoint, `engine.handleMenuItemTap` could never detect pizza items — the pizza builder modal never opened.
2. **Double-counted price in `useOrderingEngine.ts`**: The engine callback set `price: config.totalPrice` (all components) while also building modifiers with all component prices. `computeTotals` sums both, yielding 2x the correct price. Fixed to `price: 0` since modifiers carry all prices.
3. **Double-counted sauce/cheese in `useOrderHandlers.ts`**: `handleAddPizzaToOrder` used `getPizzaBasePrice()` (size+crust+sauce+cheese) as item price, but `buildPizzaModifiers()` also includes sauce/cheese in box-section modifier prices. Fixed to use `sizePrice + crustPrice` only.
4. **Missing `pizzaConfig` on engine-added items**: The engine callback did not pass `pizzaConfig` to the store, preventing pizza editing after initial add. Fixed.

**Fix details:** `isPizza` and `hasModifiers` now computed in `/api/menu/route.ts` matching `/api/menu/items/route.ts` logic. Engine `addItemDirectly` signature extended with optional `pizzaConfig`.

---

### BUG-H2 — Combo Builder Unverified
**Status:** ⚠️ NEEDS VERIFICATION
**Feature:** Combos
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-4)
**Affected files:** `src/app/(admin)/combos/`, `src/app/api/combos/`

**What happens:** Combo rules can be created in admin. Whether they correctly apply during order entry is unverified.

**Action needed:** End-to-end test: create combo → ring it at POS → verify pricing and components apply correctly.

---

### BUG-H3 — Auto-Increment Auth Fails Silently on Tab
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Tabs, Payments
**Source:** Front-End Audit Report (BUG-7)
**Affected files:** `src/app/api/datacap/increment/`, `BottleServiceBanner.tsx`

**What happens:** When `IncrementalAuthByRecordNo` fails on the card reader, the tab stays under-authorized with no warning to staff. The amber banner (`tabIncrementFailed`) only fires if a specific socket event is received — which is not guaranteed.

**What should happen:** Any failed increment auth must surface an amber warning to the bartender immediately, regardless of socket reliability.

---

### BUG-H4 — Old Web CFD Page Has Broken Socket Flow
**Status:** ⚠️ NEEDS VERIFICATION (may be superseded)
**Feature:** CFD
**Source:** Forensic Bug Log 2026-02-23 (BUG-2, BUG-3, BUG-4)
**Affected files:** `src/app/(cfd)/cfd/page.tsx`, `src/lib/socket-server.ts`

**Context:** The system now uses `gwi-cfd` (Android app on PAX A3700) as the real CFD. The old web `/cfd` page may still exist and has 3 compounding socket bugs:
1. CFD emits `'join'` event but server only handles `'subscribe'` — CFD never joins its room
2. CFD events (`cfd:payment-started`, `cfd:show-order`) emitted from client components instead of server API routes — events go nowhere
3. `'cfd:'` prefix not in `ALLOWED_ROOM_PREFIXES` in `socket-server.ts`

**Action needed:** Verify whether the old web `/cfd` page is still in active use or can be removed. If still used, all 3 bugs must be fixed. If `gwi-cfd` Android is the only CFD path, the old web CFD page should be deprecated/removed.

---

### BUG-H5 — Missing Receipt Print Route
**Status:** ⚠️ NEEDS VERIFICATION
**Feature:** Hardware, Payments
**Source:** Forensic Bug Log 2026-02-23 (AGENT 3)
**Affected files:** 3 locations that call a receipt print route

**What happens:** Receipt printing calls a non-existent API route from 3 locations (including post-payment). Receipts silently fail to print.

**Action needed:** Verify whether this was fixed as part of the March 2026 payment work. Check that `POST /api/print/receipt` exists and is wired in all 3 call sites.

---

## MEDIUM — UX Issues

---

### BUG-M1 — Discounts Keyboard Missing
**Status:** ✅ ALREADY IMPLEMENTED (verified 2026-03-14 — numeric keypad exists in DiscountModal.tsx)
**Feature:** Discounts
**Source:** "Broken things need fixin.rtf"
**Affected files:** `DiscountModal.tsx` or equivalent

**What happens:** When applying a custom percentage discount, there is no keyboard or numeric input. Staff cannot type in a number.

**Fix:** Add numeric keyboard / input field to the discount modal for custom amount entry.

---

### BUG-M2 — Bar Tabs: Items Slow/Not Sticking When Adding Quickly
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Tabs, Orders
**Source:** "Broken things need fixin.rtf"

**What happens:** When bartender adds items to a tab quickly, some items don't persist. If clicking too fast, duplicate adds occur and some items are lost.

**Root cause:** Race condition in item-add path — likely the `commandClient-first` invariant is not consistently applied, or the debounce is too loose.

**Note:** The 300ms item-tap debounce (added in audit remediation commit `007bb79`) may partially address this. Needs testing.

---

### BUG-M3 — Duplicate Adds on Tabs
**Status:** ✅ FIXED — `a44948d1` (same-item dedup in order store)
**Feature:** Tabs, Orders
**Source:** "Broken things need fixin.rtf"

**What happens:** Adding items to a tab sometimes creates duplicates. Related to BUG-M2.

---

### BUG-M4 — Tab Name Bypass Setting Not Working
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Tabs, Settings
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-6)
**Affected files:** `NewTabModal.tsx`, `CardFirstTabFlow.tsx`, `src/app/(admin)/settings/tabs/`

**What happens:** Even when settings indicate card requirement should be bypassable (name-only tab), the system still forces card entry or behaves inconsistently.

**Note:** Tab nickname work was done 2026-03-03. Verify whether the settings-based bypass now works correctly.

---

### BUG-M5 — "No Search in Bartender View"
**Status:** ✅ FIXED — already implemented (verified 2026-03-05)
**Feature:** Orders, Menu
**Source:** Front-End Audit Report (Section 2.1)
**Affected files:** `BartenderView.tsx` or equivalent

**What happens:** The main orders page has search, but Bartender View does not. Bartenders must scroll horizontally through categories to find spirits during rush.

---

### BUG-M6 — No Hot Buttons for Common Bar Modifiers
**Status:** 🔴 UNRESOLVED (missing feature / UX gap)
**Feature:** Modifiers, Menu
**Source:** Front-End Audit Report (Section 2.3)

**What's missing:** Neat, Rocks, Up, Dirty, Dry, Wet, Twist are NOT hot buttons — they require opening the modifier modal. Pour sizes (shot/double/tall/short) and spirit tiers already exist as hot buttons.

---

## Android Build — Pre-Existing Compile Errors

---

### BUG-A1 — ModifierSheet.kt:236 — Unresolved Reference: toggleModifier
**Status:** ✅ FIXED — `f7cbcfb`
**Feature:** Android — ModifierSheet
**Source:** Surfaced during Dual Pricing Display Compliance audit 2026-03-03 (Agent A)
**Affected files:** `app/src/main/java/com/gwi/register/ui/pos/components/ModifierSheet.kt` (line 236)

**What happens:** Pre-existing compile error — `toggleModifier` reference cannot be resolved at line 236.

**Action needed:** Trace the call site — likely a lambda or function reference renamed during a refactor. Fix the reference to the correct current function name.

---

### BUG-A2 — TipEntrySheet.kt:220 — Unresolved Reference: PosTypography
**Status:** ✅ FIXED — `f7cbcfb`
**Feature:** Android — TipEntrySheet
**Source:** Surfaced during Dual Pricing Display Compliance audit 2026-03-03 (Agent A)
**Affected files:** `app/src/main/java/com/gwi/register/ui/pos/components/TipEntrySheet.kt` (line 220)

**What happens:** Pre-existing compile error — `PosTypography` reference cannot be resolved at line 220.

**Action needed:** Check whether `PosTypography` was renamed or removed. Update the reference to the correct typography token (likely `MaterialTheme.typography.bodyMedium` or equivalent).

---

### BUG-H6 — NUC Deploy EACCES After `sudo npm run build`
**Status:** ✅ FIXED (documented) — operational fix, not code fix
**Feature:** NUC Deployment
**Affected files:** NUC filesystem (`/opt/gwi-pos/app/.next/`)

**What happens:** If someone runs `sudo npm run build` on a NUC, the `.next/build/` directory becomes owned by `root`. Subsequent deploys running as `smarttab` fail with EACCES.

**Fix:** `chown -R smarttab:smarttab /opt/gwi-pos/app/.next/` — documented in `docs/guides/NUC-OPERATIONS.md`.

**Prevention:** Never run build commands as root on a NUC. All builds must run as `smarttab`.

---

### BUG-H7 — CellularDevice Table Missing on Production NUCs
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Cellular Edge, HA
**Affected files:** `scripts/migrations/`, `src/lib/sync/downstream-sync-worker.ts`

**What happens:** Production NUCs (e.g., Fruita Grill) don't have the `CellularDevice` table. Downstream sync logs errors on every cycle. The `BridgeCheckpoint` upsert also fails with null ID errors.

**Root cause:** Migrations that create these tables (from the HA/Cellular feature set) haven't been applied to existing production NUCs. The `pre-start.sh` `prisma db push` should handle this, but needs verification.

**Action needed:** Verify that `prisma db push` on NUC boot creates the CellularDevice and BridgeCheckpoint tables. If not, add explicit migration scripts.

---

### BUG-H8 — "Employee ID is Required" for MC/Email Login Users
**Status:** ✅ FIXED — gwi-pos `2a3408ca`
**Feature:** Auth, Admin Operations
**Affected files:** `src/lib/api-auth.ts`, `src/app/api/auth/venue-login/route.ts`, `src/app/(admin)/settings/hardware/terminals/page.tsx`

**What happened:** Venue owners using email/password login (MC auth) only had a `pos-cloud-session` cookie. `getActorFromRequest()` only checked `pos-session` (PIN login), making cloud-session users invisible to auth. All admin operations returned 401.

**Fix:** 3-layer: (1) `getActorFromRequest()` reads both cookies, (2) venue-login auto-provisions Employee records for MC owners, (3) terminal creation sends employeeId from client auth store.

---

## LOW — Polish / Future

---

### BUG-L1 — Timing Tax Calculation When Timer Off
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Entertainment, Tax
**Source:** "Broken things need fixin.rtf"

**What happens:** If timing is turned off on an item/category, tax is not calculated in the total. Tax should still apply regardless of timer status.

---

### BUG-L2 — Long Press Item: No Description Modal
**Status:** 🔴 NOT YET BUILT
**Feature:** Menu, Orders
**Source:** "Broken things need fixin.rtf"

**Requested:** Long holding a menu item should show description, how it's made, ingredients, and a quick "86" (out of stock) option. Not yet implemented.

---

### BUG-L3 — Mission Control: Deleted Server Stations Not Removed
**Status:** 🔴 UNRESOLVED
**Feature:** Mission Control, KDS
**Source:** "Broken things need fixin.rtf"

**What happens:** Deleted server stations continue to appear in Mission Control. They should be removed from all views on soft-delete.

---

### BUG-L4 — Fire-and-Forget Missing .catch() on Floor Plan Save
**Status:** ✅ FIXED — `a44948d1`
**Feature:** Floor Plan
**Source:** Forensic Bug Log 2026-02-23 (BUG-1)
**Affected files:** `src/app/api/tables/save-default-layout/route.ts` line 71

**Fix:** Change `dispatchFloorPlanUpdate(locationId, { async: true })` to `void dispatchFloorPlanUpdate(locationId, { async: true }).catch(console.error)`

---

## Not-Yet-Built Features (Tracked Here for Visibility)

These were requested but are not bugs — they're missing features. Track them in `MASTER-TODO.md` for builds.

| Feature | Source | Priority |
|---------|--------|----------|
| Size option hot buttons (S/M/L/XL for food) | RTF | Medium |
| Customizable pre-mod buttons | RTF | Medium |
| "Repeat Last Order" / Reorder button | Front-End Audit | High (bar) |
| "Last Call" batch tab close | Front-End Audit | High (bar) |
| Item long-press description + quick 86 | RTF | Medium |
| Liquor catalog for inventory setup | RTF | Low |
| Seed data / sample items for venue onboarding | RTF | Medium |
| VNC working on POS stations | RTF | Low |
| Centralized venue log database (per-venue diagnostics) | RTF | Low |

---

## Bugs Confirmed Fixed

| Bug | Fixed In | Commit |
|-----|----------|--------|
| **Dual Pricing Display — Android card total lower than web for same order** | 2026-03-03 | `c55dd9c` (Android) / `d903153` + `29c6c0a` (web) |
| **Android tax = $0.00 (taxRate never bootstrapped or computed)** | 2026-03-03 | `358cc99` (7 files: BootstrapWorker, OrderState, OrderReducer, OrderMutationRepository, OrderSyncRepository, OrderViewModel, OrderMainContent) |
| **Web order panel totals: Cash Discount / Rounding rows (non-compliant model)** | 2026-03-03 | `cebed10` (OrderPanelActions.tsx — card-first display) |
| **cashDiscountPercent race condition on first Android launch** | 2026-03-03 | `358cc99` (bootstrap completion observer + reloadBootstrappedSettings) |
| Partial payment approval flow | v1.x | `35224cd` |
| VOID/COMP stamps not rendering | Audit 2026-02-20 | — |
| Inventory deduction end-to-end | 2026-02-20 | `35224cd` + `dc95f38` |
| Auth store persistence | 2026-02-20 | `dc95f38` |
| 50% tip warning missing | Audit remediation | `007bb79` |
| Item-tap debounce (300ms) | Audit remediation | `007bb79` |
| Tab nickname 30-char cap | 2026-03-03 | `007bb79` |
| Floor plan: console.log spam | 2026-02-20 | Confirmed stripped |
| Floor plan: deterministic table placement | 2026-02-20 | Confirmed |
| Floor plan: API failure rollback | 2026-02-20 | `35224cd` |
| Double-event bug (commandClient-first) | 2026-02-26 | `aff5d56` |
| **NUC taxTotal=0 (Location.settings.tax.defaultRate null, TaxRules not used)** | 2026-03-03 | `64ad81e` (tax-utils.ts, location-cache.ts, tax-rules routes, nuc-pre-migrate) |
| **Android taxTotal=0 via socket path (3 compounding bugs: device guard, JSON path, no replay)** | 2026-03-03 | Android fix commit (OrderSyncRepository, OrderSyncController) |
| **Cash rounding settings UI removed from /settings/payments** | 2026-03-03 | `8b6803c` |
| **priceRounding not passed to calculateOrderTotals in create/add-items** | 2026-03-03 | `9344ee6` |
| **Tax rules page 401 — `requestingEmployeeId` missing from GET/POST** | 2026-03-03 | Skill 479 (useAdminCRUD.ts, tax-rules/page.tsx) |
| **Tax rules page TypeError: Failed to fetch — service worker v1 intercepting /api/* and returning undefined** | 2026-03-03 | Skill 479 (public/sw.js v2, ServiceWorkerRegistration.tsx stale-cache detection) |
| **useAdminCRUD infinite render loop — inline parseResponse ref unstable → toast flood** | 2026-03-03 | Skill 479 (useAdminCRUD.ts ref-stabilized extractItems) |
| **useAuthenticationGuard Zustand hydration race — one-tick wait too fast** | 2026-03-03 | Skill 479 (useAuthenticationGuard.ts persist.onFinishHydration) |
| **Grey/invisible text across admin UI (dark mode CSS root cause)** | 2026-03-11 | `ce291b73` (root cause: removed @media prefers-color-scheme: dark), `e6942d51` (223 files text-gray-900), `0829aad6` (global CSS + inputClass) |
| **NUC schema out-of-sync on boot ("Migration didn't properly handle")** | 2026-03-11 | `0e425f2b` (pre-start.sh runs prisma db push before service start) |
| **Android Room migration crash (wrong schema, no auto-recovery)** | 2026-03-11 | register `6f0ba91`, PAX `cb92728` (try/catch + delete + rebuild on migration failure) |
| **"Employee ID is required" for MC/email login users (BUG-H8)** | 2026-03-12 | `2a3408ca` (3-layer auth unification: dual cookie, auto-provision, client employeeId) |
| **Pizza builder TS2532 blocking Vercel builds** | 2026-03-12 | `aa5a844b` (pizzaConfig! extraction in truthiness-guarded IIFE) |
| **NUC deploy EACCES after sudo build (BUG-H6)** | 2026-03-12 | Operational fix (chown), documented in NUC-OPERATIONS.md |
| **Employee-shift report double-counting inclusive tax in grossSales** | 2026-03-16 | `f9b1a83c` (employee-shift report: `preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive`; daily report: `inclusive_gross` SQL column; Receipt.tsx: tax label threading) |
| **HSTS on localhost cached by browsers — dev server appears unresponsive** | 2026-03-16 | HSTS header now production-only (`next.config.ts`) |
| **Sentry/OpenTelemetry deadlocking Next.js dev server on startup** | 2026-03-16 | Dynamic `import()` in `instrumentation.ts`, production-only init |
| **Prisma tenant-scoping infinite recursion in `resolveTenantLocationId`** | 2026-03-16 | Request-scoped recursion guard via `AsyncLocalStorage` (`db.ts`, `request-context.ts`) |
| **Duplicate items on Android devices (server + client generate different IDs)** | 2026-03-17 | Stable lineItemId contract: all 27 OrderItemRequest constructors send client-generated UUID; server uses it as OrderItem.id. NUC `52ee8e67`+`248c3265`, Register `aa5b85d`+`d1edebc`+`2efafe0`, PAX `4bb3627`+`2cd2e61`+`f68d33c` |
| **Reservation engine: 8+ bugs found and fixed during build** | 2026-03-17 | Socket dispatch missing on 7/9 transition callers (`13d5029d`), multi-tenant isolation on 5 routes (`50e76f11`), customer linkage gaps (`6e74ac30`), SQL injection in deposit route (`61d49b40`), deposit ID Math.random()→crypto.randomUUID (`bf1f3ddd`), expired holds blocking availability (`bf1f3ddd`), idempotency key race condition (`bf1f3ddd`), WCAG contrast violations (`0ccabcfa`) |
| **16 upstream models had silent sync failures (missing syncedAt/updatedAt/lastMutatedBy)** | 2026-03-21 | Migrations 090-092: `b3020a95` (16 models), `c2efdb75` (5 columns + composite PK), `68be79e4` (DeductionRun). 161/161 models now pass column verification. |
| **Customer phone dedup crash on sync** | 2026-03-21 | `5d85bb29` — unique constraint violation on null phone numbers during customer sync |
| **Tab lifecycle lastMutatedBy not set — tabs not syncing upstream** | 2026-03-21 | `5d85bb29` — tab mutations now set `lastMutatedBy: 'local'` |
| **Standby NUC could process payments (no guard)** | 2026-03-21 | `8a2da67a` — standby guard blocks payments and order creation |
| **12 pushUpstream routes missing — mutations not triggering immediate sync** | 2026-03-21 | `b2a587fb` — added pushUpstream() to 12 remaining upstream mutation routes |
| **POS crash loop — CFD metadata column + stale tenant models** | 2026-03-21 | `3354e20f` — venue_schema_state guard, CFD metadata column existence check |

---

## Entertainment / Timed Rentals — Open Items (2026-04-16 audit)

> **Context:** Full audit + validation run on 2026-04-16. See `docs/logs/ENTERTAINMENT-VALIDATION-2026-04-16.md` for details. Server fixes deployed in v2.0.66-v2.0.68. Android fixes committed + APK installed on test L1400.

### Confirmed Fixed (v2.0.66-v2.0.68)

| Bug | Fix | Commit |
|-----|-----|--------|
| C1: Cron `locationId=''` never matched rows — stale sessions never cleaned | WHERE clause treats '' as all-locations | `ce98019c` (v2.0.66) |
| C2: Missing `orders:list-changed` on entertainment mutations | Added `dispatchOpenOrdersChanged` to all 4 block-time handlers | `ce98019c` (v2.0.66) |
| H3: Auto-grat exemption used `categoryType` instead of `menuItem.itemType` | Changed to `menuItem?.itemType === 'timed_rental'` | `ce98019c` (v2.0.66) |
| H6: `recalculateOrderAfterPriceChange` swallowed errors silently | Re-throw after logging | `ce98019c` (v2.0.66) |
| C4: Register checkout engine had no per-minute pricing | Room v66 migration, engine `adjustEntertainmentPrices()`, server sends `ratePerMinute` in events | `5341c3b7` (v2.0.68) + Android `8fdd3df` |
| Display: Cents rendered as dollars ($390.00 instead of $3.90) | Changed `.toCents()` to `.toLong()` in price update handlers | Android `84c012c` |
| Display: `ItemUpdated` event missing price field — reducer never updated price | Added `price: Double?` to `ItemUpdated`, reducer maps via `toCents()` | Android `84c012c` |
| M6: `status=in_use` with `currentOrderId=null` silent waitlist fallback | Diagnostic handling in `onEntertainmentElementClicked` | Already handled |
| Email Receipt / Done button spacing | `PaymentSheet.kt` spacing 20dp → 40dp | `c14f6b7` |

### Still Open — Next Validation Pass

#### BUG-ENT-1 — Comp on entertainment items may be blocked by Link Customer dialog
**Status:** 🔍 NEEDS VERIFICATION
**Severity:** MEDIUM
**Feature:** Entertainment, Comp/Void
**Observed:** 2026-04-16 ADB test. After confirming comp reason, a "Link Customer" dialog appeared. Closing it appeared to cancel the comp (price unchanged).
**Analysis:** The `compItem()` code path in `OrderViewModel.kt:2629` goes directly to `discountManager.compItem()` with no customer dialog. The dialog may be a post-comp prompt that doesn't block the comp, or the comp failed for another reason (e.g., server permission, entertainment-specific comp path via `DELETE /api/entertainment/block-time?reason=comp`).
**Affected files:** `OrderViewModel.kt`, `DiscountCoordinator.kt`, `comp-void/route.ts`, `block-time/route.ts` DELETE handler
**Repro:** Start entertainment session → send → stop → long-press item → Comp → select reason → Comp → observe Link Customer dialog → close → check if price changed
**Next step:** Retest with fresh session. Verify server-side comp response. Check if the entertainment comp uses the standard comp-void route or the entertainment-specific stop-with-reason=comp path.

#### BUG-ENT-2 — Register-server price mismatch on first payment after entertainment stop
**Status:** ⚠️ OPEN (C4 residual)
**Severity:** HIGH
**Feature:** Entertainment, Payments
**Observed:** 2026-04-16. After stopping Pool Table 1 session (~2 min used), register showed $0.00 for the item. Server had $15.00 (minimum charge from `timedPricing.minimum`). First cash payment rejected ($12.05 vs server's $29.11). Second attempt succeeded after register synced server total.
**Root cause:** The C4 engine fix computes live per-minute charges, but block-time items with `timedPricing.minimum` need the minimum charge enforced in the engine too. The engine currently floors at `priceCents` (booked price) but doesn't know about `timedPricing.minimum`.
**Affected files:** `DefaultCheckoutEvaluationEngine.kt` (`computeLiveEntertainmentPrice`), `entertainment-pricing.ts`
**Condition:** Only affects block-time items with a minimum charge AND per-minute pricing in timedPricing JSON. Pure per-minute items (via `ratePerMinute` DB field) are handled by the C4 engine fix.
**Mitigation:** Payment fails safely on first attempt, succeeds after server sync. No money lost, but UX friction.
**Next step:** Add `minimumChargeCents` to the event pipeline (ITEM_UPDATED → OrderLineItem → CachedOrderItemEntity → OrderItemSnapshot → engine). Engine should enforce `max(liveCharge, minimumChargeCents)`.

#### BUG-ENT-3 — Extend with flatFee updates DB twice outside transaction
**Status:** ⚠️ OPEN
**Severity:** MEDIUM
**Feature:** Entertainment
**Affected files:** `block-time/route.ts` PATCH handler, lines 373-383
**Description:** If a flatFee > 0 is configured for extensions, the PATCH handler updates the OrderItem price inside the `extendSession()` transaction, then updates it AGAIN outside the transaction with the flatFee surcharge. Race condition: if payment happens between the two writes, the price is inconsistent.
**Next step:** Move flatFee update inside the `extendSession()` transaction.

#### BUG-ENT-4 — Settlement + cron race on same session
**Status:** ⚠️ OPEN
**Severity:** MEDIUM
**Feature:** Entertainment, Payments
**Description:** `build-payment-financial-context.ts` settles per-minute items during payment. The entertainment-expiry cron can also settle the same item. If both run concurrently, the final DB price is whichever wrote last — potential over/under billing.
**Next step:** Add `FOR UPDATE` lock on the OrderItem in the payment settlement path to serialize with cron.

#### BUG-ENT-5 — No entertainment reconciliation after offline/reconnect
**Status:** ⚠️ OPEN
**Severity:** LOW
**Feature:** Entertainment, Sync
**Description:** When a register reconnects after being offline, `catchUpAfterReconnect()` replays order events but has no entertainment-specific reconciliation. If entertainment events were missed during offline (session start/stop), the floor plan shows stale state until bootstrap.
**Next step:** Add `refreshEntertainmentFloorPlan()` call in `catchUpAfterReconnect()`.

#### BUG-ENT-6 — Live price update dispatchers defined but never called
**Status:** ⚠️ OPEN
**Severity:** LOW
**Feature:** Entertainment
**Description:** `dispatchEntertainmentPriceUpdate()` and `dispatchEntertainmentPriceBatchUpdate()` are defined in `socket-dispatch/misc-dispatch.ts` but no cron or periodic timer calls them. Active sessions show stale prices until the next event or manual refresh.
**Next step:** Implement a periodic timer (every 60s) that emits price updates for all active per-minute sessions.

> **2026-03-21 Note:** 16 upstream models had silent sync failures (missing `syncedAt`/`updatedAt`) — fixed in migrations 090-092. All 161 synced models now pass column verification. Instant sync (<500ms) achieved via `pushUpstream()` (40 routes) + `notifyDataChanged()` (99 routes).

> **2026-03-21 (Session 2) — NUC Infrastructure Bugs Fixed:**
> - **Readiness permanently null on deployed NUCs** — race condition: readiness was set after `httpServer.listen()`. Fixed by setting BOOT before listen.
> - **Sync showing "Degraded/Never" despite workers running** — module isolation: esbuild (server.js) and Turbopack (API routes) had separate module copies. Fixed with `globalThis.__gwi_*` singletons.
> - **Dashboard showing "v1.0.0"** — version was hardcoded. Now reads from package.json at runtime.
> - **Installer syntax error at line 342** — missing quote/bracket in installer.run. Fixed.
> - **Update-agent silently failing on `prisma db push`** — schema drift blocked push. Added `--accept-data-loss` in deploy path only (not pre-start), plus auto-chown and deterministic SHA rollback.
