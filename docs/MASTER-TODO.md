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
| Discounts (check-level, employee, happy hour) | 🟢 Built | 90% |
| Bottle Service (tiers, deposits, auto-grat) | 🟡 Partial | 60% |
| House Accounts (schema + API) | 🟡 Partial | 50% |
| Floor Plan | 🟡 Has P0 bugs | 80% |
| Reports (24 endpoints, 14 UI pages) | 🟢 Ready | 90% |
| Installer | 🟢 Ready | 100% |
| Pre-Launch Tests Completed | 🔴 Incomplete | 5% |
| Simulated Defaults Removed | 🔴 NOT DONE | 0% |

---

## 🚨 GO-LIVE BLOCKERS — Fix Before First Real Venue

These 8 items will break the system at a real venue.

---

### GL-01 — Remove Simulated Payment Defaults
**File:** `src/lib/datacap/simulated-defaults.ts`
**Risk:** Payments will not work at real venues — simulated defaults still active.
**Steps:**
1. Build Payment Processor Config UI (see GL-02 first)
2. Set real `merchantId` + `operatorId` per Location in MC
3. Set all `PaymentReader.communicationMode = 'local'` at venues
4. Set `settings.payments.processor = 'datacap'` per location
5. Delete `simulated-defaults.ts` + remove its import in `client.ts`
6. Verify: `grep -r "SIMULATED_DEFAULTS" src/` → zero matches

---

### GL-02 — Payment Processor Config UI (Admin)
**Gap:** Merchants can't configure their own Datacap credentials.
**Currently:** Only read-only view in `/settings/payments`.
**Build:**
- Real vs Simulated toggle per location
- Merchant ID field (encrypted at rest)
- Operator ID field
- Communication mode toggle (local / simulated)
- Validate fields before saving (format check)

---

### GL-03 — Floor Plan: Console.log Spam (P0)
**Files:** `EditorCanvas.tsx`, `collisionDetection.ts`
**Risk:** Render-loop console output kills production performance.
**Fix:** Strip all `console.log` from floor plan render paths.

---

### GL-04 — Floor Plan: Deterministic Table Placement (P0)
**Issue:** New tables placed at `Math.random()` coordinates.
**Risk:** Tables appear in random positions → operators lose layout work.
**Fix:** Default to center of canvas, or next open grid position.

---

### GL-05 — Floor Plan: API Failure Rollback (P0)
**Issue:** Drag/resize/property edits have no error handling. Silent failures = data lost.
**Fix:** Wrap all floor plan mutations in try/catch; revert optimistic UI update on failure; show toast error.

---

### GL-06 — Run Pre-Launch Checklist Tests
**File:** `docs/PRE-LAUNCH-CHECKLIST.md`
**Status:** 4 of 200+ tests passed (5%).
**Critical sections:**
- Section 1: Order Flow & Payment (27 tests, 0 passed)
- Section 3: Inventory Deduction (14 tests, 0 passed) ← CRITICAL
- Section 13: Datacap Payment (12 tests, 0 passed)
- Section 14: Bar Tab Flows (20 tests, 0 passed)

---

### GL-07 — Verify VOID/COMP Stamps Render (T-044)
**Skill:** 238 fix applied but not verified.
**Test:**
1. Add item to order → void it → confirm: red VOID badge, strikethrough price, $0 total
2. Verify on all 3 views: FloorPlanHome, BartenderView, orders/page

---

### GL-08 — Inventory Deduction End-to-End Test (T-008)
**Risk:** Food cost reports will be wrong if deduction paths are broken.
**Test:** Place real orders with items that have linked ingredients, then verify stock levels decreased correctly. Check:
- Path A (ModifierInventoryLink) vs Path B (Modifier.ingredientId fallback)
- Lite/Extra/No multipliers
- Pour size multipliers on liquor items

---

## 🔴 P1 — Critical (First Sprint After Go-Live)

### P1-01 — Fix Partial Payment Approval Flow (T-079)
**Issue:** "Accept Partial" button in PaymentModal doesn't advance past modal.
Also: false-positive partials when requested == approved amount.
**Files:** `PaymentModal.tsx`, `useDatacap.ts`, `/api/orders/[id]/pay`
**Fix needed:**
1. Tolerance check < $0.01 → full approval, no partial modal
2. "Accept Partial" → record partial amount, show remaining balance, prompt second method
3. "Void & Retry" → call Datacap VOID on partial auth, then restart payment flow

---

### P1-02 — House Accounts: Wire into POS Payment Flow
**Status:** Schema + API built. Admin page exists at `/settings/house-accounts`.
**What's missing:** PaymentModal doesn't offer "Charge to House Account" as a payment method.
**Build:**
1. Add "House Account" option to PaymentModal payment method selector
2. Lookup customer's linked house account on order load
3. Check available credit before charging
4. Route to `/api/house-accounts/[id]/charge` on payment
5. Manager approval flow (if account has `requiresApproval` flag)
6. Receipt shows "Charged to House Account: [name]"

---

### P1-03 — House Accounts: Accounts Receivable + Aging Report
**Build:**
- Report showing all open balances grouped by account
- 30/60/90-day aging buckets
- "Record Payment" button per account (cash/check received)
- Statement print/email per account

---

### P1-04 — Stale Order EOD Cleanup (T-077)
**Issue:** 54 orphaned $0 draft orders in DB from draft pre-creation feature.
**Build:**
1. `POST /api/system/cleanup-stale-orders` — close all $0 draft orders older than 4 hours
2. Wire into EOD cron (4 AM daily)
3. Admin UI: `/settings/orders` — "Stale Orders Manager" table with manual resolve option (T-078)

---

### P1-05 — Verify Socket Layer on Docker (T-046)
**Issue:** Socket.io only fully runs in production Docker environment.
**Test:** Cross-terminal order updates, entertainment status, no double-refresh, all socket events fire.
**Risk:** Real venue needs real multi-terminal validation before trusting socket reliability.

---

### P1-06 — Auth Store Persistence Verification (T-053)
**Issue:** `partialize` in `auth-store.ts` should persist across page refreshes.
**Test:** Login → refresh page → verify still logged in on all admin views.
**Hydration guard:** Confirm guard is in place on all authenticated pages (currently only on `/orders`).

---

### P1-07 — Card Token Persistence Test (T-026)
**Blocks:** All of Skill 228 (Loyalty Program).
**Test:** Run live payment with real Datacap hardware. Swipe same card twice. Verify processor returns identical token both times.
**If tokens match:** Proceed to Loyalty Phase 2.
**If tokens don't match:** Revisit loyalty architecture (email-based vs token-based).

---

## 🟠 P2 — Important (Weeks 2–4)

### DISCOUNTS

#### P2-D01 — Item-Level Discounts
**Current:** Only check-level (OrderDiscount) exists. No OrderItemDiscount model.
**Build:**
1. Add `OrderItemDiscount` model to schema (amount, percent, reason, appliedBy, discountRuleId)
2. `POST /api/orders/[id]/items/[itemId]/discount` route
3. Discount button on individual item rows in OrderPanel
4. Discount shows as line below item price with strikethrough
5. Discount reversal on comp/void

#### P2-D02 — Employee Discount UX
**Current:** Can be built via DiscountRule with `requiresApproval: true` and naming convention.
**Gap:** No dedicated "Employee Discount" button or employee-triggered flow.
**Build:**
1. DiscountRule with `isEmployeeDiscount: true` flag (new field)
2. Employee discount auto-applied when logged-in employee makes an order for themselves
3. Or: Explicit "Employee Discount" button in DiscountModal that skips manager approval for eligible employees (role-based)
4. Report: Employee discount usage by employee, by day

#### P2-D03 — Discount + Void/Refund Interaction
**Gap:** When a discounted order is voided or refunded, is the discount reversed correctly?
**Test & fix:** Verify discount amount correctly excluded from refund total. Refund should return what customer actually paid, not the pre-discount total.

#### P2-D04 — Discount on Receipt
**Check:** Does OrderDiscount appear as a separate line item on printed receipt?
**Fix if not:** Add discount line to `lib/escpos/receipt-builder.ts`

---

### BOTTLE SERVICE

#### P2-B01 — Wire Bottle Service Tab Workflow
**Current:** BottleServiceTier model exists (deposit, minimumSpend, autoGratuityPercent). UI components exist.
**Gap:** No automated workflow that:
1. Opens bar tab with deposit pre-auth on tier selection
2. Tracks minimum spend progress
3. Auto-applies auto-grat % at checkout
4. Alerts when approaching deposit limit (auto-increment)
**Build:** Connect tier selection → pre-auth for depositAmount → track spend → apply autoGratuityPercent at close

#### P2-B02 — Bottle Service Floor Plan Integration
**Build:** Assign bottle service tier to a table/section on floor plan. Table badge shows tier color. Minimum spend progress bar on table card.

#### P2-B03 — Bottle Service Reservation Workflow
**Build:** Allow booking a bottle service reservation (date, time, section, tier, guest count, deposit taken). Wire to Reservations system.

---

### PAYMENTS

#### P2-P01 — Split Payments (Multiple Methods, One Order)
**Current:** Not built. Order has one Payment record.
**Schema change:** Order → Payment[] (one-to-many)
**Build:**
1. Migrate Payment to allow multiple per order
2. Track `Order.paidAmount` (running total of what's been paid)
3. PaymentModal: "Charge $X to card, remaining $Y to cash" flow
4. `POST /api/orders/[id]/pay-additional` for second+ payment method
5. Order closes when paidAmount >= total

#### P2-P02 — Refund vs Void UX Distinction
**Current:** No visual distinction — both called "void" in UI.
**Build:**
1. Check Payment.settledAt status: if settled → show "Refund" button; if not → show "Void" button
2. Partial refund: "Refund $X of $Y" input with validation
3. Refund reason tracking (separate from VoidLog — add RefundLog model)
4. Refund receipt prints automatically
5. Refund audit: who, when, amount, reason

#### P2-P03 — Batch Close Admin UI
**Current:** `/api/datacap/batch` route exists. No admin UI.
**Build:** Add "Close Batch" section to `/settings/payments` with:
- Current batch summary (item count, total amount)
- "Close Batch" button with confirmation dialog
- Last batch close timestamp

#### P2-P04 — Tip Adjustment Report (T-022)
**Build:** Admin report at `/reports/tip-adjustments`:
- List today's payments with RecordNo and tip amount
- Editable tip column (calls `/api/datacap/adjust`)
- Filter by date range
- Export to CSV

---

### REPORTS

#### P2-R01 — Closed Orders Management UI
**Current:** `GET /api/orders/closed` exists. No admin UI.
**Build:** `/settings/orders/closed` page:
- Search by date, server, table, order type
- View full order detail
- Reopen order (with reason, manager PIN)
- Receipt reprint button
- Tip adjustment from order detail

#### P2-R02 — Labor Cost % in Reports
**Build:** Add labor cost % to daily/shift reports:
- Clock-in/out times → hours worked per employee
- Hourly rate × hours = labor cost
- Labor cost / sales revenue = labor %
- Target range benchmarks (e.g., 20-30%)

#### P2-R03 — Hourly Sales Breakdown
**Build:** `/reports/hourly` — bar chart of sales by hour of day. Helps identify rush periods, staffing needs.

---

### HARDWARE

#### P2-H01 — Print Routing Phase 3 (Skill 103)
**File:** `src/app/api/print/kitchen/route.ts`
**Build:** Update kitchen print dispatch to:
1. Check PrintRoutes by priority first
2. Check `Modifier.printerRouting` per-modifier (follow/also/only)
3. Apply RouteSpecificSettings formatting
4. Group items by destination printer, build one ticket per printer
5. Failover to backup printer on timeout
6. Log all print jobs to PrintJob model

#### P2-H02 — Modifier-Only Ticket Context Lines (Skill 212)
**When:** Modifier.printerRouting = "only" routes to different printer than item.
**Build:** Add "FOR: {item name}" header line to modifier-only kitchen tickets.

#### P2-H03 — Wire CFD (Customer-Facing Display) Socket Events (T-018)
**File:** `src/app/(cfd)/cfd/page.tsx`
**Build:** Wire Socket.io events:
- `cfd:show-order` → display current order summary
- `cfd:payment-started` → show payment screen
- `cfd:tip-prompt` → show tip selection
- `cfd:receipt-sent` → show thank you screen
- CFD device pairing (T-024) — assign CFD to specific terminal

#### P2-H04 — Mobile Bartender Tab Sync (T-019)
**File:** `src/components/mobile/MobileTabActions.tsx`
**Build:** Wire real socket events: `tab:close-request`, `tab:closed`, `tab:items-updated`

#### P2-H05 — Pay-at-Table Socket Sync (T-020)
**File:** `src/app/(pos)/pay-at-table/`
**Build:** Emit socket event to POS terminal when payment completed so bar tab closes on all surfaces.

---

### EMPLOYEES

#### P2-E01 — Bar Tab Settings Admin UI
**Current:** `barTabSettings` in `src/lib/settings.ts` — tip buffer %, card requirements, timeout.
**Gap:** No `/settings/bar-tabs` UI to configure these.
**Build:** Settings page with:
- Minimum card authorization amount
- Tip buffer % for incremental auth
- Auto-increment threshold (e.g., 80% of hold)
- Tab timeout (auto-close after X hours of inactivity)

#### P2-E02 — Mobile Device Authentication (T-025)
**Current:** `/mobile/tabs` uses `?employeeId` query param (insecure).
**Build:** PIN-based session for mobile:
1. `RegisteredDevice` + `DeviceSession` models
2. Mobile device pairing flow (QR code or code entry)
3. 8-hour session cookie on mobile

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
| 🚨 Go-Live Blockers | 8 | 1–2 weeks |
| 🔴 P1 Critical | 7 | 2–3 weeks |
| 🟠 P2 Important | 18 | 4–6 weeks |
| 🟡 P3 Polish | ~20 | 2–3 months |
| 🟢 Future Roadmap | 7+ | Ongoing |

**Minimum to open first real venue:** Complete all 8 Go-Live Blockers + P1-01 (partial payment fix) + GL-06 (run pre-launch tests). Estimated: **2–3 weeks of focused work.**

---

*Last updated: 2026-02-20 — Generated from full 4-agent codebase audit*
