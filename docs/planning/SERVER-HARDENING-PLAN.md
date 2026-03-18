# Server Hardening Plan

> **Status:** COMPLETE
> **Created:** 2026-03-18
> **Completed:** 2026-03-18
> **Priority:** P0 items before any new feature work

## Executive Summary

The server architecture is strong enough to scale, but has foundation-level weaknesses that can create silent corruption, tenant escape, or operational blind spots.

**Current stack flow:**
```
Devices → Proxy/Auth Boundary → Route/Domain Logic → Prisma/Tenant DB Access
  → Local Commit → Socket Outbox/Sync Workers → Cloud/Neon
```

The sync registry explicitly defines upstream/downstream/bidirectional ownership, the custom server starts sync and worker processes, and the DB layer applies soft-delete and tenant scoping automatically.

### What Is Already Good (Do Not Remove)

- **SYNC_MODELS** is a real sync ownership map with direction, owner, priority, batch size, and conflict strategy
- **Server** clearly starts the local store runtime and workers as first-class infrastructure
- **DB layer** centralizes soft-delete and tenant scoping instead of relying on route authors
- **Auth tests** show the codebase is moving toward verified actor/location rules

---

## Non-Negotiable Architecture Rules

These should become permanent rules for the team:

1. **Fail closed, not open**
2. **No tenant identity from plain headers without trusted binding**
3. **No critical internal workflow should call localhost HTTP routes**
4. **No new model/table can exist without explicit ownership, tenant, and soft-delete classification**
5. **No new worker without lifecycle, health, and shutdown ownership**
6. **No production deploy that ignores TypeScript correctness**
7. **No money/order conflict policy that defaults to a generic winner**
8. **No critical path without structured logging and trace IDs**

---

## P0: Must Fix First

### P0.1 — Make Sync Registration Fail Closed

**Problem:** `validateSyncCoverage()` auto-registers unknown tables as upstream sync by default. A newly created table could be cloud-owned, local-only, sensitive, or unsafe to sync. Fail-open data architecture.

**File:** `src/lib/sync/sync-config.ts`

**Required Changes:**
- Keep auto-registration only in local dev
- In production, unknown table = **boot failure**
- Validate that every table in `LOCAL_ONLY_TABLES` and `SYSTEM_TABLES` actually exists (catch stale names)
- Validate all priorities are unique and registry is not empty before `Math.max`

**Definition of Done:**
- [ ] Startup fails in prod if any table is not explicitly classified
- [ ] No runtime mutation of canonical sync registry without clear separation between "declared config" and "effective runtime view"

---

### P0.2 — Replace Fragile Prisma Tenant Scoping

**Problem:** DB layer injects tenant filters into Prisma query hooks with `as any`. For `findUnique`, it queries first then rejects if `locationId` mismatches. Too clever for a POS tenant boundary.

**File:** `src/lib/db.ts`

**Required Changes:**
- Stop mutating `findUnique`, `update`, `delete` into pseudo-composite filters
- Move tenant-sensitive read/write to repository/service methods:
  - `getOrderByIdForLocation(id, locationId)`
  - `updatePaymentForLocation(id, locationId, patch)`
  - `deleteCustomerForLocation(id, locationId)`
- Use `findFirst`/`findFirstOrThrow` or explicit composite unique patterns where tenant is part of the true key
- Remove `as any` from tenant enforcement paths
- Export and validate `TENANT_SCOPED_MODELS` and `NO_SOFT_DELETE_MODELS` in CI

**Definition of Done:**
- [ ] Tenant scope enforced by query shape, not post-read mismatch checks
- [ ] No critical tenant enforcement depends on `as any`

---

### P0.3 — Cryptographically Bind Tenant Context

**Problem:** Tenant routing depends on plain `x-venue-slug` header. Not strong enough for a production multi-tenant POS boundary.

**Files:** `src/proxy.ts`, `src/lib/db.ts`

**Required Changes:**
- For internal proxy → app requests, sign the tenant context:
  - HMAC-signed header bundle, OR
  - Internal JWT with venue, actor, terminal, and expiry, OR
  - mTLS if infrastructure supports it
- Application server trusts tenant context only from:
  - Signed internal proxy headers
  - Validated session/token claims
  - Explicit internal service identity

**Definition of Done:**
- [ ] A forged plain header cannot switch tenant databases

---

### P0.4 — Remove localhost Self-HTTP for Internal Jobs

**Problem:** Internal jobs call `http://localhost:${port}/api/...` — structurally weak. Internal jobs should call domain services directly.

**File:** `server.ts` (EOD scheduler, draft cleanup, walkout retry)

**Required Changes:**
Create direct services for:
- Stale order cleanup
- Walkout retry sweep
- Online order dispatch
- Draft cleanup
- EOD cleanup

Routes call services. Workers call the same services. No localhost loop.

**Definition of Done:**
- [ ] No critical scheduler depends on the HTTP server being available to itself

---

### P0.5 — Remove "Ignore Build Errors" from Production Safety

**Problem:** `next.config.ts` uses `typescript.ignoreBuildErrors = true`. Must not become a production correctness policy.

**File:** `next.config.ts`

**Required Changes:**
- Keep packaging workaround only if needed for Vercel OOM
- Add hard CI gate: `tsc --noEmit` must pass for deploy
- Make deploy impossible if type gate fails

**Definition of Done:**
- [ ] Production artifacts cannot ship with broken types

---

## P1: Next Hardening Layer

### P1.1 — Break Up the Proxy into Policy Modules

**Problem:** Proxy combines local/cloud/cellular mode detection, route allowlists, auth, grace tokens, rate limits, fencing, and routing context. Too much surface in one place.

**File:** `src/proxy.ts` (587 lines)

**Required Changes — Split into:**
- `proxy-mode-detection`
- `proxy-cellular-auth`
- `proxy-cloud-auth`
- `proxy-access-gate`
- `proxy-fence-policy`
- `proxy-header-context`
- One small orchestrator

**Definition of Done:**
- [ ] Top-level proxy flow readable in one screen
- [ ] Each mode and policy unit-testable in isolation

---

### P1.2 — Make Worker Lifecycle Formal

**Problem:** Server starts many workers (sync, cloud event queue, cleanup schedulers, dispatchers, bridges) with ad hoc lifecycle.

**File:** `server.ts`

**Required Changes — Create worker manager with:**
- `register(name, start, stop, health, requiredLevel)`
- Categories: `required`, `degraded`, `optional`
- Startup summary
- Health summary with last-success timestamp
- Structured shutdown ordering

**Definition of Done:**
- [ ] Every worker has an owner, health contract, and shutdown contract

---

### P1.3 — Add Structured Logging and Trace IDs

**Problem:** Codebase is still console-driven. Not enough for distributed POS tracing.

**Required Changes:**
- Add request ID / trace ID at the edge (proxy)
- Propagate through: proxy → routes → domain services → DB transaction logs → socket outbox → sync workers
- Switch to structured logging for all server/runtime paths

**Definition of Done:**
- [ ] A customer complaint can be traced across request → transaction → outbox → socket → sync

---

### P1.4 — Add Sync Circuit Breakers and Backoff Policy

**Problem:** `neon-wins` is used on bidirectional operational models including Order, OrderItem, Payment. Too blunt for money and live order state.

**File:** `src/lib/sync/sync-config.ts`

**Required Changes:**
- Per-model retry/backoff and failure quarantine
- Sync lag metrics
- Conflict audit records
- Replace blanket `neon-wins` on money/order models with model-aware logic:
  - Event versioning
  - State-machine-aware resolution
  - Append-only event truth where possible

**Definition of Done:**
- [ ] A delayed cloud copy cannot silently overwrite a legitimate local outage-time payment/order state without explicit conflict policy

---

### P1.5 — Tighten Cellular Auth

**Problem:** Proxy/cellular logic needs formal revocation and shorter trust windows.

**File:** `src/lib/cellular-auth.ts`, `src/proxy.ts`

**Required Changes:**
- Device revocation / kill-switch list
- Mandatory fingerprint where possible
- Reduce grace window or make adaptive
- Never rely on refreshed auth headers unless TLS guaranteed
- Enforce sensitive authorization inside route/service layer (not just proxy)

**Definition of Done:**
- [ ] A stolen or rogue device can be revoked quickly and globally

---

## P2: Cleanup and Future-Proofing

### P2.1 — Turn Magic Model Lists into Validated Registries

**Problem:** Same pattern in multiple places: `LOCAL_ONLY_TABLES`, `SYSTEM_TABLES`, `TENANT_SCOPED_MODELS`, `NO_SOFT_DELETE_MODELS`, cellular route allowlists.

**Required Changes:**
- Export from one authoritative module per concern
- Validate in CI or startup
- "Unknown model without classification" check

**Definition of Done:**
- [ ] Adding a new model without classifying it fails fast

---

### P2.2 — Tighten CSP and Security Headers

**Problem:** CSP still allows `'unsafe-inline'` and `'unsafe-eval'`.

**File:** `next.config.ts`

**Required Changes:**
- Move toward nonce-based CSP in prod
- Add reporting endpoint
- Add: `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`
- Dev can stay looser; prod must tighten

**Definition of Done:**
- [ ] Production CSP no longer depends on unsafe script exceptions unless explicitly justified

---

### P2.3 — Centralize Env/Config Validation

**Problem:** Server and proxy depend on many env flags via brittle string comparisons like `process.env.SYNC_ENABLED === 'true'`.

**Required Changes:**
- Create `system-config.ts` with schema validation
- Parse and coerce: booleans, integers, durations, URLs, modes, required envs
- Expose typed config object to the app

**Definition of Done:**
- [ ] No business-critical behavior depends on raw env string comparisons

---

## Target Architecture After Hardening

```
1. Edge Layer
   └─ Proxy determines mode → validates identity → attaches signed context → issues trace ID

2. Route Layer
   └─ Thin handlers only → no core logic → route factory/auth wrapper

3. Domain Layer
   └─ Domain services own validation + business rules
   └─ Repositories own tenant-safe DB access
   └─ Payment/order state machines remain authoritative

4. Transaction Layer
   └─ DB commit → outbox append → audit append → NO localhost loops

5. Realtime/Sync Layer
   └─ Socket outbox flush → per-model conflict policy
   └─ Sync workers with backoff/quarantine → observable lag + replay state

6. Ops Layer
   └─ Worker manager → health/metrics/tracing → startup validation → graceful shutdown
```

---

## Execution Order

| Step | Item | Priority | Status |
|------|------|----------|--------|
| 0 | Typed runtime config | P0 | DONE |
| 1 | Fail-closed sync config | P0 | DONE |
| 2 | Tenant-safe DB layer + validation | P0 | DONE |
| 3 | Replace localhost jobs with services | P0 | DONE |
| 4 | Signed proxy-to-app tenant JWT | P0 | DONE |
| 5 | Hard CI type + schema drift gate | P0 | DONE |
| 6 | Money/order conflict quarantine (v1 log-only) | P0 | DONE |
| 7 | Proxy modularization (7 modules) | P1 | DONE |
| 8 | Worker manager + health + lifecycle | P1 | DONE |
| 9 | Structured logs + trace IDs (edge + sync) | P1 | DONE |
| 10 | Cellular revocation + tighter grace | P1 | DONE |
| 11 | CSP + security header tightening | P2 | DONE |
| 12 | RLS auto-enforcement in transactions | P2 | DONE |
| 13 | ESLint ban on unscoped tenant queries | P2 | DONE |
