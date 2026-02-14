# CLAUDE.md - GWI POS Project Reference

This file provides context for Claude Code when working on this project.

## Project Overview

GWI POS is a modern point-of-sale system built for bars and restaurants. It emphasizes a "fewest clicks" philosophy for fast service.

## System Architecture

GWI POS is a **hybrid SaaS** system with local servers at each location for speed and offline capability.

```
┌─────────────────────────────────────────────────────────────────┐
│                    GWI ADMIN CONSOLE (Cloud)                     │
│  Onboard locations • Push updates • Monitor • Aggregate reports │
└─────────────────────────────────────────────────────────────────┘
                              ▲ Sync when online ▼
┌─────────────────────────────────────────────────────────────────┐
│                LOCAL SERVER (Ubuntu Mini PC)                     │
│  Docker: GWI POS (Next.js) + PostgreSQL + Socket.io + Watchtower│
│  Works 100% offline • Sub-10ms response times                   │
└─────────────────────────────────────────────────────────────────┘
              ▲ Local network (WiFi/Ethernet) ▼
         Terminals (browser) + Phones/iPads (PWA)
```

| Phase | What | Status |
|-------|------|--------|
| **1** | Build the POS (`gwi-pos`) | 🔄 In Progress |
| **2** | Build Admin Console (`gwi-mission-control`) | 🔄 In Progress |
| **3** | Deployment Infrastructure | 🔄 In Progress |

**Full architecture details:** See `/docs/GWI-ARCHITECTURE.md`

### Two Separate Repos & Deployments

This system is split across **two independent repositories**. Never put Mission Control features in the POS repo or vice versa.

| | GWI POS | GWI Mission Control |
|---|---------|-------------------|
| **Repo** | `gwi-pos` | `gwi-mission-control` |
| **Local path** | `/Users/brianlewis/Documents/My websites/2-8 2026-B-am GWI POINT OF SALE` | `/Users/brianlewis/Documents/My websites/gwi-mission-control` |
| **Vercel domain** | `www.barpos.restaurant` | `app.thepasspos.com` |
| **Venue subdomains** | `{slug}.ordercontrolcenter.com` | N/A |
| **Purpose** | POS app (ordering, payments, KDS, floor plan, menu, reports) | Admin console (onboard venues, fleet management, monitoring, billing) |
| **Database** | Neon PostgreSQL — one database per venue (`gwi_pos_{slug}`) | Neon PostgreSQL — single master database |
| **Prisma schema** | `prisma/schema.prisma` (POS models: Order, MenuItem, Table, etc.) | Own `prisma/schema.prisma` (Cloud models: CloudOrganization, CloudLocation, ServerNode, etc.) |
| **Auth** | Employee PIN login (per-venue) | Clerk B2B (org-level admin users) |

**Release workflow:**
1. New POS features → commit & push to `gwi-pos` → Vercel auto-deploys to `barpos.restaurant` / `*.ordercontrolcenter.com`
2. New MC features → commit & push to `gwi-mission-control` → Vercel auto-deploys to `app.thepasspos.com`

**What lives WHERE:**

| Feature | Repo |
|---------|------|
| Fleet registration, NUC provisioning, registration tokens | **Mission Control** |
| Server heartbeat, sync, license validation | **Mission Control** |
| Venue onboarding, organization management | **Mission Control** |
| Fleet dashboard, server monitoring | **Mission Control** |
| POS ordering, payments, KDS, floor plan | **POS** |
| Menu builder, modifiers, ingredients | **POS** |
| Reports (daily, shift, PMIX, tips) | **POS** |
| Employee management, roles, permissions | **POS** |
| Hardware (printers, KDS screens, payment readers) | **POS** |
| Venue settings (name, address, timezone) | **POS** |

**NEVER do this:**
- Add fleet/registration/provisioning code to the POS repo
- Add POS ordering/menu/payment logic to the MC repo
- Duplicate models that exist in the other repo's schema

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.5 | Framework with App Router |
| React | 19.2.3 | UI Library |
| TypeScript | 5.x | Type Safety |
| Tailwind CSS | 4.x | Styling |
| Prisma | 6.19.2 | ORM |
| PostgreSQL | Neon | Database (cloud, database-per-venue) |
| Zustand | 5.x | State Management |
| Zod | 4.x | Validation |

## Database

**Database Type**: Neon PostgreSQL (database-per-venue)

Each venue gets its own PostgreSQL database on Neon. Multi-tenant isolation is enforced at the database level, with `locationId` as an additional application-level filter.

### CRITICAL: Protecting Your Data

> **DATA LOSS INCIDENT:** Custom data not in `seed.ts` will be DELETED by reset commands.

| Command | Risk | What It Does |
|---------|------|--------------|
| `npm run reset` | EXTREME | DELETES EVERYTHING, re-seeds |
| `npm run db:push` | HIGH | Can drop tables/columns |
| `npm run db:migrate` | MEDIUM | May drop columns |

**BEFORE ANY SCHEMA CHANGE:**
```bash
npm run db:backup && npm run db:push  # or db:migrate
```

**Safe commands:** `npx prisma generate`, `npm run db:studio`, `npm run db:backup`, `npm run db:list-backups`, `npm run db:restore`

### Production Rules (MANDATORY)

- No `reset` or `db:push` in production — migrations only
- Backup before migrate (automatic)
- Soft deletes only (never hard delete, use `deletedAt`)
- PostgreSQL (Neon) for all environments

### Environment Variables

Located in `.env.local`:
```
DATABASE_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
DIRECT_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
```

### CRITICAL: Multi-Tenancy (locationId)

**EVERY table MUST have `locationId`** (except `Organization` and `Location`).

```prisma
model NewModel {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?  // Soft delete (REQUIRED)
  syncedAt   DateTime?  // Cloud sync tracking (REQUIRED)
  @@index([locationId])
}
```

**Rules:**
- Always filter by `locationId` in queries
- Always filter out deleted: `deletedAt: null`
- Always include `locationId` when creating records
- Never hard delete — always soft delete with `deletedAt: new Date()`

## Demo Credentials

| Role | PIN | Description |
|------|-----|-------------|
| Manager | 1234 | Full admin access |
| Server | 2345 | Server permissions |
| Bartender | 3456 | Bar permissions |

## Development

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Lint code
```

## Performance Rules (MANDATORY)

**These rules are NON-NEGOTIABLE for any new feature on POS, KDS, or Expo screens.**
**Full architecture details:** See `/docs/GWI-ARCHITECTURE.md` Real-Time Architecture section.
**Skill docs:** See `/docs/skills/339-344` for implementation details.

### Socket-First Updates (No Polling)
- Cross-terminal updates MUST use Socket.io via `emitToLocation()` or `emitToTags()` from API routes
- Client MUST listen via `getSharedSocket()` from `src/lib/shared-socket.ts`
- **NEVER** call `io()` directly — always use `getSharedSocket()` / `releaseSharedSocket()`
- **NEVER** add `setInterval` polling for data that can come via socket
- Fallback polling at 30s ONLY when `isConnected === false`

### Delta Updates for Lists
- Removal events (paid, voided, deleted, bumped) → remove from local state, zero network
- Addition/change events → debounced full refresh (150ms minimum)
- **NEVER** refetch an entire list on every socket event

### Use Existing Caches
- Menu data: `src/lib/menu-cache.ts` (60s TTL)
- Location settings: `src/lib/location-cache.ts`
- Snapshot APIs: `/api/floorplan/snapshot`, `/api/orders/open?summary=true`, `/api/menu/items/bulk`
- **NEVER** write fresh DB queries for data that's already cached

### Zustand Patterns
- **Atomic selectors only**: `useStore(s => s.field)` — never `const { ... } = useStore()`
- **Single `set()` per interaction**: compute totals in JS, call `set()` once — never `set()` then `calculateTotals()`

### API Route Performance
- Non-critical side effects (inventory, print, socket dispatch) MUST be fire-and-forget: `void doWork().catch(console.error)`
- **NEVER** `await` background work before returning response
- New multi-column query patterns MUST add compound `@@index` in schema.prisma
- **NEVER** write N+1 loops — batch with `findMany` + Map lookup

### Instant UI Feedback
- Modals/panels MUST open instantly (background work runs after opening)
- Cash payments close modal instantly (payment runs in background)
- **NEVER** block UI on network requests the user doesn't need to wait for

### Server-Side Socket Dispatch Pattern
```typescript
// In API route after DB write:
import { emitToLocation } from '@/lib/socket-server'
emitToLocation(locationId, 'orders:list-changed', { orderId, status })
// Don't await — fire and forget
```

### Client-Side Socket Consumer Pattern
```typescript
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

useEffect(() => {
  const socket = getSharedSocket()
  const onEvent = (data) => { /* handle */ }
  socket.on('my:event', onEvent)
  if (socket.connected) { /* join rooms */ }
  return () => {
    socket.off('my:event', onEvent)
    releaseSharedSocket()
  }
}, [deps])
```

## Application Routes

### POS Routes
| Route | Description |
|-------|-------------|
| `/login` | PIN-based login |
| `/orders` | Main POS order screen |
| `/kds` | Kitchen Display System |
| `/kds/entertainment` | Entertainment KDS |

### Admin Routes (via hamburger menu)
| Route | Description |
|-------|-------------|
| `/menu` | Menu management |
| `/modifiers` | Modifier group management |
| `/employees` | Employee management |
| `/tables` | Floor plan / table layout |
| `/settings` | System settings |
| `/settings/order-types` | Order types config |
| `/settings/tip-outs` | Tip-out rules |
| `/reports` | Sales and labor reports |
| `/reports/daily` | Daily store report (EOD) |
| `/customers` | Customer management |
| `/reservations` | Reservation system |
| `/ingredients` | Food inventory |
| `/inventory` | Inventory tracking |
| `/liquor-builder` | Liquor/spirit recipe builder |

## Key Features

### Category Types
`food`, `drinks`, `liquor`, `entertainment`, `combos`, `retail`

### Modifier Types (JSON array, multi-select)
`universal`, `food`, `liquor`, `retail`, `entertainment`, `combo`

### Modifier Features
- **Stacking**: `allowStacking: true` — tap same modifier twice for 2x
- **Hierarchy**: Child modifier groups create nested selections (`OrderItemModifier.depth`)
- **Pre-modifiers**: No, Lite, Extra on each modifier
- **Online Override**: `MenuItemModifierGroup.showOnline` + `Modifier.showOnPOS/showOnline`
- **Per-modifier print routing**: `printerRouting` (follow/also/only) + `printerIds`

### Pour Sizes (Liquor Items)
`shot` (1.0x), `double` (2.0x), `tall` (1.5x), `short` (0.75x) — stored in `MenuItem.pourSizes`

### Linked Item Modifiers (Spirit Upgrades)
`Modifier.linkedMenuItemId` links to a MenuItem for price/inventory tracking. Enables "Patron sold 47x: 30 standalone, 17 as upgrades."

### Entertainment Sessions
Timed rentals with timer auto-start on send. Block time (fixed duration) or per-minute billing. Three views: Entertainment KDS, Open Orders Panel, Orders Page.

### Tip Sharing
Automatic tip-outs at shift close. All tip shares go to payroll. See `/docs/domains/TIPS-DOMAIN.md`.

### Configurable Order Types
Admin-configurable at `/settings/order-types`. Default types: dine_in, bar_tab, takeout, delivery, drive_thru. Custom fields and workflow rules supported.

### Menu Builder
Single-screen builder with item-owned modifier groups (not shared). Left panel hierarchy, center ItemEditor, right ModifiersPanel. Unlimited depth child modifier groups.

## Project Structure

```
gwi-pos/
├── prisma/              # Schema, seed, migrations
├── src/
│   ├── app/
│   │   ├── (auth)/      # Login pages
│   │   ├── (pos)/       # POS interface
│   │   ├── (admin)/     # Admin pages
│   │   └── api/         # API routes
│   ├── components/      # React components
│   ├── hooks/           # Custom hooks
│   ├── stores/          # Zustand stores
│   ├── lib/             # Utilities
│   └── types/           # TypeScript types
├── public/              # Static assets
└── CLAUDE.md            # This file
```

## API Conventions

### Order API (FIX-005 — Enforced Separation)
- `POST /api/orders` — Create new order
- `GET /api/orders/[id]` — Get order details
- `PUT /api/orders/[id]` — **METADATA only** (tableId, orderType, notes). **REJECTS items array.**
- `POST /api/orders/[id]/items` — **Append/update items atomically** (prevents race conditions)
- `PUT /api/orders/[id]/items/[itemId]` — Update single item field
- `POST /api/orders/[id]/send` — Send to kitchen

**CRITICAL:** Never send `items` in PUT to `/api/orders/[id]`. See `/docs/api/ORDER-API-CONTRACT.md`.

### Response Format
```typescript
{ data: T }     // Success
{ error: string } // Error
```

### Common Patterns
1. Decimal fields — Convert to `Number()` when returning from API
2. JSON fields — Used for structured data (e.g., `modifierTypes`, `pourSizes`)
3. Soft deletes — `deletedAt: new Date()` (required for sync)
4. Sort order — Most lists support `sortOrder`
5. Always filter by `locationId` and `deletedAt: null`

## Schema Highlights

### Key Models
- `Organization` → `Location` → Most other models
- `Category` → `MenuItem` → `OrderItem`
- `ModifierGroup` → `Modifier`
- `Order` → `OrderItem` → `OrderItemModifier`

### Important Fields
- **MenuItem**: `itemType` ('standard'|'combo'|'timed_rental'), `pourSizes` (JSON), `timedPricing` (JSON)
- **ModifierGroup**: `modifierTypes` (JSON array), `isSpiritGroup` (Boolean)
- **Category**: `categoryType` (determines item builder behavior)

## Inventory & Recipe Costing

### Modifier Instruction Multipliers
| Instruction | Multiplier |
|-------------|------------|
| NO, HOLD, REMOVE | 0.0 |
| LITE, LIGHT, EASY | 0.5 |
| NORMAL, REGULAR | 1.0 |
| EXTRA, DOUBLE | 2.0 |
| TRIPLE, 3X | 3.0 |

Configurable per-location in InventorySettings. "No" logic: skips base recipe deduction entirely.

### Auto-Deduction
- **Order Paid** → `deductInventoryForOrder()` (transaction type: `sale`)
- **Item Voided** → `deductInventoryForVoidedItem()` (transaction type: `waste`)
- Both run fire-and-forget (async, non-blocking)
- Two-path modifier deduction: Path A (ModifierInventoryLink) takes precedence over Path B (Modifier.ingredientId fallback)

**Key files:** `src/lib/inventory-calculations.ts`, `/api/orders/[id]/pay/route.ts`, `/api/orders/[id]/comp-void/route.ts`

## Hardware & Printing

### Printer Types & Roles
- Types: `thermal` (receipts), `impact` (kitchen)
- Roles: `receipt`, `kitchen`, `bar`

### Print Routes
Named routes with priority-based routing: `PrintRoute > Item printer > Category printer > Default`
- Backup printer failover with configurable timeout
- Per-modifier print routing: `follow` (default), `also`, `only`

### ESC/POS Protocol
- Thermal: `GS ! 0x11` (double), `GS ! 0x00` (normal)
- Impact: `ESC ! 0x30` (double), `ESC ! 0x00` (normal)
- Two-color: `ESC r 0x01` (red), `ESC r 0x00` (black)

**Key files:** `src/lib/escpos/`, `src/lib/printer-connection.ts`, `/api/print/kitchen/route.ts`

### KDS Device Security
256-bit token + httpOnly cookie + 5-min pairing code. Optional static IP binding. See `docs/skills/102-KDS-DEVICE-SECURITY.md`.

## Toast Notifications

```typescript
import { toast } from '@/stores/toast-store'
toast.success('Order saved')
toast.error('Connection lost', 8000)  // optional duration
```

Auto-dismiss: 5s (success/info), 7s (error/warning). Stacks vertically, bottom-right.

## Go-Live Cleanup: Simulated Payment Defaults

**Search tag:** `SIMULATED_DEFAULTS`

Before deploying, remove all simulated payment placeholders. See `src/lib/datacap/simulated-defaults.ts`. Steps:
1. Set real `merchantId` + `operatorId` per Location
2. Set all `PaymentReader.communicationMode` to `'local'`
3. Set `settings.payments.processor` to `'datacap'`
4. Delete `simulated-defaults.ts` and its import
5. Verify: `grep -r "SIMULATED_DEFAULTS" src/` returns zero matches

## Troubleshooting

```bash
npm run reset          # Reset entire database (DESTRUCTIVE)
npm run db:studio      # Check database in browser
npx prisma generate    # Regenerate Prisma client
npx tsc --noEmit       # Check types
```

If port 3000 is in use, dev server auto-selects another port (usually 3001).

## Upcoming Work

> **See:** `/docs/PM-TASK-BOARD.md` for the cross-domain task board with granular tasks.

Key priorities:
1. POS Front-End Ordering UI Lift (PM: Menu)
2. Bar Tabs Screen
3. Closed Orders Management
4. Kitchen/Print Integration
5. Tip Guide Basis Configuration
6. Inventory System Refinements (unify liquor + food engines)
7. Tag-Based Routing Completion
8. Ingredient System Enhancements
9. Real-Time Menu Updates & Online Ordering (Skill 217 — infrastructure done, client pending)
10. Table Capacity/Seats Sync

## Recent Changes

All change history is maintained in domain changelogs and skill docs:
- **Domain changelogs:** `/docs/changelogs/[DOMAIN]-CHANGELOG.md`
- **Skill docs:** `/docs/skills/` (indexed in `/docs/skills/SKILLS-INDEX.md`)

Key recent work: Combine features fully removed (Skill 326), seat management fixes (Skill 328), cash rounding pipeline (Skill 327), menu builder with child modifiers (Skill 123), socket layer consolidation (Skill 248), multi-tenant DB routing (Skill 337), cloud session validation (Skill 338).

## Pre-Launch Test Checklist

**Moved to:** `/docs/PRE-LAUNCH-CHECKLIST.md`

22 test categories, 200+ individual tests. Must all pass before go-live. Updated during every PM EOD session.

## PM Mode & Worker Prompts

**Moved to:** `/docs/PM-MODE-GUIDE.md`

Contains: PM Mode triggers (Classic, Single Agent, Agent Team), worker prompt templates, domain registry (25 domains), layer separation rules, morning startup protocol, EOD protocol, quality control guidelines.

**Quick reference triggers:**
- `PM Mode: [Domain]` — Classic PM mode
- `PM Mode: [Domain] (Single Agent)` — Single agent PM
- `PM Mode: [Domain] (Agent Team)` — Multi-agent PM team
- `EOD: [Domain]` — End of day protocol
