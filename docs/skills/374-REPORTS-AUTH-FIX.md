# Skill 374 — Reports Auth Fix (14 Pages)

**Date:** February 19, 2026
**Domain:** Reports, Auth
**Priority:** P0

## Summary

All 14 report pages in `src/app/(admin)/reports/` were missing `employeeId` in their API fetch calls, causing `requirePermission()` to return 401 Unauthorized. Every report page showed "no data" even though data existed. Fixed by adding `employeeId` (from auth store) to every fetch URL. Also fixed `getLocationId()` in `src/lib/location-cache.ts` to use deterministic ordering and cleaned up a stale location record.

## Problem

1. **Missing `employeeId` in report API calls**: All 14 report pages constructed fetch URLs without including `employeeId`. The server-side `requirePermission()` middleware requires this parameter to validate employee access — without it, every request returned 401.
2. **"No data" on every report**: Because all API calls failed silently with 401, every report page displayed empty state / "no data" messaging despite real data existing in the database.
3. **`getLocationId()` non-deterministic ordering**: When multiple Location records existed, `getLocationId()` in `location-cache.ts` used `findFirst()` without an `orderBy` clause, meaning the returned location depended on database insertion order — which could vary.
4. **Stale location record**: A stale location record `cmlkcq9ut0001ky04fv4ph4hh` ("gwi-admin-dev") existed in the database, causing `getLocationId()` to sometimes return the wrong location ID.

## Solution

### 1. Added `employeeId` to all 14 report pages

Every report page now reads `employeeId` from the auth store and includes it in the API fetch URL as a query parameter. This allows `requirePermission()` to validate the employee and return data.

### 2. Deterministic `getLocationId()` ordering

Changed `getLocationId()` in `src/lib/location-cache.ts` to use `orderBy: { id: 'asc' }` so it always picks the same (earliest-created) location when multiple exist.

### 3. Deleted stale location record

Removed the stale location record `cmlkcq9ut0001ky04fv4ph4hh` ("gwi-admin-dev") that was causing `getLocationId()` to return the wrong ID.

## Files Changed

### Report Pages (14 files)

All in `src/app/(admin)/reports/`:

| # | File | Description |
|---|------|-------------|
| 1 | `page.tsx` | Reports hub page — added `employeeId` to fetch |
| 2 | `daily/page.tsx` | Daily report — added `employeeId` to fetch |
| 3 | `sales/page.tsx` | Sales report — added `employeeId` to fetch |
| 4 | `employees/page.tsx` | Employees report — added `employeeId` to fetch |
| 5 | `tips/page.tsx` | Tips report — added `employeeId` to fetch |
| 6 | `shift/page.tsx` | Shift report — added `employeeId` to fetch |
| 7 | `product-mix/page.tsx` | Product mix report — added `employeeId` to fetch |
| 8 | `voids/page.tsx` | Voids report — added `employeeId` to fetch |
| 9 | `payroll/page.tsx` | Payroll report — added `employeeId` to fetch |
| 10 | `commission/page.tsx` | Commission report — added `employeeId` to fetch |
| 11 | `coupons/page.tsx` | Coupons report — added `employeeId` to fetch |
| 12 | `liquor/page.tsx` | Liquor report — added `employeeId` to fetch |
| 13 | `order-history/page.tsx` | Order history report — added `employeeId` to fetch |
| 14 | `reservations/page.tsx` | Reservations report — added `employeeId` to fetch |

### Infrastructure (2 files)

| # | File | Description |
|---|------|-------------|
| 15 | `src/lib/location-cache.ts` | `getLocationId()` now uses `orderBy: { id: 'asc' }` for deterministic ordering |
| 16 | Database cleanup | Deleted stale location record `cmlkcq9ut0001ky04fv4ph4hh` ("gwi-admin-dev") |

## Pattern Applied

Before (broken):
```typescript
const res = await fetch(`/api/reports/daily?locationId=${locationId}&date=${date}`)
```

After (fixed):
```typescript
const res = await fetch(`/api/reports/daily?locationId=${locationId}&date=${date}&employeeId=${employeeId}`)
```

The `employeeId` is read from the auth store (Zustand) which is populated at login.

## Key Lessons

1. **Auth parameters must be included in every API call** — `requirePermission()` on the server side needs `employeeId` to validate access. Missing it silently returns 401, which the UI interprets as "no data."
2. **`findFirst()` without `orderBy` is non-deterministic** — always specify ordering when only one record is expected but multiple may exist.
3. **Stale seed/dev data can break production flows** — old location records from development can cause ID mismatches in production queries.

## Related Skills

- **Skill 104**: End-of-Day Reports (original report page implementations)
- **Skill 375**: NUC-Cloud Event Pipeline (also completed this session)
