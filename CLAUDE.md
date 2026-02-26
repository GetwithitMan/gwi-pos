# CLAUDE.md - GWI POS Project Reference

This file provides context for Claude Code when working on this project.

## Project Overview

GWI POS is a modern point-of-sale system built for bars and restaurants. It emphasizes a "fewest clicks" philosophy for fast service.

## Task Execution Protocol (MANDATORY)

**Before doing ANY work, follow this decision order every turn:**

### Step 1: Assess (every turn, no exceptions)
Before touching code, files, or tools — pause and think:
- What is the user actually asking for?
- How many files/domains does this touch?
- Is there research needed before implementation?
- Can parts of this work run in parallel?

### Step 2: Decide Solo vs Team

| Condition | Action |
|-----------|--------|
| Single-file edit, < 20 lines changed | Solo — just do it |
| Bug fix in one known location | Solo — just do it |
| Answering a question about the codebase | Solo or Explore agent |
| **2+ files across different domains** | **Use a team** |
| **Research + implementation needed** | **Use a team** (Explore agent researches while you plan) |
| **Schema change + API + UI updates** | **Use a team** (parallelize the layers) |
| **Any task touching 3+ files** | **Use a team** |
| **User says "PM Mode" or "use a team"** | **Use a team** (always) |
| **New feature (not a patch)** | **Use a team** |
| **Multi-step task with dependencies** | **Use a team** (TodoWrite + parallel agents) |

### Step 3: Team Composition (when teaming)
Spawn the right agents for the job:

| Agent Type | Use For |
|------------|---------|
| `Explore` | Codebase research, finding files, understanding patterns — always spawn first |
| `general-purpose` | Writing code, editing files, full implementation |
| `Bash` | Running builds, tests, git operations |
| `Plan` | Designing approach for complex features before coding |

**Preferred pattern for most tasks:**
1. Spawn an **Explore** agent to research the current state (runs in background)
2. While it researches, use **TodoWrite** to break down the task
3. Spawn **general-purpose** agents for each independent workstream
4. Validate with a **Bash** agent (build, lint, type-check)

### Step 4: Always Use TodoWrite for Multi-Step Work
If the task has 3+ steps, create a todo list. This gives the user visibility into progress and keeps work organized.

### Step 5: Forensic Research Protocol (for bugs, issues, and "something's wrong")

When investigating a bug, unexpected behavior, or anything where the root cause is unclear — **do NOT do a surface-level search and start fixing**. Deploy a forensic team:

**Spawn 3 parallel Explore agents, each with a different lens:**

| Agent | Lens | What It Investigates |
|-------|------|---------------------|
| **Forensic-Data** | Data flow | Trace the data from DB schema → Prisma query → API route → client fetch → Zustand store → rendered component. Find where the value changes, gets lost, or arrives wrong. Read the actual code in each file, don't just search for names. |
| **Forensic-Integration** | Connections & side effects | Find every file that imports, calls, or listens to the affected code. Check socket events, cache invalidation, fire-and-forget side effects, and other modules that might interfere. Search for the function/event/model name across the entire codebase. |
| **Forensic-History** | Recent changes & context | Check `git log` for recent commits touching the affected files. Read the skill docs and changelogs for the relevant domain. Look at the Living Log for related work. Check if a recent change broke an assumption. |

**Each forensic agent MUST:**
- Actually **read the full file contents** of every relevant file (not just search for a string and stop)
- Follow imports and function calls at least **2 levels deep** (if `A` calls `B` which calls `C`, read all three)
- Report what they found AND what they ruled out
- Flag anything suspicious even if they're not sure it's the cause

**After all 3 agents report back:**
1. Cross-reference their findings — the bug usually lives where two lenses overlap
2. Form a hypothesis and verify it against the code before writing any fix
3. Only then create the implementation plan

**When to trigger forensic research:**
- User reports something "doesn't work" or "broke"
- A fix you applied didn't solve the problem
- The bug involves data appearing wrong, missing, or stale
- Behavior differs between terminals/sessions
- Something "used to work" but stopped
- You're about to change code you haven't fully traced

**The rule: Never fix what you don't fully understand.** A shallow grep that finds one file is not research. Following the full data path through every layer IS research.

### The Bias: When in Doubt, Team It
If you're unsure whether something needs a team — **use a team**. The cost of spawning an extra agent is low. The cost of a single agent losing context halfway through a complex task is high.

## System Architecture

GWI POS is a **hybrid SaaS** system with local servers at each location for speed and offline capability.

```
┌─────────────────────────────────────────────────────────────────┐
│                  MISSION CONTROL (Cloud — Vercel)                │
│  Onboard locations • Push updates • Monitor fleet                │
│  app.thepasspos.com • Clerk B2B auth • Neon PostgreSQL           │
│  GWI-INTERNAL ONLY                                               │
└─────────────────────────────────────────────────────────────────┘
                              ▲ Fleet Mgmt ▼
┌─────────────────────────────────────────────────────────────────┐
│              VENUE BACKOFFICE (Cloud — Java 25 + Spring Boot)    │
│  Event ingestion • Reporting • Admin dashboard                   │
│  api.ordercontrolcenter.com (API) │ {slug}.occ.com/admin (UI)    │
│  HMAC-SHA256 auth • Neon PostgreSQL (shared cloud DB)            │
└─────────────────────────────────────────────────────────────────┘
                     ▲ Events (HMAC-signed, fire-and-forget) ▼
┌─────────────────────────────────────────────────────────────────┐
│                  LOCAL SERVER (Ubuntu NUC)                        │
│  Node.js (systemd) + LOCAL PostgreSQL (PRIMARY) + Socket.io     │
│  Syncs to Neon cloud in background (orders, payments, shifts)   │
│  Provisioned via installer.run • Works 100% OFFLINE             │
│  Heartbeat (60s cron) • Sync agent (SSE) • Kiosk mode           │
└─────────────────────────────────────────────────────────────────┘
              ▲ Local network (WiFi/Ethernet) ▼
    Terminals (Chromium kiosk) + Phones/iPads (PWA) + Android App
```

### CRITICAL: All Terminals Point to the NUC (MANDATORY)

**Every POS terminal, kiosk, SmartTab, and browser MUST connect to the local NUC server — NEVER to Vercel/cloud URLs.**

| Device | URL | Why |
|--------|-----|-----|
| NUC kiosk | `http://localhost:3005` | Server role — kiosk on same machine |
| Terminal/SmartTab | `http://{NUC_IP}:3005` | Terminal role — points to NUC on LAN |
| Phone/iPad (PWA) | `http://{NUC_IP}:3005` | Mobile — connects via local WiFi |

**Vercel URLs (`*.ordercontrolcenter.com`, `barpos.restaurant`) are for online ordering and cloud admin ONLY.** They cannot:
- Maintain WebSocket/Socket.IO connections (serverless = no persistent sockets)
- Reach local printers, payment readers, or KDS screens
- Provide the "Connection lost" banner will ALWAYS show on Vercel

**Before making any deployment or kiosk changes, ALWAYS verify terminals point to the NUC.** The NUC is the single gateway to the cloud — terminals never talk to the cloud directly.

### CRITICAL: Offline-First Architecture (MANDATORY — READ BEFORE TOUCHING ANY DB CODE)

**The POS MUST work with zero internet. This is the entire point of the local NUC.**

```
IF internet goes down:
  ✅ Take orders         (local PG, instant)
  ✅ Process payments    (local PG, instant)
  ✅ Print tickets       (NUC → LAN printer, no internet needed)
  ✅ Run KDS             (socket.io on local network)
  ✅ Clock in/out        (local PG)
  ⚠️ Online orders       (cloud → NUC, paused until internet returns)
  ⚠️ Cloud admin         (read-only, shows stale data)
  ⚠️ Hardware commands   (cloud→NUC, paused until internet returns)
```

**Rules agents MUST follow:**
1. **NEVER** write code that queries Neon directly from a POS API route — all `db.*` calls go to local PG
2. **NEVER** make POS startup, login, order creation, or payment depend on cloud connectivity
3. **NEVER** set `DATABASE_URL` on a NUC to a neon.tech URL — that destroys offline capability
4. The `neonClient` (in `src/lib/neon-client.ts`) is **sync-only** — used exclusively by background sync workers, hardware-command-worker, and online-order-worker
5. All new sync work uses `syncedAt` + `updatedAt` delta queries — never full-table replications
6. **Clock discipline:** All business writes MUST use DB-generated `NOW()` (Prisma `@default(now())` / `@updatedAt`). **NEVER** accept a client-supplied timestamp for `createdAt`, `updatedAt`, or `syncedAt`. Last-write-wins conflict resolution is only safe when timestamps come from the DB clock, not the caller.
7. If you see a NUC with `DATABASE_URL=neon.tech` — **that is a critical bug**, file it immediately

**Data ownership rules:**
| Owner | Models |
|-------|--------|
| NUC (source of truth) | Order, OrderItem, Payment, Shift, Drawer, TimeClockEntry, TipLedger, VoidLog, InventoryTransaction |
| Cloud (source of truth) | MenuItem, Category, ModifierGroup, Modifier, Employee, Role, Table, Section, Printer, KDSScreen, OrderType, TaxRule |
| Cross-origin | OnlineOrder (cloud creates → NUC dispatches), HardwareCommand (cloud writes → NUC executes) |

### CRITICAL: Android Native App is the PRIMARY Client

**Android native app is the primary POS interface. Web/browser is secondary.**

- All new UI work should be designed mobile-first with Android in mind
- Touch targets must be large (min 48x48dp), no hover-dependent interactions
- Socket.io is the nervous system — real-time events are critical for native app responsiveness
- Performance is non-negotiable: sub-50ms for all POS actions (tap → visual response)
- The web UI (Chromium kiosk) must remain functional as a fallback, but native Android is the target
- When building features: if it works fast on Android over WiFi to the NUC, it works everywhere

| Phase | What | Status |
|-------|------|--------|
| **1** | Build the POS (`gwi-pos`) | 🔄 In Progress |
| **1.5** | Build Venue Backoffice (`gwi-backoffice`) | 🔄 In Progress |
| **2** | Build Admin Console (`gwi-mission-control`) | 🔄 In Progress |
| **3** | Deployment Infrastructure | 🔄 In Progress |

**Full architecture details:** See `/docs/architecture/GWI-ARCHITECTURE.md`

### Three Separate Repos & Deployments

This system is split across **three independent repositories**. Never put Mission Control features in the POS repo, backoffice features in the POS repo, or vice versa.

| | GWI POS | GWI Mission Control | GWI Backoffice |
|---|---------|-------------------|----------------|
| **Repo** | `gwi-pos` | `gwi-mission-control` | `gwi-backoffice` |
| **Local path** | `/Users/brianlewis/Documents/My websites/2-8 2026-B-am GWI POINT OF SALE` | `/Users/brianlewis/Documents/My websites/gwi-mission-control` | `/Users/brianlewis/Documents/My websites/gwi-backoffice` |
| **Domain** | `www.barpos.restaurant` | `app.thepasspos.com` | `api.ordercontrolcenter.com` (API) / `{slug}.ordercontrolcenter.com/admin` (UI proxy) |
| **Venue subdomains** | `{slug}.ordercontrolcenter.com` | N/A | N/A |
| **Purpose** | POS app (ordering, payments, KDS, floor plan, menu, reports) | Admin console (onboard venues, fleet management, monitoring, billing) | Venue backoffice (event ingestion, reporting, admin dashboard) |
| **Database** | **NUC: Local PG 16 (primary, offline-first)** + Neon as cloud sync target | Neon PostgreSQL — single master database | Neon PostgreSQL — single shared cloud database |
| **Auth** | Employee PIN login (per-venue) | Clerk B2B (org-level admin users) | HMAC-SHA256 (NUC events), API key (reports) |

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
| Event ingestion, cloud sync | **Backoffice** |
| Cloud reporting (daily totals, trends) | **Backoffice** |
| Venue admin dashboard | **Backoffice** |

**NEVER do this:**
- Add fleet/registration/provisioning code to the POS repo
- Add POS ordering/menu/payment logic to the MC repo
- Add event ingestion or cloud reporting to the POS repo
- Duplicate payment/order models that exist in the backoffice schema
- Duplicate models that exist in the other repo's schema

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.5 | Framework with App Router |
| React | 19.2.3 | UI Library |
| TypeScript | 5.9.3 | Type Safety |
| Tailwind CSS | 4.x | Styling |
| Prisma | 6.19.2 | ORM |
| PostgreSQL 16 | Local (NUC) / Neon (cloud sync + dev) | NUC uses local PG as primary; Neon is cloud sync target |
| Socket.io | 4.x | Real-time cross-terminal updates |
| Zustand | 5.x | State Management |
| Zod | 4.x | Validation |

## Database

**OFFLINE-FIRST — THIS IS NON-NEGOTIABLE**

| Environment | DATABASE_URL points to | Why |
|-------------|----------------------|-----|
| **NUC (production)** | `localhost:5432/pulse_pos` (LOCAL PG 16) | Offline-first, zero-latency, no internet dependency |
| **Dev (your Mac)** | Neon cloud | No local PG needed for development |
| **Vercel (online ordering)** | Neon cloud | Serverless, no local disk |

The NUC's **local PostgreSQL is the single source of truth** for all POS operations. Neon is the **cloud sync target** — used for cloud admin dashboards, reports, and online ordering. The POS NEVER requires internet to take orders, process payments, print tickets, or operate KDS.

**Data Ownership:**
- **NUC owns**: Orders, payments, shifts, voids, inventory transactions, time clock — all transactional data
- **Cloud owns**: Menu items, employees, settings, printers, hardware config — configuration data that rarely changes during service
- **Sync**: NUC pushes transactional data to Neon every 5s; Neon pushes config changes to NUC every 15s

Multi-tenant isolation is enforced at the database level, with `locationId` as an additional application-level filter.

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
- PostgreSQL for all environments — LOCAL PG on NUC, Neon for dev/cloud
- **NEVER** point a NUC's DATABASE_URL at Neon — that breaks offline operation

### Environment Variables

**Dev / Vercel** (`.env.local` on your Mac):
```
DATABASE_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
DIRECT_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
```

**NUC production** (`/opt/gwi-pos/app/.env`):
```
# PRIMARY — local PostgreSQL (offline-first)
DATABASE_URL="postgresql://pulse_pos:xxx@localhost:5432/pulse_pos"
DIRECT_URL="postgresql://pulse_pos:xxx@localhost:5432/pulse_pos"

# SYNC TARGET — Neon cloud (background sync only)
NEON_DATABASE_URL="postgresql://...@neon.tech/gwi_pos_{slug}?sslmode=require"
NEON_DIRECT_URL="postgresql://...@neon.tech/gwi_pos_{slug}?sslmode=require"
SYNC_ENABLED=true
SYNC_UPSTREAM_INTERVAL_MS=5000    # NUC → Neon every 5s
SYNC_DOWNSTREAM_INTERVAL_MS=15000 # Neon → NUC every 15s
```

**⚠️ If a NUC's DATABASE_URL points at neon.tech — that is a BUG. Fix it immediately.**

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

### Custom Server (`server.ts`)

The POS uses a **custom Node.js server** that wraps Next.js. This is required for:
1. **Socket.io** — runs on the same HTTP server (no separate process)
2. **Multi-tenant DB routing** — wraps every request in AsyncLocalStorage with the correct PrismaClient

```
npm run dev   → dotenv -e .env.local -- tsx -r ./preload.js server.ts
npm start     → NODE_ENV=production node -r ./preload.js server.js
npm run build → prisma generate && next build && node scripts/build-server.mjs
```

**`preload.js`** polyfills `globalThis.AsyncLocalStorage` for Node 20 compatibility (Next.js 16 expects it globally). Must load via `-r ./preload.js` BEFORE any imports.

### Multi-Tenant DB Routing (`withVenue`)

All 348 API routes are wrapped with `withVenue()` from `src/lib/with-venue.ts`:

```typescript
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async (request) => {
  const items = await db.menuItem.findMany()  // auto-routes to venue DB
  return NextResponse.json({ data: items })
})
```

**How it works:**
1. `server.ts` reads `x-venue-slug` header → sets AsyncLocalStorage context with venue PrismaClient
2. `withVenue()` fast-path: if context already set (NUC), skips `await headers()` entirely
3. `db.ts` Proxy reads from AsyncLocalStorage on every DB call → routes to correct **local PG database on NUC** (or Neon on dev/Vercel)
4. No slug (local dev) → uses master client (Neon in dev)

**Key files:** `server.ts`, `src/lib/with-venue.ts`, `src/lib/request-context.ts`, `src/lib/db.ts`

## Performance Rules (MANDATORY)

**These rules are NON-NEGOTIABLE for any new feature on POS, KDS, or Expo screens.**
**Full architecture details:** See `/docs/architecture/GWI-ARCHITECTURE.md` Real-Time Architecture section.
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
├── server.ts            # Custom server (Socket.io + multi-tenant routing)
├── preload.js           # AsyncLocalStorage polyfill (loaded via -r flag)
├── prisma/              # Schema, seed, migrations
├── public/
│   └── installer.run    # NUC provisioning script (~1,454 lines)
├── src/
│   ├── app/
│   │   ├── (auth)/      # Login pages
│   │   ├── (pos)/       # POS interface
│   │   ├── (admin)/     # Admin pages
│   │   ├── (kds)/       # Kitchen Display System
│   │   └── api/         # API routes (348 routes, all wrapped with withVenue)
│   ├── components/      # React components
│   ├── hooks/           # Custom hooks
│   ├── stores/          # Zustand stores
│   ├── lib/
│   │   ├── db.ts        # Prisma client (3-tier Proxy: ALS → headers → master)
│   │   ├── with-venue.ts       # Route handler wrapper for multi-tenant isolation
│   │   ├── request-context.ts  # AsyncLocalStorage for per-request tenant context
│   │   ├── socket-server.ts    # Socket.io server init + emitToLocation/emitToTags
│   │   ├── shared-socket.ts    # Client-side singleton socket connection
│   │   ├── menu-cache.ts       # In-memory menu cache (60s TTL)
│   │   ├── location-cache.ts   # Location settings cache
│   │   └── inventory-calculations.ts  # Deduction engine
│   └── types/           # TypeScript types
├── docs/
│   ├── skills/          # Skill docs (347+ skills)
│   ├── changelogs/      # Domain changelogs
│   └── PM-TASK-BOARD.md # Cross-domain task board
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

## NUC Deployment (Production)

Each venue runs on an Ubuntu NUC provisioned by `public/installer.run` (~1,454 lines). One command:
```bash
curl -sSL https://gwi-pos.vercel.app/installer.run | sudo bash
```

### What the Installer Does
1. **Registration** — RSA-2048 keypair + hardware fingerprint → `POST /api/fleet/register` → RSA-encrypted secrets back
2. **PostgreSQL** — Installs PG 16, creates `pulse_pos` database (server role only)
3. **POS App** — Git clone → `npm ci` → `prisma db push` → `npm run build` → `pulse-pos.service` (systemd)
4. **Kiosk** — Chromium in kiosk mode via `pulse-kiosk.service` + KDE/GNOME autostart
5. **Heartbeat** — 60s cron: HMAC-signed JSON with CPU/memory/disk/localIp/posLocationId → MC
6. **Sync Agent** — SSE listener for cloud commands (FORCE_UPDATE, KILL_SWITCH, etc.)
7. **Backups** — Daily `pg_dump` at 4 AM, 7-day retention

### Two Station Roles
| Role | What's Installed |
|------|-----------------|
| **Server** | PostgreSQL + Node.js POS + Chromium kiosk + heartbeat + sync agent + backups |
| **Terminal** | Chromium kiosk only (points to server IP) + optional RealVNC |

### Kiosk Exit Zone
Hidden 64×64px div in top-left corner of every page. Tap 5 times in 3 seconds → calls `POST /api/system/exit-kiosk` → stops kiosk service + kills Chromium. No auth required (intentional — admin must be able to exit without PIN).

**Key files:** `public/installer.run`, `src/components/KioskExitZone.tsx`, `src/app/api/system/exit-kiosk/route.ts`
**Skill docs:** Skills 345 (Installer), 346 (Kiosk Exit), 347 (Heartbeat IP + Auto-Provisioning)

## Troubleshooting

```bash
npm run reset          # Reset entire database (DESTRUCTIVE)
npm run db:studio      # Check database in browser
npx prisma generate    # Regenerate Prisma client
npx tsc --noEmit       # Check types
```

If port 3000 is in use, dev server auto-selects another port (usually 3001).

## Upcoming Work

> **See:** `/docs/guides/PM-TASK-BOARD.md` for the cross-domain task board with granular tasks.

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

## Living Log (MANDATORY)

**Location:** `/docs/logs/LIVING-LOG.md`

**RULE: Update the Living Log at the end of every work session.** Add a new entry at the top with:
1. Date + Sprint/Theme name
2. Session summary (1-2 sentences)
3. Commits per repo (hash + description)
4. Deployments (what was deployed where)
5. Features delivered (user-facing changes)
6. Bug fixes (table format)
7. Resolved task board items (if any)
8. Known issues / blockers

This is the team-shared record of all development work. Newest entries go at the top.

## Recent Changes

All change history is maintained in the Living Log and domain changelogs:
- **Living Log:** `/docs/logs/LIVING-LOG.md` (rolling session-by-session record)
- **Domain changelogs:** `/docs/changelogs/[DOMAIN]-CHANGELOG.md`
- **Skill docs:** `/docs/skills/` (indexed in `/docs/skills/SKILLS-INDEX.md`)

Key recent work: NUC installer package (Skill 345), kiosk exit zone (Skill 346), heartbeat IP + auto-provisioning (Skill 347), performance overhaul — 6 phases (Skills 339-344), multi-tenant DB routing (Skill 337), cloud session validation (Skill 338), combine features fully removed (Skill 326), seat management fixes (Skill 328), cash rounding pipeline (Skill 327).

## Pre-Launch Test Checklist

**Moved to:** `/docs/planning/PRE-LAUNCH-CHECKLIST.md`

22 test categories, 200+ individual tests. Must all pass before go-live. Updated during every PM EOD session.

## PM Mode & Worker Prompts

**Moved to:** `/docs/guides/PM-MODE-GUIDE.md`

Contains: PM Mode triggers (Classic, Single Agent, Agent Team), worker prompt templates, domain registry (25 domains), layer separation rules, morning startup protocol, EOD protocol, quality control guidelines.

**Quick reference triggers:**
- `PM Mode: [Domain]` — Classic PM mode
- `PM Mode: [Domain] (Single Agent)` — Single agent PM
- `PM Mode: [Domain] (Agent Team)` — Multi-agent PM team
- `EOD: [Domain]` — End of day protocol
