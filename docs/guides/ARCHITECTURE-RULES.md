# GWI POS — Architecture Rules

> Reference doc for AI agents and developers working on the GWI POS codebase.
> Violations of these rules are **bugs**, not style preferences.

---

## System Architecture

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

---

## NUC Rules — All Terminals Point to the NUC

Every POS terminal, kiosk, SmartTab, and browser **MUST** connect to the local NUC server.
**NEVER** connect to Vercel or cloud URLs from a POS terminal.

| Client | URL |
|--------|-----|
| NUC kiosk (localhost) | `http://localhost:3005` |
| Terminal / SmartTab | `http://{NUC_IP}:3005` |
| Phone / iPad | `http://{NUC_IP}:3005` |

**Vercel URLs** are for online ordering and cloud admin **ONLY** — no WebSocket, no local hardware.

---

## Offline-First Rules (MANDATORY)

### 7 NEVER Rules

1. **NEVER** write code that queries Neon directly from a POS API route — all `db.*` calls go to local PG.
2. **NEVER** make POS startup, login, order creation, or payment depend on cloud connectivity.
3. **NEVER** set `DATABASE_URL` on a NUC to a `neon.tech` URL — that destroys offline capability.
4. The `neonClient` (`src/lib/neon-client.ts`) is **sync-only** — used exclusively by background sync workers, `hardware-command-worker`, and `online-order-worker`.
5. All new sync work uses `syncedAt` + `updatedAt` delta queries — **never** full-table replications.
6. **Clock discipline:** All business writes MUST use DB-generated `NOW()` (Prisma `@default(now())` / `@updatedAt`). NEVER accept a client-supplied timestamp for `createdAt`, `updatedAt`, or `syncedAt`.
7. If you see a NUC with `DATABASE_URL=neon.tech` — that is a **critical bug**, file it immediately.

### Cloud-Primary Sync Safety Rules (added 2026-03-10)

These rules were discovered via penetration testing and prevent data loss, duplication, and sync corruption.

1. **HWM only advances on success** — downstream sync high-water mark (`maxSyncedAt`) must only include successfully upserted rows. Failed rows (constraint violations, FK errors) must retry on the next cycle. Never advance HWM past a failed row.
2. **lastMutatedBy on every NUC mutation** — every `db.payment.update()`, `db.order.update()`, or raw SQL UPDATE to a bidirectional model (Order, OrderItem, Payment, OrderDiscount, OrderCard, OrderItemModifier) MUST set `lastMutatedBy: 'local'` (or the terminal ID). Without this, upstream sync skips the row and changes are lost.
3. **FulfillmentEvent dedup by orderId** — before creating FulfillmentEvents in downstream sync (`handleCloudFulfillment`), always check if events already exist for that orderId. send/route.ts may have already created them.
4. **ON CONFLICT for idempotency, not SELECT-before-INSERT** — never use a SELECT check followed by INSERT for dedup. Use `INSERT ... ON CONFLICT DO NOTHING` as the sole guard to eliminate TOCTOU race conditions.
5. **One socket event per location per sync cycle** — downstream sync must batch socket dispatches. Emit at most one `dispatchOpenOrdersChanged` per locationId per cycle, not per row.
6. **Upstream syncedAt stamps are individually resilient** — if one row's syncedAt stamp fails, continue stamping other rows. A single failure must not block the entire batch.
7. **Outage queue requires metadata column** — OutageQueueEntry.metadata (JSONB) tracks retryCount for dead-letter logic. Without it, failed entries loop forever.

---

## Source of Truth — Cloud-Primary Hybrid Model

> **INV-12:** Neon is the canonical source of record (SOR) in normal operation.
> The NUC is the local execution layer — not a peer database.

### Rules

1. **Neon is the canonical SOR in normal operation (INV-12).** All cloud-owned models are authoritative in Neon.
2. **NUC is the local execution layer** — handles all POS operations with sub-10ms latency. It is NOT a separate source of truth.
3. **NUC temporarily becomes write authority during internet outages.** Writes queue in `OutageQueueEntry` for FIFO replay on reconnect.
4. **Outage recovery:** FIFO replay with neon-wins conflict resolution. No manual merge required.
5. **Cloud-owned models can be fully re-synced from Neon.** A NUC can be rebuilt from zero using downstream sync alone.
6. **NUC-owned operational models must NOT be overwritten by downstream sync.** These flow upstream only.
7. **Bidirectional models use `lastMutatedBy` column** to filter sync direction. Every NUC mutation to a bidirectional model MUST set `lastMutatedBy: 'local'`.

### Source of Truth by Model

| Category | Models | Owner | Sync Direction | Notes |
|----------|--------|-------|---------------|-------|
| **Org & Venue** | Organization, Location | Cloud | Neon → NUC | Provisioned in Mission Control |
| **Staff** | Role, EmployeeRole, Employee | Cloud | Neon → NUC | Managed in MC or admin settings |
| **Menu** | Category, MenuItem, ModifierGroup, Modifier, ComboTemplate, ComboComponent, ComboComponentOption, ModifierGroupTemplate, ModifierTemplate, ModifierInventoryLink | Cloud | Neon → NUC | Menu builder writes to Neon; NUC receives via downstream sync |
| **Floor Plan** | Table, Section, SectionAssignment, FloorPlanElement | Cloud | Neon → NUC | Layout managed in admin |
| **Order Types & Config** | OrderType, CourseConfig, PricingOptionGroup, PricingOption, PricingOptionInventoryLink | Cloud | Neon → NUC | |
| **Hardware** | Printer, PrintRoute, PrintRule, KDSScreen, KDSScreenStation, Terminal, PaymentReader, Scale, Station, BergDevice, BergPluMapping | Cloud | Neon → NUC | Hardware config from admin/MC |
| **Tax & Pricing** | TaxRule, PricingOptionGroup, PricingOption | Cloud | Neon → NUC | |
| **Customers & Loyalty** | Customer, Coupon, DiscountRule, GiftCard, HouseAccount | Cloud | Neon → NUC | |
| **Vendors & Inventory Config** | Vendor, InventoryItem, InventoryItemStorage, Ingredient, IngredientCategory, MenuItemRecipe, ItemBarcode, StorageLocation, PrepItem, PrepItemIngredient, InventorySettings | Cloud | Neon → NUC | Catalog and recipe definitions |
| **Prep & Kitchen Config** | PrepStation, PrepTrayConfig | Cloud | Neon → NUC | |
| **Scheduling** | Schedule, ScheduledShift | Cloud | Neon → NUC | |
| **Events & Reservations** | Event, EventPricingTier, EventTableConfig, Reservation | Cloud | Neon → NUC | |
| **Reasons & Preferences** | VoidReason, CompReason, ReasonAccess, QuickBarPreference, QuickBarDefault | Cloud | Neon → NUC | |
| **Invoices** | Invoice, InvoiceLineItem | Cloud | Neon → NUC | |
| **Miscellaneous Cloud** | CfdSettings, EntertainmentWaitlist | Cloud | Neon → NUC | |
| **Orders & Line Items** | Order, OrderItem, OrderDiscount, OrderCard, OrderItemModifier | Bidirectional | Both (neon-wins) | `lastMutatedBy` determines sync direction; conflict resolution favors Neon |
| **Payments** | Payment | Bidirectional | Both (neon-wins) | `lastMutatedBy` required on every NUC write |
| **Bottle & Spirit** | BottleProduct, SpiritCategory, SpiritModifierGroup | Bidirectional | Both (neon-wins) | |
| **Cake Orders** | CakeOrder, CakeQuote | Bidirectional | Both (neon-wins) | |
| **Order Events & Snapshots** | OrderEvent, OrderSnapshot, OrderItemSnapshot, Seat | NUC | NUC → Neon | Event-sourced, append-only |
| **Order Details** | OrderItemIngredient, OrderItemPizza, OrderOwnership, OrderOwnershipEntry, Ticket, OrderItemDiscount, RefundLog | NUC | NUC → Neon | |
| **Shifts & Time** | Shift, Drawer, TimeClockEntry, Break | NUC | NUC → Neon | |
| **Tips** | TipLedger, TipLedgerEntry, TipTransaction, TipDebt, CashTipDeclaration, TipShare, TipOutRule, TipPool, TipGroupTemplate, TipGroup, TipGroupMembership, TipGroupSegment, TipAdjustment | NUC | NUC → Neon | Tip ledger is immutable once written |
| **Payroll** | PayrollPeriod, PayStub, PayrollSettings, PendingDeduction, DeductionRun | NUC | NUC → Neon | |
| **Inventory Transactions** | InventoryItemTransaction, InventoryTransaction, StockAlert, InventoryCount, InventoryCountItem, InventoryCountEntry, WasteLog, WasteLogEntry, RecipeIngredient, MenuItemRecipeIngredient, MenuItemIngredient, IngredientSwapGroup, IngredientStockAdjustment, IngredientRecipe, IngredientCostHistory, VendorOrder, VendorOrderLineItem, MarginEdgeProductMapping | NUC | NUC → Neon | |
| **Print & Audit** | PrintJob, VoidLog, AuditLog, ErrorLog | NUC | NUC → Neon | |
| **Gift Card & House Acct Txns** | GiftCardTransaction, HouseAccountTransaction, CouponRedemption | NUC | NUC → Neon | |
| **Pizza Config** | PizzaConfig, PizzaSize, PizzaCrust, PizzaSauce, PizzaCheese, PizzaTopping, PizzaSpecialty | NUC | NUC → Neon | |
| **Cash & Finance** | PaidInOut | NUC | NUC → Neon | |
| **Prep Counts** | DailyPrepCount, DailyPrepCountItem, DailyPrepCountTransaction | NUC | NUC → Neon | |
| **Digital Receipts** | DigitalReceipt | NUC | NUC → Neon | |
| **Berg & Spirits** | BergDispenseEvent, SpiritUpsellEvent | NUC | NUC → Neon | |
| **Remote Approvals** | RemoteVoidApproval | NUC | NUC → Neon | |
| **Sessions & Profiles** | TimedSession, CardProfile, WalkoutRetry | NUC | NUC → Neon | |
| **Device & Payment Logs** | PaymentReaderLog, ChargebackCase, PmsChargeAttempt | NUC | NUC → Neon | |
| **Scheduling (NUC)** | ShiftSwapRequest | NUC | NUC → Neon | |
| **Bottle & Cake (NUC)** | BottleServiceTier, CakePayment, CakeOrderChange | NUC | NUC → Neon | |
| **Venue & Integration Logs** | VenueLog, SevenShiftsDailySalesPush | NUC | NUC → Neon | |
| **Local-Only (not synced)** | RegisteredDevice, MobileSession, ServerRegistrationToken, HardwareCommand, CloudEventQueue, SyncAuditEntry, HealthCheck, FulfillmentEvent, BridgeCheckpoint, OutageQueueEntry, SocketEventLog | Local | None | Ephemeral or NUC-specific operational state |

---

## Four Repos

| | GWI POS | GWI Android Register | GWI Mission Control | GWI Backoffice |
|---|---------|---------------------|---------------------|----------------|
| **Repo** | `gwi-pos` | `gwi-android-register` | `gwi-mission-control` | `gwi-backoffice` |
| **Local path** | `.../GWI-POS FULL/gwi-pos` | `.../GWI-POS FULL/gwi-android-register` | `.../GWI-POS FULL/gwi-mission-control` | `.../GWI-POS FULL/gwi-backoffice` |
| **Platform** | Next.js (NUC + Vercel) | Kotlin / Jetpack Compose (Android) | Next.js (Vercel) | Java 25 + Spring Boot |
| **Purpose** | POS server + web UI | Native Android POS client | Fleet management, billing | Event ingestion, reporting |
| **Database** | Local PG 16 (NUC) + Neon (sync) | Room (SQLite, event-sourced orders) | Neon PostgreSQL | Neon PostgreSQL |
| **Auth** | Employee PIN login | Employee PIN via NUC API | Clerk B2B | HMAC-SHA256 |

### What Lives WHERE

| Feature / Concern | Repo |
|-------------------|------|
| POS API routes (`/api/*`) | `gwi-pos` |
| Socket.io server + event dispatch | `gwi-pos` (`src/lib/socket-dispatch.ts`) |
| Prisma schema + migrations | `gwi-pos` |
| Background sync workers | `gwi-pos` (`src/workers/`) |
| Native Android order/payment UI | `gwi-android-register` |
| Android Room schema + DAOs | `gwi-android-register` |
| Location onboarding / billing | `gwi-mission-control` |
| Fleet APK push / force-update | `gwi-mission-control` (MC socket) |
| Event ingestion from NUC | `gwi-backoffice` |
| Venue reporting / admin UI | `gwi-backoffice` |

### Repo Boundary NEVER-DO-THIS List

- **NEVER** import types or modules across repos — use shared API contracts (REST/Socket).
- **NEVER** run a Prisma migration from `gwi-android-register`, `gwi-mission-control`, or `gwi-backoffice`.
- **NEVER** add a Neon connection to `gwi-android-register` — Room (SQLite) only.
- **NEVER** place fleet-management or billing logic in `gwi-pos`.
- **NEVER** place NUC-specific hardware logic (VP3350, CAS scale, drawer kick) in `gwi-mission-control`.
- **NEVER** relay socket events client-side — all dispatches go through `socket-dispatch.ts` on the server.

---

## Database Rules

> **CRITICAL: Read `docs/guides/DATABASE-CONNECTION-RULES.md` before touching any database adapter code.**
> Vercel MUST use PrismaNeon (HTTP/WebSocket). NUC MUST use PrismaPg (TCP).
> `ws`, `@neondatabase/serverless`, `@prisma/adapter-neon` MUST be in `serverExternalPackages`.
> This was learned through 5 failed attempts — do not deviate.

### Environment Routing

| Environment | `DATABASE_URL` target |
|-------------|----------------------|
| NUC production | `postgresql://localhost:5432/...` |
| Local dev | Neon cloud (personal branch) |
| Vercel (cloud deploy) | Neon cloud |

### Environment Variables

**Dev / Vercel** (`.env.local` on your Mac):
```
DATABASE_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
DIRECT_URL="postgresql://...@neon.tech/gwi_pos?sslmode=require"
```

**NUC production** (`/opt/gwi-pos/app/.env`):
```
# PRIMARY — local PostgreSQL (offline-first)
DATABASE_URL="postgresql://thepasspos:xxx@localhost:5432/thepasspos"
DIRECT_URL="postgresql://thepasspos:xxx@localhost:5432/thepasspos"

# SYNC TARGET + CELLULAR INGRESS — Neon cloud (canonical cloud DB)
NEON_DATABASE_URL="postgresql://...@neon.tech/gwi_pos_{slug}?sslmode=require"
NEON_DIRECT_URL="postgresql://...@neon.tech/gwi_pos_{slug}?sslmode=require"
SYNC_ENABLED=true
SYNC_UPSTREAM_INTERVAL_MS=5000    # NUC → Neon every 5s
SYNC_DOWNSTREAM_INTERVAL_MS=15000 # Neon → NUC every 15s
```

**If a NUC's `DATABASE_URL` points at `neon.tech` — that is a BUG. Fix it immediately.**

### Schema Convention for New Models

Every new Prisma model **MUST** include:

```prisma
model ExampleModel {
  id         String   @id @default(cuid())
  locationId String

  // ... business fields ...

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  deletedAt  DateTime?           // soft delete REQUIRED
  syncedAt   DateTime?           // sync tracking REQUIRED

  location   Location @relation(fields: [locationId], references: [id])

  @@index([locationId])          // REQUIRED
  @@index([locationId, deletedAt])
  @@index([locationId, syncedAt])
}
```

### Production Rules

| Action | NUC Production | Vercel / Cloud |
|--------|---------------|----------------|
| `npm run reset` / `prisma migrate reset` | **FORBIDDEN — EXTREME RISK** | **FORBIDDEN** |
| `prisma db push` | **FORBIDDEN** (destroys enum casts) | Allowed in CI only |
| `prisma migrate deploy` | Allowed via `nuc-pre-migrate.js` | Allowed |
| Manual `ALTER TABLE` | Only via migration files | Never |
| Hard delete rows | **NEVER** — use `deletedAt` | **NEVER** |

**Before any schema migration on a NUC:** `pg_dump` the database first.

### Adding New Migrations

New schema changes must be reflected in **both** migration scripts:

- `scripts/vercel-build.js` — pre-flight SQL for Neon (Vercel CI)
- `scripts/nuc-pre-migrate.js` — pre-flight SQL for local PG (NUC deploy)

Use idempotent checks (e.g., `DO $$ IF NOT EXISTS ... $$`) in all pre-flight SQL.

---

## Android-First Design Rule

The Android native app is the **PRIMARY** POS interface. Web/browser is secondary.

| Rule | Requirement |
|------|-------------|
| Touch targets | Minimum 48×48 dp |
| Interactions | No hover-dependent UI — all interactions must be tap-accessible |
| Response time | Sub-50 ms for all POS actions (tap → visible feedback) |
| Offline | All critical paths (login, order, payment) must work without cloud |
| Sync | Android Room is event-sourced — replay-safe, append-only order events |

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.5 | Framework with App Router |
| React | 19.2.3 | UI Library |
| TypeScript | 5.9.3 | Type Safety |
| Tailwind CSS | 4.x | Styling |
| Prisma | 6.19.2 | ORM |
| PostgreSQL 16 | Local (NUC) / Neon (cloud) | Primary DB |
| Socket.io | 4.x | Real-time events |
| Zustand | 5.x | State Management |
| Zod | 4.x | Validation |
| Kotlin / Compose | Latest stable | Android native POS |
| Room | 2.x | Android local DB (SQLite) |
| Java 25 + Spring Boot | 3.x | Backoffice API |
| Clerk | Latest | Mission Control auth (B2B) |

---

## Code Conventions

### Multi-Tenancy

- Always scope queries with `locationId` — use `getLocationId()` in API routes.
- Employee context: `employee?.location?.id` (never assume a single global tenant).

### State Management

- Zustand: use **atomic selectors only** — never destructure a store wholesale.
- Example: `const total = useOrderStore(s => s.total)` not `const { total } = useOrderStore()`.

### Error Handling

- Fire-and-forget: `void doWork().catch(console.error)`
- Auth guards: `requirePermission()` — never `{ soft: true }`.
- Never swallow errors silently in payment or sync paths.

### Shared UI Components

| Component | Path |
|-----------|------|
| Modal | `src/components/ui/modal.tsx` (props: `isOpen`, `onClose`, `title`, `size`, `variant`) |
| ConfirmDialog | `src/components/ui/confirm-dialog.tsx` |
| useAdminCRUD hook | `src/hooks/useAdminCRUD.ts` |

---

## Event Bridge (NUC → Backoffice)

- 17 event types, HMAC-SHA256 signed, fire-and-forget HTTP POST.
- Events are sourced from the NUC's local PG and sent to `api.ordercontrolcenter.com`.
- Android uses event-sourced Room DB — 17 matching event types replayed to reconstruct order state.
- Never rely on event delivery for NUC business logic — events are observability/reporting only.

---

*Last updated: 2026-03-18*
