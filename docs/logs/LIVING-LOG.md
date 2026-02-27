# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

---

## 2026-02-26 — Bartender Testing Bug Fixes + Mobile Tabs + Rebrand (Skills 450–453)

**Session:** Fixed 5 POS bugs from bartender testing (3 critical, 2 minor). Refactored mobile tabs page with open/closed views and pagination. Enriched sync delta for Android. Rebranded `pulse-pos` → `thepasspos` across all docs and installer. Added PWA icons and dev memory bump.

### Commits

**GWI POS** (`gwi-pos`):
- `a4ac377` — Fix 5 POS bugs from bartender testing
- `ab89ccb` — Rebrand pulse-pos → thepasspos across docs and installer
- `af58ee4` — Refactor mobile tabs page: open/closed views, filters, pagination
- `723f316` — Enrich sync delta response: payments, discounts, Decimal→Number
- `79dd23b` — Update schema.sql, increase dev memory limit, add PWA icons

### Deployments
- POS: pushed 5 commits to main, Vercel auto-deploy (production build `dpl_Gv613BZL88TxYnoyJ3DMhNM7nQLq`)

### Fixes (Skill 450 — Bartender Testing Bug Fixes)

| # | Severity | Bug | Root Cause | Fix |
|---|----------|-----|------------|-----|
| 1 | CRITICAL | Cash payment shows "Payment Complete" before server confirms | `setCashComplete(true)` triggers "Complete" screen on tendered ≥ total — before any API call | Renamed screen to "Change Due", button "Done" → "Complete Payment". Real confirmation is modal close after API success. |
| 2 | MINOR | 409 conflict after failed cash payment | On API failure, UI stays on "Payment Complete" screen — user confused, may retry or create new order | Reset `cashComplete=false` and `cashTendered=0` on both server error and network error paths |
| 3 | CRITICAL | Split orders leave parent table occupied | `parentTableId` extracted but never freed — table reset only checked `order.tableId` (child's, which is null) | Added parent table `status: 'available'` update after `parentWasMarkedPaid` socket dispatch, with cache invalidation |
| 4 | MODERATE | Payment buttons hidden on tablet (768×1024) | Items container `flex: 1` without `minHeight: 0` — flex child won't shrink below content, pushes footer off-screen | Added `minHeight: 0` to OrderPanel items container |
| 5 | MINOR | Shift start modal flashes on every page reload | All shift state is pure `useState` — lost on reload, bootstrap re-check re-triggers modal | Persisted `currentShift` and `shiftChecked` in `sessionStorage`. Mount reads cached values. Clearing shift clears storage. |

### Other Changes

- **Skill 451 (Mobile Tabs Refactor):** Replaced MobileTabCard with MobileOrderCard. Added open/closed view toggle, age filters (all/today/previous/declined), owner filter, closed date presets, cursor-based pagination, debounced socket refresh.
- **Skill 452 (Sync Delta Enrichment):** Delta endpoint now filters to active order statuses only, includes payments and itemDiscounts, converts all Decimal fields to Number, adds computed `paidAmount`.
- **Skill 453 (Rebrand + Infra):** `pulse-pos`/`pulse-kiosk` → `thepasspos`/`thepasspos-kiosk` across 13 docs/config files. Regenerated schema.sql. Dev memory limit bumped to 8GB. Added PWA icons (192px, 512px).

### Known Issues / Blockers
- None

---

## 2026-02-26 — NUC Sync Hardening: Fruita Grill Live Deployment (Skill 449)

**Session:** Fixed 3 critical NUC sync bugs discovered during Fruita Grill live deployment. Timezone conversion silently shifted all synced timestamps by -7 hours (breaking terminal pairing). PgBouncer cached plan errors from SELECT * queries. OnlineOrderWorker 401 spam from missing env var. All fixes deployed to NUC via MC FORCE_UPDATE — full cloud-to-Android pairing flow verified working.

### Commits

**GWI POS** (`gwi-pos`):
- `626beaa` — fix: eliminate PgBouncer cached plan errors + silence OnlineOrderWorker 401 spam
- `78dbc7c` — fix: timestamp timezone conversion bug in downstream sync + online order worker

### Deployments
- POS: pushed to main, Vercel auto-deploy
- NUC (Fruita Grill): deployed via MC FORCE_UPDATE — verified running latest code

### Fixes

| # | Severity | Bug | Root Cause | Fix |
|---|----------|-----|------------|-----|
| 1 | CRITICAL | All synced timestamps shifted -7h on NUC | `buildCast()` used `::timestamptz` for `timestamp without time zone` columns; NUC PG timezone=America/Denver converted UTC→MST | Split cast: `timestamptz` for tz columns, `::timestamp` for non-tz. Set NUC PG timezone=UTC. |
| 2 | HIGH | "cached plan must not change result type" errors | `SELECT *` queries on Neon via PgBouncer; prepared statement cache holds old column list after schema changes | Replaced all `SELECT *` with explicit column lists from `information_schema.columns` cache |
| 3 | MEDIUM | OnlineOrderWorker 401 every 15 seconds | `PROVISION_API_KEY` not set on NUC; worker sent empty `x-api-key` header | Early return guard when env var missing |

### Infrastructure Changes (Fruita Grill NUC)
- `ALTER DATABASE pulse_pos SET timezone = 'UTC'` — permanent timezone fix
- Installer updated to set UTC timezone on all future NUC provisions

### Key Technical Details

- **Timezone bug chain:** Neon stores `2026-02-26T21:33:00Z` → downstream sync inserts with `::timestamptz` → NUC PG (timezone=MST) converts to `14:33:00` and stores in `timestamp without time zone` column → Prisma reads `14:33:00` as UTC → thinks it's 7 hours in the past → pairing code "expired"
- **PgBouncer fix applies to both workers:** `downstream-sync-worker.ts` uses `columnCache` from `loadColumnMetadata()`. `online-order-worker.ts` uses new `getColumnNames()` with `columnNameCache` Map.
- **Belt-and-suspenders:** Both code fix (correct casts) AND infrastructure fix (UTC timezone) applied. Either alone is sufficient, both together prevent recurrence.

### End-to-End Verification
1. Generated pairing code from cloud admin (fruita-grill.ordercontrolcenter.com)
2. Downstream sync pulled code to NUC local PG (~15s)
3. Android app entered code → paired successfully ✅
4. NUC logs clean — no sync errors, no 401 spam

### Known Issues / Blockers
- None — all three bugs resolved and verified in production

---

## 2026-02-26 — Codebase Architecture Audit Fixes (Skill 448)

**Session:** Fixed 15 findings from full codebase architecture audit. 5 parallel agents: auth hardening, schema sync fields, N+1/fire-and-forget fixes, cache bypass elimination, hard delete/UI/socket improvements. All POS-repo issues resolved; Android deferred.

### Commits

**GWI POS** (`gwi-pos`):
- `6755272` — fix: codebase architecture audit — 15 findings across auth, schema, perf, UX, data integrity

### Deployments
- POS: pushed to main, Vercel auto-deploy

### Fixes by Category

| # | Category | Fix | Files |
|---|----------|-----|-------|
| 1 | Auth (CRITICAL) | MC fetch crash guard — login works offline | venue-login/route.ts |
| 2 | Auth (MEDIUM) | Remove hardcoded MC URL fallback | venue-login/route.ts |
| 3 | Perf (HIGH) | N+1 orderItem.update() → batched $transaction | send/route.ts |
| 4 | Perf (HIGH) | N+1 auditLog.create() → createMany | expo/route.ts |
| 5 | Perf (HIGH) | orders/route.ts → getLocationSettings() cache | orders/route.ts |
| 6 | Perf (HIGH) | orders/route.ts menu queries → cache audit (tax rules left, not cached) | orders/route.ts |
| 7 | Data (HIGH) | seat.delete() → soft delete (3 locations) | seating/route.ts, cleanup-temp-seats.ts |
| 8 | Perf (HIGH) | Pay route: entertainment reset + table update → fire-and-forget | pay/route.ts |
| 10 | UX (MEDIUM) | 48px touch targets on daily-counts + quick-adjust buttons | daily-counts/page.tsx, quick-adjust/page.tsx |
| 11 | Socket (HIGH) | OpenOrdersPanel: debounced refresh replaces full refetch per event | OpenOrdersPanel.tsx |
| 12 | Socket (HIGH) | useOrderBootstrap: local count inc/dec instead of API call per event | useOrderBootstrap.ts |
| 13 | Perf (MEDIUM) | Dashboard 60s polling: skip when socket connected | dashboard/page.tsx |
| 14 | Perf (MEDIUM) | Missing `void` prefix on 14 fire-and-forget calls across 3 files | send, expo, pay routes |
| 21 | Perf (MEDIUM) | Cache audit: 2 settings routes switched to location cache | tips/route.ts, online-ordering/route.ts |
| Schema | Data (CRITICAL) | deletedAt + syncedAt on all 147 models, Order.source added | schema.prisma |

### Key Technical Details

- **Auth offline resilience:** MC fetch wrapped in try/catch; missing MISSION_CONTROL_URL skips MC entirely (no hardcoded fallback). Login always falls through to local employee lookup.
- **Schema completeness:** Every model now has `deletedAt DateTime?` + `syncedAt DateTime?`. Added `source String?` to Order for online ordering attribution.
- **Fire-and-forget audit:** 14 calls across send/expo/pay routes were missing `void` prefix — socket dispatches, print calls, audit logs, inventory deductions all now properly non-blocking.
- **Cache utilization:** 3 routes switched from direct DB queries to existing caches (location-cache.ts 5min TTL, menu-cache.ts 60s TTL). 14 other routes audited — already cached or need data not in caches.
- **Socket efficiency:** OpenOrdersPanel uses 300ms debounced refresh instead of immediate full refetch. useOrderBootstrap uses local count updates (increment/decrement) instead of API calls. Dashboard polling guarded by socket connection state.

### Known Issues / Blockers
- Prisma migration not created (no DB connection during dev). Schema changes validated via `npx prisma validate` + `npx prisma generate`. Migration will run on next deploy.

---

## 2026-02-25 — Forensic Audit Deferred Items: Schema Overhaul + UI Decomposition (Complete)

**Session:** Completed all 14 deferred items from the 141-issue forensic audit. 7 schema hardening items (sequential, all touch schema.prisma) and 3 monolithic UI decompositions (parallel). This closes out the entire audit — 141/141 issues resolved.

### Commits

**GWI POS** (`gwi-pos`):
- `1c7e216` — Schema: Add updatedAt @updatedAt to 12 models (C-SCHEMA-2)
- `d4d821a` — Schema: sharePercent Float→Decimal(6,2) + Number() at read boundaries (C-SCHEMA-4)
- `e71acbb` — Schema: Fix CloudEventQueue gaps — status, maxAttempts, lastError, deletedAt, syncedAt (C-SCHEMA-5)
- `89fd542` — fix: pre-push migrations for updatedAt, order number uniqueness, prisma config cleanup
- `8fd5cbb` — fix: partial unique index for orderNumber + orders/page.tsx refactor (3,838→1,278 lines)
- `6dfd6b8` — fix: safe dedup formula + add extracted orders page hooks/components
- `e329739` — Schema: Convert 60+ String fields to Prisma enums (H-SCHEMA-2) — 36 files, 62 enum types
- `cfbbbc5` — Schema: Convert 7 tip Int fields to Decimal(10,2) (H-SCHEMA-3) — 19 files
- `8092675` — Schema: Add 45 @relation declarations to bare FK fields (C-SCHEMA-1)
- `75e6021` — UI refactor: Decompose menu/page.tsx + IngredientLibrary.tsx (H-REACT-5) — 17 files

### Deployments
- POS: all commits pushed to main, Vercel auto-deploy

### Schema Lane — 7 Items

| # | Audit ID | Description | Commit | Impact |
|---|----------|-------------|--------|--------|
| 1 | C-SCHEMA-2 | Add `updatedAt @updatedAt` to 12 models | `1c7e216` | 12 models now track modification time |
| 2 | C-SCHEMA-4 | `sharePercent` Float→Decimal(6,2) | `d4d821a` | Eliminates floating-point rounding in tip share calculations |
| 3 | C-SCHEMA-5 | CloudEventQueue: status machine, lifecycle fields | `e71acbb` | Status-based processing, soft-delete, retry tracking |
| 4 | C-SCHEMA-3 | orderNumber @@unique (partial index) | `89fd542`→`8fd5cbb` | DB-enforced uniqueness on root orders; split orders exempt |
| 5 | H-SCHEMA-2 | 60+ String→Enum conversions | `e329739` | 62 enum types, DB-level value validation, TS type safety |
| 6 | H-SCHEMA-3 | Tip Int→Decimal(10,2) | `cfbbbc5` | 7 tip fields: cent-precision → dollar-precision with Number() boundaries |
| 7 | C-SCHEMA-1 | 45 bare FKs→@relation | `8092675` | Referential integrity, typed relation accessors on 25+ models |

### UI Refactor Lane — 3 Monolithic Components

| Component | Before | After | Reduction | Extracted |
|-----------|--------|-------|-----------|-----------|
| orders/page.tsx | 3,838 | 1,278 | 67% | 4 hooks + 1 component + types |
| menu/page.tsx | 1,166 | 220 | 81% | 1 hook + 3 components + types |
| IngredientLibrary.tsx | 1,466 | 250 | 83% | 4 hooks + 3 components + types |
| **Total** | **6,470** | **1,748** | **73%** | **9 hooks, 7 components, 3 type files** |

### Key Technical Details

- **Partial unique index pattern:** `@@unique([locationId, orderNumber])` replaced with raw SQL `CREATE UNIQUE INDEX ... WHERE "parentOrderId" IS NULL` — split orders share parent's orderNumber by design
- **Enum migration strategy:** vercel-build.js pre-push migrations create enum types and ALTER COLUMN with USING cast before `prisma db push` runs. Idempotent — safe on repeated deploys.
- **Tip Decimal migration:** Int→Decimal(10,2) with `isIntegerColumn()` guard in vercel-build.js; 19 files updated with `Number()` at read boundaries
- **TypeScript errors:** 408 → 3 (remaining 3 are pre-existing JsonValue issues in one-time migration script)

### Forensic Audit — Final Tally

| Phase | Severity | Issues | Commit |
|-------|----------|--------|--------|
| 1 | CRITICAL | 9 fixed | `9d3268c` |
| 2 | HIGH | 30 fixed | `5c4f3e5` |
| 3 | MEDIUM | 40 fixed | `d42437f` |
| 4 | LOW | 35 fixed | `bc208c1` |
| Deferred | Schema + UI | 14 fixed | `1c7e216`→`75e6021` |
| **Total** | | **141/141** | **Audit complete** |

### Known Issues / Blockers
- None. Full audit remediation is complete.
- 3 pre-existing TS errors in `scripts/copy-menu-to-venue.ts` (JsonValue type mismatch — non-blocking, one-time script)

---

## 2026-02-25 — Deployment Pipeline: Vercel Enum Casts + NUC Fleet Deployment Fix (Skill 447)

**Session:** Vercel deployment blocked by 3 String→Enum column casts. Fixed with pre-flight SQL in `vercel-build.js`. Then added ~50 @relation annotations + 17 missing reverse relations. Then investigated NUC fleet deployment failure (Fruita Grill) — found 3 root causes: incomplete `nuc-pre-migrate.js`, wrong systemd service name in sync agent, missing command handlers. Built comprehensive NUC pre-migration system mirroring vercel-build.js, fixed sync agent, and added orphaned FK cleanup. Full deploy cycle now works end-to-end.

### Commits

**GWI POS** (`gwi-pos`):
- `c554d09` — fix: pre-flight enum casts in vercel-build to unblock db push (3 enum type conversions)
- `e851c83` — schema: add missing Prisma relation annotations (C-SCHEMA-1) (~50 forward relations)
- `96982b6` — fix: add 17 missing reverse relations to MenuItem, Order, Terminal, TimeClockEntry
- `fa4c803` — fix: NUC deployment — pre-migrate, service names, command handlers
- `5b28181` — fix: null orphaned Payment FK references before db push adds constraints

### Deployments
- POS Vercel: all commits pushed to main, auto-deploy
- `c554d09` — first successful Vercel deploy after enum fix
- `e851c83` — Vercel failed (17 missing reverse relations)
- `96982b6` — Vercel passed clean
- NUC Fruita Grill: FORCE_UPDATE deployed via MC after `fa4c803`+`5b28181`

### NUC Deployment Investigation (Skill 447)

**Root causes found via SSH logs on 172.16.1.254:**

| # | Issue | Symptom | Fix | Commit |
|---|-------|---------|-----|--------|
| 1 | `nuc-pre-migrate.js` incomplete | `prisma db push` fails: can't add updatedAt to cloud_event_queue (9 rows), can't cast paymentMethod text→enum | Added updatedAt backfills, Int→Decimal, enum casts, order dedup, partial unique index | `fa4c803` |
| 2 | Wrong service name in sync-agent.js | `systemctl restart pulse-pos` → "Unit not found" (actual: `thepasspos`) | Try `thepasspos` first, fallback to `pulse-pos` for legacy | `fa4c803` |
| 3 | Missing command handlers | RE_PROVISION, RELOAD_TERMINALS, RESTART_KIOSK → "Unknown command" | Added handlers: RE_PROVISION=full update, RELOAD_TERMINALS/RESTART_KIOSK=service restart | `fa4c803` |
| 4 | Orphaned Payment FK references | `prisma db push` → "violates foreign key constraint Payment_terminalId_fkey" | Pre-migrate nulls orphaned FK references before constraints added | `5b28181` |
| 5 | cloud_event_queue.updatedAt NULL spam | POS service error every 30s: P2032 "found incompatible value of null" | updatedAt backfill in nuc-pre-migrate.js | `fa4c803` |

### Deployment Flow (Now Working)

```
MC "Deploy" button → FORCE_UPDATE FleetCommand → NUC sync agent SSE
→ git fetch/reset → npm install → prisma generate
→ nuc-pre-migrate.js (backfills + enum casts + orphan cleanup)
→ prisma db push → npm run build → systemctl restart thepasspos
→ ACK COMPLETED → MC shows success
```

### Sync Agent Self-Update Chain

The sync agent on NUC had old code with wrong service name. Fix required:
1. Push fix to GitHub
2. Reboot NUC (or restart thepasspos-sync)
3. Boot self-update downloads fixed sync-agent.js from GitHub
4. Next FORCE_UPDATE uses correct service name

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| Vercel: can't cast text→enum on required columns | Pre-flight SQL: CREATE TYPE + ALTER COLUMN USING cast | `c554d09` |
| Prisma: 17 missing opposite relation fields | Added reverse relations to MenuItem (5), Order (10), Terminal (1), TimeClockEntry (1) | `96982b6` |
| NUC: nuc-pre-migrate.js missing all vercel-build migrations | Ported full migration suite: updatedAt, dedup, decimals, enums | `fa4c803` |
| NUC: sync-agent uses wrong service name `pulse-pos` | Try `thepasspos` first, fallback to legacy name | `fa4c803` |
| NUC: RE_PROVISION/RELOAD_TERMINALS/RESTART_KIOSK unhandled | Added command handlers with service restart logic | `fa4c803` |
| NUC: orphaned Payment.terminalId blocks FK constraint | Null orphaned references before db push | `5b28181` |
| NUC: cloud_event_queue P2032 error spam every 30s | updatedAt backfill fixes NULL values | `fa4c803` |

### Known Issues
- `prisma migrate deploy` always fails P3005 on NUC (never baselined) — soft fail, no impact
- NUC pre-migrate orphan cleanup currently covers Payment table only — may need expansion for other new FK constraints
- `c554d09` — first successful deploy after enum fix
- `e851c83` — failed (17 missing reverse relations)
- `96982b6` — passed clean

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| `db push` fails: can't cast text→enum on required columns with data | Pre-flight SQL: CREATE TYPE + ALTER COLUMN USING cast in vercel-build.js | `c554d09` |
| Prisma validation: 17 missing opposite relation fields | Added reverse relations to MenuItem (5), Order (10), Terminal (1), TimeClockEntry (1) | `96982b6` |

### Technical Details
- **Enum cast pattern:** `isTextColumn()` check → `enumTypeExists()` check → CREATE TYPE → ALTER COLUMN TYPE USING cast. Fully idempotent — skips on subsequent deploys.
- **Affected enums:** `PaymentMethod` (8 values), `TipLedgerEntryType` (2 values), `TipTransactionSourceType` (3 values)
- **All relation changes are virtual** (no DB columns added) — safe for tables with existing data

---

## 2026-02-25 — Scale Forensic Audit + Critical Fixes + Android USB Scale

**Session:** 6-agent forensic audit of the entire CAS PD-II scale integration uncovered 4 critical, 8 major, and 6 minor issues. Fixed all 4 critical issues with a 5-agent fix team. Then built full per-station USB scale support for Android tablets — each tablet connects its own CAS PD-II scale via USB-to-serial adapter, no NUC dependency.

### Commits

**GWI POS** (`gwi-pos`):
- `2767e2a` — Fix 4 critical scale issues: sync endpoints, tare capture, reports, environment guard (12 files, +177/-21)

**GWI Android Register** (`gwi-android-register`):
- `0242dd3` — Add CAS PD-II USB scale integration for per-station weight-based selling (21 files, +935)

### Deployments
- POS: pushed to main, Vercel auto-deploy
- Android: pushed to main

### Forensic Audit Findings

6 parallel audit agents (frontend-bartender, backend-manager, report-manager, output-auditor, api-socket-auditor, data-integrity-auditor) reviewed the full scale integration end-to-end.

**4 Critical Issues Found & Fixed:**

| # | Issue | Fix |
|---|-------|-----|
| 1 | Android sync endpoints (bootstrap + delta) missing ALL weight fields — Decimal types sent as strings | Added `Number()` conversion for `pricePerWeightUnit`, `weight`, `unitPrice`, `grossWeight`, `tareWeight` in both routes |
| 2 | Reports completely weight-unaware (25+ report pages, zero weight references) | Added weight columns/sections to product-mix, daily, and sales reports |
| 3 | Gross/tare weight never captured — WeightCaptureModal always set tareWeight=undefined | Added `lastGrossWeightRef` tracking in useScale hook; WeightCaptureModal now computes gross/tare from tracked readings |
| 4 | Scale service initialized at server startup outside request context (fails on Vercel) | Added VERCEL/test environment guard — hardware init only on NUC |

**8 Major Issues (documented, some deferred):**
- `(item as any)` type casts in orders page (fixed — MenuItem interface already has weight fields)
- No scale auto-discovery on Android stations (fixed — built full USB scale module)
- Order panel weight display on Android missing (fixed — OrderItemControls shows weight info line)
- Menu card price display doesn't show per-unit for weight items on Android (fixed — MenuItemCard shows `$5.99/lb` + scale emoji)
- `order.tax` field name mismatch in delta sync (fixed — corrected to `order.taxTotal`)

### Android USB Scale Module (NEW)

**Architecture:** Per-station model — each Android tablet has its own CAS PD-II scale connected via USB-to-serial adapter. No NUC dependency needed. Scale is managed entirely on-device.

**New Kotlin Files (6):**
| File | Purpose |
|------|---------|
| `scale/WeightReading.kt` | Data class + GrossNet enum |
| `scale/CasPdIIProtocol.kt` | Type 5 protocol: 9600/7/E/1, W/T commands, status byte parsing, frame extraction |
| `scale/ScaleManager.kt` | Hilt singleton, USB auto-detect via UsbSerialProber, 200ms poll on Dispatchers.IO, exponential backoff reconnect (1s→30s) |
| `di/ScaleModule.kt` | Hilt DI module |
| `ui/pos/components/WeightCaptureSheet.kt` | ModalBottomSheet: live weight display (color-coded), manual entry, tare, price calc |
| `res/xml/device_filter.xml` | USB vendor IDs: FTDI (1027), Prolific (9025), CH340 (6790), CP210x (4292) |

**Modified Files (15):**
- Data layer: MenuItemEntity (+3 weight fields), CachedOrderItemEntity (+6 fields), OrderDtos, SyncDto, DtoMappers, ServerOrderMapper
- Build: settings.gradle.kts (JitPack), build.gradle.kts (usb-serial-for-android:3.7.3), AndroidManifest (USB host feature)
- UI: OrderViewModel (scaleWeight/scaleConnected flows, addWeightItem, tareScale), OrderScreen (WeightCaptureSheet rendering), MenuGrid, MenuItemCard (scale emoji + price/unit), OrderItemControls (weight info line)
- DB version 7 (destructive migration)

### How to Add a Scale to an Android Station

1. **Hardware:** Connect CAS PD-II scale to Android tablet via USB-to-serial adapter (FTDI, Prolific, CH340, or CP210x chipset)
2. **Permission:** Android will prompt "Allow USB device access?" — tap Allow
3. **Auto-detect:** ScaleManager automatically discovers the USB serial device on app launch
4. **Usage:** Tap a sold-by-weight menu item → WeightCaptureSheet opens with live reading → place item on scale → wait for green "Stable" → tap "Add to Order"
5. **Manual fallback:** If scale disconnected, type weight manually in the text field
6. **Tare:** Tap "Tare" button to zero container weight before adding product

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| Sync endpoints send Decimal as string to Android | `Number()` conversion for all weight Decimal fields | `2767e2a` |
| WeightCaptureModal never captures gross/tare | Track lastGrossWeight in useScale ref, compute on confirm | `2767e2a` |
| Reports show "128" for weight items instead of "47.3 lb" | formatQty() helper, weight-based revenue sections | `2767e2a` |
| Scale service crashes on Vercel (no serial ports) | VERCEL/test env guard skips init | `2767e2a` |
| `order.tax` doesn't exist on Order model | Changed to `order.taxTotal` in delta sync | `2767e2a` |
| `(item as any)` casts in orders page | Removed — MenuItem interface already has fields | `2767e2a` |
| AGP bumped to non-existent 8.13.2 by agent | Reverted to 8.7.3 | `0242dd3` |

### Known Gaps
- Android scale: no settings UI to configure scale (auto-detects first USB serial device)
- No JDK on dev machine — Android build not verified with `./gradlew assembleDebug`
- Scale admin "Test Connection" on web POS still requires NUC-attached scale
- Weight-based inventory deduction on Android not yet tested end-to-end

---

## 2026-02-25 — Scale Integration: CAS PD-II + Weight-Based Selling

**Session:** Full-stack scale integration for weight-based selling (deli meats, produce, bulk goods). CAS PD-II scale connected via USB-to-serial adapter. Weight data flows through POS, receipts, kitchen tickets, KDS, and inventory deduction. Fleet schema migration button added to Mission Control. 8-agent team executed across 5 phases.

### Commits

**GWI POS** (`gwi-pos`):
- `b6da02e` — Scale integration: CAS PD-II + weight-based selling across full stack (49 files, +3319/-44)
- `0117195` — Backward-compatible scale includes for un-migrated venue databases (7 files)
- `8cfdd54` — Improve error messages for order item add failures

**GWI Mission Control** (`gwi-mission-control`):
- `8246987` — Fleet schema migration: per-venue sync + batch fleet sync (6 files, +751)

### Deployments
- POS: pushed to main, Vercel auto-deploy to barpos.restaurant / *.ordercontrolcenter.com
- MC: pushed to main, Vercel auto-deploy to app.thepasspos.com

### Features Delivered

**1. Scale Hardware Layer:**
- `Scale` Prisma model (CAS_PD_II type, serial config, weight config, status tracking)
- CAS PD-II Type 5 protocol implementation (9600/7/even/1, `W` for weight, `T` for tare)
- Scale service singleton with auto-reconnect, 200ms active / 2s idle polling
- Socket.IO streaming to `scale:{scaleId}` rooms
- 6 API routes: CRUD, test connection, tare, weight, serial port enumeration

**2. Weight-Based Order Logic:**
- `calculateItemTotal()` extended: `unitPrice × weight × quantity` + modifiers
- Add items API accepts weight fields, computes `price = unitPrice × weight` for backward compat
- Response mapper includes weight/weightUnit/unitPrice/grossWeight/tareWeight
- Zod validation: if `soldByWeight`, require `weight > 0` and `unitPrice > 0`

**3. POS UI:**
- `useScale` hook — real-time socket subscription, tare(), captureWeight()
- `WeightCaptureModal` — live scale reading (color-coded stability), manual entry fallback, tare button, live price calc
- Orders page intercepts weight-based items → opens modal instead of direct add
- `OrderPanelItem` shows `0.75 lb @ $5.99/lb` format for weight items
- `ScaleStatusBadge` in POS header (green/red connection dot)

**4. Output Systems:**
- Receipt: `0.75 lb NET @ $5.99/lb  Deli Turkey  $4.49` (NET only when tared)
- Kitchen print: `0.75 lb Deli Turkey (NET)` instead of `1x Deli Turkey`
- KDS: green weight badge instead of blue quantity badge
- Socket dispatch includes weight fields in KDS events

**5. Admin & Inventory:**
- Menu item "Sold by Weight" toggle + weight unit + price per unit
- Scale hardware admin page (CRUD, test connection with raw/parsed response, port dropdown)
- Terminal-to-scale binding (per-register and shared scale support)
- Inventory deduction: `recipeIngredientQty × weight × quantity` for weight items

**6. Fleet Schema Migration (Mission Control):**
- Per-venue "Sync Database Schema" card on Infrastructure tab
- Fleet-wide "Sync All Schemas" button on Locations page with progress tracking
- Audit logged to FleetAuditLog, sequential processing for Neon limits

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| Terminals GET/POST 500 on un-migrated venue DBs | Try-catch fallback omitting scale includes | `0117195` |
| Generic "Failed to create terminal" error msg | Surface actual Prisma error in response | `0117195` |

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scale protocol | Factory pattern by `scaleType` string | Extensible for future scale brands (AP-1, SW series) |
| Weight on OrderItem | Always NET (post-tare) | Simplifies calculations; gross/tare stored separately for audit |
| `price` field | Computed as `unitPrice × weight` | Backward compat — all existing code reads `price` |
| Backward compat | Try-catch with fallback queries | Venues can deploy before schema migration |
| Fleet migration | MC button → `syncVenueSchema()` | Reuses existing Neon provisioning infrastructure |

### New Files (14 POS + 4 MC)

| Category | Files |
|----------|-------|
| **Scale protocol** | `scale-protocol.ts`, `cas-pd-ii.ts`, `scale-factory.ts`, `scale-service.ts` |
| **Scale API** | `scales/route.ts`, `scales/[id]/route.ts`, `test/route.ts`, `tare/route.ts`, `weight/route.ts`, `serial-ports/route.ts` |
| **POS UI** | `useScale.ts`, `WeightCaptureModal.tsx`, `ScaleStatusBadge.tsx` |
| **Admin** | `hardware/scales/page.tsx` |
| **MC API** | `locations/[id]/sync-schema/route.ts`, `fleet/sync-schema/route.ts` |
| **MC UI** | `SchemaSyncCard.tsx`, `FleetSchemaSyncModal.tsx` |

### Known Gaps
- Tare is functional but nice-to-have (manual weight entry always available as fallback)
- USB/BT SDK stubs only on Android register (scale is POS-server-side via serial)
- Scale admin "Test Connection" requires scale physically connected to NUC running POS

---

## 2026-02-25 — Android Code Review: Nav Routes, String Externalization, Nav Args

**Session:** Applied 3rd-party Android code review recommendations to `gwi-android-register`. Three items addressed: type-safe navigation routes, string externalization to `strings.xml`, and navigation argument cleanup. All work done directly — 19 files changed, 2 new files created.

### Commits

**GWI Android Register** (`gwi-android-register`):
- `532d55e` — Code review fixes: Screen routes, string externalization, nav arg cleanup

### Deployments
- Android: pushed to main at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**1. Type-Safe Navigation Routes (Screen sealed class):**
- New `Screen.kt` sealed class in `ui/navigation/` with `Pairing`, `Login`, `Pos` routes
- `AppNavigation.kt` rewritten to use `Screen.Pairing.route`, `Screen.Login.route`, `Screen.Pos.createRoute()`
- Eliminates hardcoded route strings scattered across navigation code

**2. String Externalization (100+ strings):**
- New `app/src/main/res/values/strings.xml` with 100+ string resources
- All 15 UI Composable files updated to use `stringResource(R.string.*)`:
  - PairingScreen, PinLoginScreen, OrderScreen, ConnectionBanner, PosHeader
  - OrderPanel, PaymentSheet, DiscountSheet, ModifierSheet, NewTabDialog
  - ManagerPinDialog, OutboxDetailSheet, SearchOverlay, OpenOrdersPanel, OrderItemControls
- Covers: pairing, login, POS header, orders, totals, item controls, note/comp/void dialogs, manager PIN, payment, discount, modifier, new tab, open orders, outbox, search, and common strings

**3. Navigation Argument Cleanup:**
- Removed `employeeName` from navigation route arguments entirely
- `PinLoginScreen.onLoggedIn` simplified from `(String, String) -> Unit` to `(String) -> Unit`
- `OrderViewModel` now injects `EmployeeDao` and looks up employee name from Room cache on init
- Leverages existing `EmployeeDao.findById()` — employee is already cached during login

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Navigation routes | Sealed class pattern | Type-safe, IDE autocomplete, single source of truth |
| String externalization | `stringResource()` in Composables | Android i18n standard, enables future localization |
| Employee name | DAO lookup vs nav arg | Removes fragile string passing through nav graph, data already cached |
| ViewModel error strings | Left as hardcoded | ViewModels don't have Composable context for `stringResource()` |

### Files Changed (19 modified + 2 new)

| Category | Files |
|----------|-------|
| **New** | `Screen.kt`, `strings.xml` |
| **Navigation** | `AppNavigation.kt` |
| **Login** | `PinLoginScreen.kt` |
| **ViewModel** | `OrderViewModel.kt` |
| **Pairing** | `PairingScreen.kt` |
| **POS Screens** | `OrderScreen.kt` |
| **Components** | `ConnectionBanner.kt`, `PosHeader.kt`, `OrderPanel.kt`, `PaymentSheet.kt`, `DiscountSheet.kt`, `ModifierSheet.kt`, `NewTabDialog.kt`, `ManagerPinDialog.kt`, `OutboxDetailSheet.kt`, `SearchOverlay.kt`, `OpenOrdersPanel.kt`, `OrderItemControls.kt` |

### Known Issues / Blockers
- No JDK on dev machine — build verification deferred (code validated via grep cross-check of all R.string references against strings.xml)
- ViewModel error strings (`PinLoginViewModel`, `ManagerPinDialog` catch blocks) remain hardcoded — no `stringResource()` access outside Composable context

---

## 2026-02-25 — Phase 9b: Complete Forensic Audit (31 Items)

**Session:** Completed all 31 remaining forensic audit items from Phase 9 across 5 parallel workstreams (security, resilience, data integrity, socket, UX). Managed as agent team lead — 5 agents in isolated worktrees, all code merged to main, TypeScript clean, pushed.

### Commits

**GWI POS** (`gwi-pos`):
- `04f0348` — Security hardening: rate limiting, socket auth, simulated payment guard, PIN change, file validation (Items 1-7)
- `8b348fa` — Resilience hardening: error boundaries, polling fallback, retry utilities (Items 8-14)
- `bb66e84` — UX polish + data integrity: session draft save, offline banner, empty states, skeletons, focus traps, cash validation, sync badge, timezone, soft-delete, financial precision (Items 15-19, 25-31)
- `4657351` — Socket consolidation: useEvents→useSocket migration, location-scoped tags, leaked listener fix (Items 20-24)

### Deployments
- POS: pushed to main → Vercel auto-deploy

### Features Delivered

**Security (Items 1-7):**
- In-memory rate limiter (`src/lib/rate-limiter.ts`) applied to PIN login (10/15min), SMS (5/15min), error log (30/min)
- WebSocket `socketServer.use()` auth middleware — validates session cookie or native deviceToken
- Simulated payment guard — blocks payments in production when processor is `simulated`
- `requiresPinChange` field on Employee — set true on default PIN, cleared on PIN update
- Magic bytes file validation (`src/lib/file-validation.ts`) — JPEG/PNG/GIF/WebP

**Resilience (Items 8-14):**
- `SilentErrorBoundary` wrapping OpenOrdersPanel, OrderPanel, FloorPlanHome, KDS ticket cards
- OpenOrdersPanel error banner + retry button on fetch failure
- 30s polling fallback when socket disconnected, auto-refresh on reconnect (false→true)
- OrderTypeSelector fetch error with retry button
- Send-to-kitchen ref-based debounce lock
- `withPrismaRetry()` — catches P1001/P1008, retries 2x with exponential backoff

**Data Integrity (Items 15-19):**
- Timezone-aware date boundaries using Intl API (`src/lib/timezone.ts`) — 4 report routes updated
- Soft-delete filter on `GET /api/orders/[id]` — `deletedAt: null` on all queries
- `softDeleteOrder()` cascade helper (`src/lib/soft-delete.ts`) — Order + items + payments + discounts
- Financial precision — `roundToCents()` wrapping `parseFloat` in 8 payment routes
- Order reopen guard — checks ALL payment types, returns detailed 409 breakdown

**Socket (Items 20-24):**
- Migrated 14 files from `useEvents()` to direct `useSocket()` hook (`src/hooks/useSocket.ts`)
- Fixed `table:status-changed` field mismatch — `{ newStatus }` → `{ status }` (real bug, delta patching was silently broken)
- `NEXT_PUBLIC_EVENT_PROVIDER` default changed to `'socket'` with console.warn fallback
- Location-scoped tag rooms: `tag:{name}` → `tag:{locationId}:{name}`
- Leaked `once()` listeners cross-cleaned on connect/error/timeout

**UX (Items 25-31):**
- Draft order persistence to localStorage before logout — auto-restore on next login
- Enhanced offline banner — socket disconnect (amber) vs browser offline (red)
- Empty states for inventory items, menu categories, menu items
- CSS-only shimmer skeletons (`src/components/ui/Skeleton.tsx`) for inventory, menu, reservations
- Modal focus traps — Tab/Shift+Tab cycling, auto-focus, `aria-modal`
- Cash input validation — max=9999.99, blocked e/E/+/- keys on 6 input fields
- Pending sync badge in POS header — polls every 10s, amber badge with count

### New Utilities Created

| File | Purpose |
|------|---------|
| `src/lib/rate-limiter.ts` | Reusable in-memory rate limiter factory |
| `src/lib/prisma-retry.ts` | P1001/P1008 retry wrapper with exponential backoff |
| `src/lib/timezone.ts` | Timezone-aware date ranges using Intl API |
| `src/lib/soft-delete.ts` | Cascade soft-delete for orders + children |
| `src/lib/file-validation.ts` | Magic bytes checker (JPEG/PNG/GIF/WebP) |
| `src/lib/currency-input-utils.ts` | Cash input key blocking + validation props |
| `src/lib/draft-order-persistence.ts` | Draft order save/restore via localStorage |
| `src/components/ui/SilentErrorBoundary.tsx` | Reusable error boundary with retry |
| `src/components/ui/Skeleton.tsx` | CSS-only shimmer skeleton components |
| `src/components/PendingSyncBadge.tsx` | Amber sync queue badge for POS header |
| `src/hooks/useSocket.ts` | Thin wrapper over getSharedSocket/release |

### Schema Changes
- `Employee.requiresPinChange Boolean @default(false)` — already synced to Neon

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| `table:status-changed` field mismatch — clients destructured `{ newStatus }` but server sent `{ status }` | Rename destructure to match server payload | `4657351` |
| Reports using server UTC instead of venue timezone for "today" boundaries | `getLocationDateRange()` with Intl API | `bb66e84` |
| `GET /api/orders/[id]` returning soft-deleted orders/items | Added `deletedAt: null` to all findFirst/include | `bb66e84` |
| `parseFloat` on currency strings losing precision | Wrapped with `roundToCents()` in 8 routes | `bb66e84` |

### Known Issues / Blockers
- None — all 31 forensic audit items complete. Phase 9 forensic audit is fully resolved.

---

## 2026-02-25 — Android UI Audit: Web vs Android Parity (P0→P1→P2)

**Session:** Full bartender-workflow audit comparing web POS and Android register UIs side-by-side. Two agent teams independently traced identical 17-step workflows. Cross-compared findings, then fixed all gaps in 3 priority rounds. Managed as agent team lead — all code written by parallel agents with cross-agent wiring fixes.

### Commits

**GWI Android Register** (`gwi-android-register`):
- `551dea4` — P0: employee name passthrough, pour pricing (size + multiplier), floor plan visibility fix, order type mapping per tab, payment processing spinner
- `008384d` — P1: notes dialog (AlertDialog + OutlinedTextField), discount button, search toggle, two-tap void/remove confirmations, logout button, tip validation fix
- `835cbad` — P2: comp/void reason picker dialogs, close tab button, course cycling (1→4), "Order Sent!" confirmation banner, open orders filter chips + sort toggles

### Deployments
- Android: all pushed to main at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**P0 — Blocking Fixes (5 files, 53 insertions):**
- Employee name passthrough via navigation args (PinLoginScreen → AppNavigation → OrderViewModel)
- Pour size and multiplier sent with OrderItemRequest (was hardcoded to defaults)
- Floor plan visible when order has no items (was gated on `currentOrderId == null`)
- Order type mapped per active tab (TABLES→dine_in, BAR→bar_tab, TAKEOUT→takeout, DELIVERY→delivery)
- Payment sheet: processing spinner, disabled button, undismissable during payment

**P1 — Pre-Pilot UX (7 files, 183 insertions):**
- Note dialog for order items (AlertDialog with themed OutlinedTextField, placeholder text)
- Discount button on OrderPanel (amber, wired to DiscountSheet)
- Search icon + Logout icon on PosHeader
- Two-tap confirmation on Void chip ("Confirm Void?") and Remove button ("Sure?")
- Tip validation: cash tendered must cover order total + tip

**P2 — Pre-Production Features (5 files, 352 insertions):**
- Comp/void reason picker: AlertDialog with preset reasons (5 comp, 4 void) + custom input field
- `compItem()` and `confirmCompVoid()` ViewModel functions calling server API
- Close Tab button (purple, bar tabs only) with `CloseTabRequest`
- Course cycling (1→2→3→4→1) on order items via `setCourse()` + `UpdateItemRequest`
- "Order Sent!" green confirmation banner with 2s auto-dismiss (AnimatedVisibility + LaunchedEffect)
- Open orders panel: filter chips (All / Dine In / Tabs / To Go), sort toggles (Newest / Oldest / Total $)
- Comp ActionChip with two-tap confirmation in OrderItemControls
- `refreshCurrentOrder()` moved to finally block for reliable state refresh after add

### Cross-Agent Wiring Fixes
- `onComp` → `onCompItem` (param name mismatch between agents)
- `onSetCourse` threaded through OrderPanel to OrderItemControls (was hardcoded to `{ }`)
- `tabName`, `showSentConfirmation`, `onDismissSentConfirmation`, `onCloseTab` wired from OrderScreen → OrderPanel
- `onLogout` wired from OrderScreen → PosHeader (caught post-P1 merge)

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audit methodology | Identical 17-step bartender workflows | Ensures apples-to-apples comparison between web and Android |
| Priority triage | P0 (money/broken) → P1 (missing UX) → P2 (incomplete features) | Ship-blocking items first |
| Agent file partitioning | Agent A: ViewModel + Screen, Agent B: UI components | Prevents merge conflicts in parallel work |
| Comp/void flow | Reason picker dialog with presets | Matches web POS CompVoidModal pattern |
| Course cycling | Client-side modulo (1-4) | Simple, no server round-trip for UI state |
| Sent confirmation | AnimatedVisibility + LaunchedEffect 2s | Non-blocking, auto-clears, replaces Send button temporarily |

### Modifier Indicator Fix (Commit 76232c0)

- `MenuDao.getItemIdsWithModifiers()` — new Room query returns DISTINCT menuItemIds from modifier_groups
- `OrderUiState.itemIdsWithModifiers: Set<String>` — pre-computed on category load
- `MenuGrid` + `MenuItemCard` now show "+ options" only when item actually has modifier groups (was hardcoded true)

### Shared Platform Issues Fixed (Commits f0fbd18 + adaed99)

Cross-platform fixes applied to both Android register and web POS:

**Manager PIN for Comp/Void (Issue #1):**
- Android: New `ManagerPinDialog.kt` composable — AlertDialog with PIN input, calls `POST /api/auth/verify-pin`, returns manager employee ID. Wired into comp/void reason picker: user picks reason → manager PIN required → `approvedById` sent with `CompVoidRequest`
- Web: `CompVoidModal.tsx` now shows `ManagerPinModal` before submission. `approvedById` included in API request. Remote SMS approval preserved as alternative path

**Discount Approval (Issue #2):**
- Android: `applyPercentageDiscount()` / `applyDollarDiscount()` catch HTTP 403, check for `requiresApproval` in body, show `ManagerPinDialog`, retry with `approvedById` via `retryDiscountWithApproval()`
- Web: `DiscountModal.tsx` catches 403 `requiresApproval`, shows `ManagerPinModal`, retries with manager ID for both preset and custom discounts

**PIN Brute-Force (Issue #3, Android only):**
- `PinLoginViewModel` parses HTTP 429 response, extracts server lockout message
- `PinLoginScreen` shows prominent red lockout text, clears on new input
- Server-side rate limiter (`auth-rate-limiter.ts`) already protects both platforms

**Cash Drawer (Issue #4, Android only):**
- `GwiApiService.openCashDrawer()` — `POST /api/print/cash-drawer`
- Fire-and-forget call in `payCash()` after successful payment + drawer open

**Offline Payment Guard (Issue #5, Web only):**
- `PaymentModal.tsx` tracks socket connection state via `connect`/`disconnect` events
- All payment action buttons disabled when `!isConnected`
- Red warning banner: "Payment unavailable — no connection to server"
- Matches Android's existing `isOnline` hard-block pattern

### Remaining Gaps (from audit)
- Split payments not implemented
- Datacap USB/BT payment reader bridges (stubs only)
- CFD dual-screen not implemented
- Receipt printing (ESC/POS over network not yet wired)
- Pre-auth reader selection (needs Datacap SDK)

## 2026-02-24 — Android Hardening: Production-Grade Resilience (4 Rounds)

**Session:** Four rounds of hardening on the Android register app, incorporating internal requirements and two third-party code reviews. Managed as agent team lead — all code written by parallel agents. Desktop review docs regenerated after each round.

### Commits

**GWI Android Register** (`gwi-android-register`):
- `5b7c96a` — Round 1A: PIN removal from Room (PCI), outbox per-order sequencing, bootstrap upsert-then-prune
- `047a1f7` — Round 1B: NucNotConfiguredException domain exception, UX truthfulness (dual-signal online, kitchen queued warning, payment blocking, idle timeout, closed-elsewhere detection)
- `a9c32ec` — Round 1C: ARCHITECTURE.md documenting 7 hardening invariants
- `c63babe` — Divider deprecation fix (Divider → HorizontalDivider)
- `5cd6894` — Round 2A: double-tap protection (isAddingItem/isSending/isProcessingPayment), non-menu DAO upsert-prune (Employee, Table, OrderType, PaymentReader), closed-elsewhere UX, docs update
- `54af64b` — Round 2B: payment in-flight logging (PaymentLogEntity INITIATED/CONFIRMED/FAILED, PaymentLogDao, unreconciled count badge)
- `499d62d` — Round 3: DynamicBaseUrlInterceptor (replaces Retrofit rebuild), OutboxWorker parsePayload<T> safety, BootstrapWorker NucNotConfiguredException handling, health check interval 30s→10s, SharedFlow buffers 10→64
- `dc4bf31` — Round 4: PIN auto-submit fix (remove auto-submit at 4, add GO button for 4-6 digit PINs), SharedFlow BufferOverflow.DROP_OLDEST on all 12 flows

### Deployments
- Android: all pushed to main at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**Security (Round 1A):**
- `EmployeeEntity` — removed `pin` column entirely (PCI: PINs never persisted on device)
- `DtoMappers` — EmployeeDto still receives pin from API but maps without persisting

**Outbox Ordering (Round 1A):**
- `OutboxEntry` — added `sequenceNumber: Long`, `Index("offlineId")`
- `OutboxDao.getRetryable()` — NOT EXISTS subquery ensures per-order strict sequencing (entry N must complete before N+1 dispatches)
- `OutboxDao.getNextSequenceNumber()` — auto-increments per offlineId

**Bootstrap Safety (Round 1A):**
- `MenuDao.syncMenuData()` — @Transaction upsert-then-prune (INSERT OR REPLACE, then DELETE WHERE id NOT IN)
- All 4 non-menu DAOs (Employee, Table, OrderType, PaymentReader) — same upsert-then-prune pattern
- `BootstrapWorker` — uses sync* methods instead of deleteAll+insertAll, catches NucNotConfiguredException

**Domain Exceptions (Round 1B):**
- `NucNotConfiguredException` — replaces raw IllegalStateException for unpaired device state
- `ApiServiceHolder` — throws NucNotConfiguredException when no base URL configured
- `OrderRepository` — private `api` helper wraps NucNotConfiguredException → IOException
- `OutboxWorker` + `BootstrapWorker` — catch and handle gracefully

**UX Truthfulness (Round 1B):**
- `OrderViewModel.isOnline` — dual signal: socket connected AND HTTP health check (every 10s)
- `kitchenQueuedWarning` — shown when sendToKitchen succeeds but outbox still has pending items
- Payment blocking — `showPayment()`/`payCash()`/`payCard()` gated on `isOnline`
- `orderClosedElsewhere` — detected when active order disappears from server open orders list
- `sessionExpired` — 5-minute idle timeout with auto-logout
- `unreconciledPaymentCount` — observes stale INITIATED payment logs, shown as red badge in PosHeader

**Double-Tap Protection (Round 2A):**
- `isAddingItem` — guards `addItem()`/`addItemWithModifiers()` with try/finally flag
- `isSending` — guards `sendToKitchen()`
- `isProcessingPayment` — guards all payment flows
- `ModifierSheet` — confirm button disabled when `isAddingItem`

**Payment Logging (Round 2B):**
- `PaymentLogEntity` — Room entity with INITIATED/CONFIRMED/FAILED status, amounts, timestamps
- `PaymentLogDao` — insert, markConfirmed, markFailed, getStaleInitiated, observeUnreconciledCount, purgeOldConfirmed
- DB version 3→4 (destructive migration)

**Connectivity (Round 3):**
- `DynamicBaseUrlInterceptor` — OkHttp interceptor with AtomicReference, rewrites scheme/host/port per-request, preserves connection pool (replaces Retrofit rebuild)
- `NetworkModule` — provides interceptor + single Retrofit instance with placeholder base URL
- `OutboxWorker.parsePayload<T>()` — generic JSON deserialization helper with dead-letter on parse failure
- Health check interval reduced from 30s to 10s

**PIN & Socket (Round 4):**
- `PinLoginViewModel` — removed auto-submit at length 4, added `onSubmit()` (requires ≥4 digits)
- `PinLoginScreen` — added "GO" button to numpad (enabled at 4+ digits, dimmed when disabled)
- `SocketManager` — all 12 SharedFlows: `BufferOverflow.DROP_OLDEST` (tryEmit never silently drops newest event)

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PIN storage | Never persist on device | PCI compliance — server validates on every login |
| Outbox sequencing | NOT EXISTS subquery | Guarantees per-order strict ordering without complex locking |
| DAO sync pattern | Upsert-then-prune | Flicker-free UI — no delete-all gap between old and new data |
| Domain exceptions | NucNotConfiguredException | Distinguishes unpaired vs network error for graceful UX |
| Online detection | Socket + HTTP health | Socket alone misses API-layer failures; dual signal catches both |
| URL switching | OkHttp interceptor | Preserves connection pool and in-flight requests vs Retrofit rebuild |
| SharedFlow overflow | DROP_OLDEST | With tryEmit(), default SUSPEND silently drops new events; DROP_OLDEST keeps freshest |
| PIN submission | Explicit GO button | Auto-submit at 4 prevented 5-6 digit PINs from being entered |

### Third-Party Reviews Addressed
- **Grok AI analysis:** ~40% outdated (pre-server-truth), ~30% wrong assumptions, ~30% valid → all valid items fixed
- **"Bartender-proof" review:** 3 glass jaws (DynamicBaseUrlInterceptor, parsePayload safety, health check interval) → all fixed
- **"Mean Reviewer" items:** 5 checks — 2 already fixed, 2 fixed in round 4, 1 confirmed non-issue (prune trap impossible in server-truth architecture)

### Known Issues / Next Steps
- WorkManager 15-min min interval (need foreground service for sub-minute sync)
- USB/BT payment reader bridges are stubs only
- CFD dual-screen (Presentation API) not implemented
- Desktop review docs on `~/Desktop/`: `android-register-data.txt` (3433 lines), `android-register-ui.txt` (4564 lines)

---

## 2026-02-24 — Retrofit Lifecycle + Offline UX Guardrails

**Session:** Replaced per-request URL rewriting with a clean Retrofit rebuild-on-IP-change pattern (`ApiServiceHolder` singleton with `AtomicReference`), and added comprehensive offline UX guardrails — persistent disconnect banner, payment blocking when offline, kitchen send warning, dead-letter badges, and an outbox detail sheet. Two-agent parallel build (retrofit-agent on data/network layer, ux-agent on UI layer) with zero file overlap.

### Commits

**GWI Android Register** (`gwi-android-register`):
- `a945e61` — Retrofit lifecycle + offline UX guardrails (15 files: 12 modified, 3 new)

### Deployments
- Android: pushed to main at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**Part 1 — Retrofit Lifecycle (9 files):**
- `ApiServiceHolder.kt` (NEW): `@Singleton` wrapper with `AtomicReference<GwiApiService?>`. Builds initial Retrofit from `getNucBaseUrl()`, then collects `nucBaseUrlFlow.filterNotNull().distinctUntilChanged()` to rebuild on IP change. `val api` getter throws `IllegalStateException("NUC not configured — device not paired")` pre-pairing.
- `TokenProvider.kt`: Added `nucBaseUrlFlow: StateFlow<String?>` to interface. `EncryptedTokenProvider` seeds from prefs in `lazy .also {}`, emits on `setNucBaseUrl()`.
- `AuthInterceptor.kt`: Stripped all URL rewriting logic (~30 lines removed). Now only injects `Authorization: Bearer` header (~15 lines total).
- `NetworkModule.kt`: Removed `provideRetrofit()` and `provideGwiApiService()`. `ApiServiceHolder` is `@Singleton @Inject` — Hilt auto-provides.
- 5 consumers mechanically updated (`apiService` → `apiHolder.api`): `OrderRepository` (14 sites), `AuthRepository` (1 site), `BootstrapWorker` (1 site), `SyncWorker` (1 site), `OutboxWorker` (8 sites). Total: 25 call sites.

**Part 2 — Offline UX Guardrails (7 files):**
- `ConnectionBanner.kt` (NEW): Full-width red-tinted banner — "NUC connection lost — orders may not sync". 8dp red dot + text. Auto-hides on reconnect.
- `OutboxDetailSheet.kt` (NEW): `ModalBottomSheet` showing sync queue. Header with pending/failed counts. `LazyColumn` of entries with status dots (Amber=Pending, Blue=Sending, Orange=Failed, Red=Dead). "Retry All Failed" (Indigo) and "Clear Dead Letters" (outlined red) buttons.
- `OutboxDao.kt`: 4 new queries — `getDeadLetters()`, `getAllPendingAndFailed()`, `resetFailedForRetry()`, `deleteDeadLetters()`.
- `OrderViewModel.kt`: Connection banner with 3s delay (`connectionBannerJob`), payment blocked offline ("Cannot process payment while disconnected"), kitchen send warned offline, outbox sheet load/retry/clear methods.
- `PosHeader.kt`: Clickable amber pending badge + red dead-letter badge with count.
- `OrderScreen.kt`: Wired `AnimatedVisibility` connection banner, dead-letter badge, outbox detail sheet.

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Retrofit rebuild | `AtomicReference` in `ApiServiceHolder` | Hilt `@Singleton` means Retrofit can't be re-provided after DI graph builds; atomic swap is thread-safe |
| URL flow | `StateFlow<String?>` on `TokenProvider` | Reactive — rebuild triggers automatically on IP change without polling |
| Pre-pairing guard | `IllegalStateException` from `api` getter | Fail-fast — surfaces misconfiguration immediately instead of silent 404s |
| Connection banner | 3s delay before showing | Avoids flicker on brief disconnects |
| Payment blocking | Hard block when offline | Payments require server confirmation — offline payment would create unresolvable state |
| Kitchen send | Warning but proceeds | Outbox will queue and retry — kitchen eventually receives |
| Dead-letter badge | Red badge in header | Persistent visibility without blocking workflow |

### Known Issues / Next Steps
- Previous session known gaps still apply: WorkManager 15-min min interval, USB/BT SDK stubs, CFD dual-screen not implemented
- `ApiServiceHolder` uses app-scoped `CoroutineScope` (lives forever) — acceptable for singleton

---

## 2026-02-24 — Android Register Rebuild: Same System as Web POS

**Session:** Rebuilt the Android register data layer and UI to use the exact same POS API endpoints, socket events, and visual layout as the web POS. Previously Android created orders in Room only (disconnected from NUC). Now it calls the same REST routes and subscribes to the same Socket.io events. UI overhauled from flat split layout to full POS-matching composition with header, category bar, table floor plan, modifiers, seats, bar mode, payment, and discounts.

### Commits

**GWI Android Register** (`gwi-android-register`):
- `0a92356` — Phase 1-2: Server-first data layer + POS-matching UI shell (+2,358/-577 lines, 22 files)
- `01e1ea0` — Phase 3-4: Interactive features, bar mode, payment, discounts (+1,767 lines, 15 files, 11 new components)
- `0ed7cee` — Fix: OpenOrdersPanel server ID for active highlight, auto-close on select

### Deployments
- Android: pushed to main at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**Phase 1 — Server-First Data Layer (Skills 430-431):**
- OrderRepository rewritten: optimistic Room write → call same POS API endpoint → update from server response → fallback to outbox on error
- GwiApiService: 12 new Retrofit endpoints matching web POS routes (createOrder, addItems, sendToKitchen, payOrder, open/closeTab, compVoid, discount, voidPayment, getOpenOrders, getOrder, updateOrder)
- OrderDtos: full request/response DTOs matching POS API contract (Moshi @JsonClass)
- OutboxWorker rewritten: routes each action type (CREATE_ORDER, ADD_ITEMS, SEND_TO_KITCHEN, etc.) to correct POS endpoint instead of bulk sync/outbox
- SocketManager: subscribes to 11 POS events (order:created, orders:list-changed, orders:totals-update, payment:processed, floor-plan:updated, tab:updated, tab:closed, kds:item-status, kds:order-bumped, entertainment events) with SharedFlow channels
- Joins location room on connect (same as web POS)
- OrderViewModel: server-first open orders fetch, socket event reactivity, category splitting (food vs bar), connection state tracking with auto-refresh on reconnect

**Phase 2 — POS-Matching UI Shell (Skill 432):**
- Color.kt: PosColors object — all POS surface/accent/text/border/glass/status colors
- Type.kt: PosTypography object — 15 named text styles
- Theme.kt: dark-only POS color scheme (removed dynamic/light themes)
- PosHeader: 44dp header with employee name, TABLES/TAKEOUT/DELIVERY/BAR tab pills, open orders badge, connection indicator
- CategoryBar: two-row LazyRow — food (orange) / bar (blue) split by categoryType + "New Tab" button
- MenuItemCard: glassmorphic card (110dp min, 14dp corners, semi-transparent bg + border, 86'd overlay, ripple)
- MenuGrid: LazyVerticalGrid adaptive 160dp
- OrderPanel: 360dp fixed-width with item list, modifiers, totals, Send/Pay/Print buttons
- OrderScreen: composition shell wiring all components

**Phase 3 — Interactive Features (Skill 432):**
- TableFloorPlan + TableCard: grid with status-colored glow borders (green/indigo/orange/amber), tap to open/create order
- ModifierSheet: ModalBottomSheet with grouped chips, min/max validation, required/optional badges, FlowRow
- OpenOrdersPanel: sliding 320dp panel showing all server orders with order#, tab/table, type, items, age, pre-auth
- SearchOverlay: full-screen search with real-time MenuDao query
- SeatSelector: numbered seat buttons above menu, items assigned to selected seat
- OrderItemControls: long-press expandable action row with Hold/Note/Course/Void/Resend chips

**Phase 4 — Bar Mode, Payment, Discounts (Skill 432):**
- BarModePanel: pour size selector (Shot/Double/Tall/Short) with multipliers
- NewTabDialog: tab name + optional pre-auth checkbox
- PaymentSheet: card/cash toggle, tip with quick % buttons (15/18/20/25), cash tendered with change calculation
- DiscountSheet: percentage/dollar toggle, quick presets, live discount preview

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data layer | Server-first, Room as cache | NUC is single source of truth — Room is resilience layer only |
| API surface | Same endpoints as web POS | Every order mutation calls same route web uses |
| Socket model | Same rooms/events as web POS | joins location:{id}, listens to all order/payment/floor events |
| Outbox routing | Per-action-type to correct endpoint | Replaces bulk sync/outbox with CREATE_ORDER → POST /api/orders, etc. |
| UI composition | Components take primitives + callbacks | Enables parallel agent work, no ViewModel coupling |
| Theme | Always dark, POS colors | Matches web POS exactly, removed Material You dynamic |

### Known Issues / Next Steps
- Glassmorphism fallback: BlurEffect API 31+, semi-transparent on 26-30
- WorkManager 15-min min interval (need foreground service for sub-minute outbox flush)
- USB/BT payment reader bridges are stubs
- CFD dual-screen (Presentation API) not implemented
- Room migration needed for any LocalOrderItemEntity status fields

---

## 2026-02-24 — Native Android Register: Full 4-Phase Implementation

**Session:** Built the complete native Android register system across 3 repos (POS, Mission Control, Android). 4 phases: backend API routes, Mission Control dashboard, full Kotlin Android app, integration testing. Managed as agent team manager across 4 sequential teams (~15 agents total).

### Commits

**GWI POS** (`gwi-pos`):
- `21d24da` — Phase 1: Prisma schema (Terminal: platform/appVersion/osVersion/pushToken), 5 new API routes (pair-native, heartbeat-native, bootstrap, delta, outbox), socket.io deviceToken auth, terminal platform field
- `aa2dcee` — Phase 2: Hardware limit check (20 terminals) on pair-native route
- `f68b01f` — Phase 4: 5 vitest test suites for all new API routes (34 tests, 875 lines)

**GWI Mission Control** (`gwi-mission-control`):
- `5403b3b` — Phase 2: RELOAD_ANDROID_TERMINAL + WIPE_ANDROID_TERMINAL command types, AndroidTerminalCard.tsx component, location detail page integration

**GWI Android Register** (`gwi-android-register`) — **NEW REPO**:
- `81c74ac` — Phase 3: Full Android app — 63 files, 4,895 lines (Kotlin + Jetpack Compose)
- `42561d8` — Phase 3: UI polish — dark theme, improved repositories (+643/-571 across 10 files)
- `44ac2a4` — Phase 4: Integration test plan (60+ QA test cases, 318 lines)

### Deployments
- POS: pushed to main (auto-deploys to barpos.restaurant)
- Mission Control: pushed to main (auto-deploys to app.thepasspos.com)
- Android: new repo created at https://github.com/GetwithitMan/gwi-android-register

### Features Delivered

**Phase 1 — Backend (POS Repo):**
- `POST /api/hardware/terminals/pair-native` — Native app pairing with Bearer token auth (not cookies)
- `POST /api/hardware/terminals/heartbeat-native` — Native heartbeat with Bearer token
- `GET /api/sync/bootstrap` — Full offline data download (menu, employees, tables, order types, settings, readers, printers)
- `GET /api/sync/delta?since=` — Incremental sync for records updated after timestamp
- `POST /api/sync/outbox` — Idempotent batch order push with row-locked orderNumber generation
- Socket.io `deviceToken` auth for native clients (coexists with browser cookie auth)
- Terminal model: `platform`, `appVersion`, `osVersion`, `pushToken` fields + `@@index([platform])`

**Phase 2 — Mission Control:**
- `RELOAD_ANDROID_TERMINAL` / `WIPE_ANDROID_TERMINAL` command types
- `AndroidTerminalCard.tsx` — shows Android terminals with status, version, IP, actions
- Hardware limit enforcement: 20 terminals per location on pair-native

**Phase 3 — Android App (54 Kotlin files):**
- Data layer: 11 Room entities, 8 DAOs, AppDatabase
- Network: Retrofit API service, DTOs, AuthInterceptor, EncryptedTokenProvider (AES-256-GCM)
- Payment: DatacapClient (HTTP XML to local IP readers), PaymentManager (orchestrator with CFD events)
- Socket: SocketManager (socket.io-client-java), CfdEvents/PosEvents/MobileEvents constants
- Sync: BootstrapWorker, SyncWorker, OutboxWorker (WorkManager), ConnectivityMonitor
- Repositories: AuthRepository (pairing + PIN login), OrderRepository (offline-first + outbox)
- UI: PairingScreen, PinLoginScreen (numeric keypad), OrderScreen (split POS layout), AppNavigation
- DI: Hilt modules for Database, Network, Workers

**Phase 4 — Testing & Verification:**
- `tsc --noEmit` clean on both POS and Mission Control repos (zero regressions)
- Socket auth compatibility verified: deviceToken auth doesn't affect browser terminals
- 5 vitest test suites: pair-native (9), heartbeat-native (6), bootstrap (5), delta (6), outbox (8)
- Integration test plan: 60+ manual QA test cases across 10 sections

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Real-time | Socket.io (reuse existing rooms) | `socket.io-client-java` on Android, same room architecture |
| Payments | Hybrid: IP direct + NUC proxy fallback | Android calls IP readers directly via HTTP XML |
| CFD | Native Compose screens + socket events | Listens to existing CFD socket events |
| Data model | Extend existing Terminal model | Added `platform` field, no new models needed |
| Auth | Bearer token (not cookies) | Native apps don't use httpOnly cookies |
| Offline | Room DB + WorkManager outbox | Mirrors existing web Dexie + offline-manager pattern |

### Known Issues / Next Steps
- WorkManager minimum periodic interval is 15 minutes — sub-minute sync needs foreground service or coroutine polling
- USB/BT payment reader support: PAX/Sunmi SDK bridges are stubs, need hardware for implementation
- CFD dual-screen (Android `Presentation` API) not yet implemented
- Full QA requires real hardware: Android tablet + NUC + Datacap IP reader

---

## 2026-02-24 — Wave 7 + Pilot Readiness: Online Safety, Combos, Tips, Payments, Crash Guards, UX Fixes

**Session:** 40 bug fixes across 5 domains (17 task groups) via 5-agent team, plus 3 user-reported UX bug fixes and comprehensive pilot readiness checklist. Managed as agent team manager with isolated worktrees per agent.

### Commits
- `743e618` — Wave 7 + Pilot Readiness: 40 bug fixes across 5 domains, 3 UX fixes, pilot checklist (38 files, +3257/-418)
- `7cf933d` — Docs: Skills 428-429, SKILLS-INDEX, LIVING-LOG, 7 changelogs (13 files, +6520)
- `0562286` — Fix deploy: pre-push SQL migration for required columns on existing tables
- `c8ae857` — Fix deploy: move linkedBottleProduct include from OrderItemModifier to Modifier relation

### Deployments
- **14 consecutive ERROR deployments fixed** — Production had been broken since Sprint A+B (`d53ebbb`)
- **Root cause 1:** `prisma db push` fails adding NOT NULL columns to tables with existing rows (OrderOwnershipEntry: 6 rows, cloud_event_queue: 18 rows, ModifierTemplate)
- **Fix 1:** `scripts/vercel-build.js` now runs raw SQL via `@neondatabase/serverless` before `prisma db push` — adds columns as nullable, backfills from related tables, sets NOT NULL
- **Root cause 2:** `void-waste.ts` included `linkedBottleProduct` directly on `OrderItemModifier` (snapshot field, no Prisma relation). Must go through `Modifier` relation.
- **Fix 2:** Moved include to `modifier: { select: { linkedBottleProduct: { ... } } }` and updated access path
- **Production READY:** `dpl_4z2BFQr59kMR21DJDfsEzeRGn6dD` (commit `c8ae857`) deployed to barpos.restaurant + *.ordercontrolcenter.com

### Features Delivered
- **Online ordering safety** — Server-side modifier pricing, deletedAt + enabled checks, sliding window rate limiter, soft-cancel on payment failure, onlinePrice support, dedicated system employee
- **Combo/rental correctness** — Combo inventory expansion (ComboTemplate walk), 86/availability checks, minimumCharge enforcement, pourMultiplier + spirit substitutions on voids
- **Tip ledger-only payroll formula** — declaredTips sourced from ledger credits only (not Shift model), bankedTipsCollected excluded from netTips, atomic tip transfers in $transaction
- **Payment safety** — close-tab Payment record in atomic tx, walkout atomic guard, MGR_REFUNDS permission, refund/reversal caps, chargeback reflection
- **Crash guards** — instrumentation.ts (unhandledRejection/uncaughtException), 4 error.tsx boundaries (global/POS/admin/KDS auto-retry), all 12 socket handlers wrapped in try/catch
- **Bar tab cancel fix** — Clear savedOrderId on card decline, revert to temp ID
- **Duplicate adds fix** — isTempId filter in sendItemsToTab, lastMutationRef stamp, modifier cache
- **Seats disappearing fix** — baseSeatCount in panel view select
- **Pilot readiness checklist** — ~200 testable items organized by service phases, go/no-go criteria, sign-off lines

### Bug Fixes

| ID | Area | Fix |
|----|------|-----|
| #381 | Inventory | pourMultiplier applied on voids |
| #382 | Inventory | Spirit substitution via linkedBottleProduct on voids |
| #384-388 | Online | Server-side pricing, deletedAt, enabled check, rate limit, soft-cancel |
| #410-413 | Tips | Batch adjust-tip: recalc total, version, ledger, socket |
| #415 | Tips | totalTipOuts sign fix (Math.abs on DEBIT sum) |
| #416, #423 | Tips | Payroll ledger-only formula, bankedTipsCollected excluded |
| #417 | Tips | Server-side netTips at shift close |
| #418-421 | Tips | Atomic tip transfers in $transaction |
| #426 | Reports | Cash payout deduction in daily reconciliation |
| #427 | Reports | Break deduction in employee shift report |
| #455-457 | Payments | close-tab Payment record + tipTotal ?? fix |
| #459-461 | Payments | Walkout retry atomic guard |
| #470-473 | Payments | MGR_REFUNDS, refund caps, chargeback reflection |
| #477-483 | Crash | instrumentation.ts, 4 error.tsx, socket try/catch |
| UX-1 | Orders | Bar tab cancel clears savedOrderId on decline |
| UX-2 | Orders | Duplicate adds: isTempId filter + lastMutationRef + modifier cache |
| UX-3 | Orders | Seats disappearing: baseSeatCount in panel select |

### Skills Created
- **Skill 428** — Wave 7: Online Safety, Combos/Timed Rentals, Tips & Reports, Crash Guards
- **Skill 429** — Pilot Readiness: Bar Tab, Duplicate Adds, Seat Fixes + Checklist

### Changelogs Updated
ORDERS, PAYMENTS, TIPS, REPORTS, ERROR-REPORTING, INVENTORY, ENTERTAINMENT

### Known Issues / Blockers
- None. All Wave 7 + Pilot Readiness work verified. Production deployment restored after 14 consecutive ERROR deployments.
- Next: Wave 8 — Staff UX & Workflows (bartender/server experience, transfer/merge, bar modifiers, search, Pay Cash Instead)

---

## 2026-02-23 — Bugfix Sprint C+D: Payment Edges, KDS Audit, PWA, Multi-Tenant Hardening

**Session:** 12 fixes — online tax, pre-auth expiry, pending_auth recovery, KDS audit trail, printer health, failover logging, PWA manifest + service worker, offline disconnect banner, 8 locationId bypass hardening, cascade onDelete rules

### Commits
- `7eb5ba2` — Bugfix Sprint C+D: payment edges, KDS audit, PWA, multi-tenant hardening (21 files, 454 insertions, 5 new files)

### Features Delivered
- **Online tax calculation** — Checkout now derives tax from location settings instead of hardcoded 0%
- **Pre-auth expiry tracking** — preAuthExpiresAt field on Order model for tab expiry awareness
- **pending_auth recovery** — Auto-recover stale tabs, close-tab validation, new `/api/system/recovery/pending-auth` endpoint
- **KDS audit trail** — All bump/un-bump/complete/serve/resend actions logged to AuditLog
- **Printer health tracking** — Health record updated on every print attempt (success or failure)
- **Failover audit logging** — Failover print events logged to AuditLog for visibility
- **PWA manifest** — Standalone mode, black theme, app-like experience
- **Service worker** — Cache-first for static assets, network-first for API calls
- **Offline disconnect banner** — Visual indicator when network is lost, auto-dismisses on reconnect
- **Cascade safety** — 5 onDelete rules changed from Cascade to Restrict (OrderItem, OrderCard, OrderItemModifier, OrderItemIngredient, OrderItemPizza)

### Bug Fixes

| ID | Area | Fix |
|----|------|-----|
| #384 | Payments | Online checkout tax calculated from location settings (was hardcoded 0%) |
| EDGE-6 | Payments | Pre-auth expiry tracking via preAuthExpiresAt on Order |
| EDGE-7 | Payments | pending_auth recovery — auto-recover stale tabs, close-tab validation, recovery endpoint |
| BUG 20 | KDS | Audit trail for bump/un-bump/complete/serve/resend |
| BUG 23 | Print | Printer health updated on every print attempt |
| BUG 24 | Print | Failover events logged to AuditLog |
| #635 | PWA | PWA manifest added (standalone, black theme) |
| #636 | PWA | Service worker + registration component |
| — | PWA | Offline disconnect banner component |
| — | Multi-Tenant | 8 locationId bypass routes hardened (employees/[id], inventory/stock-adjust, integrations/test, categories/[id], upload, inventory/transactions, tickets, monitoring/errors) |
| — | Schema | 5 cascade onDelete rules changed from Cascade to Restrict |

### Bugs Investigated and Closed (NOT bugs)
- **#416** (payroll tips 4x) — NOT A BUG, distinct data sources confirmed
- **#454** (split tips as payment) — NOT A BUG, correctly separated
- **BUG 25** (printer fallback) — WORKING AS DESIGNED

---

## 2026-02-23 — Bugfix Sprint A+B: Multi-Tenant Isolation, Floor Plan, Offline Wiring

**Session:** 16 fixes — location cache isolation, CloudEventQueue locationId, schema locationId gaps, menu route hardening, socket room validation, snapshot status fix, seat persistence, optimistic locking, offline order/print wiring, soft auth removal, report fixes

### Commits
- `d53ebbb` — Bugfix Sprint A+B: 16 fixes across multi-tenant isolation, floor plan, offline wiring, auth, and reports (23 files, 226 insertions)

### Features Delivered
- **Location cache isolation** — Cache keyed by venue slug instead of singleton
- **CloudEventQueue scoping** — locationId field added, cleanup scoped per location
- **Schema locationId gaps filled** — ModifierTemplate + OrderOwnershipEntry now have locationId + deletedAt
- **Menu route hardening** — GET routes require locationId (no longer optional)
- **Socket room validation** — Room subscriptions validated against authenticated locationId
- **Snapshot status fix** — Floor plan snapshot includes 'sent' and 'in_progress' order statuses
- **Seat persistence** — Drag positions saved to DB via API call
- **Optimistic locking** — Table/Seat version field prevents concurrent edit conflicts
- **Offline order wiring** — Order creation routed to OfflineManager.queueOrder() when offline
- **Offline print wiring** — Print jobs queued offline on failure
- **Auth hardening** — Soft auth bypass removed from api-auth.ts

### Bug Fixes

| ID | Area | Fix |
|----|------|-----|
| B1 | Multi-Tenant | Location cache keyed by venue slug instead of singleton |
| B2 | Multi-Tenant | CloudEventQueue adds locationId field, scoped cleanup |
| B3 | Multi-Tenant | ModifierTemplate + OrderOwnershipEntry add locationId + deletedAt |
| B4 | Multi-Tenant | Menu GET routes require locationId |
| B5 | Multi-Tenant | Socket room subscriptions validated against authenticated locationId |
| B6 | Floor Plan | Snapshot + table GET include 'sent' and 'in_progress' statuses |
| B7 | Floor Plan | Seat drag positions persisted to DB |
| B8 | Floor Plan | Table/Seat optimistic locking with version field |
| B9 | Offline | Offline order creation wired to OfflineManager.queueOrder() |
| B10 | Offline | Print jobs queued offline on failure |
| B11 | Offline | Already implemented — markForOfflineCapture confirmed |
| B12 | Offline | Already implemented — socket reconnect already re-joins rooms |
| B13 | Auth | Soft auth bypass removed from api-auth.ts |
| B16 | Reports | Daily report surcharge derivation from pricing program |
| B17 | Reports | Labor report date filter refactored |
| B18 | Reports | Product mix pairing grouped by orderId instead of timestamp |

### Bugs Investigated and Closed (NOT bugs)
- **#509-511** (socket/CFD rooms) — ALREADY FIXED
- **B14** (PIN rate limiting) — ALREADY FIXED in Wave 1

---

## 2026-02-23 — Wave 5: Owner Setup & Advanced Analytics

**Session:** Wave 5 implementation — setup wizard, CSV import, report exports, daypart/trends analytics, customer VIP, email receipts, security hardening, command palette, quick-service mode

### Commits
- `17f619a` — Wave 5: Owner Setup & Advanced Analytics — 13 items across setup, reports, customer, security, and navigation (36 files, 4,321 insertions)
- `0dcba2c` — Update docs: Skill 426, SKILLS-INDEX, LIVING-LOG, REPORTS + PAYMENTS changelogs for Wave 5

### Features Delivered
- **Getting-started checklist** — Setup progress page with 6-step completion tracking
- **CSV menu import** — Bulk import with file upload, preview, and column mapping
- **Batch printer testing** — Test all printers from hardware page
- **CSV export** — Added to 7 more report pages (sales, shift, tips, voids, employees, hourly, liquor)
- **Email reports** — Send daily report via email using Resend API
- **Cash-flow & liability report** — Consolidated view of drawers, house accounts, gift cards, tip payouts
- **Daypart analytics** — Revenue/orders by time-of-day segments with configurable boundaries
- **Trends report** — Day-over-day and week-over-week comparison with delta indicators
- **Customer VIP tiers** — Silver/Gold/Platinum with auto-suggest based on spend
- **Banned customer flag** — Block from reservations/house accounts with POS warning
- **Email receipts** — Post-payment option to email receipt via Resend
- **Buddy-punch prevention** — IP/device logging on clock events with suspicious activity alerts
- **2FA for large refunds/voids** — Configurable thresholds with remote SMS approval
- **Command palette** — Cmd+K fuzzy search across all admin pages
- **Quick-service mode** — Counter-service ordering without floor plan

---

## 2026-02-23 — Wave 4: Manager Control & Owner Visibility

**Session:** Wave 4 implementation — configurable approvals, dashboard v2, alerts, audit browser, report exports, speed-of-service, variance UI

### Commits
- `8a735d0` — Wave 4: Manager Control & Owner Visibility — 9 items across approvals, dashboard, alerts, audit, and reporting (16 files, 2,574 insertions)
- `b6d7370` — Update docs: Skill 425, SKILLS-INDEX, LIVING-LOG, PAYMENTS + REPORTS changelogs for Wave 4
- `a33aa15` — Fix deploy: remove @@unique([locationId, orderNumber]) — production DB has duplicate orderNumbers

### Features Delivered
- **Configurable approvals** — Location-level void/discount approval thresholds with 403 enforcement
- **Per-role discount limits** — Non-managers capped by configurable max percentage
- **Item deletion auditing** — Pre-send item removals logged to AuditLog
- **Dashboard v2** — Per-employee performance metrics with risk highlighting (void %, discount frequency)
- **Real-time alert system** — Threshold-based alerts dispatched via socket, displayed on dashboard, persisted to AuditLog
- **Audit log browser** — Full admin page with filters, pagination, expandable details, CSV export
- **CSV export** — Added to daily, labor, payroll, product-mix reports
- **Flash report** — Yesterday's key metrics with day-over-day comparison
- **Speed-of-service** — API + report page with avg times by employee and day
- **Food cost variance** — Color-coded variance table with summary cards and CSV export

### Bug Fixes
| ID | Fix |
|----|-----|
| W4-4 | Already implemented — login/logout/login_failed auditing confirmed present |

---

## 2026-02-23 — Wave 3: Frontline Usability & Transfers (Skill 424)

**Session**: Agent team deployment → 14 frontline UX fixes + new features

**Commits (gwi-pos)**:
- `00cdc11` — Wave 3: Staff UX & Transfers — 14 items across payments, bartender, transfers, combo, and dashboard
- `5fb8d29` — Update docs: Skill 424, SKILLS-INDEX, LIVING-LOG, KDS + PAYMENTS changelogs for Wave 3

**Features Delivered**:
- Card decline "Pay Cash Instead" button on decline overlay
- Cash Exact one-tap payment on method selection screen
- Increment failure toast notification (visible without opening payment modal)
- Bartender view search box (expandable, filters all items)
- Hot modifier buttons for common bar modifiers (Neat/Rocks/Up etc.)
- Tab name bypass setting wired to location config
- Transfer Items and Merge Orders buttons in order panel
- TabTransferModal for bartender-to-bartender tab reassignment
- Table transfer entry point on floor plan
- MergeOrdersModal for combining two orders
- Combo builder (ComboStepFlow) wired into ordering flow
- Seat hydration fix for virtual/temporary seats on refresh
- Manager Dashboard v1 with open orders, clocked-in staff, aging highlights

**Bug Fixes**:

| ID | Area | Fix |
|----|------|-----|
| W3-1 | Payment | Card decline preserves tab, close-tab capture retry threshold increased |
| W3-3 | Payment | Increment failure fires toast even when modal is closed |
| W3-12 | Payment | Cash Exact one-tap on method selection screen |
| W3-13 | Payment | "Pay Cash Instead" on decline overlay |
| W3-5 | Bartender | Tab name bypass wired to location setting |
| W3-10 | Bartender | Search input added to bartender header |
| W3-11 | Bartender | Hot modifier quick-tap buttons for liquor items |
| W3-6 | Transfers | Transfer Items button in OrderPanelActions |
| W3-7 | Transfers | TabTransferModal + socket dispatch in API |
| W3-8 | Transfers | Table transfer on floor plan via TableInfoPanel |
| W3-9 | Transfers | MergeOrdersModal for order consolidation |
| W3-2 | Floor Plan | Virtual seat hydration on page refresh |
| W3-4 | Ordering | Combo builder wired into OrderPageModals |
| W3-14 | Manager | Dashboard v1 with real-time open orders and staff view |

**Known Issues**: None from this wave.

---

## 2026-02-23 — Wave 2: Correctness Under Load (Skill 423)

**Session**: Forensic audit → agent team deployment → 14 correctness fixes

**Commits (gwi-pos)**:
- `4a313c1` — Wave 2: Correctness Under Load — 14 fixes across splits, KDS, store, offline queues, and reports
- `873503a` — Update docs: Skill 423, SKILLS-INDEX, LIVING-LOG, KDS + PAYMENTS changelogs for Wave 2

**Features Delivered**:
- Loyalty double-credit prevention (transaction-scoped + server idempotency)
- Split payment rounding precision (`Math.round` pipeline)
- Inventory deduction audit trail for failed deductions
- KDS paid order auto-cleanup (2-hour window)
- Expo KDS voided item filtering
- Entertainment session lazy auto-expiry
- Tax rate Zustand reactivity (module-level → store state)
- Single `set()` pattern for quantity updates
- Print retry utility with audit logging
- localStorage persistence failure toast warnings
- Product Mix waste tracking (voided/comped items)
- Reopen route total recalculation

**Bug Fixes**:

| ID | Area | Fix |
|----|------|-----|
| W2-P1 | Splits | Loyalty update moved inside transaction + server-side idempotency key |
| W2-P2 | Splits | `Math.round(x * 100) / 100` on all Decimal→Number conversions |
| W2-P3/O1 | Splits | Inventory deduction failures now create audit log entries |
| W2-P4 | Splits | Split ticket subtotal double-discount investigated and fixed |
| W2-K1 | KDS | Paid orders limited to 2-hour window via OR clause |
| W2-K2 | KDS | Expo KDS filters voided and deleted items |
| W2-K3 | KDS | Entertainment sessions auto-expire via lazy check |
| W2-S1 | Store | Tax rate moved into Zustand store state for reactivity |
| W2-S3 | Store | `updateQuantity` inlined to single `set()` call |
| W2-O2 | Offline | Print retry utility (1 retry after 3s + audit log) |
| W2-O3 | Offline | localStorage persistence failures show toast warnings |
| W2-R1 | Reports | Product Mix includes waste section for voided/comped items |
| W2-R2 | Reopen | Reopen route recalculates totals from active items |

**Known Issues**: None from this wave.

---

## 2026-02-23 — Wave 1 Go-Live Safety (Skill 422)

**Version:** `1.0.0-beta`
**Session theme:** Pre-go-live safety audit — 17 critical fixes across payments, KDS, printing, security, and store stability before first real venue deployment.

**Summary:** 5-agent parallel team identified and fixed 17 issues from a comprehensive safety audit: 4 CRITICAL payment bugs (void not reversing card charges, simulated mode unguarded in prod, invisible charges on DB failure, reopen+repay double-charges), 7 HIGH (split parent race, KDS void/resend/un-bump sync, PIN brute-force, session timeout, auth hardening), and 6 MEDIUM (print error reporting, backup printer, cash drawer, toast memory leak, previousOrder logout clear).

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | `8f0f2ef` | Wave 1 Go-Live Safety: 17 fixes across payments, KDS, print, security, stores |
| gwi-pos | `7ab1b85` | Update docs: Skill 422, SKILLS-INDEX, LIVING-LOG, 3 changelogs for Wave 1 Go-Live Safety |

### Stats

- **Files changed:** 25
- **Insertions:** 982
- **New files:** 6
- **Bug severity:** 4 CRITICAL, 7 HIGH, 6 MEDIUM

### Bug Fixes

| Fix | ID | Severity | Impact |
|-----|-----|----------|--------|
| Void doesn't reverse card charge | P1 | CRITICAL | Datacap voidSale/emvReturn after DB void |
| Simulated mode unguarded in prod | P2 | CRITICAL | NODE_ENV=production blocks simulated |
| Invisible charge on DB failure | P3 | CRITICAL | Auto-void at Datacap on DB write failure |
| Reopen+repay double-charges | P4 | CRITICAL | forceReopen guard + void old payments |
| Split parent race condition | P5 | HIGH | FOR UPDATE lock before sibling check |
| Voided items stay on KDS | K1 | HIGH | kds:item-status socket dispatch |
| Resent items don't reappear on KDS | K2 | HIGH | kds:item-status on resend |
| Un-bump doesn't sync across KDS | K3 | HIGH | Socket dispatch on bump/serve/status |
| Direct print always returns 200 | PR1 | MEDIUM | Real failure status returned |
| Backup printer reads wrong field | PR2 | MEDIUM | Use PrintRoute backupPrinterIds |
| Cash drawer returns 200 on failure | PR3 | MEDIUM | HTTP 500 on failure |
| No PIN brute-force protection | S1 | HIGH | Rate limiter (5/employee, 10/IP) |
| No session timeout | S2 | HIGH | 30min auto-logout, 25min warning |
| Auth in editable localStorage | S3 | HIGH | httpOnly signed JWT cookies |
| Toast timer memory leak | ST1 | MEDIUM | Store+clear timeout IDs, cap at 25 |
| previousOrder not cleared on logout | ST2 | MEDIUM | Clear in clearOrder + all 3 logout paths |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Payment safety | 422 | Void reversal, simulated guard, auto-void on failure, reopen guard, split lock |
| KDS reliability | 422 | Void/resend/un-bump socket events sync all KDS screens |
| Print reliability | 422 | Error reporting, backup printer fix, cash drawer failure detection |
| Security hardening | 422 | PIN rate limiting, 30min idle timeout, httpOnly JWT auth |
| Store stability | 422 | Toast timer leak fix, previousOrder cleared on all logout paths |

### Known Issues / Blockers

None.

---

## 2026-02-23 — Speed & Reconnect Optimizations (Skill 421) + Skill 110 Update

**Version:** `1.0.0-beta`
**Session theme:** Performance Phase 3 (Speed) + Phase 4 (Reconnect) — 4-agent parallel team targeting order panel load speed and network resilience. Plus comprehensive Skill 110 Real-Time Events documentation overhaul.

**Summary:** Parallel agent team implemented 6 optimizations: lightweight `?view=panel` API mode, parallel split-ticket fetch, optimistic panel render from snapshot, skip first-render animations, FloorPlan+KDS reconnect auto-refresh, and hardware health socket-gated polling. Panel open perceived time reduced from ~800ms to <200ms. Skill 110 expanded from 13 events to comprehensive 57-event reference across 18 domains.

### Changes

| Phase | Change | Files |
|-------|--------|-------|
| 3a | Lightweight `?view=panel` select query | `src/app/api/orders/[id]/route.ts` |
| 3b | Parallel split-ticket fetch via `Promise.all` | `src/lib/order-utils.ts` |
| 3c | Optimistic panel render from snapshot data | `src/components/floor-plan/FloorPlanHome.tsx` |
| 3d | Skip entrance animations on first render | Order panel component |
| 4a | Socket reconnect auto-refresh (FloorPlan + KDS) | `FloorPlanHome.tsx`, `kds/page.tsx` |
| 4b | Hardware health polling gated by socket state | `settings/hardware/health/page.tsx` |
| Docs | Skill 110 expanded to 57 events, 18 domains | `docs/skills/110-REALTIME-EVENTS.md` |
| Docs | Skill 421 created | `docs/skills/421-SPEED-RECONNECT.md` |

### Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| Panel open (perceived) | ~800ms | <200ms |
| Panel items visible | ~800ms | ~400-600ms |
| Split order fetch | Sequential | Parallel |
| Network recovery | Manual reload | Auto-refresh |
| Hardware health polling | Always 30s | Socket-gated |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Speed optimizations | 421 | 4 speed improvements: panel API, parallel fetch, optimistic render, skip animations |
| Reconnect resilience | 421 | FloorPlan + KDS auto-refresh on socket reconnect, hardware polling gate |
| Real-time events docs | 110 | Comprehensive 57-event reference across all domains (was 13 events) |

### Known Issues / Blockers

None.

---

## 2026-02-23 — Deep Dive Forensic Round 2 (Skill 417)

**Version:** `1.0.0-beta`
**Session theme:** Deep dive forensic round 2 — 4 parallel agents stress-tested all POS flows; 23 bugs found and fixed across tip lifecycle, split/parent sync, course firing, and floor plan

**Summary:** 4 forensic agents ran parallel deep-dive testing across floor plan, payments, splits/discounts/comps, and items/modifiers/kitchen flows. Identified and fixed 23 bugs: 5 CRITICAL (close-tab missing inventory+tips, tip adjustment no allocation, unassigned items excluded from course 1, parent discount stale after child void, comp-void payment check outside tx), 8 HIGH (pay-all-splits missing tip allocation, void-payment no tip reversal on DB failure, partial refund no tip adjust, reopen doesn't clear paidAt/closedAt, parent itemCount stale, merge doesn't restore discounts, seat cleanup fails silently, no quantity validation on POST), 8 MEDIUM (void closed order, tip adjustment no Order.total update, panel payment race, socket skip window, fire-course no status check, delayStartedAt scope, discount exceeds price, rapid split orphans), 2 LOW (snapshot coalescing, empty course API calls).

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | `0ca1331` | Fix deep dive round 2: 23 bugs across tip lifecycle, splits, courses, floor plan |

### Stats

- **Files changed:** 17
- **Insertions:** 417
- **Bug severity:** 5 CRITICAL, 8 HIGH, 8 MEDIUM, 2 LOW

### Bug Fixes

| Fix | Severity | Impact |
|-----|----------|--------|
| Close-tab missing inventory deduction + tip allocation | CRITICAL | Tab closes bypassed inventory and tip pipelines — added both after capture |
| Tip adjustment never triggers tip allocation | CRITICAL | Deferred receipt tips skipped allocation — allocateTipsForPayment added |
| Unassigned items excluded from course 1 firing | CRITICAL | Null courseNumber items never fired — filter includes null via {in: [1, null]} |
| Parent discount not recalculated after child void | CRITICAL | Parent discount stayed stale after child void — sum sibling discountTotals |
| Comp-void payment check outside transaction | CRITICAL | Concurrent payment could bypass check — moved inside tx after FOR UPDATE |
| Pay-all-splits missing tip allocation | HIGH | Tips collected but never allocated in batch — added loop per split child |
| Void-payment no tip reversal on DB failure | HIGH | Tips remained allocated after processor void — handleTipChargeback in catch |
| Partial refund doesn't adjust tip | HIGH | Tip unchanged on partial refund — proportional tip reduction |
| Reopen doesn't clear paidAt/closedAt | HIGH | Reopened order retained payment timestamps — clear both on reopen |
| Parent itemCount stale after split children voided | HIGH | Parent showed original count — sum sibling active quantities |
| Merge/unsplit doesn't restore discounts | HIGH | Discounts lost on merge — recalculate from child splits |
| Temp seat cleanup fire-and-forget fails silently | HIGH | Stale seats accumulate — single retry with 1s delay |
| No quantity validation on POST items | HIGH | Zero/negative quantities accepted — quantity >= 1 check |
| Void-payment allows voiding closed orders | MEDIUM | Void on closed order inconsistent — status check added |
| Tip adjustment doesn't update Order.total | MEDIUM | Order total out of sync — recalculate with new tipTotal |
| Order panel doesn't clear on payment race | MEDIUM | Paid order visible on other terminal — check Zustand store |
| Socket 500ms skip window too fragile | MEDIUM | Own-mutation refetch under latency — increased to 2000ms |
| Fire-course no order status validation | MEDIUM | Courses fired on paid/closed orders — block invalid statuses |
| delayStartedAt stamped on non-sent items | MEDIUM | All items got delay reset — scoped to filterItemIds |
| Discount exceeds item price silently | MEDIUM | Negative line items on split — cap to item price |
| Rapid split/unsplit orphans items | MEDIUM | Orphaned items on deleted children — clean on merge |
| Snapshot coalescing too slow | LOW | Delayed floor plan updates — counter-based with immediate refresh |
| Empty coursing fires unnecessary API calls | LOW | No-op API calls on empty course — early return with info toast |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Tip lifecycle completeness | 417 | Close-tab, adjust-tip, pay-all-splits, void, and refund all properly allocate/reverse tips |
| Split/parent sync integrity | 417 | Parent discount, itemCount, and merge operations keep parent in sync with children |
| Course firing safety | 417 | Unassigned items fire with Course 1; status validation blocks invalid fires |
| Floor plan resilience | 417 | Seat cleanup retry, payment race handling, faster snapshot coalescing |

---

## 2026-02-23 — Chaos Test Fixes (Skill 416)

**Version:** `1.0.0-beta`
**Session theme:** Comprehensive chaos testing — worst-case employee behavior simulation reveals and fixes 19 bugs across payment, order, and floor plan flows

**Summary:** Ran comprehensive chaos testing simulating rapid clicks, wrong payments, card declines, and concurrent terminal operations. Identified and fixed 19 bugs: 6 critical (isProcessing orphaned after decline, items modifiable after partial payment, datacap+DB void decoupled, comp restore double inventory, order number race duplicates, failed capture hanging auth), 8 high (item duplication on send, no socket for active order, discount no recalculate, empty drafts accumulate, deleted items no dispatch, reopen no cooldown, multiple drafts same table, autosaveInFlightRef verified), 5 medium (CFD no max tip validation, course firing no ordering, quantity 0 accepted, orphaned seats no warning, cancelled order accepts payment).

### Changes Summary

**Bug 1 (CRITICAL): isProcessing Orphaned After Card Decline**
- finally{} cleanup on all payment paths
- File: PaymentModal.tsx

**Bug 2 (CRITICAL): Items Modifiable After Partial Payment**
- Payment existence check on all mutation routes
- Files: items/, comp-void/

**Bug 3 (CRITICAL): Datacap Void + DB Void Decoupled**
- Unified route handles both atomically
- File: void-payment/route.ts

**Bug 4 (CRITICAL): Comp Restore + Re-Void Double Inventory**
- restoreInventoryForRestoredItem() reverses deduction
- Files: comp-void/route.ts, inventory/

**Bug 5 (CRITICAL): Order Number Race (Duplicates)**
- @@unique constraint + transactional number generation
- Files: orders/route.ts, schema.prisma

**Bug 6 (CRITICAL): Failed Capture Leaves Hanging Auth**
- Auto-void auth on capture failure
- File: close-tab/route.ts

**Bug 7 (HIGH): Items Duplicated During Send**
- Filter pendingSavesRef items from bgChain append
- File: useActiveOrder.ts

**Bug 8 (HIGH): No Socket Listener for Active Order**
- orders:list-changed listener with own-mutation skip
- File: useActiveOrder.ts

**Bug 9 (HIGH): Discount Doesn't Recalculate**
- recalculatePercentDiscounts() on subtotal changes
- Files: order-calculations.ts, items/, comp-void/

**Bug 10 (HIGH): Empty Drafts Accumulate**
- clearOrder() soft-deletes empty drafts
- File: useActiveOrder.ts

**Bug 11 (HIGH): Deleted Items Not Dispatched**
- Added dispatchOpenOrdersChanged on delete
- File: items/[itemId]/route.ts

**Bug 12 (HIGH): Reopen After Payment No Cooldown**
- 60s cooldown + table status revert + cache invalidation
- File: reopen/route.ts

**Bug 13 (HIGH): Multiple Drafts Same Table**
- Table lock (FOR UPDATE) inside creation transaction
- File: orders/route.ts

**Bug 15 (MEDIUM): No Max Tip Validation on CFD**
- >50% tip shows confirmation screen
- File: CFDTipScreen.tsx

**Bug 17 (MEDIUM): Course Firing No Ordering**
- Prior-course check with force override
- File: fire-course/route.ts

**Bug 18 (MEDIUM): Quantity 0 Accepted by API**
- Validation: quantity >= 1
- File: items/[itemId]/route.ts

**Bug 19 (MEDIUM): Orphaned Seats No Warning**
- movedItemsToShared count + socket dispatch
- File: seating/route.ts

**Bug 20 (MEDIUM): Cancelled Order Accepts Payment**
- Added cancelled/voided to blocked statuses
- File: pay/route.ts

### Bug Fixes

| Fix | Severity | Impact |
|-----|----------|--------|
| isProcessing orphaned after card decline | CRITICAL | Payment modal permanently locked after decline — finally{} cleanup added |
| Items modifiable after partial payment | CRITICAL | Order total could change after partial payment — mutation routes check for existing payments |
| Datacap void + DB void decoupled | CRITICAL | Processor void could succeed while DB void failed — unified atomic operation |
| Comp restore + re-void double inventory | CRITICAL | Inventory deducted twice on restore→re-void — restore now reverses deduction |
| Order number race (duplicates) | CRITICAL | Concurrent creation could produce duplicate numbers — @@unique + transactional generation |
| Failed capture leaves hanging auth | CRITICAL | Auth hold stuck on customer card for days — auto-void on capture failure |
| Items duplicated during send | HIGH | pendingSaves appended twice to bgChain — filtered before append |
| No socket listener for active order | HIGH | Cross-terminal edits invisible — orders:list-changed listener added |
| Discount doesn't recalculate | HIGH | Percentage discount stayed flat after item changes — recalculate on subtotal change |
| Empty drafts accumulate | HIGH | Hundreds of zero-item drafts in DB — soft-delete on navigate away |
| Deleted items not dispatched | HIGH | Item deletion invisible to other terminals — socket dispatch added |
| Reopen after payment no cooldown | HIGH | Immediate reopen caused double-charge risk — 60s cooldown added |
| Multiple drafts same table | HIGH | Concurrent taps created duplicate drafts — FOR UPDATE table lock |
| No max tip validation on CFD | MEDIUM | Accidental large tips possible — >50% confirmation screen |
| Course firing no ordering | MEDIUM | Courses fireable out of order — prior-course check added |
| Quantity 0 accepted by API | MEDIUM | Ghost items with zero quantity — validation rejects < 1 |
| Orphaned seats no warning | MEDIUM | Items silently moved on seat removal — count + socket added |
| Cancelled order accepts payment | MEDIUM | Payment accepted on cancelled/voided orders — status check expanded |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Payment modal decline recovery | 416 | isProcessing cleanup on all payment paths |
| Partial payment mutation lock | 416 | Item mutations blocked after any payment exists |
| Atomic void (Datacap + DB) | 416 | Single transaction for processor + database void |
| Inventory restore on comp unvoid | 416 | restoreInventoryForRestoredItem() reverses waste |
| Unique order numbers | 416 | @@unique constraint + transactional generation |
| Auto-void hanging auth | 416 | Capture failure auto-voids authorization |
| Cross-terminal socket sync | 416 | Active order listens for orders:list-changed |
| Discount auto-recalculation | 416 | Percentage discounts track subtotal changes |
| Empty draft cleanup | 416 | Zero-item drafts soft-deleted on navigate |
| CFD tip guard | 416 | >50% tip requires confirmation |
| Course firing order enforcement | 416 | Prior-course validation with force override |

---

## 2026-02-23 — Split Payment, Void & Merge Fixes (Skill 415)

**Version:** `1.0.0-beta`
**Session theme:** Split payment safety — race conditions, missing sockets, stale caches, inventory gaps, fractional pricing

**Summary:** Fixed 10 bugs across 5 API routes in the split payment, void, and merge flows. Four critical bugs: pay-all-splits called inventory deduction on the empty parent instead of split children; parent auto-close after last split payment ran outside the transaction (race condition with concurrent payments); no socket events when parent transitioned to paid; fractional split modifiers had price=0. Four high-severity bugs: parent totals stale after child void, missing socket/cache on unsplit merge, merge race allowing payment between check and delete, loyalty points calculated on total instead of subtotal. Two medium-severity: no parent validation before child payment, missing cache invalidation on split delete.

### Changes Summary

**Bug 1 (CRITICAL): Pay-All-Splits Inventory on Empty Parent**
- Deduct inventory from each split child individually instead of the empty parent
- File: pay-all-splits/route.ts

**Bug 2 (CRITICAL): Parent Auto-Close Outside Transaction**
- Moved inside tx with FOR UPDATE lock on parent row
- File: pay/route.ts

**Bug 3 (CRITICAL): Missing Socket When Parent → Paid**
- Added dispatchOpenOrdersChanged + floor plan update + cache invalidation
- File: pay/route.ts

**Bug 4 (CRITICAL): Fractional Split Modifiers Price=0**
- Proportional modifier pricing based on splitQty/originalQty fraction
- File: split-tickets/route.ts

**Bug 5 (HIGH): Parent Totals Stale After Child Void**
- Sum sibling totals and update parent inside tx
- File: comp-void/route.ts

**Bug 6 (HIGH): Missing Socket + Cache on Unsplit Merge**
- Added socket dispatch + invalidateSnapshotCache + floor plan update
- File: split-tickets/route.ts

**Bug 7 (HIGH): Split Merge Race**
- FOR UPDATE locks + re-check payments inside tx
- File: split-tickets/route.ts

**Bug 8 (HIGH): Loyalty Points Uses Total Not Subtotal**
- Changed s.total to s.subtotal in loyalty calculation
- File: pay-all-splits/route.ts

**Bug 9 (MEDIUM): No Parent Validation on Child Payment**
- Verify parent status='split' before allowing payment
- File: pay/route.ts

**Bug 10 (MEDIUM): Missing Cache Invalidation on Split Delete**
- Added invalidateSnapshotCache + floor plan update
- File: split-tickets/[splitId]/route.ts

### Bug Fixes

| Fix | Severity | Impact |
|-----|----------|--------|
| Pay-all-splits inventory on empty parent | CRITICAL | No inventory deducted when paying all splits — deduction now runs per child |
| Parent auto-close outside transaction | CRITICAL | Concurrent last-split payments could race — now locked with FOR UPDATE |
| Missing socket when parent → paid | CRITICAL | Other terminals didn't see parent close — socket + cache added |
| Fractional split modifiers price=0 | CRITICAL | Modifier prices zeroed on fractional splits — proportional pricing applied |
| Parent totals stale after child void | HIGH | Parent showed stale totals after void — sibling sums recalculated |
| Missing socket + cache on unsplit merge | HIGH | Merge invisible to other terminals — socket + cache added |
| Split merge race | HIGH | Payment could sneak in during merge — FOR UPDATE + re-check |
| Loyalty points uses total not subtotal | HIGH | Points inflated by tax — changed to subtotal |
| No parent validation on child payment | MEDIUM | Could pay child of closed parent — status check added |
| Missing cache on split delete | MEDIUM | Delete invisible to other terminals — cache invalidation added |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Split inventory deduction fix | 415 | Per-child inventory deduction instead of empty parent |
| Parent auto-close transaction safety | 415 | FOR UPDATE lock prevents concurrent payment race |
| Parent close socket dispatch | 415 | Floor plan + open orders update on parent→paid |
| Proportional modifier pricing | 415 | Fractional splits get correct modifier prices |
| Parent total recalculation on void | 415 | Sibling sums update parent after child void |
| Merge socket + cache | 415 | Other terminals see unsplit immediately |
| Merge race protection | 415 | FOR UPDATE + re-check prevents data loss |
| Loyalty subtotal fix | 415 | Points earned on subtotal only |
| Parent validation on child pay | 415 | Reject payment if parent not in split status |
| Split delete cache invalidation | 415 | Other terminals see split deletion immediately |

### Known Issues / Next Steps

- All 10 fixes are backend-only (API routes) — no frontend changes needed
- Consider adding integration tests for concurrent split payment scenarios

---

## 2026-02-23 — Order Disappearance Fixes (Skill 414)

**Version:** `1.0.0-beta`
**Session theme:** Race-condition fixes — orders disappearing on rapid table clicks, ghost table state after payment

**Summary:** Fixed 5 race conditions that caused orders to vanish when rapidly switching tables, ghost table state after payment, and cascading version conflicts on shared tables. Two critical bugs: draft promise race (stale POST responses overwriting active order) fixed with generation counter, and fetch callback overwriting wrong table fixed with loadId ref counter. High-severity payment ghost bug fixed by immediate snapshot cache invalidation. Two medium-severity version conflict bugs: active-order guard prevents 409 refetch from loading wrong order, and server now returns version in TABLE_OCCUPIED 409 response so adoption syncs correctly.

### Changes Summary

**Bug 1 (CRITICAL): Draft Promise Race**
- `draftGenRef` generation counter — stale draft POST responses discarded if generation changed
- File: useActiveOrder.ts

**Bug 2 (CRITICAL): Fetch Callback Overwrites Wrong Table**
- `fetchLoadIdRef` counter — stale fetch responses discarded if loadId changed
- File: FloorPlanHome.tsx

**Bug 3 (HIGH): Payment Clearing Ghost**
- Immediate `invalidateSnapshotCache()` after table status update, before deferred cleanup
- File: pay/route.ts

**Bug 4 (MEDIUM): Version Conflict Loads Wrong Order**
- Active-order guard — only refetch if 409's orderId matches current active order
- File: order-version.ts

**Bug 5 (MEDIUM): 409 Adoption Missing Version Sync**
- Server includes `existingOrderVersion` in 409 response; client syncs version on adoption
- Files: useActiveOrder.ts, orders/route.ts

### Bug Fixes

| Fix | Severity | Impact |
|-----|----------|--------|
| Draft promise race | CRITICAL | Rapid table clicks caused stale draft POST responses to overwrite the active order. Generation counter discards stale responses. |
| Fetch callback overwrites wrong table | CRITICAL | Overlapping fetch callbacks overwrote the current table's order with a previous table's data. LoadId ref counter discards stale fetches. |
| Payment clearing ghost | HIGH | Floor plan showed ghost occupied state after payment due to stale snapshot cache. Immediate invalidation after table status update. |
| Version conflict loads wrong order | MEDIUM | 409 handler refetched wrong order if user had switched tables. Active-order guard checks orderId match. |
| 409 adoption missing version sync | MEDIUM | Adopted orders had no version, causing immediate 409 on next mutation. Server now returns version in 409 response. |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Draft race prevention | 414 | Generation counter prevents stale draft responses |
| Fetch callback guard | 414 | LoadId ref prevents stale table fetch overwrites |
| Immediate cache invalidation on pay | 414 | Ghost table state eliminated |
| Active-order 409 guard | 414 | Version conflicts on wrong table ignored |
| 409 adoption version sync | 414 | Adopted orders get correct version from server |

### Known Issues / Next Steps

- Wave 2 candidates: Split payment UX, void/refund flow polish, CFD receipt display
- Payment timing data needs dashboard visualization (future)

---

## 2026-02-23 — Payment UX & Safety Wave 1

**Version:** `1.0.0-beta`
**Session theme:** Payment flow UX overhaul — inline status, failure recovery, CFD tip screen, backend safety hardening

**Summary:** Multi-agent sprint (Skill 413) overhauling all payment-adjacent UX flows. Replaced full-screen blockers with inline status indicators across Send, Start Tab, Pay/Close. Added 3-state Send button (Idle → Sending → Sent) with bgChain failure revert. Start Tab now shows inline "Authorizing card..." with 15s slow-reader warning. Add To Tab listens for `tab:updated` socket events for real-time increment/failure feedback. Pay/Close locks controls inline with spinner (order remains visible). Full CFD tip screen rework: order summary, preset tip buttons (% or $), custom tip with numeric keypad, confirm CTA with live total, disconnect overlay with auto-reconnect. Backend safety audit: close-tab double-capture prevention, open-tab timeout recovery (pending_auth → open), structured `[PAYMENT-SAFETY]` logs, version increment verified on all 5 payment routes. New payment-timing.ts instrumentation module for production latency monitoring.

### Changes Summary

**UX: Send to Kitchen — Optimistic UI**
- 3-state button: Idle → Sending... → ✓ Sent! (1.5s green flash)
- bgChain failure revert: items marked unsent on background failure
- Files: useActiveOrder.ts, OrderPanelActions.tsx

**UX: Start Tab — Inline Status**
- Inline "Authorizing card..." (no full-screen blocker)
- 15s slow-reader timeout warning, green success flash, red decline text
- File: PaymentModal.tsx

**UX: Add To Tab — Background Indicator**
- Socket listener for tab:updated events
- Amber "Card limit reached" on increment_failed, silent update on success
- File: PaymentModal.tsx

**UX: Pay/Close — Locked Controls**
- Inline "Processing payment..." with spinner, controls locked, order visible
- idempotencyKey, version check + 409 handling, double-click prevention verified
- File: PaymentModal.tsx

**CFD: Tip Screen Rework**
- Order summary (subtotal, tax, total) at top
- Tip preset buttons (% or $) with visual selection
- No Tip + Custom tip with numeric keypad
- Confirm CTA with live total, disconnect overlay with auto-reconnect
- Files: CFDTipScreen.tsx, cfd/page.tsx, multi-surface.ts

**Backend: Safety Audit**
- close-tab: double-capture prevention guard
- open-tab: timeout recovery (pending_auth → open)
- Structured [PAYMENT-SAFETY] logs in all catch blocks
- Version increment verified on all 5 payment routes
- Files: pay/route.ts, open-tab/route.ts, auto-increment/route.ts, close-tab/route.ts

**Instrumentation: Payment Timing**
- New payment-timing.ts: 4-timestamp flow measurement
- Wired into Send, Cash Pay, Card Pay, Start Tab
- Structured [PAYMENT-TIMING] JSON logs with deltas
- File: payment-timing.ts

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `e69d5b3` | Payment UX & Safety Wave 1 (15 files, 976 insertions) |
| `2931b18` | Fix TABLE_OCCUPIED error — client adopts existing order on 409 |

### Bug Fixes

| Fix | Commit | Impact |
|-----|--------|--------|
| TABLE_OCCUPIED 409 had no client recovery | `2931b18` | Walk-in table lock (from A+ Polish `685eb61`) returned 409 but client had no handler. Now adopts existing order, appends local items, shows "Joined existing order" toast. |

### Features Delivered

| Feature | Skill | Summary |
|---------|-------|---------|
| Send Button Optimistic UI | 413 | 3-state Send, failure revert |
| Inline Start Tab Status | 413 | No blocker, timeout warning, decline recovery |
| Tab Increment Feedback | 413 | Socket-driven amber/silent indicators |
| Locked Pay/Close Controls | 413 | Inline spinner, idempotency verified |
| CFD Tip Screen | 413 | Full rework with presets, custom, disconnect overlay |
| Backend Safety Guards | 413 | Double-capture, timeout recovery, structured logs |
| Payment Timing Probes | 413 | 4-phase latency instrumentation |
| TABLE_OCCUPIED Client Recovery | 413 | 409 adoption path for walk-in table lock |

### Known Issues / Next Steps

- Wave 2 candidates: Split payment UX, void/refund flow polish, CFD receipt display
- Payment timing data needs dashboard visualization (future)
- Tab increment socket events require Datacap integration testing on real hardware

---

## 2026-02-23 — A+ Polish: Safety & Reliability Sprint

**Version:** `1.0.0-beta`
**Session theme:** Pre-launch hardening — optimistic concurrency, denormalization, caching, crash resilience, socket cleanup

**Summary:** Multi-agent sprint completing 10 tasks across 6 domains. Added `Order.version` optimistic concurrency checking to all mutation routes (items, comp-void, discount, send, pay, split, merge, transfer, seating, close-tab, bottle-service). Walk-in table double-claim now uses DB partial unique index as storage-layer safety net. Denormalized `itemCount` and `bottleServiceCurrentSpend` on Order (Performance Wins #5 and #8 — all 10 now complete). Added 5-minute payment settings cache. Resolved orphaned socket events (4 emitters with no listeners cleaned up). Implemented crash-resilient unsent items persistence via localStorage. Updated 3 architecture docs with new guarantees.

### Changes Summary

**Safety: Order Version Checking**
- All order mutation routes now validate `Order.version` before write; stale version returns 409 Conflict
- Client receives current version in response for retry
- Routes: items, comp-void, discount, send, pay, split, merge, transfer, seating, close-tab, bottle-service

**Safety: Walk-in Table Double-Claim Lock**
- DB partial unique index `Order_tableId_active_unique` prevents two active orders on same table at storage layer
- Application-level 409 with `TABLE_OCCUPIED` error code
- **Client-side recovery added later** (commit `2931b18`): client now adopts existing order on 409 instead of failing — see Payment UX entry above

**Performance: Denormalize itemCount (Win #5)**
- `itemCount Int @default(0)` on Order model
- Updated in items, comp-void, split, merge routes
- Snapshot and list views read field directly (no COUNT subquery)

**Performance: Denormalize bottleServiceCurrentSpend (Win #8)**
- `bottleServiceCurrentSpend Decimal? @default(0) @db.Decimal(10,2)` on Order model
- Updated in items, comp-void, bottle-service routes; snapshot reads field with subtotal fallback
- Note: value equals subtotal (no JOIN was actually eliminated; provides semantic clarity)

**Performance: Payment Settings Cache**
- `src/lib/payment-settings-cache.ts` — 5min TTL in-memory cache
- Eliminates redundant settings fetches during peak checkout volume

**Real-Time: Orphaned Socket Events Resolved**
- Identified 4 emitter-only events with no client listeners; cleaned up or connected

**Reliability: Crash-Resilient Unsent Items**
- Pending (unsent) items persisted to `localStorage` after every add/edit/remove
- On page reload: merged back into order with "Recovered X unsaved items" toast
- 100 KB safety valve prevents localStorage bloat

**Docs: Updated Architecture Docs**
- `POS-PERFORMANCE-AND-SCALE.md`: Wins #5, #8 marked done; caching inventory updated
- `412-PERFORMANCE-SPEED-WINS.md`: All 10 wins now complete (wave 2 done)
- `POS-REALTIME-AND-RESILIENCE.md`: Version checking in consistency rules; discount WEAK→MODERATE

### Known Issues / Next Steps

- Client-side `order.version` sending (task #3 in progress) — client must send version header on all mutations + handle 409 conflict with refresh/retry UX
- `location:alert` and `inventory:adjustment` socket events still have no client listeners (reserved for future features)

---

## 2026-02-23 — POS Forensic Audit: Safety + Speed

**Session theme:** Pre-deployment hardening — fix race conditions, optimize table tap speed, socket reconnect refresh, performance speed wins (top 8)

**Summary:** Full forensic audit of POS codebase using 6 research agents + 5 implementation agents. Found and fixed critical double-payment race condition (two terminals could charge same order simultaneously). Added FOR UPDATE row locks across all order mutation routes (pay, items, comp-void, send). Optimized table-tap-to-order-panel from ~2s to ~600ms via lightweight API query, parallel split-ticket fetch, and optimistic panel render from snapshot. Fixed socket reconnect stale data gap in KDS and FloorPlan. Updated Skill 110 real-time events docs. Followed up with top 8 speed wins from the performance audit: DB pool 5→25, compound indexes, KDS pagination, snapshot caching, batch queries, socket backoff, memoization, and payment circuit breaker. Scaling ceiling moves from ~10 to ~50 terminals.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `dbec3c6` | Fix order mutation race conditions: FOR UPDATE locks, idempotency, version increment |
| `d1f866d` | Optimize table tap speed + socket reconnect refresh + Skill 110 docs |
| `06acc19` | Implement top 8 speed wins from performance audit |
| `d9d29ec` | Add 3-layer deep dive docs: architecture, real-time, performance |

### Deployments

- **POS** both commits pushed to `main` → Vercel auto-deploy to `barpos.restaurant` / `*.ordercontrolcenter.com`

### Features Delivered

**Order Mutation Race Condition Fixes (Skill 409)**
- Pay route: status guard in transaction (409 if already paid), server-side idempotency key via `crypto.randomUUID()`, version increment
- Items route: FOR UPDATE lock on order row, status check inside transaction, 409 on non-modifiable order
- Comp-void route: FOR UPDATE lock serializes with pay route, 409 on settled orders
- Send route: version increment on every send (FOR UPDATE lock already existed)

**Table Tap Performance (Skill 410)**
- `?view=panel` lightweight query — excludes payments, pizzaData, ingredientModifications
- Parallel split-ticket fetch via `Promise.all` when status known from snapshot
- Optimistic panel render — show snapshot header instantly, items load in background
- Estimated savings: 600-1000ms (2s → 600-800ms)

**Socket Reconnect Refresh (Skill 411)**
- KDS: `loadOrders()` on socket reconnect
- FloorPlan: `loadFloorPlanData()` on reconnect (skips initial connect)
- Hardware health page: 30s polling gated by `isConnected`
- Skill 110 docs: status PARTIAL → DONE, all 15+ socket events documented

**Performance Speed Wins (Skill 412)**
- Win #1: DB connection_limit 5→25 (env-driven via `DB_POOL_SIZE`)
- Win #2: Compound index `@@index([locationId, status, kitchenStatus])` on OrderItem
- Win #3: KDS pagination take:50 with cursor-based paging (both main + expo routes)
- Win #4: Floor plan snapshot cache (5s TTL, invalidated on table edits via socket-dispatch)
- Win #6: Batch business day queries (parallel indexed queries replace OR scans)
- Win #7: Socket reconnect throttling (5s max delay, 0.5 jitter factor)
- Win #9: Memoize `calculateOrderTotals()` (20-entry cache with input hash)
- Win #10: Payment processor circuit breaker (5s timeout on PayApiClient)
- Deferred: Win #5 (denormalize itemCount) and Win #8 (denormalize bottleServiceCurrentSpend) — require schema migrations

### Forensic Audit Summary

| Category | Finding | Verdict |
|----------|---------|---------|
| withVenue() coverage | 348/348 routes wrapped | SOLID |
| Socket architecture | 35/36 polling instances correctly socket-gated | SOLID |
| Fire-and-forget patterns | All side effects non-blocking | SOLID |
| Input validation | Zod on all critical mutations | SOLID |
| Double payment race | Two terminals could charge same order | FIXED (Skill 409) |
| Order state races | Items on paid orders, void during payment | FIXED (Skill 409) |
| Table tap speed | ~2s delay from heavy query + sequential fetches | FIXED (Skill 410) |
| Socket reconnect gap | KDS/FloorPlan stale after reconnect | FIXED (Skill 411) |
| Hardware health polling | Unconditional 30s poll, no socket gate | FIXED (Skill 411) |

### Known Issues / Next Steps

- Client-side version checking (send `order.version` with every mutation, 409 on mismatch) — follow-up task, needs consistent implementation across all routes + client stores
- POS `package.json` version still `0.1.0` — needs bump to match release v1.0.29
- `location:alert` and `inventory:adjustment` socket events emitted but no client listeners yet

---

## 2026-02-23 — Mission Control Fleet Fixes (Cross-Repo Session)

**Session theme:** Fleet ops — fix staff visibility, heartbeat validation, server hostname, decommissioned server UX

**Summary:** Six Mission Control skills completed in one session. Staff users (SUB_ADMIN) couldn't see fleet data because dashboard pages checked for exact `SUPER_ADMIN` match instead of using the `isStaffRole()` helper. Heartbeat broke after NUC re-install because the extended heartbeat.sh sends batch fields as `null` but Zod `.optional()` rejects `null`. Added hostname auto-population from heartbeat + inline rename. Collapsed decommissioned servers into toggle section. Filtered decommissioned servers from locations and fleet queries.

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `14a648d` | Complete server decommission: revoke credentials, expire commands, send fleet command |
| `d45951f` | Normalize all admin emails to lowercase on create, update, and lookup |
| `06f16eb` | Fix decommission button visibility for staff users |
| `4bb309c` | Use isStaffRole() for all dashboard role checks |
| `114910a` | Fix heartbeat Zod schema: accept null for batch fields |
| `513e539` | Server hostname from heartbeat, click-to-rename, collapsed decommissioned |
| `9b6718e` | Exclude decommissioned servers from locations list and fleet dashboard |

### Deployments

- **MC** all commits pushed to `main` → Vercel auto-deploy to `app.thepasspos.com`

### Features Delivered

**Server Decommission (MC-013)**
- `decommissionServer()` in kill-switch.ts: revoke API key, expire pending commands, send REVOKE_CREDENTIAL fleet command, audit log
- API key set to `revoked_{serverNodeId}_{timestamp}` (field is `String @unique`, can't be null)

**Email Case Normalization (MC-014)**
- `.toLowerCase()` on all 7 email entry points (auth, bootstrap, agents, team routes)
- Cleaned up duplicate AdminUser records from case mismatches

**Staff Role Consistency (MC-015)**
- Replaced `admin.role === ROLES.SUPER_ADMIN` with `isStaffRole(admin.role)` in 5 dashboard pages/components
- Fixed fleet dashboard showing zero organizations for SUB_ADMIN staff

**Heartbeat Nullable Batch Fields (MC-016)**
- Added `.nullable()` to all batch fields in heartbeat Zod schema
- Added missing `batchNo` and `currentBatchTotal` fields
- Fixed heartbeats failing with "expected string, received null"

**Server Hostname & Rename (MC-017)**
- Heartbeat sends `$(hostname)`, stored on ServerNode — auto-populates server names
- `PATCH /api/admin/servers/[id]/rename` for inline click-to-rename in Infrastructure tab
- Collapsed decommissioned servers section in ServerActions component
- Updated installer heartbeat template for future installs

**Exclude Decommissioned from Lists (MC-018)**
- Locations page and fleet dashboard filter out decommissioned servers
- Fixes locations showing "Offline / Never" when active server is heartbeating

### NUC Changes (Live Server)

- Updated `/opt/gwi-pos/heartbeat.sh` on Fruita Grill NUC (`172.16.1.254`) to send `$(hostname)`
- Installer template (`scripts/installer.run`) also updated for future installs

### Known Issues / Next Steps

- POS `package.json` still says `"version": "0.1.0"` — heartbeat reports this, causing version mismatch banner vs release v1.0.29. Needs version bump in POS repo.
- 8 servers were DECOMMISSIONED before audit logging existed (zero audit trail)
- SupportUser table has no SUPER_ADMIN type — only SUB_ADMIN and AGENT. All staff get `sub_admin` from auth (by design)

---

## 2026-02-23 — Clerk-Based Owner Access + GWI Access Gate Replacement

**Session theme:** Owner auth — enable location owners to access venues via Clerk; replace GWI access gate phone+code with Clerk email+password

**Summary:** Location owners added in Mission Control's Team tab were getting `clerkUserId: "pending_{email}"` but never receiving a Clerk invitation, so they couldn't authenticate. Fixed by sending Clerk instance-level invitations on team member creation and adding `pending_` reconciliation in `resolveAdminUserId()` to link placeholder records to real Clerk accounts on first login. Replaced the GWI Access gate on barpos.restaurant (phone number + 6-character code) with Clerk email+password login. Extracted `verifyWithClerk()` into a shared module for reuse across venue-login and the new access gate endpoint.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `9a7875b` | feat: replace GWI access gate phone+code with Clerk email+password login |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `4fea70c` | feat: send Clerk invitations for location owners and GWI access allowlist |

### Deployments

- **POS** `9a7875b` pushed to `main` → Vercel auto-deploy to `barpos.restaurant` / `*.ordercontrolcenter.com`
- **MC** `4fea70c` pushed to `main` → Vercel auto-deploy to `app.thepasspos.com`

### Features Delivered

**Clerk Invitations for Location Owners (MC)**
- `POST /api/admin/locations/[id]/team` now sends `clerk.invitations.createInvitation()` after AdminUser create/upsert
- Owners receive email invitation → create Clerk account → can log into `{slug}.ordercontrolcenter.com`
- Silently ignores "already invited" / "already exists" errors

**Pending ClerkUserId Reconciliation (MC)**
- `resolveAdminUserId()` in `src/lib/auth.ts` now checks for `pending_{email}` records when direct lookup fails
- One-time reconciliation: updates the placeholder clerkUserId to the real Clerk user ID
- Subsequent logins use the real ID directly

**Clerk Invitations for GWI Access Allowlist (MC)**
- `POST /api/admin/gwi-access/allowlist` sends Clerk invitation when email is provided in body
- Users added to the allowlist get invited to create Clerk accounts

**GWI Access Gate — Clerk Login (POS)**
- Replaced two-step phone+code flow with single-step email+password form at `/access`
- New `POST /api/access/clerk-verify` endpoint verifies credentials via Clerk FAPI and sets `gwi-access` cookie
- `src/lib/access-gate.ts` rewritten: email-based JWT tokens, removed all OTP/phone functions
- Extracted `verifyWithClerk()` to `src/lib/clerk-verify.ts` (shared by venue-login and access gate)
- Removed dead routes: `/api/access/request`, `/api/access/verify`
- Middleware token refresh updated to use `accessPayload.email`

### Files Changed

| Repo | File | Action |
|------|------|--------|
| POS | `src/lib/clerk-verify.ts` | New — shared Clerk FAPI verification module |
| POS | `src/lib/access-gate.ts` | Rewrite — email-based tokens, removed OTP/phone |
| POS | `src/app/access/page.tsx` | Rewrite — email+password form |
| POS | `src/app/api/access/clerk-verify/route.ts` | New — Clerk verify + cookie endpoint |
| POS | `src/app/api/auth/venue-login/route.ts` | Edit — import from shared clerk-verify |
| POS | `src/app/api/admin/access-allowlist/route.ts` | Edit — inlined normalizePhone |
| POS | `src/middleware.ts` | Edit — email-based token refresh |
| POS | `src/app/api/access/request/route.ts` | Deleted — dead phone verification |
| POS | `src/app/api/access/verify/route.ts` | Deleted — dead OTP verification |
| MC | `src/app/api/admin/locations/[id]/team/route.ts` | Edit — send Clerk invitation |
| MC | `src/lib/auth.ts` | Edit — pending_ reconciliation |
| MC | `src/app/api/admin/gwi-access/allowlist/route.ts` | Edit — send Clerk invitation |

### Known Issues / Next Steps
- GWI Access allowlist POST body currently expects phone+name; MC dashboard UI for GWI Access may need updating to collect email instead of (or in addition to) phone
- Existing gwi-access cookies with `phone` payload will fail verification after deploy — users will be redirected to `/access` to re-authenticate with email+password (expected, no data loss)

---

## 2026-02-21 — NUC Fleet Recovery + Sync Agent Self-Update

**Session theme:** Fleet ops — diagnose and fix NUC deployment failures; add self-healing sync agent boot mechanism

**Summary:** Three NUC demo stations were failing FORCE_UPDATE with "git pull failed". Root-caused via SSH to AdminDemo1 (172.16.20.58): old sync agents silently ignore unknown commands, no .git-credentials file, git in merge conflict state, and missing INTERNAL_API_SECRET env var causing npm run build to throw at module level. Fixed AdminDemo1 directly via SSH. Built full remote repair system in Mission Control (REPAIR_GIT_CREDENTIALS command, bootstrap/full-deploy injection modes, Repair Git UI button). Added boot-time self-update to sync agent so NUCs automatically stay current on every reboot. Fixed installer to generate INTERNAL_API_SECRET. Removed module-level throw from datacap/sale that was crashing all NUC builds. Fixed online ordering local preview link using wrong locationId.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `842adb3` | Include actual git error in FORCE_UPDATE failure response |
| `a21feaa` | Sync agent boot self-update + fix NUC build failures |
| `3e1c1e8` | Fix sync agent boot-update edge cases + add local preview link |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| (deployed to Vercel) | REPAIR_GIT_CREDENTIALS command type in schema; repair-credentials API endpoint; Repair Git + Full Deploy UI in ServerActions |

### Features Delivered

**Skill 407 — NUC Remote Git Repair**
- New `REPAIR_GIT_CREDENTIALS` fleet command in sync-agent.js (new agents): writes token to .git-credentials, verifies with git fetch
- `POST /api/admin/servers/[id]/repair-credentials` (MC, super_admin only): three modes — normal (REPAIR_GIT_CREDENTIALS), bootstrap (SCHEDULE_REBOOT shell injection for old agents), full deploy (entire pipeline in background)
- "Repair Git" + "Full Deploy" buttons in MC ServerActions per server row (super_admin only)

**Skill 408 — Sync Agent Boot Self-Update**
- `checkBootUpdate()` runs on every sync agent startup before connecting to MC
- Downloads latest sync-agent.js from GitHub using stored .git-credentials token
- Atomically replaces file and exits if content differs — systemd restarts with new version
- Falls through silently on any error (no credentials, network down, timeout, empty response)
- settled guard prevents double-start from timeout + error handler both firing

**Skill 409 — Modifier Group Direct Ownership Migration**
- Eliminated `MenuItemModifierGroup` junction table from schema
- Added `showOnline` directly to `ModifierGroup` (data-migrated from junction rows)
- Switched all read paths to `ownedModifierGroups`: `GET /api/menu`, `GET /api/menu/items/[id]`, `GET /api/online/menu`
- Updated write path: `showOnline` toggle writes to `ModifierGroup` directly
- Fixed root cause of online ordering showing items with no modifier groups

### Bug Fixes

| Bug | Fix |
|-----|-----|
| NUC `npm run build` failing with "INTERNAL_API_SECRET required in production" | Removed module-level throw from `src/app/api/datacap/sale/route.ts`; added INTERNAL_API_SECRET auto-generation to installer.run (new + backfill) |
| Online ordering `/order?locationId=10c-1` returning no items | Wrong locationId in URL (real ID is `loc-1`); added local preview link to settings/online-ordering page showing correct URL |
| AdminDemo1 git merge conflict blocking all deployments | Fixed via SSH: `git reset --hard HEAD`; wrote .git-credentials; full rebuild and restart |

### Known Issues / Next Steps
- Fruita Grill and Shanes Admin Demo still need physical access (one visit) to run `installer.run` with re-register option, after which self-update handles everything going forward
- Rotate GitHub PAT shared during session (ghp_leRwO6Vy...) after off-site NUCs are fixed

---

## 2026-02-20 — Pour Size Deduction Fix (Session 14)

**Session theme:** T-006 — pour size multiplier flows all the way to inventory deduction

**Summary:** Pour size selection (shot/double/tall/short) was being applied to pricing but silently dropped before inventory deduction. Added `pourSize` + `pourMultiplier` fields to OrderItem schema, wired them through the store → hook → API chain, and applied the multiplier in both the MenuItemRecipe and liquor RecipeIngredient deduction paths. Zero schema breaking changes (nullable fields). `npx prisma db push` required on NUC deploy.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `cf8c898` | feat(inventory): T-006 — store pourMultiplier on OrderItem, apply in deduction engine |

### Features Delivered

**T-006** — 7 files, 32 insertions. OrderItem.pourSize/pourMultiplier fields added. Frontend passes them through addItem/updateItem. API stores them. Deduction engine applies `pourMult` in MenuItemRecipe path and liquor RecipeIngredient path. Modifier paths unchanged (pre-modifier multipliers remain independent).

### Resolved Task Board Items
T-006

---

## 2026-02-20 — Mobile Auth Security Fix (Session 13)

**Session theme:** T-025 — remove backwards-compat ?employeeId query param bypass from mobile bartender tabs

**Summary:** The `?employeeId` query param auth bypass was the last security hole in the mobile device auth flow. Both mobile/tabs/page.tsx and mobile/tabs/[id]/page.tsx now unconditionally call `checkAuth()` on mount, requiring a valid httpOnly session cookie. RegisteredDevice + MobileSession infrastructure already in place.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `d1868b3` | fix(security): T-025 — remove ?employeeId auth bypass from mobile tabs |

### Features Delivered

**T-025** — `searchParams.get('employeeId')` removed from mobile/tabs/page.tsx and mobile/tabs/[id]/page.tsx. `checkAuth()` always called on mount. Invalid/expired session → redirect to `/mobile/login`. 2 files, ~18 lines removed.

### Resolved Task Board Items
T-025

---

## 2026-02-20 — T-001/T-050/T-017 Cleanup Sprint (Session 12)

**Session theme:** Seed data cleanup, CSS optimization, inventory verification, inventory engine deferral

**Summary:** T-001 links all Ranch ingredient variants to shared InventoryItem in seed.ts. T-050 adds `optimize: true` to postcss for dev/prod CSS parity. T-017 verified code-complete (Skill 291 already fixed root causes). T-011 deferred post-MVP (10-17d data migration, HIGH risk).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `12da703` | fix(css): T-050 — optimize: true in @tailwindcss/postcss |
| `4870737` | fix(seed): T-001 — link Ranch/RanchDressing/RanchDrizzle to inv-ranch-dressing-001 |

### Resolved Task Board Items
T-001, T-050, T-017 (code-complete), T-014 (verified already done), T-011 (deferred)

---

## 2026-02-20 — Inventory Engine Sprint: T-002/T-004/T-014 (Session 11)

**Session theme:** Inventory deduction hardening — prep item explosion, unit mismatch warnings, bulk move verified

**Summary:** Three inventory tasks cleared. T-002 adds prep item explosion to Path B modifier deductions. T-004 adds unit mismatch warnings at link-time (API + toast) and deduction-time. T-014 verified already complete.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `19ebc15` | feat(inventory): T-004 — unit mismatch warning on modifier→ingredient links |
| `b71b8fe` | feat(inventory): T-002 — prep item explosion for modifier deductions (Path B) |

### Features Delivered

**T-002** — Modifier→PrepItem deductions now explode to raw sub-ingredients. `ORDER_INVENTORY_INCLUDE` includes `prepItem.ingredients.inventoryItem`. Path B: `else if (ingredient?.prepItem)` calls `explodePrepItem()`. 1 file, 32 lines.

**T-004** — `inventory-link` API returns non-blocking `warning` field on cross-category UOM. `useModifierEditor` shows 8s `toast.warning`. Path A+B log `console.warn` with context on null conversion.

**T-014** — Verified complete (already wired). No change needed.

### Resolved Task Board Items
T-002, T-004, T-014

---

## 2026-02-20 — T-071/T-072 Online Ordering Routing + Pages (Session 10)

**Session theme:** Customer-facing online ordering — middleware bypass + dynamic `/{orderCode}/{slug}/` route

**Summary:** T-071 and T-072 shipped. Middleware now bypasses cloud auth for `/:orderCode/:slug` paths. New public `resolve-order-code` endpoint resolves slug → locationId with backward-compatible onlineOrderingEnabled check. Full 3-step online ordering flow (menu → cart → Datacap payment) available at `/{orderCode}/{slug}/` using Next.js 15 async params. Zero TypeScript errors.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `34e237b` | feat(online-ordering): T-071 + T-072 — middleware routing + customer ordering pages |

### Features Delivered

**T-071** — Middleware bypass for `/:orderCode/:slug` and `/api/online|public/*` paths. Runs before cloud auth, sets `x-venue-slug` header, passes through unauthenticated. All existing admin auth untouched.

**T-072** — `src/app/[orderCode]/[slug]/page.tsx` (962 lines): full online ordering flow using `use(params)` for Next.js 15 async params. Calls `GET /api/public/resolve-order-code?slug=X` on mount. Error + not-found pages included. `onlineOrderingEnabled` defaults to allowed if key absent (backward compat).

### Resolved Task Board Items
T-071, T-072

### Known Issues / Blockers
- `Location.settings.onlineOrdering.enabled` key not yet populated — online ordering defaults to allowed for all venues. Need to add toggle in POS settings UI (future task).
- T-046: Socket end-to-end — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — T-042/T-073/T-075 Multi-Repo Sprint (Session 9)

**Session theme:** Multi-select pre-modifiers (gwi-pos), QR code generation + environment field (gwi-mission-control)

**Summary:** Three tasks shipped across two repos. T-042 uses compound string format to enable multi-select pre-modifiers ("side,extra") with zero schema change. T-073 adds QR code display/download for venue order codes in MC. T-075 adds a deployment environment field to CloudLocation with grouped deploy modal UX.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `77c1de6` | feat(orders): T-042 — multi-select pre-modifiers via compound string format |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `f06611e` | feat(locations): T-073 QR code generation + T-075 environment field |

### Features Delivered

**T-042** — Pre-modifiers now support combinations ("Side Extra Ranch"). Compound string `"side,extra"` stored in existing `preModifier String?` field. Toggle helpers, colored badges per token in OrderPanelItem, compound-aware print/KDS/inventory paths. 12 files, no schema change.

**T-073** — QrCodeModal with 256px canvas QR, Download PNG, and Print actions. "Generate QR Code" button in VenueUrlCard when orderCode exists.

**T-075** — `LocationEnvironment` enum + field on CloudLocation (prisma db push applied). EnvironmentSelector segmented control in location detail page. Deploy modal groups locations by Production/Staging/Development sections with color-coded headers.

### Resolved Task Board Items
T-042, T-073, T-075

### Known Issues / Blockers
- T-071/T-072 (online ordering routing + pages) — build in progress
- T-046: Socket end-to-end — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — T-013 Modifier Multipliers (Session 8)

**Session theme:** Per-modifier Lite/Extra multiplier overrides in Item Builder and inventory deduction engine

**Summary:** T-013 shipped. Added `liteMultiplier` and `extraMultiplier` nullable Decimal fields to Modifier model. Item Builder now shows inline `×` multiplier inputs beside Lite/Extra toggles. Deduction engine applies per-modifier overrides, falling back to location-level defaults. `prisma db push` run to add columns.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `63d72ca` | feat(menu): T-013 — per-modifier liteMultiplier/extraMultiplier in Item Builder |

### Features Delivered

**T-013** — Modifier model gains `liteMultiplier`/`extraMultiplier` (nullable Decimal). Item Builder shows `×` inputs next to Lite/Extra toggles. POST/PUT modifier API persists + returns new fields. `formatModifierGroup()` includes them in responses. Deduction engine applies per-modifier multiplier override with location-default fallback (0.5/2.0).

### Resolved Task Board Items
T-013

### Known Issues / Blockers
- T-046: Socket end-to-end validation — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device
- T-026: Card token persistence — needs live Datacap hardware

---

## 2026-02-20 — T-021/022/034/036 + Task Board Cleanup (Session 7)

**Session theme:** Clear remaining P1/P2 items — normalizeCoord hardening, soft-delete audit, batch close UI, tip adjustment report

**Summary:** Four more tasks shipped. T-034 adds fail-fast dev behavior and context-aware logging to `normalizeCoord`. T-036 fixes two missing `deletedAt: null` guards in floor-plan-elements. T-021 ships the Batch Settlement card in settings. T-022 ships the Tip Adjustment report with live Datacap gratuity adjust. Task board cleaned up (duplicates removed, T-023/T-048 back-filled).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b3442a6` | fix(floor-plan): T-034 + T-036 — normalizeCoord context logging + soft-delete guards |
| `aedfad2` | docs: task board — mark T-023/034/036/048 complete, remove duplicate rows |
| `7fe7fb5` | feat(settings): T-021 — Batch Settlement card in settings/payments |
| `0beee97` | feat(reports): T-022 — Tip Adjustment report with per-row Datacap gratuity adjust |

### Features Delivered

**T-034** — `normalizeCoord` now throws in dev on invalid coords (fail-fast). Prod logs tableId+action context. bulk-update route passes context.

**T-036** — Audited 22 DB queries across floor plan routes. Fixed 2 missing `deletedAt: null` in floor-plan-elements POST (menuItem + section validation).

**T-021** — Batch Settlement card in settings/payments: reader selector, live batch summary preview modal, Confirm & Close Batch flow with SAF warning.

**T-022** — `/reports/tip-adjustment`: date-range filter, 3 summary cards, per-row inline Datacap gratuity adjust, disabled for SAF/offline payments, optimistic state update.

### Resolved Task Board Items
T-021, T-022, T-034, T-036 (plus back-filled T-023, T-048)

### Known Issues / Blockers
- T-080 Phase 6: Backoffice surcharge reports (gwi-backoffice) — not yet started
- P1-05: Socket multi-terminal validation — needs Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — P0/P1 Bug Sprint + T-080 Full Stack + T-016 UI Polish (Session 6)

**Session theme:** Button up all remaining sprint items — P0 floor plan bugs, T-079 partial payments, T-077 EOD, T-080 all phases (POS + MC + receipts), T-016 glassmorphism lift

**Summary:** Cleared all P0 floor plan deployment blockers (T-031, T-032, T-033, T-044), fixed partial payment void-and-retry flow, shipped EOD manager socket notifications, completed T-080 pricing program across all three layers (MC admin UI, POS checkout, receipts/print), and polished the POS ordering interface with glassmorphism throughout.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `423febb` | fix(floor-plan): T-031/033 — remove hot-path console.error, add toast + rollback |
| `ef9eb04` | fix(payments): T-079 — Void & Retry auto-return + split-tender progress banner |
| `87b0a09` | feat(eod): T-077 — EOD businessDay logic fix + socket notification + summary overlay |
| `9a8c423` | feat(pricing): T-080 Phase 3+5 — surcharge line item in checkout + receipts |
| `ac292bf` | feat(ui): T-016 — glassmorphism polish on POS ordering interface |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `7c13ecf` | feat(pricing): T-080 Phase 2 — PricingProgramCard MC admin UI |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**P0 Floor Plan Fixes** (`423febb`)
- T-031: Removed `console.error` from 5 hot-path handlers (handlePointerUp, handleTableUpdate, handleSeatDrag, handleMoveTable, handleRotateTable) → replaced with `toast.error()`
- T-033: Optimistic rollback added to handlePointerUp (`prevTables` snapshot + restore on catch); `response.ok` check before applying server state
- T-032: Verified deterministic grid placement already in place (no Math.random) — no change needed
- T-044: Verified VOID/COMP stamps correctly render on FloorPlanHome — no change needed

**Partial Payment Fixes** (`ef9eb04`)
- T-079: After Void & Retry succeeds, `onCancel()` called automatically → returns to method selection (no manual dismiss required)
- Split-tender progress banner shows when `pendingPayments.length > 0` ("X of Y payments captured")

**EOD Reset Improvements** (`87b0a09`)
- T-077: `eod-cleanup` route now uses `businessDayDate` OR `createdAt` fallback — consistent with `eod/reset` business day logic
- `eod/reset` emits `eod:reset-complete` socket event with stats after reset
- FloorPlanHome listens for `eod:reset-complete` → toast + `refreshAll()` + dismissable overlay (bottom-right)

**T-080 Phase 3+5 — Surcharge in Checkout + Receipts** (`9a8c423`)
- `useOrderSettings`: exposes `pricingProgram` from location settings cache
- `usePricing`: computes `surchargeAmount` via `calculateSurcharge()` when model=surcharge and method≠cash
- `PaymentModal`: surcharge line item ("Credit Card Surcharge (X%): +$X.XX") + disclosure text visible before confirm
- `Receipt.tsx`: surcharge row between discount and tax; disclosure text above footer
- `print-factory`: ESC/POS surcharge line + disclosure text on thermal receipts
- `daily-report-receipt` / `shift-closeout-receipt`: optional `surchargeTotal` line in revenue/sales sections

**T-080 Phase 2 — MC Pricing Admin UI** (`7c13ecf` in gwi-mission-control)
- `PricingProgramCard.tsx` (750 lines): replaces CashDiscountCard
- 6-pill model selector (none, cash_discount, surcharge, flat_rate, interchange_plus, tiered)
- Conditional form fields per model; surcharge shows CT/MA/PR compliance warning + 3% cap validation
- `buildInitialState()` backward-compat from legacy `dualPricing` settings
- Saves as `settings.pricingProgram` via existing deep-merge endpoint
- `LocationSettings` type + `PricingProgram` interface added to `venue-settings.ts`

**T-016 Glassmorphism UI Polish** (`ac292bf`)
- `FloorPlanMenuItem`: `backdrop-blur(12px)`, elevated box shadows, indigo hover glow
- `OrderPanel`: `backdrop-blur(16px)` on main panel; seat group headers get accent left-border (indigo selected, seat-color otherwise)
- `CategoriesBar`: `blur(10px)` backdrop + bottom border; active category gets glow shadow
- `ModifierGroupSection`: required/optional badges ("• Required" / "• Optional") + left-border CSS classes
- `ModifierModal`: "📝 Special Instructions" label + focus/blur border color transitions

### Resolved Task Board Items
T-016, T-031, T-032 (verified), T-033, T-044 (verified), T-047 (verified), T-077, T-079, T-080 (Phases 1–5)

### Known Issues / Blockers
- T-080 Phase 6: Backoffice reports (gwi-backoffice) — surcharge tracking in cloud reports. Not yet started.
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- T-049: KDS full flow on Chrome 108 — needs physical KDS device

---

## 2026-02-20 — Full Feature Sweep: All Remaining P1 Tasks (Session 5)

**Session theme:** Clear all remaining backlog items — settings UI, orders manager, pricing engine, small UX fixes

**Summary:** Seven more tasks cleared in a parallel build sprint. All P0 and most P1 items from the backlog are now resolved. T-080 (Pricing Programs) Phase 1+4 shipped; Phases 2/3/5/6 remain for future sessions (Phase 2 is in gwi-mission-control repo).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b91bf0b` | fix(ux): T-038/039/052/053 — layout timing, Quick Pick toggle, hydration guard |
| `353dd07` | feat(orders): T-078 — Open/Stale Orders Manager admin page |
| `63c41dd` | feat(settings): T-045 — Walkout Recovery + AutoReboot UI sections |
| `d295212` | feat(pricing): T-080 Phase 1+4 — multi-model pricing engine + settings viewer |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**Small UX Fixes** (`b91bf0b`)
- T-038: usePOSLayout now guards behind employeeId before fetching layout — no more "Failed to fetch" on first render
- T-039: Quick Pick Numbers toggle added to gear dropdown in UnifiedPOSHeader; fixed pre-existing bug (quickBarEnabled was toggling quickPickEnabled)
- T-052: Verified quickPickEnabled default already true
- T-053: Added useAuthenticationGuard to floorplan/editor; other admin pages already had it

**Open/Stale Orders Manager** (`353dd07`)
- New `/orders/manager` admin page: filter by status, balance, rolled-over state, text search
- Table shows order age (human-readable), status badges, rolled-over + capture-declined flags
- Bulk Cancel (drafts/$0) + Bulk Void (has balance) with permission check
- Detail modal: full order info, reassign table dropdown, item list with modifiers
- Socket listener (debounced 300ms) for real-time updates
- GET /api/orders: new dateFrom/dateTo/balanceFilter/includeRolledOver params
- POST /api/orders/bulk-action: cancel action (pre-flight rejects pre-auth orders)
- "Open Orders" nav link added to AdminNav (managers only)

**Settings UI Completions** (`63c41dd`)
- Walkout Recovery sub-section: enable toggle, retry frequency, max duration, idle timeout
- AutoReboot card: nightly reboot toggle + delay-minutes input
- Verified Price Rounding toggles + all TipBank advanced sections already existed

**Pricing Program Engine** (`d295212`)
- PricingProgram interface: 6 models (cash_discount, surcharge, flat_rate, interchange_plus, tiered, none)
- New functions: calculateSurcharge(), calculateSurchargeTotal(), calculateFlatRateCost(), calculateInterchangePlusCost(), calculateTieredCost(), isSurchargeLegal() (CT/MA/PR banned), applyPricingProgram() strategy selector
- getPricingProgram() backward-compat helper: reads new field, falls back to legacy dualPricing
- Settings viewer: "Processing Program" card shows all 5 models with color-coded badge + model-specific details
- All existing pricing functions unchanged

### Resolved Task Board Items
T-038, T-039, T-045, T-052, T-053, T-078, T-080 (Phase 1+4)

### Known Issues / Blockers
- T-080 Phases 2/3/5/6 remain: MC admin UI (separate repo), POS checkout surcharge display, receipts, backoffice reports
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- T-049: KDS full flow on Chrome 108 — needs physical KDS device

---

## 2026-02-20 — P0/P1 Bug Sprint (Session 4)

**Session theme:** Clear deployment blockers + high-priority payment and order fixes

**Summary:** Cleared all P0 floor plan deployment blockers, fixed partial payment flow bugs, improved EOD reset with manager notifications. Also shipped Online Ordering Phase 5 and Shift Swap Phase 2 earlier this session (see commits below).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `7ff4658` | feat(scheduling): Shift Swap Phase 2 — admin panel + mobile UI |
| `325c044` | feat(online-ordering): Phase 5 — customer order page + Datacap PayAPI checkout |
| `0bc5857` | docs: update Living Log |
| `423febb` | fix(floor-plan): T-031/T-033 — remove hot-path console.error, add toast + rollback |
| `ef9eb04` | fix(payments): T-079 — partial payment flow fixes |
| `87b0a09` | feat(eod): T-077 — EOD manager notification + eod-cleanup businessDay fix |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**Shift Swap Phase 2** (`7ff4658`)
- Admin: swap request modal, per-shift icon, Swap Requests panel with approve/reject
- Mobile: incoming swap requests section, outgoing swap request sheet

**Online Ordering Phase 5** (`325c044`)
- Public `/order` page: 3-step flow (menu → cart/customer info → Datacap iFrame checkout)
- `GET /api/online/menu` + `POST /api/online/checkout` (PayAPI, status `received` on approval)

**Floor Plan P0 Fixes** (`423febb`)
- T-031: Removed console.error from 5 hot-path handlers (drag, seat drag, rotate, move, update)
- T-032: Verified deterministic grid placement already in place (Math.random gone)
- T-033: Added toast.error + optimistic rollback (prevTables restore) to all 5 handlers; response.ok guard in handlePointerUp
- T-044: Verified VOID/COMP stamps, voidReason, wasMade all correctly wired

**Partial Payment Fixes** (`ef9eb04`)
- T-047: Verified dispatchOpenOrdersChanged already in both void routes
- T-079: Void & Retry now auto-returns to method selection after void; Payment Progress banner shows collected + remaining when pendingPayments > 0

**EOD Reset Improvements** (`87b0a09`)
- T-077: eod-cleanup now uses businessDayDate instead of midnight UTC cutoff
- eod/reset emits `eod:reset-complete` socket event with stats payload
- FloorPlanHome shows dismissable EOD Summary overlay (cancelled drafts, rolled orders, tables reset) + auto-refreshes table statuses

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| console.error in drag/rotate hot paths | Removed from 5 handlers in UnifiedFloorPlan.tsx | `423febb` |
| Floor plan drag failure: no user feedback | toast.error + state rollback on API failure | `423febb` |
| Void & Retry left staff in limbo | onCancel() called after void to return to method selection | `ef9eb04` |
| eod-cleanup used midnight UTC not business day | Replaced with getCurrentBusinessDay() + businessDayDate filter | `87b0a09` |

### Resolved Task Board Items
T-031, T-032, T-033, T-044, T-047, T-077, T-079

### Known Issues / Blockers
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs (T-080): 5-phase surcharge/interchange+/tiered overhaul
- T-078: Open/Stale Orders Manager UI (no UI to view orders from previous days)

---

## 2026-02-20 — P3 Continued: Shift Swap Phase 2 + Online Ordering Phase 5 (Session 3)

**Session theme:** Complete Shift Swap end-to-end + ship Online Ordering Phase 5 customer checkout

**Summary:** Committed remaining Phase 1 shift swap (schema + 7 API routes from prior agent), built full Shift Swap Phase 2 (admin panel + mobile UI), and shipped Online Ordering Phase 5 — the complete customer-facing order page with Datacap hosted iFrame tokenization, 3-step checkout flow, and two new public API routes.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `2bd4c36` | feat(scheduling): Shift Swap Phase 1 — schema + 7 API routes |
| `7ff4658` | feat(scheduling): Shift Swap Phase 2 — admin panel + mobile UI |
| `325c044` | feat(online-ordering): Phase 5 — customer order page + Datacap PayAPI checkout |

### Deployments
- Pushed to `main` → Vercel auto-deploys

### Features Delivered

**Shift Swap Phase 1** (`2bd4c36`)
- New `ShiftSwapRequest` Prisma model: `pending` → `accepted` → `approved` workflow
- 7 API routes: create, list (location-wide), accept, decline, approve (with shift reassignment transaction), reject, soft-cancel (DELETE)
- `prisma db push` applied; `prisma generate` run

**Shift Swap Phase 2** (`7ff4658`)
- Admin scheduling page: swap request modal, per-shift swap icon (shown on hover), Swap Requests panel with Approve/Reject buttons
- Manager direct-approve: calls `/accept` then `/approve` in sequence (bypasses employee acceptance step)
- Mobile schedule page: "Swap Requests For You" section with Accept/Decline, outgoing swap request sheet on each swappable shift
- Mobile schedule API: `scheduleId` added to response shape (needed for swap request URL)

**Online Ordering Phase 5** (`325c044`)
- `GET /api/online/menu` — public, groups items by category, filters online-visible + orderable, includes stock status and modifier groups
- `POST /api/online/checkout` — re-validates prices server-side, generates atomic order number, creates Order + all items/modifiers in one nested write, calls `PayApiClient.sale()`, sets status `received` on approval, hard-deletes on decline (HTTP 402)
- `src/app/(public)/order/page.tsx` — 3-step flow: (1) menu browse with category tabs + item cards + stock badges + ItemModal with modifier validation + floating cart bar; (2) cart review + customer name/email/phone/notes; (3) Datacap hosted iFrame tokenizer + Place Order → success screen
- Card data never touches our servers — iFrame handles tokenization; OTU token sent to checkout API

### Known Issues / Blockers
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs: Large, 5-phase (surcharge, interchange+, tiered)

---

## 2026-02-21 — P3 Continued: PayAPI Client + Shift Swap (Session 2)

**Session theme:** Unblock Online Ordering Phase 5 (found + built Datacap PayAPI integration) + begin Scheduling Shift Swap workflow

**Summary:** Session resumed from P3 sprint. Cleared the Online Ordering Phase 5 payment blocker — Datacap PayAPI documentation was located in the project folder (`Datacap/Datacap integration/Pay Api - online ordering/`). Audited the full API spec and built a complete `PayApiClient` library. Also ran full scope audit on Scheduling Shift Swap, then launched Phase 1 build (schema + 7 API routes). Late agent notifications processed (all already committed in prior session — no duplicate work).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `4cd3024` | feat(payments): Datacap PayAPI V2 client library for online ordering + convert PayAPI docs to .txt |

### Deployments
- Pushed to `main` → Vercel auto-deploys

### Features Delivered

**Datacap PayAPI Client Library** (`4cd3024`)
- `src/lib/datacap/payapi-client.ts`: Full REST client for Datacap PayAPI V2 (card-not-present, eCommerce)
- `PayApiClient` class: `sale()`, `voidSale()`, `refund()`, `preAuth()`, `capture()`, `voidAuth()`, `getTransaction()`
- V2 Basic Auth: `Authorization: Basic BASE64(DATACAP_PAYAPI_MID:DATACAP_PAYAPI_KEY)`
- Cert URL: `https://pay-cert.dcap.com/v2/` / Prod URL: `https://pay.dcap.com/v2/`
- `PayApiError` class with HTTP status + full response for caller inspection
- Simulated mode (`DATACAP_PAYAPI_ENV=simulated`) — fake approved responses, no credentials needed for dev
- `getPayApiClient()` singleton (same pattern as existing `DatacapClient`)
- Converted PayAPI reference docs from `.docx` to `.txt` in project folder

**Client-side tokenization flow (documented, not yet built):**
- Load `https://token.dcap.com/v1/client/hosted` — Datacap hosted iFrame tokenizer
- Customer enters card in iFrame (PCI scope never touches our servers)
- `DatacapHostedWebToken.requestToken()` fires → callback receives `{ Token, Brand, Last4 }`
- Client POSTs OTU token to our checkout API → server calls `POST /credit/sale` → creates Order + Payment
- Credentials: `DATACAP_PAYAPI_TOKEN_KEY` (public, client-side) + MID + ApiKey (private, server-side)

**Shift Swap Audit (completed, build in progress):**
- `ShiftSwapRequest` model needed — `ScheduledShift` has `originalEmployeeId`/`swappedAt`/`swapApprovedBy` for tracking but no workflow model
- Full scope: 1 new schema model, 7 API routes, admin panel components, mobile pages, 4 socket events
- Phase 1 build launched: schema + all 7 API routes (in progress at session end)

### Known Issues / Blockers
- Shift Swap Phase 1 in progress at session end (schema + API routes building)
- Online Ordering Phase 5 (customer `/order` page): unblocked — PayAPI client done; still needs checkout page + Datacap iFrame tokenization UI
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs: Large, 5-phase (surcharge, interchange+, tiered)

---

## 2026-02-21 — P3 Feature Sprint (Multi-Agent Team)

**Session theme:** P3 polish sprint (full day) — 13 features built across hardware, reports, scheduling, customers, POS, and floor plan

**Summary:** Continued from P2 completion sprint. Full-day multi-agent sprint resolving virtually all remaining small-to-medium P3 items. Verified 10+ items as already complete (no build needed). Built: Server Performance Report, Online Ordering Phase 3+4, Cash Drawer Signal, Reader Health Dashboard, Scheduling shift edit/delete + mobile view, Customer history pagination + date filter, KDS Browser Version badge, Customer Notes inline editor, Sales Forecasting report, Barcode Scanner (Skill 58), P2-B01 Bottle Service floor plan progress bar + re-auth alert. All remaining items are Large scope or blocked on external dependencies.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `ec61b20` | docs: P2-B01 resolved — bottle service workflow Phase 1 complete |
| `eb30807` | feat(floor-plan): P2-B01 bottle service min-spend progress bar + re-auth alert |
| `99727e9` | docs: MASTER-TODO — integration settings verified complete, logo/round-robin deferred |
| `b9dfc57` | docs: MASTER-TODO — customer notes, KDS browser version, shift swap scope |
| `30bf5f7` | docs: MASTER-TODO — forecasting report + barcode scanner resolved |
| `ea47c11` | feat(pos): Barcode Scanner / SKU item lookup (Skill 58) |
| `d9343c5` | feat(reports): Sales Forecasting report — day-of-week patterns + 14-day projection |
| `d0a8dc5` | feat(customers): inline notes editor in customer detail modal |
| `ea967d9` | feat(kds): display Chrome version on KDS admin page |
| `65a6575` | docs: living log — P3 sprint session (2026-02-21) |
| `add469a` | docs: update MASTER-TODO — scheduling + customer history resolved |
| `52438dc` | feat(customers): order history pagination + date range filter |
| `3b26b0e` | feat(scheduling): shift edit/delete API + mobile schedule view |
| `3ff3755` | feat(hardware): Reader Health Dashboard — PaymentReaderLog schema + health API + dashboard UI |
| `f10c9cb` | feat(hardware): Skill 56 — Cash Drawer Signal on cash payment |
| `573446c` | feat(online-ordering): P3 Online Ordering Phase 3+4 — useMenuSocket hook + isOrderableOnline utility |
| `1a1f8f5` | feat(reports): Server Performance Report + mark P1-01 verified |
| `58cb7cc` | docs: P2 sprint session 2 complete — all P2 items resolved |

### Deployments
- All commits pushed to `main` → Vercel auto-deploys to `barpos.restaurant` / `*.ordercontrolcenter.com`

### Features Delivered

**Server Performance Report** (`1a1f8f5`)
- `GET /api/reports/server-performance`: groups paid orders by employee, computes totalSales/tips/orderCount/avgCheckSize/tableTurns; sorted by revenue desc
- `/reports/server-performance` page: date range filter, 4 summary cards, server table with gold #1 badge for top performer, CSV export

**Online Ordering Phase 3+4** (`573446c`)
- `src/hooks/useMenuSocket.ts`: subscribes to location room via `getSharedSocket()`; routes `menu:item-changed`, `menu:stock-changed`, `menu:structure-changed` to callbacks; stale-closure safe via `callbacksRef`; cleanup releases socket
- `src/lib/online-availability.ts`: `computeIsOrderableOnline()` (showOnline → isAvailable → stock → availableDays → time windows incl. overnight); `getStockStatus()` (out_of_stock/low_stock/in_stock)
- `menu/items/[id]/route.ts`: stock change dispatch now uses full `computeIsOrderableOnline()` instead of bare `isAvailable`

**Cash Drawer Signal** (`f10c9cb`)
- `src/lib/cash-drawer.ts`: `triggerCashDrawer(locationId)` finds receipt printer by `printerRole`, sends ESC/POS DRAWER_KICK byte sequence; always resolves, never throws
- `POST /api/print/cash-drawer`: withVenue, delegates to `triggerCashDrawer`, always 200
- `pay/route.ts`: fire-and-forget `triggerCashDrawer` guarded by `hasCash` flag

**Reader Health Dashboard** (`3ff3755`)
- Schema: `PaymentReaderLog` model (locationId, readerId, responseTime, success, errorCode, tranType). db:push applied.
- `src/lib/reader-health.ts`: `logReaderTransaction()` — creates log row + fire-and-forget rolling avg/successRate update on `PaymentReader` (last 50 logs); `getReaderHealthSummary()` — returns metrics + 10 recent errors
- `GET /api/hardware/readers/health`: all-readers summary or single-reader detail; withVenue
- `/settings/hardware/health` page: per-reader cards, color-coded response time + success rate, online/offline badge, 30s auto-refresh
- `DatacapClient.withPadReset`: timing wrapper tracks startTime/endTime, captures tranType before padReset clears it, logs every transaction fire-and-forget

**Scheduling — Shift Edit/Delete + Mobile View** (`3b26b0e`)
- `PUT/DELETE /api/schedules/[id]/shifts/[shiftId]`: update shift fields (date, times, role, notes, employee) or soft-delete; ownership validated
- Admin scheduling page: pencil/× hover buttons on draft shift cards; `EditShiftModal` for inline editing; `refreshSelectedSchedule()` helper used by add/edit/delete
- `GET /api/mobile/schedule`: returns upcoming published shifts (today + N weeks) for an employee
- `/mobile/schedule` page: auth-guarded, week-grouped shift cards (This Week / Next Week / Week of…), 12h time format, status color badges, role icon, notes; dark theme matching mobile style
- Mobile tabs header: "Schedule" nav link with calendar icon

**Customer Order History Pagination** (`52438dc`)
- `GET /api/customers/[id]`: accepts `page`, `limit` (max 50), `startDate`, `endDate`; uses `Prisma.OrderWhereInput` to avoid readonly array TS errors; returns `ordersPagination: { page, limit, total, totalPages }`
- Customer detail modal: date range inputs (start/end) + Apply/Clear buttons + Prev/Next pagination controls in "Recent Orders" section

**KDS Browser Version** (`ea967d9`)
- Heartbeat route extracts Chrome/browser version from `user-agent` header, stores in existing `deviceInfo` JSON field
- `GET /api/hardware/kds-screens` now returns `deviceInfo` in response
- KDS admin page shows "Chrome X.Y" badge next to last-seen timestamp (hidden until first heartbeat)

**Customer Notes Inline Editor** (`d0a8dc5`)
- Replaced read-only yellow box with persistent editable card in customer detail modal
- Pencil icon toggles edit mode → textarea auto-focuses → Save (`PUT /api/customers/[id]` with notes) or Cancel
- Empty state: "No notes. Click the pencil to add." placeholder
- Edit state resets on modal close

**Sales Forecasting Report** (`d9343c5`)
- `GET /api/reports/forecasting`: businessDayDate OR-fallback, 84-day lookback by default, groups by weekday (JS `.getDay()`), projects forward N days using day-of-week averages
- `/reports/forecasting` page: lookback/horizon selectors (28/56/84 days, 7/14 days), 3 summary cards (Strongest Day gold, Weakest Day, Projected 7-Day Revenue), day-of-week table with gold ★ for top day, forecast table with Today/Tomorrow badges
- Reports hub: new "Sales Forecasting" tile in Sales & Revenue section

**Barcode Scanner / SKU Lookup — Skill 58** (`ea47c11`)
- `GET /api/menu/search?sku=X`: exact-match on `MenuItem.sku` (already indexed `@@unique([locationId, sku])`), returns same response shape as name search
- `useMenuSearch`: new `lookupBySku(sku)` function + `isSkuMode`/`skuResults` state path
- `MenuSearchInput` + `UnifiedPOSHeader`: global keyboard-wedge detector (100ms burst heuristic → buffer; Enter with buffer.length ≥ 3 + input unfocused → `onScanComplete`)
- `orders/page.tsx`: `handleScanComplete` → `lookupBySku` → `handleSearchSelect` (adds to order) or `toast.error("Item not found: {sku}")`

**P2-B01 Bottle Service Floor Plan Progress Bar + Re-Auth Alert** (`eb30807`)
- `snapshot.ts`: added `subtotal` + `bottleServiceDeposit` to order select; computes `bottleServiceCurrentSpend` and `bottleServiceReAuthNeeded` (≥ 80% of deposit triggers flag)
- `FloorPlanTable` interface: `bottleServiceCurrentSpend?` + `bottleServiceReAuthNeeded?` fields
- `FloorPlanHome`: passes new fields through active + non-active bottle service badge objects
- `TableNode`: 4px horizontal progress bar (tier color → green when min spend met) with "$X / $Y min" label below; amber "⚠ Extend" badge when `reAuthNeeded` is true

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| `as const` on Prisma `status: { in: [...] }` caused `readonly` type error | Typed `ordersWhere` as `Prisma.OrderWhereInput`, removed `as const`, mutated `createdAt` conditionally | `52438dc` |
| `Schedule.name` field doesn't exist — mobile schedule API tried to select it | Changed to `weekStart`/`weekEnd` select, display uses `getWeekLabel()` helper | `3b26b0e` |

### Verified Complete (No Build Needed)

| Item | Finding |
|------|---------|
| P1-01 Void & Retry | All 5 layers already implemented |
| Online Ordering Phase 2 | All active menu CRUD routes dispatch socket events |
| Product Mix Trends | `/reports/product-mix` + API already built |
| Void/Comp Report | `isComp` correctly derived at runtime from `reason` field |
| Quick Pick toggle | Lives in gear menu, calls `updateLayoutSetting()` |
| KDS prep station assignment | `KDSScreenStation` junction model, admin UI, fully DB-driven |
| Customer Favorites | Auto-computed top-5 from order history — complete as-is |
| Integration Settings (SMS/Slack/Email) | All three settings pages + APIs + Twilio/Resend/alert-service fully built |
| Bottle Service deposit pre-auth | `POST /api/orders/[id]/bottle-service` fully implemented (collectCardData → preAuth → OrderCard) |
| Bottle Service re-auth | `POST /api/orders/[id]/bottle-service/re-auth` built; `BottleServiceBanner` shows amber "Extend" alert at 80% |

### Known Issues / Blockers
- GL-06: Pre-launch checklist at 8% — requires manual hardware testing
- Online Ordering Phase 5 (customer-facing `/order` page) — Large effort, blocked on payment processor decision (Stripe vs Datacap)
- Scheduling shift request/swap — Large (18-20 files, needs new `ShiftSwapRequest` model); use existing shift edit as workaround
- P1-05: Socket layer multi-terminal validation — needs real Docker/hardware environment
- P1-07: Card token persistence test — needs live Datacap hardware (blocks Loyalty Program)
- Pricing Programs (surcharge, interchange+, tiered) — Large, 5-phase overhaul
- ESC/POS custom logo — deferred (needs image processing lib + real printer testing)
- Printer round-robin — deferred (wait for venue with 3+ same-role printers)

---

## 2026-02-20 — P2 Feature Sprint Session 2 (Multi-Agent Team)

**Session theme:** P2 completion sprint — item discounts, employee discounts, bottle service floor plan + reservations, mobile auth, print routing, mobile tab sync, pay-at-table sync

**Summary:** Continuation of the P2 sprint. Completed all remaining P2 items: P2-D01 (Item-Level Discounts — schema + API + UI), P2-D02 (Employee Discount UX — isEmployeeDiscount flag + dedicated section in DiscountModal), P2-D03 (verified correct — no fix needed), P2-B02 (Bottle Service floor plan tier badge via snapshot batch-fetch), P2-B03 (Bottle Service Reservation workflow — schema + API + UI + order creation auto-link), P2-E02 (Mobile Device Auth — RegisteredDevice + MobileSession models, PIN-based session cookie, /mobile/login page, auth guard on mobile tabs). Also includes P2-H04, P2-H05, P2-H01, P2-H02 from the first half of this session. All P2 items are now resolved.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `ae8f76e` | feat(mobile): P2-E02 — Mobile Device Authentication (PIN + session cookie) |
| `690b52c` | feat(reservations): P2-B03 — Bottle Service Reservation Workflow |
| `298ceb3` | feat(floor-plan): P2-B02 — Bottle Service tier badge on table cards |
| `4c9ca42` | feat(discounts): P2-D02 — Employee Discount UX |
| `eed6334` | feat(orders): P2-D01 — Item-Level Discounts: schema + API + UI |
| `df88cf2` | feat(print): P2-H02 — Modifier-only ticket context lines |
| `43bf02b` | feat(print): P2-H01 — Print Routing Phase 3 |
| `72f725b` | feat(mobile): P2-H05 — Pay-at-Table socket sync on payment completion |
| `65c38b8` | feat(mobile): P2-H04 — Mobile Bartender Tab Sync socket wiring |
| `ba88936` | docs: update living log + MASTER-TODO — P2-D04, P2-H03, P1-03, P2-R01, P2-R03, P2-P02 resolved |

### Features Delivered

**P2-D01 — Item-Level Discounts** (`eed6334`)
- New `OrderItemDiscount` model: locationId, orderId, orderItemId, discountRuleId?, amount, percent, appliedById, reason. Back-relations on Location/Order/OrderItem/DiscountRule. db:push applied cleanly.
- `POST /api/orders/[id]/items/[itemId]/discount` — apply fixed/percent discount; caps at item total; rejects paid orders (409); increments Order.discountTotal atomically
- `DELETE /api/orders/[id]/items/[itemId]/discount?discountId=` — soft-delete, decrements discountTotal
- `OrderPanelItem`: "%" button (green when active), strikethrough original price, `-$amount` in green below item price

**P2-D02 — Employee Discount UX** (`4c9ca42`)
- Added `isEmployeeDiscount Boolean @default(false)` to `DiscountRule` schema (db:push applied)
- GET/POST `/api/discounts` + PUT `/api/discounts/[id]`: accept + filter/save `isEmployeeDiscount`
- Admin `/discounts` page: "Employee Discount" checkbox with green EMPLOYEE badge
- `DiscountModal`: employee discounts surfaced in a dedicated top section with EMPLOYEE badge header; regular discounts follow below

**P2-D03 — Discount + Void/Refund Interaction** — Verified correct, no fix needed. `payment.amount` always stores discounted amount. Void uses `recordNo` referencing original charge. Refund ceiling is `payment.amount`. Zero code change.

**P2-B02 — Bottle Service Floor Plan Integration** (`298ceb3`)
- `snapshot.ts`: adds `isBottleService`, `bottleServiceTierId`, `bottleServiceMinSpend` to order select; batch-fetches tier names/colors via single `findMany` post-query (zero queries when no bottle service orders)
- `FloorPlanTable` interface: 5 new optional bottle service fields on `currentOrder`
- `TableNode`: `isBottleService`/`tierName`/`tierColor` added to `orderStatusBadges` prop; renders colored tier name pill (defaulting to gold `#D4AF37`) as the first badge
- `FloorPlanHome`: computes bottle service badge for active table; passes minimal badge for all non-active bottle service tables

**P2-B03 — Bottle Service Reservation Workflow** (`690b52c`)
- Schema: `bottleServiceTierId` + `BottleServiceTier` relation on `Reservation`; back-relation on `BottleServiceTier`. `@@index([bottleServiceTierId])` added. db:push applied.
- GET/POST `/api/reservations` + GET/PUT `/api/reservations/[id]`: include `bottleServiceTier` select, accept/save `bottleServiceTierId`
- Reservations admin UI: tier selector dropdown with live color preview; colored tier pill badge on reservation card
- POST `/api/orders`: accept optional `reservationId`; fire-and-forget links `reservation.orderId` and copies `bottleServiceTierId`/`isBottleService`/`bottleServiceMinSpend` to the new order

**P2-E02 — Mobile Device Authentication** (`ae8f76e`)
- Schema: `RegisteredDevice` + `MobileSession` models; back-relations on `Location` + `Employee`. db:push applied.
- `POST /api/mobile/device/register`: PIN validation via bcrypt, creates/reuses `RegisteredDevice` by fingerprint, issues 256-bit hex session token, sets `httpOnly` `mobile-session` cookie (8h, path: `/mobile`)
- `GET /api/mobile/device/auth`: validates cookie or `x-mobile-session` header, returns employee data; 401 on expired/missing
- `/mobile/login`: dark-theme PIN pad page; POSTs PIN → redirects to `/mobile/tabs` on success
- `/mobile/tabs` + `/mobile/tabs/[id]`: auth check on mount; redirects to `/mobile/login` on 401; backwards-compatible with legacy `?employeeId` param

**P2-H04 — Mobile Bartender Tab Sync** (`65c38b8`)
- `TAB_ITEMS_UPDATED: 'tab:items-updated'` + `TabItemsUpdatedEvent` added to `multi-surface.ts`
- 3 dispatch helpers in `socket-dispatch.ts`: `dispatchTabClosed`, `dispatchTabStatusUpdate`, `dispatchTabItemsUpdated`
- Socket relay handlers in `socket-server.ts` for `TAB_CLOSE_REQUEST`, `TAB_TRANSFER_REQUEST`, `TAB_ALERT_MANAGER`
- `close-tab/route.ts`: `dispatchTabClosed` called after successful capture
- `items/route.ts`: `dispatchTabItemsUpdated` called for bar tab item changes

**P2-H05 — Pay-at-Table Socket Sync** (`72f725b`)
- New `POST /api/orders/[id]/pat-complete`: marks order paid, creates Payment records, dispatches `orders:list-changed` + `tab:updated` + `floorplan:update`, idempotent
- `pay-at-table/page.tsx`: `accumulatedTipRef` tracks tip across splits; fire-and-forget `pat-complete` call on last split in both direct Datacap path and socket path

**P2-H01 — Print Routing Phase 3** (`43bf02b`)
- New `src/types/print/route-specific-settings.ts` with `RouteSpecificSettings` interface + `DEFAULT_ROUTE_SETTINGS`
- `kitchen/route.ts`: PrintRoute fetch by priority; tier-1 matching by categoryIds/itemTypes; modifier routing split (`follow`/`also`/`only`) with synthetic `_modifierOnlyFor` items; backup printer failover on failure

**P2-H02 — Modifier-Only Context Lines** (`df88cf2`)
- `kitchen/route.ts`: renders `FOR: {item name}` context line before modifier list when `_modifierOnlyFor` is set

### Known Issues / Next Up
- All P2 items ✅ resolved
- P1-01 (Partial Payment Void & Retry) still pending hardware test
- P1-05 (Socket layer Docker validation) still pending
- P1-07 (Card token persistence test) still pending
- GL-06 (Pre-Launch checklist tests) — 8% complete

---

## 2026-02-20 — P2 Feature Sprint Session 1 (Multi-Agent Team)

**Session theme:** P2 features — closed orders UI, AR aging report, hourly sales, refund vs void, discount on receipt, CFD socket wiring

**Summary:** Multi-agent sprint delivering 7 P2/P1 features. P2-R01 (Closed Orders UI) and P1-03 (House Accounts AR Report) fully built. P2-R03 (Hourly Sales) added with CSS-only bar chart. P2-P02 (Refund vs Void) delivered in 3 phases: schema migration, two new routes, and VoidPaymentModal UI overhaul. P2-D04 discount line added to thermal receipt builder. P2-H03 wired 4 CFD socket emit calls across 5 files. All previously-built APIs reused — zero duplicate work.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b693b5f` | feat(cfd): P2-H03 — wire CFD socket emit calls |
| `d8a8432` | fix(receipts): P2-D04 — add discount line to thermal receipt builder |
| `2fab494` | feat(orders): P2-R01 — Closed Orders Management UI |
| `d515a88` | docs: update MASTER-TODO — sprint completions 2026-02-20 |
| `b0b9678` | docs: update living log for 2026-02-20 sprint session |
| `dc95f38` | Fix deployment: Decimal→number type error + auth guard + P2-B01 auto-grat |
| `78e0859` | feat(reports): P1-03 — House Accounts Aging Report + Record Payment endpoint |
| `2f81fde` | chore: regenerate schema.sql |
| `0cf6786` | feat(reports): P2-R03 — Hourly Sales Breakdown report |
| `54ccb3e` | feat(schema): P2-P02 Phase 1 — add Payment.settledAt + RefundLog model |
| `4b62e9e` | feat(payments): P2-P02 Phase 2 — Datacap refund route + refund-payment route |
| `b8644a1` | feat(payments): P2-P02 Phase 3 — Refund vs Void distinction in VoidPaymentModal |

### Deployments
- gwi-pos → pushed to `origin/main` (Vercel auto-deploy on each commit)

### Features Delivered

**P2-R01 — Closed Orders Management UI** (`2fab494`)
- New page at `/settings/orders/closed`
- Filter bar: date range (today default), server, order type, tip status, text search
- Summary stats: order count, total revenue, needs-tip count
- Orders table with cursor-based pagination, amber "Needs Tip" badges
- Row actions: Reopen (ReopenOrderModal + manager PIN), Adjust Tip (AdjustTipModal + PIN), Reprint Receipt (browser print)
- All 3 modals (ManagerPinModal, ReopenOrderModal, AdjustTipModal) already existed — reused

**P1-03 — House Accounts Aging Report + Record Payment** (`78e0859`)
- New `POST /api/house-accounts/[id]/payments` — records cash/check/ACH payment atomically (updates balance + creates HouseAccountTransaction)
- New `GET /api/reports/house-accounts` — AR aging with 30/60/90/over-90 day buckets from oldest unpaid charge
- New `/reports/house-accounts` page: 6 summary cards (Total Outstanding, Current, 30/60/90 day buckets), accounts table with aging badges, inline Record Payment form, CSV export
- Added "Accounts Receivable" tile to reports hub Operations section

**P2-R03 — Hourly Sales Breakdown** (`0cf6786`)
- New `GET /api/reports/hourly` — 24-hour breakdown for a business day, optional compareDate overlay, 4 AM rollover support
- New `/reports/hourly` page: CSS-only bar chart (no chart library), data table toggle, peak hour highlighted purple, compare date overlay in orange
- 4 summary cards: Total Revenue, Total Orders, Peak Hour, Avg Order Value
- Added "Hourly Sales" tile to reports hub Sales & Revenue section

**P2-P02 — Refund vs Void UX Distinction** (3 commits: `54ccb3e`, `4b62e9e`, `b8644a1`)
- Phase 1 (Schema): Added `Payment.settledAt DateTime?` + new `RefundLog` model (refundAmount, originalAmount, refundReason, Datacap refs, approval chain, receipt tracking). Back-relations on Order, Employee, Location. db:push clean — zero data loss.
- Phase 2 (Routes): `POST /api/datacap/refund` (calls DatacapClient.emvReturn with ReturnByRecordNo for card-not-present). `POST /api/orders/[id]/refund-payment` (validates manager permission, Datacap call for cards, atomic db.$transaction: update Payment + create RefundLog + AuditLog).
- Phase 3 (UI): Updated `VoidPaymentModal.tsx` — detects `payment.settledAt` to show Refund vs Void path. Amber "Refund $X.XX" button with partial refund input, reader dropdown for card payments. All existing void functionality preserved.

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Vercel deploy failure (TS2322) | GL-08 fix returned Prisma `Decimal` object where `number` expected | Wrapped `DEFAULT_MULTIPLIERS` fallbacks in `Number()` in helpers.ts — commit `dc95f38` |

**P2-D04 — Discount Line on Thermal Receipt** (`d8a8432`)
- Added `discount?: number` to `totals` parameter type in `src/lib/print-factory.ts`
- Conditional discount line renders between Subtotal and Tax: `Discount: -$X.XX`
- Callers pass `discount: Number(order.discountTotal)` — zero impact on receipts with no discount

**P2-H03 — CFD Socket Event Wiring** (`b693b5f`)
- Added `RECEIPT_SENT: 'cfd:receipt-sent'` to `CFD_EVENTS` in `src/types/multi-surface.ts`
- Added 4 fire-and-forget CFD dispatch functions to `src/lib/socket-dispatch.ts`: `dispatchCFDShowOrder`, `dispatchCFDPaymentStarted`, `dispatchCFDTipPrompt`, `dispatchCFDReceiptSent`
- `PaymentModal.tsx` emits `cfd:show-order` when modal opens (order summary to CFD)
- `DatacapPaymentProcessor.tsx` emits `cfd:payment-started` before card reader activates
- `src/app/api/orders/[id]/pay/route.ts` emits `cfd:receipt-sent` server-side on full payment

### Known Issues / Next Up
- P2-H04 (Mobile Bartender Tab Sync) — queued
- P2-H05 (Pay-at-Table Socket Sync) — queued
- P2-D01 (Item-level discounts) — needs schema + API + UI, queued

---

## 2026-02-20 — Go-Live Blocker Sprint + P1 Critical Fixes + P2 Features (Multi-Agent Team)

**Session theme:** Full-team audit and fix sprint — go-live blockers, P1 payment bugs, EOD cron, auth hardening, new report pages, bottle service auto-grat

**Summary:** 9-agent multi-agent team sprint. 11 MASTER-TODO items confirmed already implemented (no build needed). GL-08 inventory bugs fixed. 3 P1-01 payment bugs patched. EOD stale-order cleanup built. Auth hydration guard deployed across all admin pages. P2-P03 batch close UI, P2-P04 tip adjustment report, P2-R02 labor cost report, and P2-B01 auto-grat all built and shipped.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `35224cd` | Fix go-live blockers and P1 payment bugs — multi-agent sprint 2026-02-20 |
| `f51f2a6` | Add Tip Adjustment Report page (P2-P04) |
| `a0b8259` | Add Labor Cost % report page (P2-R02) |
| `dc95f38` | Fix deployment: Decimal→number type error in helpers.ts + auth guard + P2-B01 auto-grat |

### Deployments
- gwi-pos → pushed to `origin/main` (Vercel auto-deploy on each commit)

### Features Delivered
- **GL-05:** Floor plan API failure rollback — 3 mutation gaps closed in `FloorPlanEditor.tsx` (handleReset, handleRegenerateSeats force callback, 2 section create handlers)
- **GL-08 Fix 1:** Liquor void deduction — added `recipeIngredients` processing to `src/lib/inventory/void-waste.ts` (was missing for all liquor items voided with wasMade=true)
- **GL-08 Fix 2:** Multiplier 0 fallback bug — fixed all 3 multiplier getters in `src/lib/inventory/helpers.ts` (`||` → explicit null/undefined check + `Number()` wrap on fallback)
- **P1-01 Fix 1:** Removed double-fire of onPartialApproval from `DatacapPaymentProcessor.tsx` (auto-fire in onSuccess removed; only button click fires it)
- **P1-01 Fix 2:** Fixed tip double-counting in `PaymentModal.tsx` partial approval pending payment (`tipAmount: 0` for partials)
- **P1-01 Fix 3:** Fixed false-positive partial detection in `useDatacap.ts` — added `purchaseAmount` param so tip is excluded from partial detection math
- **P1-04:** Built `POST /api/system/cleanup-stale-orders` + EOD scheduler (setTimeout chain, 4 AM daily, NUC-only via `POS_LOCATION_ID` env)
- **P1-06:** Created `src/hooks/useAuthenticationGuard.ts` shared hook + applied to all authenticated admin/POS pages (prevents false logout on refresh)
- **P2-P03:** Added Batch Management card to `/settings/payments` — shows batch summary, SAF queue status, Close Batch button with confirmation
- **P2-P04:** Built `/reports/tip-adjustments` page + `/api/payments/tip-eligible` endpoint — date range filters, editable tip column, CSV export
- **P2-R02:** Built `/reports/labor` page — labor cost %, hours worked, overtime, by-employee/by-day/by-role tabs
- **P2-B01:** Wired `autoGratuityPercent` into `close-tab` route — looks up `BottleServiceTier`, applies auto-grat when no explicit tip is set

### Inventory Tests Added
- `src/lib/inventory/__tests__/helpers.test.ts` — 54 Vitest unit tests
- `src/lib/inventory/__tests__/deduction.test.ts` — 13 Vitest integration tests (Prisma mocked)
- `vitest.config.ts` — new test framework config
- All 67/67 tests passing

### Already-Built Discoveries (no build needed)
- **GL-01:** `simulated-defaults.ts` never existed; `SIMULATED_DEFAULTS` not in code
- **GL-02:** `/settings/payments` already has all 8 required config cards
- **GL-03:** Logger utility is production-stripped (no raw console.log in render paths)
- **GL-04:** Deterministic grid placement already in `POST /api/tables`
- **GL-07:** VOID/COMP stamps verified working on all 3 views (FloorPlanHome, BartenderView, orders/page)
- **P1-02:** House Accounts fully wired in PaymentModal — just feature-toggled off (`acceptHouseAccounts: false`)
- **P2-E01:** Bar Tab Settings UI complete at `/settings/tabs`
- **P2-P01:** Split payments fully built (schema + API + UI)
- **P2-R02 API:** `/api/reports/labor` already existed
- **P2-P03 API:** `/api/datacap/batch` already existed

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Liquor void items not deducting inventory | `deductInventoryForVoidedItem` only processed `ingredientId` direct link, skipped `recipeIngredients` | Added recipe ingredient loop with multiplier scaling in `void-waste.ts` |
| Multiplier 0 treated as missing | `getMultiplier() \|\| 1.0` coerced valid 0 (for "NO" instruction) to 1.0 | Changed to explicit null/undefined check + `Number()` wrap in `helpers.ts` |
| Failed Vercel deployment | `DEFAULT_MULTIPLIERS` fields are Prisma `Decimal` type — fallback path returned raw `Decimal` instead of `number` | Wrapped all 3 fallbacks in `Number()` in `helpers.ts` lines 82, 91, 99 |
| Partial approval double-fire | `onSuccess` callback auto-fired `onPartialApproval` AND button click also fired it | Removed auto-fire from `onSuccess`; only manual button triggers it |
| Tip double-counted in partial payments | Pending payment included `tipAmount` when recording partial | Set `tipAmount: 0` for partial approval pending payments |
| False-positive partial detection | Tip amount included in approved vs requested comparison | Added `purchaseAmount` param to exclude tip from partial math |
| Floor plan mutations silently fail | 3 mutation paths lacked API failure rollback | Added rollback logic to handleReset, handleRegenerateSeats, section create |

### Known Issues
- P1-03 (House Accounts Aging Report) confirmed not built — queued for next sprint
- P2-R01 (Closed Orders UI) confirmed not built — queued for next sprint
- 3 pre-existing Decimal type issues in `src/lib/inventory/helpers.ts` unrelated to this sprint (now resolved by `Number()` wrapping fix)

---

## 2026-02-20 — DC Direct Payment Reader Architecture (Skill 407)

**Session theme:** Establish correct DC Direct payment terminal architecture and fix simulated routing

**Summary:** Discovered VP3350 USB cannot work standalone with DC Direct (DC Direct is firmware on networked terminals like PAX A920/Ingenico, not NUC middleware). Hardened MID credential flow (server-reads from location settings, never from client). Fixed useDatacap hook to detect simulated mode via `communicationMode === 'simulated'` in addition to `paymentProvider === 'SIMULATED'`. User will procure PAX/Ingenico terminals per station. Current dev setup routes through simulated readers.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `e2d1d58` | feat(payments): DC Direct payment reader architecture + credential flow |

### Deployments
- gwi-pos → pushed to `origin/main`

### Architecture Decision
- **DC Direct is firmware on the payment terminal** (PAX A920 Pro, PAX A920 Max, PAX IM30, Ingenico DX8000, PamiPOP+VP3350). Nothing is installed on the Ubuntu NUC for payment hardware.
- POS sends `POST http://{terminal-ip}:8080/ProcessEMVTransaction` on local network
- VP3350 USB sled alone cannot work with DC Direct on Ubuntu — it requires PamiPOP (Android display) or a Windows PC with dsiEMVUS
- Each POS station will pair with a networked PAX/Ingenico terminal

### Features Delivered
- `connectionType` field on PaymentReader (`USB | IP | BLUETOOTH | WIFI`)
- `ipAddress` defaults to `127.0.0.1` for USB/BT readers
- MID credential never accepted from client — always read from location settings
- `communicationMode` exposed on terminal config endpoint
- Bolt ⚡ button on reader cards for EMVParamDownload (first-time init)
- Cloud proxy routes for future TranCloud mode (`/api/hardware/payment-readers/[id]/cloud/`)
- useDatacap hook detects simulated via reader's communicationMode, not just terminal's paymentProvider

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| VP3350 using simulated flow despite DATACAP_DIRECT terminal | Hook only checked `paymentProvider === 'SIMULATED'`; DATACAP_DIRECT + USB reader tried `http://127.0.0.1:8080` (nothing there) | Added `|| reader.communicationMode === 'simulated'` to simulated detection |
| Hardcoded MID in payment readers page | `DATACAP_TEST_MID = 'SSBLGFRUI0GP'` baked into page.tsx | Removed — MID reads from `location.settings.payments.datacapMerchantId` server-side |
| USB readers defaulted to cloud communicationMode | `rawMode ?? 'cloud'` for non-network types | Changed default to `'local'` for all connection types |

### DB State (dev)
- VP Reader 1 (USB/127.0.0.1): `communicationMode: 'simulated'`, `isActive: true`
- Simulated Card Reader: `communicationMode: 'simulated'`, `isActive: true`
- Main Terminal → assigned to VP Reader 1 (routes to simulated)

### Skills
- Skill 407: DC Direct Payment Reader Architecture

---

## 2026-02-20 — Admin Venue Access Fix

**Session theme:** Fix GWI admin one-click access to venue POS admin panels

**Summary:** Diagnosed and fixed two bugs causing GWI admins to be redirected to /admin-login on every MC → venue access attempt. The cloud auth client was calling login(undefined) due to a data envelope mismatch. Also added a prominent "Open Admin (authenticated)" button to the VenueUrlCard in Mission Control so the JWT handoff flow is easily discoverable from the main location detail page.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | `460da99` | Fix cloud auth client — unwrap { data: { employee } } envelope |
| gwi-mission-control | `5e449ec` | Add Open Admin button to VenueUrlCard → /pos-access/{slug} |

### Deployments
- gwi-pos → Vercel (barpos.restaurant / *.ordercontrolcenter.com)
- gwi-mission-control → Vercel (app.thepasspos.com)

### Features Delivered
- GWI admins can now click "Open Admin (authenticated)" on any location in MC and land directly in the venue admin panel with no login prompt
- 8-hour session — no re-login required during a working session

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Bounced to /admin-login after MC handoff | `login(data.employee)` — API returns `{ data: { employee } }`, so `data.employee` was `undefined`; Zustand store empty despite valid cookie | Changed to `login(data.data?.employee)` in `/auth/cloud/page.tsx` |
| VenueUrlCard "Open" sent to plain URL | `href={venueUrl}` opened `https://{slug}.ordercontrolcenter.com` — no auth token → middleware redirect to admin-login | Added "Open Admin (authenticated)" button `href="/pos-access/{slug}"` |

### Skills
- Skill 405: Cloud Auth Client Fix
- Skill 406: MC Admin Venue Access

---

## 2026-02-20 — Business Day Tracking + Previous Day Orders UX

**Session theme:** Accurate business-day attribution for orders + previous-day stale tab improvements

**Summary:** Fixed open orders panel to respect the venue's business day rollover time. Added Previous Day filter, stale-tab date badges, and count chip. Introduced `businessDayDate` field on orders so revenue lands on the day a tab is closed (not opened), with promotion on item-add and pay. Updated all 10 report routes.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `c7af5ef` | Fix open orders business day filter — was showing all open orders regardless of date |
| `4687312` | Previous Day open orders: server-side fetch, date badge on stale cards, count chip |
| `e2bf8e5` | Add businessDayDate to orders — revenue reports on payment day, not open day |

### Deployments
- gwi-pos → Vercel (barpos.restaurant / *.ordercontrolcenter.com) — pushed e2bf8e5

### Features Delivered
- Open orders panel now filters by current business day (respects 4 AM rollover)
- "Previous Day" chip shows count of stale open tabs
- Stale order cards show "📅 Feb 19 · 5:33 PM" badge so servers know when a tab was opened
- Previous-day tabs that get touched (item added) automatically promote to Today
- Revenue always reported on the day an order is paid, not the day it was opened
- All 10 report routes updated for accurate business-day attribution

### Bug Fixes

| Bug | Fix |
|-----|-----|
| Open orders showed yesterday's orders | Added businessDayStart filter to /api/orders/open |
| Snapshot count badge showed 3 but panel showed 0 | Added businessDayStart filter to snapshot.ts count |
| EOD reset used hardcoded 24h window | Replaced with getCurrentBusinessDay() boundary |
| Previous Day filter showed nothing | Fixed: now fetches ?previousDay=true from API |
| Revenue on wrong day when tab spans midnight | Fixed: businessDayDate promotes to payment day |

### Skills
- Skill 402: Open Orders Business Day Filter
- Skill 403: Previous Day Open Orders Panel
- Skill 404: Business Day Date on Orders

---

## 2026-02-20 — Self-Updating Sync Agent + Batch Monitoring + Auto-Reboot (Skills 399-401)

**Session Summary:** Built three interconnected infrastructure features: the sync agent now self-updates on every deploy (no more SSH-to-fix-NUCs), Mission Control now shows live batch status per venue (with unadjusted tip warnings and 24h no-batch alerts), and servers can automatically reboot after the nightly Datacap batch closes.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | a38a8cf | feat(sync): self-updating sync agent + batch monitoring + auto-reboot |
| gwi-mission-control | cde2cc9 | feat(batch): batch monitoring, auto-reboot, and fleet alerts |

### Deployments
- gwi-pos → Vercel auto-deploy (triggered by push to main)
- gwi-mission-control → Vercel auto-deploy (triggered by push to main)

### Features Delivered

**Self-Updating Sync Agent (Skill 399)**
- `public/sync-agent.js` extracted from installer.run heredoc into a standalone versioned file
- Every FORCE_UPDATE deploy now automatically copies the new sync agent from the repo and restarts `pulse-sync` 15 seconds after ACK (gives the current process time to confirm success before being replaced)
- New fleet commands: `SCHEDULE_REBOOT` (sudo shutdown -r +N) and `CANCEL_REBOOT` (sudo shutdown -c)
- `installer.run` updated: fresh provisions copy agent from repo instead of embedding it; sudoers adds shutdown + pulse-sync restart permissions

**Batch Monitoring in Mission Control (Skill 400)**
- New `GET /api/system/batch-status` POS endpoint: live open order count, unadjusted tip count, current batch total
- `datacap/batch` POST now writes `/opt/gwi-pos/last-batch.json` after each close
- Heartbeat reports full batch state to MC every 60 seconds
- MC `BatchStatusCard`: green (<26h) / yellow (26-48h) / red (>48h) freshness badge, last batch time + dollar total, open order count, amber "⚠ N orders with unadjusted tips" warning, red 24h no-batch alert
- MC fleet dashboard: compact colored dot + relative time per venue; `⚠ No batch` amber badge when stale

**Auto-Reboot After Batch (Skill 401)**
- MC Config tab: `AutoRebootCard` — toggle + delay minutes (1-60), defaults off / 15 min
- Setting synced to NUC via `DATA_CHANGED` fleet command
- MC heartbeat route: detects new batch close → creates `SCHEDULE_REBOOT` fleet command if setting enabled
- Sync agent executes the reboot on schedule, preventing memory buildup overnight

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| Sync agent never updated on deploys | Extracted to sync-agent.js; FORCE_UPDATE self-copies + restarts pulse-sync | a38a8cf |
| `git pull --ff-only` fails on diverged branches | Already fixed in prior session (621e0b7); batch reports now prevent repeat stuck states | — |

### Known Issues / Blockers
- Two NUCs (Fruita Grill, Shanes Admin Demo) still need one-time manual SSH reset to get onto the new sync agent. All future deploys will be automatic.
- Terminal 5-tap kiosk exit zone not yet implemented (deferred — requires separate terminal agent process).

---

## 2026-02-20 — Datacap Payment Verification Report

**Session Summary:** Built a Payment Verification report so owners can see which card payments went through live, which are sitting in offline/SAF mode, and cross-reference against Datacap's cloud records when a Reporting API key is configured.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | af96d3f | feat: add Datacap payment verification report (Skill 398) |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel auto-deploy)

### Features Delivered
- **Payment Verification report** at `/reports/datacap` — new tile in Reports Hub under Operations
- **Status badges**: Live (green), Offline/SAF (yellow), Voided (gray), Refunded (blue) on every card payment
- **Summary cards**: Total card payments, Live count, Offline/SAF count, Voided/Refunded count
- **Date range filters**: Today / Yesterday / This Week quick-select + custom date range
- **Status filter** (All / Live / Offline / Voided) on local payments tab
- **Datacap Reporting V3 integration**: When `DATACAP_REPORTING_API_KEY` env var is set, cross-references each local payment against Datacap's cloud records by auth code — shows Approved/Declined per payment
- **Datacap Cloud tab**: Raw Datacap V3 transaction view (TranCode, amount, card type, auth code, result)
- **Config guidance**: Warning if merchant ID not set; info banner explaining how to add reporting key

### New Files
| File | Purpose |
|------|---------|
| `src/app/api/reports/datacap-transactions/route.ts` | Queries local payments + Datacap V3 API, cross-reference by authCode |
| `src/app/(admin)/reports/datacap/page.tsx` | Full report UI |
| (modified) `src/app/(admin)/reports/page.tsx` | Payment Verification tile added |

### Skills
- **398** — Datacap Payment Verification Report (`docs/skills/398-DATACAP-PAYMENT-VERIFICATION-REPORT.md`)

---

## 2026-02-20 — Password Reset System

**Session Summary:** Built end-to-end password reset flow keeping merchants entirely on {slug}.ordercontrolcenter.com. Venue login page gains forgot/verify modes via Clerk FAPI. MC location detail gains an Owner Access card so GWI admins can trigger resets and share deep-links with merchants.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | fdd4bd9 | feat(auth): forgot-password + reset-password flow on venue login page |
| gwi-mission-control | 82624df | feat(owner): send password reset from MC location detail page |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel auto-deploy)
- gwi-mission-control → `app.thepasspos.com` (Vercel auto-deploy)

### Features Delivered
- **"Forgot your password?"** link on venue admin-login page
- **Self-service reset flow** — enter email → 6-digit code from Clerk email → new password, all on venue subdomain
- **`?reset_sid=` deep-link** — URL param drops merchant directly into code-entry step
- **Owner Access card** in MC location detail Overview tab
- **"Send Reset" button** per owner in MC — triggers Clerk reset email, shows copyable deep-link
- **4 new API routes**: `/api/auth/forgot-password`, `/api/auth/reset-password` (POS); `/api/admin/locations/[id]/owners`, `/api/admin/locations/[id]/send-owner-reset` (MC)
- **`OwnerResetCard`** component in MC matching VenueUrlCard dark card styling

### Design Constraint Met
Merchants **never see** `app.thepasspos.com`. Clerk FAPI handles reset server-side (email_code strategy = 6-digit code, no redirect link). Entire flow stays on `{slug}.ordercontrolcenter.com`.

### Skills
- **397** — Password Reset System (`docs/skills/397-PASSWORD-RESET-SYSTEM.md`)

---

## 2026-02-20 — Venue-Local Login + Multi-Venue Owner Routing

**Session Summary:** Built venue-local admin login system to replace broken MC redirect flow, added Clerk credential passthrough (same email+password as Mission Control), and wired in multi-venue owner routing with venue picker UI and cross-domain owner token.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | 4f2434d | feat(auth): venue-local admin login — bypass Mission Control redirect |
| gwi-pos | f4947b1 | feat(auth): venue login uses Clerk credentials (Option B) |
| gwi-pos | 7b6bb2f | feat(auth): multi-venue owner routing — venue picker + owner session |
| gwi-mission-control | 74bf036 | feat(owner): GET /api/owner/venues — returns venues for an owner email |
| gwi-mission-control | a4eeaf9 | fix(auth): bypass Clerk for /api/owner/* routes (PROVISION_API_KEY auth) |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel, auto-deploy on push to main)
- gwi-mission-control → `app.thepasspos.com` (Vercel, auto-deploy on push to main)

### Features Delivered
- **Venue admin login page** at `{slug}.ordercontrolcenter.com/admin-login` — no MC redirect required
- **Clerk credential passthrough** — same email+password as Mission Control works on venue login
- **bcrypt fallback** — local employee password used if owner has no Clerk account
- **venue-setup endpoint** — emergency credential bootstrap via `PROVISION_API_KEY`
- **Multi-venue owner detection** — after Clerk auth, checks MC for owner's venue count
- **Venue picker UI** — dark card grid shown when owner has 2+ venues
- **Cross-domain owner token** — 10-minute HMAC-SHA256 JWT carries identity to target venue
- **`/auth/owner` landing page** — validates token, issues venue session, redirects to `/settings`
- **`/api/auth/owner-session`** — server endpoint: validates owner token, issues `pos-cloud-session`
- **MC `/api/owner/venues`** — internal endpoint (PROVISION_API_KEY) returns all venues for an owner email

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `shanes-admin-demo.ordercontrolcenter.com/settings` inaccessible | `app.thepasspos.com` served old deployment missing `/pos-access` routes | Replaced MC redirect with venue-local login (4f2434d) |
| MC `/api/owner/venues` returning 404 | Clerk middleware `auth.protect()` intercepting requests before handler ran | Added `isOwnerApiRoute` bypass in MC middleware (a4eeaf9) |

### Skills
- **395** — Venue-Local Admin Login + Clerk Auth (`docs/skills/395-VENUE-LOCAL-ADMIN-LOGIN.md`)
- **396** — Multi-Venue Owner Routing (`docs/skills/396-MULTI-VENUE-OWNER-ROUTING.md`)

---

## 2026-02-20 (PM5) — Third-Party Audit: Datacap Bulletproofing (Commit 14de60e)

### Session Summary
Implemented all recommendations from a third-party developer audit across 8 sections. Added a per-reader health state machine, hardened all XML builders, locked down API route security, guarded production from simulated mode, and cleaned up logging discipline. 14 files changed (1 new), 0 TypeScript errors.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `14de60e` | feat(datacap): third-party audit bulletproofing — reader health, security, XML safety |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 14de60e) |

### Features / Hardening Delivered

**§1 — Reader Lifecycle & Health**
- New `src/lib/datacap/reader-health.ts` — per-reader state machine (`healthy | degraded`)
- `withPadReset` now calls `assertReaderHealthy()` before every transaction — refused if degraded
- Pad reset failure → `markReaderDegraded()` + structured log error (was silent `console.error`)
- Successful pad reset → `markReaderHealthy()` — manual pad-reset route also clears state
- `padResetTimeoutMs` is now configurable in `DatacapConfig` (was hardcoded 5s globally)

**§2/§3 — XML Building & Parsing Safety**
- `validateCustomerCode()` exported from `xml-builder.ts` for upstream route validation
- Dev-mode warning logged when customerCode >17 chars is truncated (silent before)
- `buttonLabels` capped at 4 (Datacap protocol max) — was unbounded
- `SimScenario` XML tag blocked in production (`NODE_ENV=production`) — never reaches wire
- `extractPrintData` bounded: max 36 lines, 500 chars/line (prevents memory blowup on bad payloads)
- `rawXml` stripped in production (`''`) — avoids accumulating response data in prod logs

**§4 — Discovery Hardening**
- `discovery.ts`: hardcoded `port: 8080` → `DEFAULT_PORTS.PAX` (single source of truth)

**§5 — API Route Security**
- `walkout-retry`: malformed JSON now returns `400 Invalid JSON` (was silently `missing walkoutRetryId`)
- `sale` route: card-profile fire-and-forget uses `INTERNAL_BASE_URL` + `x-internal-call` header instead of `NEXT_PUBLIC_BASE_URL`
- Numeric validation normalized: `!amount` → `amount === undefined || amount === null` in 5 routes

**§6 — Logging Discipline**
- Cloud fallback `console.warn` → `logger.warn` with structured context
- `walkout-retry` `console.error` → `logger.error`
- `helpers.ts`: re-exports `getReaderHealth`, `clearReaderHealth`, `ReaderHealth` type

**§7 — Config Hardening**
- `validateDatacapConfig` throws if `communicationMode === 'simulated'` in production

### Files Changed

| File | Change |
|------|--------|
| `src/lib/datacap/reader-health.ts` | NEW — per-reader health state machine |
| `src/lib/datacap/types.ts` | `padResetTimeoutMs` on DatacapConfig; prod guard in validateDatacapConfig |
| `src/lib/datacap/client.ts` | Health integration in withPadReset + padReset; configurable timeout; logger |
| `src/lib/datacap/xml-builder.ts` | Button cap, customerCode warning, SimScenario prod guard, validateCustomerCode |
| `src/lib/datacap/xml-parser.ts` | printData bounds; rawXml stripped in production |
| `src/lib/datacap/discovery.ts` | DEFAULT_PORTS.PAX replaces hardcoded 8080 |
| `src/lib/datacap/helpers.ts` | Re-exports reader health functions |
| `src/lib/datacap/index.ts` | Barrel exports for reader-health module |
| `src/app/api/datacap/walkout-retry/route.ts` | JSON parse hardening; logger migration |
| `src/app/api/datacap/sale/route.ts` | INTERNAL_BASE_URL; numeric validation |
| `src/app/api/datacap/sale-by-record/route.ts` | Numeric validation |
| `src/app/api/datacap/preauth/route.ts` | Numeric validation |
| `src/app/api/datacap/preauth-by-record/route.ts` | Numeric validation |
| `src/app/api/datacap/return/route.ts` | Numeric validation |

---

## 2026-02-20 (PM4) — Datacap Forensic Audit + Fixes (Commit 894e5fe)

### Session Summary
Ran a full 3-lens forensic audit of the entire Datacap integration (data flow, cross-system connections, commit history). Found and fixed 8 issues ranging from simulator inaccuracies to error handling gaps and an edge-case NaN in discovery timeout. Zero TypeScript errors, all 6 files patched in a single commit.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `894e5fe` | fix(datacap): forensic audit fixes — simulator accuracy, error handling, edge cases |
| `970d940` | docs: forensic audit fixes session log (PM4) |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 894e5fe) |

### Bug Fixes

| # | Bug | Fix |
|---|-----|-----|
| 1 | Simulator `PartialAuthApprovalCode` was echoing auth code value instead of protocol `'P'` — `isPartialApproval` detection relied on DSIXReturnCode fallback only | Changed to `'P'` |
| 2 | Simulator `forceOffline` flag had no effect — cert test 18.1 would never see `StoredOffline` response | Added `forceOffline` to `SimOptions`; returns `<StoredOffline>Yes</StoredOffline>` + `STORED OFFLINE` textResponse |
| 3 | Simulator `send()` passed empty fields `{ merchantId:'', operatorId:'', tranCode }` — amounts, customerCode, recordNo, invoiceNo were always undefined in simulator | Extract all needed fields from the XML string before calling `simulateResponse()` |
| 4 | `storedOffline` detection too broad — `textResponse.includes('STORED')` could false-positive | Changed to `extractTag(...,'StoredOffline')==='Yes'` (primary) + `'STORED OFFLINE'` phrase check (fallback) |
| 5 | `discoverAllDevices` NaN: `?timeoutMs=abc` → `parseInt` returns `NaN` → `Math.min(NaN,15000)=NaN` → `setTimeout(fn, NaN)` fires immediately | Added `isNaN(raw) ? 5000 : raw` guard before `Math.min` cap |
| 6 | `datacapErrorResponse` only handled `Error` instances; `DatacapError` plain objects (with `.code`/`.text`) fell through to generic "Internal server error" | Check for `.text` property before falling back to generic message |
| 7 | `sale-by-record` route response missing `storedOffline` field | Added `storedOffline: response.storedOffline` to response body |
| 8 | Partial approval scenario only existed in `SaleByRecordNo` simulator case; `EMVSale` had no partial path | Added `options.partial` handling to EMVSale/EMVPreAuth case block |

---

## 2026-02-20 (PM3) — Datacap Certification: GetDevicesInfo + Level II (Skills 390–391)

### Session Summary
Implemented the final two Datacap certification gaps: GetDevicesInfo (UDP broadcast discovery of all readers on the network) and Level II interchange qualification (customer code + tax). 0 TypeScript errors. Used a 2-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `e46d997` | feat(datacap): GetDevicesInfo + Level II — certification tests 1.0 + 3.11 |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit e46d997) |

### Features Delivered

**GetDevicesInfo (Skill 390 — Test 1.0)**
- `discoverAllDevices(timeoutMs)` in `discovery.ts` — UDP broadcast to `255.255.255.255:9001`, collects all `"<SN> is at: <IP>"` responses, deduplicates by serial number
- `GET /api/datacap/discover?timeoutMs=5000` — scan entire local subnet for readers (cap 15s)
- `POST /api/datacap/discover` — find specific reader by serial number (wraps existing `discoverDevice()`)

**Level II Interchange (Skill 391 — Test 3.11)**
- `customerCode?: string` on `SaleParams` + `DatacapRequestFields` (17-char max enforced at XML layer)
- `taxAmount` accepted by `POST /api/datacap/sale` → routed to `amounts.tax`
- `<CustomerCode>` XML tag emitted in `buildRequest()`
- `<Level2Status>` parsed from processor response → returned in sale API response
- Simulator returns `<Level2Status>Accepted</Level2Status>` when `customerCode` present

### Certification Progress — COMPLETE

| Test | Case | Status |
|------|------|--------|
| 1.0 | GetDevicesInfo | ✅ Done |
| 3.11 | Level II (tax + customer code) | ✅ Done |

**Final pass rate: ~26/27 (96%)** — only ForceOffline real-device test remains (needs hardware)

### Skill Docs Created
- `docs/skills/390-GET-DEVICES-INFO.md`
- `docs/skills/391-LEVEL-II-INTERCHANGE.md`

---

## 2026-02-20 (PM2) — Datacap Store-and-Forward / SAF (Skill 389)

### Session Summary
Implemented full SAF (Store-and-Forward) support across the Datacap stack — library layer, 2 API routes, batch pre-check, and SAF queue management UI on the payment readers settings page. 0 TypeScript errors. Used a 3-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `9e10978` | feat(datacap): Store-and-Forward (SAF) — certification tests 18.x |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 9e10978) |

### Features Delivered

**SAF Library Layer**
- `forceOffline?: boolean` on `SaleParams`, `PreAuthParams`, `DatacapRequestFields` — sends `<ForceOffline>Yes</ForceOffline>` in XML (cert test 18.1)
- `DatacapResponse`: new fields `safCount`, `safAmount`, `safForwarded`, `storedOffline`
- `xml-parser.ts`: parses SAFCount, SAFAmount, SAFForwarded, StoredOffline tags
- `DatacapClient.safStatistics(readerId)` — queries reader SAF queue (cert test 18.2)
- `DatacapClient.safForwardAll(readerId)` — flushes queue to processor (cert test 18.3)

**SAF API Routes**
- `GET /api/datacap/saf/statistics?locationId=&readerId=` — returns `{ safCount, safAmount, hasPending }`
- `POST /api/datacap/saf/forward` — returns `{ safForwarded }` count
- `GET /api/datacap/batch` — batch summary now includes `safCount`, `safAmount`, `hasSAFPending` so UI can warn before batch close if offline transactions are queued

**SAF UI (Payment Readers Settings)**
- Per-reader SAF Queue widget: "Check" button → fetches live stats from reader
- Amber badge when pending transactions exist (`X pending · $Y.ZZ`)
- "Forward Now" button with loading state — flushes queue, resets badge to green "Clear"
- Disabled automatically when reader is offline

### Certification Progress

| Test | Case | Status |
|------|------|--------|
| 18.1 | ForceOffline flag in sale/preAuth | ✅ Done |
| 18.2 | SAF_Statistics | ✅ Done |
| 18.3 | SAF_ForwardAll | ✅ Done |

**Updated pass rate: ~23/27 (85%)** — up from 74%

### Remaining for Full Certification
- GetDevicesInfo — UDP discovery route (UDP discovery lib exists at `src/lib/datacap/discovery.ts`; just needs a cert-facing API route)
- Level II (tax + customer code in sale requests)

### Skill Docs Created
- `docs/skills/389-STORE-AND-FORWARD-SAF.md`

---

## 2026-02-20 (PM) — Datacap Certification: Token Transactions + Simulator Scenarios (Skills 385–388)

### Session Summary
Implemented 4 critical Datacap certification test cases (7.7, 8.1, 8.3, 17.0): PartialReversalByRecordNo, SaleByRecordNo, PreAuthByRecordNo, and EMVAuthOnly. Extended simulator with decline/error/partial-approval scenarios. 0 TypeScript errors. Used a 2-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `cd96121` | feat(datacap): add certification TranCodes — PartialReversal, SaleByRecord, PreAuthByRecord, AuthOnly |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit cd96121) |

### Features Delivered

**PartialReversalByRecordNo (Skill 385 — Test 7.7)**
- `POST /api/datacap/partial-reversal` — reduces a pre-auth hold by a specified amount
- `DatacapClient.partialReversal(readerId, { recordNo, reversalAmount })`
- Used when a tab closes for less than its authorized hold

**SaleByRecordNo (Skill 386 — Test 8.1)**
- `POST /api/datacap/sale-by-record` — charges a stored card without physical card present
- `DatacapClient.saleByRecordNo(readerId, { recordNo, invoiceNo, amount, gratuityAmount? })`
- Supports partial approval detection

**PreAuthByRecordNo (Skill 387 — Test 8.3)**
- `POST /api/datacap/preauth-by-record` — places a new pre-auth hold on a stored card token
- `DatacapClient.preAuthByRecordNo(readerId, { recordNo, invoiceNo, amount })`
- Alternative to IncrementalAuth for full re-authorization

**EMVAuthOnly (Skill 388 — Test 17.0)**
- `POST /api/datacap/auth-only` — zero-dollar card validation with vault token return
- `DatacapClient.authOnly(readerId, { invoiceNo })`
- Enables card-on-file enrollment without charging

**Simulator Enhancements**
- New `error` scenario: simulates device/communication failure
- New `partial` scenario: approves 50% of requested amount (partial approval testing)
- `SimScenario` XML tag: pass `simScenario: 'decline' | 'error' | 'partial'` in request fields
- 6 new simulator switch cases (incl. SAF_Statistics + SAF_ForwardAll scaffold)

### Certification Progress

| Test | Case | Status |
|------|------|--------|
| 7.7 | PartialReversalByRecordNo | ✅ Done |
| 8.1 | SaleByRecordNo | ✅ Done |
| 8.3 | PreAuthByRecordNo | ✅ Done |
| 17.0 | AuthOnly | ✅ Done |
| 3.2 | Simulator decline | ✅ Done |
| 3.3 | Simulator error | ✅ Done |
| 3.4 | Simulator partial | ✅ Done |

**Updated pass rate: ~20/27 (74%)** — up from 48%

### Remaining for Full Certification
- Store-and-Forward / SAF (offline queuing) — TranCodes scaffolded, logic not yet built
- GetDevicesInfo (device discovery) — UDP discovery exists, cert test route missing
- Level II (tax + customer code) — not tested

### Skill Docs Created

- `docs/skills/385-PARTIAL-REVERSAL-BY-RECORD.md`
- `docs/skills/386-SALE-BY-RECORD.md`
- `docs/skills/387-PREAUTH-BY-RECORD.md`
- `docs/skills/388-AUTH-ONLY.md`

---

## 2026-02-20 — Card Re-Entry by Token, Real-Time Tabs, Bartender Speed (Skills 382–384)

### Session Summary
Built full card-based tab re-entry using Datacap RecordNo token (two-stage server-side detection, zero double holds), real-time TabsPanel socket subscriptions, bartender fire-and-forget speed optimizations, instant new-tab modal, MultiCardBadges full redesign with brand theming and DC4 token display, and fixed void-tab missing socket dispatch. Used a 3-agent parallel team for implementation.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `f391a03` | feat(tabs): card re-entry by token, live TabsPanel sockets, void-tab fix |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit f391a03) |

### Features Delivered

**Card Re-Entry by Datacap Token (Skill 384)**
- Swiping an existing tab's card now detects the open tab via `RecordNo` — no duplicate tab, no double hold
- Stage 1: RecordNo checked after `CollectCardData` (zero new hold for returning vaulted cards)
- Stage 2: RecordNo checked after `EMVPreAuth` — new hold voided immediately if existing tab found
- `CardFirstTabFlow`: new `existing_tab_found` state with "Open Tab" / "Different Card" UI

**Bartender Speed Optimizations (Skill 383)**
- Send to existing tab: fire-and-forget — UI clears instantly, all network ops run in background
- New tab card modal: appears immediately with "Preparing Tab…" spinner while shell creates in background
- `CardFirstTabFlow` now accepts `orderId: string | null` and auto-starts when ID arrives

**MultiCardBadges Card Pill (Skill 382)**
- Brand-specific dark color theming: Visa=blue-950, MC=red-950, AMEX=emerald-950, Discover=orange-950
- Three modes: compact (tab list), default (medium pill), full (all fields + DC4 token)
- Shows cardholder name, auth hold amount, DC4 token (truncated: `DC4:ABCD1234…`)
- `TabsPanel` shows cardholder name + hold under single-card tabs

**Real-Time TabsPanel**
- `TabsPanel` subscribes to `tab:updated` + `orders:list-changed` via `useEvents()`
- All bartender terminals update instantly when any tab opens, closes, or is voided

### Bug Fixes

| Fix | File | Impact |
|-----|------|--------|
| `void-tab` missing `dispatchTabUpdated` | `void-tab/route.ts` | Voided tabs now disappear in real time on all terminals |
| TabsPanel only refreshed on manual trigger | `TabsPanel.tsx` | Now socket-driven — no stale lists |

### Schema Changes

| Change | Migration |
|--------|-----------|
| `OrderCard`: `@@index([recordNo])` | `npm run db:push` applied ✅ |

### Skill Docs Created

- `docs/skills/382-MULTICARD-BADGES-CARD-PILL.md`
- `docs/skills/383-BARTENDER-SPEED-OPTIMIZATIONS.md`
- `docs/skills/384-CARD-REENTRY-BY-TOKEN.md`

---

## 2026-02-19 (PM) — Device Fleet Management & Live Venue Fixes

### Session Summary
Built full device fleet management across POS and MC repos (5-agent team). Fixed live venue deployment issues, voided stale orders, removed kiosk --incognito for performance.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `1f7815d` | Add device fleet endpoints + SystemReloadListener for Mission Control |
| `819ed89` | Remove --incognito from kiosk Chromium flags for faster terminal loads |
| `0362305` | Clean up repo: remove Datacap Word docs, update task board and schema |

### Commits (Mission Control — `gwi-mission-control`)

| Commit | Description |
|--------|-------------|
| `30604fa` | Add device fleet management — visibility + remote control from Mission Control |
| `4f40149` | Fix FORCE_UPDATE to use db push, add deploy failure + version mismatch alerts |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel |
| Mission Control | app.thepasspos.com | Auto-deployed via Vercel |

### Features Delivered

**Device Fleet Management (MC)**
- Device inventory synced via NUC heartbeat — terminals, handhelds, KDS, printers, payment readers
- DeviceInventoryCard with count vs. limit progress bars, status dots, relative timestamps
- Remote actions: Restart Kiosk, Reload All Terminals from MC dashboard
- Release "Requires kiosk restart" checkbox — auto-reloads terminals after deploy
- Deploy failure alerts (red banner) and version mismatch warnings (amber banner)

**POS Endpoints**
- Internal device-inventory API for heartbeat sync
- Internal reload-terminals and reload-terminal APIs for remote control
- SystemReloadListener component — auto-refreshes browser on socket event
- License enforcement (fail-open) for device count limits

**Live Venue Fixes**
- Voided 4 stale open orders from Feb 17 at Fruita Bar & Grill
- Fixed FORCE_UPDATE handler: uses prisma db push instead of prisma migrate, aborts on failure
- Removed --incognito from kiosk service on both live NUCs for faster loads

### Bug Fixes

| Fix | Impact |
|-----|--------|
| FORCE_UPDATE used prisma migrate (failed silently) | NUCs now use prisma db push and abort on schema failure |
| DeviceInventoryCard crashed on null data | Rewrote to handle nested device object + null guards |
| Kiosk --incognito caused slow cold starts | Terminals now cache assets, load faster after restart |
| 4 stale open orders showing on terminal | Voided via direct DB update |

### New Skills Documented

| Skill | Name |
|-------|------|
| 376 | Device Fleet Management |
| 377 | Remote Device Actions |
| 378 | Deploy Alerts & Version Mismatch |
| 379 | Terminal License Enforcement |
| 380 | Kiosk Performance (Incognito Removal) |
| 381 | Release Kiosk Restart |

---

## 2026-02-19 — Sprint 2B/2C: Cloud Admin + Settings + P0 Fixes

### Session Summary
Completed MC admin features (cash discount management, data retention), fixed production deployment, then ran a 7-agent team sprint to knock out P0/P1 blockers.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `e7cdd14` | Add auth hydration guards to prevent false logouts on page load |
| `3500e4d` | T-077: Add EOD auto-close stale orders API route |
| `1b7239f` | Add missing Settings admin UI sections: Bar Tabs, Payments, POS Display, Receipts |
| `e54bc8e` | Add DATA_CHANGED handler to NUC sync agent for real-time settings sync |
| `b3d9777` | T-044: Add void/comp status fields to BartenderView order items mapping |
| `cda3e76` | T-033: Add API failure rollback + toast to Floor Plan editor |
| `f4614d5` | Fix partial payment approval flow (T-079) |
| `5ca0d37` | Replace Cash Discount settings with read-only rate viewer |
| `da66c1e` | Sprint 2: Add View on Web banners to all report pages |

### Commits (Mission Control — `gwi-mission-control`)

| Commit | Description |
|--------|-------------|
| `5d28178` | Add Cash Discount management + Data Retention to location admin |

### Commits (Backoffice — `gwi-backoffice`)

| Commit | Description |
|--------|-------------|
| `cc93c80` | Sprint 2: Add Thymeleaf admin dashboard with report pages |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel |
| Mission Control | app.thepasspos.com | Deployed + DB schema synced (`prisma db push`) |
| Backoffice | localhost:8080 (dev) | Running locally |

### Features Delivered

**Cloud Admin (Mission Control)**
- Cash Discount management UI — GWI admins can set processing rates per-location
- Data Retention dropdown — configure how long the local POS keeps report data; older data is available in the cloud backoffice at `/admin`
- Settings sync pipeline — MC → SSE → NUC sync agent → local POS (end-to-end wired)

**POS Settings**
- Cash Discount section is now **read-only** ("Contact your administrator to change rates")
- 5 new settings sections added: Bar Tabs, Payments, POS Display, Receipts, Tax
- Each with full form UI matching the TypeScript interfaces

**POS Reports**
- "View on Web" banners on all 13 report pages when date range exceeds local data retention

**Backoffice Admin Dashboard**
- 6 Thymeleaf pages: Dashboard, Sales, Payroll, Tips, Voids, Employees
- Client-side fetch to report API endpoints with date range filters

### Bug Fixes

| Fix | Impact |
|-----|--------|
| Partial payment false-positive (T-079) | $65.82/$65.82 no longer triggers partial approval UI |
| Void & Retry now voids partial auth before restarting | Prevents orphaned card holds |
| BartenderView missing void/comp fields (T-044) | Voided items now show stamps + excluded from subtotal |
| Floor Plan silent API failures (T-033) | Create/update/delete now show toast on failure + rollback |
| Auth hydration guards (T-053) | No more false logouts on page refresh across all admin pages |
| MC dashboard 500 (missing DB column) | `prisma db push` added `localDataRetention` to production |

### Resolved Task Board Items

| ID | Task | Resolution |
|----|------|------------|
| T-031 | Console logging in floor plan hot paths | Already clean — no action needed |
| T-032 | Math.random() table placement | Already deterministic — no action needed |
| T-033 | Floor plan API failure rollback | Fixed — toast + rollback on create/update/delete |
| T-044 | VOID/COMP stamps on all views | Fixed — BartenderView was missing fields |
| T-045 | Settings admin pages | Added 5 sections (Bar Tabs, Payments, Display, Receipts, Tax) |
| T-053 | Auth store persistence | Added useAuthGuard hook + admin layout guard |
| T-077 | EOD auto-close stale orders | Created `/api/orders/eod-cleanup` route |
| T-079 | Partial payment approval flow | Fixed false-positive + void-before-retry |

### New Task Added

| ID | Task | Priority |
|----|------|----------|
| T-080 | Full Pricing Program System (surcharge, flat rate, interchange+, tiered) | P2 |

### Known Issues / Blockers
- Pre-existing TS error in `tabs/page.tsx` (employee possibly null) — not blocking
- Backoffice running locally only (no cloud deployment yet)
- Settings sync: NUC side wired but not tested on physical hardware

---

## 2026-02-19 — Sprint 2A: NUC-to-Cloud Event Pipeline

### Session Summary
Built the complete event pipeline from local POS servers to the cloud backoffice. Java backoffice fully operational with event ingestion and 7 report endpoints.

### Commits (POS)

| Commit | Description |
|--------|-------------|
| `1436aca` | Phase 2: Dynamic backoffice URL + 4 new cloud event types |
| *(earlier)* | cloud-events.ts + cloud-event-queue.ts + pay route wiring |

### Commits (Backoffice)

| Commit | Description |
|--------|-------------|
| `cc93c80` | Sprint 2: Add Thymeleaf admin dashboard with report pages |
| *(earlier)* | Event ingestion endpoint + 7 report APIs |

### Features Delivered
- NUC → Cloud event pipeline (HMAC-signed, fire-and-forget)
- 7 cloud event types: order_completed, payment_processed, item_sold, void, comp, tip_adjusted, employee_clock
- Java backoffice: event ingestion + sales/payroll/tips/voids/employees reports
- Admin dashboard with 6 Thymeleaf pages

### Bug Fixes
- Java `.env` CRLF line endings causing auth failure
- Thymeleaf fragment resolution (`__${...}__` preprocessing)
- Wrong event ingestion path (`/api/events/ingest` not `/api/events`)
- UUID required for eventId field
- Demo data sent to correct venue ID (`loc-1`)

---

## How to Update This Log

Each development session should add a new entry at the top with:
1. **Date + Sprint/Theme name**
2. **Session Summary** (1-2 sentences)
3. **Commits** per repo (hash + description)
4. **Deployments** (what was deployed where)
5. **Features Delivered** (user-facing changes)
6. **Bug Fixes** (table format)
7. **Resolved Task Board Items** (if any)
8. **Known Issues / Blockers** (carry forward or resolve)
