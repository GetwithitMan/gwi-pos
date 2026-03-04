# Feature: Coursing

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Coursing → read every listed dependency doc.

## Summary
Coursing lets servers organize a dining order into sequential named courses — Appetizers, Soup/Salad, Entrees, Dessert, After-Dinner — and control exactly when each course is sent to the kitchen. Without coursing, all items fire to the kitchen together when the order is sent. With coursing enabled, items are grouped by course number and each course is fired independently, either manually by the server/manager or automatically after a configurable delay. This gives the kitchen accurate timing information, prevents food from sitting under heat lamps while earlier courses are still being eaten, and improves the guest experience by pacing the meal properly.

## Status
`Active` (Built)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, course configuration, order state | Full |
| `gwi-android-register` | Order entry — item course assignment, fire-course actions | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Order panel — course mode toggle on order | Servers, Managers |
| POS Web | Order panel — per-item course badge/assignment | Servers, Managers |
| POS Web | Order panel — "Fire Course" button per course | Servers, Managers |
| POS Web | KDS — course indicator on tickets, bump button per course | Kitchen staff |
| Android | `OrderScreen` — item course assignment during order entry | Servers |
| Admin | `/settings/hardware/kds` — course display settings | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/orders/[id]/courses/route.ts` | GET course status; POST fire/hold/release/mark-ready/mark-served/set-mode/set-current actions |
| `src/app/api/orders/[id]/fire-course/route.ts` | POST — dedicated fire route: resolves routing, dispatches to KDS, deducts prep stock |
| `src/app/api/orders/[id]/advance-course/route.ts` | POST — mark current course served + fire next course in one atomic step |
| `src/lib/order-events/emitter.ts` | `emitOrderEvents()` — batch event emission for course actions |
| `src/lib/socket-dispatch.ts` | `dispatchOrderUpdated()`, `dispatchNewOrder()` — real-time push to KDS and terminals |
| `src/lib/order-router.ts` | `OrderRouter.resolveRouting()` — routes fired course items to correct KDS stations |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/orders/[id]/courses` | Employee PIN | Get course status for all courses on an order, grouped by course number with item counts and statuses |
| `POST` | `/api/orders/[id]/courses` | Employee PIN | Multi-action endpoint: `fire`, `fire_all`, `hold`, `release`, `mark_ready`, `mark_served`, `set_mode`, `set_current` |
| `POST` | `/api/orders/[id]/fire-course` | Employee PIN | Fire a specific course number to kitchen — resolves station routing, dispatches KDS events, deducts prep stock, handles timed rental items |
| `POST` | `/api/orders/[id]/advance-course` | Employee PIN | Mark current course as served and fire the next course in one step; returns `hasMoreCourses` flag |

### POST /courses — action reference
| Action | Effect |
|--------|--------|
| `fire` | Mark pending (non-held) items in course as `fired`, set `firedAt` |
| `fire_all` | Mark all pending items in course as `fired`, including held items |
| `hold` | Mark all pending items in course as held (`isHeld: true`) |
| `release` | Release hold on all held items in course |
| `mark_ready` | Transition fired items to `ready` (kitchen plated) |
| `mark_served` | Transition fired/ready items to `served` (delivered to table) |
| `set_mode` | Set order `courseMode` to `off`, `manual`, or `auto` |
| `set_current` | Manually set `currentCourse` to a specific course number |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `order:event` | `{ eventId, orderId, type: 'ITEM_UPDATED', payload: { lineItemId, courseStatus, kitchenStatus } }` | Every course item status change |
| `order:event` | `{ type: 'ORDER_METADATA_UPDATED', payload: { currentCourse, courseMode } }` | Course mode or current course changes |
| `kds:order-received` | Full routing manifest | `/fire-course` — items sent to kitchen |
| `order:updated` | `{ orderId, changes: ['course-fired', 'course-N'] }` | After any course fire action |

---

## Data Model

### OrderCourseMode enum
```
enum OrderCourseMode {
  off      // All items fire together with the order send
  manual   // Server fires each course explicitly
  auto     // Auto-fire based on autoFireDelay on CourseConfig
}
```

### CourseConfig (per-location course definitions)
```
CourseConfig {
  id             String
  locationId     String      // always filter by this
  courseNumber   Int         // 1, 2, 3, 4, 5
  name           String      // "Appetizers", "Soup/Salad", "Entrees", "Dessert", "After-Dinner"
  displayName    String?     // Optional custom override
  color          String?     // Badge color hex (e.g. "#3B82F6")
  autoFireDelay  Int?        // Minutes after previous course to auto-fire (null = manual only)
  sortOrder      Int
  isActive       Boolean
  deletedAt      DateTime?   // soft delete
}
```

### Default course names (built-in, no CourseConfig required)
| courseNumber | Name | Color |
|---|---|---|
| 0 | ASAP | Red (#EF4444) |
| 1 | Appetizers | Blue (#3B82F6) |
| 2 | Soup/Salad | Green (#10B981) |
| 3 | Entrees | Amber (#F59E0B) |
| 4 | Dessert | Pink (#EC4899) |
| 5 | After-Dinner | Purple (#8B5CF6) |

### Order fields (coursing-related)
```
Order {
  currentCourse  Int             @default(1)   // Currently active course number
  courseMode     OrderCourseMode @default(off)  // off | manual | auto
}
```

### OrderItem fields (coursing-related)
```
OrderItem {
  courseNumber   Int?            // Assigned course; null treated as course 1 at fire time
  courseStatus   String          // pending | fired | ready | served
  isHeld         Boolean         // True = held back from auto-fire
  firedAt        DateTime?       // When this item was fired to kitchen
  kitchenStatus  String          // sent | ready | delivered (mirrors courseStatus for KDS)
}
```

---

## Business Logic

### Primary Flow — Manual Course Mode
1. Server creates order and adds items
2. Server (or system) sets `courseMode` to `manual` via `POST /courses { action: 'set_mode', courseMode: 'manual' }`
3. During order entry, each item is assigned to a `courseNumber` (1–5); unassigned items default to course 1 at fire time
4. Server taps "Fire Course 1" → `POST /fire-course { courseNumber: 1 }`:
   - All non-held items with `courseNumber: 1` (and null courseNumber) are updated: `kitchenStatus: sent`, `courseStatus: fired`, `firedAt: now`
   - `OrderRouter.resolveRouting()` determines which KDS stations receive the items
   - `dispatchNewOrder()` pushes ticket manifests to the correct KDS screens via socket
   - `dispatchOrderUpdated()` notifies all POS terminals of the course change
   - `emitOrderEvents()` records `ITEM_UPDATED` + `ORDER_SENT` events in the event log
   - Prep stock is deducted (fire-and-forget)
5. KDS shows course 1 items; kitchen prepares them
6. When course 1 is plated, kitchen bumps or server marks ready: `POST /courses { action: 'mark_ready', courseNumber: 1 }`
7. Server fires course 2: `POST /fire-course { courseNumber: 2 }` (validates course 1 items are fired first; rejects unless `force: true` is passed)
8. Alternatively, server taps "Advance Course": `POST /advance-course` — marks current course served + fires next course atomically
9. Repeat until all courses served; `advance-course` returns `hasMoreCourses: false` when complete

### Auto Course Mode
- `CourseConfig.autoFireDelay` defines minutes after previous course fires before the next auto-fires
- Scheduler/timer logic (client-side or background job) calls `/fire-course` when delay elapses
- Auto mode still allows manual override via `/fire-course` or `/advance-course` at any time

### Course Mode: Off
- All items fire together when `POST /api/orders/[id]/send` is called
- `courseNumber` assignments are ignored for routing purposes
- Default mode for all orders; suitable for bars, quick service, takeout

### KDS Course Visibility
- KDS screens receive items via `kds:order-received` when a course is fired
- KDS shows only items that have been fired (`kitchenStatus: sent` or later)
- Future-course items (pending, not yet fired) do not appear on KDS until their course is fired
- This prevents kitchen confusion about items that won't be needed for 20+ minutes

### Edge Cases & Business Rules
- **Unassigned items default to course 1:** At fire time, items with `courseNumber: null` are treated as course 1. The client also applies `item.courseNumber ?? 1` for display.
- **Out-of-order fire guard:** `/fire-course` checks for unfired items in prior courses before firing. Returns `requiresForce: true` if prior course has pending items. Pass `force: true` in body to override.
- **Held items:** Items marked `isHeld: true` are skipped by `fire` action but included by `fire_all`. Use `hold` to defer specific course items and `release` to un-hold them.
- **Item added mid-course:** If an item is added to an already-fired course, its `courseStatus` starts as `pending`. Server must manually fire or recall the course to send it.
- **Course recalled / re-fired:** No explicit recall API. To re-fire items in a served course, change `courseStatus` back via item update, then re-fire.
- **Closed/voided/paid orders:** `/fire-course` rejects with 400 if order status is `paid`, `closed`, `voided`, or `cancelled`.
- **Timed rental items:** `/fire-course` handles timed rental items specially — sets `blockTimeStartedAt`, `blockTimeExpiresAt`, updates `MenuItem.entertainmentStatus`, and dispatches `entertainment:update` socket event.
- **Order not complete until all courses bumped:** The order remains open (`status: open`) until payment is taken, regardless of course progress.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Sets `currentCourse` and `courseMode` on Order; updates `courseStatus`/`kitchenStatus` on OrderItems |
| KDS | Fires course items to kitchen via routing engine; KDS only shows fired-course items |
| Entertainment | Timed rental items in a course start their session timer when the course fires |
| Inventory | Prep stock deducted when course fires (same as regular send) |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Order must exist and be in a valid status (`open`) for course actions to work |
| Menu | Item `courseNumber` field set during order entry based on menu item defaults or server selection |
| Floor Plan | Table-based orders are the primary use case for coursing |
| Settings | `CourseConfig` is per-location — course names, colors, and auto-fire delays are configurable |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does the change affect `ORDER_SENT` event emission or order status guards?
- [ ] **KDS** — does the change affect which items appear on KDS screens?
- [ ] **Event Sourcing** — every item status change must emit `ITEM_UPDATED` via `emitOrderEvents()`
- [ ] **Entertainment** — does the change affect timed rental session start logic in `/fire-course`?
- [ ] **Offline** — course fire actions must be resilient (fire-and-forget socket, prep stock deduction)
- [ ] **Socket** — `dispatchNewOrder()` and `dispatchOrderUpdated()` must both fire on course actions

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View course status | `pos.access` | Standard |
| Set course mode | `pos.access` | Standard |
| Fire a course | `pos.access` | Standard |
| Advance course | `pos.access` | Standard |
| Hold / release items | `pos.access` | Standard |
| Force-fire out of order | `pos.access` + `force: true` | Standard (server override) |

---

## Known Constraints & Limits
- **Maximum 5 named courses** (courseNumbers 1–5) plus courseNumber 0 ("ASAP")
- **One CourseConfig per courseNumber per location** (`@@unique([locationId, courseNumber])`)
- **`auto` mode timer** is not enforced server-side in a background job — client must drive the auto-fire call at the right time
- **Course status is per-item** — a course is considered "fired" when `firedCount > 0`, "ready" when all items are ready, "served" when all items are served
- **Course 1 null coalescing:** Items with `null` courseNumber fire with course 1 by the `/fire-course` route (`courseNumber === 1 ? { in: [1, null] } : courseNumber`)
- **No course-level event type:** Coursing uses `ITEM_UPDATED` and `ORDER_METADATA_UPDATED` events — there is no dedicated `COURSE_FIRED` event type in the 17-event schema

---

## Android-Specific Notes
- Android assigns `courseNumber` to items during order entry (e.g., via course picker in item detail sheet)
- `OrderViewModel` tracks `courseMode` and `currentCourse` from the order snapshot
- Android can call `/fire-course` and `/advance-course` directly
- Course badge colors match the default color palette defined in `/courses` route

---

## Related Docs
- **Orders feature:** `docs/features/orders.md`
- **KDS feature:** `docs/features/kds.md`
- **Order lifecycle guide:** `docs/guides/ORDER-LIFECYCLE.md`
- **Schema:** `prisma/schema.prisma` — `CourseConfig` model, `OrderCourseMode` enum (line ~1249)

---

*Last updated: 2026-03-03*
