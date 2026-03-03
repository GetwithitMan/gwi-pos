# Tips & Tip Bank Domain Changelog

## 2026-03-03 — Audit Remediation: Tips Guardrails (Skill 478)

### Shift-Scoped Pending Tips (M5)
- `GET /api/tips/pending-tips` now accepts optional `?shiftId=` query param; filters `Payment.shiftId` when provided (backward compat when omitted)
- Android `GwiApiService.getPendingTips()` gains `shiftId: String? = null` param
- `OrderViewModel.showShiftClose()` passes `openShift.id` — shift-close pending tip count is now scoped to the current shift
- `MyTipsViewModel` leaves `shiftId=null` (full history view is correct for My Tips screen)
- `GET /api/tips/pending-tips` response includes `shiftClosedAt` (payment shift's `endedAt`)

### Tip Edit Time Boundary (M6)
- `POST /api/tips/adjustments`: fetches `Payment → Shift`; rejects with 403 if `shift.status === 'closed'` and `endedAt` > 24h ago
- `GET /api/tips/recorded-tips` response includes `shiftClosedAt` field
- Android `PendingTipDto` / `RecordedTipDto` gain `shiftClosedAt: String?`
- `TipEntrySheet`: `shiftEditLocked` derived boolean disables Save + shows red warning when shift closed >24h

### Tip Size Cap (M2)
- Android (all three tip sheets): amber "Tip is over 50% of the order total" warning when `tipCents > orderTotal / 2` (soft — does not block submit)
- `POST /api/tips/adjustments`: hard-rejects tip > 200% of payment base (`payment.amount × 2`)

### Pending Tips in Shift Close (H1)
- `showShiftClose()` calls `getPendingTips(locId, empId, shiftId = openShift.id)`; stores count in `shiftClosePendingTipCount`
- `ShiftCloseSheet`: green "Pending tips: N" section with "Review Tips" button (navigates to `MyTipsScreen`)
- Callback threaded through `OrderScreen` → `OrderScreenSheets` → `ShiftCloseSheet`

---

## 2026-03-03 — Pending Tips + Self-Service Tip Adjustment

### Added
- `GET /api/tips/pending-tips` — returns closed card payments with tipAmount=0 for requesting employee (or all with TIPS_VIEW_LEDGER)
- `GET /api/tips/recorded-tips` — returns closed card payments with tipAmount>0 for requesting employee
- Self-service tip adjustment: `POST /api/tips/adjustments` with adjustmentType=tip_amount now allowed without TIPS_PERFORM_ADJUSTMENTS when employee owns the order
- `performTipAdjustment()` now updates `Payment.tipAmount` and `Payment.totalAmount` when adjustmentType=tip_amount
- Android: My Tips screen in hamburger menu — "Pending Tips" tab (enter paper receipt tips) + "My Tips" tab (correct recorded tips)
- Android: TipEntrySheet — percentage chips showing "20% • $9.60", custom amount, reason dropdown (NEW/EDIT modes)
- `noTipQuickButton` setting (default false) — owner controls whether "$0 Tip" quick button appears on tip prompt

### Changed
- Tip adjustment is now self-service for employees on their own orders. Manager permission still required for adjusting other employees' tips.

---

## 2026-02-24 — Payroll Formula, Atomic Transfers & Shift Close (`743e618`)

### Payroll Formula
- Ledger-only calculation: `DIRECT_TIP + TIP_GROUP` credits used as basis
- `bankedTipsCollected` excluded from `netTips` to prevent double-counting

### totalTipOuts Sign Fix
- `Math.abs` applied to DEBIT sum so `totalTipOuts` is always a positive value

### Batch Adjust-Tip
- Mirrors single-tip-adjust behavior: recalculates total, increments version, writes ledger entry, dispatches socket event

### Atomic Tip Transfers
- `$transaction` with balance check under lock prevents overdraw race conditions

### Shift Close
- Server-side `netTips` computation; client-submitted values are untrusted and overwritten

---

## 2026-02-11 — Skills 287-288: Tip Group Admin UI & Segment Timeline

### Skills Completed
- **287**: Tip Group Manager Admin UI — Manager dashboard for active tip group lifecycle on `/settings/tips` (Section 9)
- **288**: Group History & Segment Timeline — Timeline visualization of group split changes on `/settings/tips` (Section 10)
- **Fix**: Manager Role Permissions — Added 25 missing permissions (13 `settings.*` + 12 `tips.*`) to Manager role in seed.ts and live database

### What Was Done

**ActiveGroupManager Component (Skill 287 — 712 lines):**
- Expandable group cards showing status, split mode, owner, member count
- Member rows with name, role, join time, split %, stale badge (>12h active)
- Add Member modal with employee picker dropdown
- Remove member, transfer ownership, close group actions
- Pending join request section with approve/reject
- Manual tip adjustment modal (employee, amount, reason)
- All mutations via existing APIs with toast feedback

**GroupHistoryTimeline Component (Skill 288 — 429 lines):**
- Group selector dropdown (active + recently closed groups)
- Summary card: status, duration, total members
- Vertical timeline with colored dots and SVG icons:
  - Indigo (group_created), Green (member_joined), Red (member_left)
  - Blue (segment_change), Gray (group_closed)
- Split percentage badges on segment events
- Earnings summary table sorted by amount

**Page Integration:**
- Added 2 imports + 2 conditional renders to `/settings/tips` page after Section 8
- Components receive `locationId` + `employeeId` props from parent

**Manager Role Permissions Fix:**
- Discovered Manager role was missing `settings.tips` permission (and 24 others)
- SettingsNav checks `canView(permission)` — hiding entire Tips section
- Added to `prisma/seed.ts` managerPermissions array: 13 `settings.*` + 12 `tips.*`
- Updated live SQLite database via direct SQL
- Deduplicated any duplicate entries

### Files Created
- `src/components/tips/ActiveGroupManager.tsx` — Section 9 component
- `src/components/tips/GroupHistoryTimeline.tsx` — Section 10 component
- `docs/skills/287-TIP-GROUP-MANAGER-ADMIN-UI.md` — Skill documentation
- `docs/skills/288-GROUP-HISTORY-SEGMENT-TIMELINE.md` — Skill documentation

### Files Modified
- `src/app/(admin)/settings/tips/page.tsx` — 2 imports + 2 component renders
- `prisma/seed.ts` — 25 new permissions added to Manager role

### APIs Used (No New Routes)
| API | Method | Section | Purpose |
|-----|--------|---------|---------|
| `/api/tips/groups?locationId=X&status=active` | GET | 9 | List active groups |
| `/api/tips/groups/[id]` | PUT | 9 | Transfer ownership |
| `/api/tips/groups/[id]` | DELETE | 9 | Close group |
| `/api/tips/groups/[id]/members` | POST | 9 | Add member |
| `/api/tips/groups/[id]/members` | PUT | 9 | Approve join |
| `/api/tips/groups/[id]/members?employeeId=X` | DELETE | 9 | Remove member |
| `/api/tips/adjustments` | POST | 9 | Manual adjustment |
| `/api/employees?locationId=X` | GET | 9 | Employee picker |
| `/api/reports/tip-groups?locationId=X` | GET | 10 | Group list |
| `/api/reports/tip-groups?locationId=X&groupId=X` | GET | 10 | Full segment data |

### TypeScript Status
- 0 errors after all changes
- Production build passes cleanly

---

## 2026-02-11 — Skill 286: Tip Bank Team Pools (Admin-Defined Templates)

### Skills Completed
- **286**: Tip Bank Team Pools — Admin-defined tip group templates with clock-in selection, table tip ownership modes, and group control settings

### What Was Done

**Schema:**
- Added `TipGroupTemplate` model (locationId, name, allowedRoleIds JSON, defaultSplitMode, active, sortOrder, sync fields)
- Added `templateId` + relation on `TipGroup` (links runtime group to admin template)
- Added `selectedTipGroupId` on `TimeClockEntry` (tracks group joined at clock-in)
- Added `tipGroupTemplates` reverse relation on `Location`

**Domain Logic (`src/lib/domain/tips/tip-group-templates.ts`):**
- `getEligibleTemplates(locationId, roleId)` — Queries templates, filters by role
- `getOrCreateGroupForTemplate(templateId, locationId)` — Find-or-create runtime TipGroup
- `assignEmployeeToTemplateGroup()` — Single-group invariant + membership + segment management

**Settings (`src/lib/settings.ts`):**
- `tableTipOwnershipMode: 'ITEM_BASED' | 'PRIMARY_SERVER_OWNS_ALL'` (default: ITEM_BASED)
- `allowStandaloneServers: boolean` (default: true)
- `allowEmployeeCreatedGroups: boolean` (default: true)

**Allocation (`src/lib/domain/tips/tip-allocation.ts`):**
- Added `PRIMARY_SERVER_OWNS_ALL` mode: skips ownership splits for dine-in orders, primary server gets full tip

**API Routes:**
- `GET/POST /api/tips/group-templates` — Template list + create (auth: `tips.manage_rules`)
- `GET/PUT/DELETE /api/tips/group-templates/[id]` — Single template CRUD
- `GET /api/tips/group-templates/eligible` — Clock-in eligible templates by role

**Time Clock Integration (`src/app/api/time-clock/route.ts`):**
- POST accepts `selectedTipGroupTemplateId`
- Calls `assignEmployeeToTemplateGroup()` on clock-in (fire-and-forget)
- Stores runtime group ID in TimeClockEntry, returns group name in response

**UI:**
- Settings > Tips: Template CRUD (Section 8) + 3 new toggles (ownership mode, standalone, ad-hoc)
- Crew Page: Group Picker Dialog at clock-in (dark glassmorphism modal)
- Tip Group Page: Respects `allowEmployeeCreatedGroups` (hides "Start New Group" when disabled)

### Files Created
- `src/lib/domain/tips/tip-group-templates.ts` — Domain logic
- `src/app/api/tips/group-templates/route.ts` — GET + POST
- `src/app/api/tips/group-templates/[id]/route.ts` — GET + PUT + DELETE
- `src/app/api/tips/group-templates/eligible/route.ts` — GET eligible
- `docs/skills/286-TIP-BANK-TEAM-POOLS.md` — Skill documentation

### Files Modified
- `prisma/schema.prisma` — TipGroupTemplate model + relations
- `src/lib/settings.ts` — 3 new TipBankSettings fields
- `src/lib/domain/tips/tip-allocation.ts` — PRIMARY_SERVER_OWNS_ALL mode
- `src/app/api/time-clock/route.ts` — Template selection + group assignment
- `src/app/(admin)/settings/tips/page.tsx` — Template CRUD + toggles
- `src/app/(pos)/crew/page.tsx` — Group Picker Dialog
- `src/app/(pos)/crew/tip-group/page.tsx` — Ad-hoc group toggle

### Architecture Note
Team Pools builds on the existing Tip Group system (Skill 252) by adding an admin-managed template layer:
- **Templates** define the allowed teams and role eligibility (admin configuration)
- **Runtime Groups** are created on-the-fly when employees clock in (operational)
- **Segments** track membership changes over time (accounting)
- The single-group invariant ensures an employee is in at most one group at any time

### TypeScript Status
- 0 errors after all changes

---

## 2026-02-10 — Skill 284: TIP BANK Clean (Legacy Model Removal)

### Skills Completed
- **284**: TIP BANK Clean — Deleted legacy `TipBank` model entirely from schema and all references

### What Was Done
1. Removed `TipBank` model from `prisma/schema.prisma`
2. Removed all `TipBank` references from API routes and domain logic
3. Fixed 4 production gaps discovered during cleanup:
   - Employee tips GET route (`/api/employees/[id]/tips`) migrated from `TipBank` queries to `TipLedgerEntry`
   - Employee tips POST route updated to use `TipShare` status transitions only (no `TipBank` writes)
   - Removed `TipBank` relation from `Employee` model
   - Cleaned up comments referencing legacy model

### Commit
- `d377522` — `feat: Skill 284 — TIP BANK Clean`

### Architecture Note
The Tip Bank system is now fully on the immutable ledger model:
- `TipLedger` — Per-employee bank account (balance tracking)
- `TipLedgerEntry` — Immutable CREDIT/DEBIT entries (the source of truth)
- `TipTransaction` — Links entries to orders/payments
- `TipShare` — Retained for payout lifecycle (pending → accepted → paid)
- `TipBank` — **DELETED** (legacy model, fully replaced by ledger)

---

## 2026-02-10 — Tip Bank Integration & Enhancements (Skills 281-283)

### Skills Completed
- **281**: Wire Void Tip Reversal — `handleTipChargeback()` now called from void-payment route (fire-and-forget)
- **282**: Weighted Tip Splits — `Role.tipWeight` field, `buildWeightedSplitJson()`, `createSegment()` supports `role_weighted` splitMode
- **283**: Tip Groups Admin Page — `/tip-groups` admin page with status/date filters, AdminNav link

### Files Created
- `src/app/(admin)/tip-groups/page.tsx` — Tip Groups admin page

### Files Modified
- `prisma/schema.prisma` — Added `tipWeight Decimal @default(1.0)` to Role model
- `src/app/api/orders/[id]/void-payment/route.ts` — Fire-and-forget `handleTipChargeback()` call
- `src/lib/domain/tips/tip-groups.ts` — New `buildWeightedSplitJson()`, updated `createSegment()` + 4 callers
- `src/app/api/roles/route.ts` — GET returns tipWeight, POST accepts tipWeight
- `src/app/api/roles/[id]/route.ts` — GET returns tipWeight, PUT accepts tipWeight
- `src/components/admin/AdminNav.tsx` — Added "Tip Groups" link

### Integration Gaps Closed
1. **Void tip reversal**: `handleTipChargeback()` existed (Skill 255) but was never called → now wired
2. **Tip groups UI**: `/api/reports/tip-groups` existed (Skill 258) but had no admin page → now has `/tip-groups`
3. **Weighted splits**: Schema supported `role_weighted` splitMode but only equal splits were implemented → now functional

---

## 2026-02-10 — Tip Bank Production Hardening Phase 2 (Skills 274-280)

### Skills Completed
- **274**: Idempotency Guard — `idempotencyKey` on TipLedgerEntry + TipTransaction, dedup in `postToTipLedger()`
- **275**: Deterministic Splits — Sort memberIds alphabetically in `allocateToGroup()` and `buildEqualSplitJson()`
- **276**: Wire Ownership into Allocation — `allocateWithOwnership()` splits tip by owner % then routes each slice
- **277**: Qualified Tips — `kind` field on TipTransaction, IRS separation in payroll export
- **278**: TipDebt Model — Persistent chargeback remainder tracking with auto-reclaim on future CREDITs
- **279**: API Permission Hardening — Self-access check on ledger API, self-join validation on group members
- **280**: Feature Flag — `tipBankSettings.enabled` check at top of allocation

### Files Created
- `docs/skills/268-283-TIP-BANK-HARDENING.md` — Combined skill doc

### Files Modified
- `prisma/schema.prisma` — `idempotencyKey` on TipLedgerEntry/TipTransaction, `kind` on TipTransaction, TipDebt model
- `src/lib/domain/tips/tip-ledger.ts` — Idempotency check, TipDebt auto-reclaim on CREDIT
- `src/lib/domain/tips/tip-allocation.ts` — Idempotency keys, deterministic sort, ownership wiring, kind passthrough, feature flag
- `src/lib/domain/tips/tip-groups.ts` — Sort memberIds in `buildEqualSplitJson()`
- `src/lib/domain/tips/tip-chargebacks.ts` — Create TipDebt on capped chargebacks
- `src/lib/domain/tips/tip-payroll-export.ts` — Separate qualified tips vs service charges
- `src/app/api/orders/[id]/pay/route.ts` — Pass `kind` to allocation
- `src/app/api/tips/ledger/route.ts` — Self-access check
- `src/app/api/tips/groups/[id]/members/route.ts` — Self-join validation

### Architecture Decisions
1. **Idempotency key format**: `tip-txn:{orderId}:{paymentId}` for transactions, `tip-ledger:{orderId}:{paymentId}:{employeeId}` for entries
2. **Deterministic penny rounding**: Sort by employeeId alphabetically → last in sort absorbs remainder
3. **TipDebt auto-reclaim**: FIFO processing of open debts when new CREDITs arrive
4. **Feature flag granularity**: Per-location via `tipBankSettings.enabled`, not global

---

## 2026-02-10 — Tip Bank Production Hardening Phase 1 (Skills 268-273)

### Skills Completed
- **268**: Business Day Boundaries — All tip reports use `getBusinessDayRange()` / `getCurrentBusinessDay()`
- **269**: Wire Tip Allocation to Payment — `allocateTipsForPayment()` called fire-and-forget from pay route
- **270**: Cash Declaration Double-Counting Fix — Guard against duplicate declarations per shift
- **271**: txClient Nested Transaction Guard — `TxClient` type pattern for SQLite compatibility
- **272**: Tip Integrity Check API — `GET /api/tips/integrity` with balance drift detection + auto-fix
- **273**: Legacy Report Migration — All 5 tip reports migrated from TipBank/TipShare to TipLedgerEntry

### Files Created
- `src/lib/business-day.ts` — Business day utilities
- `src/app/api/tips/integrity/route.ts` — Integrity check endpoint

### Files Modified
- `src/lib/domain/tips/tip-ledger.ts` — txClient parameter, business day utilities
- `src/lib/domain/tips/tip-allocation.ts` — txClient passthrough
- `src/app/api/orders/[id]/pay/route.ts` — Wire `allocateTipsForPayment()`
- `src/app/api/reports/daily/route.ts` — Business day boundaries + TipLedgerEntry migration
- `src/app/api/reports/employee-shift/route.ts` — Business day + TipLedgerEntry migration
- `src/app/api/reports/tips/route.ts` — Business day + TipLedgerEntry migration
- `src/app/api/reports/payroll-export/route.ts` — Business day + TipLedgerEntry migration
- `src/app/api/reports/tip-groups/route.ts` — Business day boundaries
- `src/app/api/tips/cash-declarations/route.ts` — Duplicate guard

---

## 2026-02-10 — Tip Bank Enhancements (Skills 260-267)

### Skills Completed
- **260**: CC Tip Fee Structured Tracking — `ccFeeAmountCents` on TipTransaction, daily report `businessCosts` section
- **261**: Shift Closeout Printout — ESC/POS receipt builder, `/api/print/shift-closeout`, print button on ShiftCloseoutModal
- **262**: Daily Business Summary Printout — ESC/POS receipt builder, `/api/print/daily-report`, print button on admin daily report
- **263**: Tip Claims at Clock-Out Only — TimeClockModal tip notice is informational only, payout restricted to shift closeout
- **264**: Merge /crew/tips → Tip Bank — `/crew/tips` redirects to `/crew/tip-bank`, Crew Hub card renamed "Tip Bank"
- **265**: Tip Group UI — `/crew/tip-group` page, start/join/leave groups, Crew Hub tip group status card
- **266**: Shared Table Ownership UI — `SharedOwnershipModal` wired into FloorPlanHome + OrderPanel, auto-seed owner, transfer ownership flow, `pos.access` employee filter, order owner auth bypass
- **267**: Manual Tip Transfer Modal — `ManualTipTransferModal` with recipient picker, amount validation, memo

### Key Bug Fixes (Skill 266)
- Fixed: Prisma client not regenerated after schema changes (`db.orderOwnership` undefined) — ran `npx prisma generate`
- Fixed: API response shape mismatch — modal expected `entries` with nested `employee`, API returned `owners` with flat data
- Fixed: SharedOwnershipModal was named import but component uses `export default` — changed to default import
- Fixed: Empty state on modal open — added auto-seed that POSTs current employee as first owner
- Fixed: Barback appearing in employee dropdown — filtered by `pos.access` permission via shifts API
- Fixed: 403 when table owner adds co-owner — added order owner auth check (owner can add without manager perm)
- Fixed: Share button not working in bartender view — `employeeId` prop missing from shared OrderPanel

### Files Created
- `src/components/tips/SharedOwnershipModal.tsx` — Shared table/tab ownership modal
- `src/components/tips/ManualTipTransferModal.tsx` — Manual tip transfer modal
- `src/lib/escpos/shift-closeout-receipt.ts` — Shift closeout ESC/POS builder
- `src/lib/escpos/daily-report-receipt.ts` — Daily report ESC/POS builder
- `src/app/api/print/shift-closeout/route.ts` — Shift closeout print API
- `src/app/api/print/daily-report/route.ts` — Daily report print API
- `src/app/(pos)/crew/tip-group/page.tsx` — Tip group management page
- `docs/skills/260-267-TIP-BANK-ENHANCEMENTS.md` — Combined skill doc
- `docs/TIP-BANK-SYSTEM.md` — Updated system documentation

### Files Modified
- `prisma/schema.prisma` — Added `ccFeeAmountCents` to TipTransaction
- `src/app/api/orders/[id]/pay/route.ts` — Store CC fee on tip transactions
- `src/app/api/orders/[id]/route.ts` — Added `employeeId` to PUT metadata fields (for ownership transfer)
- `src/app/api/orders/[id]/ownership/route.ts` — Order owner can add co-owners, improved auth logic
- `src/app/api/reports/daily/route.ts` — businessCosts section with CC tip fees
- `src/app/api/shifts/route.ts` — Include role permissions in response
- `src/app/(admin)/reports/daily/page.tsx` — Print daily report button
- `src/app/(pos)/crew/page.tsx` — "Tip Bank" card rename, tip group card
- `src/app/(pos)/crew/tip-bank/page.tsx` — Updated layout
- `src/app/(pos)/crew/tips/page.tsx` — Redirect to /crew/tip-bank
- `src/app/(pos)/orders/page.tsx` — Pass employeeId to shared OrderPanel
- `src/components/floor-plan/FloorPlanHome.tsx` — Share button + SharedOwnershipModal
- `src/components/orders/OrderPanel.tsx` — Share button + SharedOwnershipModal
- `src/components/shifts/ShiftCloseoutModal.tsx` — Print closeout receipt button
- `src/components/time-clock/TimeClockModal.tsx` — Informational-only tip notice

---

## Session: February 10, 2026 — Complete Tip Bank System (Skills 250-259)

### Summary
Built the entire Tip Bank system from scratch across 10 phases in a single session. Every employee now has a personal tip ledger with full traceability. All 10 phases implemented, tested for zero diagnostics, and committed.

### Commit
| Commit | Message | Files | Lines |
|--------|---------|-------|-------|
| `1f38616` | feat: complete Tip Bank System (Skills 250-259) | 43 | +10,522 / -104 |

### Phase 1: Tip Ledger Foundation (Skill 250)
- Created `TipLedger`, `TipLedgerEntry`, `TipTransaction` schema models
- Built core domain functions: `getOrCreateLedger()`, `postToTipLedger()`, `getLedgerBalance()`, `getLedgerEntries()`, `recalculateBalance()`
- Added `TipBankSettings` interface to LocationSettings with 15+ configuration options
- Added 6 new tip permissions to auth system
- Created ledger API routes (self-access + admin)
- Integrated with payment route (fire-and-forget DIRECT_TIP credit)
- Integrated with shift closeout (paired ROLE_TIPOUT debit/credit)

### Phase 2: Enhanced Tip-Out Rules (Skill 251)
- Added 5 new fields to TipOutRule: basisType, salesCategoryIds, maxPercentage, effectiveDate, expiresAt
- Extended calculateTipOut/calculateTipShares with per-rule basisType + cap
- Created /settings/tips admin page (6 sections)
- Updated tip-out admin UI with basisType dropdown + compliance cap
- Added CC fee deduction and EOD payout settings

### Phase 3: Dynamic Tip Groups (Skill 252)
- Created `TipGroup`, `TipGroupMembership`, `TipGroupSegment` models
- Built group lifecycle functions: start, join, leave, transfer ownership, close
- Time-segmented splits: each membership change creates new segment
- Built tip allocation pipeline: `allocateTipsForOrder()`
- Added socket events for real-time group updates
- Created groups CRUD API + members API

### Phase 4: Shared Table Ownership (Skill 253)
- Created `OrderOwnership` + `OrderOwnershipEntry` models
- Built ownership functions: add/remove owners, rebalance splits
- Created ownership CRUD API at /api/orders/[id]/ownership
- Tip allocation adjusts by ownership % before group splits

### Phase 5: Manual Transfers & Payouts (Skill 254)
- Built tip transfer API (paired DEBIT/CREDIT entries)
- Built cash payout API
- Built batch payroll payout API
- Created manager payout page at /tips/payouts

### Phase 6: Chargeback & Void Handling (Skill 255)
- Built `handleTipChargeback()` with policy-based handling
- BUSINESS_ABSORBS: log only, no ledger changes
- EMPLOYEE_CHARGEBACK: proportional DEBIT entries
- Negative balance protection with manager review flagging

### Phase 7: Manager Adjustments (Skill 256)
- Created `TipAdjustment` model with contextJson audit trail
- Built recalculation engine: replay group/order allocations, compute deltas
- Delta entries posted (not full replacement)
- Created adjustments API with audit trail query

### Phase 8: Employee Tip Bank Dashboard (Skill 257)
- Created /crew/tip-bank employee self-service page
- Bank-statement style ledger entries with color-coded badges
- Date range + source type filters
- Offset-based pagination

### Phase 9: Tip Reporting & Payroll Export (Skill 258)
- Built payroll aggregation domain logic (per-employee, per-sourceType)
- Built CSV export with formatPayrollCSV()
- Created tip groups report API (segments, per-member earnings)
- Created payroll export API (CSV + JSON formats)

### Phase 10: Cash Tip Declaration & Compliance (Skill 259)
- Created `CashTipDeclaration` model
- Built cash declaration API (shift closeout integration)
- Built compliance checks: IRS 8% rule, tip-out caps, pool eligibility
- Pure functions returning warnings (not blocking)

### Files Created (27)
**Domain Logic:**
- `src/lib/domain/tips/tip-ledger.ts`
- `src/lib/domain/tips/tip-groups.ts`
- `src/lib/domain/tips/tip-allocation.ts`
- `src/lib/domain/tips/tip-payouts.ts`
- `src/lib/domain/tips/table-ownership.ts`
- `src/lib/domain/tips/tip-chargebacks.ts`
- `src/lib/domain/tips/tip-recalculation.ts`
- `src/lib/domain/tips/tip-compliance.ts`
- `src/lib/domain/tips/tip-payroll-export.ts`
- `src/lib/domain/tips/index.ts`

**API Routes:**
- `src/app/api/tips/ledger/route.ts`
- `src/app/api/tips/ledger/[employeeId]/route.ts`
- `src/app/api/tips/transfers/route.ts`
- `src/app/api/tips/payouts/route.ts`
- `src/app/api/tips/payouts/batch/route.ts`
- `src/app/api/tips/groups/route.ts`
- `src/app/api/tips/groups/[id]/route.ts`
- `src/app/api/tips/groups/[id]/members/route.ts`
- `src/app/api/tips/adjustments/route.ts`
- `src/app/api/tips/cash-declarations/route.ts`
- `src/app/api/reports/tip-groups/route.ts`
- `src/app/api/reports/payroll-export/route.ts`
- `src/app/api/orders/[id]/ownership/route.ts`
- `src/app/api/settings/tips/route.ts`

**UI Pages:**
- `src/app/(pos)/crew/tip-bank/page.tsx`
- `src/app/(admin)/settings/tips/page.tsx`
- `src/app/(admin)/tips/payouts/page.tsx`

### Files Modified (16)
- `prisma/schema.prisma` — 10 new models + TipOutRule field additions
- `src/lib/settings.ts` — TipBankSettings interface + defaults
- `src/lib/auth-utils.ts` — 6 new permissions
- `src/lib/socket-dispatch.ts` — Tip group socket events
- `src/lib/domain/payment/tip-calculations.ts` — basisType, sales data, maxPercentage
- `src/app/api/orders/[id]/pay/route.ts` — Ledger integration
- `src/app/api/shifts/[id]/route.ts` — Ledger integration + sales data
- `src/app/api/tip-out-rules/route.ts` — New fields
- `src/app/api/tip-out-rules/[id]/route.ts` — New fields
- `src/app/(admin)/settings/tip-outs/page.tsx` — basisType UI
- `src/components/shifts/ShiftCloseoutModal.tsx` — Sales-based display
- Additional route and component files

### Architecture Decisions
1. **Cents-based accounting** — All monetary values stored as integer cents to avoid floating-point errors
2. **Atomic transactions** — `postToTipLedger()` uses `db.$transaction` for entry + balance update
3. **Fire-and-forget integration** — Payment and shift routes post to ledger asynchronously
4. **Delta entries for adjustments** — Recalculation posts corrections, not replacements
5. **Policy-based chargebacks** — Business absorbs vs employee clawback, configurable per location
6. **Pure compliance functions** — Return warnings, never block operations

### Known Limitations
- No UI components for TipGroupPanel, StartTipGroupModal, TipGroupCheckout yet
- No ManualTipTransferModal component yet
- Tip allocation pipeline (`allocateTipsForOrder`) not yet wired to payment route
- Socket events defined but not all client listeners implemented
- No migration script for backfilling existing TipBank/TipShare data

### Resume Next Session
1. `PM Mode: Tips`
2. Review this changelog
3. Priority: Wire tip allocation pipeline to payment route
4. Priority: Build tip group UI components
5. Priority: Build manual transfer modal
