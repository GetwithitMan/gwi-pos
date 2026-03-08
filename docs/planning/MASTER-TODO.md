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

### ~~P1-01 — Fix Partial Payment Approval Flow (T-079)~~ ✅ VERIFIED COMPLETE
**Status:** ✅ VERIFIED COMPLETE — All 5 layers confirmed working by audit 2026-02-20: "Void & Retry" button exists in `DatacapPaymentProcessor.tsx` (line 379), `handleVoidPartial()` POSTs to `/api/datacap/void` with `recordNo`, `DatacapClient.voidSale()` sends VOID tran, `PaymentModal` resets to method-select on completion. Three bugs (double-fire, tip double-count, false-positive partial) patched in commit 35224cd. No additional work needed.

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

## 🔴 P1 — Reverse-Flow Audit Findings (Critical Gaps Found 2026-03-03)

These items were discovered by auditing system outputs backwards (socket events, financial records, API responses) rather than forwards. All represent either data integrity risks or silently broken features.

---

### RF-01 — WalkoutRetry: Build Write-Off API
**Priority:** Critical — Money records accumulate with no formal close path
**Gap:** `WalkoutRetry.writtenOffAt` / `writtenOffBy` fields exist in schema. Nothing ever sets them. Exhausted retries (after max attempts) sit in the DB indefinitely with no closure.
**Build:**
- `PUT /api/datacap/walkout-retry/[id]` with `{ action: 'write-off' }` — requires `MANAGER_VOID_PAYMENTS` permission
- Set `writtenOffAt = NOW()`, `writtenOffBy = employeeId`, `status = 'written_off'`
- Add "Write Off" button to walkout retry admin UI
**Also:** `walkoutAutoDetectMinutes` setting is wired to nothing — either wire it to a close-tab trigger or remove the setting.

---

### RF-02 — ChargebackCase: Build Status-Update API
**Priority:** Critical — Cases cannot be closed, disputed, or resolved via any API
**Gap:** `ChargebackCase` model has `status` field (`pending / disputed / resolved / written_off`) but no `PUT /api/chargebacks/[id]` endpoint exists. Cases are import-only.
**Build:**
- `PUT /api/chargebacks/[id]` — status update (disputed → resolved / written_off), requires `PAYMENT_MANAGE` or `MANAGER_VOID_PAYMENTS`
- `notes` field update support
- Status change should emit `chargeback:updated` or update `needsReconciliation` on linked Payment

---

### RF-03 — Mobile Tab Management: Wire Socket Relay Server Handlers
**Priority:** Critical — Feature is silently non-functional. `MobileTabActions.tsx` emits 3 events that are silently dropped.
**Gap:** `socket-server.ts` has ZERO handlers for `tab:close-request`, `tab:transfer-request`, `tab:alert-manager`. Mobile users can tap Close Tab and nothing happens.
**Build:**
- `tab:close-request` → validate employee owns tab or has permission → call `close-tab` logic → emit `tab:closed` to POS terminal in same room
- `tab:transfer-request` → validate target employee exists → reassign tab ownership → emit `tab:updated`
- `tab:alert-manager` → emit `manager:alert` to all manager-role terminals in location room
- Remove `tab:items-updated` dead stub or build the emit path

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

#### ~~P2-B01 — Wire Bottle Service Tab Workflow~~ ✅ RESOLVED (Phase 1)
**Status:** ✅ RESOLVED — Core workflow complete. Commit `eb30807` closes Phase 1.

**Completed (2026-02-21 audit + build):**
1. ~~Floor plan: min-spend progress bar~~ ✅ RESOLVED — `snapshot.ts` fetches `subtotal`+`bottleServiceDeposit`, computes `bottleServiceCurrentSpend`+`bottleServiceReAuthNeeded`; `TableNode` shows 4px color progress bar ($X/$Y min label) + amber ⚠ Extend badge. Commit `eb30807`.
2. ~~Deposit pre-auth on tier selection~~ ✅ VERIFIED COMPLETE — `POST /api/orders/[id]/bottle-service` fully implemented: collectCardData → preAuth → OrderCard + preAuthRecordNo stored. No change needed.
3. ~~Auto-increment near deposit limit~~ ✅ VERIFIED — `POST /api/orders/[id]/bottle-service/re-auth` exists; `BottleServiceBanner` shows alert + "Extend" button; `reAuthNeeded` flag computed at 80% threshold. Manual trigger is sufficient.
4. ~~Reservation workflow wiring~~ ✅ RESOLVED in P2-B03 — `bottleServiceTierId` auto-linked on order creation from reservation.

**Remaining (Post-Launch Optional):**
- Direct floor plan tier assignment (VIP walk-in without reservation) — Large scope, use reservation flow as workaround. No blocker.

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

### REVERSE-FLOW AUDIT — P2 Items

#### RF-04 — Pay-at-Table: Fix `locationId = ''` in Datacap Sale Call
**Priority:** High — Silent payment failure risk
**Gap:** `src/components/pay-at-table/` sends `locationId = ''` to the Datacap sale endpoint. Relies on Datacap resolving the location from the reader ID. May silently fail for misconfigured readers.
**Fix:** Pass real `locationId` from query params (it's already in the URL). Validate non-empty before calling Datacap. Add terminal-side "PAT payment in progress" notice when `pat:pay-request` arrives.
**Also:** `/pay-at-table` route is PUBLIC in `cloud-auth.ts` — determine if this is intentional for iPad kiosk flow or a security gap.

---

#### RF-05 — EOD Cleanup Route: Add `requirePermission()`
**Priority:** Medium — Auth gap on destructive operation
**Gap:** `POST /api/orders/eod-cleanup` (the lighter cleanup route) has no `requirePermission()` call — only guarded by `withVenue`. Any authenticated employee can trigger it.
**Fix:** Add `requirePermission(employee, 'MGR_CLOSE_DAY')` (same as the full reset route) to `eod-cleanup/route.ts`.

---

#### RF-06 — WalkoutRetry: Build Scheduler or Document Manual-Only
**Priority:** Medium — Route comment says "used by cron" but no cron exists
**Gap:** `POST /api/datacap/walkout-retry` comment says it's triggered by a cron/scheduler. No scheduler exists anywhere in `server.ts` or workers. All retries require manual API call.
**Decision needed:** Either (A) wire a NUC-side cron in `server.ts` (e.g., 6 AM daily retry sweep) or (B) add an explicit "Retry All Pending" button to the walkout admin page and remove the misleading comment.

---

#### RF-07 — EOD Reset: Add Admin UI Trigger
**Priority:** Medium — Managers must call the API directly (no button)
**Gap:** `POST /api/eod/reset` requires `MGR_CLOSE_DAY` permission but there is no admin page button. Managers have no in-app way to trigger EOD reset.
**Fix:** Add EOD Reset card to `/settings` or `/settings/orders` — confirmation dialog (lists what will be reset), calls `POST /api/eod/reset`, shows `eod:reset-complete` summary.

---

#### RF-08 — Wire or Remove 6 Orphan Socket Emitters
**Priority:** Medium — Real-time UI updates silently don't work for admin pages
**Gap:** These events are emitted but have zero client-side listeners anywhere in the codebase:
- `inventory:changed` — admin inventory pages don't live-update
- `employees:changed` — employee list doesn't live-update
- `employees:updated` (duplicate of above — naming conflict with `employees:changed`)
- `shifts:changed` — shift list doesn't live-update
- `order-types:updated` — order type admin doesn't live-update
- `settings:updated` — settings consumers don't react in real-time
**Fix:** For each: either add a `useSocket` listener in the relevant admin page to trigger a refetch, or remove the emit if real-time update is intentionally not needed.

---

#### RF-09 — Configure Slack Alert Webhook (or Remove Slack Code Path)
**Priority:** Medium — HIGH-severity alerts silently go email-only; operators may miss critical alerts
**Gap:** `src/lib/alert-service.ts` is fully implemented for Slack but `SLACK_WEBHOOK_URL` is never set in any `.env` template or deployment config. HIGH alerts (e.g., payment failures, sync failures) should reach Slack but don't.
**Fix:** Either (A) add `SLACK_WEBHOOK_URL` to `.env.example` and NUC deployment config + document in NUC-OPERATIONS.md, or (B) if Slack integration is not being used, remove the Slack code path from `alert-service.ts` to avoid confusion.

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
- ~~**Phase 2:**~~ ✅ VERIFIED COMPLETE — all active menu CRUD routes wired with `dispatchMenuItemChanged`/`dispatchMenuStockChanged`/`dispatchMenuStructureChanged`
- ~~**Phase 3:**~~ ✅ RESOLVED — `src/hooks/useMenuSocket.ts` built; subscribes to location room, routes 3 menu events to callbacks, stale-closure safe. Commit `573446c`.
- ~~**Phase 4:**~~ ✅ RESOLVED — `src/lib/online-availability.ts`: `computeIsOrderableOnline()` (showOnline + isAvailable + inventory + availableDays + time windows including overnight); `getStockStatus()` helper. Integrated into `menu/items/[id]/route.ts` dispatch. Commit `573446c`.
- **Phase 5:** Customer-facing order UI (React page: `/order`) — still pending
- **Phase 6:** Online payment integration (Stripe or Datacap) — still pending
- **Phase 7:** Order pickup/delivery workflow, ETA display — still pending

### SCHEDULING (Skill 241)
*Schema built (ScheduledShift, AvailabilityEntry)*
- ~~Build scheduling admin UI (week grid, drag shift blocks)~~ ✅ RESOLVED — `/admin/scheduling` week-grid page exists, schedule publish/draft workflow, shift add modal. Verified complete.
- ~~**Shift edit/delete (admin)**~~ ✅ RESOLVED — `PUT/DELETE /api/schedules/[id]/shifts/[shiftId]`; pencil/× buttons on draft shift cards in admin scheduling page; EditShiftModal. Commit `3b26b0e`.
- ~~**Employee mobile: view my schedule**~~ ✅ RESOLVED — `GET /api/mobile/schedule` returns upcoming published shifts; `/mobile/schedule` dark-theme page: week-grouped cards, 12h time, status badges, role, notes. Nav link in mobile tabs header. Commit `3b26b0e`.
- **Shift request / swap workflow** — LARGE scope (18-20 files): needs new `ShiftSwapRequest` model + 6-8 new API routes + admin swap review panel + mobile request/pending UI + socket notifications. Audit: `ScheduledShift` has `originalEmployeeId`/`swappedAt`/`swapApprovedBy` fields but no `ShiftSwapRequest` model. Full workflow build = dedicated sprint.
- Clock-in/out vs scheduled time comparison — still pending
- Labor scheduling vs actual labor cost report — still pending

### CUSTOMER MANAGEMENT
- **Loyalty:** Points balance, tier status, history (after T-026)
- **Favorites:** Track customer's most-ordered items (top-5 already shown in detail modal)
- ~~**History:** Customer order history in admin view~~ ✅ RESOLVED — `GET /api/customers/[id]` now accepts `page`, `limit`, `startDate`, `endDate`; returns `ordersPagination`; detail modal has date range filter + Apply/Clear + Prev/Next pagination. Commit `52438dc`.
- ~~**Notes:** Per-customer staff notes (allergies, preferences, VIP status)~~ ✅ RESOLVED — Inline notes editor in detail modal: pencil toggle → textarea edit → Save/Cancel with PUT API call + toast. Commit `d0a8dc5`.

### REPORTS (Advanced)
- ~~**Forecasting:** Sales projections based on historical day-of-week patterns~~ ✅ RESOLVED — `GET /api/reports/forecasting` (businessDayDate OR-fallback, 84-day lookback, groups by weekday, projects 14 days); `/reports/forecasting` page (lookback/horizon selectors, 3 summary cards, day-of-week table with gold ★, forecast table with today/tomorrow badges); reports hub tile added. Commit `d9343c5`.
- ~~**Product Mix Trends:**~~ ✅ VERIFIED COMPLETE — `/reports/product-mix` page + API already built with trending items.
- ~~**Server Performance:**~~ ✅ RESOLVED — `GET /api/reports/server-performance` + `/reports/server-performance` page; orders grouped by employee, computes totalSales/tips/avgCheck/tableTurns, gold badge for top performer, CSV export. Commit `1a1f8f5`.
- ~~**Void/Comp Report:**~~ ✅ VERIFIED CORRECT — `/reports/voids` page + API built; `isComp` correctly derived at runtime from `reason` field (no schema mismatch).

### HARDWARE (Advanced)
- ~~**Barcode Scanner (Skill 58):** Item lookup by UPC~~ ✅ RESOLVED — `GET /api/menu/search?sku=X` exact match; `useMenuSearch.lookupBySku()`; keyboard-wedge detector in `MenuSearchInput` + `UnifiedPOSHeader` (100ms burst heuristic → `onScanComplete`); `orders/page.tsx` wires scan → add item to order or `toast.error`. Commit `ea47c11`.
- ~~**Cash Drawer (Skill 56):**~~ ✅ RESOLVED — `src/lib/cash-drawer.ts` + `POST /api/print/cash-drawer`; `hasCash` guard in pay route fires `triggerCashDrawer` fire-and-forget. Commit `f10c9cb`.
- ~~**Reader Health Dashboard:**~~ ✅ RESOLVED — `PaymentReaderLog` schema + `src/lib/reader-health.ts` + `GET /api/hardware/readers/health` + `/settings/hardware/health` dashboard; `logReaderTransaction` wired into `DatacapClient.withPadReset`. Commit `3ff3755`.
- ~~**KDS Browser Version Audit:** Display Chrome version on KDS admin page~~ ✅ RESOLVED — Heartbeat extracts Chrome version from user-agent, stores in `deviceInfo` JSON. Admin KDS page shows "Chrome X.Y" badge. Commit `ea967d9`.
- **Offline Mode (Skill 60):** Full offline operation with sync on reconnect

### PRICING PROGRAMS (T-080 — 5 phases)
*Currently: Cash Discount only*
- Surcharge model (card fee passed to customer)
- Flat-rate model
- Interchange Plus
- Tiered pricing model
- Dual pricing compliance UI

### REVERSE-FLOW AUDIT — Documentation & Investigation Items

#### RF-10 — Create `print-routing.md` Feature Doc
**Priority:** Low — Tag-based print routing is fully built but completely undocumented
**Gap:** `src/lib/print-template-factory.ts` implements tag-based routing, route priority engine (`PrintRoute` model), modifier-only tickets, backup printer failover. No feature doc exists.
**Action:** Create `docs/features/print-routing.md` covering: PrintRoute model, tag matching algorithm, backup failover, `routeSpecificSettings`, modifier-only context lines.

---

#### RF-11 — Create `customer-receipts.md` Feature Doc
**Priority:** Low — `buildReceiptWithSettings()` is fully built with dual pricing/tip/surcharge support but undocumented; no `/api/print/receipt` endpoint
**Gap:** `buildReceiptWithSettings()` in `print-factory.ts` handles dual pricing, tip suggestions, signature lines, surcharge display — but customer receipt printing is browser `window.print()` only; there is no `/api/print/receipt` endpoint to trigger thermal printing.
**Action:** Create `docs/features/customer-receipts.md`. Decision point: is thermal customer receipt intentionally omitted or a gap? If gap, add it to the print system.

---

#### RF-12 — Investigate `shift.variance` Write Path
**Priority:** Low — Field queried in reports but no write path confirmed
**Gap:** `shift.variance` is queried in cash-liabilities and shift reports. No `db.shift.update({ variance: ... })` call found anywhere in the codebase. Either (A) it's a dead/never-populated field that will always be null, or (B) it's populated by a code path that wasn't found.
**Action:** `grep -r "shift.*variance\|variance.*shift" src/` to confirm if any write path exists. If confirmed dead, remove from report queries and schema. If found, document it.

---

#### RF-13 — Document `liquor.md` API Routes
**Priority:** Low — 16+ routes in `/api/liquor/` are undocumented in `docs/features/liquor.md`
**Gap:** `docs/features/liquor.md` covers the admin builder UI but is missing the full API surface. Routes discovered: GET/POST/PUT/DELETE for bottles, categories, pour sizes, spirit upgrades, counts, and several reporting endpoints.
**Action:** Update `docs/features/liquor.md` with full route table from `src/app/api/liquor/`.

---

### MISC SMALL THINGS
- ~~Quick Pick Numbers toggle in gear menu (T-039)~~ ✅ VERIFIED COMPLETE — toggle lives in gear menu (`UnifiedPOSHeader.tsx` line 290-293), calls `onToggleQuickBar` → `updateLayoutSetting('quickPickEnabled', ...)`. Fully functional. Task board note was outdated.
- ~~Integration settings pages (SMS, Slack, Email)~~ ✅ VERIFIED COMPLETE — All three settings pages exist and are fully functional (`/settings/integrations/sms`, `/slack`, `/email`). `GET /api/integrations/status` + `POST /api/integrations/test` routes wired. `src/lib/twilio.ts` (SMS service, void approval flow), `src/lib/email-service.ts` (Resend API), `src/lib/alert-service.ts` (rules-based routing + throttling) all fully implemented. No per-venue DB config layer — env vars per NUC is sufficient. No action needed.
- ESC/POS custom logo per printer — DEFERRED: requires image processing library (sharp/jimp), GS v 0 raster bitmap ESC/POS command, file storage for logo data, and real thermal printer for testing. Medium-Large scope. Revisit when venue specifically requests it.
- Printer round-robin load distribution (Skill 103) — DEFERRED: current first-match routing works correctly; most venues have 1 printer per role. Option A (DB counter: add `roundRobinIndex` to Printer, update after each send) is Small scope when needed. Wait for venue demand signal.
- ~~KDS prep station assignment per terminal UI~~ ✅ VERIFIED COMPLETE — `KDSScreenStation` junction model, multi-select admin UI in `/settings/hardware/kds-screens`, socket `join_station` builds tags from `PrepStation.stationType`, `/api/kds` filters orders by stationId. Fully DB-driven.

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
| 🔴 P1 Critical | 5 remaining (P1-05, P1-07 + RF-01, RF-02, RF-03) | 2–3 weeks |
| 🟠 P2 Important | ~12 remaining (~6 original + RF-04 through RF-09) | 3–4 weeks |
| 🟡 P3 Polish | ~24 (~20 original + RF-10 through RF-13) | 2–3 months |
| 🟢 Future Roadmap | 7+ | Ongoing |

**Reverse-flow audit additions (2026-03-03):** RF-01 through RF-13 — 3 critical, 6 important, 4 polish/docs.

**Minimum to open first real venue:** Complete GL-06 (run remaining pre-launch tests). Estimated: **1 week of focused testing work.**

---

*Last updated: 2026-03-08 — Added HA/Cellular/Fulfillment phases from LOCAL-CORE-CELLULAR-EDGE-HA architecture plan.*

---

## HA / Cellular Edge / Fulfillment Routing — Phase Tracker

> **Architecture doc:** `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md`

| Phase | Description | Status | Key Deliverables |
|-------|-------------|--------|-----------------|
| **Phase 1** | Backup NUC + HA Failover | In Progress | PG streaming replication, keepalived + VIP, ha-check.sh, promote.sh, rejoin-as-standby.sh, installer backup role, fence-check API, health API enhancement, Android VIP failover |
| **Phase 2** | Cellular Edge Path | In Progress | proxy.ts cellular gate, cellular-auth.ts (6-gate model), bidirectional sync config, downstream Order sync, sync-agent SSE wake-up, cellular token refresh endpoint |
| **Phase 3** | Fulfillment Routing | Pending | fulfillment-router.ts, FulfillmentType enum on MenuItem, station resolution, send-time snapshot, idempotent routing |
| **Phase 4** | DR Formalization | Planned | Automated backup verification, replacement NUC restore procedure, Neon-assisted recovery |
| **Phase 5** | Observability | Planned | MC HA dashboard, failover timeline, replication lag graph, cellular device registry, on-device health indicators |
