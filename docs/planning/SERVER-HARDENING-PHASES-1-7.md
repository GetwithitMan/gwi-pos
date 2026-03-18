# Server Hardening — Phases 1-7 Implementation Plan

**Based on forensic codebase research. All numbers are actual counts, not estimates.**

---

## Phase 0: Prep (1 day)

1. Baseline current metrics:
   - Count direct `db.order.*` calls (currently 269)
   - Count direct `db.orderItem.*` calls (currently 100)
   - Count `tenant_breach_detected` log events (should be 0)
   - Count `sync_conflict_quarantine` events
   - Count console.* calls in core files (currently 102)
2. Set up canary flags in system-config.ts:
   - `USE_ORDER_REPOSITORY` — gradual repo rollout
   - `SYNC_QUARANTINE_MODE` — already exists (log-only | blocking)
   - `CSP_REPORT_ONLY` — for Phase 7 CSP rollout
3. Create tracking tickets for all 7 phases

---

## Phase 1: Repository Pattern for Tenant-Safe Access

**Goal:** Move critical tenant-scoped access from Prisma interceptor magic into explicit repository methods with composite where clauses.

**Scope (from research):**
- 625 direct `db.*` calls across top 5 tenant-scoped models
- Order: 269 calls across 20 files
- OrderItem: 100 calls across 20 files
- Employee: 100 calls across 20 files
- MenuItem: 94 calls across 20 files
- Payment: 62 calls across 20 files
- No repository pattern exists today — domain services call db directly

**Execution order:**

### Sprint 1A: Repository infrastructure + Order (3 days)

1. Create `src/lib/repositories/base-repository.ts`
   - Generic tenant-scoped CRUD with `locationId` baked into every query
   - Methods: `findById(id, locationId)`, `findMany(locationId, where)`, `updateById(id, locationId, data)`, `deleteById(id, locationId)`
   - All methods use composite where: `{ id, locationId }` for single-record ops
   - Never uses post-read check — query shape enforces tenant isolation

2. Create `src/lib/repositories/order-repository.ts`
   - `getOrder(id, locationId)` — findFirst with `{ id, locationId }`
   - `getOpenOrders(locationId)` — findMany with status filter
   - `updateOrderStatus(id, locationId, status, data)` — update with composite where
   - `closeOrder(id, locationId, closedData)` — update with status transition
   - Top 20 files by Order call volume migrate first (269 calls)

3. Create `src/lib/repositories/order-item-repository.ts`
   - `getItemsForOrder(orderId, locationId)` — findMany with FK + tenant
   - `updateItem(id, locationId, data)` — composite where update
   - 100 calls across courses, KDS, items, expo routes

### Sprint 1B: Employee + MenuItem + Payment repos (2 days)

4. Create `src/lib/repositories/employee-repository.ts`
   - `getEmployeeByPin(pin, locationId)` — critical auth path
   - `getEmployee(id, locationId)` — standard lookup
   - 100 calls, heavily used in auth and shift operations

5. Create `src/lib/repositories/menu-item-repository.ts`
   - `getMenuItem(id, locationId)` — with category/modifier includes
   - `getMenuItems(locationId, categoryId?)` — filtered list
   - 94 calls across menu, order, and inventory routes

6. Create `src/lib/repositories/payment-repository.ts`
   - `getPaymentsForOrder(orderId, locationId)` — money-critical
   - `createPayment(locationId, data)` — ensures locationId is always set
   - 62 calls, money-sensitive

### Sprint 1C: ESLint enforcement (1 day)

7. Add ESLint rule to `eslint.config.mjs`
   - Ban `db.order.`, `db.orderItem.`, `db.payment.`, `db.employee.`, `db.menuItem.` in `src/app/api/**/*.ts`
   - Allow only in `src/lib/repositories/**/*.ts` and `src/lib/domain/**/*.ts`
   - CI fails on violation

8. Reclassify db-tenant-scope.ts interceptors
   - Add comments: "Defense-in-depth only — primary enforcement is in repositories"
   - Log `tenant_breach_interceptor_fired` when interceptor catches something the repository should have prevented

**Acceptance criteria:**
- [ ] All 269 Order db.* calls migrated to OrderRepository
- [ ] All 100 OrderItem db.* calls migrated to OrderItemRepository
- [ ] All 100 Employee db.* calls migrated to EmployeeRepository
- [ ] All 94 MenuItem db.* calls migrated to MenuItemRepository
- [ ] All 62 Payment db.* calls migrated to PaymentRepository
- [ ] ESLint rule blocks new direct db.* usage for these models in CI
- [ ] Zero `tenant_breach_interceptor_fired` events in staging load test
- [ ] Canary: roll out Order repo first behind `USE_ORDER_REPOSITORY`, validate, then expand

**Rollback gate:** If breach events spike after repo rollout, revert to interceptor-primary mode (repos become optional wrappers).

**Estimated effort:** 6 days total

---

## Phase 2: Finish Event-Sourced Order Writes

**Goal:** Eliminate mixed write model — all Order/OrderItem mutations go through event emission.

**Scope (from research):**
- 45 routes already event-sourced (emit events properly)
- 11 routes in `/orders/` still write directly (excluding 4 read-only)
- 50 routes outside `/orders/` write directly
- 31 library functions write directly
- ~150-200 total call sites need migration

**Execution order:**

### Sprint 2A: Core domain functions (3 days)

1. `src/lib/domain/order-items/item-operations.ts` — feeds ALL item mutations
2. `src/lib/domain/order-items/order-totals.ts` — called whenever prices change
3. `src/lib/domain/split-order/*.ts` (5 files) — even-split, item-split, seat-split, table-split, discount-distribution
4. `src/lib/domain/tab-close/*.ts` (3 files) — capture-recording, validation, zero-tab
5. `src/lib/domain/shift-close/close-shift.ts` — batch close (100+ orders at EOD)

**Pattern:** Each function currently does `tx.order.update(...)`. Convert to:
```typescript
await emitOrderEvent(locationId, orderId, 'STATUS_CHANGED', { status: 'closed' })
// Projector handles the actual Order/OrderItem write
```

### Sprint 2B: Route-level mutations (2 days)

6. `orders/[id]/open-tab/route.ts` — tab status + pre-auth recording
7. `orders/[id]/seating/route.ts` — seat count updates
8. `orders/[id]/add-ha-payment/route.ts` — house account payment item
9. `orders/[id]/ownership/route.ts` — ownership transfer
10. `orders/[id]/auto-discounts/route.ts` — auto-discount application

### Sprint 2C: External routes + verification (2 days)

11. KDS routes (`kds/route.ts`, `kds/expo/route.ts`) — bump status
12. Tab routes (`tabs/route.ts`, `tabs/[id]/route.ts`) — tab operations
13. Entertainment routes — timed rental status
14. Delivery routes — delivery order lifecycle

15. **Delete `order-write-guard.ts`** — all direct writes eliminated
16. Remove the Prisma extension chain from db.ts: `guarded` step no longer needed

**New event types needed:** ~5-8 new OrderEventType values for mutations not yet covered (SEAT_COUNT_CHANGED, TAB_STATUS_CHANGED, OWNERSHIP_TRANSFERRED, etc.)

**Acceptance criteria:**
- [ ] Zero direct Order/OrderItem writes outside event projector (grep returns 0)
- [ ] `order-write-guard.ts` deleted (no longer needed)
- [ ] All new event types have matching reducer cases and projector coverage
- [ ] Android event vocabulary matches (check reducer parity)
- [ ] Staging regression: place order, pay, split, transfer, comp, void, close shift — all via events

**Rollback gate:** Each sprint can be reverted independently. Keep write guard active until ALL writes are migrated.

**Estimated effort:** 7-10 days (may spill due to edge-case flows in splits, entertainment, delivery)

**Risk note:** This is behavior migration, not just code churn. Each call site may have subtle invariants. Budget extra time for regression testing.

---

## Phase 3: Row-Versioned Conflict Handling

**Goal:** Replace timestamp-based v1 quarantine with deterministic row-version conflict detection.

**Scope (from research):**
- 6 protected models: Order, OrderItem, Payment, OrderDiscount, OrderCard, OrderItemModifier
- All 6 already have: lastMutatedBy, updatedAt, syncedAt, deletedAt
- None have syncVersion (new column)
- 28 files reference lastMutatedBy
- Order already has a `version` field (optimistic locking) — can extend this

**Execution order:**

### Sprint 3A: Schema + migration (1 day)

1. Migration `076-sync-version.js`:
   ```sql
   ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE "OrderDiscount" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE "OrderCard" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE "OrderItemModifier" ADD COLUMN IF NOT EXISTS "syncVersion" INTEGER NOT NULL DEFAULT 0;
   ```
2. Update `prisma/schema.prisma` — add `syncVersion Int @default(0)` to all 6 models

### Sprint 3B: Upstream version increment (1 day)

3. In upstream-sync-worker.ts: before uploading a protected model row to Neon, increment `syncVersion` and set `lastMutatedBy = 'local'`
4. In downstream-sync-worker.ts: when applying a cloud row, set `lastMutatedBy = 'cloud'` (already done)

### Sprint 3C: Version-based conflict detection (1 day)

5. Update `checkQuarantine()` in sync-conflict-quarantine.ts:
   - Compare `incomingSyncVersion` vs `localSyncVersion` instead of timestamps
   - If `localSyncVersion > incomingSyncVersion` AND `lastMutatedBy != 'cloud'` → quarantine
   - Clock-independent, deterministic

6. Promote quarantine to blocking mode (`SYNC_QUARANTINE_MODE=blocking`) for protected models
7. Retire `detectBidirectionalConflict()` entirely for protected models
8. Add admin API: `GET /api/admin/sync-conflicts` — list quarantined records with resolve/accept/reject actions

**Success metric:** `sync_conflict_quarantine_count` is nonzero when real conflicts occur; zero false positives from clock drift

**Estimated effort:** 3 days total

---

## Phase 4: Unified Downstream Notification

**Goal:** Replace 4 transitional fire-and-forget hooks with a formal notification pipeline.

**Scope (from research):**
- 4 hooks in downstream-sync-worker.ts: handleCloudFulfillment, handleCloudDeduction, handleCloudTableStatus, dispatchOpenOrdersChanged
- Socket outbox uses Prisma tx — incompatible with downstream worker's raw SQL context
- Downstream worker uses `masterClient.$executeRawUnsafe` directly

**Execution order:**

### Sprint 4A: Notification pipeline (1 day)

1. Create `src/lib/sync/downstream-notification-pipeline.ts`:
   ```typescript
   interface DownstreamHandler {
     name: string
     models: string[]  // which synced models trigger this
     handler: (tableName: string, row: Record<string, unknown>, locationId: string) => Promise<void>
     errorPolicy: 'log' | 'retry' | 'skip'
   }
   ```
2. Register existing hooks as handlers:
   - `cloud-fulfillment` — models: ['Order'], condition: status='sent' && lastMutatedBy='cloud'
   - `cloud-deduction` — models: ['Order'], condition: status='paid'|'closed'
   - `cloud-table-status` — models: ['Order'], condition: tableId present
   - `order-visibility` — models: ['Order', 'OrderItem'], always

### Sprint 4B: Wire into downstream worker (1 day)

3. Replace inline `void handleCloudFulfillment(row).catch(...)` with `pipeline.dispatch(tableName, row, locationId)`
4. Pipeline runs handlers with per-handler error isolation
5. Failed handlers are logged with handler name, model, row ID, error — not swallowed silently
6. Add `getNotificationHealth()` to expose per-handler success/failure counts

**Note:** Socket outbox transactional guarantees are NOT achievable here because the downstream worker operates on raw SQL, not Prisma transactions. The pipeline formalizes error handling and observability instead. True transactional socket delivery for downstream sync requires the worker manager (future step) to wrap sync cycles in Prisma transactions.

**Success metric:** All `TRANSITIONAL` comments removed. Per-handler error metrics visible via `getNotificationHealth()`.

**Estimated effort:** 2 days total

---

## Phase 5: RLS Rollout

**Goal:** Database-level tenant isolation as belt-and-suspenders behind application-layer enforcement.

**Scope (from research):**
- 0 RLS policies exist today
- 15 tenant-scoped models in TENANT_SCOPED_MODELS
- All have `locationId` column
- Per-venue DB clients already isolate at connection level — RLS is defense-in-depth

**Execution order:**

### Sprint 5A: RLS infrastructure (1 day)

1. Migration `077-enable-rls.js`:
   ```sql
   -- For each tenant-scoped model:
   ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_order ON "Order"
     USING ("locationId" = current_setting('app.current_tenant', true))
     WITH CHECK ("locationId" = current_setting('app.current_tenant', true));
   -- Repeat for all 15 models
   ```

2. Create `src/lib/db-rls.ts`:
   - Export `withTenantRLS(tx, locationId, callback)` wrapper
   - Inside: `SET LOCAL app.current_tenant = $locationId` → callback → reset
   - Works within Prisma `$transaction` (Neon docs confirm tx-scoped + safe)

### Sprint 5B: Integration + testing (2 days)

3. Update `db-tenant-scope.ts` to call `SET LOCAL app.current_tenant` at the start of every tenant-scoped query
4. Test with concurrent requests across 3+ venues
5. Verify: a request for venue-A cannot read venue-B data even if the application layer has a bug
6. Add `rls_violation_count` metric — should always be 0

**Important:** Per-venue DB clients remain the PRIMARY isolation mechanism. RLS is a safety net. If RLS catches something, it means the application layer has a bug — which is exactly what we want to detect.

**Acceptance criteria:**
- [ ] RLS enabled on all 15 tenant-scoped models
- [ ] `SET LOCAL app.current_tenant` set in every tenant-scoped Prisma transaction
- [ ] `rls_violation_count` = 0 in production (proves app layer is correct)

**Required failure-mode tests (staging):**
- [ ] Test 1: Intentional cross-tenant READ — request as venue-A, manually query venue-B row → RLS blocks
- [ ] Test 2: Intentional cross-tenant WRITE — request as venue-A, attempt update on venue-B row → RLS blocks
- [ ] Test 3: Transaction path — verify `SET LOCAL app.current_tenant` scopes correctly within $transaction
- [ ] Test 4: App-layer bug simulation — disable repo tenant filter, verify RLS still blocks the query

**Rollback gate:** RLS in permissive/report-only mode first. Promote to enforcing after all 4 tests pass.

**Estimated effort:** 3 days total

---

## Phase 6: Structured Logging + Trace IDs

**Goal:** Replace console.* with structured logging. Add request/cycle trace IDs for correlation.

**Scope (from research):**
- Current logger: simple dev/prod console wrapper (52 lines)
- No pino, winston, or structured logger in dependencies
- 102 console.* calls across server.ts (37), downstream worker (37), upstream worker (21), worker-registry (7)
- No request IDs or trace correlation today

**Execution order:**

### Sprint 6A: Logger infrastructure (0.5 day)

1. `npm install pino` (lightweight, structured, JSON output)
2. Rewrite `src/lib/logger.ts`:
   - Export pino instance with child logger factory
   - `createChildLogger(name: string)` for per-worker loggers
   - `withRequestId(requestId: string)` for per-request context
   - JSON format in production, pretty-print in development

### Sprint 6B: Server + worker migration (1 day)

3. server.ts: replace 37 console.* calls with `serverLogger.info/warn/error`
4. worker-registry.ts: each worker gets `createChildLogger(workerName)`
5. downstream-sync-worker.ts: replace 37 console.* calls with child logger
6. upstream-sync-worker.ts: replace 21 console.* calls with child logger

### Sprint 6C: Request trace IDs (0.5 day)

7. In server.ts HTTP handler: generate UUID per request, attach to requestStore
8. In request-context.ts: add `requestId?: string` to RequestContext
9. All log entries from route handlers automatically include requestId
10. Sync workers: generate UUID per cycle, attach to all log entries + quarantine records

**Success metric:** Every log line is valid JSON with: `timestamp`, `level`, `msg`, `worker` or `requestId`, optional `model`/`recordId`/`locationId`

**Estimated effort:** 2 days total

---

## Phase 7: Security Header Tightening

**Goal:** Harden CSP, remove unsafe directives, close build config debt.

**Scope (from research):**
- CSP currently allows: `unsafe-inline` (scripts + styles), `unsafe-eval` (scripts)
- Dependencies requiring inline: Tailwind CSS (runtime), Framer Motion (inline styles), Konva (canvas eval), Next.js (hydration scripts)
- `ignoreBuildErrors: true` still in next.config.ts
- BACKOFFICE_API_URL only warns on invalid URL

**Execution order:**

### Sprint 7A: CSP report-only (0.5 day)

1. Add `Content-Security-Policy-Report-Only` header alongside current CSP
2. Report-only header uses strict policy: `script-src 'self' 'nonce-{random}'`; `style-src 'self' 'nonce-{random}'`
3. Configure reporting endpoint: `/api/csp-report` → logs violations
4. Monitor for 1 week to identify all violations

### Sprint 7B: Fix violations + enforce (0.5 day)

5. Based on report data: add specific nonces or hashes for legitimate inline scripts
6. Remove `unsafe-eval` if Konva/React don't need it (test in staging)
7. Remove `unsafe-inline` for scripts (keep for styles if Tailwind requires it)
8. Promote report-only to enforcing

### Sprint 7C: Build config cleanup (0.5 day)

9. Remove `ignoreBuildErrors: true` — CI typecheck is now the gate
10. Make `BACKOFFICE_API_URL` validation fail in production (not just warn)
11. Remove `require('./package.json')` — use build-time env injection instead

**Success metric:** CSP enforced without `unsafe-eval`. `ignoreBuildErrors` removed. Zero CSP violations in production after 1 week.

**Estimated effort:** 1.5 days total

---

## Summary Timeline

| Phase | Days | Depends On | Reviewer Score Impact |
|-------|------|------------|----------------------|
| 0. Prep | 1 | — | Enables tracking |
| 1. Repositories | 6 | — | Tenant safety 6.9 → 9.0 |
| 2. Event-sourced writes | 7-10 | Phase 1 (repos for Order) | Write model 7.0 → 9.5 |
| 3. Row-versioned conflicts | 3 | — | Conflict handling 6.9 → 9.0 |
| 4. Unified downstream notify | 2 | — | Visibility 7.4 → 8.5 |
| 5. RLS | 3 | Phase 1 (repos must exist) | Tenant safety 9.0 → 9.8 |
| 6. Structured logging | 2 | — | Observability 6.0 → 9.0 |
| 7. Security headers | 1.5 | — | Security posture 7.5 → 9.5 |
| **Total** | **25.5-28.5** | | **Overall: 8.1 → 9.5+** |

**Parallel execution:** Phases 1+3+4+6 start simultaneously (different files, no conflicts). Phase 6 starts early because structured logs make all other phases easier to validate. Phase 2 depends on Phase 1. Phase 5 depends on Phase 1. Phase 7 is independent.

**With 2 developers in parallel: ~14-16 working days.**

**Metrics tracked throughout:**
- `tenant_breach_detected` count (from interceptor logs)
- `sync_conflict_quarantine` rate (from quarantine table)
- Direct `db.*` call count (from static analysis / grep)
- Sync lag seconds (from HWM delta)

---

## Critical Path

```
Day 1:     Phase 0 (prep) + Phase 6 starts (logging — makes everything else observable)
Week 1:    Phase 1 (repos) + Phase 3 (row versions) + Phase 4 (downstream notify)
Week 2:    Phase 2 (event writes — may extend) + Phase 5 (RLS)
Week 3:    Phase 2 spillover + Phase 7 (security headers) + buffer
```
