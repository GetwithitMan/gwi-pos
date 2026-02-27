# Go-Live & Launch Readiness -- Changelog

## 2026-02-26 — Rebrand pulse-pos → thepasspos (`ab89ccb`)
- **13 files updated**: CLAUDE.md, INSTALL.txt, architecture docs (2), deployment spec, pilot checklist, skill docs (6), installer.run
- **DB name**: `pulse_pos` → `thepasspos`
- **Systemd services**: `pulse-pos` → `thepasspos`, `pulse-kiosk` → `thepasspos-kiosk`, `pulse-sync` → `thepasspos-sync`
- **All docs, examples, and troubleshooting commands** updated to new names
- **PWA icons**: Added `icon-192.png` and `icon-512.png` to `/public/`
- **Dev memory**: `NODE_OPTIONS='--max-old-space-size=8192'` added to dev script

---

## 2026-02-25 — Deployment Pipeline: Vercel Enum Casts + NUC Fleet Deployment (Skill 447)

### Vercel Build Fix
- `vercel-build.js` — Added pre-flight SQL enum casts for 3 columns (`Payment.paymentMethod`, `TipLedgerEntry.type`, `TipTransaction.sourceType`). Creates enum types and uses `ALTER COLUMN TYPE USING` cast before `prisma db push`.
- `prisma/schema.prisma` — Added ~50 forward `@relation` annotations and 17 reverse relation fields (MenuItem 5, Order 10, Terminal 1, TimeClockEntry 1). Required by Prisma's bidirectional relation validation.

### NUC Fleet Deployment Fix (Fruita Grill)
- `nuc-pre-migrate.js` — Comprehensive pre-flight migrations: column additions, orphaned FK cleanup (Payment→Terminal/Drawer/Shift/PaymentReader/Employee), updatedAt backfills (5 tables), order deduplication + partial unique index, Int→Decimal (7 tip fields), String→Enum (3 casts).
- `sync-agent.js` — Fixed service name resolution (`thepasspos` first, fallback to `pulse-pos`). Added missing command handlers: `RE_PROVISION`, `RELOAD_TERMINALS`, `RELOAD_TERMINAL`, `RESTART_KIOSK`.
- **Deployment verified** end-to-end via FORCE_UPDATE from Mission Control.

### Critical Pattern: Adding New Migrations
When schema changes would fail `prisma db push` on tables with data:
1. Add migration to BOTH `scripts/nuc-pre-migrate.js` AND `scripts/vercel-build.js`
2. nuc-pre-migrate uses `prisma.$executeRawUnsafe()` (PrismaClient)
3. vercel-build uses `sql\`...\`` (@neondatabase/serverless tagged templates)
4. Both must be idempotent — check before acting

---

## 2026-02-23 — Bugfix Sprint C+D: Multi-Tenant Hardening & Cascade Safety

### 8 locationId Bypass Routes Hardened
Routes that previously allowed requests without locationId validation are now enforced:
- `employees/[id]` — Employee lookups scoped to location
- `inventory/stock-adjust` — Stock adjustments require locationId
- `integrations/test` — Integration tests scoped to location
- `categories/[id]` — Category lookups scoped to location
- `upload` — File uploads scoped to location
- `inventory/transactions` — Inventory transaction queries require locationId
- `tickets` — Ticket operations scoped to location
- `monitoring/errors` — Error logs scoped to location

### 5 Cascade onDelete Rules Changed to Restrict
Prevents accidental data loss when parent records are deleted:
- `OrderItem` — onDelete changed from Cascade to Restrict
- `OrderCard` — onDelete changed from Cascade to Restrict
- `OrderItemModifier` — onDelete changed from Cascade to Restrict
- `OrderItemIngredient` — onDelete changed from Cascade to Restrict
- `OrderItemPizza` — onDelete changed from Cascade to Restrict

---

## 2026-02-23 — Bugfix Sprint A+B: Multi-Tenant Isolation (B1-B5)

### Location Cache Isolation (B1)
- Location cache was a singleton — all venues shared the same cached data
- Fix: Cache keyed by venue slug, each venue gets its own cache entry (`location-cache.ts`)

### CloudEventQueue Scoping (B2)
- CloudEventQueue had no locationId — events from all locations mixed together, cleanup was global
- Fix: locationId field added to CloudEventQueue model and event creation, cleanup scoped per location (`schema.prisma`, `cloud-event-queue.ts`)

### Schema locationId Gaps (B3)
- ModifierTemplate and OrderOwnershipEntry lacked locationId and deletedAt fields
- Fix: Both models now include locationId (with index) and deletedAt for soft delete support (`schema.prisma`)

### Menu Route Hardening (B4)
- Menu GET routes accepted requests without locationId, returning cross-venue data
- Fix: locationId is now required — requests without it return 400 (`menu/items/route.ts`, `menu/items/[id]/route.ts`)

### Socket Room Validation (B5)
- Socket room subscriptions were not validated against the authenticated user's locationId
- Fix: Room join requests validated — users can only subscribe to rooms matching their authenticated locationId (`socket-server.ts`)

---

## Session: 2026-02-09

### Domain Created
- Created Go-Live domain (Domain 23)
- Trigger: `PM Mode: Go-Live`
- Created `/docs/domains/GO-LIVE-DOMAIN.md` -- comprehensive domain doc
- Created `/docs/skills/239-GO-LIVE-LAUNCH-READINESS.md` -- skill doc
- Updated SKILLS-INDEX.md with Skill 246 entry
- Updated CLAUDE.md Domain Registry with Domain 23
- Documented three location modes: Development, Training, Production

### Known Simulated/Dev Items to Clean
- `src/lib/datacap/simulated-defaults.ts` -- SIMULATED_DEFAULTS for merchantId/operatorId
- `PaymentReader.communicationMode = 'simulated'` in dev DB
- `settings.payments.processor = 'simulated'` in dev DB
- Demo credentials: PIN 1234 (Manager), 2345 (Server), 3456 (Bartender)
- Debug console.logs throughout codebase
- Dev-only routes: `/rnd/*`, `/test-floorplan`

### Files Created
- `/docs/domains/GO-LIVE-DOMAIN.md`
- `/docs/changelogs/GO-LIVE-CHANGELOG.md`
- `/docs/skills/239-GO-LIVE-LAUNCH-READINESS.md`

### Files Modified
- `/docs/skills/SKILLS-INDEX.md` -- added Skill 246
- `/CLAUDE.md` -- added Domain 23 to registry + domain section

---

## 2026-02-10 — Browser Compatibility Requirement Added

### Discovery
KDS device (Chrome 108 on Android 10) showed white screen due to Tailwind v4 `oklch()` color incompatibility. Fix applied via PostCSS transpilation plugin.

### Go-Live Implication
**Browser minimum floor is now Chrome 108** (not Chrome 111 as Tailwind v4 assumes).

Add to go-live hardware verification checklist:
- [ ] Verify Chrome version on all KDS devices (must be >= 108)
- [ ] Verify `postcss.config.mjs` includes `@csstools/postcss-oklab-function` plugin
- [ ] Test KDS pair flow on actual hardware devices
- [ ] Consider whether to recommend Chrome updates on KDS devices for better performance

### Known Simulated/Dev Items to Clean (Updated)
- `src/lib/datacap/simulated-defaults.ts` — SIMULATED_DEFAULTS
- `PaymentReader.communicationMode = 'simulated'` in dev DB
- `settings.payments.processor = 'simulated'` in dev DB
- Demo credentials: PIN 1234 (Manager), 2345 (Server), 3456 (Bartender)
- Debug console.logs throughout codebase
- Dev-only routes: `/rnd/*`, `/test-floorplan`

---

### Resume
1. Say: `PM Mode: Go-Live`
2. Review this changelog
3. Build training mode infrastructure (schema + UI)
4. Build go-live verification CLI tool (`scripts/go-live-check.ts`)
5. Create search-and-cleanup scripts for simulated code removal
