# Skills 268-283: Tip Bank Production Hardening

**Status:** ALL DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skills 250-267 (Complete Tip Bank System + Enhancements)
**Phase:** Tip Bank Phase 19-34

## Table of Contents

1. [Skill 268: Business Day Boundaries](#skill-268-business-day-boundaries)
2. [Skill 269: Wire Tip Allocation to Payment](#skill-269-wire-tip-allocation-to-payment)
3. [Skill 270: Cash Declaration Double-Counting Fix](#skill-270-cash-declaration-double-counting-fix)
4. [Skill 271: txClient Nested Transaction Guard](#skill-271-txclient-nested-transaction-guard)
5. [Skill 272: Tip Integrity Check API](#skill-272-tip-integrity-check-api)
6. [Skill 273: Legacy Report Migration to TipLedgerEntry](#skill-273-legacy-report-migration-to-tipledgerentry)
7. [Skill 274: Idempotency Guard on Tip Allocation](#skill-274-idempotency-guard-on-tip-allocation)
8. [Skill 275: Deterministic Group Split Ordering](#skill-275-deterministic-group-split-ordering)
9. [Skill 276: Wire Shared Table Ownership into Allocation](#skill-276-wire-shared-table-ownership-into-allocation)
10. [Skill 277: Qualified Tips vs Service Charges](#skill-277-qualified-tips-vs-service-charges)
11. [Skill 278: TipDebt Model for Chargeback Remainder](#skill-278-tipdebt-model-for-chargeback-remainder)
12. [Skill 279: API Permission Hardening](#skill-279-api-permission-hardening)
13. [Skill 280: Tip Bank Feature Flag + Legacy Guard](#skill-280-tip-bank-feature-flag--legacy-guard)
14. [Skill 281: Wire Void Tip Reversal](#skill-281-wire-void-tip-reversal)
15. [Skill 282: Weighted Tip Splits (Role-Based)](#skill-282-weighted-tip-splits-role-based)
16. [Skill 283: Tip Groups Admin Page](#skill-283-tip-groups-admin-page)

---

## Skill 268: Business Day Boundaries

**Status:** DONE

### Overview

All tip queries (daily report, shift report, employee tips report, payroll export, tip groups report) now use business-day boundaries instead of calendar midnight. This ensures a bartender working 8 PM - 2 AM has all their tips counted on the same business day.

### What Was Built

- **`getBusinessDayRange(date, dayStartTime)`** — Returns the start/end timestamps for a business day (e.g., 4:00 AM to 4:00 AM next day)
- **`getCurrentBusinessDay(dayStartTime)`** — Returns the current business day's range
- All 5 tip-related reports updated to use these boundaries instead of `new Date(startDate)` / `new Date(endDate)`

### Key Files

| File | Change |
|------|--------|
| `src/lib/business-day.ts` | New utility for business day calculations |
| `src/app/api/reports/daily/route.ts` | Uses business day range for tip aggregation |
| `src/app/api/reports/employee-shift/route.ts` | Uses business day range |
| `src/app/api/reports/tips/route.ts` | Uses business day range |
| `src/app/api/reports/payroll-export/route.ts` | Uses business day range |
| `src/app/api/reports/tip-groups/route.ts` | Uses business day range |

---

## Skill 269: Wire Tip Allocation to Payment

**Status:** DONE

### Overview

The `allocateTipsForPayment()` function (built in Skill 252) was never called from the payment route. This skill wires it in as a fire-and-forget call after successful payment.

### What Was Built

- Payment route (`/api/orders/[id]/pay`) now calls `allocateTipsForPayment()` after recording payment
- Fire-and-forget pattern: allocation runs async, payment response is not delayed
- If allocation fails, payment still succeeds (logged as warning)

### Key Files

| File | Change |
|------|--------|
| `src/app/api/orders/[id]/pay/route.ts` | Added `allocateTipsForPayment()` call after payment |

---

## Skill 270: Cash Declaration Double-Counting Fix

**Status:** DONE

### Overview

Cash tip declarations at shift closeout were being double-counted — once when declared and again during tip allocation. Fixed by adding a guard that checks if a declaration already exists for the shift.

### Key Files

| File | Change |
|------|--------|
| `src/app/api/tips/cash-declarations/route.ts` | Added duplicate check before creating declaration |

---

## Skill 271: txClient Nested Transaction Guard

**Status:** DONE

### Overview

SQLite does not support nested transactions. When `postToTipLedger()` (which uses `db.$transaction`) was called from within another transaction, it would fail silently. This skill adds a `txClient` parameter pattern.

### What Was Built

- **`TxClient` type:** `type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]`
- `postToTipLedger()` now accepts an optional `txClient` parameter
- When a `txClient` is provided, it uses that client instead of creating a nested transaction
- All callers in `tip-allocation.ts` pass their transaction client through

### Key Files

| File | Change |
|------|--------|
| `src/lib/domain/tips/tip-ledger.ts` | Added `txClient` parameter to `postToTipLedger()` |
| `src/lib/domain/tips/tip-allocation.ts` | Passes `txClient` to all `postToTipLedger()` calls |

---

## Skill 272: Tip Integrity Check API

**Status:** DONE

### Overview

A diagnostic endpoint that verifies tip system integrity by comparing cached balances against actual entry sums, checking for orphaned entries, and validating referential integrity.

### What Was Built

- **`GET /api/tips/integrity`** — Runs integrity checks across all ledgers
- Checks: balance drift, orphaned entries, missing ledger records, duplicate idempotency keys
- Returns a structured report with pass/fail per check
- Optionally auto-fixes drift when `?fix=true` query param is provided

### Key Files

| File | Change |
|------|--------|
| `src/app/api/tips/integrity/route.ts` | New integrity check endpoint |

---

## Skill 273: Legacy Report Migration to TipLedgerEntry

**Status:** DONE

### Overview

Migrated all tip-related reports from the legacy `TipBank`/`TipShare` models to read from `TipLedgerEntry`. This ensures reports show the same data that the employee tip bank dashboard shows.

### What Was Built

- Daily report tip section reads from `TipLedgerEntry` (grouped by sourceType)
- Employee shift report reads from `TipLedgerEntry` (filtered by shift date range)
- Tips report reads from `TipLedgerEntry` with full breakdown
- Payroll export reads from `TipLedgerEntry` (aggregated by employee + sourceType)
- Employee tips report reads from `TipLedgerEntry`
- **Legacy `TipShare` report** (`/api/reports/tip-shares`) intentionally kept — it tracks payout lifecycle status which `TipLedgerEntry` does not model

### Key Files

| File | Change |
|------|--------|
| `src/app/api/reports/daily/route.ts` | Migrated to TipLedgerEntry |
| `src/app/api/reports/employee-shift/route.ts` | Migrated to TipLedgerEntry |
| `src/app/api/reports/tips/route.ts` | Migrated to TipLedgerEntry |
| `src/app/api/reports/payroll-export/route.ts` | Migrated to TipLedgerEntry |
| `src/app/api/reports/employee-tips/route.ts` | Migrated to TipLedgerEntry |

---

## Skill 274: Idempotency Guard on Tip Allocation

**Status:** DONE

### Overview

Prevents double-posting tips when `allocateTipsForPayment()` is called twice for the same payment (e.g., retry, double-submit, network hiccup).

### What Was Built

- **`idempotencyKey`** field added to `TipLedgerEntry` and `TipTransaction` models (`String? @unique`)
- `postToTipLedger()` checks for existing entry with same key before inserting; returns existing entry on match
- `allocateTipsForOrder()` generates key as `tip-txn:${orderId}:${paymentId}` and checks for existing `TipTransaction`
- Individual allocations use key `tip-ledger:${orderId}:${paymentId}:${employeeId}`

### Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `idempotencyKey` to TipLedgerEntry + TipTransaction |
| `src/lib/domain/tips/tip-ledger.ts` | Idempotency check in `postToTipLedger()` |
| `src/lib/domain/tips/tip-allocation.ts` | Idempotency keys on all allocations |

### Idempotency Key Format

```
TipTransaction:  tip-txn:{orderId}:{paymentId}
TipLedgerEntry:  tip-ledger:{orderId}:{paymentId}:{employeeId}
```

---

## Skill 275: Deterministic Group Split Ordering

**Status:** DONE

### Overview

When splitting tips among group members, the "last member absorbs rounding" rule depends on iteration order. `Object.keys()` on a JSON column could vary across DB reads. This skill ensures deterministic ordering.

### What Was Built

- `allocateToGroup()` sorts `memberIds` alphabetically before iterating
- `buildEqualSplitJson()` sorts `memberIds` before distributing remainder

### Key Files

| File | Change |
|------|--------|
| `src/lib/domain/tips/tip-allocation.ts` | Sort `memberIds` in `allocateToGroup()` |
| `src/lib/domain/tips/tip-groups.ts` | Sort `memberIds` in `buildEqualSplitJson()` |

---

## Skill 276: Wire Shared Table Ownership into Allocation

**Status:** DONE

### Overview

`table-ownership.ts` had `adjustAllocationsByOwnership()` and `getActiveOwnership()` ready but never called from the allocation pipeline. Tips on shared tables went 100% to `order.employeeId`, ignoring co-owners.

### What Was Built

- `allocateTipsForOrder()` now checks for active ownership before allocation
- If multiple owners exist, tip is split by ownership percentage first
- Each owner's slice independently checks for tip group membership
- Owner in group → their slice splits across group members
- Owner not in group → their slice goes as DIRECT_TIP
- Entire operation wrapped in a single `db.$transaction()` for atomicity

### Key Files

| File | Change |
|------|--------|
| `src/lib/domain/tips/tip-allocation.ts` | New `allocateWithOwnership()` function, wired into main pipeline |

### Flow

```
Order paid with $20 tip
    ↓
Check for ownership: Alice (60%), Bob (40%)
    ↓
Alice's $12 share:
  → Alice is in a tip group → split $12 among group members
Bob's $8 share:
  → Bob is NOT in a group → $8 DIRECT_TIP to Bob
```

---

## Skill 277: Qualified Tips vs Service Charges

**Status:** DONE

### Overview

IRS requires distinguishing voluntary gratuities from mandatory service charges (auto-gratuity). They have different tax treatment.

### What Was Built

- **`kind`** field on `TipTransaction`: `'tip'` (default) | `'service_charge'` | `'auto_gratuity'`
- Payment route passes `kind: 'auto_gratuity'` when auto-gratuity is applied
- Payroll export separates: `qualifiedTipsCents` (kind='tip') vs `serviceChargeCents` (kind IN service_charge, auto_gratuity)

### Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `kind` to TipTransaction |
| `src/lib/domain/tips/tip-allocation.ts` | Passes `kind` through allocation |
| `src/app/api/orders/[id]/pay/route.ts` | Determines `kind` based on auto-gratuity |
| `src/lib/domain/tips/tip-payroll-export.ts` | Separates qualified tips from service charges |

---

## Skill 278: TipDebt Model for Chargeback Remainder

**Status:** DONE

### Overview

When `chargebackPolicy = 'EMPLOYEE_CHARGEBACK'` and `allowNegativeBalances = false`, the debit is capped at the employee's current balance. The uncollectable remainder now has a persistent model.

### What Was Built

- **`TipDebt` model**: Tracks uncollectable chargeback remainders per employee
- Status lifecycle: `open` → `partial` → `recovered` | `written_off`
- Auto-reclaim on future CREDIT: when `postToTipLedger()` posts a CREDIT, it checks for open `TipDebt` records and auto-debits `min(creditAmount, debtRemaining)`
- Manager can write off debt (set status to `written_off`)

### Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | New `TipDebt` model |
| `src/lib/domain/tips/tip-chargebacks.ts` | Creates `TipDebt` on capped chargebacks |
| `src/lib/domain/tips/tip-ledger.ts` | Auto-reclaim from open `TipDebt` on CREDIT |

### TipDebt Lifecycle

```
Chargeback: Employee owes $15 but only has $10 balance
    ↓
DEBIT $10 posted (capped at balance)
TipDebt created: { originalAmountCents: 500, remainingCents: 500, status: 'open' }
    ↓
Employee earns new $3 tip
    ↓
postToTipLedger(CREDIT, $3)
  → Auto-reclaim: DEBIT $3 from TipDebt
  → TipDebt: { remainingCents: 200, status: 'partial' }
    ↓
Employee earns another $5 tip
    ↓
postToTipLedger(CREDIT, $5)
  → Auto-reclaim: DEBIT $2 (remaining debt)
  → TipDebt: { remainingCents: 0, status: 'recovered' }
  → Net credit: $3 ($5 - $2 reclaimed)
```

---

## Skill 279: API Permission Hardening

**Status:** DONE

### Overview

Several tip routes had auth gaps where any employee could access other employees' data by providing their `employeeId` in query params.

### What Was Built

- `GET /api/tips/ledger`: Self-access check — if `requestingEmployeeId !== employeeId`, requires `TIPS_VIEW_LEDGER` permission
- `POST /api/tips/groups/[id]/members` with `action: 'request'`: Requires `x-employee-id` header to match the `employeeId` being added (self-join only)

### Key Files

| File | Change |
|------|--------|
| `src/app/api/tips/ledger/route.ts` | Self-access check, 403 on unauthorized cross-employee access |
| `src/app/api/tips/groups/[id]/members/route.ts` | Self-join validation via `x-employee-id` header |

---

## Skill 280: Tip Bank Feature Flag + Legacy Guard

**Status:** DONE

### Overview

Locations need a way to disable the new tip bank system during rollout without breaking payments.

### What Was Built

- `allocateTipsForPayment()` checks `tipBankSettings.enabled` at the top — if `false`, returns a no-op result immediately
- Payment route still processes successfully when tip bank is disabled (tips just not posted to ledger)
- Legacy `/api/reports/tip-shares` route has a guard comment noting it's intentionally active for payout lifecycle management

### Key Files

| File | Change |
|------|--------|
| `src/lib/domain/tips/tip-allocation.ts` | Feature flag guard at top of `allocateTipsForPayment()` |

---

## Skill 281: Wire Void Tip Reversal

**Status:** DONE

### Overview

The `handleTipChargeback()` function (built in Skill 255) was never called from the void-payment route. This skill wires it in.

### What Was Built

- Void-payment route now calls `handleTipChargeback()` after voiding a payment that had a tip
- Fire-and-forget pattern: if no TipTransaction exists (e.g., tip bank was disabled), the error is caught and logged as a warning
- Only triggers when `payment.tipAmount > 0`

### Key Files

| File | Change |
|------|--------|
| `src/app/api/orders/[id]/void-payment/route.ts` | Added `handleTipChargeback()` call after void + audit log |

### Code

```typescript
// After payment void + audit log creation
if (Number(payment.tipAmount) > 0) {
  handleTipChargeback({
    locationId: order.locationId,
    paymentId,
    memo: `Payment voided: ${reason}`,
  }).catch((err) => {
    console.warn('[void-payment] Tip chargeback skipped or failed:', err.message)
  })
}
```

---

## Skill 282: Weighted Tip Splits (Role-Based)

**Status:** DONE

### Overview

Tip groups now support role-weighted splits where each role has a `tipWeight` (e.g., Lead Bartender=1.5, Bartender=1.0, Barback=0.5). Tips are distributed proportional to weights.

### What Was Built

- **`Role.tipWeight`** — New `Decimal @default(1.0)` field on Role model
- **`buildWeightedSplitJson()`** — New function that distributes shares proportional to role weights, with deterministic ordering (sorted by employeeId)
- **`createSegment()`** — Updated to accept `splitMode` parameter and use weighted splits when `splitMode === 'role_weighted'`
- **4 callers updated**: `startTipGroup()`, `addMemberToGroup()`, `removeMemberFromGroup()`, `approveJoinRequest()` — all pass through the group's `splitMode`
- **Roles API** — GET returns `tipWeight`, POST/PUT accept and save `tipWeight`

### Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `tipWeight Decimal @default(1.0)` to Role |
| `src/lib/domain/tips/tip-groups.ts` | New `buildWeightedSplitJson()`, updated `createSegment()` + 4 callers |
| `src/app/api/roles/route.ts` | GET returns tipWeight, POST accepts tipWeight |
| `src/app/api/roles/[id]/route.ts` | GET returns tipWeight, PUT accepts tipWeight |

### Example

```
Tip Group: 3 bartenders
  Lead Bartender (weight 1.5) → 1.5 / 3.0 = 50%
  Bartender (weight 1.0)      → 1.0 / 3.0 = 33.33%
  Barback (weight 0.5)        → 0.5 / 3.0 = 16.67%
```

---

## Skill 283: Tip Groups Admin Page

**Status:** DONE

### Overview

Admin page for viewing all tip groups at a location. Previously the tip groups report API existed but had no UI link.

### What Was Built

- **`/tip-groups`** admin page listing all tip groups
- Status filter (Active/Closed/All)
- Date range filter
- Group cards showing members, split mode, earnings
- Link added to AdminNav in Reports section

### Key Files

| File | Change |
|------|--------|
| `src/app/(admin)/tip-groups/page.tsx` | New admin page |
| `src/components/admin/AdminNav.tsx` | Added "Tip Groups" link in Reports section |

---

## Summary: Complete Tip Bank Skill Dependency Tree

```
250 (Ledger Foundation)
 ├── 251 (Tip-Out Rules)
 ├── 252 (Tip Groups) ──→ 256 (Adjustments) ──→ 265 (Tip Group UI) ──→ 283 (Tip Groups Admin)
 │    └──→ 275 (Deterministic Splits) ──→ 282 (Weighted Splits)
 ├── 253 (Table Ownership) ──→ 266 (Shared Ownership UI) ──→ 276 (Wire into Allocation)
 ├── 254 (Transfers & Payouts) ──→ 267 (Tip Transfer Modal)
 ├── 255 (Chargebacks) ──→ 278 (TipDebt Model) ──→ 281 (Wire Void Reversal)
 ├── 257 (Dashboard) ──→ 264 (Merge /crew/tips)
 ├── 258 (Reports) ──→ 262 (Daily Report Print) ──→ 273 (Ledger Migration)
 ├── 259 (Compliance) ──→ 263 (Clock-Out Only) ──→ 270 (Cash Decl Fix)
 ├── 260 (CC Fee Tracking)
 ├── 261 (Shift Closeout Print)
 ├── 268 (Business Day Boundaries)
 ├── 269 (Wire Allocation to Payment)
 ├── 271 (txClient Guard)
 ├── 272 (Integrity Check API)
 ├── 274 (Idempotency Guard)
 ├── 277 (Qualified Tips / IRS)
 ├── 279 (API Permission Hardening)
 └── 280 (Feature Flag Guard)
```

## Production Readiness Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | Every tip dollar traceable to immutable ledger entry | DONE |
| 2 | Idempotent allocation (no double-posting) | DONE (Skill 274) |
| 3 | Deterministic splits (same input = same output) | DONE (Skill 275) |
| 4 | Shared table ownership wired into allocation | DONE (Skill 276) |
| 5 | IRS qualified tips vs service charges | DONE (Skill 277) |
| 6 | Chargeback remainder tracking (TipDebt) | DONE (Skill 278) |
| 7 | API permission hardening (no unauthorized cross-employee access) | DONE (Skill 279) |
| 8 | Feature flag to disable per-location | DONE (Skill 280) |
| 9 | Void/refund tip reversal wired | DONE (Skill 281) |
| 10 | Business day boundaries on all reports | DONE (Skill 268) |
| 11 | All reports migrated to TipLedgerEntry | DONE (Skill 273) |
| 12 | Integrity check endpoint | DONE (Skill 272) |
| 13 | No nested transaction violations (SQLite) | DONE (Skill 271) |
