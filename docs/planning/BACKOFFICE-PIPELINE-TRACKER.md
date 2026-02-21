# GWI — NUC-to-Cloud Backoffice Pipeline (LIVE)

**Started:** February 19, 2026
**Lead:** Brian Lewis
**Status:** Phase 1 — COMPLETE (Proven Working)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│              MISSION CONTROL (Cloud — Vercel)                    │
│  Fleet registration • NUC provisioning • Global monitoring       │
│  app.thepasspos.com • Clerk B2B auth • Neon PostgreSQL           │
│  GWI-INTERNAL ONLY — not customer-facing                         │
└──────────────────────────────┬────────────────────────────────────┘
                               │ Heartbeat + Sync
┌──────────────────────────────┼────────────────────────────────────┐
│              VENUE BACKOFFICE (Cloud — Java 25 + Spring Boot)     │
│  Event ingestion • Reporting • Admin dashboard                    │
│  api.ordercontrolcenter.com (API — direct from NUC)               │
│  {slug}.ordercontrolcenter.com/admin (UI — proxied via Next.js)   │
│  HMAC-SHA256 auth • Neon PostgreSQL (shared cloud DB)             │
└──────────────────────────────┬────────────────────────────────────┘
                               │ Events (HMAC-signed, fire-and-forget)
┌──────────────────────────────┼────────────────────────────────────┐
│              LOCAL NUC SERVER (Ubuntu — Node.js)                  │
│  GWI POS • Socket.io • Local PostgreSQL                           │
│  Emits order_paid events after payment                            │
│  Retry queue for failed emissions (30s interval, exp backoff)     │
└──────────────────────────────┬────────────────────────────────────┘
                               │ Local WiFi / Ethernet
                    Terminals (Chromium kiosk) + Phones/iPads (PWA)
```

### Three Repos

| | GWI POS | GWI Backoffice | GWI Mission Control |
|---|---------|---------------|-------------------|
| **Repo** | `gwi-pos` | `gwi-backoffice` | `gwi-mission-control` |
| **Stack** | Next.js 16 + React 19 + Prisma | Java 25 + Spring Boot 3.4 | Next.js + Clerk |
| **Domain** | `{slug}.ordercontrolcenter.com` | `api.ordercontrolcenter.com` + `/admin` proxy | `app.thepasspos.com` |
| **Database** | Neon PG (one DB per venue) | Neon PG (shared cloud DB) | Neon PG (single master) |
| **Auth** | Employee PIN (per-venue) | HMAC-SHA256 (NUC events), API Key (reports) | Clerk B2B (org admin) |
| **Purpose** | POS ordering, payments, KDS, menu, floor plan | Event ingestion, reporting, venue admin dashboard | Fleet management, provisioning, global monitoring |
| **GitHub** | GetwithitMan/gwi-pos | GetwithitMan/gwi-backoffice | GetwithitMan/gwi-mission-control |

### Domain Architecture

```
*.ordercontrolcenter.com
├── fruita-grill.ordercontrolcenter.com
│   ├── /              → Next.js POS (login, orders, KDS, menu admin)
│   ├── /admin          → Java Backoffice (proxied via Next.js rewrites)
│   └── /api/...        → Next.js POS API routes
│
├── api.ordercontrolcenter.com
│   ├── /api/events/ingest    → Java: HMAC-verified event ingestion
│   ├── /api/reports/...      → Java: Reporting endpoints
│   ├── /health               → Java: Health check
│   └── /api/admin/...        → Java: Dead letter admin
│
└── app.thepasspos.com         → Mission Control (GWI internal)
```

### Event Flow: NUC → Cloud

```
Payment in POS
  → pay/route.ts calls emitCloudEvent("order_paid", {...})
    → HMAC-SHA256 sign body with SERVER_API_KEY
    → POST to BACKOFFICE_API_URL/api/events/ingest
      → Headers: X-Server-Node-Id, X-Request-Signature
    → On success: log + done
    → On failure: queue to cloud_event_queue table (local PG)
      → Background worker retries every 30s
      → Exponential backoff, capped at 1 hour
      → Max queue size: 1000 events (FIFO eviction)

Java Backoffice receives event:
  → Verify HMAC signature (constant-time comparison)
  → Validate X-Server-Node-Id
  → INSERT INTO events (idempotent: ON CONFLICT DO NOTHING)
  → If order_paid: extract payments[] → INSERT INTO payment_facts
    → Idempotent: ON CONFLICT (venue_id, payment_id) DO NOTHING
  → On parse/validation failure: INSERT INTO dead_letter_events
```

---

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backoffice location | Same domain, `/admin` path | One domain per venue, clean UX, done right |
| MC future | Keep for GWI global admin only | Fleet management ≠ venue admin |
| NUC → Cloud URL | Centralized `api.ordercontrolcenter.com` | All NUCs use one endpoint, venue ID in payload |
| Admin UI proxy | Next.js rewrites → Java service | No extra infra, venue slug available via headers |
| Event auth | HMAC-SHA256 per request | Same pattern as heartbeat, proven |
| Idempotency | payment_id composite key | Safe replay/retry without duplicate financial rows |
| Retry strategy | Local PG queue + exponential backoff | Survives NUC restarts, no data loss |
| Java version | 25 (fallback: 21) | Virtual threads, modern features |
| ORM | JdbcTemplate (not JPA) | Simple, fast, no magic |

---

## Phase 1: Pilot — Prove the Pipeline

**Goal:** End-to-end proof: NUC emits `order_paid` → Java ingests → cloud API returns daily totals per venue.

### Status Dashboard

| # | Task | Status | Agent/Owner | Notes |
|---|------|--------|-------------|-------|
| **A — NUC Event Emission (gwi-pos)** | | | | |
| A1 | `cloud-events.ts` — HMAC emitter | ✅ Complete | Agent | HMAC-SHA256 signed POST to backoffice |
| A2 | `cloud-event-queue.ts` — retry queue | ✅ Complete | Agent | Prisma model + background worker (30s interval, exp backoff) |
| A3 | Wire `order_paid` in pay route | ✅ Complete | Agent | Fire-and-forget after payment |
| A4 | Env vars (`.env.local`) | ✅ Complete | Agent | `BACKOFFICE_API_URL`, `SERVER_API_KEY`, `SERVER_NODE_ID` |
| A5 | Next.js rewrites for `/admin` proxy | ✅ Complete | Agent | `next.config.ts` updated |
| A6 | TypeScript check | ✅ Complete | Agent | Clean build |
| A7 | `CloudEventQueue` soft-delete fix | ✅ Complete | Agent | Added to `NO_SOFT_DELETE_MODELS` in db.ts |
| **B — Java Backoffice (gwi-backoffice)** | | | | |
| B1 | Spring Boot scaffold | ✅ Complete | Agent | Java 25 + Gradle + virtual threads |
| B2 | Neon schema (venues, events, payment_facts) | ✅ Complete | Agent | SQL migrations |
| B3 | Event ingestion endpoint | ✅ Complete | Agent | HMAC + idempotent (`ON CONFLICT DO NOTHING`) |
| B4 | Daily totals report endpoint | ✅ Complete | Agent | Per-venue aggregation |
| B5 | Health + dead letter admin | ✅ Complete | Agent | /health + /api/admin/dead-letters |
| B6 | Dockerfile + docker-compose | ✅ Complete | Agent | Local dev ready |
| B7 | CORS config for venue subdomains | ✅ Complete | Agent | Allow *.ordercontrolcenter.com |
| B8 | Admin controller placeholder | ✅ Complete | Agent | /admin → "Coming Soon" |
| B9 | Architecture docs (README) | ✅ Complete | Agent | Unified domain docs |
| **C — Documentation** | | | | |
| C1 | CLAUDE.md architecture update | ✅ Complete | — | Architecture diagram + backoffice section added |
| C2 | This living tracker | ✅ Complete | — | You're reading it |
| C3 | Skill docs (374, 375) | ✅ Complete | — | Reports auth fix + NUC-Cloud pipeline |
| **D — Reports Auth Fix (gwi-pos)** | | | | |
| D1 | Fix 14 report pages missing `employeeId` | ✅ Complete | Agent | All pages now include `employeeId` from auth store |
| D2 | Deterministic `getLocationId()` | ✅ Complete | Agent | `orderBy: { id: 'asc' }` in location-cache.ts |
| D3 | Delete stale location record | ✅ Complete | Agent | Removed "gwi-admin-dev" (`cmlkcq9ut0001ky04fv4ph4hh`) |

### End-to-End Test Results (Feb 19, 2026)

| Metric | Value |
|--------|-------|
| Orders processed | 7+ |
| Gross sales | $50.71 |
| Pipeline status | **PROVEN WORKING** |
| Bugs found & fixed | 3 (field name mappings, CloudEventQueue soft-delete, orderNumber type cast) |
| Reports auth fix | 14 pages fixed |
| Stale location cleanup | 1 record deleted |
| All fixes committed & pushed | Both repos (gwi-pos + gwi-backoffice) |

### Env Vars (NUC / POS)

| Variable | Dev Value | Production Value | Purpose |
|----------|-----------|-----------------|---------|
| `BACKOFFICE_API_URL` | `http://localhost:8080` | `https://api.ordercontrolcenter.com` | Java backoffice base URL |
| `SERVER_API_KEY` | `dev-secret` | Per-venue secret (provisioned) | HMAC signing key |
| `SERVER_NODE_ID` | `dev-nuc-1` | Per-NUC ID (provisioned) | Node identification |

### Cloud Database Schema (Java Backoffice — Neon)

```sql
-- Venue registry (linked to POS location IDs)
venues (id TEXT PK, name TEXT, slug TEXT UNIQUE, created_at)

-- Raw event log (idempotent by event_id)
events (event_id UUID PK, venue_id FK, event_type, occurred_at, payload JSONB, ingested_at)

-- Materialized payment facts (idempotent by venue_id + payment_id)
payment_facts (venue_id FK, order_id, payment_id, payment_method, amount, tip_amount,
               total_amount, card_last4, paid_at, ingested_at)
  PK: (venue_id, payment_id)

-- Failed event storage for debugging
dead_letter_events (id BIGSERIAL PK, raw_body TEXT, error_message, received_at, retried BOOLEAN)
```

---

## Phase 2: Admin Dashboard (Planned)

**Goal:** Real admin UI at `{slug}.ordercontrolcenter.com/admin` — daily reports, employee summaries, trend charts.

| Task | Status | Notes |
|------|--------|-------|
| Admin SPA (React or Thymeleaf) | Not Started | Served by Java at /admin |
| Daily sales dashboard | Not Started | Uses /api/reports/daily-totals |
| Payment method breakdown | Not Started | Cash / credit / debit charts |
| Employee performance view | Not Started | Needs employee_id in payment_facts |
| "Data as of" sync indicator | Not Started | Shows last ingested_at timestamp |
| Date range selector | Not Started | Filter by day/week/month |

---

## Phase 3: Expanded Events (Planned)

**Goal:** More event types beyond `order_paid` for richer cloud analytics.

| Event Type | Trigger | Payload | Status |
|------------|---------|---------|--------|
| `order_paid` | Payment completes | Order + payments array | ✅ Phase 1 |
| `order_voided` | Order voided | Order ID, reason, employee | Not Started |
| `order_comped` | Order comped | Order ID, comp reason, amount | Not Started |
| `shift_closed` | Shift end/EOD | Employee, tips, hours, sales | Not Started |
| `inventory_alert` | Stock below threshold | Item, current qty, threshold | Not Started |
| `employee_clockin` | Clock in/out | Employee, role, timestamp | Not Started |
| `menu_updated` | Menu item changed | Item ID, changes | Not Started |

---

## Phase 4: Real-Time Sync (Future)

**Goal:** Replace fire-and-forget events with bi-directional sync for near-real-time cloud data.

| Feature | Notes |
|---------|-------|
| SSE/WebSocket from cloud → NUC | Push config changes, menu syncs |
| Conflict resolution | Cloud vs. local edit handling |
| Offline queue flush ordering | Ensure chronological integrity |
| Multi-NUC coordination | Same venue, multiple NUC servers |

---

## Verification Checklist (Phase 1) — ALL PASSED Feb 19, 2026

- [x] Start Java backoffice: `cd gwi-backoffice && ./gradlew bootRun`
- [x] Set POS env: `BACKOFFICE_API_URL=http://localhost:8080`, `SERVER_API_KEY=dev-secret`, `SERVER_NODE_ID=dev-nuc-1`
- [x] Restart POS dev server: `npm run dev`
- [x] Make a payment in POS (open tab → add item → pay)
- [x] Verify Java logs show ingested event
- [x] Verify rows in `events` + `payment_facts` tables
- [x] Call: `curl "http://localhost:8080/api/reports/daily-totals?venueId=<id>&date=2026-02-19"`
- [x] Confirm totals match the payment made — 7+ orders, $50.71 gross
- [x] Kill Java → make another payment → restart Java → verify retry queue flushes
- [x] Check `/api/admin/dead-letters` → expect 0 entries in normal operation
- [x] Access `http://localhost:3005/admin` → verify proxy to Java backoffice works

---

## Reporting UX — Sync Gap Rules

Any cloud dashboard using backoffice data MUST show:

```
Data as of: 2026-02-19 09:05 MST (last successful sync)
```

If the NUC is offline or behind, this timestamp will lag. The UI must:
- Never imply real-time data
- Show a subtle note when data is stale:
  > "Live POS may be ahead of this view. Check on-site for up-to-the-minute numbers."

---

## Commits & Pushes

| Date | Repo | Commit | Description |
|------|------|--------|-------------|
| 2026-02-19 | gwi-pos | — | Initial cloud-events.ts, cloud-event-queue.ts, pay route wiring |
| 2026-02-19 | gwi-backoffice | — | Initial scaffold: Spring Boot + event ingestion + reports |
| 2026-02-19 | gwi-pos | — | Architecture update: BACKOFFICE_API_URL, Next.js rewrites |
| 2026-02-19 | gwi-backoffice | — | CORS config, admin controller, architecture docs |
| 2026-02-19 | gwi-pos | — | Bug fixes: field name mappings, CloudEventQueue soft-delete, orderNumber type cast |
| 2026-02-19 | gwi-backoffice | — | Bug fixes: field name mappings, orderNumber type handling |
| 2026-02-19 | gwi-pos | — | Reports auth fix: 14 pages + deterministic getLocationId() + stale location cleanup |

---

*This is a living document. Updated as work progresses.*
