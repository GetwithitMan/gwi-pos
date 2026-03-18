# Direct DB Call Classification

**717 total remaining direct calls across 5 tenant-scoped models.**

## By Model

| Model | db.* | tx.* | Total | Repo Exists |
|-------|------|------|-------|-------------|
| Order | 218 | 114 | 332 | Yes (26 methods) |
| OrderItem | 72 | 55 | 127 | Yes (12 methods) |
| MenuItem | 78 | 19 | 97 | Yes (9 methods) |
| Employee | 73 | 5 | 78 | Yes (17 methods) |
| Payment | 60 | 26 | 86 | Yes (23 methods) |

---

## Classification Buckets

### 1. REPO_REQUIRED — Must Migrate (estimated ~310 calls, 43%)

Route-level and service-level business logic that should use repositories.

**Top 15 files (biggest migration targets):**

| Calls | File | Notes |
|-------|------|-------|
| 23 | orders/[id]/pay/route.ts | Payment flow, many complex includes |
| 16 | orders/replay-cart-events/route.ts | Cart replay from Android |
| 16 | orders/[id]/split-tickets/route.ts | Ticket splitting |
| 11 | orders/[id]/refund-payment/route.ts | Refund flow |
| 11 | orders/[id]/comp-void/route.ts | Comp/void (partially migrated) |
| 11 | orders/[id]/route.ts | CRUD (partially migrated) |
| 10 | orders/[id]/merge/route.ts | Order merge |
| 10 | orders/[id]/seating/route.ts | Seating (partially migrated) |
| 9 | payments/sync/route.ts | Payment sync (partially migrated) |
| 9 | orders/[id]/void-payment/route.ts | Void payment |
| 7 | orders/batch-adjust-tips/route.ts | Batch tip adjustment |
| 7 | orders/[id]/close-tab/route.ts | Tab close |
| 7 | orders/[id]/adjust-tip/route.ts | Single tip adjustment |
| 7 | orders/[id]/items/route.ts | Item CRUD |
| 7 | orders/open/route.ts | Open order list |

**Rule:** No route handler should directly call `db.order.*`, `db.orderItem.*`, `db.payment.*`, `db.employee.*`, or `db.menuItem.*`. Use repository methods.

---

### 2. TX_COORDINATOR_ALLOWED — Keep Direct (~115 calls, 16%)

Transaction-internal writes in domain service coordinators. These are structural operations that must stay inside `$transaction` blocks.

**Approved files:**
- `src/lib/domain/order-items/item-operations.ts` — Item create/delete inside tx
- `src/lib/domain/order-items/order-totals.ts` — Totals recalculation (materialized view)
- `src/lib/domain/split-order/*.ts` — Split orchestration inside tx
- `src/lib/domain/tab-close/*.ts` — Tab close orchestration inside tx
- `src/lib/domain/shift-close/close-shift.ts` — Batch close inside tx
- `src/lib/domain/entertainment/session-operations.ts` — Timer operations inside tx
- `src/lib/auto-discount-engine.ts` — Discount application inside tx

**Rule:** These files are approved transaction coordinators. Direct `tx.*` calls are expected here. They should pass `locationId` to all queries but may use raw Prisma for complex multi-step transactions.

---

### 3. PROJECTOR_ALLOWED — Keep Direct (~10 calls, 1%)

Event infrastructure that writes Order/OrderItem as part of the projection pipeline.

**Approved files:**
- `src/lib/order-events/projector.ts` — Snapshot upsert/delete
- `src/lib/order-events/ingester.ts` — Event ingestion pipeline
- `src/lib/db.ts` / `src/lib/db-*.ts` — DB infrastructure

**Rule:** Projector writes are the ONLY approved non-event path for Order/OrderItem mutations in the final state.

---

### 4. QUERY_SERVICE_REQUIRED — Needs New Abstraction (~51 calls, 7%)

Complex aggregates and reporting queries that don't fit the CRUD repository pattern.

**Files:**
- `src/app/api/reports/daily/route.ts` — ~18 parallel aggregates
- `src/app/api/reports/tips/route.ts` — TipLedger aggregates
- `src/app/api/reports/voids/route.ts` — VoidLog queries
- `src/app/api/reports/house-accounts/route.ts` — HouseAccount aggregates
- `src/app/api/reports/variance/route.ts` — Inventory aggregates
- `src/app/api/dashboard/live/route.ts` — Real-time dashboard aggregates
- `src/lib/domain/shift-close/shift-summary.ts` — Shift summary calculations

**Future abstraction:** Create `src/lib/query-services/` with:
- `order-reporting-queries.ts` — Order/payment aggregates for reports
- `dashboard-queries.ts` — Real-time dashboard queries
- `shift-summary-queries.ts` — Shift close calculations

**Rule:** Complex aggregate queries get their own query service modules, not shoehorned into CRUD repos.

---

### 5. SCRIPT_ALLOWED — Infrastructure (~7 calls, 1%)

Sync workers, migration scripts, outbox plumbing.

**Approved files:**
- `src/lib/sync/downstream-sync-worker.ts` — Raw SQL upserts
- `src/lib/sync/upstream-sync-worker.ts` — Raw SQL reads
- `src/lib/socket-server.ts` — Socket event handlers

**Rule:** Sync workers use raw SQL by design (performance, schema flexibility). Approved.

---

### 6. TEMP_DEBT — Models Without Repos Yet (~224 calls, 31%)

These calls use models that have repositories now but haven't been migrated yet (partially migrated routes), or are `tx.*` calls inside routes that need refactoring to pass tx to repo methods.

**Breakdown:**
- `tx.order.*` in routes: ~114 calls (need tx parameter wiring)
- `tx.orderItem.*` in routes: ~55 calls (same)
- `tx.payment.*` in routes: ~26 calls (same)
- Remaining `db.*` in partially migrated routes: ~29 calls

**Rule:** Each must have a TODO comment with phase assignment. Burn down over Phases 1-2 continuation.

---

## Summary

| Bucket | Calls | % | Action |
|--------|-------|---|--------|
| REPO_REQUIRED | ~310 | 43% | Migrate to repositories |
| TX_COORDINATOR_ALLOWED | ~115 | 16% | Keep — approved coordinators |
| QUERY_SERVICE_REQUIRED | ~51 | 7% | New query service modules |
| TEMP_DEBT | ~224 | 31% | Burn down (tx wiring + partial routes) |
| PROJECTOR_ALLOWED | ~10 | 1% | Keep — event infrastructure |
| SCRIPT_ALLOWED | ~7 | 1% | Keep — sync/migration |
| **Total** | **717** | | |

## Success Metric

**"Perfect" means:**
- `REPO_REQUIRED` → 0 (all route/service calls go through repos)
- `QUERY_SERVICE_REQUIRED` → 0 (all moved to query services)
- `TEMP_DEBT` → 0 (all tx calls wired through repos)
- `TX_COORDINATOR_ALLOWED` → stable (documented, approved files only)
- `PROJECTOR_ALLOWED` → stable (event pipeline only)
- `SCRIPT_ALLOWED` → stable (sync/migration only)
- ESLint rule enforces the boundary in CI

## Current Progress

- 51 files already migrated to repositories
- 6 repositories built (95+ methods)
- All 7 hardening phases shipped or infrastructure complete
- ~310 route calls + ~224 tx-wiring calls remaining for full coverage
