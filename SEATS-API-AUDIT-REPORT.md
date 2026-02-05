# Seats API Audit Report
**Auditor:** Worker 41
**Date:** 2026-02-05
**Scope:** All Seats API endpoints and library files in GWI POS Floor Plan domain

---

## Summary

| Metric | Count |
|--------|-------|
| **Total API endpoints** | 20 (13 routes × ~1.5 methods avg) |
| **Total library files** | 3 |
| **Clean endpoints** | 3 |
| **Endpoints with issues** | 17 |
| **Endpoints broken** | 0 |
| **Critical issues** | 6 |
| **Warnings** | 11 |
| **Duplicate code instances** | 2 |

---

## Endpoint Audit Results

### Standalone Seats API

#### Endpoint: `/api/seats` (GET)
**Status:** ✅ CLEAN
**Methods:** GET
**Input Validation:**
- ✅ `locationId` required and validated (line 14-19)
- ✅ Filters by `deletedAt: null` (line 24)
- ✅ Optional filters: `tableId`, `virtualGroupId`, `status`

**Response Format:**
- ⚠️ Returns `{seats: [...]}` instead of `{data: seats: [...]}` (inconsistent with convention)
- ✅ Proper error handling with 400/500 status codes

**Socket Dispatch:** N/A (read-only)

---

#### Endpoint: `/api/seats` (POST)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seat: {...}}` instead of `{data: {...}}` (line 121-134)
2. **Missing locationId validation** - No explicit check for `locationId` (should return 400)
3. ✅ Socket dispatch present (line 119)

**Input Validation:**
- ✅ `locationId` and `tableId` required (line 88-93)
- ✅ Auto-increments `seatNumber` if not provided (lines 96-103)

**Database Operations:**
- ⚠️ NO `deletedAt: null` filter when checking max seat (line 99) - could cause wrong seat numbering if deleted seats exist

---

#### Endpoint: `/api/seats/[id]` (GET)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seat: {...}}` instead of `{data: {...}}` (line 38-55)
2. ✅ Uses `deletedAt: null` filter (line 15)
3. ✅ Returns 404 for missing seat (line 31-35)

---

#### Endpoint: `/api/seats/[id]` (PUT)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seat: {...}}` instead of `{data: {...}}` (line 112-125)
2. ✅ Socket dispatch present (line 110)
3. ✅ Fetches seat to get `locationId` for socket dispatch (line 86-92)

---

#### Endpoint: `/api/seats/[id]` (DELETE)
**Status:** ✅ CLEAN (with note)
**Notes:**
- ✅ Uses `softDeleteData()` helper (line 156)
- ✅ Socket dispatch present (line 160)
- ✅ Returns `{success: true}` (line 162)
- ✅ Fetches seat before delete to get `locationId` (line 144-151)

---

#### Endpoint: `/api/seats/cleanup-duplicates` (GET/POST)
**Status:** ✅ CLEAN
**Features:**
- ✅ Dry-run support (line 15, 78-89)
- ✅ Groups by `tableId:seatNumber` to find duplicates (lines 38-45)
- ✅ Keeps oldest, deletes rest (line 59)
- ✅ Proper response format with detailed results
- ✅ GET route reuses POST logic with dry-run (lines 123-140)

**Notes:**
- ⚠️ NO socket dispatch after cleanup (should notify when seats are deleted)

---

### Table-Scoped Seats API

#### Endpoint: `/api/tables/[id]/seats` (GET)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seats: [...], table: {...}}` instead of `{data: {...}}` (line 37-58)
2. ✅ Validates table exists (line 16-26)
3. ✅ Filters by `deletedAt: null` (line 31)
4. ✅ Optional `includeInactive` parameter (line 13, 32)

---

#### Endpoint: `/api/tables/[id]/seats` (POST)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seat: {...}, seats: [...]}` instead of `{data: {...}}` (line 155-177)
2. ✅ Socket dispatch present (line 153)
3. ✅ Validates table exists and gets `locationId` (line 87-96)
4. ✅ Supports `insertAt` for renumbering (lines 99-111)
5. ✅ Sets `originalRelativeX/Y/Angle` on creation (lines 140-142)

**Database Operations:**
- ✅ Auto-increments `seatNumber` if not provided (lines 114-122)
- ✅ Filters by `deletedAt: null` when checking max seat (line 117)

---

#### Endpoint: `/api/tables/[id]/seats/[seatId]` (GET)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seat: {...}}` instead of `{data: {...}}` (line 30-41)
2. ✅ Validates both `tableId` and `seatId` (line 14-21)
3. ✅ Filters by `isActive: true` and `deletedAt: null` (line 18-19)

---

#### Endpoint: `/api/tables/[id]/seats/[seatId]` (PUT)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after update
2. **Response format inconsistency** - Returns `{seat: {...}}` instead of `{data: {...}}` (line 128-139)
3. ✅ Smart `updateOriginal` logic based on combined state (lines 95-102)
4. ✅ Type-safe update with Prisma types (lines 104-122)

---

#### Endpoint: `/api/tables/[id]/seats/[seatId]` (DELETE)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after delete
2. ✅ Excellent audit logging (lines 204-218)
3. ✅ Checks for active tickets before delete (lines 181-193)
4. ✅ Uses transaction for atomic delete + audit log (lines 196-219)

---

#### Endpoint: `/api/tables/[id]/seats/generate` (POST)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seats: [...]}` instead of `{data: {...}}` (line 90-101)
2. ⚠️ **Hard deletes seats** - Uses `deleteMany()` instead of soft delete (line 57-59) - violates sync field requirement
3. ✅ Socket dispatch present (line 88)
4. ✅ Uses `generateSeatPositions()` from lib correctly (lines 47-53)
5. ✅ Supports `saveAsDefault` parameter (lines 17, 75-80)

---

#### Endpoint: `/api/tables/[id]/seats/auto-generate` (POST)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after generation
2. **Duplicate code** - Lines 19-324 contain copy-pasted `generateSeatPositions()` functions that already exist in `/src/lib/seat-generation.ts`
3. **Response format inconsistency** - Returns `{seats: [...], generated: N, seatPattern: ''}` instead of `{data: {...}}` (line 644-662)
4. ⚠️ **Hard deletes seats** - Uses `deleteMany()` instead of soft delete (line 585-588) - violates sync field requirement
5. ✅ Excellent collision detection (lines 436-576)
6. ✅ Audit logging (lines 621-637)

**Code Smell:** Why does this endpoint have its own copy of seat generation functions?

---

#### Endpoint: `/api/tables/[id]/seats/reflow` (POST)
**Status:** ⚠️ ISSUES
**Issues:**
1. **Response format inconsistency** - Returns `{seats: [...], message: ''}` instead of `{data: {...}}` (line 140-150)
2. ✅ Socket dispatch present (line 138)
3. ✅ Dynamic clearance calculation based on available space (lines 22-32, 53-57)
4. ✅ Handles round/oval tables differently (line 60, 74-95)

---

#### Endpoint: `/api/tables/[id]/seats/save-as-default` (POST)
**Status:** ⚠️ ISSUES (minor)
**Issues:**
1. ✅ **Proper response format** - Returns `{data: {...}}` (line 97-104)
2. ⚠️ **Missing socket dispatch** - Should notify POS terminals of position changes
3. ✅ Audit logging (lines 73-92)
4. ✅ Transaction for atomicity (lines 57-95)

---

#### Endpoint: `/api/tables/[id]/seats/bulk` (PUT)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after bulk update
2. **Response format inconsistency** - Returns `{seats: [...], updated: N}` instead of `{data: {...}}` (line 79-91)
3. ✅ Validates all seats belong to table (lines 45-60)
4. ✅ Uses transaction for atomic bulk update (lines 63-77)

---

### Batch Seat Operations

#### Endpoint: `/api/tables/seats/generate-all` (POST)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after generation
2. **Duplicate code** - Lines 19-249 contain copy-pasted `generateSeatPositions()` functions
3. ✅ Proper response format (line 364-370)
4. ✅ Audit logging (lines 343-361)
5. ⚠️ Uses `createMany()` which doesn't return created IDs (line 322)

**Why duplicate code?** This file has the SAME seat generation functions as `/src/app/api/tables/[id]/seats/auto-generate/route.ts`

---

#### Endpoint: `/api/tables/seats/save-all-as-default` (POST)
**Status:** ⚠️ ISSUES (minor)
**Issues:**
1. ✅ **Proper response format** - Returns `{data: {...}}` (line 101-107)
2. ⚠️ **Missing socket dispatch** - Should notify POS terminals
3. ✅ Audit logging (lines 83-96)
4. ✅ Supports optional `tableIds` parameter for selective save (lines 28-30)

---

#### Endpoint: `/api/tables/seats/reflow` (POST)
**Status:** ❌ CRITICAL ISSUES
**Issues:**
1. **Missing socket dispatch** - No `dispatchFloorPlanUpdate()` call after reflow
2. ✅ **Proper response format** - Returns `{data: {...}}` (line 253-258)
3. ✅ Uses `distributeSeatsOnPerimeter()` from `table-geometry` lib (line 112)
4. ✅ Handles seat count changes (add/remove seats) (lines 129-158)
5. ✅ Sorts seats clockwise and renumbers (lines 198, 227-228)

**Note:** This is a different `/reflow` endpoint than the single-table one. This one operates on multiple tables (virtual groups).

---

## Library File Audit

### Library: `seat-generation.ts`
**Status:** ✅ CLEAN
**Functions exported:**
- `generateSeatPositions()` - Main entry point (line 60)
- `generateRectangleSeats()` - Rectangle/square logic (line 90)
- `generateRoundSeats()` - Round table logic (line 329)
- `generateOvalSeats()` - Oval table logic (line 375)
- `generateBoothSeats()` - Booth table logic (line 421)
- `redistributeSeats()` - Capacity change helper (line 451)
- `insertSeatAt()` - Add seat at specific index (line 472)

**Types exported:**
- `TableShape` (line 20)
- `SeatPattern` (line 21)
- `SeatPosition` (line 29)
- `GenerateSeatPositionsParams` (line 36)

**Issues:** None - well-structured, comprehensive

**Usage across codebase:**
- ✅ Used by `/api/tables/[id]/seats/generate/route.ts` (line 4)
- ❌ NOT used by `/api/tables/[id]/seats/auto-generate/route.ts` (has duplicate copy)
- ❌ NOT used by `/api/tables/seats/generate-all/route.ts` (has duplicate copy)

---

### Library: `seat-utils.ts`
**Status:** ✅ CLEAN
**Functions exported:**
- `calculateSeatBalance()` - Per-seat subtotal/tax/total (line 72)
- `determineSeatStatus()` - Status based on items/payments (line 100)
- `calculateAllSeatBalances()` - All seats in order (line 136)
- `calculateSeatPositions()` - Circular orbit positions (line 161)
- `formatSeatBalance()` - Currency formatting (line 184)

**Types exported:**
- `SeatStatus` (line 7)
- `SeatInfo` (line 9)
- `OrderItemForSeat` (line 19)
- `PaymentForSeat` (line 31)

**Constants exported:**
- `SEAT_STATUS_COLORS` (line 39)
- `SEAT_STATUS_BG_COLORS` (line 50)
- `SEAT_STATUS_GLOW` (line 61)

**Issues:** None

**Usage:** This is for UI/business logic, NOT used by API endpoints. Used by order components for seat-level billing.

---

### Library: `virtual-group-seats.ts`
**Status:** ✅ CLEAN
**Functions exported:**
- `calculateVirtualSeatNumbers()` - Main algorithm (line 41)
- `restoreOriginalSeatNumbers()` - Undo grouping (line 102)
- `getVirtualSeatLabel()` - Display label formatting (line 123)
- `getVirtualGroupSeatCount()` - Total seats in group (line 136)
- `getVirtualGroupSeatSummary()` - Seat distribution per table (line 143)

**Types exported:**
- `VirtualSeatInfo` (line 8)
- `TableWithSeats` (line 18)

**Issues:** None

**Algorithm:**
1. Primary table seats come first (1, 2, 3...)
2. Secondary tables ordered by position (clockwise from primary)
3. Each table's seats ordered by `seatNumber`
4. Returns mapping with virtual labels like "T1-3"

**Usage:** Used by virtual group combine/split logic

---

## Critical Issues (Must Fix)

### 1. Missing Socket Dispatch (6 occurrences)
Socket dispatch is REQUIRED after any seat mutation so POS terminals update in real-time.

| Endpoint | Line | Fix |
|----------|------|-----|
| `/api/tables/[id]/seats/[seatId]` (PUT) | After 126 | Add `dispatchFloorPlanUpdate(table.locationId, { async: true })` |
| `/api/tables/[id]/seats/[seatId]` (DELETE) | After 219 | Add `dispatchFloorPlanUpdate(existingSeat.table.locationId, { async: true })` |
| `/api/tables/[id]/seats/auto-generate` (POST) | After 642 | Add `dispatchFloorPlanUpdate(table.locationId, { async: true })` |
| `/api/tables/[id]/seats/bulk` (PUT) | After 77 | Fetch `locationId` from table, then dispatch |
| `/api/tables/seats/generate-all` (POST) | After 340 | Add `dispatchFloorPlanUpdate(locationId, { async: true })` |
| `/api/tables/seats/reflow` (POST) | After 233 | Add `dispatchFloorPlanUpdate(locationId, { async: true })` |

---

### 2. Hard Deletes Instead of Soft Deletes (2 occurrences)
Per CLAUDE.md, ALL deletes must be soft deletes (set `deletedAt`) for cloud sync support.

| File | Line | Current | Fix |
|------|------|---------|-----|
| `/api/tables/[id]/seats/generate/route.ts` | 57-59 | `deleteMany()` | Use `updateMany()` with `deletedAt: new Date()` |
| `/api/tables/[id]/seats/auto-generate/route.ts` | 585-588 | `deleteMany()` | Use `updateMany()` with `deletedAt: new Date()` |

**Impact:** Hard deletes cause sync conflicts when location syncs to cloud.

---

### 3. Duplicate Seat Generation Code (2 files, ~250 lines each)
Two files contain FULL copies of seat generation functions that exist in `/src/lib/seat-generation.ts`:

| File | Lines | Functions Duplicated |
|------|-------|---------------------|
| `/api/tables/[id]/seats/auto-generate/route.ts` | 19-324 | `generateSeatPositions`, `generateSeatsAllAround`, `generateSeatsFrontOnly`, `generateSeatsThreeSides`, `generateSeatsTwoSides`, `generateSeatsInside`, `getLabel` |
| `/api/tables/seats/generate-all/route.ts` | 14-249 | Same as above |

**Fix:** Import from `/src/lib/seat-generation.ts` instead of duplicating.

---

## Warnings (Should Fix)

### 1. Response Format Inconsistency (11 endpoints)
Per API conventions in CLAUDE.md, responses should use `{data: T}` on success, `{error: string}` on failure.

**Non-conforming endpoints:**
- `/api/seats` (GET) - Returns `{seats: []}`
- `/api/seats` (POST) - Returns `{seat: {}}`
- `/api/seats/[id]` (GET/PUT) - Returns `{seat: {}}`
- `/api/tables/[id]/seats` (GET) - Returns `{seats: [], table: {}}`
- `/api/tables/[id]/seats` (POST) - Returns `{seat: {}, seats: []}`
- `/api/tables/[id]/seats/[seatId]` (GET/PUT) - Returns `{seat: {}}`
- `/api/tables/[id]/seats/generate` (POST) - Returns `{seats: []}`
- `/api/tables/[id]/seats/auto-generate` (POST) - Returns `{seats: [], generated: N}`
- `/api/tables/[id]/seats/reflow` (POST) - Returns `{seats: [], message: ''}`
- `/api/tables/[id]/seats/bulk` (PUT) - Returns `{seats: [], updated: N}`

**Conforming endpoints (good examples):**
- ✅ `/api/seats/cleanup-duplicates` - Returns `{message: '', ...}` or `{error: ''}`
- ✅ `/api/tables/[id]/seats/save-as-default` - Returns `{data: {...}}`
- ✅ `/api/tables/seats/save-all-as-default` - Returns `{data: {...}}`
- ✅ `/api/tables/seats/reflow` (batch) - Returns `{data: {...}}`

---

### 2. Missing Socket Dispatch After Default Position Saves (2 endpoints)
When default positions are saved, POS should be notified:
- `/api/tables/[id]/seats/save-as-default` (POST)
- `/api/tables/seats/save-all-as-default` (POST)

**Note:** Lower priority than mutation socket dispatches.

---

### 3. Missing `deletedAt` Filter in Max Seat Query
`/api/seats` (POST) line 99 - When finding max `seatNumber`, should filter `deletedAt: null` to avoid skipping seat numbers:

```typescript
// Current (line 98-102)
const maxSeat = await db.seat.findFirst({
  where: { tableId, deletedAt: null }, // ✅ Filter is present, this is fine
  orderBy: { seatNumber: 'desc' },
});
```

**Status:** Actually CLEAN on review - the filter IS present.

---

## Duplicate Code

### Instance 1: Seat Generation Functions
**Files affected:**
- `/src/app/api/tables/[id]/seats/auto-generate/route.ts` (lines 19-324)
- `/src/app/api/tables/seats/generate-all/route.ts` (lines 14-249)
- `/src/lib/seat-generation.ts` (canonical source)

**Duplicated functions:**
- `generateSeatPositions()`
- `generateSeatsAllAround()`
- `generateSeatsFrontOnly()`
- `generateSeatsThreeSides()`
- `generateSeatsTwoSides()`
- `generateSeatsInside()`
- `getLabel()`
- `SeatPattern` type
- `SeatPosition` interface

**Total duplicate lines:** ~500 lines across 2 files

**Fix:** Import from `@/lib/seat-generation` instead of copy-pasting.

---

## Inconsistencies

### 1. Two Different `reflow` Endpoints
| Endpoint | Purpose | Uses |
|----------|---------|------|
| `/api/tables/[id]/seats/reflow` | Reflow single table when resized | Dynamic clearance, edge-relative positioning |
| `/api/tables/seats/reflow` | Reflow virtual group (multiple tables) | Perimeter distribution, clockwise sorting |

**Not really an inconsistency** - these serve different purposes. But naming could be clearer (e.g., `/reflow-group`).

---

### 2. Hard Delete vs Soft Delete
Most endpoints use soft delete (`deletedAt: new Date()`):
- ✅ `/api/seats/[id]` (DELETE) - Uses `softDeleteData()` helper
- ✅ `/api/tables/[id]/seats/[seatId]` (DELETE) - Sets `deletedAt: new Date()`
- ✅ `/api/tables/seats/generate-all` (POST) - Soft deletes with `updateMany()`

But 2 endpoints hard delete:
- ❌ `/api/tables/[id]/seats/generate` (POST) - `deleteMany()` line 57
- ❌ `/api/tables/[id]/seats/auto-generate` (POST) - `deleteMany()` line 585

**Fix:** Use soft delete consistently everywhere.

---

### 3. Socket Dispatch Usage
Most mutation endpoints dispatch socket events, but 6 don't (see Critical Issues #1).

---

### 4. Response Format (Documented in Warnings #1)
Inconsistent use of `{data: {}}` wrapper vs direct property returns.

---

## Specific Questions Answered

### 1. Are there duplicate routes doing the same thing?

**Yes - partial overlap:**

| Route Pair | Overlap | Difference |
|------------|---------|------------|
| `/api/seats` vs `/api/tables/[id]/seats` | Both list/create seats | `/seats` requires query param `tableId`, `/tables/[id]/seats` has `tableId` in path |
| `/api/seats/[id]` vs `/api/tables/[id]/seats/[seatId]` | Both get/update/delete single seat | `/tables/.../[seatId]` validates table ownership, has better audit logging |

**Recommendation:** Consider deprecating standalone `/api/seats` routes in favor of table-scoped routes for consistency.

---

### 2. Is `generateSeatPositions()` called consistently?

**No - mixed usage:**

| Endpoint | Uses Lib? | Notes |
|----------|-----------|-------|
| `/api/tables/[id]/seats/generate` | ✅ Yes | Imports from `@/lib/seat-generation` |
| `/api/tables/[id]/seats/auto-generate` | ❌ No | Has own copy (lines 19-324) |
| `/api/tables/seats/generate-all` | ❌ No | Has own copy (lines 14-249) |

**Fix:** All endpoints should import from `/src/lib/seat-generation.ts`.

---

### 3. Do all endpoints that modify seats dispatch socket events?

**No - 6 endpoints missing dispatch:**
1. `/api/tables/[id]/seats/[seatId]` (PUT) - Updates seat position
2. `/api/tables/[id]/seats/[seatId]` (DELETE) - Deletes seat
3. `/api/tables/[id]/seats/auto-generate` (POST) - Generates seats
4. `/api/tables/[id]/seats/bulk` (PUT) - Bulk updates
5. `/api/tables/seats/generate-all` (POST) - Bulk generation
6. `/api/tables/seats/reflow` (POST) - Group reflow

**Endpoints that DO dispatch (examples):**
- ✅ `/api/seats` (POST)
- ✅ `/api/seats/[id]` (PUT/DELETE)
- ✅ `/api/tables/[id]/seats` (POST)
- ✅ `/api/tables/[id]/seats/generate` (POST)
- ✅ `/api/tables/[id]/seats/reflow` (POST)

---

### 4. Is the `SeatPosition` type consistent everywhere?

**Yes - mostly consistent:**

**Canonical definition** (`/src/lib/seat-generation.ts` line 29):
```typescript
export interface SeatPosition {
  seatNumber: number; // 1-based
  relativeX: number;  // Offset from table center (pixels)
  relativeY: number;  // Offset from table center (pixels)
  angle: number;      // Facing direction (0 = up, 90 = right, etc.)
}
```

**Duplicate definitions** (in files with duplicate code):
- `/api/tables/[id]/seats/auto-generate/route.ts` line 14 - IDENTICAL
- `/api/tables/seats/generate-all/route.ts` line 6 - IDENTICAL

**No conflicts** - all definitions match.

---

### 5. Are there any TODO comments or incomplete implementations?

**Searched all files - NO TODO comments found.**

All endpoints appear to be complete implementations.

---

### 6. Does `cleanup-duplicates` actually work?

**Yes - appears functional:**

**Logic (lines 38-68):**
1. ✅ Finds all active seats for location
2. ✅ Groups by `tableId:seatNumber` key
3. ✅ Identifies groups with >1 seat
4. ✅ Keeps oldest (by `createdAt`), marks rest for deletion
5. ✅ Dry-run mode returns preview without changes
6. ✅ Actual mode soft-deletes duplicates

**Potential issue:**
- Uses `updateMany()` to soft delete (lines 95-101), which is correct
- ⚠️ Does NOT dispatch socket event after cleanup - POS terminals won't update

**Overall:** Functional, but missing socket dispatch.

---

## Recommendations

### Priority 1: Fix Critical Issues
1. **Add missing socket dispatches** (6 endpoints) - WITHOUT THIS, POS won't update in real-time
2. **Replace hard deletes with soft deletes** (2 endpoints) - Violates sync requirements
3. **Eliminate duplicate code** (2 files) - Maintenance nightmare

### Priority 2: Consistency Improvements
1. **Standardize response format** to `{data: T}` pattern (11 endpoints)
2. **Add socket dispatch to save-as-default endpoints** (2 endpoints)
3. **Consider deprecating standalone `/api/seats` routes** in favor of table-scoped routes

### Priority 3: Code Quality
1. **Add API integration tests** for seat CRUD operations
2. **Add collision detection tests** for auto-generate
3. **Document virtual group seat numbering algorithm** in more detail

---

## Example Fixes

### Fix 1: Add Socket Dispatch to PUT /api/tables/[id]/seats/[seatId]

**File:** `/src/app/api/tables/[id]/seats/[seatId]/route.ts`
**After line 126, add:**

```typescript
// Get table's locationId for socket dispatch
const table = await db.table.findUnique({
  where: { id: tableId },
  select: { locationId: true },
});

if (table) {
  dispatchFloorPlanUpdate(table.locationId, { async: true });
}
```

**Also add import at top:**
```typescript
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
```

---

### Fix 2: Replace Hard Delete with Soft Delete

**File:** `/src/app/api/tables/[id]/seats/generate/route.ts`
**Replace lines 55-59:**

```typescript
// OLD (hard delete)
await db.seat.deleteMany({
  where: { tableId },
});

// NEW (soft delete)
await db.seat.updateMany({
  where: { tableId },
  data: {
    deletedAt: new Date(),
    isActive: false,
  },
});
```

---

### Fix 3: Eliminate Duplicate Code

**File:** `/src/app/api/tables/[id]/seats/auto-generate/route.ts`
**Delete lines 11-324** (entire duplicate section)

**Add import at top:**
```typescript
import { generateSeatPositions, type SeatPattern } from '@/lib/seat-generation';
```

**Update line 426-434** to use imported function:
```typescript
const seatPositions = generateSeatPositions({
  shape: (table.shape as 'rectangle' | 'square' | 'round' | 'oval' | 'booth') || 'rectangle',
  pattern: pattern,
  capacity: seatCount,
  width: table.width,
  height: table.height,
});
```

---

## Conclusion

The Seats API is **functional but inconsistent**. Major issues:
1. **6 endpoints missing socket dispatch** - Critical for real-time updates
2. **500+ lines of duplicate code** - Maintenance burden
3. **2 endpoints using hard deletes** - Violates sync requirements
4. **11 endpoints with non-standard response format** - Inconsistent with conventions

**Overall Grade: C+ (Functional but needs refactoring)**

Once critical issues are fixed, the API will be production-ready. Library files are clean and well-structured.

---

**End of Audit Report**
