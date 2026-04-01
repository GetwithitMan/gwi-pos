# GWI-POS Full System Audit — 2026-04-01

**Scope:** 10 parallel audit agents covering every layer of the system
**Methodology:** Static code analysis of all source files, schema, config, and dependencies
**Codebase:** ~240k lines TypeScript/TSX, 837 API routes, 282 components, 140+ DB models, 62 synced models

## Remediation Status (updated 2026-04-01)

**Phase 1 (Emergency):** COMPLETE — 20 files, 0 type errors
**Phase 2 (Critical Fixes):** COMPLETE — 51 files, 0 type errors
**Phase 3 (Hardening):** COMPLETE — 8 files + 456 FK relations, 0 type errors
**Phase 4 (Quality & UX):** IN PROGRESS — error boundaries, client logger, split reconciliation

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 32 | Data loss, security breach, payment errors, cross-venue leakage |
| **HIGH** | 46 | Race conditions, missing validation, silent failures, DoS vectors |
| **MEDIUM** | 52 | Inconsistencies, missing audit trails, performance, UX gaps |
| **LOW** | 35 | Code quality, documentation, minor optimizations |
| **TOTAL** | **165** | Deduplicated across all 10 audit domains |

The system has a **strong architectural foundation** — proper multi-tenancy via Neon, bidirectional sync with conflict detection, granular permissions, and well-structured Zustand state management. However, there are **critical gaps in cross-venue isolation, payment safety, sync correctness, and socket security** that must be addressed before scaling to more venues.

---

## CRITICAL Findings (Top 20 — Fix Immediately)

### Security & Secrets

**S1. Production secrets exposed in `.env.local`**
- File: `.env.local` (lines 28-49)
- SESSION_SECRET, PORTAL_HMAC_SECRET, INTERNAL_API_SECRET, TWILIO_AUTH_TOKEN, CRON_SECRET all in plaintext
- **Action:** Rotate ALL secrets immediately. Scrub from git history with BFG Repo-Cleaner.

**S2. 12 HIGH-severity npm vulnerabilities**
- hono (8 CVEs: XSS, cache deception, IP spoofing, prototype pollution), axios (DoS), socket.io-parser (unbounded attachments DoS), flatted (recursion DoS), effect (AsyncLocalStorage contamination), next (3 CVEs)
- **Action:** `npm audit fix` then verify build.

**S3. Socket auth bypass in non-production**
- File: `src/lib/socket-server.ts:153-157`
- `if (NODE_ENV !== 'production') { socket.data.authenticated = false; return next() }` — staging/demo NUCs have zero socket auth
- **Action:** Require auth in ALL environments.

**S4. Timing-attack on internal API keys**
- File: `src/app/api/internal/provision/route.ts:72`
- Uses `!==` string comparison instead of `timingSafeEqual` — allows character-by-character brute-force of PROVISION_API_KEY
- **Action:** Replace all `apiKey !== expected` with `timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))` across all `/api/internal/*` routes.

**S5. XSS via `dangerouslySetInnerHTML`**
- Files: `src/app/(site)/layout.tsx`, `src/app/(public)/reserve/[slug]/page.tsx`
- `<style dangerouslySetInnerHTML={{ __html: themeCSS }} />` — if themeCSS sourced from DB without sanitization, arbitrary JS injection possible
- **Action:** Use CSS custom properties only; add strict CSS color validator.

### Cross-Venue Data Leakage (Multi-Tenancy)

**T1. Unscoped payment queries in sync-resolution**
- File: `src/app/api/orders/sync-resolution/route.ts` (lines 122, 138, 192, 237)
- Payment dedup, terminal lookup, and offline order resolution all query without `locationId` — Venue A can resolve/modify Venue B's payments
- **Action:** Add `locationId` to every `WHERE` clause in this file.

**T2. Twilio credentials loaded for wrong venue**
- File: `src/lib/twilio.ts:40`
- `db.location.findFirst({ select: { settings: true } })` — no `where: { id: locationId }` — returns ANY location's Twilio config
- **Action:** Scope query to requesting location.

**T3. locationId from request not validated against auth session**
- Multiple routes accept `locationId` from request body/params without verifying it matches the authenticated employee's venue
- **Action:** Extend `withVenue` to inject verified `locationId`; reject mismatches with 403.

### Payment & Financial

**P1. SAF duplicate prevention has 60-second gap**
- File: `src/lib/payments/concurrency-guards.ts:43-68`
- Orphaned sales marked only after 60s — HA failover + terminal restart within that window = double-charge
- **Action:** Increase timeout to 5+ minutes or use DB locks.

**P2. Tip validation conflict: 200% vs 500% cap**
- File: `src/lib/domain/payment/validation.ts:152-199`
- `validateTipBounds()` allows 500%, `validatePaymentAmounts()` caps at 200% — inconsistent rejection
- **Action:** Standardize to single 500% cap in one function called by all routes.

**P3. Pre-auth expiration not checked before capture**
- File: `src/app/api/orders/[id]/pre-auth/route.ts:65-86`
- No validation that pre-auth hasn't expired (Datacap: 7-day limit) — long-running tabs silently fail to capture
- **Action:** Add `preAuthExpiresAt` column; validate before capture.

**P4. Surcharge (negative discount) causes tax overcharge**
- File: `src/lib/order-calculations.ts:301-312`
- Discount allocation block skipped when `existingDiscountTotal` is negative — tax calculated on full subtotal instead of reduced amount
- **Action:** Handle negative discounts in tax allocation path.

**P5. Android idempotencyKey still optional**
- File: `src/lib/domain/payment/validation.ts:62-70`
- Server generates random UUID when missing — defeats double-charge protection entirely for Android terminals
- **Action:** Make required; block payments without it.

### Sync Architecture

**Y1. Missing `lastMutatedBy: 'cloud'` on OrderCard creates**
- Files: `src/app/api/orders/[id]/pre-auth/route.ts:89-113`, `src/app/api/orders/[id]/bottle-service/route.ts:159-172`
- Bidirectional OrderCard model created without origin marker — causes sync loops (cloud→NUC→cloud→...)
- **Action:** Add `lastMutatedBy: 'cloud'` to all card create/update calls in these routes, plus bulk-action, retry-capture, merge.

**Y2. Quarantine still in log-only mode**
- File: `src/lib/sync/sync-conflict-quarantine.ts:25-31`
- Conflicts detected but not blocked — neon-wins overwrites local changes on protected models (Order, Payment)
- **Action:** Audit SyncConflict table for false positives; if clean for 7 days, enable `SYNC_QUARANTINE_MODE=blocking`.

### Order Lifecycle & KDS

**K1. Order status enum mismatch**
- Schema defines 14 states; TS transition map defines 9 — orders can get stuck in `received`, `pending`, `completed`, `merged` with no valid transitions
- Also uses `'void'` (not in schema) alongside `'voided'`
- **Action:** Unify enum; add missing states to transition map.

**K2. KDS items orphaned when forwarded screen deleted**
- File: `src/lib/kds/screen-links.ts:41-175`
- Items keep `kdsForwardedToScreenId = {deleted_screen_id}` forever — invisible on all screens
- **Action:** On screen deletion, reset orphaned items' `kdsForwardedToScreenId` to source screen.

**K3. Voided items never notify kitchen**
- File: `src/lib/domain/comp-void/comp-void-operations.ts`
- Void changes OrderItem.status but never emits socket event to KDS — kitchen continues prepping voided items
- **Action:** Emit `kds:item-voided` socket event on void; mark item red on KDS.

### Build & Config

**B1. `PORTAL_HMAC_SECRET` commented in `.env.example`**
- File: `.env.example:48`
- Fresh NUC deployments will crash on boot (`throw new Error('FATAL: PORTAL_HMAC_SECRET must be set')`)
- **Action:** Uncomment and mark as REQUIRED.

### Infrastructure

**I1. Socket payload DoS — WebSocket frames up to 1MB**
- File: `src/lib/socket-server.ts:301`
- `maxHttpBufferSize: 100KB` only applies to polling; WebSocket default is 1MB — memory exhaustion possible
- **Action:** Set explicit WS frame limit; add per-socket payload accounting.

**I2. Unbounded `pendingAcks` map — memory exhaustion**
- File: `src/lib/socket-ack-queue.ts:50-54`
- No upper bound on Map size; cleanup runs every 30s but entries can accumulate faster
- **Action:** Add `MAX_PENDING_ACKS_PER_SOCKET` with hard eviction.

---

## HIGH Findings (Top 25)

### Security
- H1. Session cookie `sameSite: 'lax'` should be `'strict'` for auth cookies (`auth-session.ts:170`)
- H2. Cellular terminal revocations stored in-memory only — lost on restart (`cellular-auth.ts:108`)
- H3. Customer match-by-card/phone endpoints allow enumeration without rate limiting
- H4. Cellular terminals can spoof `body.employeeId` for payment attribution (`datacap/sale/route.ts:30`)
- H5. Cloud session cookie missing domain restriction (`cloud-auth.ts`)

### API & Validation
- H6. Missing Zod validation on 5+ routes (feedback POST, void-approval, Twilio webhook, etc.)
- H7. `parseInt()` without NaN check on 25+ pagination/query params across routes
- H8. Fire-and-forget `void pushUpstream()` / `void notifyDataChanged()` without `.catch()` on ~50 routes
- H9. Idempotency key accepted but never checked for deduplication (`orders/[id]/items/route.ts:92`)
- H10. No rate limiting on most mutation endpoints (only login and public payment are protected)
- H11. Report CSV export unbounded — `limit=999999999` allowed (`reports/order-history/route.ts:23`)
- H12. Refund amount not validated against original payment amount (`orders/[id]/refund-payment/route.ts`)

### Sync
- H13. Missing `lastMutatedBy` in bulk-action, retry-capture, and merge orderCard updates
- H14. HWM reset uses 1-hour lookback on reprovision (should be 24-48h) (`downstream-sync-worker.ts:195`)

### KDS & Orders
- H15. KDS auto-expiry silently drops orders after 5h with no alert to staff
- H16. Delivery order status doesn't advance when final KDS item bumped
- H17. Split order balance not reconciled — `SUM(splits)` can differ from parent total
- H18. 86'd items not checked at send-to-kitchen time
- H19. No rate limiting / idempotency on KDS bump endpoint — double-tap duplicates items

### Database
- H20. 50+ optional foreign keys missing explicit `onDelete` clause — orphaned records on delete
- H21. N+1 pager query loop in KDS route — 100-200 queries per request (`kds/route.ts:840-868`)
- H22. Order→Employee FK defaults to Restrict — blocks employee hard-delete while orders exist

### Infrastructure
- H23. Terminal online/offline race condition — no optimistic locking (`socket-server.ts:176-265`)
- H24. Worker registry never restarts crashed workers — degraded workers stay dead forever (`worker-registry.ts:62-82`)
- H25. Catch-up event replay DoS — client controls `lastEventId`, can force 10K-row query (`socket-server.ts:520-560`)

### Frontend
- H26. OrderPanel accepts 129 props — massive coupling, untestable
- H27. 3 god-components exceed 2000 lines (OrderPanel 2594, LiquorBuilder 2347, BartenderView 1904)
- H28. Missing error boundaries for payment flow and order panel (only route-level exist)
- H29. Uncontrolled numeric inputs in payment/tip entry — NaN/float precision bugs

### Integrations
- H30. 7shifts client has no circuit breaker or retry queue — silent time punch loss
- H31. Twilio SMS fire-and-forget — void approval codes lost on failure
- H32. Inconsistent error response formats across 837 routes (4 competing shapes)

---

## MEDIUM Findings (Summary — 52 items)

### Database & Schema
- Missing indices on Customer.email, LoyaltyProgram.isActive, sync fields (syncedAt, lastMutatedBy)
- Redundant `@map()` camelCase decorators on Order model
- Denormalized count fields (itemCount, subtotal) without transaction enforcement
- Missing unique constraints on Vendor.name, IngredientCategory.name per location

### API
- Missing boundary checks on numeric Zod fields (price, weight, blockTimeMinutes unbounded)
- Weak enum validation (manual string checks instead of Zod enums)
- No transaction boundaries on multi-step mutations (feedback GET: 3 queries without tx)
- Missing CRUD operations (no PUT/DELETE for customers, feedback)

### Payments
- Convenience fee excluded from tip basis but UI may display "tip on total"
- Partial auth not tracked — card approves less than requested, system records full amount
- SAF status state machine unclear — no timeout, stuck `UPLOAD_FAILED` records persist forever
- Void doesn't reverse commission amounts — over-payment on voided sales
- Cash drawer trigger fire-and-forget — staff doesn't know drawer didn't open

### Sync
- Outage queue silently drops audit logs at 10K soft limit
- Column metadata cache 10-min TTL may cause gaps during schema changes

### KDS & Orders
- Receipt printing decoupled from order finalization — no `receiptPrintedAt` tracking
- Tax-inclusive items + discount + tax-exempt = incorrect tax calculation
- Order numbering lacks DB-level uniqueness constraint per business day

### Frontend
- 2200+ console.log statements in production bundle
- Missing ARIA labels on ~70% of interactive elements
- Touch targets < 48px on POS touchscreen (some buttons 16x16px)
- Impure functions in render phase (Date.now() during render in dispatch page)
- Missing loading states on multiple async operations
- ~20 unoptimized `<img>` tags (should use Next.js Image)

### Infrastructure
- Connection pool exhaustion not detected or circuit-broken (`health/route.ts`)
- Socket.io polling transport enabled (unnecessary on LAN, wastes connections)
- Verbose debug socket logs can fill disk at 1000s/sec
- Event buffer doesn't clean up deleted locations — unbounded Map growth
- Graceful shutdown 30s drain may leave DB transactions uncommitted

### Business Logic
- Discount stacking unlimited — multiple discounts can exceed 100% of subtotal
- Tax rate not snapshotted on order creation — changes mid-day affect historical orders
- Inclusive + exclusive tax items can be mixed in same order
- Report aggregations missing `deletedAt: null` filter — inflated void counts
- Driver assignment not validated against location
- Reservation lock acquisition has no timeout

### Build & Config
- Playwright port mismatch (3005 in tests vs 3006 in dev)
- React Compiler rules downgraded to warnings
- 16 grandfathered eslint-disable violations
- `ignoreBuildErrors: true` in next.config (mitigated by CI, but fragile)

---

## Remediation Roadmap

### Phase 1: Emergency (This Week)
| # | Action | Domain | Effort |
|---|--------|--------|--------|
| 1 | Rotate ALL secrets in `.env.local`; scrub git history | Security | 2h |
| 2 | `npm audit fix` — patch 12 vulnerable packages | Security | 1h |
| 3 | Add `locationId` to all queries in `sync-resolution/route.ts` | Multi-tenancy | 2h |
| 4 | Scope Twilio credential loading to requesting location | Multi-tenancy | 30m |
| 5 | Add `lastMutatedBy: 'cloud'` to pre-auth, bottle-service, bulk-action, retry-capture, merge | Sync | 2h |
| 6 | Replace string `!==` with `timingSafeEqual` in all `/api/internal/*` routes | Security | 2h |
| 7 | Require socket auth in ALL environments | Security | 30m |
| 8 | Uncomment `PORTAL_HMAC_SECRET` in `.env.example` | Config | 5m |
| 9 | Make idempotencyKey required for Android payments | Payments | 1h |
| 10 | Fix tip validation conflict (standardize to single cap) | Payments | 1h |

### Phase 2: Critical Fixes (Week 2)
| # | Action | Domain | Effort |
|---|--------|--------|--------|
| 11 | Unify Order status enum (schema ↔ TS transitions) | Orders | 3h |
| 12 | Add KDS void notification (socket event on item void) | KDS | 2h |
| 13 | Fix orphaned KDS items on screen deletion | KDS | 2h |
| 14 | Increase SAF orphan timeout from 60s to 5min | Payments | 30m |
| 15 | Add pre-auth expiration check before capture | Payments | 2h |
| 16 | Fix surcharge tax calculation (negative discounts) | Payments | 2h |
| 17 | Add `.catch()` to all fire-and-forget pushUpstream/notifyDataChanged | Sync/API | 4h |
| 18 | Add `parseInt` NaN guards across 25+ routes | API | 3h |
| 19 | Validate refund amount <= original payment | Payments | 1h |
| 20 | Add Zod validation to 5 critical unvalidated routes | API | 3h |

### Phase 3: Hardening (Weeks 3-4)
| # | Action | Domain | Effort |
|---|--------|--------|--------|
| 21 | Add error boundaries for payment flow and order panel | Frontend | 3h |
| 22 | Implement worker restart mechanism with exponential backoff | Infra | 4h |
| 23 | Add rate limiting to mutation endpoints | API | 4h |
| 24 | Add `pendingAcks` Map size limit and per-socket tracking | Infra | 2h |
| 25 | Fix terminal online/offline race with optimistic locking | Infra | 3h |
| 26 | Add idempotency key dedup checking for order item creation | API | 3h |
| 27 | Enable quarantine blocking mode after staging validation | Sync | 1h |
| 28 | Implement 7shifts + Twilio retry queues | Integrations | 4h |
| 29 | Add explicit `onDelete` to 50+ optional FK relations | Database | 4h |
| 30 | Standardize error response format across all routes | API | 8h |

### Phase 4: Quality & UX (Month 2)
- Refactor OrderPanel (129 props → context providers)
- Break up 3 god-components (>2000 lines each)
- Add ARIA labels to all interactive elements
- Increase touch targets to 48x48px minimum
- Replace 2200+ console.log with structured logger
- Fix Playwright port mismatch
- Add missing DB indices (Customer.email, sync fields)
- Add split order balance reconciliation
- Add discount stacking cap
- Snapshot tax rate on order creation

---

## Audit Coverage

| Domain | Agent | Findings | Key Risk |
|--------|-------|----------|----------|
| Schema & Database | audit-schema | 22 | FK cascades, missing indices |
| API Routes | audit-api | 19 | Validation gaps, race conditions |
| Auth & Security | audit-security | 39 | Exposed secrets, XSS, timing attacks |
| Sync Architecture | audit-sync | 14 | lastMutatedBy gaps, sync loops |
| Payment & Checkout | audit-payments | 22 | Double-charge, tip conflicts, tax errors |
| Frontend & UI | audit-frontend | 20 | God components, accessibility, touch targets |
| KDS & Orders | audit-kds-orders | 19 | Enum mismatch, orphaned items, void gaps |
| Build & Config | audit-build | 18 | npm vulns, port mismatch, env gaps |
| Middleware & Server | audit-middleware | 20 | Socket DoS, memory leaks, worker crashes |
| Business Logic | audit-business | 23 | Cross-venue leakage, retry gaps |
| **TOTAL** | **10 agents** | **165** (deduplicated) | |

---

*Generated by 10-agent parallel audit — 2026-04-01*
