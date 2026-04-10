# Entertainment Domain

**Domain ID:** 11
**Status:** Active Development
**Created:** February 5, 2026

## Overview

The Entertainment domain manages timed rental items like pool tables, dart boards, arcade machines, and other hourly-billed entertainment equipment. It handles:
- Item configuration (pricing, block times, visuals)
- Session management (start/extend/stop timers)
- Waitlist management
- Floor plan placement
- Real-time status tracking

## Domain Trigger

```
PM Mode: Entertainment
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTERTAINMENT DOMAIN                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   BUILDER   │    │   SESSION   │    │   WAITLIST  │        │
│  │  /timed-    │    │  /api/      │    │  /api/      │        │
│  │  rentals    │    │  entertainment│   │  entertainment│       │
│  │             │    │  /block-time │    │  /waitlist  │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                           │                                    │
│                    ┌──────┴──────┐                             │
│                    │  MenuItem   │                             │
│                    │ (itemType=  │                             │
│                    │ timed_rental)│                            │
│                    └──────┬──────┘                             │
│                           │                                    │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                  │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐           │
│  │ FloorPlan   │  │   Order     │  │Entertainment│           │
│  │  Element    │  │   Item      │  │  Waitlist   │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Structure

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| **Builder** | Item configuration UI | `/src/app/(admin)/timed-rentals/page.tsx` |
| **Status API** | Status management | `/api/entertainment/status` |
| **Block Time API** | Session timers | `/api/entertainment/block-time` |
| **Waitlist API** | Queue management | `/api/entertainment/waitlist`, `/api/entertainment/waitlist/[id]` |
| **KDS Dashboard** | Real-time monitoring | `/src/app/(kds)/entertainment/page.tsx` |
| **Floor Plan** | Element placement | `/api/floor-plan-elements` (elementType='entertainment') |
| **Components** | UI components | `/src/components/entertainment/`, `/src/components/floor-plan/entertainment-visuals.tsx` |
| **Utilities** | Helper functions | `/src/lib/entertainment.ts` |

---

## API Routes

### Entertainment Status
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/entertainment/status` | Get all entertainment items with status, sessions, waitlists |
| PATCH | `/api/entertainment/status` | Update item status, link to order, update session times |

### Block Time Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/entertainment/block-time` | Start a new block time session |
| PATCH | `/api/entertainment/block-time` | Extend existing block time |
| DELETE | `/api/entertainment/block-time` | Stop session early, reset to available |

### Waitlist Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/entertainment/waitlist` | List waitlist entries (filter by elementId, visualType, status) |
| POST | `/api/entertainment/waitlist` | Add customer to waitlist |
| GET | `/api/entertainment/waitlist/[id]` | Get specific waitlist entry |
| PATCH | `/api/entertainment/waitlist/[id]` | Update status (waiting→notified→seated→cancelled) |
| DELETE | `/api/entertainment/waitlist/[id]` | Soft delete from waitlist |

### Timed Sessions (Legacy)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/timed-sessions` | List timed sessions |
| POST | `/api/timed-sessions` | Create new session record |
| PUT | `/api/timed-sessions/[id]` | Update session (pause/resume/stop) |

---

## Components

### KDS/Display Components
| Component | File | Purpose |
|-----------|------|---------|
| EntertainmentItemCard | `/src/components/entertainment/EntertainmentItemCard.tsx` | Status card with timer, actions |
| WaitlistPanel | `/src/components/entertainment/WaitlistPanel.tsx` | Queue list with positions |
| AddToWaitlistModal | `/src/components/entertainment/AddToWaitlistModal.tsx` | Add customer to queue |
| SeatFromWaitlistModal | `/src/components/entertainment/SeatFromWaitlistModal.tsx` | Seat customer from queue |

### Floor Plan Components
| Component | File | Purpose |
|-----------|------|---------|
| EntertainmentVisual | `/src/components/floor-plan/entertainment-visuals.tsx` | 12 SVG visual types |
| AddEntertainmentPalette | `/src/components/floor-plan/AddEntertainmentPalette.tsx` | Place items on floor plan |
| ~~FloorPlanEntertainment~~ | ~~`/src/components/floor-plan/FloorPlanEntertainment.tsx`~~ | **Removed** (April 2026). FOH floor plan view now Android-only. |
| EntertainmentProperties | `/src/domains/floor-plan/admin/EntertainmentProperties.tsx` | Editor properties panel |

### Order Components
| Component | File | Purpose |
|-----------|------|---------|
| ~~EntertainmentSessionControls~~ | ~~`/src/components/orders/EntertainmentSessionControls.tsx`~~ | **Removed** (April 2026). Entertainment session controls now on Android register only. |

---

## Visual Types

12 SVG visual types available for entertainment items:

| Type | Label | Use Case |
|------|-------|----------|
| `pool_table` | Pool Table | Billiards |
| `dartboard` | Dartboard | Darts |
| `arcade` | Arcade | Arcade machines |
| `foosball` | Foosball | Foosball tables |
| `shuffleboard` | Shuffleboard | Shuffleboard tables |
| `ping_pong` | Ping Pong | Table tennis |
| `bowling_lane` | Bowling Lane | Bowling |
| `karaoke_stage` | Karaoke | Karaoke rooms |
| `dj_booth` | DJ Booth | DJ stations |
| `photo_booth` | Photo Booth | Photo booths |
| `vr_station` | VR Station | VR gaming |
| `game_table` | Game Table | Generic game tables |

---

## Database Models

### MenuItem Entertainment Fields
```prisma
model MenuItem {
  // Entertainment-specific fields
  itemType            String   @default("standard") // "timed_rental" for entertainment
  timedPricing        Json?    // { per15Min, per30Min, perHour, minimum }
  minimumMinutes      Int?     // Minimum rental duration
  graceMinutes        Int?     // Grace period
  entertainmentStatus String?  // "available", "in_use", "maintenance"
  currentOrderId      String?  // Active order
  currentOrderItemId  String?  // Active order item
  blockTimeMinutes    Int?     // Default block duration
  maxConcurrentUses   Int?     // For multi-unit items
  currentUseCount     Int?     // Current in-use count

  floorPlanElements   FloorPlanElement[]
}
```

### FloorPlanElement (Entertainment)
```prisma
model FloorPlanElement {
  elementType       String   // "entertainment"
  visualType        String   // pool_table, dartboard, etc.
  linkedMenuItemId  String?  // Link to menu item
  linkedMenuItem    MenuItem?

  status            String?  // "available", "in_use", "reserved", "maintenance"
  currentOrderId    String?
  sessionStartedAt  DateTime?
  sessionExpiresAt  DateTime?

  waitlistEntries   EntertainmentWaitlist[]
}
```

### EntertainmentWaitlist
```prisma
model EntertainmentWaitlist {
  id           String   @id @default(cuid())
  locationId   String
  elementId    String?  // Specific element
  visualType   String?  // OR any of this type

  customerName String
  partySize    Int      @default(1)
  phone        String?

  status       String   @default("waiting") // waiting, notified, seated, cancelled, expired
  position     Int

  requestedAt  DateTime @default(now())
  notifiedAt   DateTime?
  seatedAt     DateTime?
  expiresAt    DateTime?

  notes        String?
}
```

### OrderItem Entertainment Fields
```prisma
model OrderItem {
  blockTimeMinutes   Int?      // Purchased duration
  blockTimeStartedAt DateTime? // Timer start
  blockTimeExpiresAt DateTime? // Timer end
}
```

---

## Pricing Models

### Block Time Pricing
Fixed duration rentals sold in blocks:
- 30 minute blocks @ $X
- 60 minute blocks @ $Y
- 90 minute blocks @ $Z

Timer starts on "Send to Kitchen" or "Send to Tab". Extensions add increments.

### Per-Minute Billing
Continuous metering:
- Per 15 min rate
- Per 30 min rate
- Hourly rate
- Minimum minutes enforced

Grace period prevents charging for small overruns.

---

## Session Flow

```
1. Customer requests pool table
   │
2. Server adds to order (MenuItem with itemType='timed_rental')
   │
3. "Send to Kitchen" triggers session start
   │  └─ blockTimeStartedAt = now()
   │  └─ blockTimeExpiresAt = now() + blockTimeMinutes
   │  └─ entertainmentStatus = 'in_use'
   │
4. Timer runs on KDS and POS
   │  └─ Yellow warning at 5 min remaining
   │  └─ Red urgent at 2 min remaining
   │
5. Session ends (auto or manual stop)
   │  └─ entertainmentStatus = 'available'
   │  └─ currentOrderId = null
   │
6. Customer can extend (adds time to expiry)
```

---

## Waitlist Flow

```
1. All pool tables in use, customer wants one
   │
2. Server adds to waitlist via AddToWaitlistModal
   │  └─ customerName, partySize, phone
   │  └─ Optional: deposit, linked tab
   │
3. Customer gets position number
   │
4. When table available:
   │  └─ Staff notifies customer (status='notified')
   │  └─ Customer has X minutes to claim
   │
5. Customer seated:
   │  └─ SeatFromWaitlistModal
   │  └─ Starts new session
   │  └─ Refunds deposit if applicable
   │
6. Or: Customer cancels / expires
   │  └─ Next in queue moves up
```

---

## Integration Points

### Floor Plan Domain
- Entertainment items placed via AddEntertainmentPalette
- Rendered on FOH floor plan with status colors
- Properties editable in Floor Plan Editor

### Orders Domain
- Entertainment items added to orders like regular items
- Session starts on "Send to Kitchen"
- Timer controls in order panel

### KDS Domain
- Entertainment KDS dashboard at `/kds/entertainment`
- Real-time status with 3-second refresh
- Waitlist management

### Menu Domain
- Items created with `categoryType: 'entertainment'`
- Routes to `/timed-rentals` builder instead of generic ItemModal

---

## Pending Work

### High Priority
- [ ] Wire EntertainmentProperties panel into FloorPlanEditor
- [ ] Test full session flow (start → extend → stop)
- [ ] Waitlist notification system (SMS/push)

### Medium Priority
- [ ] Per-minute billing implementation
- [ ] Multi-unit support (multiple of same item type)
- [ ] Session history/reporting

### Low Priority
- [ ] Maintenance scheduling
- [ ] Peak pricing rules
- [ ] Reservation system for entertainment

---

## Related Skills

| Skill | Description |
|-------|-------------|
| 117 | Entertainment Floor Plan Integration |
| 123 | Menu Builder child modifiers |
| 207 | Entertainment KDS dashboard |

---

## Files Index

### Pages
- `/src/app/(admin)/timed-rentals/page.tsx` - Entertainment builder
- `/src/app/(kds)/entertainment/page.tsx` - KDS dashboard

### API Routes
- `/src/app/api/entertainment/status/route.ts`
- `/src/app/api/entertainment/block-time/route.ts`
- `/src/app/api/entertainment/waitlist/route.ts`
- `/src/app/api/entertainment/waitlist/[id]/route.ts`
- `/src/app/api/timed-sessions/route.ts`
- `/src/app/api/timed-sessions/[id]/route.ts`

### Components
- `/src/components/entertainment/EntertainmentItemCard.tsx`
- `/src/components/entertainment/WaitlistPanel.tsx`
- `/src/components/entertainment/AddToWaitlistModal.tsx`
- `/src/components/entertainment/SeatFromWaitlistModal.tsx`
- ~~`/src/components/orders/EntertainmentSessionControls.tsx`~~ (removed April 2026)
- `/src/components/floor-plan/entertainment-visuals.tsx`
- `/src/components/floor-plan/AddEntertainmentPalette.tsx`
- ~~`/src/components/floor-plan/FloorPlanEntertainment.tsx`~~ (removed April 2026)
- `/src/domains/floor-plan/admin/EntertainmentProperties.tsx`

### Library
- `/src/lib/entertainment.ts`
