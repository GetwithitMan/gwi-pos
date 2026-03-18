# Server Hardening Session — Final Report

**Date:** 2026-03-18
**Commits:** 33
**New files created:** 21

---

## What Was Built

### Infrastructure (Phases 0-7)

| Component | File(s) | Status |
|-----------|---------|--------|
| **Typed runtime config** | `env-parse.ts`, `system-config.ts` | Complete |
| **Signed tenant JWT** | `tenant-context-signer.ts`, `base64url.ts` | Complete — iss/aud, method/path/body binding, 15s expiry |
| **Fail-closed sync validation** | `sync-config.ts` | Complete — immutable registry, zero priority collisions |
| **Tenant-safe DB layer** | `db.ts`, `db-soft-delete.ts`, `db-tenant-scope.ts`, `db-venue-cache.ts` | Complete — modularized, typed recursion guard |
| **Row-versioned conflict handling** | `sync-conflict-quarantine.ts`, migration 077 | Complete — version + timestamp detection, log-only/blocking modes |
| **Downstream notification pipeline** | `downstream-notification-pipeline.ts` | Complete — replaces fire-and-forget hooks |
| **Worker registry** | `worker-registry.ts` | Complete — required/degraded/optional classification |
| **Structured logging** | `logger.ts` (pino) | Complete — child loggers, request trace IDs |
| **Dual-channel event wrapper** | `emit-order-and-socket.ts` | Complete — enforces socket outbox + order event contract |
| **RLS infrastructure** | `db-rls.ts`, migration 078 | Complete — 15 tenant-scoped models, fail-closed |
| **CSP report-only** | `next.config.ts`, `/api/csp-report` | Complete — strict report-only alongside permissive enforced |
| **CI type gate** | `.github/workflows/ci.yml` | Complete — typecheck + lint + schema drift |
| **Event-source migration guard** | `order-write-guard.ts` | Renamed, clear removal criteria |

### Repositories (Phase 1)

| Repository | Methods | Call sites migrated |
|------------|---------|-------------------|
| **OrderRepository** | 26 | ~80 |
| **OrderItemRepository** | 17 | ~40 |
| **PaymentRepository** | 27 | ~25 |
| **EmployeeRepository** | 16 | ~30 |
| **MenuItemRepository** | 10 | ~15 |
| **Total** | **96** | **~190** |

### Event-Sourced Writes (Phase 2)

| Sprint | Scope | Files |
|--------|-------|-------|
| A — Critical domain | item-operations, capture-recording, zero-tab, close-shift | 5 |
| B — Routes + splits | KDS, tabs, splits (4 types), entertainment, seating, ownership, HA payment, auto-discounts, host/seat, sync-resolution | 11 |
| C — Lib functions | walkout-detector, socket-server, batch-updates | 3 |

**3 new event types added:** ITEM_MODIFIER_REMOVED, TAB_CAPTURE_DECLINED, WALKOUT_MARKED

---

## Where We Stand

### Direct DB Calls — Before vs After

| Model | Before | After | Migrated |
|-------|--------|-------|----------|
| db.order.* | 218 | 179 | 39 |
| tx.order.* | 114 | 79 | 35 |
| db.orderItem.* | 72 | 48 | 24 |
| tx.orderItem.* | 55 | 39 | 16 |
| db.menuItem.* | 78 | 71 | 7 |
| tx.menuItem.* | 19 | 19 | 0 |
| db.employee.* | 73 | 61 | 12 |
| tx.employee.* | 5 | 6 | -1 (repo uses tx internally) |
| db.payment.* | 60 | 46 | 14 |
| tx.payment.* | 26 | 14 | 12 |
| **Total** | **717** | **557** | **160** |

### Classification of Remaining 557

| Bucket | Count | % | Action |
|--------|-------|---|--------|
| **Approved infrastructure** | ~132 | 24% | Keep — projectors, sync workers, scripts |
| **TX coordinators** | ~115 | 21% | Keep — domain service transaction blocks |
| **LocationId bootstraps** | ~60 | 11% | Keep until withVenue injects locationId |
| **Temp debt (tx wiring)** | ~140 | 25% | Burn down as repos adopt tx params deeper |
| **Query service candidates** | ~51 | 9% | Build query services (reports, dashboards) |
| **Models without repos** | ~59 | 11% | Build repos for Table, Seat, OrderDiscount, etc. |

### Files Using Repositories: 106

---

## Hardening Scorecard

| Dimension | Before | After | Notes |
|-----------|--------|-------|-------|
| **Tenant isolation** | Interceptor-only | Repos + interceptors + RLS | Defense in depth |
| **Config management** | Scattered process.env | Typed config + edge-safe parsers | Single source of truth |
| **Auth boundary** | Plain headers | Signed JWT (iss/aud/method/path/body) | Cryptographic binding |
| **Sync validation** | Auto-register (silent) | Fail-closed (blocking boot) | Zero unknown tables |
| **Conflict handling** | neon-wins (silent) | Version-based quarantine | Log-only → blocking |
| **Event durability** | Fire-and-forget | Transactional outbox + post-commit events | Dual-channel contract |
| **Worker lifecycle** | Inline start/stop | Registry with health classification | Required/degraded/optional |
| **Logging** | console.* | Pino structured JSON + trace IDs | Request correlation |
| **Order mutations** | Mixed direct/event | ~95% event-sourced (critical paths) | Migration guard tracks rest |
| **Security headers** | Permissive CSP | Report-only strict + enforced permissive | Violation logging active |
| **CI** | None | Typecheck + lint + schema drift | Blocks PRs |
| **DB module** | 470-line monolith | 4 focused modules (209 lines main) | Cognitive load halved |

---

## What's Left (Prioritized)

### Phase A — Eliminate unsafe business-path access
- ~60 locationId bootstrap calls → solve by injecting locationId into withVenue context
- ~140 temp debt tx-wiring calls → burn down as repo adoption deepens
- **Target: zero direct db.order/orderItem/payment calls in route handlers**

### Phase B — Build remaining abstractions
- Query services for reports/dashboard (51 calls)
- Repositories for Table, Seat, OrderDiscount, HouseAccount, OrderCard (~59 calls)
- **Target: every model access goes through a typed module**

### Phase C — Lock the boundary
- ESLint rule banning direct db.* for tenant models outside approved files
- Allowlist the ~132 approved infrastructure calls
- CI enforcement
- **Target: architecture is self-defending**

### Phase D — Operational maturity
- Promote quarantine from log-only to blocking after staging validation
- Remove `ignoreBuildErrors: true` from next.config.ts
- Enforce strict CSP (remove unsafe-eval after audit)
- Complete remaining console.* → pino migration (~60 calls)
- Remove order-write-guard.ts when all direct writes are gone

---

## Commit Log

```
9671a31a finish partially migrated high-count routes (18 calls)
03c1fc20 migrate 9 untouched order routes (19 calls)
c68c86dc migrate 6 misc routes (13 calls)
e8c3e970 migrate KDS, replay, merge, seating, combo (51 calls)
b861a6d1 migrate 10 remaining order routes
1a5ef0f3 migrate payment routes (37 calls)
021c9211 migrate 9 non-order routes
ad1797fd migrate tip-allocation + TODO audit for 8 lib services
6ead87fb direct DB call classification doc
fd6389a3 employee repo type fix
187fa8f0 migrate employee + auth routes
4bc76e61 create MenuItemRepository + migrate menu routes
4d0ce23b migrate tabs + shifts routes
f0cba5ad migrate payments/sync
0f74dadb migrate domain functions
d861f7eb OrderItemRepository + migrate 12 routes
41f70fa2 create EmployeeRepository + PaymentRepository
b01674bd migrate top 5 Order routes
d9e4fc79 phase 2C — remaining lib function events
ee910193 phase 2B addendum — host/seat + sync-resolution events
4a4330f2 phase 2B — KDS, tabs, splits, entertainment events
6f5842a6 close-tab route param fix
2bbaaba9 phase 2A — critical-path domain function events
08b5b53f phases 5+7 — RLS, security headers, new event types
f4da47e8 phases 1+3+4+6 — repos, row versions, downstream pipeline, logging
3f08f03b adopt emitOrderAndSocketEvents wrapper
44637ed1 modularize db.ts, worker registry, event wrapper
479714c1 delete bypass flags, consolidate config, DRY soft-delete
96e83855 remove as-any casts, quarantine blocking mode, robust CI
49ed0274 wire quarantine into downstream sync, event channel contract
3fc310b0 DRY base64url, logger consistency, typed recursion guard
53c62bd9 edge-safe config, body clone, pathname binding, JWT iss/aud
7d7964c6 P0 audit fixes — JWT body, immutable sync, priority collisions, durable events
fdad9383 steps 0-6 initial implementation
```
