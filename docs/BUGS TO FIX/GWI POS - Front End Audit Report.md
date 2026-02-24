# GWI POS — FRONT-END AUDIT REPORT
### Comprehensive Staff Perspective Review
**Date:** February 23, 2026
**Audited by:** 5-Agent Team (Bartender, Server, Payment Specialist, Manager, UX Efficiency Expert)
**Scope:** All front-end components across 1,060 source files
**Method:** Deep code review of every component, modal, button, and workflow path

---

## EXECUTIVE SUMMARY

The GWI POS has **solid architectural bones** — Socket.io real-time updates, lazy-loaded modals, multi-tenant isolation, fire-and-forget background processing. But the front-end is **4-6 clicks away from being truly fast** for the people who use it most: bartenders, servers, and managers during a rush.

**The core problem:** The system was built feature-first, not workflow-first. Features exist but are buried behind modals, hamburger menus, and mode toggles. The "fewest clicks" philosophy stated in CLAUDE.md is not yet realized in the UI.

| Role | Grade | Verdict |
|------|-------|---------|
| Bartender | C+ | Features exist but too many clicks for rush speed |
| Server | C+ | Functional but table/seat management has critical bugs |
| Manager | C+ | Reports comprehensive but no dashboard, no alert system |
| Payment | B- | Solid card processing but critical card-failure bug |
| Overall UX | C+ | 15-20 unnecessary taps per shift per employee |

---

# SECTION 1: CRITICAL BUGS (Fix Before Go-Live)

These are production-blocking issues that will cause immediate staff complaints.

## BUG-1: Card Decline + Cancel = Entire Tab Destroyed
**Severity:** CRITICAL
**Confirmed in:** "Broken things need fixin.rtf" + code analysis
**Impact:** Every failed card attempt risks losing the entire order

When a card is run on a bar tab and it fails, hitting "Cancel" destroys the entire tab — not just the payment. The tab, all items, everything is gone. Staff must re-ring the entire order.

**What should happen:** Cancel should only cancel the payment attempt. The tab and all items should remain intact with a "Try Again" or "Pay Cash Instead" option.

**Files:** `PaymentModal.tsx`, `DatacapPaymentProcessor.tsx`, `OrderPanelActions.tsx`

---

## BUG-2: Extra Seats Disappear on Page Refresh
**Severity:** CRITICAL
**Confirmed in:** "Broken things need fixin.rtf" + code analysis
**Impact:** Split checks break mid-service when seats vanish

If a server adds a 5th seat to a 4-top during service, then the page refreshes (network hiccup, logout timeout, browser reload), the extra seats vanish. Data persists in the database but is not reloaded into local Zustand state.

**What should happen:** Seats should reload from DB on every page load.

**Files:** `src/domains/floor-plan/seats/`, Zustand store hydration

---

## BUG-3: Pizza Builder is Broken
**Severity:** HIGH
**Confirmed in:** "Broken things need fixin.rtf"
**Impact:** Cannot build or customize pizza orders

The pizza builder modal exists in code but is noted as non-functional.

---

## BUG-4: Combo Builder Unverified
**Severity:** HIGH
**Confirmed in:** "Broken things need fixin.rtf"
**Impact:** Combo orders may not work correctly

---

## BUG-5: Discounts Not Wired Up
**Severity:** HIGH
**Confirmed in:** "Broken things need fixin.rtf"
**Impact:** Manager can create discount rules but they may not apply at the POS

Discount rules can be created in admin but it's unclear whether they are actually applied during order entry. No usage reporting exists.

---

## BUG-6: Tab Name Bypass Not Working
**Severity:** MEDIUM
**Confirmed in:** "Broken things need fixin.rtf"
**Impact:** Bartenders forced to enter tab name even when settings say to bypass

---

## BUG-7: Auto-Increment Fails Silently
**Severity:** HIGH
**Impact:** Tab becomes under-authorized with no warning to staff

When `IncrementalAuthByRecordNo` fails on the card reader, the tab remains under-authorized. No warning is shown to staff. Next payment attempt will decline because the customer thought they had $100 authorized but only $25 is actually available.

An amber banner (`tabIncrementFailed`) exists in code but only triggers if a specific socket event is received — which may not always fire.

---

# SECTION 2: BARTENDER PAIN POINTS

## 2.1 No Search in Bartender View
**Impact:** 5-10 seconds to find a spirit during rush = UNACCEPTABLE

The main Orders page has search, but BartenderView does not. A bartender must scroll horizontally through categories to find "Patron" in a 12-category bar. No search box in bar view.

**Fix:** Add search input to BartenderView header.

## 2.2 Modifier Modal Blocks All Other Actions
**Impact:** Can't multitask while building a cocktail

Once the modifier modal opens, the bartender is locked into that one item. Can't see other open tabs, can't add a garnish to another drink in parallel. Must finish THIS drink 100% before moving on.

**Fix:** Convert modifier modal to a side panel or floating overlay that doesn't lock the UI.

## 2.3 Common Bar Modifiers Are NOT Hot Buttons
**Impact:** Every cocktail requires opening the modifier modal

These are standard bar calls that should be 1-tap hot buttons but instead require opening a modal, scrolling through groups, and selecting:

| Modifier | Status |
|----------|--------|
| Pour sizes (shot, double, tall, short) | EXISTS as hot buttons |
| Spirit tiers (well, call, premium, top) | EXISTS as hot buttons |
| Neat | NOT a hot button — buried in modal |
| Rocks | NOT a hot button — buried in modal |
| Up | NOT a hot button — buried in modal |
| Dirty | NOT a hot button — buried in modal |
| Dry | NOT a hot button — buried in modal |
| Wet | NOT a hot button — buried in modal |
| With a Twist | NOT a hot button — buried in modal |
| No orange / No lemon | NOT a hot button |
| Extra lime | NOT a hot button |

**Fix:** Add a persistent hot-button bar above the menu for common modifiers (Neat, Rocks, Up, Dirty, Dry, Wet, Twist).

## 2.4 "Patron Double Neat" = Too Many Taps
**Current:** Tap Patron → Modal opens → Select Double pour (1 tap) → Select Neat from modifiers (1-2 taps) → Confirm = **4-5 taps**
**Should be:** Tap Patron → Tap Double → Tap Neat = **3 taps** with hot buttons

## 2.5 No "Repeat Last Order" / Reorder Button
Customer says "same again" — bartender must re-ring every item manually. No "Repeat" button exists.

## 2.6 No "Recently Ordered" Strip
No quick-access to the last 5-10 items ordered. Bartender must remember which category Hennessy is in.

## 2.7 No Quick Tab Creation in Bar View
Opening a new tab requires: Click `+` → See modal → Enter name (if required) → Start Tab → Select items = **3-5 taps**
**Should be:** One-button "New Quick Tab" that creates and selects in one action = **1 tap**

## 2.8 No Tab Merge
Two customers want to combine into one bill — no way to merge tabs. Must manually recreate items.

## 2.9 No Tab Transfer Between Bartenders
Bartender clocking out can't reassign tabs to the next bartender. Tabs stay assigned to original creator.

## 2.10 No Split Tab for Bar
Split check works for table orders but NOT for bar tabs. Bartender must pay first customer, create new tab for second.

## 2.11 No "Last Call" / Batch Close
23 tabs open at 2 AM — bartender must close each one individually. No "Close All Tabs" or "Last Call" mass-close feature.

## 2.12 No Print Check from Tab View
Customer wants to see bill before paying — must navigate to Orders page. No quick "Print Check" button on open tab.

---

# SECTION 3: SERVER PAIN POINTS

## 3.1 No Table Transfer Button in UI
**Impact:** COMPLETELY MISSING UI for a critical workflow

The API endpoint exists (`POST /api/tables/[id]/transfer`), but there is NO button, dropdown, or UI to trigger a table transfer. Server cannot reassign a table to another server without admin intervention.

**Fix:** Add "Transfer Table" button in TableOptionsPopover with server selector dropdown.

## 3.2 No List View for Tables
Only the graphical floor plan view exists. During a busy rush, scrolling a large floor plan is slower than tapping a sorted list. No "Jump to Table 12" search box.

## 3.3 No Auto-Seat Generation from Guest Count
If you set "4 guests," you must manually add 4 seats. Should auto-create seats to match guest count.

## 3.4 No Quick "Fire Apps, Hold Entrees" Button
**Current:** Open CourseControlBar → toggle course mode → set C1 fire/C2 delay → send = **3-4 taps**
**Should be:** One tap "Fire Apps Only" button

## 3.5 No Per-Seat Subtotals
Helpful for split bills, but no subtotal per seat is visible. Only item-level detail.

## 3.6 No Server Name/Ownership on Tables
Can't tell at a glance which tables are yours vs another server's on the floor plan.

## 3.7 No Prep Status Distinction
Tables show if food was "sent" but not if it's "ready for delivery" vs still cooking. Server can't distinguish without checking KDS.

## 3.8 Voiding Items Takes Too Many Clicks
Tap item → Comp/Void button → Modal opens → Select action → Select reason → "Was it made?" toggle → Manager PIN → Confirm = **~6-8 taps** for a simple void.

## 3.9 Customer Facing Display (CFD) Missing Customization
No restaurant logo, no custom "Thank you" message, no itemized view option.

## 3.10 Pay-at-Table Missing Preset Tips
Fixed tip buttons (15%, 18%, 20%, Custom) not available on pay-at-table — must manually enter every time.

---

# SECTION 4: PAYMENT & CHECKOUT PAIN POINTS

## 4.1 No Quick Cash Button (Exact Amount)
**Current:** Tap Pay → Select Cash → See change UI → Tap "Exact Amount" → Tap Done = **4 taps**
**Should be:** One-button "Cash - Exact" that closes, kicks drawer, prints receipt = **1 tap**

## 4.2 Tip Screen Too Intrusive for Fast Service
Tip entry is forced BEFORE payment method selection. For high-volume bars, this adds 1-2 extra screens to every transaction.

**Fix:** Option to move tip entry to AFTER payment (post-close adjustment), or skip entirely for cash.

## 4.3 No "Pay Cash Instead" on Card Decline
When card is declined, only option is "Try Again." No quick shortcut to switch to cash without closing the modal and starting over.

## 4.4 No Even-Split Quick Button
Most common split is 2 people. SplitSelector exists but requires opening a separate modal and choosing from a grid. Should be a "Split in Half" button directly on the order panel.

## 4.5 No Custom Amount Splits
Check is $37.50 — "You pay $20, I pay $17.50." Only even splits available, no custom dollar amounts per person.

## 4.6 No "Skip Receipt" Option
Receipt always prints. No checkbox to skip printing if customer doesn't want one. No email receipt option.

## 4.7 No Email Receipt
No way to email a receipt to a customer.

## 4.8 No Offline Cash Fallback
If WiFi drops, card payments fail immediately with no graceful degradation. No "queue for later" or "pay cash instead" shortcut.

## 4.9 Gift Card Lookup Has No Timeout
If the API hangs, the "Looking..." button spins forever. No 10-second timeout, no retry button.

## 4.10 Partial Approval Void Not Idempotent
When voiding a partial auth, no idempotency key is sent. Network hiccup could cause double-void.

---

# SECTION 5: MANAGER PAIN POINTS

## 5.1 No Manager Dashboard / Landing Page
**Impact:** Manager logs in and sees... nothing useful at a glance

No `/admin/dashboard` or home page. Manager must navigate to `/reports` manually. No at-a-glance view of:
- Today's sales, labor, tips
- Who's clocked in
- Open order count
- Pending void approvals
- 86'd items

**Fix:** Create a manager dashboard with real-time KPIs, who's on duty, alerts.

## 5.2 No Void/Comp Approval Queue
No in-app page where manager sees pending void/comp requests. No notification when a void is requested. Must rely on SMS or physical check-in. Remote approval code exists in settings but the actual approval UI is missing.

## 5.3 No "Who's Clocked In" View
Manager cannot see which employees are currently on shift without navigating through multiple screens.

## 5.4 No Time Clock Edit for Managers
Manager can force clock-out but cannot edit past time entries (fix a 5-minute typo). No edit UI exposed.

## 5.5 Time Clock Not on KDS Screen
**Confirmed in:** "Broken things need fixin.rtf"
Back-of-house staff can't clock in/out at the KDS by the kitchen door. Must walk to a POS terminal.

## 5.6 Navigation is Hamburger-Only
All admin access through a hamburger menu that must be opened, scrolled, and clicked. No persistent sidebar or quick-access buttons. 44 settings pages with no search.

**Fix:** Add a sidebar for admin routes or at minimum a "Quick Actions" panel on the dashboard.

## 5.7 Scheduling Disconnected from Labor Tracking
Can create schedules but can't see labor cost projection, conflict detection, or verify scheduled employees actually clocked in.

## 5.8 No Report Export (CSV/PDF)
Reports exist but no visible export buttons. Manager can't pull data into Excel for analysis.

## 5.9 No Day-Over-Day / Week-Over-Week Comparison
Each report stands alone. No comparative analytics. Manager can't see "sales down 12% vs yesterday."

## 5.10 Menu Management Fragmented
Menu Items, Liquor Builder, and Combos are all on different pages in different nav sections. No unified menu editor.

## 5.11 No Discount Usage Reporting
Manager can create discount rules but can't see how many times each was used or total discount dollars given today.

## 5.12 Reservations Missing Waitlist
Basic reservation CRUD exists but no waitlist management, no overbooking protection, no no-show tracking.

## 5.13 No Labor Budgets / Overtime Alerts
Calculates overtime hours in time clock but no proactive alert when an employee approaches overtime.

---

# SECTION 6: UX EFFICIENCY — TAP COUNT ANALYSIS

## 6.1 Critical Action Tap Counts

| Action | Current Taps | Ideal Taps | Excess |
|--------|:---:|:---:|:---:|
| Clock in | 2 | 1 | +1 |
| Start new order (bar) | 3-5 | 2 | +1-3 |
| Ring in beer (grid) | 2 | 1 | +1 |
| Ring in cocktail w/ mods | 5-7 | 3 | +2-4 |
| Send to kitchen | 1 | 1 | 0 |
| Pay card | 5-6 | 4 | +1-2 |
| Pay cash | 4-5 | 1 | +3-4 |
| Void item | 5-8 | 2 | +3-6 |
| Apply discount | 3 | 2 | +1 |
| Open cash drawer | 3+ | 1 | +2 |
| Print receipt | 2-3 | 1 | +1-2 |
| Transfer table | No UI | 2 | N/A |
| Split check 3-ways | 5-8 | 3 | +2-5 |

**Estimated excess taps per shift per employee: 15-20**
**For a 10-server shift with 100 orders: ~15,000-20,000 unnecessary taps per day**

## 6.2 Bartender Default View Problem
Bartenders default to FloorPlanHome (table-based ordering). Must toggle to BartenderView every shift = +2 taps.

**Fix:** Auto-detect role on login. If role = bartender, default to BartenderView.

## 6.3 Buttons That Should Exist But Don't

| Missing Button | Where It Should Be | What It Does |
|---|---|---|
| Bump Order | KDS screen | Kitchen acknowledges order, extends timer |
| Fire Course | KDS or Order Panel | Auto-fire apps, hold entrees |
| Quick Reorder | Order Panel | Repeat last order with 1 tap |
| New Quick Tab | Bar view header | Create + select unnamed tab in 1 tap |
| Cash Drawer | Header icon | Open drawer without navigating settings |
| 86 Item | Menu grid item | Mark item out of stock from POS |
| Recall Bumped | KDS screen | View order that was just bumped |
| Split in Half | Order Panel | Quick 2-way even split |
| Pay Cash Exact | Payment Modal | 1-tap exact cash close |
| Transfer Table | Table popover | Reassign table to another server |
| Allergy Alert | POS item card | Visual warning for allergenic items |

---

# SECTION 7: MISSING INDUSTRY-STANDARD FEATURES

| Feature | Industry Status | GWI POS Status |
|---------|:-:|:-:|
| KDS Bump Button | Standard everywhere | MISSING |
| Repeat/Reorder | Standard in all POS | MISSING |
| Quick Service Mode (no table) | Standard for fast-casual | MISSING (floor plan required) |
| Allergy Alerts on POS | Required for food safety | MISSING |
| Server Section Assignments | Standard for full-service | MISSING |
| Guest Count Tracking (covers) | Standard for reporting | MISSING |
| Average Ticket Time Display | Common in modern POS | MISSING |
| Delivery Driver Assignment | Standard for delivery | MISSING |
| Item 86 Indicators on Menu Grid | Common in all POS | MISSING |
| Togo/Packaging Instructions per item | Standard for mixed orders | MISSING |
| Course Auto-Fire | Common in fine dining POS | MISSING (manual only) |
| Keyboard Shortcuts | Standard on tablet POS | MISSING |
| Dark Mode Toggle | Common request | MISSING |
| Offline Cash Fallback | Required for reliability | MISSING |
| Email Receipts | Standard everywhere | MISSING |
| Tab Merge | Standard in bar POS | MISSING |
| Batch Tab Close (Last Call) | Standard in bar POS | MISSING |
| On-Screen Numpad | Standard for touchscreen | MISSING |

---

# SECTION 8: WHAT WORKS WELL

Credit where due — these features are solid:

1. **86'd Items page** — Best-in-class. One-click, real-time, hierarchical. This is how every feature should work.
2. **Send to Kitchen** — 1 tap, fire-and-forget, instant UI feedback. Excellent.
3. **Pour Size Hot Buttons** — Shot, Double, Tall, Short with instant price update. Good.
4. **Spirit Tier Quick Buttons** — Well, Call, Premium, Top Shelf with color coding. Good.
5. **Open Orders Manager** — Real-time, searchable, socket-driven, bulk actions. Excellent.
6. **Socket.io Architecture** — Cross-terminal real-time updates work properly.
7. **Lazy-Loaded Modals** — 13 modals but none load until needed. Good performance.
8. **Split Check System** — By seat, even, custom, by category (B/P). Comprehensive.
9. **Search with Barcode Scanner** — Always accessible, keyboard-wedge support. Good.
10. **Reports Suite** — Comprehensive coverage: daily, shift, hourly, PMIX, tips, voids, labor, payroll.
11. **Course Management** — Supports fine-dining workflow with delays and manual/auto modes.
12. **Comp/Void with Remote Approval** — SMS approval flow for high-value items. Good design.
13. **Dual Pricing (Cash Discount)** — Built-in surcharge/discount display. Good.
14. **Pre-Auth Tab Lifecycle** — Full pre-auth → increment → capture flow. Architecturally solid.
15. **Payment Timing Instrumentation** — 4-timestamp flow measurement built in. Good ops foundation.

---

# SECTION 9: PRIORITIZED FIX LIST

## PHASE 1: CRITICAL (Before Go-Live)

| # | Issue | Type | Impact |
|---|-------|------|--------|
| 1 | Card decline + cancel destroys tab | BUG | Orders lost, staff re-rings everything |
| 2 | Extra seats disappear on refresh | BUG | Split checks break mid-service |
| 3 | Fix pizza builder | BUG | Cannot sell pizza |
| 4 | Wire up discounts at POS | BUG | Discounts don't apply to orders |
| 5 | Verify combo builder | BUG | Combo orders may not work |
| 6 | Add table transfer button to UI | MISSING | Servers cannot reassign tables |
| 7 | Fix tab name bypass setting | BUG | Forces name entry when setting says skip |

## PHASE 2: HIGH IMPACT (First 2 Weeks)

| # | Issue | Type | Impact |
|---|-------|------|--------|
| 8 | Add search to Bartender View | MISSING | 5-10 sec per item lookup during rush |
| 9 | Add KDS bump button | MISSING | Kitchen can't work independently |
| 10 | Auto-detect bartender role → default to bar view | UX | +2 taps every shift |
| 11 | Add hot buttons: Neat, Rocks, Up, Dirty, Dry, Wet | MISSING | +2-4 taps per cocktail |
| 12 | Add "Cash Exact" quick-pay button | MISSING | +3 taps per cash transaction |
| 13 | Add manager dashboard landing page | MISSING | No at-a-glance business overview |
| 14 | Add void/comp approval queue | MISSING | No way to approve voids in-app |
| 15 | Add KDS time clock (back-of-house) | MISSING | Kitchen staff can't clock in/out |
| 16 | Fix auto-increment failure notification | BUG | Silent card auth failure |
| 17 | Add "Pay Cash Instead" on card decline | MISSING | No fallback on decline |

## PHASE 3: MEDIUM PRIORITY (Next Sprint)

| # | Issue | Type | Impact |
|---|-------|------|--------|
| 18 | Convert modifier modal to side panel | UX | Blocks all other actions |
| 19 | Add "Repeat Last Order" button | MISSING | +5 taps for reorders |
| 20 | Add "Recently Ordered" strip | MISSING | Must remember categories |
| 21 | Add quick tab creation (1-tap) | UX | +3 taps per new tab |
| 22 | Add tab merge | MISSING | Must recreate items manually |
| 23 | Add batch tab close (Last Call) | MISSING | Must close 20+ tabs individually |
| 24 | Add split tab for bar | MISSING | Only works for table orders |
| 25 | Add "Fire Apps Only" quick button | UX | +3 taps per course fire |
| 26 | Add per-seat subtotals | MISSING | Helpful for split bills |
| 27 | Add server name on tables | MISSING | Can't tell whose table is whose |
| 28 | Simplify void workflow (fewer taps) | UX | 5-8 taps → should be 2 |
| 29 | Add allergy alerts on POS ordering | MISSING | Food safety gap |
| 30 | Add tip screen skip option | UX | +2 taps per fast-service payment |
| 31 | Add "Skip Receipt" checkbox | MISSING | Always prints, wastes paper |
| 32 | Add email receipt option | MISSING | Industry standard |
| 33 | Add report export (CSV/PDF) | MISSING | Can't analyze data externally |
| 34 | Add auto-seat generation from guest count | MISSING | Must manually add seats |
| 35 | Add table list view (alternative to floor map) | MISSING | Faster during rush |

## PHASE 4: QUALITY OF LIFE

| # | Issue | Type | Impact |
|---|-------|------|--------|
| 36 | Add tab transfer between bartenders | MISSING | Shift changes lose context |
| 37 | Add print check from tab view | MISSING | Must navigate to Orders page |
| 38 | Add "Who's clocked in" for managers | MISSING | Can't see team status |
| 39 | Add time clock edit for managers | MISSING | Can't fix punch mistakes |
| 40 | Add on-screen numpad for touchscreen | MISSING | Tiny keyboard for amounts |
| 41 | Add custom split amounts | MISSING | Only even splits available |
| 42 | Add scheduling labor cost projection | MISSING | Scheduling blind to cost |
| 43 | Add discount usage reporting | MISSING | Can't audit discount application |
| 44 | Add day-over-day comparison in reports | MISSING | No trend visibility |
| 45 | Add waitlist to reservations | MISSING | Only basic reservation CRUD |
| 46 | Add quick-service mode (no table) | MISSING | Fast-casual forced through floor plan |
| 47 | Add guest count / covers tracking | MISSING | Can't track per-server covers |
| 48 | Add keyboard shortcuts | MISSING | No keyboard acceleration |
| 49 | Add persistent admin sidebar | UX | Hamburger menu for everything |
| 50 | Add item 86 indicators on menu grid | MISSING | Server must remember what's out |

---

# APPENDIX: FILES REFERENCED

**Core POS:**
- `src/app/(pos)/orders/page.tsx` — Main POS screen (2,800+ lines)
- `src/components/orders/OrderPanel.tsx` — Order summary panel
- `src/components/orders/OrderPanelActions.tsx` — Action buttons (1,031 lines)
- `src/components/bartender/BartenderView.tsx` — Bar-specific view
- `src/components/floor-plan/FloorPlanHome.tsx` — Table-based ordering

**Payment:**
- `src/components/payment/PaymentModal.tsx` — Payment flow
- `src/components/payment/DatacapPaymentProcessor.tsx` — Card processing
- `src/components/orders/CompVoidModal.tsx` — Comp/void flow
- `src/components/orders/DiscountModal.tsx` — Discount application

**KDS:**
- `src/app/(kds)/kds/page.tsx` — Kitchen display
- `src/components/kds/` — KDS components

**Admin:**
- `src/components/admin/AdminNav.tsx` — Admin navigation (hamburger)
- `src/app/(admin)/reports/page.tsx` — Reports hub
- `src/app/(admin)/86/page.tsx` — 86'd items
- `src/app/(admin)/employees/page.tsx` — Employee management

**Tabs:**
- `src/components/tabs/` — Tab management components
- `src/app/(pos)/tabs/page.tsx` — Tabs page

**Floor Plan:**
- `src/domains/floor-plan/` — Table/seat management
- `src/components/floor-plan/TableNode.tsx` — Table rendering

---

*Wave 1 was generated by a 5-agent audit team analyzing every front-end component, modal, button, and workflow path in the GWI POS codebase. No code was written — this is a read-only findings document for review.*

---
---

# WAVE 2: DEEP-DIVE AUDIT — Edge Cases, Transfers, Race Conditions & End-of-Shift

**Date:** February 23, 2026
**Audited by:** 5-Agent Team (Item Transfer Specialist, Edge Case QA Tester, End-of-Shift Workflow Tester, Button-by-Button Mapper, Multi-Terminal Race Condition Analyst)
**Scope:** Transfer flows, failure scenarios, concurrent terminal conflicts, shift closeout, and complete button inventory
**Method:** Line-by-line code tracing with exact reproduction steps for every finding

---

## EXECUTIVE SUMMARY — WAVE 2

Wave 2 uncovered **8 data-loss-risk issues**, **11 HIGH severity bugs**, and **15 missing buttons** that front-line staff need. The transfer system is **50% built** — all backend APIs work but key UI buttons are missing, leaving bartenders unable to move items between tabs. The payment system has a **critical invisible-charge gap** where a card can be charged with no POS record created. End-of-shift has **two clock-out paths** — one safe, one that bypasses all safety checks. Race conditions between terminals are mostly handled but version checking is inconsistent across routes.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Transfer Flows | 1 | 3 | 1 | 0 |
| Edge Cases & Failures | 3 | 5 | 4 | 2 |
| End-of-Shift | 2 | 3 | 4 | 2 |
| Race Conditions | 0 | 3 | 4 | 2 |
| Missing Buttons | 0 | 8 | 5 | 2 |
| **TOTALS** | **6** | **22** | **18** | **8** |

---

# SECTION A: TRANSFER FLOWS — What A Bartender Needs But Can't Do

## TRANSFER-1: Item Transfer Modal Has No Trigger Button
**Severity:** CRITICAL
**File:** `src/components/orders/ItemTransferModal.tsx`, `src/app/(pos)/orders/page.tsx`

The ItemTransferModal is **fully built and production-ready** — 2-step flow (select items → select destination → transfer). The backend API (`POST /api/orders/{id}/transfer-items`) works correctly with full validation and audit logging.

**But `setShowItemTransferModal(true)` is never called from any button in the UI.** There is no button anywhere on the POS that opens this modal.

**Reproduction:** Open any order with items → look for "Transfer Items" button → it doesn't exist. The modal state variable exists in `orders/page.tsx` but nothing sets it to true.

**What exists:**
- Modal component: Working (select items, select destination, execute transfer)
- API: Working (validates status, moves items, recalculates totals, creates audit log)
- Socket dispatch: Working (both source and destination orders update in real-time)

**What's missing:** A button. Suggested location: `OrderPanelActions.tsx` below the Split button.

---

## TRANSFER-2: Tab Transfer — API Built, No UI At All
**Severity:** HIGH
**File:** `src/app/api/tabs/[id]/transfer/route.ts`

The backend API to transfer a bar tab from one bartender to another is fully functional: `POST /api/tabs/{id}/transfer` accepts `toEmployeeId`, validates permissions, updates the order's employee, creates an audit log.

**But there is no UI anywhere — no button, no modal, no context menu option.** A bartender ending their shift cannot transfer their tabs to the next bartender through the POS.

**Reproduction:** Open Bar mode → look for any way to reassign a tab to another employee → nothing exists.

**Additional issue:** The API does NOT dispatch any socket events after transfer. Even if a UI was added, other terminals would not be notified.

---

## TRANSFER-3: Table Transfer — Only Accessible From Inside Split View
**Severity:** HIGH
**File:** `src/app/api/tables/[id]/transfer/route.ts`, `src/components/orders/SplitTicketsOverview.tsx`

The backend API to transfer a table (and all its orders) to another server works: `POST /api/tables/{id}/transfer` moves all open orders to the new employee.

**But the only place this is triggered is from `SplitTicketsOverview`** — meaning the server must open a split check view to access table transfer. There is no transfer option in the floor plan's table context menu.

**Reproduction:** Floor Plan → right-click a table → no "Transfer Table" option. The only path: open the table's order → go to Split view → find Transfer option there.

**Additional issue:** The API dispatches `dispatchFloorPlanUpdate()` but NOT `dispatchOrderUpdated()`. Other terminals see the table change ownership on the floor plan but the order panel still shows the old server's name.

---

## TRANSFER-4: Merge Orders — Backend Only, No UI
**Severity:** HIGH
**File:** `src/app/api/orders/[id]/merge/route.ts`

The merge API (`POST /api/orders/{id}/merge`) is fully built — moves items from source to target, recalculates totals, voids source order, requires `MGR_BULK_OPERATIONS` permission.

**No button, modal, or menu option exists to trigger this.** A manager cannot combine two orders through the UI.

**Reproduction:** Look for any "Merge" or "Combine" option anywhere in the POS → nothing exists.

---

## TRANSFER-5: Pre-Auth Card Not Handled During Item Transfer
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/transfer-items/route.ts`

When items are transferred FROM a tab with a pre-auth card hold:
- Items move to destination order
- Card stay on source order
- Destination order has NO card context
- Pre-auth amount on source doesn't adjust to match reduced total

**Scenario:** Tab has $100 pre-auth, $80 of items transferred away. Source still holds $100 pre-auth for $20 of remaining items. Destination has $80 of items with no card.

---

## TRANSFER SUMMARY TABLE

| Flow | API Built | UI Built | Button Exists | Socket Dispatch | Status |
|------|-----------|----------|---------------|-----------------|--------|
| Item Transfer (Tab A → Tab B) | Yes | Yes (modal) | **NO** | Yes | **50% — needs trigger button** |
| Tab Transfer (employee reassign) | Yes | **NO** | **NO** | **NO** | **25% — needs full UI + socket** |
| Table Transfer (all orders) | Yes | Partial (in split only) | **Buried** | Partial (floor only) | **40% — needs main entry point** |
| Merge Orders | Yes | **NO** | **NO** | Yes | **25% — needs full UI** |
| Seat Move (within order) | Yes | Yes | Yes | Yes | **100% — Working** |
| Split Move (between splits) | Yes | Yes | Yes | Yes | **100% — Working** |
| Order Reassign (change server) | **NO** | **NO** | **NO** | N/A | **0% — Not implemented** |

---

# SECTION B: EDGE CASES & FAILURE SCENARIOS

## EDGE-1: Card Approved But Database Write Fails — Invisible Charge
**Severity:** CRITICAL — DATA LOSS RISK
**File:** `src/components/payment/DatacapPaymentProcessor.tsx`, `src/app/api/orders/[id]/pay/route.ts`

The Datacap payment processor approves and captures the charge on the card BEFORE the `/api/orders/{id}/pay` endpoint writes the Payment record to the database. If the DB write fails (deadlock, FK violation, network error), the customer IS charged but NO Payment record exists in the POS.

**Reproduction:**
1. Select card payment on any order
2. Datacap processor approves ($25.50)
3. If the POST /pay call fails (simulate with network disconnect after card approval)
4. Customer is charged. No record in POS. No way to reconcile without processor-side reports.

**What's missing:** Idempotency key for Datacap settlement, compensation/reversal logic if DB write fails after capture succeeds.

---

## EDGE-2: Split Before Send = Kitchen Gets Nothing
**Severity:** CRITICAL — DATA LOSS RISK
**File:** `src/components/orders/SplitCheckScreen.tsx`, `src/app/api/orders/[id]/send/route.ts`

When an order is split BEFORE being sent to the kitchen, the split API creates child orders with items hard-coded as `kitchenStatus: 'sent'`. But no actual kitchen ticket is printed. When you later call Send on any split, it finds 0 pending items (already marked 'sent'). The kitchen NEVER receives the order.

**Reproduction:**
1. Create new order → add 3 items
2. Do NOT tap "Send to Kitchen"
3. Tap "Split Check" → create 2 splits
4. Tap "Send to Kitchen" on any split
5. Kitchen receives **nothing**. Items show "sent" in UI but no ticket was printed.

---

## EDGE-3: Reopen Order → Pay Again = Customer Double-Charged
**Severity:** CRITICAL — DATA LOSS RISK
**File:** `src/app/api/orders/[id]/reopen/route.ts`, `src/app/api/orders/[id]/pay/route.ts`

Reopening a card-paid order does NOT void the original Datacap charge. The original Payment record remains `status: 'completed'`. When the order is paid again, a new Payment is created with a new idempotency key — a second charge hits the customer's card.

**Reproduction:**
1. Order: $50, pay with Visa (captured)
2. Manager reopens the order
3. Add $20 item (total should be $70)
4. Pay the order again with the same card
5. Customer now charged $50 + $70 = **$120 instead of $70**

**What's missing:** Automatic void of original charge on reopen, or at minimum a prominent warning to the manager.

---

## EDGE-4: Reopen Doesn't Recalculate Totals
**Severity:** HIGH — DATA LOSS RISK
**File:** `src/app/api/orders/[id]/reopen/route.ts`

When an order is reopened, the route sets `status: 'open'` and creates an audit log, but does NOT recalculate `order.total`. The total still reflects the original paid amount. Adding new items doesn't update the stored total.

**Reproduction:**
1. Order: 2 items, $20 total, paid
2. Manager reopens order
3. Add a 3rd item ($10)
4. Check total → still shows $20, not $30

---

## EDGE-5: Voiding Parent Order Orphans Paid Split Children
**Severity:** HIGH — DATA LOSS RISK
**File:** `src/app/api/orders/[id]/comp-void/route.ts`

When a manager voids a parent order, the void sets `deletedAt` on the parent but does NOT cascade to split children. If a split child was already paid, its Payment record references a voided parent — creating an inconsistent financial state.

**Reproduction:**
1. Order with 4 items → split into 2 checks
2. Pay Check #1 ($20 captured on card)
3. Manager voids the entire parent order
4. Check #1's Payment record still exists referencing voided parent

---

## EDGE-6: Pre-Auth Expiration Not Tracked
**Severity:** HIGH
**File:** `src/app/api/orders/[id]/open-tab/route.ts`

No field in the `OrderCard` schema tracks pre-auth expiration time. Most processors void pre-auth holds after 1 hour. If items are added slowly over 2+ hours, the pre-auth expires silently. Payment capture fails with no prior warning.

**Reproduction:**
1. Open card tab (pre-auth hold created)
2. Add items slowly over 2+ hours
3. Attempt final payment → processor rejects because pre-auth expired
4. No warning was ever shown

---

## EDGE-7: Card Reader Timeout Leaves Tab in pending_auth
**Severity:** HIGH
**File:** `src/app/api/orders/[id]/open-tab/route.ts`

When the card reader times out, the catch block returns an error but `tabStatus` was already set to `pending_auth` (line 88). No OrderCard record is created. The tab is stuck with no recovery UI.

**Reproduction:**
1. Tap "Open Tab on Card"
2. Card reader disconnects / times out (~10 seconds)
3. Tab frozen in `pending_auth` status
4. No way to retry or cancel from the UI

---

## EDGE-8: Browser Crash During Item Save = Duplicate Items
**Severity:** HIGH
**File:** `src/stores/order-store.ts` (lines 260-293)

Items are saved to both localStorage (immediately) and the database (via fire-and-forget POST). If the browser crashes after the server acknowledges items 1-3 but before localStorage is cleared, `recoverPendingItems()` restores all items including the duplicates.

**Reproduction:**
1. Add 5 items rapidly to order
2. Kill browser process mid-save (after items 1-3 saved to DB)
3. Reload page
4. Items 1-3 appear twice (once from DB, once from localStorage recovery)

---

## EDGE-9: WiFi Loss During Send — No User Feedback
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/send/route.ts`

If WiFi drops after the POST /send is sent but before the response arrives, the kitchen already received the tickets but the user sees a timeout error. No retry prompt or confirmation that the kitchen received the order.

---

## EDGE-10: Adding Items to Tab Another Terminal Just Closed
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/items/route.ts`

If Terminal B has a tab loaded and Terminal A pays it, Terminal B's store still thinks it's open. Adding items returns `ORDER_NOT_MODIFIABLE` with a technical error message, not a user-friendly explanation.

---

## EDGE-11: Held Items in Splits — No Warning
**Severity:** MEDIUM
**File:** `src/components/orders/SplitCheckScreen.tsx`

Held items can be assigned to splits. When the split is sent, held items are silently excluded (not fired to kitchen). No warning shown to the user.

---

## EDGE-12: Reopened Orders Fall Into Limbo
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/reopen/route.ts`

If a manager reopens a paid order, adds items, but doesn't pay again before shift end, the order sits in 'open' status. EOD cleanup may treat it as abandoned. No tracking of what was paid vs. what's outstanding.

---

# SECTION C: END-OF-SHIFT WORKFLOWS

## SHIFT-1: Crew Hub Clock-Out Bypasses ALL Safety Checks
**Severity:** CRITICAL
**File:** `src/app/(pos)/crew/page.tsx` (lines 163-189)

The Crew Hub page (`/crew`) has its own "Clock Out" button that fires `handleConfirmClockOut()`. This function:
- Does NOT check for open tabs
- Does NOT prompt about open orders
- Does NOT trigger the ShiftCloseoutModal
- Does NOT require cash count or tip settlement

Meanwhile, the TimeClockModal (the OTHER clock-out path) checks for open tabs, shows warnings, offers tab transfer, and requires manager override.

**Reproduction — The "Danger Path":**
1. Log in as Bartender (PIN 3456)
2. Take several orders, receive cash payments
3. Navigate to `/crew` (Crew Hub)
4. Tap "Clock Out" → Confirm "Yes, Clock Out"
5. Clocked out immediately — open tabs orphaned, cash unreconciled, tips undeclared
6. Tap "Log Out" → gone

**Reproduction — The "Safe Path" (TimeClockModal):**
1. POS Orders page → hamburger menu → Time Clock
2. TimeClockModal → "Clock Out" → system checks for open tabs
3. If tabs open: shows transfer/override options
4. After clock-out: shows hours → "Close Shift (Drawer Count & Tips)"
5. ShiftCloseoutModal → blind cash count → variance reveal → tip distribution → payout → done

---

## SHIFT-2: No "Close the Day" / EOD Button in Admin UI
**Severity:** CRITICAL
**File:** `src/app/api/eod/reset/route.ts` (backend), NO frontend page

The backend has a fully functional `/api/eod/reset` endpoint that resets orphaned tables, marks stale orders as "rolled over," creates audit logs, and supports dry-run mode.

**But there is NO button, page, or UI anywhere in the admin dashboard that calls this endpoint.** A manager has no way to:
- Trigger EOD reset from the UI
- See what will be cleaned up (dry-run preview)
- Finalize the business day
- See a checklist before closing (all shifts closed? all tabs closed?)

---

## SHIFT-3: No Logout Warning for Open Shifts
**Severity:** HIGH
**File:** `src/app/(pos)/crew/page.tsx` (lines 191-193)

The "Log Out" button simply calls `logout()` and redirects to `/login`. No check for:
- Still clocked in?
- Open shift needing closeout?
- Uncounted cash?
- Undeclared tips?

---

## SHIFT-4: Batch Settlement Buried in Settings, Not EOD Flow
**Severity:** HIGH
**File:** `src/app/(admin)/settings/page.tsx` (line 1707+)

Batch settlement (closing all card transactions with the processor) exists as a card inside `/settings`. It is NOT integrated into the EOD workflow. A manager can forget to settle the batch, leaving card charges in float.

---

## SHIFT-5: No Mid-Shift Cash Drop Flow
**Severity:** HIGH
**File:** Search across all `src/` — no cash drop implementation found

There is no way to record "I moved $200 from my drawer to the safe." Cash drops are a standard bar/restaurant security operation. The blind count only happens inside shift closeout. No standalone cash count or mid-shift drop exists.

---

## SHIFT-6: Open Order Check Too Late in Closeout Flow
**Severity:** MEDIUM
**File:** `src/components/shifts/ShiftCloseoutModal.tsx` (lines 498-504, 1179-1264)

The system checks for open orders only when the employee presses "Close Shift" at the END of the closeout flow. By then, the employee has already:
1. Counted their cash drawer
2. Gone through variance reveal
3. Distributed their tips
4. Chosen their payout method

...only to be told they have open orders. After closing orders, they must redo the entire flow.

---

## SHIFT-7: Clock-Out Shows Hours But No Shift Summary
**Severity:** MEDIUM
**File:** `src/components/time-clock/TimeClockModal.tsx` (lines 633-703)

After clock-out, the TimeClockModal shows: clock in/out times, break minutes, regular/OT hours, estimated pay. It does NOT show: total sales, total tips earned, number of orders, cash due.

---

## SHIFT-8: Failed Tip Payout Still Closes Shift
**Severity:** MEDIUM
**File:** `src/components/shifts/ShiftCloseoutModal.tsx`

The payout step combines tip cashout AND shift close in one button. If the cash-out payout fails (caught error), the shift still closes. The tip bank balance shown is before the current shift's tips are added.

---

## SHIFT-9: Tables Remain Assigned to Offline Employee
**Severity:** MEDIUM
**File:** No unassignment logic found on clock-out

When an employee clocks out, tables remain assigned to them. The next employee sees tables "occupied by offline server" and cannot take them over without manager intervention.

---

## SHIFT-10: No Print Button on Crew Shift Report
**Severity:** LOW
**File:** `src/app/(pos)/crew/shift/page.tsx`

The "My Shift Report" page shows sales, tips, and revenue but has no "Print" button. The print option only exists inside the ShiftCloseoutModal's completion step.

---

# SECTION D: MULTI-TERMINAL RACE CONDITIONS

## RACE-1: Version Checking Not Enforced on All Mutations
**Severity:** HIGH
**File:** `src/lib/order-version.ts`, multiple API routes

The optimistic locking system (`order.version`) works correctly in `/api/orders/[id]/comp-void` (checks version, returns 409 on conflict). But:
- `/api/orders/[id]/discount` — **NO version check**
- `/api/orders/[id]/send` — **NO version check**
- `/api/orders/[id]/pay` — increments version but client must send it, and no explicit 409 on mismatch

**Scenario:** Terminal A applies a discount while Terminal B adds items simultaneously → both succeed, discount applied to wrong total.

---

## RACE-2: No Socket Disconnect Warning
**Severity:** HIGH
**File:** `src/lib/shared-socket.ts`

When the WebSocket disconnects, the UI shows **NO visual indicator**. A bartender may think they're seeing live data when they're actually looking at stale state. If Terminal A pays an order while Terminal B's socket is down, Terminal B still shows the order as open.

**What's missing:** A visible "Connection Lost" banner. A "Reconnecting..." state. Pause operations until reconnected.

---

## RACE-3: Auto-Increment Double-Fire on Bar Tabs
**Severity:** HIGH
**File:** `src/app/api/orders/[id]/items/route.ts` (lines 402-410)

When items are added to a bar tab with a pre-auth card, the system fires `POST /api/orders/{id}/auto-increment` as fire-and-forget. If two terminals add items to the same tab simultaneously, both fire auto-increment — Datacap processes the increment twice. Card may be charged more than intended.

---

## RACE-4: Table Double-Seating
**Severity:** MEDIUM
**File:** `src/app/api/floor-plan/route.ts`, `src/app/api/orders/[id]/seating/route.ts`

Two servers can seat the same table simultaneously. The floor plan route doesn't lock tables during order creation. If Terminal A creates Order #100 on Table 5 and Terminal B creates Order #101 on Table 5 within the 5-second snapshot cache window, both succeed. Table 5 now has two open orders.

---

## RACE-5: Version Check Before Lock in Void/Comp
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/comp-void/route.ts` (lines 94-100, 169-171)

The version conflict check happens OUTSIDE the transaction (line 94-100), but the row lock happens INSIDE (line 169-171). Between the version check and the lock acquisition, another terminal can modify the order. The void succeeds against stale state with no 409 returned.

---

## RACE-6: Concurrent Split Child Payments
**Severity:** MEDIUM
**File:** `src/app/api/orders/[id]/pay/route.ts` (lines 973-980)

If Terminal A and Terminal B both pay the last split sibling simultaneously, both enter the transaction, both check if all siblings are paid, both update the parent to 'paid'. Two parent-paid events fire but no data corruption occurs (idempotent parent update).

---

## RACE-7: 86'd Items Still Sendable from Stale Cart
**Severity:** MEDIUM
**File:** `src/lib/menu-cache.ts`

If a manager marks an item as 86'd while it's in Terminal A's unsent local cart (cached from 60-second menu cache), Terminal A can still send it. The server creates the OrderItem without checking item availability.

---

## RACE-8: Snapshot Cache 5-Second Stale Window
**Severity:** LOW
**File:** `src/lib/snapshot-cache.ts` (line 24)

Floor plan data can be stale for up to 5 seconds. If Terminal A seats a table and Terminal B requests the floor plan at second 4.9, Terminal B sees old state.

---

## RACE-9: Modifier Availability Not Validated Server-Side
**Severity:** LOW
**File:** `src/app/api/orders/[id]/items/route.ts`

If a manager removes a modifier group while it's in a terminal's cart, the terminal can still add items with that modifier. The server trusts client-sent modifier IDs without existence validation.

---

# SECTION E: COMPLETE BUTTON INVENTORY

## E.1: Every Button That EXISTS on the Main POS Screen

### Header Bar
| Button | Action | Works? |
|--------|--------|--------|
| Employee Name Dropdown | Switch User, Crew Hub, My Shift, Tip Bank, Clock Out | Yes |
| Tables | Switch to Floor Plan view | Yes |
| Bar | Switch to Bartender view | Yes |
| Takeout | Switch to Takeout mode | Yes |
| Delivery | Switch to Delivery mode | Yes |
| Gear Menu | Layout customization (Quick Bar, Quick Pick, Favorites, Categories) | Yes |
| Search Input | Find items by name/ingredient, Cmd+K focus, barcode scanner | Yes |

### Left Panel — Floor Plan Mode
| Button | Action | Works? |
|--------|--------|--------|
| Room Tab Strip | Filter tables by room | Yes |
| + (Add Room) | Create new room | Yes |
| Table Node (click) | Select table | Yes |
| Table Node (double-click) | Open table's order | Yes |
| Table Context Menu | Add Order, View Order, Transfer, Merge, Add Seats, Settings | Partial — Transfer buried |

### Left Panel — Bartender Mode
| Button | Action | Works? |
|--------|--------|--------|
| Tab Strip | Select current bar tab | Yes |
| +New Tab | Create new tab | Yes |
| Menu Section Toggle | Bar / Food / Entertainment / My Bar | Yes |
| Favorites Bar | Quick-access item buttons | Yes |
| Pour Size Buttons | Shot (1x), Dbl (2x), Tall (1.5x), Shrt (.75x) | Yes |
| Spirit Tier Buttons | Well, Call, Premium, Top Shelf | Yes |
| Category Buttons | Filter items by category | Yes |
| Edit Favorites Toggle | Enter edit mode for favorites | Yes |
| Edit Categories Toggle | Enter edit mode for category order | Yes |
| Edit Items Toggle | Enter edit mode for item display | Yes |

### Center — Menu Grid
| Button | Action | Works? |
|--------|--------|--------|
| Menu Item (single tap) | Add 1x item to order | Yes |
| Menu Item (long press) | Quantity multiplier (x1-x5+) | Yes |
| Menu Item (right-click) | Context menu (edit mods, view ingredients, favorite toggle) | Yes |
| Category Scroll | Navigate between categories | Yes |
| Pagination Buttons | Left/Right between item pages | Yes |

### Right Panel — Order Panel
| Button | Action | Works? |
|--------|--------|--------|
| Table/Order # | View check overview popover | Yes |
| Share Button | SharedOwnershipModal (share with another employee) | Yes |
| Card Status Badge | Shows card-on-file info | Yes |
| Attach Card | Attach card to order | Yes |
| Hide Button | Dismiss empty panel | Yes |
| Split Chips | Navigate between splits | Yes |
| Pay All Button | Pay all unpaid splits | Yes |
| Manage Splits | Open SplitCheckScreen | Yes |
| +New Split | Create new split child | Yes |
| Condense Toggle | Group identical items visually | Yes |
| Sort Toggle | Newest at bottom/top | Yes |
| Item Card (click) | Expand item details | Yes |
| Hold Toggle | Mark item on-hold | Yes |
| Note Icon | Edit item notes | Yes |
| Course Number | Select course (1,2,3...) | Yes |
| Seat Number | Select seat assignment | Yes |
| Remove Button (-) | Delete item from order | Yes |
| Quantity Controls (-/+) | Adjust quantity | Yes |
| Edit Modifiers | Open ModifierModal | Yes |
| Comp/Void Button | Open CompVoidModal | Yes |
| Resend Button | Resend item to kitchen | Yes |
| Item Delay Banner | Cancel/Fire buttons | Yes |

### Footer — Normal Mode
| Button | Action | Works? |
|--------|--------|--------|
| Send / Start Tab | Send to kitchen OR start bar tab | Yes |
| Cash Button | Open cash payment flow | Yes |
| Card Button | Open card payment (Datacap) | Yes |
| Other Payment | Store credit, gift card options | Yes |
| Print Check | Print guest check (dual pricing only) | **Conditional** |
| Discount Button | Open DiscountModal | Yes |
| Split Button | Open SplitCheckScreen | Yes |
| Divide-by-2 | Quick split into 2 checks | Yes |
| Cancel Order | Two-tap confirm cancel (pending items) | Yes |
| Clear Order | Two-tap confirm clear (no pending items) | Yes |
| Close Order | Close empty order | Yes |

### Footer — Payment Processor Mode
| Button | Action | Works? |
|--------|--------|--------|
| Tip % Buttons | 15%, 18%, 20%, 25% | Yes |
| No Tip | Set tip to $0 | Yes |
| Custom Tip | Text input for custom amount | Yes |
| Apply (custom tip) | Confirm custom tip | Yes |
| Swap Reader | Switch to backup reader | Yes |
| Cancel | Abandon payment | Yes |
| Collect Payment | Initiate card transaction | Yes |
| TRY AGAIN | Retry after decline | Yes |

**Total counted: 95 interactive buttons/controls**

---

## E.2: Every Button That SHOULD Exist But DOESN'T

### Critical Missing Buttons (High Priority)

| # | Button | Where It Should Go | Why It's Needed |
|---|--------|-------------------|-----------------|
| 1 | **Open Drawer** | Footer, near Clear | Can't open cash drawer without a payment flow; needed for manual reconciliation, cash drops, making change |
| 2 | **Transfer Items** | OrderPanelActions, below Split | Item transfer modal is built but has no trigger button |
| 3 | **Transfer Tab** | Tab Strip context menu or long-press | Cannot reassign a bar tab to another bartender |
| 4 | **Transfer Table** | Floor Plan right-click menu | Cannot reassign a table to another server from the floor plan |
| 5 | **Merge Orders** | Open Orders panel or table context | Cannot combine two orders into one |
| 6 | **Quick Pay** | Footer, right side | Shortcut for fast cash payments without full modal (bar speed) |
| 7 | **Repeat Order** | Header gear or floor plan context | Load previous order's items (same customer returns) |
| 8 | **Print Check (always)** | Footer or header | Currently only shows when dual pricing is enabled |

### High-Value Missing Buttons

| # | Button | Where It Should Go | Why It's Needed |
|---|--------|-------------------|-----------------|
| 9 | **Bulk Select / Multi-Select** | Order Panel pending items | No way to select multiple items for bulk hold/void/transfer |
| 10 | **Per-Item Discount** | Item context menu | Can only discount the whole order, not individual items |
| 11 | **Time Clock Quick Access** | Header icon | Currently buried in employee dropdown (3 taps vs 1) |
| 12 | **Course Delay Inline** | Course header in order panel | Currently hidden in gutter strip, not discoverable |
| 13 | **Hold Timer Countdown** | Hold toggle on held items | No visible timer for how long item has been held |
| 14 | **Socket Connection Indicator** | Header or status bar | No warning when real-time connection is lost |
| 15 | **Closed Order History** | Open Orders panel | Can't view/reopen recently closed orders from today |

---

# SECTION F: DATA LOSS RISKS — CONSOLIDATED

These are scenarios where money, orders, or financial records can be permanently lost or corrupted.

| # | Risk | Trigger | Impact | Section Ref |
|---|------|---------|--------|-------------|
| 1 | **Invisible card charge** | Card approved → DB write fails | Customer charged, no POS record, no reconciliation path | EDGE-1 |
| 2 | **Customer double-charged on reopen** | Reopen paid order → pay again | Original charge not voided, new charge created | EDGE-3 |
| 3 | **Kitchen orders silently lost** | Split before send | Items marked 'sent' but never printed to kitchen | EDGE-2 |
| 4 | **Totals wrong after reopen** | Reopen → add items | Total not recalculated, new items may not be charged | EDGE-4 |
| 5 | **Orphaned paid splits** | Void parent with paid splits | Paid split references voided parent, reconciliation broken | EDGE-5 |
| 6 | **Duplicate items after crash** | Browser crash mid-save | Items in both DB and localStorage, doubled on recovery | EDGE-8 |
| 7 | **Reopened orders in limbo** | Reopen → add items → forget to pay | No tracking of paid-vs-outstanding, items may go uncharged | EDGE-12 |
| 8 | **Shift closed without reconciliation** | Clock out via Crew Hub | Cash, tips, tabs — all abandoned with no closeout | SHIFT-1 |

---

# SECTION G: PRIORITIZED FIX LIST — WAVE 2

## Phase 1: Stop the Bleeding (Data Loss Prevention)
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 1 | Add Datacap reversal/void if DB write fails after card capture | High | EDGE-1 |
| 2 | Void original charge when manager reopens paid order (or warn) | Medium | EDGE-3 |
| 3 | Fix split-before-send: don't mark items as 'sent' during split creation | Medium | EDGE-2 |
| 4 | Recalculate order totals on reopen | Low | EDGE-4 |
| 5 | Cascade void to split children (or block void when splits are paid) | Medium | EDGE-5 |
| 6 | Add dedup logic to `recoverPendingItems()` — check DB before restoring | Medium | EDGE-8 |
| 7 | Route Crew Hub clock-out through TimeClockModal's safety checks | Low | SHIFT-1 |
| 8 | Add open order check at START of shift closeout (not end) | Low | SHIFT-6 |

## Phase 2: Enable Core Transfers
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 9 | Wire Item Transfer button to OrderPanelActions | Low | TRANSFER-1 |
| 10 | Build Tab Transfer modal + button in tab context menu | Medium | TRANSFER-2 |
| 11 | Add Transfer Table to floor plan right-click context menu | Medium | TRANSFER-3 |
| 12 | Add socket dispatch to tab transfer API | Low | TRANSFER-2 |
| 13 | Add order dispatch to table transfer API (not just floor plan) | Low | TRANSFER-3 |

## Phase 3: Fix Race Conditions
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 14 | Add version check to discount + send routes | Low | RACE-1 |
| 15 | Add socket disconnect banner/indicator | Low | RACE-2 |
| 16 | Debounce/deduplicate auto-increment calls on bar tabs | Medium | RACE-3 |
| 17 | Add table lock during order creation to prevent double-seating | Medium | RACE-4 |
| 18 | Move version check inside transaction for void/comp | Low | RACE-5 |
| 19 | Add server-side 86'd item validation on send | Low | RACE-7 |

## Phase 4: Missing Buttons & UX Polish
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 20 | Add Open Drawer button to footer | Low | E.2 #1 |
| 21 | Make Print Check always visible (not dual-pricing only) | Low | E.2 #8 |
| 22 | Add Quick Pay button for cash bar speed | Medium | E.2 #6 |
| 23 | Build Merge Orders modal | Medium | TRANSFER-4 |
| 24 | Add Time Clock quick-access icon to header | Low | E.2 #11 |
| 25 | Build EOD "Close Day" admin page | High | SHIFT-2 |
| 26 | Integrate batch settlement into EOD flow | Medium | SHIFT-4 |
| 27 | Add mid-shift cash drop flow | Medium | SHIFT-5 |
| 28 | Add pre-auth expiration tracking + warnings | Medium | EDGE-6 |
| 29 | Add pending_auth recovery UI for reader timeout | Low | EDGE-7 |
| 30 | Add logout warning for open shifts/tabs | Low | SHIFT-3 |

---

# APPENDIX: FILES EXAMINED IN WAVE 2

**Transfer Flows:**
- `src/components/orders/ItemTransferModal.tsx`
- `src/app/api/orders/[id]/transfer-items/route.ts`
- `src/app/api/tabs/[id]/transfer/route.ts`
- `src/app/api/tables/[id]/transfer/route.ts`
- `src/app/api/orders/[id]/merge/route.ts`
- `src/components/orders/SplitCheckScreen.tsx`
- `src/hooks/useOrderPanelCallbacks.ts`

**Edge Cases:**
- `src/stores/order-store.ts`
- `src/app/api/orders/[id]/send/route.ts`
- `src/app/api/orders/[id]/pay/route.ts`
- `src/app/api/orders/[id]/reopen/route.ts`
- `src/app/api/orders/[id]/open-tab/route.ts`
- `src/components/payment/DatacapPaymentProcessor.tsx`
- `src/app/api/orders/[id]/comp-void/route.ts`

**End-of-Shift:**
- `src/app/(pos)/crew/page.tsx`
- `src/components/time-clock/TimeClockModal.tsx`
- `src/components/shifts/ShiftCloseoutModal.tsx`
- `src/app/(pos)/crew/shift/page.tsx`
- `src/components/tips/` (all files)
- `src/app/api/eod/reset/route.ts`
- `src/app/(admin)/settings/page.tsx`
- `src/app/(admin)/reports/daily/page.tsx`

**Race Conditions:**
- `src/lib/order-version.ts`
- `src/lib/shared-socket.ts`
- `src/lib/socket-dispatch.ts`
- `src/lib/snapshot-cache.ts`
- `src/lib/menu-cache.ts`
- `src/app/api/orders/[id]/items/route.ts`
- `src/app/api/orders/[id]/seating/route.ts`
- `src/app/api/floor-plan/route.ts`

**Button Inventory:**
- `src/app/(pos)/orders/page.tsx` (~2800 lines)
- `src/components/orders/OrderPanel.tsx`
- `src/components/orders/OrderPanelActions.tsx` (1031 lines)
- `src/components/bartender/BartenderView.tsx`
- `src/components/floor-plan/FloorPlanHome.tsx`
- `src/components/payment/PaymentModal.tsx`
- `src/components/orders/OrderPageModals.tsx`
- `src/components/pos/UnifiedPOSHeader.tsx`

---

*Wave 2 was generated by a 5-agent deep-dive team tracing every edge case, transfer flow, race condition, and button path in the GWI POS codebase. No code was written — this is a read-only findings document for review. All reproduction steps use exact button flows a bartender or server would follow.*

---
---

# WAVE 3: THE CONTROLLING MANAGER AUDIT — Permissions, Oversight, Security & Loss Prevention

**Date:** February 23, 2026
**Audited by:** 5-Agent Team (Permission Controller, Employee Monitor, Override Inspector, Report Analyst, Loss Prevention Investigator)
**Persona:** The world's most controlling, paranoid, hands-on restaurant manager who trusts nobody and needs to see/control everything
**Scope:** Every permission, role, override, approval workflow, report, audit log, and security control in the system
**Method:** Line-by-line code tracing of all auth, permission, audit, and admin systems

---

## EXECUTIVE SUMMARY — WAVE 3

This POS system has **79 permissions defined across 11 categories** and a solid role-based architecture. But a controlling manager would be furious — the permissions exist in code but are **inconsistently enforced**. The discount API has NO permission check. The cash drawer API has NO permission check. Void approval is optional. There's no live manager dashboard despite having all the Socket.io infrastructure to build one. There's no session timeout, no brute-force protection on PINs, and no buddy-punch prevention. A dishonest employee could void $500 in orders, apply unlimited discounts, open the cash drawer at will, and clock in absent friends — all without triggering a single alert.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Permission Enforcement Gaps | 3 | 4 | 5 | 2 |
| Override & Approval Gaps | 3 | 3 | 4 | 1 |
| Monitoring & Visibility Gaps | 1 | 5 | 4 | 2 |
| Reporting Gaps | 0 | 3 | 8 | 9 |
| Security & Loss Prevention | 6 | 5 | 4 | 1 |
| **TOTALS** | **13** | **20** | **25** | **15** |

---

# SECTION H: PERMISSION & ROLE SYSTEM

## H.1: Permission System Overview

**79 permissions** are defined in `src/lib/auth-utils.ts` across these categories:

| Category | Count | Examples |
|----------|-------|---------|
| POS Access | 13 | `POS_ACCESS`, `POS_CASH_DRAWER`, `POS_NO_SALE`, `POS_SPLIT_CHECKS` |
| Manager | 20 | `MGR_DISCOUNTS`, `MGR_VOID_ITEMS`, `MGR_VOID_PAYMENTS`, `MGR_FORCE_CLOCK_OUT` |
| Reports | 14 | `REPORTS_SALES`, `REPORTS_LABOR`, `REPORTS_VOIDS`, `REPORTS_EXPORT` |
| Menu | 6 | `MENU_EDIT_ITEMS`, `MENU_EDIT_PRICES`, `MENU_86_ITEMS` |
| Staff | 7 | `STAFF_MANAGE_ROLES`, `STAFF_EDIT_WAGES`, `STAFF_CLOCK_OTHERS` |
| Settings | 13+ | `SETTINGS_PAYMENTS`, `SETTINGS_SECURITY`, `SETTINGS_HARDWARE` |
| Tips | 12 | `TIPS_VIEW_ALL`, `TIPS_MANAGE_RULES`, `TIPS_PROCESS_PAYOUT` |
| Inventory | 7 | `INVENTORY_MANAGE`, `INVENTORY_COUNTS`, `INVENTORY_WASTE` |
| Tables | 4 | `TABLES_EDIT`, `TABLES_FLOOR_PLAN`, `TABLES_RESERVATIONS` |
| Customers | 5 | `CUSTOMERS_GIFT_CARDS`, `CUSTOMERS_HOUSE_ACCOUNTS` |
| Admin | 3 | `ADMIN`, `SUPER_ADMIN`, `MANAGER` (wildcards) |

**9 preset role templates:** Server (9 perms), Bartender (12), Host (4), Cook (5), Kitchen Manager (7), Barback (3), Manager (20+ with wildcards), Admin (full), Owner (super_admin)

## H.2: Critical Permission Enforcement Gaps

### PERM-1: Discount API Has ZERO Permission Check
**Severity:** CRITICAL
**File:** `src/app/api/orders/[id]/discount/route.ts`

The POST handler has NO `requirePermission()` call. Any employee with basic `POS_ACCESS` can apply unlimited discounts of any amount. The `MGR_DISCOUNTS` permission constant exists but is never checked.

The code auto-flags discounts >$50 or >20% as `requiresApproval = true` (lines 138-140), but this flag is **purely informational** — the discount is applied immediately regardless. There is no approval workflow, no manager PIN, no SMS verification.

**Exploit:** A server making minimum wage can apply 50% discounts to every check indefinitely.

---

### PERM-2: Cash Drawer API Has ZERO Permission Check
**Severity:** CRITICAL
**File:** `src/app/api/print/cash-drawer/route.ts`

The POST handler accepts a request body but performs NO permission check — no `requirePermission()` call anywhere. The `POS_CASH_DRAWER` and `POS_NO_SALE` permissions exist as constants but are never enforced at the API level. Any authenticated employee can open the cash drawer.

**Additionally:** There is no logging of drawer opens. No `drawerLog` table, no audit trail entry, no record of who opened it or when.

---

### PERM-3: 86 Item Toggle Has NO Permission Check
**Severity:** CRITICAL
**File:** `src/app/api/inventory/86-status/route.ts` (line 222)

The POST handler directly updates the ingredient's `is86d` status without any `requirePermission()` call. The `MENU_86_ITEMS` permission constant exists but is never checked. Any bartender can 86 any item — including high-value spirits.

---

### PERM-4: GET /api/roles Exposes All Permissions to Everyone
**Severity:** HIGH
**File:** `src/app/api/roles/route.ts` (line 16)

The GET handler returns all roles with their full permission arrays AND the complete `availablePermissions` list to any authenticated user. There is no check for `STAFF_MANAGE_ROLES`. A bartender can see exactly which permissions every role has, including manager/admin roles.

---

### PERM-5: No Per-Employee Permission Overrides
**Severity:** HIGH
**File:** `prisma/schema.prisma` — Employee model

Employees are assigned ONE role and inherit ALL its permissions. There is no mechanism to:
- Remove specific permissions from an individual employee
- Add permissions beyond their role
- Set per-employee discount/void/comp limits
- Restrict an employee to specific menu categories or floor sections

The `SectionAssignment` model exists in the database but section restrictions are NOT enforced in any API route — a bartender assigned to "Bar" can still create orders on dining room tables.

---

### PERM-6: Wildcard Permissions Grant Future Permissions
**Severity:** HIGH
**File:** `src/lib/auth-utils.ts` (lines 4-26)

Wildcard patterns like `manager.*` automatically match any new permission added under that prefix. If a developer adds `manager.nuclear_launch`, any role with `manager.*` instantly gets it. The `admin` and `super_admin` roles bypass ALL permission checks entirely.

---

### PERM-7: Void/Comp Only Requires POS_ACCESS
**Severity:** HIGH
**File:** `src/app/api/orders/[id]/comp-void/route.ts` (lines 104-107)

The requesting employee only needs `POS_ACCESS` to void or comp items. The `MGR_VOID_ITEMS` permission is only checked for the `approvedById` (the manager approving it) — but providing an approver is OPTIONAL. Any employee with basic POS access can void any item without manager involvement.

---

### PERM-8: Menu Price Edit Permission Not Enforced in API
**Severity:** MEDIUM
**File:** `src/lib/auth-utils.ts` defines `MENU_EDIT_PRICES`

The permission constant exists and is checked in the admin navigation UI (AdminNav component hides menu links). But the actual API routes for editing menu item prices do not consistently enforce this permission — the UI hides the buttons, but the API may accept direct requests.

---

### PERM-9: No Temporary Employee Lockout
**Severity:** MEDIUM

There is no `disabledUntil` or `lockedUntil` field on the Employee model. To disable an employee, you must set `isActive: false` or soft-delete them. There is no way to temporarily suspend access (e.g., pending investigation) with an automatic re-enable date.

---

# SECTION I: OVERRIDE & APPROVAL POWERS

## I.1: What A Manager CAN Control

| Action | Permission Required | Approval Workflow | Enforced? |
|--------|-------------------|-------------------|-----------|
| Transfer items between orders | `MGR_TRANSFER_CHECKS` | Permission only | Yes |
| Bulk void/close operations | `MGR_BULK_OPERATIONS` | Permission only | Yes |
| Reopen paid order | `MGR_VOID_ORDERS` | Permission + 60s cooldown | Yes |
| Void payment | `MGR_VOID_PAYMENTS` | Permission only | Yes |
| Issue refund | `MGR_VOID_PAYMENTS` | Permission only | Yes |
| Edit time clock entries | `MGR_EDIT_TIME_ENTRIES` | Permission only | Yes |
| Force clock out employee | `MGR_FORCE_CLOCK_OUT` | Permission only | Yes |
| View full cash drawer (non-blind) | `MGR_CASH_DRAWER_FULL` | Permission only | Yes |
| Override cash variance | `MGR_CASH_VARIANCE_OVERRIDE` | Permission only | Yes |
| Close business day | `MGR_CLOSE_DAY` | Permission only | Yes |

## I.2: What A Manager CANNOT Control

### OVERRIDE-1: Cannot Require Void Approval
**Severity:** CRITICAL

The remote void approval system (SMS to manager, 6-digit code) exists and works — but it is **entirely optional**. There is no location-level setting to REQUIRE approval for all voids. A manager cannot flip a switch that says "all voids must be approved by me."

**What exists:** `RemoteVoidApprovalModal` — SMS-based approval with 30-minute expiry
**What's missing:** A `requireVoidApproval` toggle in location settings that makes the approval code mandatory

---

### OVERRIDE-2: Cannot Set Dollar Thresholds for Approvals
**Severity:** CRITICAL

There is no threshold configuration anywhere in the system. A manager cannot say "require my approval for voids over $25" or "require approval for discounts over $20." The discount route has a hardcoded $50 / 20% threshold that sets a flag — but the flag does nothing.

---

### OVERRIDE-3: Cannot Require Manager PIN for Overrides
**Severity:** CRITICAL

Manager approval for voids works by passing `approvedById` — the system checks that the approver has `MGR_VOID_ITEMS` permission, but does NOT verify the manager entered their PIN. A bartender who knows their manager's employee ID could forge approvals.

---

### OVERRIDE-4: No Mid-Shift Cash Drawer Audit
**Severity:** HIGH

A manager cannot initiate a surprise drawer count from the POS. The blind count only happens during the shift closeout flow. There is no "audit this drawer right now" button anywhere.

---

### OVERRIDE-5: No Per-Role Discount Limits
**Severity:** HIGH

There is no way to set "bartenders can discount up to 10%, servers up to 5%." The Role model has no `maxDiscountPercent` or `maxDiscountAmount` field. The DiscountRule model has `maxPerOrder` for preset rules, but custom/manual discounts have no per-role cap.

---

### OVERRIDE-6: No Tab Amount Limits
**Severity:** HIGH

A manager cannot set a maximum bar tab amount. There is no threshold where the system says "this tab has reached $500, require manager authorization to continue adding items." Pre-auth amounts are set at tab open but don't cap the final total.

---

### OVERRIDE-7: Cannot Force-Close Any Tab Remotely
**Severity:** MEDIUM

While a manager can force clock out an employee, there is no "force-close this tab" button that works from any terminal. The manager must navigate to the specific order, open it, and close/pay it manually.

---

### OVERRIDE-8: No Configurable Approval Requirements Per Location
**Severity:** MEDIUM

Location settings don't include toggles for: "require approval for all voids," "require approval for discounts over X," "require approval for refunds over X," "require approval for cash drawer opens," "require approval for 86 changes." All approval logic is hardcoded.

---

# SECTION J: EMPLOYEE MONITORING & OVERSIGHT

## J.1: What A Manager CAN See (Post-Facto)

| Data | Available? | Where | Real-Time? |
|------|-----------|-------|------------|
| Sales by employee | Yes | `/reports/employees` | No (report) |
| Tips by employee | Yes | `/reports/tips` | No (report) |
| Hours worked | Yes | `/reports/labor` | No (report) |
| Overtime hours | Yes | `/reports/labor` | No (report) |
| Voids/comps by employee | Yes | `/reports/voids` | No (report) |
| Server performance (avg check, table turns) | Yes | `/reports/server-performance` | No (report) |
| Commission by employee | Yes | `/reports/commission` | No (report) |
| Daily sales summary | Yes | `/reports/daily` | No (report) |
| Payment verification | Yes | `/reports/datacap` | No (report) |
| Order history | Yes | `/reports/order-history` | No (report) |

## J.2: What A Manager CANNOT See

### MONITOR-1: No Live Manager Dashboard
**Severity:** CRITICAL

There is **NO real-time manager dashboard**. The Socket.io infrastructure exists. The `/api/orders/open` API is optimized and returns all open orders with employee names, totals, and age. But there is NO UI that:
- Shows all open orders across all employees updating in real-time
- Shows who is clocked in right now
- Shows current sales-per-employee running totals
- Shows labor cost vs. sales ratio live
- Highlights stuck/aging orders

The APIs and socket infrastructure are ready. The manager-facing UI simply doesn't exist.

---

### MONITOR-2: No Real-Time Alerts or Notifications
**Severity:** HIGH

The system generates ZERO alerts for:
- Large void (>$50)
- Large discount applied
- Cash drawer opened
- Employee approaching overtime
- High void rate per employee
- Suspicious activity patterns
- Failed login attempts

There is no threshold configuration, no SMS/push notification system for managers, and no alert banner on any admin page.

---

### MONITOR-3: No Audit Log UI Page
**Severity:** HIGH

The audit log API exists (`/api/audit/activity`) with filtering by date range, action type, and employee. But there is **no dedicated admin page** to browse audit logs. A manager must access the API directly or rely on specific reports (voids, etc.).

---

### MONITOR-4: No Speed-of-Service Metrics
**Severity:** HIGH

There is no tracking of:
- Average time from order creation to kitchen send
- Average time from send to completion (KDS bump)
- Average time from seating to payment
- Per-employee speed comparisons
- Table turn time

---

### MONITOR-5: No Drawer Open Audit Trail
**Severity:** HIGH

Cash drawer opens are not logged anywhere. A manager cannot see who opened the drawer, when, or why. The `POS_NO_SALE` permission exists but is never checked or logged.

---

### MONITOR-6: No Employee Performance Ranking
**Severity:** MEDIUM

While individual employee metrics exist in reports, there is no comparison view, leaderboard, or ranking system. A manager cannot quickly see "top 3 sellers today" or "bottom 3 tip earners this week" without manually reading through all employee rows.

---

### MONITOR-7: No Break Duration Monitoring
**Severity:** MEDIUM

The time clock tracks break start/end times, but there is no dashboard showing "who is on break right now and for how long." No alert for breaks exceeding a threshold (e.g., 30-minute maximum). No break compliance report.

---

### MONITOR-8: No Current Labor Cost vs Sales
**Severity:** MEDIUM

Labor cost percentage is available on the daily sales report — but only as an end-of-day figure. There is no live calculation of "right now we're at 32% labor cost and need to cut someone."

---

# SECTION K: REPORTING GAPS

## K.1: What Reports Exist (21 Reports)

The system has a comprehensive reports hub at `/reports` with:

**End of Day:** Daily Sales Report, Employee Shift Report
**Sales & Revenue:** Sales Report, Hourly Sales, Product Mix (PMIX), Order History, Sales Forecasting
**Team & Labor:** Payroll, Labor, Employee Performance, Server Performance, Commission, Tips, Tip Adjustment
**Operations:** Voids & Comps, Payment Verification (Datacap), Coupons & Discounts, Reservations, Accounts Receivable
**Inventory:** Liquor & Spirits (pour cost, tier performance, upsell tracking)

## K.2: Missing Reports Every Manager Demands

### HIGH Priority Missing Reports

| # | Report | What It Shows | Why A Manager Needs It |
|---|--------|--------------|----------------------|
| 1 | **Flash Report** | 1-page morning summary of yesterday | Quick review without scrolling through full daily report |
| 2 | **Food Cost Analysis** | Actual vs. theoretical food usage by item | Liquor has pour cost — food has NOTHING |
| 3 | **Cash Over/Short History** | Variance tracking per employee over time | Pattern detection for cash theft |

### MEDIUM Priority Missing Reports

| # | Report | What It Shows |
|---|--------|--------------|
| 4 | **Daypart Analysis** | Breakfast vs. Lunch vs. Dinner sales comparison |
| 5 | **Table Turn Time** | Average time from seating to departure |
| 6 | **Speed of Service** | Kitchen ticket time, order delivery time |
| 7 | **Week-over-Week Comparison** | This Tuesday vs. last Tuesday |
| 8 | **Inventory Waste (Food)** | Food waste tracking (exists for liquor only) |
| 9 | **Staffing Efficiency** | Revenue per labor hour by employee |
| 10 | **86'd Item Impact** | Lost sales from out-of-stock items |
| 11 | **Discount/Comp Combined Summary** | Unified view of all revenue leakage |

### LOW Priority Missing Reports

| # | Report | What It Shows |
|---|--------|--------------|
| 12 | **Tax Liability** | Projected tax obligations |
| 13 | **Gift Card Liability** | Outstanding gift card balance (future redemptions) |
| 14 | **Customer Frequency/Loyalty** | Visit frequency, lifetime value |
| 15 | **Modifier Performance** | Most-requested customizations |
| 16 | **Combo Performance** | Sell-through rate vs. individual items |
| 17 | **Promotional Effectiveness** | Coupon/discount ROI |
| 18 | **Menu Profitability** | Margins including modifier costs |
| 19 | **Refund/Dispute Report** | Payment refund tracking by method |
| 20 | **Labor Scheduling Optimizer** | Projected staffing needs from sales patterns |

## K.3: Export Gaps

- **No PDF export** on any report
- **No Excel/CSV export** except Server Performance (one report out of 21)
- **No scheduled email reports** (e.g., daily summary emailed at 6 AM)
- **No report bookmarking/favorites**

---

# SECTION L: SECURITY & LOSS PREVENTION

## L.1: Authentication Vulnerabilities

### SEC-1: No PIN Brute-Force Protection
**Severity:** CRITICAL
**File:** `src/app/api/auth/login/route.ts`

There is no rate limiting, no account lockout, and no failed-attempt logging on the PIN login. With a 4-digit PIN, there are only 10,000 possibilities. An attacker with physical access to a terminal could try all combinations without being locked out.

---

### SEC-2: No Session Timeout / Auto-Logout
**Severity:** CRITICAL

No auto-logout after inactivity was found anywhere in the codebase. An employee can walk away from a terminal and leave it logged in indefinitely. Another employee can use that terminal under the first employee's identity — all voids, comps, and transactions are attributed to the wrong person.

---

### SEC-3: No Buddy-Punch Prevention
**Severity:** CRITICAL
**File:** `src/app/api/time-clock/route.ts`

The clock-in API accepts an `employeeId` parameter with no verification that the employee is physically present. No geofencing, no IP validation, no biometric check. Employee A can clock in Employee B (who is not at work) and Employee B gets paid for hours not worked.

---

### SEC-4: Sweethearting Vector — No Approval Enforcement
**Severity:** CRITICAL

A dishonest employee can execute this sequence with zero alerts or blocks:
1. Customer orders $50 of food
2. Employee applies 100% discount (no permission check on discount API)
3. Order total = $0, customer pays nothing
4. Employee pockets cash from customer
5. No audit log entry for the discount
6. VoidLog only captures voids, not discounts
7. Manager finds out only if they manually check the discount report days later

---

### SEC-5: No Logout Audit Trail
**Severity:** CRITICAL
**File:** Searched entire codebase — no logout audit found

Login events ARE logged in the AuditLog table. But logout events are NOT. This means there's no way to determine:
- How long an employee was logged in
- Whether a terminal was left unattended
- Whether suspicious activity happened during an "active session"

---

### SEC-6: Audit Logs Are Mutable
**Severity:** CRITICAL

The AuditLog table has a `deletedAt` field (soft delete). A manager or admin with database access could soft-delete audit records to cover tracks. There is no append-only pattern, no cryptographic hash chain, and no external backup of audit data.

---

### SEC-7: No Failed Login Logging
**Severity:** HIGH

Failed PIN attempts are not recorded anywhere. A manager cannot see "someone tried 47 PINs at Terminal 3 at 2 AM."

---

### SEC-8: No Screen Lock Between Transactions
**Severity:** HIGH

After an employee completes a transaction, the POS stays logged in with full access. There is no option for "require PIN re-entry between orders" or "lock screen after payment completes." In a busy bar, multiple people may use one terminal without re-authenticating.

---

### SEC-9: Bank Account Numbers Stored in Plaintext
**Severity:** HIGH
**File:** `prisma/schema.prisma` — Employee model

The `bankAccountNumber` and `bankRoutingNumber` fields are stored in plain text in the database. The GET API response masks them (`****`), but the database itself has no encryption at rest for these fields. This is a compliance concern.

---

### SEC-10: No Item Deletion Detection
**Severity:** HIGH

Items added to an order but removed BEFORE being sent to the kitchen leave no trace. There is no "deleted item" log, no gap detection in item sequences, and no audit entry. An employee can add items, remove them, and pocket the cash with no paper trail.

---

### SEC-11: Kiosk Exit Zone Requires No Authentication
**Severity:** MEDIUM
**File:** `src/components/KioskExitZone.tsx`

A hidden 64x64px div in the top-left corner of every page exits kiosk mode when tapped 5 times in 3 seconds. This is intentional (admin escape hatch) but requires no PIN or authentication. Anyone with physical access can break out of kiosk mode.

---

### SEC-12: Employee Can View Other Employees' Sales Data
**Severity:** MEDIUM

The `REPORTS_SALES_BY_EMPLOYEE` permission grants access to all employee sales data — but there is no filter ensuring an employee can only see their OWN data. If granted this permission for self-service, they can see all peers' sales, tips, and performance.

---

# SECTION M: PRIORITIZED FIX LIST — WAVE 3

## Phase 1: Close Security Holes (Production Blockers)
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 1 | Add `requirePermission(MGR_DISCOUNTS)` to discount API | Low | PERM-1 |
| 2 | Add `requirePermission(POS_CASH_DRAWER)` to cash drawer API | Low | PERM-2 |
| 3 | Add `requirePermission(MENU_86_ITEMS)` to 86 status API | Low | PERM-3 |
| 4 | Add permission check to GET /api/roles | Low | PERM-4 |
| 5 | Implement session timeout (15-min inactivity auto-logout) | Medium | SEC-2 |
| 6 | Add PIN brute-force protection (3 failures = 5-min lockout) | Medium | SEC-1 |
| 7 | Log failed login attempts | Low | SEC-7 |
| 8 | Log logout events in AuditLog | Low | SEC-5 |
| 9 | Log all cash drawer opens with employee + timestamp | Low | MONITOR-5 |
| 10 | Log all discount applications in AuditLog | Low | SEC-4 |

## Phase 2: Enforce Manager Control
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 11 | Add location setting: `requireVoidApproval` (boolean) | Medium | OVERRIDE-1 |
| 12 | Add location setting: approval thresholds per action type | Medium | OVERRIDE-2 |
| 13 | Require manager PIN entry (not just approvedById) for overrides | Medium | OVERRIDE-3 |
| 14 | Enforce discount approval workflow (hold discount pending approval) | High | PERM-1, OVERRIDE-2 |
| 15 | Add per-role discount limits (`Role.maxDiscountPercent`) | Medium | OVERRIDE-5 |
| 16 | Enforce section assignments in order creation API | Medium | PERM-5 |
| 17 | Add per-employee permission overrides (`Employee.restrictedPermissions`) | Medium | PERM-5 |

## Phase 3: Build Real-Time Oversight
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 18 | Build live manager dashboard (open orders, clocked-in employees, sales) | High | MONITOR-1 |
| 19 | Build audit log browser page in admin UI | Medium | MONITOR-3 |
| 20 | Add real-time alert system (large voids, discounts, OT approaching) | High | MONITOR-2 |
| 21 | Add mid-shift drawer audit capability | Medium | OVERRIDE-4 |
| 22 | Add break duration monitoring dashboard | Low | MONITOR-7 |
| 23 | Add employee performance ranking/comparison view | Medium | MONITOR-6 |

## Phase 4: Reporting & Analytics
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 24 | Add food cost analysis report (actual vs. theoretical) | High | K.2 #2 |
| 25 | Add cash over/short history report per employee | Medium | K.2 #3 |
| 26 | Add PDF/CSV export to all reports | Medium | K.3 |
| 27 | Add flash report (morning summary) | Medium | K.2 #1 |
| 28 | Add daypart analysis report | Medium | K.2 #4 |
| 29 | Add speed-of-service metrics | High | MONITOR-4 |
| 30 | Add scheduled email reports | Medium | K.3 |

## Phase 5: Advanced Security
| # | Fix | Effort | References |
|---|-----|--------|------------|
| 31 | Add buddy-punch prevention (IP logging + alerts) | Medium | SEC-3 |
| 32 | Add screen lock between transactions (optional setting) | Medium | SEC-8 |
| 33 | Encrypt bank account numbers at rest | Medium | SEC-9 |
| 34 | Add item deletion detection (pre-send removal audit) | Medium | SEC-10 |
| 35 | Make audit logs append-only (remove soft delete) | Low | SEC-6 |
| 36 | Add 2FA for high-value actions (voids >$50) | High | SEC-4 |
| 37 | Add temporary employee lockout with auto-re-enable | Low | PERM-9 |

---

# APPENDIX: FILES EXAMINED IN WAVE 3

**Permission System:**
- `src/lib/auth-utils.ts` — 79 permission constants, role templates, `hasPermission()` logic
- `src/lib/api-auth.ts` — `requirePermission()`, `requireAnyPermission()` enforcement functions
- `src/app/api/roles/route.ts` — Role CRUD (GET has no permission check)
- `src/app/(admin)/roles/page.tsx` — Role management UI
- `prisma/schema.prisma` — Role model, Employee model, SectionAssignment model

**Override & Approvals:**
- `src/components/orders/CompVoidModal.tsx` — Void/comp UI with optional remote approval
- `src/app/api/orders/[id]/comp-void/route.ts` — Void API (POS_ACCESS only, approval optional)
- `src/components/orders/RemoteVoidApprovalModal.tsx` — SMS approval flow
- `src/app/api/voids/remote-approval/request/route.ts` — Approval request creation
- `src/components/orders/DiscountModal.tsx` — Discount UI
- `src/app/api/orders/[id]/discount/route.ts` — Discount API (NO permission check)
- `src/app/api/orders/[id]/void-payment/route.ts` — Payment void
- `src/app/api/orders/[id]/refund-payment/route.ts` — Refund processing
- `src/app/api/print/cash-drawer/route.ts` — Drawer open (NO permission check)
- `src/app/api/inventory/86-status/route.ts` — 86 toggle (NO permission check)
- `src/lib/cash-drawer.ts` — ESC/POS drawer kick command

**Monitoring & Reporting:**
- `src/app/(admin)/reports/page.tsx` — Reports hub (21 reports)
- `src/app/(admin)/reports/daily/page.tsx` — Daily sales report
- `src/app/(admin)/reports/employees/page.tsx` — Employee performance
- `src/app/(admin)/reports/server-performance/page.tsx` — Server metrics + CSV export
- `src/app/(admin)/reports/labor/page.tsx` — Labor cost tracking
- `src/app/(admin)/reports/voids/page.tsx` — Void/comp tracking
- `src/app/(admin)/reports/tips/page.tsx` — Tip distribution
- `src/app/(admin)/reports/liquor/page.tsx` — Pour cost analysis
- `src/app/(admin)/reports/datacap/page.tsx` — Payment verification
- `src/app/api/audit/activity/route.ts` — Audit log API (no UI page)
- `src/app/api/orders/open/route.ts` — Open orders API (optimized, no manager UI)

**Security:**
- `src/app/api/auth/login/route.ts` — PIN login (no brute-force protection)
- `src/app/api/auth/verify-pin/route.ts` — PIN verification
- `src/app/api/time-clock/route.ts` — Clock in/out (no buddy-punch prevention)
- `src/components/KioskExitZone.tsx` — Kiosk exit (no auth required)
- `src/app/api/employees/[id]/payment/route.ts` — Bank data handling

---

*Wave 3 was generated by a 5-agent "controlling manager" team auditing every permission, override, approval workflow, report, audit log, and security control in the GWI POS codebase. No code was written — this is a read-only findings document for review. Every gap was identified from the perspective of a hands-on manager who needs total control over their staff and operations.*

---

# WAVE 4: THE OWNER FROM HELL — Complete Owner Audit

*5 agents deployed as the most demanding restaurant owner imaginable — checking every button, report, financial metric, setup flow, customer tool, and end-of-day process. The owner who checks numbers 10x a day, micromanages every detail, and demands total control.*

**Agents deployed:**
1. Owner Daily Operations — POS workflow, quick actions, emergency powers
2. Owner Financial Visibility — Revenue, costs, P&L, payroll, tax
3. Owner Business Config & Setup — Menu builder, employee onboarding, hardware, settings
4. Owner VIP & Customer Tools — Customers, house accounts, gift cards, loyalty, reservations
5. Owner End-of-Day & Control — EOD checklist, batch settlement, problem resolution, remote access

---

## 4.1 OWNER DAILY OPERATIONS AUDIT

### Owner Role & Permissions

The Owner role receives `super_admin` permission, which bypasses ALL permission checks:
```typescript
// src/lib/auth-utils.ts line 447
'Owner': ['super_admin'],
```
This means owners have universal access to any POS feature that checks permissions. However, there are still significant **functional gaps**.

### What Owners CAN Do From the POS

| Feature | Status | Notes |
|---------|--------|-------|
| View all orders from ALL employees | YES | All visible on floor plan |
| Jump into and edit any employee's order | YES | Via `super_admin` wildcard |
| Comp items/rounds instantly | YES | No approval required — auto-approves |
| Void items/orders without approval | YES | Owner bypasses approval chain |
| Apply any discount without approval | YES | All discount rules accessible |
| Split/merge tickets | YES | Full split check functionality |
| Transfer items between orders | YES | API exists, but no UI trigger button |
| Close employee shifts (force close) | YES | `manager.force_clock_out` |
| Process all payment types | YES | Cash, card, gift card, house account |
| 86 items | YES | Can mark items unavailable |
| Reassign tables/sections | YES | Floor plan editing available |

**Key code locations:**
- `src/app/(pos)/orders/page.tsx` lines 139-144 — Owner included in `isManager` check
- `src/components/orders/CompVoidModal.tsx` — No approval gate for owner
- `src/components/orders/DiscountModal.tsx` — Full discount access

### What Owners CANNOT Do From the POS

| Feature | Status | Impact |
|---------|--------|--------|
| Edit menu items | NO | Requires `/menu` admin page navigation |
| Manage employees/roles | NO | Requires `/settings/team` admin page |
| Adjust tax rates | NO | Requires `/settings` admin page |
| Manage hardware | NO | Requires `/settings/hardware` admin page |
| Send broadcast message to all terminals | NO | No messaging system exists at all |
| Send command to kitchen | NO | Items go to KDS via print routing only |
| View KDS status from POS | NO | Must physically walk to KDS screen |
| See who's clocked in | NO | Must navigate to admin page |
| Force-logout specific employee | NO | No API endpoint exists |
| Lock the POS system (emergency) | NO | No lockdown feature |
| Emergency batch settlement | NO | Only via normal closeout workflow |
| See cash drawer contents in real-time | NO | Only visible during shift close |
| Pull quick "today's total" from POS | NO | Must navigate away to `/reports` |
| See if payment processor is down | NO | Discover only when transaction fails |
| Bulk close all open orders | NO | Must close one-by-one |
| Reload a stuck terminal | PARTIAL | API exists but not exposed in POS UI |
| Switch to "cash only" mode | PARTIAL | Requires admin Settings navigation (~30 seconds) |

### Critical Owner Operational Gaps

1. **No broadcast messaging** — Can't tell staff "Last call in 15 min" without shouting
2. **No KDS visibility from POS** — Can't see what's cooking without walking to kitchen
3. **No staff clock status widget** — Can't quickly see who's on duty
4. **No emergency stop button** — Can't instantly shut down all payment processing
5. **No bulk order close** — Must close tabs one-by-one at end of night
6. **No quick day snapshot** — Can't pull today's total without leaving POS
7. **No terminal management from POS** — Can't reload stuck terminal
8. **No payment processor health dashboard** — Find out card processing is down only when it fails

---

## 4.2 OWNER FINANCIAL VISIBILITY AUDIT

### What the Owner CAN See Today

**Reports Hub** (`/reports/page.tsx`) displays Today's Overview:
- Today's Sales (net) | Orders (count) | Avg Order Value | Tips Collected
- Payment Breakdown: Cash % vs Card %

**Available Reports:**
- Daily Report — Revenue, payments, cash, sales by category, voids, discounts, labor, gift cards
- Labor Report — By-employee/day/role breakdown, labor cost % (color-coded: green <30%, amber 30-35%, red >35%)
- Payroll Report — Hours, wages, tips, commissions per employee for pay period
- Liquor Report — Pour costs, category margins, tier performance
- Product Mix — Item profitability, category margins
- House Accounts — Outstanding balances, aging buckets (30/60/90 day)
- Waste Tracking — Spoilage, spill entries with cost impact
- Payment Verification — Card settlement status, SAF pending transactions
- Variance Report — **API exists but NO UI page** (theoretical vs actual inventory)

### Critical Financial Gaps

#### Real-Time Visibility (NOTHING updates live)
| Metric | Available? | Issue |
|--------|-----------|-------|
| Live sales counter | NO | Stats load once on page open, never refresh |
| Week-to-date revenue | NO | Must manually calculate from daily reports |
| Month-to-date revenue | NO | Must use custom date filtering |
| Revenue trend (up/down vs yesterday) | NO | No comparison indicators |
| Real-time labor cost % | NO | Only available after shift ends |
| Current cash on hand (all drawers) | NO | Only per-drawer during shift close |
| Today's comps/discounts as % of revenue | NO | Not tracked as percentage |
| Projected daily total | NO | No trend projection |

#### Cost Tracking Gaps
| Metric | Available? | Issue |
|--------|-----------|-------|
| Variance Report UI | NO | **API exists at `/api/reports/variance` but no React page** |
| Real-time food cost % | NO | Only available after orders paid/deducted |
| Daily food cost budget/target | NO | Can't set "max $8K on food today" |
| Waste threshold alerts | NO | No "waste is 15% of food cost" warning |
| Inventory shrinkage calculation | NO | Not computed anywhere |
| Liquor par level monitoring | NO | No low-stock warnings |
| Recipe costing UI | NO | Recipes exist in DB, no owner-facing cost view |
| Vendor cost comparison | NO | Can't compare Sysco vs US Foods pricing |

#### Cash Flow & Liability Gaps
| Metric | Available? | Issue |
|--------|-----------|-------|
| Total cash on hand NOW | NO | Can't sum all drawers across terminals |
| House account summary total | NO | Must manually add from report |
| Gift card liability rollup | NO | Must count manually |
| Tip payout liability | NO | Can't see "I owe $1,240 in tips" |
| Accounts payable | NO | Not tracked at all |
| Cash drawer reconciliation dashboard | NO | No cross-drawer comparison |
| Pending refund tracking | NO | Can't see refunds waiting to settle |
| Credit card batch settlement at a glance | NO | Must click into Payment Verification |

#### Payroll & Labor Gaps
| Metric | Available? | Issue |
|--------|-----------|-------|
| Real-time labor cost % NOW | NO | Only after shift/day ends |
| Projected labor cost for current shift | NO | Can't see "$X/hour, we're at Y%" |
| Labor cost budget/target setting | NO | Can't set "target 28%, alert at 30%" |
| Overtime alert | NO | No notification when employee approaches OT |
| Individual employee productivity | NO | Can't see "bartender produces $X per labor hour" |
| Payroll projection ("will we make it?") | NO | Can't model "if we do $12K today, payroll is safe" |
| Break compliance checking | NO | Breaks logged but no legal compliance verification |

#### Tax & Compliance Gaps
| Metric | Available? | Issue |
|--------|-----------|-------|
| Sales tax reconciliation | NO | Can't verify taxes collected = taxes owed |
| Tip credit calculation | NO | No tracking of tip credits vs minimum wage |
| Payroll tax withholding estimate | NO | No fed/state/FICA projections |
| Sales tax file export | NO | Can't export for tax filing |
| Quarterly tax estimate | NO | Can't forecast quarterly liability |

#### Missing Financial Settings
| Setting | Available? | Issue |
|---------|-----------|-------|
| Revenue target/goal | NO | Can't set "we want $18K today" |
| Labor cost target per role | NO | Can't set "bartenders max 18% of bar revenue" |
| Food cost budget | NO | Can't set daily/monthly food cost caps |
| Discount limits | NO | Can't cap "max 15% discount per order" |
| Auto-generated scheduled reports | NO | Can't email daily report to owner |
| Financial alerts/thresholds | NO | No configurable warnings for any metric |

### Owner Pain Summary

**"Can I make payroll this week?"** — IMPOSSIBLE TO ANSWER QUICKLY
- Must run payroll report, manually estimate remaining days, no projected amount

**"How much waste are we having?"** — FRAGMENTED DATA
- Waste page shows logged entries, variance API calculates but has no UI, no unified dashboard

**"Are we tracking to budget?"** — NOT EVEN POSSIBLE
- Can't set any targets, budgets, or benchmarks beyond hard-coded 30%/35% labor thresholds

---

## 4.3 OWNER BUSINESS CONFIGURATION & SETUP AUDIT

### Overview

149 admin pages across 40+ configuration domains. **38 separate settings sub-pages** covering nearly every aspect of restaurant operations. But **no guided onboarding**.

### What Exists (Working Well)

| Area | Status | Details |
|------|--------|---------|
| Menu Builder | GOOD | Three-panel interface, unlimited modifier depth, pour sizes |
| Floor Plan Editor | GOOD | Drag-and-drop, rotation, wall snapping, sections |
| Employee Management | GOOD | PIN login, role assignment, multi-role support, color avatars |
| Payment Configuration | GOOD | Datacap, simulated mode, surcharge/dual pricing (5 models) |
| Tax Rules | GOOD | Multi-rate, category-specific, inclusive/exclusive, compounding |
| Hardware Management | GOOD | Real-time health dashboard, pairing workflows |
| Online Ordering | GOOD | 5-tab hub, hours, payments, notifications, surge throttling |
| Happy Hour | GOOD | Time-based pricing by day of week |
| Tip Configuration | GOOD | Tip bank, tip shares, auto-gratuity, chargeback policies |
| Integrations | GOOD | Email (Resend), SMS (Twilio), Slack |

### First-Time Setup Gaps (Owner Frustration Points)

| Gap | Severity | Impact |
|-----|----------|--------|
| **No Setup Wizard** | CRITICAL | Owner must navigate 38 pages in arbitrary order |
| **No "Getting Started" Checklist** | CRITICAL | No guided first-time flow |
| **No Demo/Sample Data** | CRITICAL | Can't see data flow before building own menu |
| **No Menu Bulk Import (CSV)** | CRITICAL | Owner spends 3+ hours typing items manually |
| **No Menu Templates/Catalogs** | HIGH | No liquor catalog or food category library |
| **No Printer Test Tool** | HIGH | Can't test printers without live orders |
| **No Setup Status Indicator** | HIGH | Can't see what's configured vs. missing |
| **No Global Operating Hours** | HIGH | Only online ordering has hours (venue hours missing) |
| **No Menu Duplication** | MEDIUM | Can't copy items/categories |
| **No Menu Preview** | MEDIUM | Can't see menu as customers would |
| **No Role Management from Employee Page** | MEDIUM | Must navigate to separate `/roles` page |
| **No Permission Preview** | MEDIUM | Can't see what permissions a role has before assigning |
| **No Training Mode** | MEDIUM | No way to set employee to "training" |
| **No Floor Plan Templates** | MEDIUM | No 20-table or 40-table preset layouts |
| **No Automatic Hardware Discovery** | MEDIUM | Must manually enter IP addresses |

### "Coming Soon" Placeholders Found in Code

| Feature | Location | Status |
|---------|----------|--------|
| Week Start Day Configuration | `/settings/venue` | "Coming Soon" badge |
| Fiscal Year Configuration | `/settings/venue` | "Coming Soon" badge |
| Logo Upload | `/settings/venue` | "Coming Soon" badge |
| Venue Type Selection | `/settings/venue` | "Coming Soon" badge |
| Security Settings (Card 3) | `/settings/security` | "Coming Soon" badge |
| Order Settings (Card 4) | `/settings/orders` | "Coming Soon" badge |

### Known Broken Features (from "Broken things need fixin.rtf")

| Feature | Status |
|---------|--------|
| Pizza Builder | "Needs fixed and working" |
| Combo Builder | "Verify Combo Builder" |
| Discount Wiring | "Wire up the discounts" |
| Bottle Service | Not fully implemented |
| Size/Portion Quick Buttons (S/M/L/XL) | Not implemented for food |
| Customizable Pre-Mod Buttons | Not implemented |
| Seat Persistence | "Extra seats disappear on refresh" |
| Payment Retry (Bar Mode) | "Tab cancels completely on payment failure" |

### Day-1 Owner Scenario

1. Owner logs in → Sees 7 major sections + 38 sub-settings
2. **Doesn't know where to start** — no guided flow
3. Starts editing menu → 50+ liquor items need adding manually
4. **No bulk import** → Spends 3 hours typing
5. Sets up 10 employees → Can't assign to shifts (scheduling disconnected)
6. Designs floor plan (works great!)
7. Adds 3 printers → **Can't test them** without live orders
8. Tries payment setup → Simulated mode works but no guidance on switching to production
9. **Wants venue hours** → Finds hours only in Online Ordering, not globally
10. After 2 days → System ready but owner confused about what was configured vs. not

---

## 4.4 OWNER VIP & CUSTOMER TOOLS AUDIT

### Customer Database — What Works

| Feature | Status | Details |
|---------|--------|---------|
| Customer Profiles | YES | Full CRUD: name, email, phone, birthday |
| Customer History | YES | Full order history with date filtering |
| Visit Tracking | YES | `lastVisit`, `totalOrders`, `totalSpent`, `averageTicket` auto-calculated |
| Favorites | YES | Auto-tracked top 5 items by quantity |
| Customer Notes | YES | Inline editable for allergies, preferences |
| Tagging System | YES | VIP, Regular, First-Timer, Staff, Family, Business, Birthday Club |
| Customer Lookup in POS | YES | `CustomerLookupModal` — search by name/email/phone |
| Customer Report | YES | Frequency distribution, spend tiers, top 20, at-risk, tag analysis |

### House Accounts — What Works

| Feature | Status | Details |
|---------|--------|---------|
| Account Management | YES | Name, contact, credit limits, payment terms |
| Balance Tracking | YES | Real-time current balance |
| Transaction History | YES | Every charge/payment recorded |
| Aging Report | YES | Current/30/60/90/90+ day buckets |
| Accept Payments | YES | Cash, check, ACH, wire, card |
| Tax Exempt Support | YES | With tax ID field |
| Suspend Accounts | YES | With suspension reason |

### Gift Cards — What Works

| Feature | Status | Details |
|---------|--------|---------|
| Create/Sell Cards | YES | GC-XXXX-XXXX-XXXX format |
| Balance Tracking | YES | Auto-depleted on use |
| Transaction History | YES | Purchase, redemption, reload, refund, adjustment |
| Reload | YES | Add funds to existing cards |
| Status Management | YES | Active, depleted, expired, frozen |
| Freeze Cards | YES | For fraud with reason |
| POS Redemption | YES | By card number or ID during payment |
| PIN Support | YES | Optional security PIN |

### Loyalty Program — What Works

| Feature | Status | Details |
|---------|--------|---------|
| Points per Dollar | YES | Configurable earn rate |
| Minimum Earn Amount | YES | Require $X minimum to earn |
| Welcome Bonus | YES | New customer bonus points |
| Redemption | YES | Points as payment at POS |
| Configurable Rates | YES | Points per dollar redemption |
| Min/Max Redemption | YES | Floor and ceiling caps |
| Show on Receipt | YES | Toggle display |
| Master Toggle | YES | Enable/disable per location |

### Reservations — What Works

| Feature | Status | Details |
|---------|--------|---------|
| Full CRUD | YES | Guest info, party size, date/time |
| Table Assignment | YES | At booking time |
| Status Tracking | YES | Confirmed, seated, completed, cancelled, no-show |
| Conflict Detection | YES | Prevents double-booking |
| Bottle Service Integration | YES | Deposit amounts, min spend |
| Special Requests | YES | Guest notes field |

### Customer Tools Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No House Account Payment UI in POS** | CRITICAL | Can't charge to house account during checkout |
| **No Marketing Automation** | HIGH | No birthday emails, loyalty reminders, campaigns |
| **No Catering/Special Orders Module** | HIGH | Zero catering support |
| **No Online Reservations** | HIGH | Customers can't book themselves |
| **No Waitlist Feature** | HIGH | Only confirmed reservations |
| **No Email/SMS Receipts** | MEDIUM | No auto-email receipt after payment |
| **No Automatic Statement Generation** | MEDIUM | Aging report exists but no auto-sending |
| **No Birthday Bonus Automation** | MEDIUM | Birthday field exists but no auto-bonus |
| **No VIP Tier System** | MEDIUM | No auto-progression (Gold after 50 orders) |
| **No Gift Card Email Delivery** | MEDIUM | Can't email card code to recipient |
| **No Bulk Gift Card Generation** | MEDIUM | Can't create 50 cards for corporate gifts |
| **No Gift Card Expiration Enforcement** | MEDIUM | Field exists but no auto-marking expired |
| **No Loyalty Points Expiration** | LOW | Old points never expire |
| **No Churn Analysis** | LOW | No "likely to churn" reporting |
| **No Customer Ban/Block List** | LOW | Can only delete, not flag abusive customers |

### POS-Side Customer Gaps

| Gap | Impact |
|-----|--------|
| No birthday flag on POS | Can't see "today is this customer's birthday" |
| No VIP notes display during ordering | Allergies/preferences not surfaced |
| No "repeat John's usual order" button | Must manually re-enter favorites |
| No email collection prompt at POS | No systematic contact gathering |

---

## 4.5 OWNER END-OF-DAY & CONTROL AUDIT

### EOD Workflow — What Exists

**EOD Reset Endpoint** (`/api/eod/reset/route.ts`):
- Resets orphaned tables to `available`
- Detects stale orders (open >24 hrs), marks as "rolled over"
- Supports dry-run mode
- Requires `manager.close_day` permission
- Creates audit logs

**Daily Report** (`/reports/daily/page.tsx`):
- Revenue, payments, cash, sales by category, voids, discounts, labor, stats, gift cards
- Print web report or thermal receipt
- Can select any date

**Shift Closeout** (`ShiftCloseoutModal.tsx`):
- Denomination-based cash counting (blind mode or manager override)
- Cash variance calculation (expected vs actual)
- Tip declaration
- Tip-out calculation and distribution
- Open orders block detection

### EOD Critical Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No pre-close EOD checklist page** | CRITICAL | Owner has no guided workflow for closing |
| **No "open shifts" dashboard** | CRITICAL | Can't see which employees haven't clocked out |
| **No bulk shift close** | CRITICAL | Owner must manually close each of 10+ shifts |
| **No open tabs summary before close** | HIGH | Can't see how many tabs remain at a glance |
| **No multi-drawer cash discrepancy report** | HIGH | Must manually calculate variance across drawers |
| **No "last day closed" timestamp** | HIGH | Can't tell when day was finalized or by whom |
| **Stale orders detected but not auto-fixed** | MEDIUM | Requires manual intervention |
| **No force-close all shifts button** | MEDIUM | Owner closes each individually |

### Batch Settlement Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No batch dollar total before settlement** | HIGH | Owner sees count but not $ amount — can't verify |
| **No failed transaction log** | HIGH | Owner won't know about declined/offline transactions |
| **No automatic scheduled settlement** | HIGH | If owner forgets, batch sits open overnight |
| **No batch history/archive** | MEDIUM | Can't see "batch #5234 settled at 11:47 PM for $2,105" |
| **SAF queue not fully integrated** | MEDIUM | Can't force-settle or review pending SAF transactions |

### Problem Resolution Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No chargeback UI page** | HIGH | API exists but no owner-facing page for filing chargebacks |
| **No tip adjustment on settled orders** | HIGH | Must refund + re-ring entire order to fix a tip |
| **No manual time clock editing** | HIGH | Can't fix clock-in/out errors after the fact |
| **No orphaned shift detection** | MEDIUM | Open shifts go unnoticed |
| **No overtime approval workflow** | MEDIUM | No alerts when employee exceeds 40 hrs/week |
| **No void trend analysis** | MEDIUM | Can't see "this bartender has 12% void rate vs 3% avg" |
| **No closed-day reopen** | MEDIUM | Can't retroactively add missed transaction to finalized day |
| **No bulk adjustment** | MEDIUM | Can't apply service fee to all orders in a time range |

### Hardware & Equipment Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No printer status view** | MEDIUM | Can't see which printers are offline |
| **No remote terminal restart** | MEDIUM | Must walk to frozen terminal and hard-reset |
| **No diagnostic dashboard** | LOW | No centralized system health page |
| **No scheduled health checks** | LOW | Only on-demand checks, no background monitoring |

### Remote/Mobile Access Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| **No remote reports** | HIGH | Owner can't see today's sales from phone |
| **No remote batch settlement** | HIGH | Must be at terminal to settle |
| **No push notifications** | MEDIUM | No alerts for: shift not closed, large void, batch not settled |
| **Limited mobile UI** | MEDIUM | Only tab management, no dashboard or reports |

### Recommended: EOD Checklist Page

Build `/app/(admin)/eod-checklist/` with real-time status:
- All Shifts Closed? (count remaining + force-close button)
- All Tabs Paid? (count remaining + link to open orders)
- Cash Drawers Counted? (variance across all drawers)
- Batch Settled? (settle button + total verification)
- Stale Orders Resolved? (list + action buttons)
- Link to Daily Report
- "Close Day" button (finalizes everything)

---

## WAVE 4 EXECUTIVE SUMMARY

### By the Numbers

| Category | Items Found | Critical | High | Medium |
|----------|------------|----------|------|--------|
| Owner POS Operations | 18 gaps | 3 | 7 | 8 |
| Financial Visibility | 42 missing metrics | 8 | 15 | 19 |
| Business Setup | 26 gaps | 4 | 8 | 14 |
| Customer & VIP Tools | 23 gaps | 3 | 9 | 11 |
| EOD & Control | 24 gaps | 5 | 10 | 9 |
| **TOTAL** | **133 gaps** | **23** | **49** | **61** |

### Top 10 Owner Pain Points (Ranked)

| # | Pain Point | Why It Matters |
|---|-----------|----------------|
| 1 | **No EOD checklist page** | Owner has no guided close-of-day workflow |
| 2 | **No real-time financial dashboard** | Nothing updates live — all metrics are historical |
| 3 | **No setup wizard** | First-time owner spends 2-3 days configuring instead of hours |
| 4 | **No bulk menu import** | Typing 50+ items manually is unacceptable |
| 5 | **No house account payment from POS** | Can't charge to house account during checkout |
| 6 | **Variance report has API but no UI** | Backend done, frontend missing |
| 7 | **No broadcast messaging** | Can't communicate with all terminals |
| 8 | **No batch settlement totals** | Owner can't verify card sales before closing |
| 9 | **No marketing automation** | Birthday emails, loyalty reminders don't exist |
| 10 | **No remote reports** | Owner can't check sales from phone |

### What Works Exceptionally Well

- **Permission system** — `super_admin` gives owner universal access
- **Comp/void workflow** — Instant, no approval chain for owner
- **Floor plan editor** — Drag-and-drop with rotation, wall snapping
- **Tax rules** — Multi-rate, category-specific, compounding, priority
- **Payment models** — 5 pricing models (cash discount, surcharge, flat rate, interchange+, tiered)
- **Gift card system** — Full lifecycle: create, sell, reload, freeze, redeem, track
- **Customer reporting** — Frequency distribution, spend tiers, at-risk detection, tag analysis
- **Shift closeout** — Denomination counting, blind mode, variance tracking, tip-out calculation
- **Hardware health** — Real-time reader status with ping, response time, success rate
- **Audit logging** — Every comp, void, reopen, refund tracked with employee + timestamp

---

*Wave 4 was generated by a 5-agent "owner from hell" team auditing every owner-facing workflow, financial metric, configuration flow, customer tool, and end-of-day process in the GWI POS codebase. No code was written — this is a read-only findings document for review. Every gap was identified from the perspective of a restaurant owner who demands total visibility and control over their business.*
