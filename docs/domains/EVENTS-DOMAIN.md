# Events Domain

**Domain ID:** 13
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Events domain manages reservations, event ticketing, and customer bookings. It handles:
- Reservation system with timeline view and status tracking
- Table assignment for reservations
- Event CRUD and ticketing (planned)
- Seat hold/release with TTL (planned)

## Domain Trigger

```
PM Mode: Events
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Reservations | Booking management | `src/app/api/reservations/`, `src/app/(admin)/reservations/` |
| Events | Event management | `src/app/api/events/` |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/reservations` | GET/POST | Reservation CRUD |
| `/api/reservations/[id]` | PUT/DELETE | Single reservation |
| `/api/events` | GET/POST | Event CRUD |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 19 | Reservations | DONE |
| 79 | Reservation Reports | DONE |
| 108 | Event Ticketing APIs | TODO |

## Integration Points

- **Floor Plan Domain**: Table assignment for reservations
- **Reports Domain**: Reservation reports, no-show tracking
- **Customers Domain**: Customer profiles linked to reservations
