# Feature: Entertainment

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Entertainment manages timed rental items like pool tables, dart boards, arcade machines, foosball, shuffleboard, ping pong, bowling lanes, karaoke rooms, DJ booths, photo booths, VR stations, and game tables. It supports block-time billing (fixed 30/60/90 minute sessions) and per-minute billing. Entertainment items are placed on the floor plan with live status colors, managed through a dedicated KDS dashboard, and integrated into the order system. A waitlist system handles queuing when all items are in use.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin builder, KDS dashboard, floor plan visuals | Full |
| `gwi-android-register` | TODO: entertainment order sheet not yet opened | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | Entertainment revenue in reports | Partial |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/timed-rentals` (entertainment builder) | Managers |
| Admin | `/settings/entertainment` | Managers |
| KDS | `/kds/entertainment` (entertainment KDS dashboard) | Managers, Staff |
| POS Web | Floor plan (entertainment items rendered with status) | All staff |
| POS Web | Order panel (EntertainmentSessionControls) | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(admin)/timed-rentals/page.tsx` | Entertainment item builder |
| `src/app/(kds)/entertainment/page.tsx` | Entertainment KDS dashboard |
| `src/app/(admin)/settings/entertainment/page.tsx` | Entertainment settings |
| `src/app/api/entertainment/status/route.ts` | GET/PATCH entertainment status |
| `src/app/api/entertainment/block-time/route.ts` | POST/PATCH/DELETE block time sessions |
| `src/app/api/entertainment/waitlist/route.ts` | GET/POST waitlist |
| `src/app/api/entertainment/waitlist/[id]/route.ts` | GET/PATCH/DELETE waitlist entry |
| `src/app/api/timed-sessions/route.ts` | GET/POST timed sessions (legacy) |
| `src/app/api/timed-sessions/[id]/route.ts` | PUT single session |
| `src/components/entertainment/EntertainmentItemCard.tsx` | Status card with timer and actions |
| `src/components/entertainment/WaitlistPanel.tsx` | Queue list with positions |
| `src/components/entertainment/AddToWaitlistModal.tsx` | Add customer to queue |
| `src/components/entertainment/SeatFromWaitlistModal.tsx` | Seat customer from queue |
| `src/components/orders/EntertainmentSessionControls.tsx` | Start/extend/stop timer in order panel |
| `src/components/floor-plan/entertainment-visuals.tsx` | 12 SVG visual types |
| `src/components/floor-plan/AddEntertainmentPalette.tsx` | Place items on floor plan |
| `src/components/floor-plan/FloorPlanEntertainment.tsx` | Render on FOH floor plan |
| `src/domains/floor-plan/admin/EntertainmentProperties.tsx` | Editor properties panel |
| `src/lib/entertainment.ts` | Entertainment helper functions |
| `src/lib/socket-dispatch.ts` | `dispatchEntertainmentSessionUpdate()`, `dispatchEntertainmentStatusChanged()` |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/entertainment/status` | Employee PIN | All items with status, sessions, waitlists |
| `PATCH` | `/api/entertainment/status` | Employee PIN | Update status, link order, update session |
| `POST` | `/api/entertainment/block-time` | Employee PIN | Start block time session |
| `PATCH` | `/api/entertainment/block-time` | Employee PIN | Extend block time |
| `DELETE` | `/api/entertainment/block-time` | Employee PIN | Stop session early |
| `GET` | `/api/entertainment/waitlist` | Employee PIN | List waitlist entries |
| `POST` | `/api/entertainment/waitlist` | Employee PIN | Add to waitlist |
| `GET` | `/api/entertainment/waitlist/[id]` | Employee PIN | Get waitlist entry |
| `PATCH` | `/api/entertainment/waitlist/[id]` | Employee PIN | Update status (waiting→notified→seated) |
| `DELETE` | `/api/entertainment/waitlist/[id]` | Employee PIN | Remove from waitlist |
| `GET` | `/api/timed-sessions` | Employee PIN | List timed sessions |
| `POST` | `/api/timed-sessions` | Employee PIN | Create session |
| `PUT` | `/api/timed-sessions/[id]` | Employee PIN | Update session (pause/resume/stop) |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `entertainment:session-update` | `{ itemId, status, startedAt, expiresAt, addedMinutes?, partyName? }` | Session start, extend, stop |
| `entertainment:status-changed` | `{ itemId, entertainmentStatus, currentOrderId, expiresAt }` | Item status change (available→in_use, etc.) |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| None — entertainment status is server-driven | | |

### Socket Consumers
- `FloorPlanHome.tsx` — listens to both `entertainment:session-update` and `table:status-changed`
- `entertainment/page.tsx` (KDS) — listens to `entertainment:status-changed` with 30s fallback poll
- `timed-rentals/page.tsx` (builder) — listens to `entertainment:session-update`
- `useOrderSockets.ts` — listens to `entertainment:status-changed`
- `useMenuData.ts` — listens to `entertainment:status-changed`

---

## Data Model

```
MenuItem (entertainment-specific fields) {
  itemType          "timed_rental"
  timedPricing      Json { per15Min, per30Min, perHour, minimum }
  minimumMinutes    Int
  graceMinutes      Int
  entertainmentStatus  "available" | "in_use" | "maintenance"
  currentOrderId    String?
  currentOrderItemId String?
  blockTimeMinutes  Int (default block duration)
  maxConcurrentUses Int?
  currentUseCount   Int?
}

FloorPlanElement (entertainment) {
  elementType       "entertainment"
  visualType        pool_table | dartboard | arcade | foosball |
                    shuffleboard | ping_pong | bowling_lane |
                    karaoke_stage | dj_booth | photo_booth |
                    vr_station | game_table
  linkedMenuItemId  String (link to MenuItem)
  status            "available" | "in_use" | "reserved" | "maintenance"
  currentOrderId, sessionStartedAt, sessionExpiresAt
}

OrderItem (entertainment fields) {
  blockTimeMinutes    Int (purchased duration)
  blockTimeStartedAt  DateTime (timer start)
  blockTimeExpiresAt  DateTime (timer end)
}

EntertainmentWaitlist {
  id, locationId, elementId?, visualType?
  tableId?, customerName?, partySize, phone?
  status  "waiting" | "notified" | "seated" | "cancelled" | "expired"
  position Int
  requestedAt, notifiedAt, seatedAt, expiresAt
  notes
}

TimedSession {
  id, locationId, menuItemId, tableId?, orderId?
  startedAt, endedAt, pausedAt, pausedMinutes
  billingType, ratePerMinuteCents, totalChargedCents
  status "active" | "paused" | "completed" | "cancelled"
}
```

---

## Business Logic

### Session Flow (Block Time)
1. Customer requests entertainment item (e.g., pool table)
2. Server adds `MenuItem` (itemType=timed_rental) to order
3. "Send to Kitchen" triggers session start:
   - `blockTimeStartedAt = now()`
   - `blockTimeExpiresAt = now() + blockTimeMinutes`
   - `entertainmentStatus = 'in_use'`
   - Socket emits `entertainment:session-update` + `entertainment:status-changed`
4. Timer displayed on KDS dashboard and POS:
   - Yellow warning at 5 min remaining
   - Red urgent at 2 min remaining
5. Customer can extend (adds time to expiry)
6. Session ends (auto-expire or manual stop):
   - `entertainmentStatus = 'available'`
   - `currentOrderId = null`

### Waitlist Flow
1. All items of a type in use → customer wants one
2. Staff adds to waitlist via AddToWaitlistModal (name, party size, phone)
3. Customer gets position number
4. When item becomes available:
   - Staff notifies customer (`status='notified'`)
   - Customer has configurable time to claim
5. Customer seated → SeatFromWaitlistModal starts new session
6. Or: customer cancels/expires → next in queue moves up

### Pricing Models
- **Block time**: Fixed 30/60/90 minute blocks at set prices
- **Per-minute**: Continuous metering with per-15/per-30/hourly rates + minimum + grace period

### Edge Cases & Business Rules
- Timer auto-starts on "Send to Kitchen" — not on order creation
- Grace period prevents charging for small overruns (per-minute billing)
- Entertainment KDS at `/kds/entertainment` uses 30s fallback poll + socket events
- Multi-unit support planned but not yet implemented (`maxConcurrentUses`)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Entertainment items added to orders; session charges on payment |
| Floor Plan | Entertainment items displayed with status colors |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | "Send to Kitchen" starts session timer |
| Menu | Entertainment items created with `categoryType: 'entertainment'` |
| Floor Plan | Items placed on floor plan via editor |
| KDS | Entertainment KDS dashboard monitors sessions |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — session start tied to send-to-kitchen flow
- [ ] **Floor Plan** — visual types and status colors render correctly
- [ ] **Menu** — `categoryType: 'entertainment'` routing works
- [ ] **Socket** — both `entertainment:session-update` and `entertainment:status-changed` events
- [ ] **KDS** — entertainment dashboard still renders

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View entertainment status | Standard | Standard |
| Start/stop sessions | Standard | Standard |
| Manage waitlist | Standard | Standard |
| Configure entertainment items | `MENU_MANAGE` | High |
| Place on floor plan | `FLOOR_PLAN_EDIT` | High |

---

## Known Constraints & Limits
- 12 SVG visual types (pool_table, dartboard, arcade, foosball, shuffleboard, ping_pong, bowling_lane, karaoke_stage, dj_booth, photo_booth, vr_station, game_table)
- Per-minute billing: implementation pending
- Multi-unit concurrent use: planned but not yet implemented
- Waitlist SMS notification: planned but not yet implemented
- Entertainment KDS uses 30s fallback polling + socket events

---

## Android-Specific Notes
- Entertainment order sheet: **TODO** — not yet opened on Android
- Android can view entertainment items on floor plan
- Session management via Android is not yet fully wired

---

## Related Docs
- **Domain doc:** `docs/domains/ENTERTAINMENT-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 117 (Entertainment Floor Plan Integration), Skill 123 (Menu Builder Child Modifiers), Skill 207 (Entertainment KDS Dashboard)
- **Changelog:** `docs/changelogs/ENTERTAINMENT-CHANGELOG.md`

---

*Last updated: 2026-03-03*
