# Tips & Tip Bank Domain Changelog

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
