# Feature: Bottle Service

## Status
`Active` — Tier management API and deposit pre-auth flow are built. Floor plan progress bar is built (Skill 390). Full VIP workflow (bottle presentation queue, VIP guest profiles, inventory allocation) not yet built.

## Summary
VIP table management for bottle service. Tier-based minimum spend system with deposit pre-authorization. Tracks minimum spend progress per table. Supports per-tier auto-gratuity overrides. Orders can be associated with a bottle service tier and deposit pre-auth is captured via Datacap at tab-open time.

## What's Built

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bottle-service/tiers` | List all active tiers for a location, ordered by `sortOrder` |
| POST | `/api/bottle-service/tiers` | Create a new tier |
| GET | `/api/bottle-service/tiers/[id]` | Get a single tier |
| PUT | `/api/bottle-service/tiers/[id]` | Update a tier |
| DELETE | `/api/bottle-service/tiers/[id]` | Soft-delete a tier |
| POST | `/api/orders/[id]/bottle-service` | Open a bottle service tab on an order: selects a tier, runs a deposit pre-auth via Datacap reader, links the tier to the order |
| GET | `/api/orders/[id]/bottle-service` | Get the bottle service status for an order (tier info, deposit amount, current spend vs minimum) |
| POST | `/api/orders/[id]/bottle-service/re-auth` | Re-authorize the deposit pre-auth (e.g., if initial hold expired or amount increased) |

### Data Model

**BottleServiceTier**
```
id                  String    (cuid)
locationId          String    (FK → Location)
name                String    e.g., "Bronze", "Silver", "Gold", "Platinum"
description         String?   e.g., "Includes reserved seating for 4"
color               String    Banner/badge color hex (default: #D4AF37 gold)
depositAmount       Decimal   Pre-auth hold amount (e.g., 500, 1000, 2000)
minimumSpend        Decimal   Soft minimum spend requirement
autoGratuityPercent Decimal?  Per-tier auto-gratuity override (e.g., 20.0)
sortOrder           Int       Display order (default 0)
isActive            Boolean   (default true)
createdAt           DateTime
updatedAt           DateTime
deletedAt           DateTime? (soft delete)
syncedAt            DateTime?
```

Relations:
- `location` → Location
- `reservations` → Reservation[]
- `orders` → Order[] (via `OrderBottleServiceTier` relation)

### Floor Plan Integration
- Floor plan progress bar per table (Skill 390): visual indicator of spend vs minimum
- Progress bar color/threshold driven by tier `color` and `minimumSpend`

### Deposit Pre-Authorization Flow
- `POST /api/orders/[id]/bottle-service` requires `readerId`, `employeeId`, and `tierId`
- Calls Datacap to run an incremental pre-auth (hold) for `tier.depositAmount`
- Links the tier to the order via `order.bottleServiceTierId`
- Emits order events (`emitOrderEvent`) and dispatches socket update
- Auto-gratuity from the tier is applied at close time if `autoGratuityPercent` is set

## What's Planned (SPEC-28)
- **Bottle presentation queue** — coordinated bottle arrival with ice/mixers coordination screen
- **VIP guest profiles** — spending history, preferences, notes tied to guest identity
- **Inventory allocation** — reserve specific bottles for VIP tables before service
- **Admin UI for tier management** — no front-end settings page for creating/editing tiers exists yet (API only)
- **Minimum spend enforcement UI** — soft-minimum warning is tracked in data but no enforcement gate exists

## Dependencies
- **Tabs** (`docs/features/tabs.md`) — VIP tables are high-value tabs; bottle service attaches to open tab orders
- **Payments** (`docs/features/payments.md`) — deposit pre-auth uses Datacap incremental auth
- **Floor Plan** (`docs/features/floor-plan.md`) — visual progress bar per table
- **Menu** — bottle inventory items are standard menu items
- **Customers** — VIP guest profiles (planned)
- **Reservations** — `BottleServiceTier` has a `reservations` back-relation; reservation system is separately planned

## SPEC Document
`docs/skills/SPEC-28-BOTTLE-SERVICE.md`

*Last updated: 2026-03-03*
