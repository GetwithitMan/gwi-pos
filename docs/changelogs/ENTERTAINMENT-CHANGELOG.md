# Entertainment Domain - Change Log

## 2026-03-13 — Android Register BAR Tab Timer Fix + Server Sync Fixes

### Android Register: Timed Rental on BAR Tab (`bd3b037`)
- **Bug:** Tapping timed_rental item on BAR tab added it like a regular item — no timer started
- **Root cause:** `startRental()` → `ensureOrder()` returns null on BAR tab → deferred to NewTab dialog but rental minutes lost
- **Fix:** Added `pendingTimedRentalMinutes` state field. `createBarTab()` consumes it after order creation: fetches fresh order from server API, finds OrderItem by menuItemId, calls `startBlockTime`.
- **Files:** `OrderViewModel.kt` (6 edit points)
- **E2E:** L1400 → Dart Board → 30 min → Open Tab → Timer starts → PitBoss shows "IN USE"

### Server: FloorPlanElement.sessionExpiresAt Sync on Extend
- PATCH `/api/entertainment/block-time` now updates `FloorPlanElement.sessionExpiresAt` when extending time
- Previously only updated `OrderItem.blockTimeExpiresAt` — PitBoss countdown showed stale time

### Server: Waitlist DELETE Dispatch Fix
- DELETE `/api/entertainment/waitlist/[id]` now dispatches `entertainmentWaitlistChanged` to PitBoss
- Previously only dispatched `floorPlanUpdate`, missing the waitlist count badge update

### Web POS: Timer Never Starting (`89f3e447`)
- `handleStartTimedSession` never called block-time API — fixed
- All 3 add-item paths sent wrong format `{menuItemId}` instead of `{items:[{...}]}` — fixed
- Items API missing name fallback — added `menuItem.name`
- Settings page router paths fixed (edit items works)

---

## 2026-02-24 — Minimum Charge, Status Toggle & Per-Minute Settlement (`743e618`)

### minimumCharge Enforcement
- Timed sessions enforce `minimumCharge` at settlement -- if elapsed cost is below minimum, the minimum is charged instead

### Void / Un-Void Status Toggle
- Void sets `entertainmentStatus` to `available`, freeing the entertainment item
- Un-void restores `entertainmentStatus` to `in_use`

### Per-Minute Pricing Settlement
- Per-minute pricing calculation integrated into the pay route for accurate timed-session billing

---

## Session: February 5, 2026 (Domain Creation)

### Domain Initialization

The Entertainment domain has been spun off from the Floor Plan domain to better organize entertainment-specific functionality.

### Existing Code Inventory

**What Already Exists (Inherited):**

| Category | Files | Status |
|----------|-------|--------|
| **Builder Page** | `/timed-rentals/page.tsx` | ✅ Enhanced - full item management grid |
| **KDS Dashboard** | `/kds/entertainment/page.tsx` | Exists - needs testing |
| **Status API** | `/api/entertainment/status` | ✅ Exists - GET/PATCH |
| **Block Time API** | `/api/entertainment/block-time` | ✅ Exists - POST/PATCH/DELETE |
| **Waitlist API** | `/api/entertainment/waitlist` | ✅ Exists - GET/POST |
| **Visual Components** | `entertainment-visuals.tsx` | ✅ 12 SVG types |
| **Floor Plan Palette** | `AddEntertainmentPalette.tsx` | ✅ Exists |
| **Session Controls** | `EntertainmentSessionControls.tsx` | Exists |
| **Properties Panel** | `EntertainmentProperties.tsx` | ✅ Wired into FloorPlanEditor |
| **Utility Functions** | `/lib/entertainment.ts` | Exists |

### Work Completed Today

| Task | Description | Files |
|------|-------------|-------|
| **Builder Enhancement** | Added items grid, filter by categoryType, full edit form | `timed-rentals/page.tsx` |
| **Menu Routing** | Entertainment category routes to /timed-rentals | `menu/page.tsx` |
| **Domain Documentation** | Created ENTERTAINMENT-DOMAIN.md | `docs/domains/` |
| **Changelog** | Created this file | `docs/changelogs/` |
| **Domain Registry** | Added Domain 11 to CLAUDE.md | `CLAUDE.md` |

### Known Issues

1. **PATCH endpoint missing locationId verification** - Security risk in status API
2. **Block Time API missing socket dispatch** - POS terminals won't see real-time updates
3. **Session flow untested** - Full start→extend→stop flow needs verification
4. **Waitlist notifications** - No SMS/push integration yet

---

## Worker Prompts (Ready to Send)

### Worker E1: API Audit - Entertainment Status Endpoint

```
You are a DEVELOPER auditing the Entertainment Status API in GWI POS.

## Context
The `/api/entertainment/status/route.ts` endpoint needs security and consistency fixes to match GWI POS patterns.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════════════════

**File to Modify:** `src/app/api/entertainment/status/route.ts`

## Issues to Fix

### 1. PATCH Missing locationId Verification (SECURITY - Lines 206-275)
The PATCH handler updates elements without verifying locationId, allowing cross-tenant access.

**Current (INSECURE):**
```typescript
export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { elementId, status, ... } = body
  // NO locationId check!
  const updatedElement = await db.floorPlanElement.update({
    where: { id: elementId },
    data: updateData,
  })
}
```

**Fix Required:**
```typescript
export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { elementId, locationId, status, ... } = body

  if (!elementId || !locationId) {
    return NextResponse.json(
      { error: 'Element ID and Location ID are required' },
      { status: 400 }
    )
  }

  // Verify element belongs to location
  const element = await db.floorPlanElement.findFirst({
    where: { id: elementId, locationId, deletedAt: null }
  })

  if (!element) {
    return NextResponse.json(
      { error: 'Element not found' },
      { status: 404 }
    )
  }

  // Then update
  const updatedElement = await db.floorPlanElement.update({
    where: { id: elementId },
    data: updateData,
  })
}
```

### 2. Add Socket Dispatch (After PATCH success - around line 267)
Real-time updates require socket dispatch.

**Add import at top:**
```typescript
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
```

**Add after successful update (before return):**
```typescript
// Dispatch real-time update
dispatchFloorPlanUpdate(locationId, { async: true })
```

### 3. Response Format Consistency
Change response from `{ element: ... }` to `{ data: { element: ... } }` for consistency.

## Acceptance Criteria
- [ ] PATCH requires locationId in body
- [ ] PATCH verifies element belongs to location before updating
- [ ] Socket dispatch fires after successful PATCH
- [ ] Response format uses `{ data: ... }` wrapper
- [ ] No TypeScript errors

## Verification
1. Try PATCH without locationId → should return 400
2. Try PATCH with wrong locationId → should return 404
3. Successful PATCH → should trigger socket event
```

---

### Worker E2: API Audit - Block Time Endpoint

```
You are a DEVELOPER auditing the Entertainment Block Time API in GWI POS.

## Context
The `/api/entertainment/block-time/route.ts` manages session timers but is missing security checks and socket dispatch.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════════════════

**File to Modify:** `src/app/api/entertainment/block-time/route.ts`

## Issues to Fix

### 1. Missing locationId Verification (All handlers)
None of the handlers verify locationId. Add to POST, PATCH, and DELETE.

**POST handler (around line 24):**
- Get orderItem and verify its order belongs to the correct location
- Add check: `orderItem.order.locationId === locationId`

### 2. Add Socket Dispatch (All mutations)
Real-time updates required for KDS and POS.

**Add import at top:**
```typescript
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
```

**Add after each successful mutation:**
- POST (after line 96): `dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })`
- PATCH (after line 194): `dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })`
- DELETE (after line 280): `dispatchFloorPlanUpdate(orderItem.order.locationId, { async: true })`

### 3. Update FloorPlanElement Status (Lines 88-96)
When starting block time, also update the FloorPlanElement (if linked).

**Add after MenuItem update (around line 96):**
```typescript
// Update floor plan element if exists
if (orderItem.menuItem.id) {
  await db.floorPlanElement.updateMany({
    where: {
      linkedMenuItemId: orderItem.menuItem.id,
      deletedAt: null,
    },
    data: {
      status: 'in_use',
      currentOrderId: orderItem.orderId,
      sessionStartedAt: now,
      sessionExpiresAt: expiresAt,
    },
  })
}
```

### 4. Update FloorPlanElement on DELETE (Lines 264-280)
When stopping block time, also reset the FloorPlanElement.

**Add after MenuItem reset (around line 280):**
```typescript
// Reset floor plan element
await db.floorPlanElement.updateMany({
  where: {
    linkedMenuItemId: orderItem.menuItemId,
    deletedAt: null,
  },
  data: {
    status: 'available',
    currentOrderId: null,
    sessionStartedAt: null,
    sessionExpiresAt: null,
  },
})
```

### 5. Remove console.log statements (Lines 265, 281)
Remove debug logging before production.

## Acceptance Criteria
- [ ] All handlers include locationId verification
- [ ] Socket dispatch fires after POST/PATCH/DELETE
- [ ] FloorPlanElement status syncs with session changes
- [ ] No console.log debug statements
- [ ] No TypeScript errors

## Verification
1. Start session → FloorPlanElement.status = 'in_use'
2. Stop session → FloorPlanElement.status = 'available'
3. All changes trigger socket events
```

---

### Worker E3: API Audit - Waitlist Endpoints

```
You are a DEVELOPER auditing the Entertainment Waitlist API in GWI POS.

## Context
The `/api/entertainment/waitlist/route.ts` needs socket dispatch and potential race condition fixes.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════════════════

**Files to Modify:**
1. `src/app/api/entertainment/waitlist/route.ts`
2. `src/app/api/entertainment/waitlist/[id]/route.ts` (if exists)

## Issues to Fix

### 1. Add Socket Dispatch to POST (Lines 178-234)
Notify KDS when someone joins the waitlist.

**Add import at top:**
```typescript
import { dispatchWaitlistUpdate } from '@/lib/socket-dispatch'
```

Note: If `dispatchWaitlistUpdate` doesn't exist, use:
```typescript
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
```

**Add after successful create (before return around line 225):**
```typescript
// Dispatch real-time update
dispatchFloorPlanUpdate(locationId, { async: true })
```

### 2. Position Race Condition (Lines 163-170)
The current position calculation could have race conditions if two entries are added simultaneously.

**Current:**
```typescript
const currentWaitlistCount = await db.entertainmentWaitlist.count({...})
// ... create with position: currentWaitlistCount + 1
```

**Fix - Use transaction:**
```typescript
const entry = await db.$transaction(async (tx) => {
  const currentWaitlistCount = await tx.entertainmentWaitlist.count({
    where: {
      locationId,
      deletedAt: null,
      status: 'waiting',
      ...(elementId ? { elementId } : { visualType }),
    },
  })

  return tx.entertainmentWaitlist.create({
    data: {
      ...data,
      position: currentWaitlistCount + 1,
    },
    include: {...}
  })
})
```

### 3. Waitlist [id] Endpoint (If exists)
Check `src/app/api/entertainment/waitlist/[id]/route.ts` for:
- PATCH: Requires locationId verification + socket dispatch
- DELETE: Requires locationId verification + socket dispatch + position recalculation

**Position recalculation on removal:**
When a waitlist entry is removed (status changed to 'cancelled' or deleted), all entries with higher positions should be decremented.

```typescript
// After soft delete or status change:
await db.entertainmentWaitlist.updateMany({
  where: {
    locationId,
    status: 'waiting',
    deletedAt: null,
    position: { gt: removedEntry.position }
  },
  data: {
    position: { decrement: 1 }
  }
})
```

## Acceptance Criteria
- [ ] POST uses transaction for position assignment
- [ ] Socket dispatch fires after mutations
- [ ] Position recalculation when entries are removed
- [ ] locationId verified on all mutations
- [ ] No TypeScript errors

## Verification
1. Add two entries simultaneously → positions should be unique
2. Remove entry at position 2 → entries at 3,4,5 become 2,3,4
3. KDS updates in real-time when waitlist changes
```

---

### Worker E4: Test Entertainment Session Flow

```
You are a TESTER verifying the entertainment session flow in GWI POS.

## Test Scenarios

### 1. Start Session
- Create order with entertainment item (timed_rental)
- Click "Send to Kitchen"
- Verify: entertainmentStatus = 'in_use' on MenuItem
- Verify: Timer starts on KDS
- Verify: Timer shows in Open Orders panel
- Verify: FloorPlanElement.status = 'in_use' (if linked)

### 2. Extend Session
- With active session, click "Extend"
- Add 30 minutes
- Verify: blockTimeExpiresAt updated
- Verify: Timer reflects new time
- Verify: FloorPlanElement.sessionExpiresAt updated

### 3. Stop Session
- Click "Stop & Bill"
- Verify: entertainmentStatus = 'available' on MenuItem
- Verify: currentOrderId cleared on MenuItem
- Verify: Timer stops
- Verify: FloorPlanElement.status = 'available'

### 4. Auto-Expire Warning
- Wait until 5 min remaining
- Verify: Yellow warning state
- Wait until 2 min remaining
- Verify: Red urgent state

## Files to Check
- `/api/entertainment/block-time/route.ts` - Start/extend/stop
- `/api/entertainment/status/route.ts` - Status updates
- `EntertainmentSessionControls.tsx` - UI controls
- `EntertainmentItemCard.tsx` - KDS display

## Expected API Calls
1. POST /api/entertainment/block-time (start)
2. PATCH /api/entertainment/block-time (extend)
3. DELETE /api/entertainment/block-time?orderItemId=xxx (stop)

## Report Format
Document:
- ✅ What works
- ❌ What fails (with error messages)
- ⚠️ What partially works
- 📝 Suggested fixes
```

---

### Worker E5: Waitlist Notification System (FUTURE)

```
You are a DEVELOPER planning the waitlist notification system for GWI POS Entertainment domain.

## Requirements
- SMS notification when customer's turn comes up
- In-app notification on POS
- Configurable notification message template
- Auto-expire if not claimed within X minutes

## Dependencies
- Twilio integration (already exists for void approvals at /src/lib/twilio.ts)
- Socket.io for real-time notifications (already exists)

## Implementation Plan

### 1. Schema Changes
```prisma
model EntertainmentWaitlist {
  // Existing fields...

  // Add notification fields
  notificationSentAt    DateTime?
  notificationMethod    String?   // 'sms' | 'push' | 'both'
  claimExpiresAt        DateTime?
  claimedAt             DateTime?
}

model LocationSettings {
  // Add entertainment waitlist settings
  waitlistNotifyOnAvailable   Boolean @default(true)
  waitlistClaimTimeoutMinutes Int     @default(10)
  waitlistSmsTemplate         String?
}
```

### 2. API Endpoint
`POST /api/entertainment/waitlist/[id]/notify`
- Sends SMS via Twilio
- Sets notificationSentAt
- Calculates claimExpiresAt
- Dispatches socket event

### 3. Auto-Expire Job
Background process that:
- Checks for expired claims (claimExpiresAt < now)
- Moves expired to 'expired' status
- Promotes next in queue
- Sends notification to next person

### 4. UI Components
- NotifyButton in WaitlistPanel
- ClaimTimer showing countdown
- ExpiredBadge for timed-out entries

## Priority
🟢 LOW - Future enhancement after core functionality is stable
```

---

## API Audit Summary (UPDATED - Workers E1-E3 Complete)

| API | locationId | Socket Dispatch | Soft Deletes | Issues |
|-----|------------|-----------------|--------------|--------|
| `/api/entertainment/status` GET | ✅ | N/A | ✅ | None |
| `/api/entertainment/status` PATCH | ✅ Fixed (E1) | ✅ Fixed (E1) | N/A | None |
| `/api/entertainment/block-time` POST | ✅ Fixed (E2) | ✅ Fixed (E2) | N/A | None |
| `/api/entertainment/block-time` PATCH | ✅ Fixed (E2) | ✅ Fixed (E2) | N/A | None |
| `/api/entertainment/block-time` DELETE | ✅ Fixed (E2) | ✅ Fixed (E2) | N/A | None |
| `/api/entertainment/waitlist` GET | ✅ | N/A | ✅ | None |
| `/api/entertainment/waitlist` POST | ✅ | ✅ Fixed (E3) | N/A | Race condition fixed |
| `/api/entertainment/waitlist/[id]` PATCH | ✅ Fixed (E3) | ✅ Fixed (E3) | N/A | None |
| `/api/entertainment/waitlist/[id]` DELETE | ✅ Fixed (E3) | ✅ Fixed (E3) | N/A | Position recalc added |

---

## Session: February 5, 2026 (API Audit - Workers E1-E4)

### Workers Completed

| Worker | Task | Status |
|--------|------|--------|
| E1 | Status API Audit | ✅ Complete |
| E2 | Block Time API Audit | ✅ Complete |
| E3 | Waitlist API Audit | ✅ Complete |
| E4 | Session Flow Testing | ✅ Complete - Found 3 bugs |

### Bugs Found by Worker E4 (Testing)

| Bug | Severity | File | Description |
|-----|----------|------|-------------|
| **1** | 🔴 CRITICAL | `EntertainmentSessionControls.tsx` | Missing `locationId` in all API calls (DELETE, PATCH, POST) |
| **2** | 🟡 HIGH | `/api/orders/[id]/send/route.ts` | Send to Kitchen updates MenuItem but NOT FloorPlanElement |
| **3** | 🟢 LOW | `EntertainmentSessionControls.tsx` | `isExpiringSoon` threshold wrong (`< 5` should be `<= 10`) |

---

## Worker Prompts (Ready to Send - Bugs from E4)

### Worker E6: Fix EntertainmentSessionControls Missing locationId

```
You are a DEVELOPER fixing API call parameters in GWI POS Entertainment domain.

## Context
Worker E4 (testing) discovered that EntertainmentSessionControls.tsx is missing locationId in all API calls. The block-time API now requires locationId after Worker E2's security fixes, causing all session controls to fail with 400 "Location ID is required".

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════════════════

**File to Modify:** `src/components/orders/EntertainmentSessionControls.tsx`

## Problem
The component doesn't have access to locationId and doesn't pass it to API calls.

## Changes Required

### 1. Add locationId to Props Interface (lines 6-18)
```typescript
interface EntertainmentSessionControlsProps {
  orderItemId: string
  menuItemId: string
  locationId: string  // ADD THIS
  itemName: string
  // ... rest of props
}
```

### 2. Add to Destructured Props (line 20-32)
```typescript
export function EntertainmentSessionControls({
  orderItemId,
  menuItemId,
  locationId,  // ADD THIS
  itemName,
  // ... rest
}: EntertainmentSessionControlsProps) {
```

### 3. Fix DELETE Request (line 95)
```typescript
// Before:
const response = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}`, {

// After:
const response = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}&locationId=${locationId}`, {
```

### 4. Fix PATCH Request Body (lines 121-124)
```typescript
// Before:
body: JSON.stringify({
  orderItemId,
  additionalMinutes: minutes,
}),

// After:
body: JSON.stringify({
  orderItemId,
  locationId,
  additionalMinutes: minutes,
}),
```

### 5. Fix POST Request Body (lines 148-151)
```typescript
// Before:
body: JSON.stringify({
  orderItemId,
  minutes,
}),

// After:
body: JSON.stringify({
  orderItemId,
  locationId,
  minutes,
}),
```

### 6. Fix isExpiringSoon Threshold (line 79)
```typescript
// Before:
setIsExpiringSoon(mins < 5)

// After (match status API threshold):
setIsExpiringSoon(mins <= 10)
```

## Acceptance Criteria
- [ ] locationId is a required prop
- [ ] DELETE includes locationId in query string
- [ ] PATCH includes locationId in body
- [ ] POST includes locationId in body
- [ ] isExpiringSoon triggers at 10 minutes or less
- [ ] No TypeScript errors

## Note
Parent components that use this component will need to pass locationId. Check for TypeScript errors after this change to identify which files need updating.
```

---

### Worker E7: Fix Send to Kitchen Missing FloorPlanElement Update

```
You are a DEVELOPER fixing the Send to Kitchen flow in GWI POS Entertainment domain.

## Context
Worker E4 (testing) discovered that when entertainment items are sent to kitchen, the MenuItem status is updated to 'in_use' but the FloorPlanElement is NOT updated. This causes the floor plan display to show the item as 'available' even though it's in use.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════════════════

**File to Modify:** `src/app/api/orders/[id]/send/route.ts`

## Current Code (lines 62-70)
```typescript
// Update the menu item status to in_use
await db.menuItem.update({
  where: { id: item.menuItem.id },
  data: {
    entertainmentStatus: 'in_use',
    currentOrderId: order.id,
    currentOrderItemId: item.id,
  }
})
```

## Changes Required

### After the menuItem.update (line 70), add FloorPlanElement update:

```typescript
// Update the menu item status to in_use
await db.menuItem.update({
  where: { id: item.menuItem.id },
  data: {
    entertainmentStatus: 'in_use',
    currentOrderId: order.id,
    currentOrderItemId: item.id,
  }
})

// Also update linked FloorPlanElement (if exists)
await db.floorPlanElement.updateMany({
  where: {
    linkedMenuItemId: item.menuItem.id,
    deletedAt: null,
  },
  data: {
    status: 'in_use',
    currentOrderId: order.id,
    sessionStartedAt: now,
    sessionExpiresAt: updateData.blockTimeExpiresAt,
  },
})
```

## Acceptance Criteria
- [ ] FloorPlanElement is updated when timed rental sent to kitchen
- [ ] FloorPlanElement.status = 'in_use'
- [ ] FloorPlanElement.sessionStartedAt = now
- [ ] FloorPlanElement.sessionExpiresAt matches OrderItem
- [ ] No TypeScript errors

## Verification
1. Add entertainment item to floor plan
2. Create order with that item
3. Send to kitchen
4. Check: FloorPlanElement.status should be 'in_use'
5. Check: Floor plan display shows item as in-use (amber glow)
```

---

### Worker E8: Update Parent Components to Pass locationId

```
You are a DEVELOPER updating parent components in GWI POS Entertainment domain.

## Context
Worker E6 added locationId as a required prop to EntertainmentSessionControls. Now all parent components that use this component need to be updated to pass locationId.

═══════════════════════════════════════════════════════════════════════════════
⚠️  SEARCH FOR ALL USAGES AND MODIFY AS NEEDED
═══════════════════════════════════════════════════════════════════════════════

## Step 1: Find All Usages
Search for `<EntertainmentSessionControls` in the codebase to find all parent components.

Likely locations:
- Open Orders panel components
- Order details components
- KDS entertainment components

## Step 2: For Each Usage, Add locationId Prop

The locationId should come from:
- The order object: `order.locationId`
- The location context/store
- Props passed down from parent

Example fix:
```typescript
// Before:
<EntertainmentSessionControls
  orderItemId={item.id}
  menuItemId={item.menuItemId}
  itemName={item.name}
  // ...
/>

// After:
<EntertainmentSessionControls
  orderItemId={item.id}
  menuItemId={item.menuItemId}
  locationId={order.locationId}  // ADD THIS
  itemName={item.name}
  // ...
/>
```

## Acceptance Criteria
- [ ] All usages of EntertainmentSessionControls include locationId prop
- [ ] No TypeScript errors
- [ ] Session controls work (stop/extend/start buttons functional)
```

---

## Workers E6-E8 Complete (February 5, 2026)

| Worker | Task | Status |
|--------|------|--------|
| E6 | Fix locationId in EntertainmentSessionControls | ✅ Complete |
| E7 | Fix Send to Kitchen FloorPlanElement update | ✅ Complete |
| E8 | Update parent components (verified - already done) | ✅ Complete |

### Changes Applied

**Worker E6 - EntertainmentSessionControls.tsx:**
- Added `locationId` as required prop
- DELETE includes locationId in query string
- PATCH includes locationId in body
- POST includes locationId in body
- Fixed isExpiringSoon threshold (`< 5` → `<= 10`)

**Worker E7 - /api/orders/[id]/send/route.ts:**
- Added FloorPlanElement update after MenuItem update (lines 72-84)
- Sets status='in_use', currentOrderId, sessionStartedAt, sessionExpiresAt

**Worker E8 - Verification:**
- Found single usage in orders/page.tsx (line 3604)
- Already passing `locationId={employee?.location?.id || ''}`
- No changes needed

---

## All Entertainment API Audit Workers Complete ✅

| Worker | Task | Status |
|--------|------|--------|
| E1 | Status API Audit | ✅ Complete |
| E2 | Block Time API Audit | ✅ Complete |
| E3 | Waitlist API Audit | ✅ Complete |
| E4 | Session Flow Testing | ✅ Complete |
| E6 | Fix locationId in controls | ✅ Complete |
| E7 | Fix Send to Kitchen | ✅ Complete |
| E8 | Update parent components | ✅ Complete |

---

---

## Phase 1: Per-Minute Pricing & Compact UI (February 5, 2026)

### Workers Completed

| Worker | Task | Status |
|--------|------|--------|
| E9 | Schema: Add per-minute pricing fields | ✅ Complete |
| E10 | Library: Create entertainment-pricing.ts | ✅ Complete |
| E11 | UI: Compact builder redesign | ✅ Complete |

### Changes Applied

**Worker E9 - prisma/schema.prisma (MenuItem model):**
- Added `ratePerMinute` Decimal field
- Added `minimumCharge` Decimal field
- Added `incrementMinutes` Int field with @default(15)
- Kept existing `timedPricing` JSON for backward compatibility

**Worker E10 - src/lib/entertainment-pricing.ts (NEW FILE):**
- `calculateCharge()` - Core pricing with minimum, increments, grace period
- `formatCharge()` - Format dollar amounts
- `minutesUntilNextCharge()` - Time until next increment
- `getPricingSummary()` - Human-readable pricing text
- `DEFAULT_PRICING` - Default configuration constant

**Worker E11 - src/app/(admin)/timed-rentals/page.tsx:**
- Removed scrolling (no max-h/overflow)
- Visual types in 6-column grid (2 rows)
- 4 pricing fields on 2 lines (rate, minimum, increment, grace)
- Live pricing hint that updates dynamically
- Inline status radio buttons
- Backward compatibility with legacy pricing fields

### New Pricing Model

```
Rate Per Minute: $0.25/min
Minimum Charge: $15 (covers 60 min)
Increment: 15 min (charges in 15-min blocks after minimum)
Grace Period: 5 min (leeway before next charge)
```

Example calculation at 86 minutes:
- First 60 min = $15.00 (minimum)
- 26 min overage - 5 min grace = 21 min chargeable
- 21 min / 15 min = 2 increments × $3.75 = $7.50
- **Total: $22.50**

---

---

## Phase 2: Dynamic Pricing - Prepaid Packages + Happy Hour (February 5, 2026)

### Workers Completed

| Worker | Task | Status |
|--------|------|--------|
| E12 | Schema: Add prepaid + happy hour fields | ✅ Complete |
| E13 | Library: Prepaid + happy hour calculations | ✅ Complete |
| E14 | UI: Builder with dynamic pricing sections | ✅ Complete |
| E15 | Component: EntertainmentSessionStart | ✅ Complete |

### Changes Applied

**Worker E12 - prisma/schema.prisma (MenuItem model):**
- `prepaidPackages` Json - Array of {minutes, price, label}
- `happyHourEnabled` Boolean @default(false)
- `happyHourDiscount` Int @default(50) - Percentage off
- `happyHourStart` String - "13:00" format
- `happyHourEnd` String - "16:00" format
- `happyHourDays` Json - ["monday", "tuesday", ...]

**Worker E13 - src/lib/entertainment-pricing.ts:**
- `PrepaidPackage` interface
- `HappyHourConfig` interface
- `isHappyHour()` - Check if current time is happy hour
- `getActiveRate()` - Get rate with happy hour discount
- `calculateChargeWithPrepaid()` - Full prepaid + overage calculation
- `getPackageSavings()` - Calculate savings vs open play
- `formatPackage()` - Format for display
- `DEFAULT_PREPAID_PACKAGES` - 30/60/90 min defaults

**Worker E14 - src/app/(admin)/timed-rentals/page.tsx:**
- ① Base Rate section (rate + grace + hourly preview)
- ② Prepaid Packages section (add/remove/edit with savings)
- ③ Happy Hour section (toggle, discount%, time range, day picker)
- All fits on screen without scrolling
- Backward compatibility with legacy timedPricing fields

**Worker E15 - src/components/entertainment/EntertainmentSessionStart.tsx (NEW):**
- Happy hour badge when active
- Open play option with discounted rate
- Prepaid package grid with savings display
- Callbacks for session start

### New Dynamic Pricing Model

```
① BASE RATE
   $0.25/min = $15/hr
   Grace: 5 min

② PREPAID PACKAGES
   30 min = $10 (saves $2.50)
   60 min = $15 (saves $0.00)
   90 min = $20 (saves $2.50)

③ HAPPY HOUR
   50% off from 1:00 PM - 4:00 PM
   Days: Mon-Fri
   Happy Hour Rate: $0.125/min ($7.50/hr)
```

---

---

## Phase 3: UI Fixes + Tab Selection (February 5, 2026)

### Workers Completed

| Worker | Task | Status |
|--------|------|--------|
| E16 | Fix builder modal height (scrollable) | ✅ Complete |
| E17 | Session start with tab selection | ✅ Complete |

### Changes Applied

**Worker E16 - src/app/(admin)/timed-rentals/page.tsx:**
- Card: Added `max-h-[90vh] flex flex-col`
- CardContent: Added `overflow-y-auto flex-1`
- Moved action buttons to fixed footer with `border-t bg-white`
- Save/Cancel buttons now always visible

**Worker E17 - src/components/entertainment/EntertainmentSessionStart.tsx:**
- Added two-step flow: Tab Selection → Pricing
- New props: `currentOrderId`, `currentOrderName`, `openTabs`
- New callbacks: `onStartWithCurrentOrder`, `onStartWithNewTab`, `onStartWithExistingTab`
- "Open New Tab" with name input
- Existing tabs list (scrollable)
- "Change" button to go back to tab selection
- Auto-skips tab selection if `currentOrderId` exists

### Tab Selection Flow

```
No Open Tab:
┌─────────────────────────────────────────┐
│  🎱 Start Pool Table 1                   │
├─────────────────────────────────────────┤
│  Select or create a tab:                │
│                                          │
│  [+ OPEN NEW TAB]                       │
│                                          │
│  Or add to existing tab:                │
│  ┌────────────────────────────────┐     │
│  │ Mike's Party - $45.00          │     │
│  │ Table 5 - $23.50               │     │
│  └────────────────────────────────┘     │
└─────────────────────────────────────────┘

With Open Tab (auto-skips to pricing):
┌─────────────────────────────────────────┐
│  🎱 Start Pool Table 1                   │
├─────────────────────────────────────────┤
│  Adding to: Mike's Party                │
│                                          │
│  ⏱️  OPEN PLAY - $0.25/min              │
│  [30 min $10] [60 min $15] [90 min $20] │
└─────────────────────────────────────────┘
```

---

## Worker E18: Compact Builder UI (February 5, 2026)

### Changes Applied

**Worker E18 - src/app/(admin)/timed-rentals/page.tsx:**
- Visual type: 12-button grid → dropdown
- Name + Visual on same row
- Rate + Grace inline on same line
- Happy Hour: Full section with days/times → checkbox + price field only
- Prepaid packages: Compact single-line rows
- Height reduced from ~800px to ~350px

### New Compact Layout

```
Name: [Pool Table 1___]  Visual: [🎱 Pool Table ▼]

PRICING ─────────────────────────────────────────
Rate: [$0.25]/min ($15/hr)   Grace: [5] min
[✓] Happy Hour: [$0.15]/min ($9/hr)

PREPAID PACKAGES ─────────────────────── [+ Add]
[30] min = $[10] (saves $2.50)  [✕]
[60] min = $[15]                [✕]

Status: (•) Available  ( ) Maintenance
```

---

## Worker E19: Floor Plan Integration (February 5, 2026)

### Changes Applied

**Worker E19 - src/app/(pos)/orders/page.tsx:**
- Imported `EntertainmentSessionStart` component
- Added state for modal (`showEntertainmentStart`, `entertainmentItem`)
- Created `handleOpenTimedRental` callback
- Created helper functions:
  - `handleStartEntertainmentWithNewTab` - Creates order + adds item + starts timer
  - `handleStartEntertainmentWithExistingTab` - Adds to existing order
  - `handleStartEntertainmentWithCurrentOrder` - Uses current open order
- Passed `onOpenTimedRental` to `FloorPlanHome`
- Rendered modal with all callbacks wired

### User Flow

```
1. Tap entertainment element on floor plan
2. EntertainmentSessionStart modal opens
3. Select tab:
   - "Add to current" (if order open)
   - "Open New Tab" → Enter name
   - Select from existing tabs list
4. Select pricing:
   - Open Play ($X/min)
   - Prepaid package (30/60/90 min)
5. Session starts:
   - Order created (if new)
   - Item added
   - Timer started (if prepaid)
   - Floor plan updates to "in_use"
```

---

## How to Resume

1. **Start with:** `PM Mode: Entertainment`
2. **Review:** This changelog
3. **Next Steps:**
   - Test full flow: tap element → select tab → start session
   - Verify floor plan shows "in_use" status
   - Test prepaid vs open play timers
4. **Future:** Real-time charge display via socket

---

## All Entertainment Workers Complete ✅

| Phase | Workers | Status |
|-------|---------|--------|
| API Audit | E1-E4, E6-E8 | ✅ Complete |
| Per-Minute Pricing | E9-E11 | ✅ Complete |
| Dynamic Pricing | E12-E15 | ✅ Complete |
| UI Fixes + Tab Selection | E16-E17 | ✅ Complete |
| Compact Builder | E18 | ✅ Complete |
| Floor Plan Integration | E19 | ✅ Complete |

---

## Integration Dependencies

| Domain | Integration Point | Status |
|--------|-------------------|--------|
| **Floor Plan** | Entertainment elements on canvas | ✅ Complete |
| **Floor Plan** | Tap → Session Start modal | ✅ Complete |
| **Orders** | Entertainment items in orders | ✅ Complete |
| **Orders** | Create order from modal | ✅ Complete |
| **KDS** | Entertainment dashboard | Needs testing |
| **Menu** | Category routing to builder | ✅ Complete |
| **Payments** | Block time pricing in payments | Needs review |
| **Session Start** | EntertainmentSessionStart component | ✅ Complete |

---

## EOD Summary - February 5, 2026

### Session Accomplishments

**Phase 1: API Audit & Bug Fixes (Workers E1-E8)**
- Security: Added locationId verification to all Entertainment APIs
- Socket dispatch: Added real-time updates to all mutation endpoints
- FloorPlanElement sync: Floor plan now updates with MenuItem status
- Bug fixes: Fixed session controls missing locationId

**Phase 2: Per-Minute Pricing (Workers E9-E11)**
- New schema fields: ratePerMinute, minimumCharge, incrementMinutes
- New library: entertainment-pricing.ts with full calculation logic
- Builder UI: Compact layout with live pricing preview

**Phase 3: Dynamic Pricing (Workers E12-E15)**
- Prepaid packages: 30/60/90 min bundles with savings display
- Happy Hour: Simplified to checkbox + HH price (global settings for future)
- EntertainmentSessionStart: Tab selection → pricing modal

**Phase 4: Floor Plan Integration (Workers E16-E19)**
- Builder modal: Fixed height issues, scrollable with fixed footer
- Tab selection: Current order, new tab, existing tab options
- Compact redesign: Visual dropdown, inline pricing, checkbox happy hour
- Floor plan wiring: Tap element → modal → start session

### Files Modified

| Category | Files |
|----------|-------|
| **Schema** | `prisma/schema.prisma` (MenuItem pricing fields) |
| **Library** | `src/lib/entertainment-pricing.ts` (NEW) |
| **Builder** | `src/app/(admin)/timed-rentals/page.tsx` |
| **Component** | `src/components/entertainment/EntertainmentSessionStart.tsx` (NEW) |
| **Integration** | `src/app/(pos)/orders/page.tsx` |
| **API Fixes** | `/api/entertainment/status/route.ts` |
| **API Fixes** | `/api/entertainment/block-time/route.ts` |
| **API Fixes** | `/api/entertainment/waitlist/route.ts` |
| **API Fixes** | `/api/entertainment/waitlist/[id]/route.ts` |
| **Send Fix** | `/api/orders/[id]/send/route.ts` |
| **Controls** | `EntertainmentSessionControls.tsx` |

### Remaining Work (Future Sessions)

1. **KDS Dashboard Testing** - Verify entertainment KDS shows active sessions
2. **Waitlist Notifications** - SMS/push when turn comes up (Worker E5)
3. **Global Happy Hour Settings** - Admin page for location-wide happy hour
4. **Payment Integration** - Verify block time pricing in PaymentModal
5. **Real-time Charge Display** - Socket-based running total for open play

### How to Resume

```
PM Mode: Entertainment
```

Then:
1. Test full flow: tap element → select tab → start session
2. Verify floor plan shows "in_use" status
3. Test prepaid vs open play timers
4. Review KDS dashboard
