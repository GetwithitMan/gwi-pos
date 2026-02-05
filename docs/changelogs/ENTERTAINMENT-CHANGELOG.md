# Entertainment Domain - Change Log

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

## API Audit Summary

| API | locationId | Socket Dispatch | Soft Deletes | Issues |
|-----|------------|-----------------|--------------|--------|
| `/api/entertainment/status` GET | ✅ | N/A | ✅ | None |
| `/api/entertainment/status` PATCH | ❌ MISSING | ❌ MISSING | N/A | **CRITICAL** |
| `/api/entertainment/block-time` POST | ⚠️ Partial | ❌ MISSING | N/A | **HIGH** |
| `/api/entertainment/block-time` PATCH | ⚠️ Partial | ❌ MISSING | N/A | **HIGH** |
| `/api/entertainment/block-time` DELETE | ⚠️ Partial | ❌ MISSING | N/A | **HIGH** |
| `/api/entertainment/waitlist` GET | ✅ | N/A | ✅ | None |
| `/api/entertainment/waitlist` POST | ✅ | ❌ MISSING | N/A | Race condition |

---

## How to Resume

1. **Start with:** `PM Mode: Entertainment`
2. **Review:** This changelog
3. **Priority Order:**
   - Send Worker E1 (Status API audit)
   - Send Worker E2 (Block Time API audit)
   - Send Worker E3 (Waitlist API audit)
   - Send Worker E4 (Session flow testing)
4. **After workers complete:** Review and test

---

## Integration Dependencies

| Domain | Integration Point | Status |
|--------|-------------------|--------|
| **Floor Plan** | Entertainment elements on canvas | ✅ Complete |
| **Orders** | Entertainment items in orders | ✅ Complete |
| **KDS** | Entertainment dashboard | Needs testing |
| **Menu** | Category routing to builder | ✅ Complete |
| **Payments** | Block time pricing in payments | Needs review |
