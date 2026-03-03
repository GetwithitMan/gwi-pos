# GWI POS — Known Bugs Register

> **This file is the source of truth for all unresolved bugs.**
> Before working in any area, scan your section. Before closing a bug, update its status here.
> When a bug is confirmed fixed, mark it ✅ FIXED with the commit hash.

*Last updated: 2026-03-03*

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
**Status:** 🔴 UNRESOLVED
**Feature:** Tabs, Payments
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-1)
**Affected files:** `PaymentModal.tsx`, `DatacapPaymentProcessor.tsx`, `OrderPanelActions.tsx`

**What happens:** When a card is run on a bar tab, fails, and the bartender hits "Cancel" — the entire tab is destroyed. All items are lost. Staff must re-ring from scratch.

**What should happen:** Cancel only cancels the payment attempt. The tab and all items remain. A "Try Again" or "Pay Cash Instead" option appears.

**Root cause theory:** The cancel handler on `PaymentModal` / `DatacapPaymentProcessor` is calling order close/delete instead of just aborting the payment intent.

**Impact:** Every failed card attempt at the bar risks losing the entire order.

---

### BUG-C2 — Extra Seats Disappear on Page Refresh
**Status:** 🔴 UNRESOLVED
**Feature:** Floor Plan, Orders
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-2)
**Affected files:** `src/domains/floor-plan/seats/`, Zustand floor plan store hydration

**What happens:** Server adds a 5th seat to a 4-top during service. Page refreshes (network hiccup, logout timeout, browser reload). Extra seats vanish from UI. Data is still in DB but not reloaded into Zustand state.

**What should happen:** Seats hydrate from DB on every page load / store init.

**Impact:** Split checks break mid-service when seats vanish. Staff must add seats again, causing order panel confusion.

---

## HIGH — Should Fix Before Pilot

---

### BUG-H1 — Pizza Builder Non-Functional
**Status:** 🔴 UNRESOLVED
**Feature:** Pizza Builder
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-3)
**Affected files:** `src/components/pizza/`, `docs/features/pizza-builder.md`

**What happens:** The pizza builder modal exists in code but does not function correctly. Pizza orders cannot be properly built or customized.

**Do not attempt:** Do not add pizza-related features until this core flow is fixed.

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
**Status:** 🔴 UNRESOLVED
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
**Status:** 🔴 UNRESOLVED
**Feature:** Discounts
**Source:** "Broken things need fixin.rtf"
**Affected files:** `DiscountModal.tsx` or equivalent

**What happens:** When applying a custom percentage discount, there is no keyboard or numeric input. Staff cannot type in a number.

**Fix:** Add numeric keyboard / input field to the discount modal for custom amount entry.

---

### BUG-M2 — Bar Tabs: Items Slow/Not Sticking When Adding Quickly
**Status:** 🔴 UNRESOLVED
**Feature:** Tabs, Orders
**Source:** "Broken things need fixin.rtf"

**What happens:** When bartender adds items to a tab quickly, some items don't persist. If clicking too fast, duplicate adds occur and some items are lost.

**Root cause:** Race condition in item-add path — likely the `commandClient-first` invariant is not consistently applied, or the debounce is too loose.

**Note:** The 300ms item-tap debounce (added in audit remediation commit `007bb79`) may partially address this. Needs testing.

---

### BUG-M3 — Duplicate Adds on Tabs
**Status:** ⚠️ NEEDS VERIFICATION (may be fixed by debounce)
**Feature:** Tabs, Orders
**Source:** "Broken things need fixin.rtf"

**What happens:** Adding items to a tab sometimes creates duplicates. Related to BUG-M2.

---

### BUG-M4 — Tab Name Bypass Setting Not Working
**Status:** 🔴 UNRESOLVED
**Feature:** Tabs, Settings
**Source:** "Broken things need fixin.rtf" + Front-End Audit Report (BUG-6)
**Affected files:** `NewTabModal.tsx`, `CardFirstTabFlow.tsx`, `src/app/(admin)/settings/tabs/`

**What happens:** Even when settings indicate card requirement should be bypassable (name-only tab), the system still forces card entry or behaves inconsistently.

**Note:** Tab nickname work was done 2026-03-03. Verify whether the settings-based bypass now works correctly.

---

### BUG-M5 — "No Search in Bartender View"
**Status:** 🔴 UNRESOLVED
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

## LOW — Polish / Future

---

### BUG-L1 — Timing Tax Calculation When Timer Off
**Status:** 🔴 UNRESOLVED
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
**Status:** 🔴 UNRESOLVED
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
| **Dual Pricing Display — Android card total lower than web for same order** | 2026-03-03 | *(pending commit)* |
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
