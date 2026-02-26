# Skill 448: Codebase Architecture Audit Fixes

**Date:** 2026-02-26
**Commit:** `6755272`
**Status:** DONE

## Overview

Fixed 15 findings from a full codebase architecture audit. 5 parallel agents handled independent workstreams: auth hardening, schema sync fields, N+1/fire-and-forget fixes, cache bypass elimination, and hard delete/UI/socket improvements. All POS-repo issues resolved in a single commit across 17 files (+208/-177 lines).

## Findings & Fixes

### Auth Hardening (CRITICAL + MEDIUM)
**File:** `src/app/api/auth/venue-login/route.ts`

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | CRITICAL | MC fetch has no catch — login crashes if MC unreachable | Wrapped in try/catch; falls through to local employee auth on any error |
| 2 | MEDIUM | Hardcoded `'https://app.thepasspos.com'` fallback URL | Removed; if `MISSION_CONTROL_URL` not set, skip MC fetch entirely with warning |

### Schema Sync Fields (CRITICAL)
**File:** `prisma/schema.prisma`

All 147 models now have both `deletedAt DateTime?` and `syncedAt DateTime?`. Models that were missing one or both fields had them added. Also added `source String?` to the Order model for online ordering attribution.

Models updated: Organization, Location, HardwareCommand, MobileSession, ModifierTemplate (syncedAt only), OrderOwnershipEntry (syncedAt only), PaymentReaderLog (deletedAt only).

### N+1 Fixes + Fire-and-Forget (HIGH)

| # | File | Issue | Fix |
|---|------|-------|-----|
| 3 | `orders/[id]/send/route.ts` | N+1 orderItem.update() in loop | Batched into single `$transaction` + parallelized entertainment sessions |
| 4 | `kds/expo/route.ts` | N+1 auditLog.create() in loop | Single `createMany()` call |
| 8 | `orders/[id]/pay/route.ts` | Awaited entertainment reset + table update blocks response | Converted to `void ... .catch(console.error)` |
| 14 | send/expo/pay routes | 14 fire-and-forget calls missing `void` prefix | Added `void` to socket dispatches, print calls, audit logs, inventory deductions |

### Cache Bypass Fixes (HIGH + MEDIUM)

| # | File | Issue | Fix |
|---|------|-------|-----|
| 5 | `orders/route.ts` | Direct DB call for location settings on every order create | Replaced with `getLocationSettings(locationId)` (5min cache) |
| 6 | `orders/route.ts` | Direct DB calls for categories + menu items | Tax rule query left (not in cache); category-type mapping left (not in cache) |
| 21 | `settings/tips/route.ts` | Direct DB call for location settings | GET handler switched to `getLocationSettings()` |
| 21 | `settings/online-ordering/route.ts` | Direct DB call for location settings | GET handler switched to `getLocationSettings()` (PUT kept as DB write) |

14 additional routes audited — already using caches or need data not provided by existing caches.

### Hard Delete + UI/Socket Fixes (HIGH + MEDIUM)

| # | File | Issue | Fix |
|---|------|-------|-----|
| 7 | `orders/[id]/seating/route.ts` + `cleanup-temp-seats.ts` | 3 hard delete calls (`seat.delete`, `seat.deleteMany`) | Converted to soft delete with `deletedAt: new Date()` |
| 10 | `daily-counts/page.tsx` + `quick-adjust/page.tsx` | Buttons 24-28px (below 48px touch target) | Added `min-w-12 min-h-12` for 48px minimum |
| 11 | `OpenOrdersPanel.tsx` | Full refetch on every socket "created" event | Debounced refresh (300ms) coalesces burst events |
| 12 | `useOrderBootstrap.ts` | API call on every socket event for open order count | Local inc/dec (created +1, paid/voided -1); API only on reconnect |
| 13 | `dashboard/page.tsx` | 60s polling runs even when socket connected | Guard: `if (isSharedSocketConnected()) return` inside interval |

## Key Files Modified

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | +22 lines (sync fields on 7 models + Order.source) |
| `src/app/api/auth/venue-login/route.ts` | MC resilience + URL guard |
| `src/app/api/orders/[id]/send/route.ts` | Batched transaction + 7 void prefixes |
| `src/app/api/kds/expo/route.ts` | createMany + 2 void prefixes |
| `src/app/api/orders/[id]/pay/route.ts` | 2 fire-and-forget + 5 void prefixes |
| `src/app/api/orders/route.ts` | Cache replacement |
| `src/app/api/settings/tips/route.ts` | Cache replacement |
| `src/app/api/settings/online-ordering/route.ts` | Cache replacement |
| `src/app/api/orders/[id]/seating/route.ts` | Soft delete conversion |
| `src/lib/cleanup-temp-seats.ts` | Soft delete conversion |
| `src/app/(admin)/settings/daily-counts/page.tsx` | Touch targets |
| `src/app/(admin)/inventory/quick-adjust/page.tsx` | Touch targets |
| `src/components/orders/OpenOrdersPanel.tsx` | Debounced socket refresh |
| `src/app/(pos)/orders/hooks/useOrderBootstrap.ts` | Local count updates |
| `src/app/(admin)/dashboard/page.tsx` | Polling guard |
