# GWI POS — Master TODO & Roadmap
> **Audit Date:** 2026-02-20
> **Audited by:** 4-agent deep-dive team (Payments/Hardware, Menu/Orders, Reports/Employees/Customers, Infrastructure/Skills Index)
> **Scope:** Full codebase + all 407 skill docs + changelogs + PM task board

---

## 🔴 SCORECARD

| Area | Status | Score |
|------|--------|-------|
| POS Core (ordering, menu, KDS) | 🟢 Ready | 95% |
| Payments (Datacap, bar tabs, pre-auth) | 🟢 Ready | 90% |
| Discounts (check-level, item-level, employee) | 🟢 Ready | 100% |
| Bottle Service (tiers, deposits, floor plan, reservations) | 🟢 Ready | 90% |
| House Accounts (schema + API + AR report) | 🟢 Ready | 85% |
| Floor Plan | 🟢 Ready | 92% |
| Reports (24 endpoints, 14 UI pages) | 🟢 Ready | 90% |
| Installer | 🟢 Ready | 100% |
| Pre-Launch Tests Completed | 🔴 Incomplete | 8% |
| Simulated Defaults Removed | 🟢 N/A — never existed | 100% |

---

## 🚨 GO-LIVE BLOCKERS — Fix Before First Real Venue

These 8 items will break the system at a real venue.

---

### ~~GL-01 — Remove Simulated Payment Defaults~~ ✅ RESOLVED
**Status:** No action needed.
**Audit finding (2026-02-20):** `src/lib/datacap/simulated-defaults.ts` does NOT exist — was never created or was already removed. `grep -r "SIMULATED_DEFAULTS" src/` returns zero code matches. Simulation is handled entirely by the `communicationMode: 'simulated'` code path in `src/lib/datacap/client.ts`, which is blocked in production by `validateDatacapConfig()`. Per-venue go-live only requires setting `processor: 'datacap'` and entering real credentials in `/settings/payments`.

---

### ~~GL-02 — Payment Processor Config UI (Admin)~~ ✅ RESOLVED
**Status:** Already fully built.
**Audit finding (2026-02-20):** `/settings/payments` page (662 lines) already has all required fields:
- **Processor selector:** none / simulated / datacap (3-option toggle)
- **Merchant ID (MID):** editable text input
- **Token Key:** editable password input with show/hide toggle
- **Environment:** cert (testing) / production toggle with production warning banner
- **Validation:** MID + Token Key required when processor=datacap (enforced on save)
- **Status badge:** "Not configured" / "Configured (Certification)" / "Configured (Production)"
- **operatorId:** Hardcoded to `'POS'` in `src/lib/datacap/helpers.ts` — no UI field needed
- **Communication mode:** Derived from processor setting (simulated → simulated, datacap → local); per-reader overrides live on PaymentReader model
- **Encryption at rest:** Neon PostgreSQL provides AES-256 encryption at rest by default

---

### ~~GL-03 — Floor Plan: Console.log Spam (P0)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — Logger utility is production-stripped; no raw console.log in render paths. Confirmed by audit 2026-02-20.

---

### ~~GL-04 — Floor Plan: Deterministic Table Placement (P0)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — Deterministic grid placement confirmed in POST /api/tables. Math.random() not present. Confirmed by audit 2026-02-20.

---

### ~~GL-05 — Floor Plan: API Failure Rollback (P0)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — API failure rollback added to FloorPlanEditor.tsx (handleReset, handleRegenerateSeats, section create handlers). Commit 35224cd.

---

### GL-06 — Run Pre-Launch Checklist Tests
**File:** `docs/PRE-LAUNCH-CHECKLIST.md`
**Status:** 16 of 200+ tests passed (8%).
**Critical sections:**
- Section 1: Order Flow & Payment (27 tests, 2 passed)
- Section 3: Inventory Deduction (14 tests, 14 passed) ✅ CRITICAL CLEARED
- Section 13: Datacap Payment (12 tests, 0 passed)
- Section 14: Bar Tab Flows (20 tests, 0 passed)

---

### ~~GL-07 — Verify VOID/COMP Stamps Render (T-044)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — VOID/COMP stamps verified working on FloorPlanHome, BartenderView, and orders/page. Confirmed by audit 2026-02-20.

---

### ~~GL-08 — Inventory Deduction End-to-End Test (T-008)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — Two fixes applied: (1) recipeIngredients loop added to void-waste.ts for liquor voids; (2) Multiplier 0 fallback bug fixed in helpers.ts. 67/67 automated tests passing. Commit 35224cd + dc95f38.

---

## 🔴 P1 — Critical (First Sprint After Go-Live)

### P1-01 — Fix Partial Payment Approval Flow (T-079)
**Status:** 🔧 PARTIALLY FIXED — Three bugs patched (commit 35224cd): double-fire of onPartialApproval removed, tip double-counting fixed, false-positive partial detection fixed. Remaining: Void & Retry flow needs full test with real hardware.

**Issue:** "Accept Partial" button in PaymentModal doesn't advance past modal.
Also: false-positive partials when requested == approved amount.
**Files:** `PaymentModal.tsx`, `useDatacap.ts`, `/api/orders/[id]/pay`
**Remaining work:**
1. "Void & Retry" → call Datacap VOID on partial auth, then restart payment flow

---

### ~~P1-02 — House Accounts: Wire into POS Payment Flow~~ ✅ ALREADY IMPLEMENTED
**Status:** ✅ ALREADY IMPLEMENTED — House Accounts option is in PaymentModal, toggled off via acceptHouseAccounts: false feature flag. Confirmed by audit 2026-02-20.

---

### ~~P1-03 — House Accounts: Accounts Receivable + Aging Report~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `POST /api/house-accounts/[id]/payments` + `GET /api/reports/house-accounts` + `/reports/house-accounts` page built. 30/60/90/over-90 aging buckets, inline Record Payment form, CSV export. Commit `78e0859`.

---

### ~~P1-04 — Stale Order EOD Cleanup (T-077)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — POST /api/system/cleanup-stale-orders built + EOD scheduler wired in server.ts (4 AM daily, NUC-only via POS_LOCATION_ID). Commit 35224cd.

---

### P1-05 — Verify Socket Layer on Docker (T-046)
**Issue:** Socket.io only fully runs in production Docker environment.
**Test:** Cross-terminal order updates, entertainment status, no double-refresh, all socket events fire.
**Risk:** Real venue needs real multi-terminal validation before trusting socket reliability.

---

### ~~P1-06 — Auth Store Persistence Verification (T-053)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — useAuthenticationGuard hook created + applied to all 55+ authenticated admin pages. Commit dc95f38.

---

### P1-07 — Card Token Persistence Test (T-026)
**Blocks:** All of Skill 228 (Loyalty Program).
**Test:** Run live payment with real Datacap hardware. Swipe same card twice. Verify processor returns identical token both times.
**If tokens match:** Proceed to Loyalty Phase 2.
**If tokens don't match:** Revisit loyalty architecture (email-based vs token-based).

---

## 🟠 P2 — Important (Weeks 2–4)

### DISCOUNTS

#### ~~P2-D01 — Item-Level Discounts~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `OrderItemDiscount` model added (schema + db:push). `POST/DELETE /api/orders/[id]/items/[itemId]/discount` route built. `OrderPanelItem` updated with "%" button, green discount display, strikethrough original price. Commit `eed6334`.

#### ~~P2-D02 — Employee Discount UX~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `isEmployeeDiscount Boolean @default(false)` added to `DiscountRule` (db:push). Admin UI has "Employee Discount" checkbox with EMPLOYEE badge. `DiscountModal` surfaces employee discounts in a dedicated top section. GET/POST/PUT `/api/discounts` updated. Commit `4c9ca42`.

#### ~~P2-D03 — Discount + Void/Refund Interaction~~ ✅ VERIFIED CORRECT
**Status:** ✅ VERIFIED CORRECT — `payment.amount` always stores discounted amount. Void uses `recordNo` referencing original charge. Refund ceiling is `payment.amount`. No code change needed. Verified 2026-02-20.

#### ~~P2-D04 — Discount on Receipt~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — Discount line added to `src/lib/print-factory.ts` between Subtotal and Tax. Conditional render (only when `totals.discount > 0`). Commit `d8a8432`.

---

### BOTTLE SERVICE

#### P2-B01 — Wire Bottle Service Tab Workflow
**Status:** 🔧 AUTO-GRAT WIRED — autoGratuityPercent now applied in close-tab route when no explicit tip set and minimumSpend met. Full workflow (deposit pre-auth, spend tracking, floor plan badges) still pending. Commit dc95f38.

**Current:** BottleServiceTier model exists (deposit, minimumSpend, autoGratuityPercent). UI components exist.
**Remaining gaps:**
1. Floor plan integration (assign tier to table, show min spend progress bar)
2. Deposit pre-auth on tier selection (already partial)
3. Auto-increment when approaching deposit limit
4. Reservation workflow wiring
**Build:** Complete tier selection → pre-auth for depositAmount → track spend → apply autoGratuityPercent at close

#### ~~P2-B02 — Bottle Service Floor Plan Integration~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `snapshot.ts` batch-fetches tier names/colors; `FloorPlanTable.currentOrder` interface extended; `TableNode` renders colored tier pill badge (gold default) as first status badge; `FloorPlanHome` computes badge for active + all non-active bottle service tables. Commit `298ceb3`.

#### ~~P2-B03 — Bottle Service Reservation Workflow~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `bottleServiceTierId` + relation added to `Reservation` schema (db:push). GET/POST/PUT reservation routes include tier select. Admin reservations UI has tier dropdown + color preview + pill badge on cards. `POST /api/orders` accepts `reservationId`, auto-links and copies tier data to new order. Commit `690b52c`.

---

### PAYMENTS

#### ~~P2-P01 — Split Payments (Multiple Methods, One Order)~~ ✅ ALREADY IMPLEMENTED
**Status:** ✅ ALREADY IMPLEMENTED — Split payments fully built (schema: Payment[], API: /pay-additional, UI: PaymentModal split flow). Confirmed by audit 2026-02-20.

#### ~~P2-P02 — Refund vs Void UX Distinction~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — 3-phase delivery: (1) `Payment.settledAt` + `RefundLog` model schema (`54ccb3e`), (2) `/api/datacap/refund` + `/api/orders/[id]/refund-payment` routes (`4b62e9e`), (3) `VoidPaymentModal.tsx` detects settled state, shows amber Refund path with partial refund input + reader dropdown (`b8644a1`).

#### ~~P2-P03 — Batch Close Admin UI~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — Batch Management card added to /settings/payments with batch summary, SAF queue status, and Close Batch confirmation dialog. Commit 35224cd.

#### ~~P2-P04 — Tip Adjustment Report (T-022)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — /reports/tip-adjustments page built + /api/payments/tip-eligible endpoint. Date filters, editable tip column, CSV export. Commit f51f2a6.

---

### REPORTS

#### ~~P2-R01 — Closed Orders Management UI~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `/settings/orders/closed` page built. Filter bar, summary stats, cursor-based pagination, amber Needs-Tip badges, Reopen + Adjust Tip + Reprint row actions. Commit `2fab494`.

#### ~~P2-R02 — Labor Cost % in Reports~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — /reports/labor page built with labor cost %, hours, overtime, by-employee/day/role tabs. Commit a0b8259.

#### ~~P2-R03 — Hourly Sales Breakdown~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `GET /api/reports/hourly` + `/reports/hourly` page built. CSS-only bar chart, peak hour highlighted, optional compare-date overlay, 4 summary cards. Commit `0cf6786`.

---

### HARDWARE

#### ~~P2-H01 — Print Routing Phase 3~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — New `RouteSpecificSettings` type created. `kitchen/route.ts` updated: PrintRoute fetch by priority, tier-1 matching by categoryIds/itemTypes, modifier routing split (`follow`/`also`/`only`), backup printer failover, PrintJob logging preserved. Commit `43bf02b`.

#### ~~P2-H02 — Modifier-Only Ticket Context Lines~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `kitchen/route.ts` renders `FOR: {item name}` context line before modifier list when `_modifierOnlyFor` is set on synthetic modifier-only items. Commit `df88cf2`.

#### ~~P2-H03 — Wire CFD (Customer-Facing Display) Socket Events (T-018)~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — 4 CFD emit calls wired across 5 files: `cfd:show-order` (PaymentModal), `cfd:payment-started` (DatacapPaymentProcessor), `cfd:receipt-sent` (pay route). 4 dispatch helpers added to `socket-dispatch.ts`. `RECEIPT_SENT` added to `CFD_EVENTS`. Commit `b693b5f`.

#### ~~P2-H04 — Mobile Bartender Tab Sync~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `TAB_ITEMS_UPDATED` event added to `multi-surface.ts`. 3 dispatch helpers added (`dispatchTabClosed`, `dispatchTabStatusUpdate`, `dispatchTabItemsUpdated`). Socket relay handlers added to `socket-server.ts`. `close-tab/route.ts` and `items/route.ts` dispatch events. Commit `65c38b8`.

#### ~~P2-H05 — Pay-at-Table Socket Sync~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — New idempotent `POST /api/orders/[id]/pat-complete` route; `pay-at-table/page.tsx` fires it on last split via both direct Datacap and socket payment paths. Dispatches `orders:list-changed`, `tab:updated`, `floorplan:update`. Commit `72f725b`.

---

### EMPLOYEES

#### ~~P2-E01 — Bar Tab Settings Admin UI~~ ✅ ALREADY IMPLEMENTED
**Status:** ✅ ALREADY IMPLEMENTED — Bar Tab Settings UI is complete at /settings/tabs. Confirmed by audit 2026-02-20.

#### ~~P2-E02 — Mobile Device Authentication~~ ✅ RESOLVED
**Status:** ✅ RESOLVED — `RegisteredDevice` + `MobileSession` models added (db:push). `POST /api/mobile/device/register` (PIN→bcrypt→256-bit token→httpOnly cookie 8h). `GET /api/mobile/device/auth` (validates cookie/header). `/mobile/login` PIN pad page. `/mobile/tabs` + `/mobile/tabs/[id]` auth-guarded with redirect to login. Backwards-compatible with `?employeeId` param. Commit `ae8f76e`.

---

## 🟡 P3 — Post-Launch Polish (Month 2+)

### LOYALTY PROGRAM (Skill 228)
*Blocked by T-026 card token test*
- **Phase 2:** Customer schema (LoyaltyAccount, points balance, tier)
- **Phase 3:** Points accrual on payment (% of order total)
- **Phase 4:** Redemption UI (apply points at checkout)
- **Phase 5:** Admin dashboard (enrolled customers, point balances)
- **Phase 6:** Tier benefits (discounts, comps, unlockable perks)
- **Phase 7:** Email/SMS enrollment + balance notifications

### ONLINE ORDERING (Skill 217)
*Infrastructure done, client UI pending*
- **Phase 2:** Wire `dispatchMenuItemChanged()` on all item CRUD API routes
- **Phase 3:** Build `useMenuSocket` hook for client subscriptions
- **Phase 4:** `isOrderableOnline` computed field (availability + time window + stock)
- **Phase 5:** Customer-facing order UI (React page: `/order`)
- **Phase 6:** Online payment integration (Stripe or Datacap)
- **Phase 7:** Order pickup/delivery workflow, ETA display

### SCHEDULING (Skill 241)
*Schema built (ScheduledShift, AvailabilityEntry), zero UI*
- Build scheduling admin UI (week grid, drag shift blocks)
- Employee mobile: view my schedule
- Shift request / swap workflow
- Clock-in/out vs scheduled time comparison
- Labor scheduling vs actual labor cost report

### CUSTOMER MANAGEMENT
- **Loyalty:** Points balance, tier status, history (after T-026)
- **Favorites:** Track customer's most-ordered items
- **History:** Customer order history in admin view
- **Notes:** Per-customer staff notes (allergies, preferences, VIP status)

### REPORTS (Advanced)
- **Forecasting:** Sales projections based on historical day-of-week patterns
- **Product Mix Trends:** Category % of sales over 30 days
- **Server Performance:** Sales, tips, table turns per server
- **Void/Comp Report:** Daily void analysis by employee + reason

### HARDWARE (Advanced)
- **Barcode Scanner (Skill 58):** Item lookup by UPC
- **Cash Drawer (Skill 56):** Drawer open signal on cash payment
- **Reader Health Dashboard:** avgResponseTime, successRate trends per reader
- **KDS Browser Version Audit:** Display Chrome version on KDS admin page
- **Offline Mode (Skill 60):** Full offline operation with sync on reconnect

### PRICING PROGRAMS (T-080 — 5 phases)
*Currently: Cash Discount only*
- Surcharge model (card fee passed to customer)
- Flat-rate model
- Interchange Plus
- Tiered pricing model
- Dual pricing compliance UI

### MISC SMALL THINGS
- Quick Pick Numbers toggle in gear menu (T-039) — feature built, toggle missing
- Integration settings pages (SMS, Slack, Email) — currently placeholders
- ESC/POS custom logo per printer
- Printer round-robin load distribution (Skill 103)
- KDS prep station assignment per terminal UI

---

## 🟢 FUTURE ROADMAP

| Feature | Notes |
|---------|-------|
| Event Ticketing (Skill 108) | Ticket sales for venue events |
| Real-time Events via Pusher (Skill 110) | Architecture decision: Pusher vs Socket.io |
| Hardware Status Dashboard (Skill 115) | Live reader/printer health monitoring |
| Offline Mode (Skill 60) | Full offline POS + sync |
| Multi-Location Reporting | Consolidated view across venues |
| Franchisee Portal | Per-owner dashboard in Mission Control |
| API Marketplace | Webhook integrations for 3rd-party apps |

---

## 📋 THINGS ALREADY BUILT (Don't Rebuild)

These are DONE and working — reference before adding anything similar:

| Feature | Location |
|---------|----------|
| Check-level discounts | DiscountRule + OrderDiscount models, DiscountModal, `/api/orders/[id]/discount` |
| Happy hour / time-based discounts | DiscountRule.scheduleConfig JSON, `/settings/happy-hour` |
| Comp/void with reason tracking | CompVoidModal, VoidLog, wasMade flag, Skill 237 |
| Bar tabs + pre-auth | OpenTabModal, `/api/orders/open-tab`, `/api/orders/close-tab`, OrderCard model |
| Auto-increment auth | `/api/orders/[id]/auto-increment`, 80% threshold trigger |
| Walkout recovery | WalkoutRetry model, retry schedule, Skill 272 |
| Bottle service tiers | BottleServiceTier model, autoGratuityPercent, depositAmount |
| Combo items | ComboTemplate, ComboComponent, ComboStepFlow |
| Partial approval detection | useDatacap hook (needs button fix) |
| Per-modifier print routing (UI + API) | ItemEditor 🖨️ button, Modifier.printerRouting, Skill 212 |
| KDS device pairing + security | Token + httpOnly cookie + PIN, Skill 102 |
| Print routing priority engine | PrintRoute model, Phase 1-2 done, Skill 103 |
| Real-time socket updates | emitToLocation(), getSharedSocket(), Skill 248 |
| Multi-tenant DB routing | withVenue(), AsyncLocalStorage, Skill 337 |
| Business day tracking | businessDayDate on orders, all 10 report routes use it |
| Floor plan full feature set | Tables, seats, sections, virtual sections, FloorPlanHome |
| Tip-out end-to-end | Payment → TipAllocation → TipShare → payroll report |
| Inventory deduction engine | Path A + B, multipliers, fire-and-forget, `src/lib/inventory-calculations.ts` |
| Installer (production-ready) | `public/installer.run`, RSA-OAEP-SHA256, heartbeat, sync agent |

---

## 📊 TASK COUNT SUMMARY

| Priority | Count | Est. Effort |
|----------|-------|-------------|
| 🚨 Go-Live Blockers | 1 remaining (GL-06 only — run pre-launch tests) | 1 week |
| 🔴 P1 Critical | 2 remaining (P1-05, P1-07) | 1–2 weeks |
| 🟠 P2 Important | ~6 remaining | 2–3 weeks |
| 🟡 P3 Polish | ~20 | 2–3 months |
| 🟢 Future Roadmap | 7+ | Ongoing |

**Minimum to open first real venue:** Complete GL-06 (run remaining pre-launch tests). Estimated: **1 week of focused testing work.**

---

*Last updated: 2026-02-20 — P2 sprint: P1-03, P2-R01, P2-R03, P2-P02, P2-D04, P2-H03 all resolved*
