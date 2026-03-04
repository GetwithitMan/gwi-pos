# Feature: Events & Tickets

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Event ticketing system with support for multiple ticketing modes (per-seat, per-table, general admission, hybrid), pricing tiers, hold/purchase/check-in workflows, reservation conflict detection, and refund handling. Ticket check-in is idempotent (duplicate scan = no double-entry). Tickets link to POS orders and payments.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API (22 route files), admin UI (event management, ticket sales, check-in) | Full |
| `gwi-android-register` | Ticket scanning (planned) | Planned |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud sync of event data | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/events` (list, create, manage) | Managers |
| Admin | `/events/[id]/sell` (interactive seat map, ticket sales) | Managers |
| Admin | `/events/[id]/check-in` (barcode scanner, check-in stats) | All staff |
| Admin | `/settings/events` (duplicate routing) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/events/route.ts` | GET list, POST create |
| `src/app/api/events/[id]/route.ts` | GET/PUT/DELETE event |
| `src/app/api/events/[id]/publish/route.ts` | Publish event (set on_sale) |
| `src/app/api/events/[id]/tickets/route.ts` | GET list tickets for event |
| `src/app/api/events/[id]/tickets/hold/route.ts` | POST hold tickets |
| `src/app/api/events/[id]/tickets/purchase/route.ts` | POST complete purchase |
| `src/app/api/events/[id]/tickets/release/route.ts` | POST/DELETE release holds |
| `src/app/api/events/[id]/availability/route.ts` | GET seat/table availability |
| `src/app/api/events/[id]/conflicts/route.ts` | GET reservation conflicts |
| `src/app/api/events/[id]/resolve-conflicts/route.ts` | POST resolve conflicts |
| `src/app/api/events/[id]/tiers/route.ts` | GET/POST pricing tiers |
| `src/app/api/events/[id]/tiers/[tierId]/route.ts` | GET/PUT/DELETE single tier |
| `src/app/api/events/[id]/tables/route.ts` | GET/POST table configs (bulk) |
| `src/app/api/events/[id]/tables/[tableId]/route.ts` | GET/PUT/DELETE single table config |
| `src/app/api/tickets/route.ts` | GET list/search all tickets |
| `src/app/api/tickets/[id]/route.ts` | GET/PUT/DELETE single ticket |
| `src/app/api/tickets/[id]/check-in/route.ts` | POST check-in (idempotent), DELETE undo |
| `src/app/api/tickets/[id]/refund/route.ts` | POST refund ticket |
| `src/app/(admin)/events/page.tsx` | Events list page |
| `src/app/(admin)/events/[id]/sell/page.tsx` | Ticket sales with seat map |
| `src/app/(admin)/events/[id]/check-in/page.tsx` | Check-in scanner page |

---

## API Endpoints

### Events

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/events` | Employee PIN | List events. Filters: `status`, `date` (exact), `upcoming=true` (eventDate >= now). Includes `pricingTiers` (active, sorted) and `soldCount`/`availableCount`. |
| `POST` | `/api/events` | Employee PIN | Create event. Always starts as `draft`. Checks for conflicting reservations on the same date/time — returns `hasConflicts` and `conflicts` array. Can create inline `pricingTiers`. |
| `GET` | `/api/events/[id]` | Employee PIN | Full event detail. Includes `pricingTiers`, `tableConfigurations`, and `ticketCounts` broken down by status (available/held/sold/checkedIn/cancelled/refunded). |
| `PUT` | `/api/events/[id]` | Employee PIN | Update event. After tickets sold, only `description`, `imageUrl`, `endTime`, `settings`, `reservedCapacity` are modifiable. |
| `DELETE` | `/api/events/[id]` | Employee PIN | Cancel event (sets status=cancelled, isActive=false). `?hard=true` soft-deletes event + all related records. Blocked if sold tickets exist. |
| `POST` | `/api/events/[id]/publish` | Employee PIN | Set on_sale. Guards: `reservationConflictsHandled=true`, at least one pricing tier, `totalCapacity>0`, not already on_sale/cancelled/completed. |
| `GET` | `/api/events/[id]/tickets` | Employee PIN | List tickets for event with filters. |
| `POST` | `/api/events/[id]/tickets/hold` | Employee PIN | Hold tickets (default 10-min). Creates ticket records with status=held, heldUntil set. |
| `POST` | `/api/events/[id]/tickets/purchase` | Employee PIN | Complete purchase. Transitions held tickets to sold, snapshots price, links to orderId/paymentId. |
| `POST` | `/api/events/[id]/tickets/release` | Employee PIN | Release specific held tickets. |
| `DELETE` | `/api/events/[id]/tickets/release` | Employee PIN | Cleanup expired holds (`?expiredOnly=true`). |
| `GET` | `/api/events/[id]/availability` | Employee PIN | Seat/table availability map for the event. |
| `GET` | `/api/events/[id]/conflicts` | Employee PIN | Detect overlapping reservations on the event date/time. |
| `POST` | `/api/events/[id]/resolve-conflicts` | Employee PIN | Mark conflicts as resolved (cancel or ignore reservations). Sets `reservationConflictsHandled=true`. |

### Pricing Tiers

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/events/[id]/tiers` | Employee PIN | List pricing tiers with `soldCount`, `remaining`. |
| `POST` | `/api/events/[id]/tiers` | Employee PIN | Create pricing tier. Fields: name, price, serviceFee, quantityAvailable (null=unlimited), maxPerOrder, sectionIds, sortOrder, color, description. |
| `GET` | `/api/events/[id]/tiers/[tierId]` | Employee PIN | Get single tier with full ticket breakdown by status. |
| `PUT` | `/api/events/[id]/tiers/[tierId]` | Employee PIN | Update tier. Cannot change `price` after tickets sold. Cannot reduce `quantityAvailable` below `quantitySold`. |
| `DELETE` | `/api/events/[id]/tiers/[tierId]` | Employee PIN | Deactivate tier (sets `isActive=false`). `?hard=true` soft-deletes tier + unsold tickets. Blocked if sold/checked_in tickets exist. |

### Table Configurations

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/events/[id]/tables` | Employee PIN | List all location tables with their event-specific configurations and ticket counts. Returns `availability` (available/partial/sold_out) per table. |
| `POST` | `/api/events/[id]/tables` | Employee PIN | Bulk upsert table configurations for event. Body: `{ tables: [{ tableId, isIncluded, bookingMode, pricingTierId, minPartySize, maxPartySize }] }`. |
| `GET` | `/api/events/[id]/tables/[tableId]` | Employee PIN | Get table config + seat-level availability. Each seat has status (available/held/sold), ticketId, customerName, heldUntil. Expired holds shown as available. |
| `PUT` | `/api/events/[id]/tables/[tableId]` | Employee PIN | Upsert single table config. Cannot exclude table if it has sold/checked_in tickets. |
| `DELETE` | `/api/events/[id]/tables/[tableId]` | Employee PIN | Remove table config (reset to defaults). Blocked if sold/checked_in tickets exist. |

### Tickets (Global)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/tickets` | Employee PIN | Global ticket search across location. Filters: `eventId`, `status`, `customerId`, `search` (ticketNumber/barcode/customerName/email/phone). Pagination: `limit` (default 50), `offset`. |
| `GET` | `/api/tickets/[id]` | Employee PIN | Get ticket by ID, ticketNumber, or barcode (OR lookup). Full detail including event, seat, table (with section), pricingTier, customer. |
| `PUT` | `/api/tickets/[id]` | Employee PIN | Update customer info (customerName, customerEmail, customerPhone, customerId). Only allowed on sold or checked_in tickets. |
| `DELETE` | `/api/tickets/[id]` | Employee PIN | Cancel ticket. Sets status=cancelled, records cancelReason. Decrements tier `quantitySold` if ticket was sold/checked_in. |
| `POST` | `/api/tickets/[id]/check-in` | Employee PIN | Check in ticket. Validates event date = today. Returns check-in stats (checked-in count, remaining, percentage). Supports barcode/ticketNumber lookup. |
| `DELETE` | `/api/tickets/[id]/check-in` | Employee PIN | Undo check-in. Reverts status to sold, clears checkedInAt/checkedInBy. |
| `POST` | `/api/tickets/[id]/refund` | Employee PIN | Refund ticket. Supports partial refund via `refundAmount`. Decrements tier `quantitySold` if was sold/checked_in. |

---

## Socket Events

None — event operations do not emit socket events currently.

---

## Data Model

```
Event {
  id                          String    @id
  locationId                  String
  name                        String
  description                 String?
  imageUrl                    String?
  eventType                   String    // dinner_show | concert | private_event | special_occasion
  eventDate                   DateTime
  doorsOpen                   String    // HH:MM
  startTime                   String    // HH:MM
  endTime                     String?   // HH:MM
  ticketingMode               String    // per_seat | per_table | general_admission | hybrid
  allowOnlineSales            Boolean   @default(true)
  allowPOSSales               Boolean   @default(true)
  maxTicketsPerOrder          Int?
  totalCapacity               Int
  reservedCapacity            Int       @default(0)   // Held for walk-ins/VIPs
  salesStartAt                DateTime?
  salesEndAt                  DateTime?
  status                      EventStatus  // draft | on_sale | sold_out | cancelled | completed
  isActive                    Boolean   @default(true)
  settings                    Json?     // Flexible JSON config
  reservationConflictsHandled Boolean   @default(false)
  reservationConflictNotes    String?
  createdAt                   DateTime
  updatedAt                   DateTime
  deletedAt                   DateTime?
  syncedAt                    DateTime?
  createdBy                   String?   // Employee ID who created
}

EventPricingTier {
  id                String    @id
  locationId        String
  eventId           String
  name              String    // "General Admission", "VIP", "Premium Front Row"
  description       String?
  color             String?   // For floor plan seat coloring
  price             Decimal
  serviceFee        Decimal   @default(0)
  quantityAvailable Int?      // null = unlimited
  quantitySold      Int       @default(0)
  maxPerOrder       Int?      // Limit per transaction
  sectionIds        Json?     // JSON array of section IDs this tier applies to
  sortOrder         Int       @default(0)
  isActive          Boolean   @default(true)
  deletedAt         DateTime?
  syncedAt          DateTime?
}

EventTableConfig {
  id            String    @id
  locationId    String
  eventId       String
  tableId       String
  isIncluded    Boolean   @default(true)   // Include table in this event
  bookingMode   String    @default("inherit")  // inherit | per_seat | per_table | disabled
  pricingTierId String?
  minPartySize  Int?
  maxPartySize  Int?      // null = use table capacity
  deletedAt     DateTime?
  syncedAt      DateTime?
  // @@unique([eventId, tableId])
}

Ticket {
  id              String    @id
  locationId      String
  eventId         String
  pricingTierId   String
  tableId         String?   // null for General Admission
  seatId          String?   // null for General Admission and per_table
  ticketNumber    String    @unique   // EVT-YYYYMMDD-00001
  barcode         String    @unique   // 8-byte random hex, for scanning
  customerName    String?
  customerEmail   String?
  customerPhone   String?
  customerId      String?   // Link to Customer record
  basePrice       Decimal   // Price snapshot at purchase
  serviceFee      Decimal   @default(0)
  taxAmount       Decimal   @default(0)
  totalPrice      Decimal
  status          TicketStatus  // available | held | sold | checked_in | cancelled | refunded
  heldAt          DateTime?
  heldUntil       DateTime?
  heldBySessionId String?   // Browser or POS session that placed the hold
  purchasedAt     DateTime?
  purchaseChannel String?   // pos | online | phone | comp
  orderId         String?   // Link to POS Order (for F&B)
  paymentId       String?   // Payment reference
  checkedInAt     DateTime?
  checkedInBy     String?   // Employee ID
  cancelledAt     DateTime?
  cancelReason    String?
  refundedAt      DateTime?
  refundAmount    Decimal?  // null = full refund (totalPrice)
  refundedBy      String?   // Employee ID
  notes           String?
  deletedAt       DateTime?
  syncedAt        DateTime?
}
```

---

## Business Logic

### Event Status Flow
```
draft → on_sale → sold_out | cancelled → completed
```

### Ticket Status Flow
```
available → held → sold → checked_in
                        ↘ refunded (from sold or checked_in)
```

### Check-In (Idempotent)
1. Lookup by ID, ticketNumber, or barcode (OR query)
2. Validate event date = today (not past/future)
3. If already checked in → return success with existing data (no error)
4. If status = `sold` → update to `checked_in`, record employee + timestamp
5. Return check-in stats: checked-in count, remaining, percentage

### Hold Flow
1. `POST /hold` → creates ticket records with status `held`, `heldUntil` set
2. Default hold duration: 10 minutes (configurable)
3. Expired holds treated as `available` in availability queries
4. `POST /release` → explicitly release held tickets
5. `DELETE /release?expiredOnly=true` → cleanup expired holds

### Refund Flow
1. Validate ticket status (must be sold, checked_in, or cancelled)
2. Cannot refund already-refunded tickets
3. Optional `refundAmount` (defaults to totalPrice — supports partial refunds)
4. Transaction: update ticket → decrement tier `quantitySold`

### Publication Guard
Must satisfy ALL before publishing:
- `reservationConflictsHandled = true`
- At least one pricing tier exists
- `totalCapacity > 0`
- Event not already on_sale, cancelled, or completed

### Ticket Purchase Flow (Full)
1. Staff opens `/events/[id]/sell` — seat map loads via `GET /api/events/[id]/tables`
2. Staff selects seats/table — `POST /api/events/[id]/tickets/hold` creates held tickets
3. Hold window: 10 minutes (configurable) — `heldUntil` field set; expired holds treated as available
4. Staff collects payment (via POS order or direct)
5. `POST /api/events/[id]/tickets/purchase` transitions held → sold, snapshots price, links `orderId`/`paymentId`
6. If payment fails or customer changes mind: `POST /api/events/[id]/tickets/release` releases holds
7. Ticket printed or digital confirmation sent

### Check-In Flow
1. Staff opens `/events/[id]/check-in` scanner page
2. Scans barcode OR manually enters ticket number or ID
3. `POST /api/tickets/[id]/check-in` looks up by `id`, `ticketNumber`, or `barcode` (OR query)
4. Validates: event date = today (rejects past/future events)
5. Validates: ticket status must be `sold` (rejects held, cancelled, refunded)
6. If already `checked_in`: returns success with `checkInResult: 'already_checked_in'` (idempotent — no error)
7. Updates ticket to `checked_in`, records `checkedInAt` and `checkedInBy`
8. Returns check-in stats: checkedIn count, remaining sold count, total, percentCheckedIn
9. Manager can undo via `DELETE /api/tickets/[id]/check-in` (reverts to `sold`)

### Capacity Enforcement
- `totalCapacity` and `reservedCapacity` are tracked on the Event
- `EventPricingTier.quantityAvailable` (null = unlimited) and `quantitySold` track per-tier usage
- Hold flow checks existing held/sold tickets before allowing a new hold
- Cannot reduce `quantityAvailable` below `quantitySold` via tier PUT
- Per-table capacity: `EventTableConfig.maxPartySize` (defaults to table.capacity)

### Event Publication Guard
Must satisfy ALL before `POST /api/events/[id]/publish`:
- `reservationConflictsHandled = true` (must run conflict detection first)
- At least one active pricing tier exists
- `totalCapacity > 0`
- Event status is `draft` (not already on_sale, cancelled, or completed)

### Conflict Detection
- On event creation (`POST /api/events`), server checks `Reservation` table for same date with status `confirmed` or `seated`
- Time overlap check: `eventStart < resEnd AND eventEnd > resStart` (with 4-hour default if no endTime)
- Events created with conflicts have `reservationConflictsHandled = false` and cannot be published
- `GET /api/events/[id]/conflicts` returns the conflicting reservations
- `POST /api/events/[id]/resolve-conflicts` marks conflicts resolved (sets `reservationConflictsHandled = true`)

### Pricing Tier Immutability After Sales
- `price` cannot be changed after any ticket is sold (prevents revenue inconsistency)
- `quantityAvailable` cannot be reduced below `quantitySold`
- Tier cannot be deleted if it has sold/checked_in tickets — must deactivate instead
- New tiers can always be added even after sales begin

### Table Configuration (Per-Event Override)
- Every table defaults to `isIncluded=true`, `bookingMode=inherit` with no explicit config record
- `EventTableConfig` overrides this for specific tables in specific events
- `bookingMode`: `inherit` (use event's ticketingMode) | `per_seat` | `per_table` | `disabled`
- `GET /api/events/[id]/tables/[tableId]` returns seat-level availability with hold expiry checks

### Edge Cases & Business Rules
- Once tickets sold: cannot modify totalCapacity, eventDate, doorsOpen, startTime, ticketingMode
- Reservation conflict detection checks time overlap on same date
- Ticket number format: `EVT-YYYYMMDD-XXXXX`
- Barcode: 8-byte random hex for scanning
- Hold concurrency: checks for existing held/sold tickets before allowing hold
- Cannot delete event with sold tickets — must refund first
- Ticket lookup supports ID, ticketNumber, or barcode in a single OR query (affects GET /api/tickets/[id], check-in, and undo check-in)
- Refund decrements tier `quantitySold` if ticket was sold or checked_in (not if already cancelled)
- Cancel also decrements `quantitySold` if ticket was sold or checked_in
- `purchaseChannel`: `pos` (staff-initiated at register) | `online` | `phone` | `comp` (complimentary)

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Reports | Event revenue reporting |
| Reservations | Conflict detection and resolution |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Tickets linked to POS orders |
| Customers | Ticket buyer linked to Customer |
| Payments | Ticket payment linked to Payment |
| Floor Plan | Table/seat assignment for events |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Reservations** — conflict detection on same-date events
- [ ] **Floor Plan** — table/seat availability integrity
- [ ] **Payments** — refund follows payment void flow
- [ ] **Customers** — customer linking on ticket purchase

---

## Permissions Required

> No formal permission keys registered in `src/lib/permission-registry.ts` for events or tickets. All event/ticket routes use `withVenue()` (authentication only). Authorization is enforced at the UI layer (manager-only pages) and by operational rules in the route handlers (e.g., refund checks ticket status, not caller role).

| Action | Effective Auth | Level |
|--------|---------------|-------|
| View events list | Employee PIN (`withVenue`) | Standard |
| Create event | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Edit event | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Publish event | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Cancel/delete event | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Sell tickets / hold | Employee PIN (`withVenue`) | Standard |
| Check-in tickets | Employee PIN (`withVenue`) | Standard |
| Undo check-in | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Refund ticket | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Cancel ticket | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Manage pricing tiers | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |
| Manage table configs | Employee PIN (`withVenue`) | Standard (UI restricts to Manager) |

> If role-based API enforcement is needed in the future, add keys such as `EVENTS_MANAGE`, `EVENTS_CHECKIN`, `TICKETS_REFUND` to `src/lib/permission-registry.ts` and apply `requirePermission()` to the relevant routes.

---

## Known Constraints & Limits
- Hold duration default: 10 minutes
- Event date must be today for check-in (date-only comparison)
- `ticketNumber` and `barcode` are globally unique
- Max tickets per order configurable per event
- Per-tier quantity limits (null = unlimited)

---

## Android-Specific Notes
- Ticket scanning planned for Android barcode scanner
- Check-in endpoint supports barcode lookup

---

## Related Docs
- **Domain doc:** `docs/domains/EVENTS-DOMAIN.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Events & Tickets row
- **Skills:** Skill 19 (Reservations), Skill 79 (Reservation Reports), Skill 108 (Event Ticketing)

---

*Last updated: 2026-03-03*
