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
| **1** | Build the POS | 🔄 In Progress |
| **2** | Build Admin Console | ⏳ Later |
| **3** | Deployment Infrastructure | ⏳ Later |

**Full architecture details:** See `/docs/GWI-ARCHITECTURE.md`

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
