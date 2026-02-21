# GWI POS — Complete System Audit
**Date:** February 11, 2026
**Audited by:** 6 parallel Claude agents

---

## SECTION 0: NAVIGATION REMAPPING PLAN

### Philosophy
**Default locked, promote forward.** Everything goes behind `/settings/*` first. Promote to top-level only when operational speed demands it. Easier to open doors than close them.

### Permission Model
- `/settings/*` requires authentication + at least one `settings.*` permission
- Each section has its own permission — no permission = section is **invisible** (not disabled, invisible)
- Employees granted a specific permission see ONLY that section in the hamburger menu
- Top-level operational pages have their own individual permissions

### Top-Level Operational Pages (outside /settings/)

```
Route               Permission Required          Who Uses It
─────────────────────────────────────────────────────────────
/login              none (pre-auth)              Everyone
/orders             pos.access                   Servers, bartenders, managers
/kds                kds.access                   Kitchen staff
/kds/pair           device (no auth)             KDS device setup
/kds/entertainment  kds.entertainment            Entertainment KDS operator
/86                 menu.eighty_six              Servers (hot path during service)
/counts             inventory.counts             Prep cooks (morning counts)
/crew               authenticated (any)          All employees (self-service hub)
/crew/shift         authenticated (any)          Clock in/out, breaks
/crew/tips          authenticated (any)          View my tip shares
/crew/tip-bank      authenticated (any)          View my banked tips
/crew/tip-group     authenticated (any)          View my tip group
/crew/commission    authenticated (any)          View my commissions
/pay-at-table       none (guest QR)              Customers
/mobile/tabs        pos.mobile                   Bartenders on phone
/cfd                none (device)                Customer-facing display
/approve-void/[t]   none (public SMS link)       Managers (off-site void approval)
```

### Admin Menu: `/settings/*` (hamburger menu — permission-gated per section)

```
═══════════════════════════════════════════════════════════════
🏢 VENUE                          permission: settings.venue
═══════════════════════════════════════════════════════════════
   Business Info          /settings/venue            NEW (name, address, logo, hours, timezone)
   General                /settings/general          was /settings
   Tax Rules              /settings/tax-rules        was /tax-rules
   Order Types            /settings/order-types      already here
   Order Numbering        /settings/orders           NEW

═══════════════════════════════════════════════════════════════
🍔 MENU                           permission: settings.menu
═══════════════════════════════════════════════════════════════
   Menu Builder           /settings/menu             was /menu
   Ingredients            /settings/ingredients      was /ingredients
   Combos                 /settings/combos           was /combos
   Liquor Builder         /settings/liquor-builder   was /liquor-builder
   Pizza                  /settings/pizza            was /pizza (hide if no pizza category)
   Discounts              /settings/discounts        was /discounts (ONE home only)

═══════════════════════════════════════════════════════════════
📦 INVENTORY                      permission: settings.inventory
═══════════════════════════════════════════════════════════════
   Stock Adjust           /settings/inventory
   Items                  /settings/inventory/items
   Beverages              /settings/inventory/beverages
   Daily Counts           /settings/inventory/daily-prep-counts
   Counts                 /settings/inventory/counts
   Waste Log              /settings/inventory/waste
   Transactions           /settings/inventory/transactions
   Vendors                /settings/inventory/vendors
   Inventory Config       /settings/inventory/config  was /inventory/settings

═══════════════════════════════════════════════════════════════
🪑 FLOOR & TABLES                 permission: settings.floor
═══════════════════════════════════════════════════════════════
   Floor Plan Editor      /settings/floor-plan       was /floorplan/editor
   Reservations           /settings/reservations     was /reservations
   Entertainment          /settings/entertainment    was /timed-rentals
   Events                 /settings/events           was /events

═══════════════════════════════════════════════════════════════
👥 CUSTOMERS                      permission: settings.customers
═══════════════════════════════════════════════════════════════
   Customer List          /settings/customers        was /customers
   Gift Cards             /settings/gift-cards       was /gift-cards
   House Accounts         /settings/house-accounts   was /house-accounts
   Coupons                /settings/coupons          was /coupons

═══════════════════════════════════════════════════════════════
👔 TEAM                           permission: settings.team
═══════════════════════════════════════════════════════════════
   Employees              /settings/employees        was /employees
   Roles & Permissions    /settings/roles            was /roles
   Scheduling             /settings/scheduling       was /scheduling
   Payroll                /settings/payroll          was /payroll
   Payroll Config         /settings/payroll/config   NEW (pay periods, OT, taxes)
   Clock-Out Policies     /settings/clock-out        NEW
   Crew Hub (view)        /settings/crew             link to /crew for admin view

═══════════════════════════════════════════════════════════════
💰 TIPS                           permission: settings.tips
═══════════════════════════════════════════════════════════════
   Tip Settings           /settings/tips             was orphaned
   Tip-Out Rules          /settings/tip-outs         was in Settings section
   Tip Groups             /settings/tip-groups       was in Reports section
   Tip Payouts            /settings/tip-payouts      was orphaned
   Tip Adjustments        /settings/tip-adjustments  was orphaned

═══════════════════════════════════════════════════════════════
💳 PAYMENTS                       permission: settings.payments
═══════════════════════════════════════════════════════════════
   Payment Config         /settings/payments         NEW (23 hidden settings)
   Receipts               /settings/receipts         NEW (35 receipt settings)
   Tabs & Pre-Auth        /settings/tabs             NEW (bar tab policies)
   Quick Pay              /settings/quick-pay        NEW (threshold, $ vs % tips)

═══════════════════════════════════════════════════════════════
📊 REPORTS                        permission: settings.reports
═══════════════════════════════════════════════════════════════
   ── My Reports ──
   My Shift               /settings/reports/shift
   My Commissions         /settings/reports/commission

   ── Sales ──
   Daily Summary          /settings/reports/daily
   Sales                  /settings/reports/sales
   Product Mix            /settings/reports/product-mix
   Order History          /settings/reports/order-history
   Liquor                 /settings/reports/liquor

   ── Team ──
   Employee Reports       /settings/reports/employees
   Payroll Report         /settings/reports/payroll
   Tips Report            /settings/reports/tips

   ── Operations ──
   Voids & Comps          /settings/reports/voids
   Reservations           /settings/reports/reservations
   Coupons                /settings/reports/coupons

═══════════════════════════════════════════════════════════════
🔧 HARDWARE                      permission: settings.hardware
═══════════════════════════════════════════════════════════════
   Overview               /settings/hardware
   Printers               /settings/hardware/printers
   KDS Screens            /settings/hardware/kds-screens
   Print Routing          /settings/hardware/routing
   Terminals              /settings/hardware/terminals
   Payment Readers        /settings/hardware/payment-readers
   Prep Stations          /settings/hardware/prep-stations  was orphaned

═══════════════════════════════════════════════════════════════
🔒 SECURITY                      permission: settings.security
═══════════════════════════════════════════════════════════════
   PIN & Lockout          /settings/security
   Blocked Cards          /settings/security/blocked-cards   NEW
   Suspicious Tip Alerts  /settings/security/tip-alerts      NEW
   Auto-Gratuity          /settings/security/auto-gratuity   NEW

═══════════════════════════════════════════════════════════════
🔌 INTEGRATIONS                  permission: settings.integrations
═══════════════════════════════════════════════════════════════
   SMS (Twilio)           /settings/integrations/sms
   Email (Resend)         /settings/integrations/email
   Slack                  /settings/integrations/slack

═══════════════════════════════════════════════════════════════
⏰ AUTOMATION                    permission: settings.automation
═══════════════════════════════════════════════════════════════
   EOD & Day Boundary     /settings/automation/eod
   Report Scheduling      /settings/automation/reports
   Walkout Recovery       /settings/automation/walkouts

═══════════════════════════════════════════════════════════════
🖥️ MONITORING                   permission: settings.monitoring
═══════════════════════════════════════════════════════════════
   Dashboard              /settings/monitoring
   Error Logs             /settings/monitoring/errors
   Card Profiles          /settings/monitoring/card-profiles  NEW
   Walkout Queue          /settings/monitoring/walkouts       NEW
```

### Route Migration Map (old → new)

| Current Route | New Route | Action |
|--------------|-----------|--------|
| `/settings` | `/settings/general` | Redirect |
| `/menu` | `/settings/menu` | Redirect |
| `/ingredients` | `/settings/ingredients` | Redirect |
| `/combos` | `/settings/combos` | Redirect |
| `/discounts` | `/settings/discounts` | Redirect |
| `/liquor-builder` | `/settings/liquor-builder` | Redirect |
| `/pizza` | `/settings/pizza` | Redirect |
| `/inventory` | `/settings/inventory` | Redirect |
| `/inventory/*` | `/settings/inventory/*` | Redirect |
| `/floorplan/editor` | `/settings/floor-plan` | Redirect |
| `/reservations` | `/settings/reservations` | Redirect |
| `/timed-rentals` | `/settings/entertainment` | Redirect |
| `/events/*` | `/settings/events/*` | Redirect |
| `/customers` | `/settings/customers` | Redirect |
| `/gift-cards` | `/settings/gift-cards` | Redirect |
| `/house-accounts` | `/settings/house-accounts` | Redirect |
| `/coupons` | `/settings/coupons` | Redirect |
| `/employees` | `/settings/employees` | Redirect |
| `/roles` | `/settings/roles` | Redirect |
| `/scheduling` | `/settings/scheduling` | Redirect |
| `/payroll` | `/settings/payroll` | Redirect |
| `/tip-groups` | `/settings/tip-groups` | Redirect |
| `/tips/payouts` | `/settings/tip-payouts` | Redirect |
| `/tips` | `/settings/tip-adjustments` | Redirect |
| `/tax-rules` | `/settings/tax-rules` | Redirect |
| `/prep-stations` | `/settings/hardware/prep-stations` | Redirect |
| `/monitoring` | `/settings/monitoring` | Redirect |
| `/monitoring/errors` | `/settings/monitoring/errors` | Redirect |
| `/reports/*` | `/settings/reports/*` | Redirect |
| `/tabs` | Remove (use /orders) | Delete page |
| `/virtual-groups` | Remove (fold into floor-plan) | Delete page |
| `/links` | Remove (dev-only) | Delete page |

### Pages to Remove
- `/tabs` — functionality lives in `/orders` BartenderView
- `/virtual-groups` — fold into `/settings/floor-plan`
- `/links` — dev utility, not for production

### Top-Level Exceptions (kept outside /settings/ for speed)
- `/86` — servers need instant access during service rush
- `/counts` — prep cooks need this at start of shift
- Both still require their own permission to access

---

## The Big Picture

| Metric | Count |
|--------|-------|
| UI Pages | ~70 |
| API Routes | ~346 |
| HTTP Endpoints | ~850+ |
| **Total Settings/Toggles** | **220+** |
| Settings WITH admin UI | ~60 |
| Settings WITHOUT admin UI | **~160** |
| Orphaned Pages (no nav) | 16 |
| Dead API Calls | 2 (critical) |
| Missing Features for Go-Live | 25+ |

---

## SECTION A: CRITICAL BUGS (Fix Now)

| # | Issue | File | Impact |
|---|-------|------|--------|
| 1 | `/api/menu/items/{id}/modifiers` returns **410 Gone** | `orders/page.tsx:2282` | Modifier loading broken on POS |
| 2 | Same 410 endpoint called from combos | `combos/page.tsx:146` | Combo modifier loading broken |
| 3 | Tip percentages defined in **4 conflicting places** | settings.ts, receipt-settings.ts, datacap/constants.ts | Which one actually runs at payment time? |
| 4 | Timezone mismatch in seed data | `seed.ts` — New York timezone, Austin address | Reports will show wrong times |
| 5 | 8% tax rate hardcoded as fallback | `order-calculations.ts:142`, `seat-utils.ts:9` | Silent wrong tax if settings not loaded |

---

## SECTION B: UNREACHABLE PAGES (Built But No Way to Get There)

### Critical — Core features users can't access:
| Page | Route | What It Does |
|------|-------|-------------|
| Tip Bank Settings | `/settings/tips` | The entire tip bank configuration page — not in any nav menu |
| Employee Tip Bank | `/crew/tip-bank` | Where employees see banked tips — unreachable |
| Tip Payouts | `/tips/payouts` | Admin batch tip payouts — unreachable |

### Important — Should be in AdminNav:
| Page | Route | What It Does |
|------|-------|-------------|
| Monitoring Dashboard | `/monitoring` | Error logs & system health |
| Monitoring Errors | `/monitoring/errors` | Detailed error viewer |
| Prep Stations | `/prep-stations` | Kitchen station config |
| Bar Tabs (standalone) | `/tabs` | Tab management page |
| Crew Hub | `/crew` | Employee self-service portal |
| Crew Tips / Tip Groups | `/crew/tips`, `/crew/tip-group` | Employee tip views |
| POS Tip Adjustments | `/tips` | Post-payment tip editing |

### Dead Internal Link:
| Source | Target | Issue |
|--------|--------|-------|
| `/monitoring` dashboard | `/monitoring/health` | Page doesn't exist |

---

## SECTION C: VENUE SETUP — What a New Bar Needs (Day 1)

### Exists but NO admin UI to configure:
| Setting | Stored In | How It's Set Today |
|---------|-----------|-------------------|
| Business name | `Location.name` | Seed data only |
| Address | `Location.address` | Seed data only |
| Phone | `Location.phone` | Seed data only |
| Timezone | `Location.timezone` | Seed data only |

### Completely Missing from schema:
| Need | Why It Matters |
|------|---------------|
| Logo upload | Receipts, CFD, online ordering |
| Operating hours (per day) | "We're closed" enforcement, online ordering |
| Week start day (Sun/Mon) | Weekly reports start on wrong day |
| Fiscal year start | YTD calculations incorrect |
| Structured address (city/state/zip) | Tax jurisdiction, reporting |
| EIN / Tax ID | Payroll, 1099s |
| Venue type | Smart defaults (bar vs restaurant) |
| Currency / locale | Hardcoded to USD/en-US everywhere |

### 16+ hardcoded `loc-1` references across settings pages — multi-location will break.

**Recommended: Build `/settings/venue` page for one-time business setup.**

---

## SECTION D: SETTINGS WITHOUT ADMIN UI (The Dark Zone — 160+ Settings)

### Receipt Display (~35 settings, ZERO UI)
Fully defined in `GlobalReceiptSettings` type — controls what shows on receipts (items, prices, modifiers, tax breakdown, signature, copies, footer text, kitchen ticket format, bar ticket format). All configurable in code but no settings page exists.

**Recommended: Build `/settings/receipts` page.**

### Payment Processing (~23 of 30 settings have NO UI)
| Missing from UI | Default | What It Does |
|-----------------|---------|-------------|
| `quickPayEnabled` | true | Quick pay mode on/off |
| `tipDollarAmountThreshold` | $15 | Under this: show $ tips not % |
| `tipDollarSuggestions` | [1,2,3] | Dollar tip buttons |
| `tipPercentSuggestions` | [18,20,25] | Percent tip buttons |
| `requireCustomForZeroTip` | true | Must tap Custom to skip tip |
| `walkoutRetryEnabled` | true | Auto-retry walkout tabs |
| `walkoutRetryFrequencyDays` | 3 | Days between retries |
| `walkoutMaxRetryDays` | 30 | Stop retrying after X days |
| `defaultPreAuthAmount` | $100 | Default tab pre-auth |
| `preAuthExpirationDays` | 7 | Pre-auth expiry |
| `requireSignatureAbove` | $25 | Signature threshold |
| `bottleServiceEnabled` | false | Bottle service on/off |
| `cardRecognitionEnabled` | true | Track repeat customers |
| `digitalReceiptRetentionDays` | 90 | Receipt storage |

**Recommended: Expand `/settings` payments section or create `/settings/payments`.**

### Payroll Settings (~20 settings, ZERO UI)
Full PayrollSettings model exists in Prisma — pay period type, overtime rules, tax rates, minimum wages, break requirements. All unused because no admin page.

**Recommended: Build `/settings/payroll`.**

### Inventory Settings (~20 settings, ZERO UI)
InventorySettings model exists — tracking mode, deduction timing, prep stock, variance alerts, food cost targets, modifier multipliers, pour sizes. No admin page.

**Recommended: Build `/settings/inventory` or add to existing `/inventory/settings`.**

### Bar Tab Policies (4 settings, ZERO UI)
| Setting | Default | What It Does |
|---------|---------|-------------|
| `requireCardForTab` | false | Require card to open tab |
| `allowNameOnlyTab` | true | Allow name-only tabs |
| `tabTimeoutMinutes` | 240 | Tab inactivity warning |
| `pullCustomerFromCard` | true | Auto-fill name from card |

### Clock-Out Policies (3 settings, ZERO UI)
| Setting | Default | What It Does |
|---------|---------|-------------|
| `requireSettledBeforeClockOut` | true | Check open orders |
| `requireTipsAdjusted` | false | Check unadjusted tips |
| `allowTransferOnClockOut` | true | Allow tab transfer |

### POS Display (8 settings, no location-level UI)
Menu item size, grid columns, category style, order panel width, etc. Employees can customize per-person but admins can't set location defaults.

---

## SECTION E: COMPLETELY MISSING FEATURES

### Security & Fraud Prevention
| Feature | Status | Impact |
|---------|--------|--------|
| **Blocked card / flagged customer** | NOT BUILT | Walkout can come back and open new tab |
| **Suspicious tip alerts** | NOT BUILT | $500 tip on $30 tab goes unnoticed (typo protection) |
| **Auto-gratuity admin config** | Logic exists, threshold hardcoded | Can't configure party size or % |
| **Manager PIN lockout config** | Hardcoded at 3 attempts | Can't adjust security policy |

### Automation (Settings exist but nothing triggers them)
| Feature | Settings Exist? | Automation Built? |
|---------|----------------|-------------------|
| EOD batch close | `batchAtDayEnd: true` | NO — manual trigger only |
| Force clock-out at day boundary | `enforceClockOut: true` | NO — no background process |
| Force tab close at day boundary | `enforceTabClose: true` | NO — no background process |
| Walkout auto-retry | `walkoutRetryEnabled: true` | NO — no cron job |
| Auto-detect walkout tabs | `walkoutAutoDetectMinutes: 120` | NO — nothing reads this |
| Low stock alerts | Settings exist | NO — no alert trigger |
| Max tab amount alert | `maxTabAlertAmount: 500` | NO — no alert fires |
| **No cron/scheduler system exists at all** | — | CRITICAL gap |

### Payments & Tenders
| Feature | Status |
|---------|--------|
| **Custom tender types** | Hardcoded to 5 types (`cash`, `credit`, `debit`, `gift_card`, `house_account`). Can't add EBT, employee meal, comp, check, loyalty points |
| **Auto-close tabs with %** | Not built. Settings mention auto-close at day boundary but no auto-charge + close |

### Order Management
| Feature | Status |
|---------|--------|
| **Order number configuration** | Resets daily from 1. No config for starting number, format, prefix, or per-type sequences |
| **Ticket numbering** | Same — no admin control |

### Reporting & Accounting
| Feature | Status |
|---------|--------|
| **Automated report delivery** | NOT BUILT — no email/schedule system |
| **Bookkeeper/accountant access** | NOT BUILT — no read-only external role |
| **IRS Form 8027 reporting** | NOT BUILT — 8% minimum hardcoded, no batch report |
| **Cash declaration UI** | API exists, NO employee-facing page |
| **Forced declaration at clock-out** | No setting exists |

---

## SECTION F: INTEGRATION GAPS

### 3rd Party Services (All env-var only, no admin UI)
| Service | Purpose | Code Status | Admin UI? |
|---------|---------|-------------|-----------|
| Twilio (SMS) | Void approval, alerts | Complete | NO — env vars only |
| Resend (Email) | Error alerts | Complete | NO — env vars only |
| Slack | Webhook alerts | Complete | NO — env vars only |
| Datacap | Payment processing | Complete + simulated | Partial |

**Recommended: Build `/settings/integrations` page for API keys, test buttons, recipient management.**

### Card Intelligence (Built but invisible)
- `CardProfile` model tracks visits, spend, card fingerprint
- NO admin UI to view profiles
- NO blocked/flagged card system
- NO linkage between CardProfile and Customer records
- NO VIP tier system

---

## SECTION G: DUPLICATE/CONFUSION ISSUES

| Issue | Details | Fix |
|-------|---------|-----|
| **4 tip percentage arrays** | `/settings` (18,20,22,25), `/settings/tips` (15,18,20,25), PaymentSettings (18,20,25), ReceiptSettings (18,20,22) | Consolidate to ONE source |
| **2 signature thresholds** | ReceiptSettings: null (always), PaymentSettings: $25 | Pick one |
| **Discounts in 2 nav sections** | Menu Builder AND Customers | Pick one home |
| **`/inventory` vs `/ingredients`** | Both exist, both render IngredientLibrary | Clarify which is canonical |
| **`/tax-rules` not under `/settings/`** | Inconsistent URL | Move to `/settings/tax-rules` |

---

## SECTION H: RECOMMENDED NEW PAGES

Based on everything found, here are the admin pages that need to be built:

| Priority | Page | What It Configures |
|----------|------|--------------------|
| **P0** | `/settings/venue` | Business name, address, phone, timezone, logo, hours, week start, fiscal year |
| **P0** | `/settings/payments` | All 23 hidden payment settings, Quick Pay, walkout, pre-auth, signature, tips |
| **P0** | `/settings/receipts` | All 35 receipt display settings (content, tips, signature, kitchen, bar) |
| **P1** | `/settings/payroll` | Pay periods, overtime, taxes, minimum wage, breaks |
| **P1** | `/settings/security` | PIN lockout, void expiry, approval timeouts, blocked cards |
| **P1** | `/settings/integrations` | Twilio, Resend, Slack API keys + test buttons |
| **P1** | `/settings/tabs` | Bar tab policies, auto-close, walkout, declined retry |
| **P2** | `/settings/inventory` | Tracking mode, deductions, alerts, multipliers, pour sizes |
| **P2** | `/settings/automation` | EOD batch, report scheduling, alert recipients |
| **P2** | `/settings/orders` | Order numbering, ticket format, custom tenders |
| **P3** | `/admin/card-profiles` | View customer card intelligence data |
| **P3** | `/admin/walkouts` | View/manage walkout retry queue |

---

## SECTION I: EXISTING SETTINGS (Full Inventory — 220+)

### Location Settings (stored in `Location.settings` JSON)

#### Tax Settings (`settings.tax`) — 4 settings, 2 have UI
- `defaultRate`: number (8.0) — UI: /settings
- `calculateAfterDiscount`: boolean (true) — UI: /settings
- `taxInclusiveLiquor`: boolean (false) — NO UI
- `taxInclusiveFood`: boolean (false) — NO UI

#### Cash Discount / Dual Pricing (`settings.dualPricing`) — 5 settings, all have UI
- `enabled`: boolean (true) — UI: /settings
- `cashDiscountPercent`: number (4.0) — UI: /settings (Super Admin)
- `applyToCredit`: boolean (true) — UI: /settings
- `applyToDebit`: boolean (true) — UI: /settings
- `showSavingsMessage`: boolean (true) — UI: /settings

#### Price Rounding (`settings.priceRounding`) — 5 settings, all have UI
- `enabled`: boolean (false) — UI: /settings
- `increment`: enum ('none') — UI: /settings
- `direction`: enum ('nearest') — UI: /settings
- `applyToCash`: boolean (true) — UI: /settings
- `applyToCard`: boolean (false) — UI: /settings

#### Tip Settings (`settings.tips`) — 3 settings, all have UI
- `enabled`: boolean (true) — UI: /settings
- `suggestedPercentages`: number[] ([18,20,22,25]) — UI: /settings
- `calculateOn`: enum ('subtotal') — UI: /settings

#### Tip Share Settings (`settings.tipShares`) — 4 settings, all have UI
- `payoutMethod`: enum ('payroll') — UI: /settings/tips
- `autoTipOutEnabled`: boolean (true) — UI: /settings/tips
- `requireTipOutAcknowledgment`: boolean (true) — UI: /settings/tips
- `showTipSharesOnReceipt`: boolean (true) — UI: /settings/tips

#### Tip Bank Settings (`settings.tipBank`) — 12 settings, all have UI at /settings/tips
- `enabled`, `allocationMode`, `chargebackPolicy`, `allowNegativeBalances`
- `allowManagerInPools`, `poolCashTips`, `deductCCFeeFromTips`, `ccFeePercent`
- `allowEODCashOut`, `requireManagerApprovalForCashOut`, `defaultPayoutMethod`
- `tipAttributionTiming`

#### Tip Guide (`settings.tipBank.tipGuide`) — 4 settings, all have UI at /settings/tips
- `basis`, `percentages`, `showBasisExplanation`, `roundTo`

#### Receipt Settings (`settings.receipts`) — 4 settings, NO UI
- `headerText`, `footerText`, `showServerName`, `showTableNumber`

#### Payment Settings (`settings.payments`) — ~30 settings, only 5 have UI
- See Section D above for the 23 missing from UI

#### Loyalty Settings (`settings.loyalty`) — 11 settings, all have UI at /settings
- Full program config: points earning, redemption, receipt display, welcome bonus

#### Happy Hour Settings (`settings.happyHour`) — 10 settings, all have UI at /settings
- Schedules, discount type/value, category/item filters, badge display

#### Bar Tab Settings (`settings.barTabs`) — 4 settings, NO UI
- See Section D above

#### POS Display Settings (`settings.posDisplay`) — 8 settings, NO UI
- `menuItemSize`, `menuItemsPerRow`, `categorySize`, `orderPanelWidth`
- `categoryColorMode`, `categoryButtonBgColor`, `categoryButtonTextColor`
- `showPriceOnMenuItems`

#### Clock-Out Settings (`settings.clockOut`) — 3 settings, NO UI
- See Section D above

#### Business Day Settings (`settings.businessDay`) — 5 settings, all have UI at /settings
- `dayStartTime`, `enforceClockOut`, `enforceTabClose`, `batchAtDayEnd`, `graceMinutes`

#### Receipt Display Settings (`settings.receiptDisplay`) — ~35 settings, NO UI
- See Section D above

### Employee Settings (stored in `Employee.posLayoutSettings` JSON) — ~25 settings
- Mode, favorites, category order, quick bar, colors, quick pick, coursing
- Most accessible via gear dropdown in POS

### Database Config Models — ~80+ settings across dedicated tables
- InventorySettings (20), PayrollSettings (20), PizzaConfig (17)
- KDSScreen (8), Station (12), Terminal (7), PaymentReader (3)
- Role (5), CourseConfig (4), OrderType (6), BottleServiceTier (3)
- TipOutRule (6), DiscountRule (8), PrintRule (5)

### Feature Flags — 1
- `FLOOR_PLAN_V2_ENABLED` in `src/lib/feature-flags.ts`

### Environment Variables — 17
- DATABASE_URL, socket URLs, Twilio, Resend, Slack, CORS, etc.

---

## SECTION J: HARDCODED VALUES NEEDING CONFIGURATION

### Highest Priority
1. **Order numbering** — Resets daily from 1, no config (`src/app/api/orders/route.ts:33-44`)
2. **Payment types** — Hardcoded Zod enum of 5 (`src/lib/validations.ts:152`)
3. **Manager PIN lockout** — 3 attempts (`src/components/auth/ManagerPinModal.tsx:26`)
4. **Void approval expiry** — 30 min token, 5 min code (`src/app/api/voids/remote-approval/`)
5. **Drawer quick amounts** — [100, 150, 200, 250, 300] (`src/components/shifts/ShiftStartModal.tsx:29`)
6. **Tax rate fallback** — 8% in multiple places
7. **Week start** — Hardcoded to Sunday in 4+ files
8. **Currency** — Hardcoded to USD/en-US (`src/lib/utils.ts`)
9. **CFD idle timeout** — 10 seconds (`src/app/(cfd)/cfd/page.tsx:112`)
10. **KDS polling intervals** — 3-5 seconds, not configurable

### Polling Intervals (not admin-configurable)
- Entertainment KDS: 3s refresh
- KDS orders: 5s polling
- KDS heartbeat: 30s
- Expo screen: 3s polling
- Tab list: 10s refresh
- Mobile tabs: 10s polling
- Terminal heartbeat: 30s

---

## SECTION K: INTEGRATION STATUS

### Twilio (SMS) — Code complete, env vars only
- Functions: sendVoidApprovalSMS, sendApprovalCodeSMS, sendRejectionSMS, sendSMS
- Webhook: POST /api/webhooks/twilio/sms
- Missing: Admin UI, test button, recipient management

### Resend (Email) — Code complete, env vars only
- Functions: sendEmail, sendErrorAlertEmail
- Missing: Admin UI, template customization, report distribution

### Slack — Code complete, env vars only
- Function: sendSlackAlert
- Missing: Admin UI, multi-channel support

### Datacap (Payments) — Complete with simulated mode
- Full transaction support: Sale, PreAuth, Capture, Adjust, Void, Return, Increment
- Device discovery via UDP broadcast
- Simulated mode for development
- Go-live checklist in CLAUDE.md

### Socket.io — Fully built
- 18 dispatch functions
- Room-based routing (location, tag, terminal)
- Missing: INTERNAL_API_SECRET must be changed from default

---

## SECTION L: AUTOMATION GAPS

### No Cron/Scheduler System Exists
Settings that toggle on automation but nothing runs:
- `batchAtDayEnd: true` — no batch job
- `enforceClockOut: true` — no enforcement process
- `enforceTabClose: true` — no enforcement process
- `walkoutRetryEnabled: true` — no retry cron
- `walkoutAutoDetectMinutes: 120` — nothing reads this
- Low stock alert settings — no alert trigger
- `maxTabAlertAmount: 500` — no alert fires

### Client-Side Background Processes (these DO work)
- Health monitor: 60s interval
- Offline manager: 30s retry, 60s health check
- Payment intent sync: 15s interval
- Socket server stats: 60s logging

---

## SECTION M: NAVIGATION AUDIT RESULTS

### AdminNav — All 48 links valid (zero broken)
### AdminSubNav — All 46 links valid (zero broken)
### Links Page — All links valid

### Duplicate Navigation:
- "Discounts" appears in both Menu Builder AND Customers sections
- `/inventory` and `/ingredients` naming confusion

### Inconsistent URL:
- `/tax-rules` should be `/settings/tax-rules`
