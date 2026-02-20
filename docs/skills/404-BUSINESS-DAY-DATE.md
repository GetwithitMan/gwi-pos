# Skill 404 — Business Day Date on Orders

**Domain:** Orders / Reporting / Business Day
**Date:** 2026-02-20
**Commit:** e2bf8e5
**Addresses:** Orders were always attributed to the day they were *opened* (createdAt). A tab opened Monday night and paid Tuesday morning would show as Monday's revenue — incorrect for Z-reports and daily totals.

---

## Overview

Added `businessDayDate DateTime?` to the Order model. This field tracks which business day the order *belongs to* for reporting purposes, separate from `createdAt` (when the tab was opened). It is promoted forward when an order is touched or paid, so revenue always lands on the day the order was closed.

---

## Behavior

| Event | businessDayDate |
|-------|----------------|
| Order created | Set to current business day start |
| Item added to previous-day order | Promoted to current business day → order moves to Today |
| Order paid | Always set to current business day → revenue on payment day |
| Just viewing | No change |

`createdAt` is never modified — it remains the true open time and drives the `📅 Feb 19 · 5:33 PM` badge in the UI.

---

## Architecture

```
Order opened Feb 19 at 11 PM
  └─ businessDayDate = Feb 19 business day start (4 AM Feb 19)
  └─ shows in "Previous Day" on Feb 20

Server adds a drink on Feb 20
  └─ businessDayDate → Feb 20 business day start
  └─ order moves to "Today" automatically

Order paid on Feb 20
  └─ businessDayDate confirmed as Feb 20
  └─ revenue on Feb 20 Z-report ✓
```

---

## Schema

```prisma
model Order {
  // ...
  businessDayDate  DateTime?
  // ...
  @@index([locationId, businessDayDate])
}
```

Migration backfills existing orders: `UPDATE "Order" SET "businessDayDate" = "createdAt" WHERE "businessDayDate" IS NULL;`

---

## Backwards Compatibility

All filters use an OR-fallback pattern so orders without `businessDayDate` (created before this migration) still work:

```typescript
// Today
{ OR: [
  { businessDayDate: { gte: businessDayStart } },
  { businessDayDate: null, createdAt: { gte: businessDayStart } }
] }

// Previous day
{ OR: [
  { businessDayDate: { lt: businessDayStart } },
  { businessDayDate: null, createdAt: { lt: businessDayStart } }
] }
```

---

## Files Changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | businessDayDate field + index on Order |
| `src/app/api/orders/route.ts` | Set businessDayDate on order create |
| `src/app/api/orders/[id]/items/route.ts` | Promote businessDayDate when items added to prior-day order |
| `src/app/api/orders/[id]/pay/route.ts` | Stamp businessDayDate = current business day on pay |
| `src/app/api/orders/open/route.ts` | OR-fallback filters |
| `src/lib/snapshot.ts` | OR-fallback on count query |
| `src/app/api/eod/reset/route.ts` | OR-fallback on stale order queries |
| `src/app/api/reports/daily/route.ts` | OR-fallback |
| `src/app/api/reports/sales/route.ts` | OR-fallback |
| `src/app/api/reports/commission/route.ts` | OR-fallback |
| `src/app/api/reports/tables/route.ts` | OR-fallback |
| `src/app/api/reports/customers/route.ts` | OR-fallback |
| `src/app/api/reports/discounts/route.ts` | OR-fallback |
| `src/app/api/reports/employees/route.ts` | OR-fallback |
| `src/app/api/reports/liquor/route.ts` | OR-fallback |
| `src/app/api/reports/payroll/route.ts` | OR-fallback |
| `src/app/api/reports/labor/route.ts` | OR-fallback |
