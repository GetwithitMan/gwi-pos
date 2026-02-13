# Mission Control Changelog

## Session: February 12, 2026 (Cloud Auth + Team Management + Venue Provisioning)

### Summary
Built the cloud auth flow between MC and POS, the team management page, venue admin portal, and fixed critical locationId handoff issues. POS cloud admin at `{slug}.ordercontrolcenter.com` now works end-to-end.

### Cloud Auth (Skill 330)
- **POS**: HMAC-SHA256 JWT validation, httpOnly cloud session cookie, admin-only route blocking
- **POS**: `*.ordercontrolcenter.com` subdomain detection in middleware
- **POS**: Multi-tenant infrastructure: per-venue Neon DBs, provisioning API
- **MC**: `generatePosAccessToken()` JWT generation with user + venue claims
- **MC**: `/pos-access/{slug}` redirect page (Clerk auth → JWT → POS redirect)
- **MC**: Updated venue links to use `ordercontrolcenter.com` subdomains

### Team Management (Skill 331)
- **MC**: Team management page at `/venue/{slug}/admin/team`
- **MC**: Clerk API integration for invite, role change, remove members
- **MC**: `TeamManager` client component with member table, invite modal, pending invitations
- **MC**: API routes: `/api/venue/{slug}/team` (GET/POST), `/api/venue/{slug}/team/{userId}` (PUT/DELETE)
- **MC**: Fixed: Link CloudOrganization to Clerk org for team lookups

### Venue Admin Portal (Skill 332)
- **MC**: Full sidebar nav with POS-matching dark UI at `/venue/{slug}/admin/*`
- **MC**: Settings, team, floor plan, hardware, servers pages
- **MC**: Neon provisioning: `provisionPosDatabase()` calls POS provision endpoint
- **MC**: Venue Admin quick links on location detail page

### Venue Provisioning Fix (Skill 329) — CRITICAL
**Problem**: Cloud admin sessions had wrong `locationId`, causing FK constraint errors on all writes.

**Three progressive fixes**:
1. `019f6a1` — Cloud admin gets `'admin'` permission (not `'all'`)
2. `2c8263e` — Cloud-session auto-creates Location in master DB (was using fake IDs)
3. `703e0ea` — Cloud-session uses `findFirst()` instead of name-based search (was creating duplicates)

**Definitive fix** (posLocationId handoff):
- POS: Provision endpoint returns `posLocationId` in response
- MC: Stores `posLocationId` on CloudLocation schema
- MC: Includes `posLocationId` in JWT token
- POS: Cloud-session uses JWT's posLocationId directly, with findFirst fallback

### Commits

**POS (gwi-pos)**:
- `c8a779d` — feat: posLocationId handoff (Skill 329)
- `703e0ea` — fix: cloud-session uses first existing Location
- `2c8263e` — fix: cloud-session auto-creates Location in master DB
- `019f6a1` — fix: cloud admin gets 'admin' permission
- `5a6a8c4` — fix: cloud auth gracefully handles missing venue database
- `e7a4ee5` — fix: Uint8Array BufferSource type mismatch in cloud-auth
- `a1a8352` — fix: remove deletedAt filter from Location query
- `8fa4a03` — feat: cloud auth admin-only access
- `501666b` — feat: *.ordercontrolcenter.com venue subdomains
- `8801810` — feat: multi-tenant infrastructure

**MC (gwi-mission-control)**:
- `1ff0750` — feat: posLocationId in JWT (Skill 329)
- `8e7980d` — feat: Venue Admin quick links on location detail
- `aa58e24` — fix: link CloudOrganization to Clerk org
- `e3920de` — feat: team management page
- `f24e826` — feat: POS access token generation
- `e0617e6` — fix: venue POS links use ordercontrolcenter.com
- `d417ba0` — feat: strip duplicate POS pages, Neon provisioning
- `2493d11` — feat: venue admin portal

### New Skills Documented
- Skill 329: Venue Provisioning locationId Handoff
- Skill 330: Cloud Auth Venue Admin
- Skill 331: MC Team Management Page
- Skill 332: MC Venue Admin Portal

### Known Issues
- 13 POS routes have hardcoded `DEFAULT_LOCATION_ID = 'loc-1'` — need updating to read from auth session
- Per-venue database routing not yet implemented (all routes use master `db`)
- Empty ingredient categories hidden in hierarchy view (by design, but confusing for new users)

### How to Resume
1. Say: `PM Mode: Mission Control`
2. Review PM Task Board for remaining tasks
3. Key priorities: per-venue DB routing middleware, DEFAULT_LOCATION_ID cleanup

---

## Session: February 12, 2026 (Production Deploy + Domain Setup)

### Summary
Pushed Mission Control to GitHub, deployed to Vercel production, set up Neon database, and configured custom domains. Both `app.thepasspos.com` (admin fleet dashboard) and `ordercontrolcenter.com` (venue portal) are live and serving Clerk sign-in pages.

### Wave 1: GitHub + Vercel Deployment
- **GitHub**: Created private repo `GetwithitMan/gwi-mission-control`, pushed 3 commits
- **Vercel**: Linked project `prj_koiBu5uQFTYZVl4ufrPteGzQGj7w` under `team_mkG1PbPLq8cgRvXzX6jkyUxS`
- **Neon**: Created `mission_control` database on existing `ep-withered-forest-ahcqgqj7` project, pushed Prisma schema
- **Environment Variables**: Set 8 vars across all environments (DATABASE_URL, DIRECT_URL, CLERK keys x2, CLERK URLs x2, HMAC_SECRET, ENCRYPTION_KEY)

### Deploy Fixes
- `.gitignore` — Changed `/node_modules` to `node_modules/` (catches sync-agent/node_modules)
- `tsconfig.json` — Added `"sync-agent"` to exclude (Next.js was scanning sync-agent TypeScript files)
- Both committed and pushed; auto-deploy succeeded on second attempt

### Wave 1C: Custom Domains
All three domains added to Vercel project and verified serving 200 OK:
- `app.thepasspos.com` — CNAME via Vercel DNS (thepasspos.com is Vercel-registered)
- `ordercontrolcenter.com` — Vercel DNS (purchased today, $11.25/yr)
- `www.ordercontrolcenter.com` — Wildcard ALIAS already covers it

### Verified Live URLs
| URL | Status | Response |
|-----|--------|----------|
| `https://app.thepasspos.com` | 200 OK | Clerk sign-in page ("GWI Mission Control") |
| `https://ordercontrolcenter.com` | 200 OK | Clerk sign-in page ("GWI Mission Control") |
| `https://gwi-mission-control.vercel.app` | 200 OK | Clerk sign-in page ("GWI Mission Control") |

### Pending: Wave 1D-1E + Wave 5
- Configure Clerk allowed origins for both custom domains
- End-to-end NUC test with provision.sh

### Risk: SSE on Vercel
Vercel Hobby = 10s function timeout (SSE connections cut). Sync agent reconnects automatically but commands may be delayed. Mitigations: upgrade to Pro (60s), add polling fallback, or move SSE to separate long-running service.

---

## Session: February 12, 2026 (Production Deploy Prep + Venue Portal)

### Summary
Completed Waves 0-4 of the production deployment plan: pre-deploy fixes, domain-based routing, venue-facing portal UI, and operational runbooks. Single Next.js app serves two domains — `app.thepasspos.com` (admin fleet dashboard) and `ordercontrolcenter.com` (venue portal). Zero TypeScript errors.

### Wave 0: Pre-Deploy Fixes
- `package.json` — Added `prisma generate` to build script + `postinstall` hook for Vercel
- `scripts/provision.sh` — Updated default URL from `mission-control.gwipos.com` to `app.thepasspos.com`
- `.env.example` — Added `PORTAL_MODE` env var for localhost/preview domain selection

### Wave 2: Domain-Based Routing
- **NEW** `src/lib/domain.ts` — `getPortalFromHost(host)` returns `'admin'` or `'venue'` based on hostname
  - `ordercontrolcenter.com` → venue
  - `*.thepasspos.com` → admin
  - Localhost/preview → `PORTAL_MODE` env var (default: admin)
- **MODIFIED** `src/middleware.ts` — Domain detection after `auth.protect()`:
  - Venue domain + `/dashboard*` → redirect to `/portal`
  - Admin domain + `/portal*` → redirect to `/dashboard`
- **MODIFIED** `src/app/page.tsx` — Root redirect reads Host header for domain-aware redirect

### Wave 3: Venue Portal UI (7 new files)
Light theme (`bg-gray-50`) distinct from dark admin dashboard. All server components reuse existing Prisma patterns.

| File | Description |
|------|-------------|
| `src/app/portal/layout.tsx` | Light header with "Control Center" branding + `<UserButton />` |
| `src/app/portal/page.tsx` | Locations grid — scoped by Clerk org, shows status dots, version, last seen |
| `src/app/portal/servers/page.tsx` | Read-only server table — no kill/revive buttons |
| `src/app/portal/billing/page.tsx` | Plan tier, monthly cost, billing history — requires `org_admin` |
| `src/components/portal/PortalNav.tsx` | Tab navigation: Locations / Servers / Billing |
| `src/components/portal/LocationCard.tsx` | Light-themed card with status, address, version, heartbeat |
| `src/components/portal/PortalServerList.tsx` | Simplified ServerList — location, hostname, status, CPU, memory |

**Data reuse**: All portal pages use `getAuthenticatedAdmin()`, `computeFleetStatus()`, `calculateMonthlyBill()`, `parseBillingConfig()` — zero new data logic.

### Wave 4: Operational Runbooks
- **NEW** `docs/runbooks/provisioning.md` — 8-step guide: Create org → Create location → Generate token → Run provision.sh → Start Docker → Verify → Set up Clerk users → Verify portal
- **NEW** `docs/runbooks/suspension.md` — Escalation timeline (Day 0 past_due → Day 14 suspended → Day 30 cancelled), emergency kill, revival procedure, audit trail queries

---

## Session: February 12, 2026 (Sync Agent Sidecar — T-062)

### Summary
Built the complete Sync Agent sidecar — a standalone Node.js Docker service that runs alongside the POS container. 3 parallel agents created 15 files total (11 TypeScript source + Dockerfile + package.json + tsconfig.json + .env.example). All reviewed and accepted. Zero TypeScript errors. TODOs in index.ts wired to integrate SSE consumer + license validator.

### Sync Agent Architecture
```
┌─────────────────────────────────────────────┐
│  Docker Bridge Network                       │
│  ┌──────────────┐    ┌──────────────────┐   │
│  │  Sync Agent   │    │  GWI POS         │   │
│  │  :8081        │←───│  :3000           │   │
│  │  (heartbeat,  │    │  (reads /status) │   │
│  │   SSE, license│    └──────────────────┘   │
│  │   commands)   │                           │
│  └──────┬───────┘                           │
│         │                                    │
└─────────┼────────────────────────────────────┘
          │ HMAC-signed HTTPS
          ▼
    Mission Control Cloud
```

### Tasks
| Task | Agent | Status | Files Created |
|------|-------|--------|---------------|
| SA-CORE: Scaffold + HMAC + Heartbeat + Status API | sa-core | ACCEPTED | 10 files |
| SA-SSE: SSE Consumer + Command Worker + Handlers | sa-sse | ACCEPTED | 3 files |
| SA-LICENSE: License Validator + Signed Cache | sa-license | ACCEPTED | 2 files |

### Files Created (15 total)

**Core (sa-core):**
- `sync-agent/package.json` — ESM (`"type": "module"`), express + eventsource deps
- `sync-agent/tsconfig.json` — ES2022 target, Node16 module resolution
- `sync-agent/Dockerfile` — Multi-stage build, `/data` volume, `node` user, EXPOSE 8081
- `sync-agent/.env.example` — All config vars documented
- `sync-agent/src/config.ts` — `SyncAgentConfig` interface, `loadConfig()` with env validation
- `sync-agent/src/hmac-client.ts` — HMAC-SHA256 signed HTTP client (post/get/getSSEHeaders)
- `sync-agent/src/state.ts` — Mutable `AgentState` with atomic persistence (temp+rename)
- `sync-agent/src/heartbeat.ts` — CPU/memory/disk metrics, payment config hash, 60s interval
- `sync-agent/src/status-api.ts` — Express on 0.0.0.0:8081, GET /status + GET /health
- `sync-agent/src/index.ts` — Entry point: config → state → API → license → SSE → heartbeat → graceful shutdown

**SSE (sa-sse):**
- `sync-agent/src/sse-consumer.ts` — Persistent SSE connection with exponential backoff (1s→60s, 2x, ±30% jitter)
- `sync-agent/src/command-worker.ts` — FIFO queue, serial execution, KILL_SWITCH priority, deduplication, expiry check
- `sync-agent/src/command-handlers.ts` — 5 handlers: FORCE_SYNC, KILL_SWITCH, UPDATE_CONFIG (revive + limits), UPDATE_PAYMENT_CONFIG (RSA-OAEP decrypt), FORCE_UPDATE

**License (sa-license):**
- `sync-agent/src/license-validator.ts` — Cloud-first with cache fallback, fail-closed on fresh boot, fail-open on transient failure, grace period logic
- `sync-agent/src/license-cache.ts` — Atomic file cache, HMAC-SHA256 signature verification, timing-safe comparison

### Key Design Decisions
1. **Shared mutable state**: All modules read/write the same `AgentState` object, persisted to disk every 30s + after each command
2. **HMAC auth matching cloud**: Same signing algorithm as fleet API `verifySignature()`
3. **Type→commandType normalization**: Cloud SSE sends `type`, agent normalizes to `commandType` at ingestion
4. **RSA-OAEP+SHA256**: Payment config decryption uses private key at `/data/server.key`
5. **License fail-closed**: No cache + no cloud on boot = suspended (security-first)
6. **License fail-open**: Transient cloud failure during runtime keeps last known good state (availability)
7. **Graceful shutdown**: SIGTERM/SIGINT stops SSE → commands → license → heartbeat → saves state → exits

### Build Verification
```
✓ TypeScript clean (zero errors, 11 source files)
✓ All imports use .js extensions (ESM requirement)
✓ All TODO placeholders wired in index.ts
```

---

## Session: February 12, 2026 (Phase 2D: Wave 4C — Billing & Late Payment)

### Summary
Completed Wave 4C: Billing & Late Payment Flow (T-067). No Stripe — billing via Datacap settlement deduction (primary) or card-on-file via GWI's own Datacap MID (fallback). Manual admin escalation controls. 1 agent, all accepted. Total project now has 22 compiled routes, zero TypeScript errors.

### Key Decision: No Stripe
Owner confirmed GWI will use its own Datacap integration for subscription billing:
- **Primary**: Settlement deduction — GWI takes subscription fee off the top from venue's Datacap settlement
- **Fallback**: Card-on-file charge via GWI's own Datacap MID + gateway (for low-volume venues)
- **Late payment**: Manually triggered by super_admin from dashboard (no automatic escalation)

### Wave 4C Tasks
| Task | Agent | Status | Files Created |
|------|-------|--------|---------------|
| MC-BILLING-T15: Billing & Late Payment | billing | ACCEPTED | 5 files (1 lib + 4 routes) |

### Files Created (5 total)

- `src/lib/billing.ts` — SUBSCRIPTION_PRICES (STARTER $99/PRO $199/ENTERPRISE $399), BillingMethod type, BillingRecord/BillingConfig interfaces, calculateMonthlyBill (Enterprise flat vs per-location), formatBillingPeriod, parseBillingConfig (safe JSON parse), ESCALATION_ACTIONS display map
- `src/app/api/admin/billing/dashboard/route.ts` — GET revenue overview (super_admin): totalMrr, by-tier breakdown, pastDueOrgs, recentCharges (last 20 across all orgs)
- `src/app/api/admin/organizations/[id]/billing/route.ts` — GET billing history (last 12 months, outstanding balance, card-on-file boolean). POST 4 actions via Zod discriminated union: record_charge, record_waiver, update_method, set_card_token (token NOT logged in audit)
- `src/app/api/admin/organizations/[id]/billing/suspend/route.ts` — POST manual escalation: set_past_due, suspend (FORCE_SYNC), cancel (killServer per server), reactivate (FORCE_SYNC). All update org + location status.
- `src/app/api/admin/billing/revenue/route.ts` — GET monthly revenue aggregation (?months=6, max 24): subscription revenue, by-tier, charge/waiver counts

### Architecture Decisions (Wave 4C)
1. **No Stripe**: GWI uses own Datacap MID for billing. Settlement deduction (primary) + card-on-file (fallback).
2. **Manual escalation only**: No automatic retry ladder. Super admin manually triggers PAST_DUE → SUSPENDED → CANCELLED.
3. **Billing history in JSON**: Stored in `CloudLocation.billingConfig.history` JSON array (first location per org). Avoids schema migration for dedicated billing table.
4. **Cancel = kill**: Cancellation calls `killServer()` from `@/lib/kill-switch` for each non-killed server, creating KILL_SWITCH commands.
5. **Card token security**: `set_card_token` action updates `stripeCustomerId` field (repurposed). Token value intentionally NOT logged in audit trail.

### Build Verification
```
✓ Compiled successfully — 22 routes total
✓ TypeScript clean (zero errors)
```

### Cumulative Route Count (after Waves 1-4C)
| Category | Count | Routes |
|----------|-------|--------|
| Fleet API (HMAC auth) | 5 | register, heartbeat, license/validate, commands/stream, commands/[id]/ack |
| Admin API (Clerk auth) | 17 | organizations (2), organizations/[id] (1), organizations/[id]/subscription (1), organizations/[id]/billing (1), organizations/[id]/billing/suspend (1), locations (1), locations/[id] (1), locations/[id]/provision (1), locations/[id]/payment-config (1), locations/[id]/hardware-limits (1), locations/[id]/kill (1), servers/[id]/kill (1), servers/[id]/kill/status (1), servers/[id]/revive (1), subscription/tiers (1), billing/dashboard (1), billing/revenue (1) |
| Pages | 4 | /, /dashboard, /sign-in, /sign-up |

### Pending Work
| Priority | Task | Notes |
|----------|------|-------|
| P2 | T-062: Sync Agent Sidecar | Deferred to own session — needs all cloud endpoints stable |

---

## Session: February 12, 2026 (Phase 2B: Wave 4B — Subscription Tiers + Kill Switch)

### Summary
Completed Wave 4B with 2 parallel agents: Subscription Tiers & Hardware Limits enforcement (T-066) and Kill Switch remote disable/revive (T-063). Both accepted. Total project now has 18 compiled routes, zero TypeScript errors.

### Wave 4B Tasks
| Task | Agent | Status | Files Created |
|------|-------|--------|---------------|
| MC-TIERS-T13: Subscription Tiers & Hardware Limits | subscription-tiers | ACCEPTED | 4 files (1 lib + 3 routes) |
| MC-KILL-T14: Kill Switch | kill-switch | ACCEPTED | 5 files (1 lib + 4 routes) |

### Files Created (9 total)

**Subscription Tiers & Hardware Limits:**
- `src/lib/hardware-limits.ts` — Single source of truth: DEFAULT_LIMITS, DEFAULT_FEATURES, TIER_PRICES for STARTER/PRO/ENTERPRISE. resolveHardwareLimits (per-field fallback), checkDeviceLimit, getTierInfo, getAllTiers.
- `src/app/api/admin/organizations/[id]/subscription/route.ts` — GET (tier + features + per-location effective limits + billing). PUT (super_admin: tier/status/maxLocations changes, resets overrides on tier change, creates FORCE_SYNC commands for all active servers).
- `src/app/api/admin/locations/[id]/hardware-limits/route.ts` — GET (tier defaults + overrides + effective limits). PUT (per-location overrides, org_admin capped at tier max, partial merge, clean-slate detection stores DbNull).
- `src/app/api/admin/subscription/tiers/route.ts` — GET all tiers for comparison UI (any authenticated admin).

**Kill Switch:**
- `src/lib/kill-switch.ts` — Shared kill/revive logic. killServer (isKilled=true, KILL_SWITCH command, audit). reviveServer (clear kill state, UPDATE_CONFIG with action:'revive', expire pending KILL_SWITCH commands, audit). findActiveServerWithOrg helper.
- `src/app/api/admin/servers/[id]/kill/route.ts` — POST single kill (super_admin, rejects already-killed 409).
- `src/app/api/admin/servers/[id]/kill/status/route.ts` — GET kill status + last 10 kill/revive commands (org_admin with access check).
- `src/app/api/admin/servers/[id]/revive/route.ts` — POST revive (super_admin, rejects if not killed 409).
- `src/app/api/admin/locations/[id]/kill/route.ts` — POST bulk kill all non-DECOMMISSIONED servers at location (super_admin).

### Architecture Decisions (Wave 4B)
1. **Tier enforcement at two levels**: Cloud API caps org_admin at tier maximums. Local server caches tier for offline enforcement.
2. **Override clean-slate**: When all per-location overrides match tier defaults, store `Prisma.DbNull` (not the explicit values). Simplifies tier change reset.
3. **FORCE_SYNC on tier change**: All location overrides reset + FORCE_SYNC commands issued to every active server. Ensures local servers reflect new tier immediately.
4. **REVIVE via UPDATE_CONFIG**: `CommandType` enum lacks REVIVE — used `UPDATE_CONFIG` with `payload.action = 'revive'` as clean workaround. Status endpoint filters for this.
5. **Kill cascade**: Bulk location kill iterates servers individually (each gets its own command + audit log), plus one bulk audit entry.

### Build Verification
```
✓ Compiled successfully — 18 routes total
✓ TypeScript clean (zero errors)
```

### Cumulative Route Count (after Waves 1-4B)
| Category | Routes |
|----------|--------|
| Fleet API (HMAC auth) | `/api/fleet/register`, `/api/fleet/heartbeat`, `/api/fleet/license/validate`, `/api/fleet/commands/stream`, `/api/fleet/commands/[id]/ack` |
| Admin API (Clerk auth) | `/api/admin/organizations`, `/api/admin/organizations/[id]`, `/api/admin/organizations/[id]/subscription`, `/api/admin/locations`, `/api/admin/locations/[id]`, `/api/admin/locations/[id]/provision`, `/api/admin/locations/[id]/payment-config`, `/api/admin/locations/[id]/hardware-limits`, `/api/admin/locations/[id]/kill`, `/api/admin/servers/[id]/kill`, `/api/admin/servers/[id]/kill/status`, `/api/admin/servers/[id]/revive`, `/api/admin/subscription/tiers` |
| Pages | `/`, `/dashboard`, `/sign-in`, `/sign-up` |

### Pending Work (Next Wave)
| Priority | Task | Notes |
|----------|------|-------|
| P2 | T-067: Billing & Late Payment | Stripe retry, escalation (depends on T-066 ✅) |
| P2 | T-062: Sync Agent Sidecar | Deferred to own session — needs all cloud endpoints stable |

---

## Session: February 12, 2026 (Phase 2A+2B: Wave 4A — Tenant Isolation + PayFac + Provisioning)

### Summary
Continued building Mission Control with Wave 4A: per-org Postgres tenant isolation with RLS defense-in-depth, PayFac credential management (encrypted cloud-push via SSE commands), and Ubuntu server provisioning script. Three agents completed all 3 tasks in parallel. Total project now has 16 compiled routes.

### Wave 4A Tasks
| Task | Agent | Status | Files Created/Modified |
|------|-------|--------|----------------------|
| MC-TENANT-T10: Tenant Isolation | tenant-isolation | ACCEPTED | 3 created, 1 modified |
| MC-PAYFAC-T11: PayFac Credentials | payfac-creds | ACCEPTED | 2 created, 1 modified |
| MC-PROVISION-T12: Provisioning Script | provisioning | ACCEPTED | 2 created |

### Files Created/Modified (7 new, 2 modified)

**Tenant Isolation:**
- `src/lib/tenant-schema.ts` — createTenantSchema (IF NOT EXISTS), archiveTenantSchema (rename not drop), listTenantSchemas, sanitizeSlug ([a-z0-9_] only)
- `src/lib/tenant-rls.ts` — applyRLSPolicies (FORCE RLS on CloudLocation/AdminUser/FleetAuditLog), setTenantContext (SET LOCAL session vars), super_admin bypass
- `src/lib/tenant-middleware.ts` — withTenantContext (db.$transaction wrapper with SET LOCAL), orgId validation, passes tx to callback
- `src/app/api/admin/organizations/route.ts` — Modified: hooks createTenantSchema(slug) fire-and-forget on POST

**PayFac Credential Management:**
- `src/app/api/admin/locations/[id]/payment-config/route.ts` — GET (decrypt+return config), PUT (encrypt+store+create per-server RSA FleetCommands), Clerk auth, org access check, audit log
- `src/lib/credential-verification.ts` — verifyCredentials (SHA-256 hash comparison, deduplicates pending commands, creates UPDATE_PAYMENT_CONFIG on mismatch)
- `src/app/api/fleet/heartbeat/route.ts` — Modified: added paymentConfigHash optional field, non-blocking credential verification, credentialStatus in response

**Provisioning Script:**
- `scripts/provision.sh` — Full provisioning: pre-flight checks, 5-component hardware fingerprint, 4096-bit RSA keypair (idempotent), register API call, OAEP+SHA256 decrypt, .env write, re-provision safety
- `src/lib/fingerprint.ts` — computeFingerprintHash (matches bash algorithm), isValidFingerprint, FINGERPRINT_VERSION constant

### Architecture Decisions (Wave 4A)
1. **Two-layer tenant isolation**: Structural (per-org Postgres schema `tenant_{slug}`) + Policy (RLS with FORCE on shared tables). Fail-closed: unset context = no rows visible.
2. **PayFac command lifecycle**: PUT credential → AES encrypt at rest → per-server RSA FleetCommand (CRITICAL priority, 7-day expiry) → SSE stream delivers → server ACKs. Heartbeat verifies hash match.
3. **Credential deduplication**: verifyCredentials checks for existing PENDING/DELIVERED commands before creating new ones, preventing command spam on repeated heartbeats.
4. **Fingerprint parity**: Bash and TypeScript use identical pipe-delimited format (`uuid|mac|cpu|ram|disk` → SHA-256). Version tracked for future algorithm changes.

### Build Verification
```
 Compiled successfully — 16 routes total
 TypeScript clean (zero errors)
Route manifest: / + /dashboard + 6 admin API + 5 fleet API + sign-in + sign-up
```

### Cumulative Route Count (after Waves 1-4A)
| Category | Routes |
|----------|--------|
| Fleet API (HMAC auth) | `/api/fleet/register`, `/api/fleet/heartbeat`, `/api/fleet/license/validate`, `/api/fleet/commands/stream`, `/api/fleet/commands/[id]/ack` |
| Admin API (Clerk auth) | `/api/admin/organizations`, `/api/admin/organizations/[id]`, `/api/admin/locations`, `/api/admin/locations/[id]`, `/api/admin/locations/[id]/provision`, `/api/admin/locations/[id]/payment-config` |
| Pages | `/`, `/dashboard`, `/sign-in`, `/sign-up` |

### Pending Work (Next Wave)
| Priority | Task | Notes |
|----------|------|-------|
| P2 | T-066: Subscription Tiers & Hardware Limits | Device caps, tier enforcement |
| P2 | T-063: Kill Switch | SSE kill command + branded banner + revive |
| P2 | T-067: Billing & Late Payment | Stripe retry, escalation (depends on T-066) |
| P2 | T-062: Sync Agent Sidecar | Deferred to own session — needs all cloud endpoints stable |

---

## Session: February 12, 2026 (Phase 2A+2B: Wave 3 — SSE Commands + Admin API + Dashboard)

### Summary
Continued building Mission Control with Wave 3: SSE command stream for cloud→server communication, full Admin CRUD API for organizations and locations, and a fleet monitoring dashboard with real-time status cards. Three agents completed all 3 tasks in parallel. Total project now has 15 compiled routes.

### Wave 3 Tasks
| Task | Agent | Status | Files Created |
|------|-------|--------|---------------|
| MC-API-T07: SSE Commands | sse-commands | ✅ ACCEPTED | 2 route files |
| MC-API-T08: Admin API | admin-api | ✅ ACCEPTED | 5 route files |
| MC-DASH-T09: Fleet Dashboard | dashboard-builder | ✅ ACCEPTED | 6 files (page + layout + 3 components + utility) |

### Files Created (13 total)

**SSE Command Stream:**
- `src/app/api/fleet/commands/stream/route.ts` — GET SSE endpoint (HMAC auth, priority ordering, Last-Event-ID replay, 30s keepalive, 5-min auto-close, batch-expire stale commands)
- `src/app/api/fleet/commands/[id]/ack/route.ts` — POST command ACK (Zod validation, status-specific timestamps, location ownership check)

**Admin API:**
- `src/app/api/admin/organizations/route.ts` — GET (list with _count) + POST (create with slug uniqueness + audit log)
- `src/app/api/admin/organizations/[id]/route.ts` — GET (detail with locations + servers) + PUT (update + maxLocations super_admin only)
- `src/app/api/admin/locations/route.ts` — GET (list with status summary) + POST (create with maxLocations check)
- `src/app/api/admin/locations/[id]/route.ts` — GET (detail with servers + tokens + commands) + PUT (update)
- `src/app/api/admin/locations/[id]/provision/route.ts` — POST (generate 24h registration token, revoke existing)

**Fleet Dashboard:**
- `src/lib/fleet-status.ts` — computeFleetStatus(), formatRelativeTime(), STATUS_COLORS, LICENSE_COLORS
- `src/app/dashboard/layout.tsx` — Dark theme layout with Clerk UserButton
- `src/app/dashboard/page.tsx` — Server Component with Prisma data fetching, org selector, status cards grid, server list
- `src/components/fleet/OrgSelector.tsx` — Client component, org switching via ?org= param
- `src/components/fleet/StatusCard.tsx` — Client component with auto-refresh (30s), status badge (pulse for online), license badge, CPU/mem metrics
- `src/components/fleet/ServerList.tsx` — Server component table sorted offline-first with all metrics

### Build Verification
```
✓ Compiled successfully — 15 routes total
✓ TypeScript clean (zero errors)
Route manifest: / + /dashboard + 5 admin API + 5 fleet API + sign-in + sign-up
```

### Cumulative Route Count (after Waves 1-3)
| Category | Routes |
|----------|--------|
| Fleet API (HMAC auth) | `/api/fleet/register`, `/api/fleet/heartbeat`, `/api/fleet/license/validate`, `/api/fleet/commands/stream`, `/api/fleet/commands/[id]/ack` |
| Admin API (Clerk auth) | `/api/admin/organizations`, `/api/admin/organizations/[id]`, `/api/admin/locations`, `/api/admin/locations/[id]`, `/api/admin/locations/[id]/provision` |
| Pages | `/`, `/dashboard`, `/sign-in`, `/sign-up` |

---

## Session: February 11, 2026 (Planning & Preparation)

### Summary
Architecture plan for Mission Control Center (Module A: Tenant & Fleet Management) was designed, refined through multiple review rounds, and approved. All preparation files created for implementation kickoff.

### What Was Done
- Designed complete Module A architecture plan (12 sections + 3 appendices)
- Incorporated hardware plan requirements (Postgres Schema isolation, Clerk B2B auth, wildcard subdomains, hardware kit, deliverables checklist)
- Created Domain 25: Mission Control in domain registry
- Created domain documentation (`/docs/domains/MISSION-CONTROL-DOMAIN.md`)
- Saved permanent plan copy (`/docs/plans/MISSION-CONTROL-MODULE-A.md`)
- Added 21 skill placeholders (Skills 300-320) to Skills Index
- Added implementation tasks to PM Task Board
- Updated CLAUDE.md with Domain 25 registration

### Architecture Decisions Made
1. **Sync Agent Sidecar**: Separate Docker container is the ONLY cloud communication channel. POS app never calls Mothership directly.
2. **Zero Inbound Ports**: All communication is outbound-initiated by local servers. Servers never expose ports to the internet.
3. **RSA Key Exchange**: 4096-bit keypair generated locally during provisioning. Private key never leaves server.
4. **HMAC Request Signing**: Every server→cloud request includes HMAC-SHA256 signature (mirrors Twilio webhook pattern).
5. **SSE over WebSocket**: Server-Sent Events chosen for cloud→server commands (firewall-friendly, auto-reconnect, simpler).
6. **Postgres Schemas + RLS**: Two-layer tenant isolation — structural (schema per org) + policy (RLS as defense-in-depth).
7. **Clerk B2B**: Admin authentication via Clerk Organizations (MFA, org-scoped sessions, RBAC).
8. **Hardware Fingerprint**: SHA-256 of SMBIOS UUID + MAC + CPU + RAM + disk serial, versioned for future formula updates.
9. **License Grace Period**: 14-day default, HMAC-signed local cache, in-memory caching with 60s timer.
10. **Cosign Image Signing**: Keyless OIDC-based Docker image signing for secure update pipeline.
11. **PayFac Model**: GWI owns master Datacap account. Venues are sub-merchants — cannot bring their own processor or bypass GWI processing.
12. **Cloud-Pushed Credentials**: Datacap merchantId/operatorId/secureDeviceIds encrypted AES-256-GCM at rest, delivered via RSA-encrypted SSE command. POS has NO settings UI for credentials.
13. **Tamper Prevention**: Sync Agent overwrites any local DB credential tampering on 60s heartbeat. Unregistered readers rejected.
14. **Subscription Tiers**: Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with hardware device limits and feature gating.
15. **Processing Fee Deduction**: GWI processing markup deducted from Datacap settlement (off the top), not billed separately to merchant.
16. **Late Payment Escalation**: Stripe retry (Day 1-5) → email (Day 5) → warning banner (Day 14) → read-only (Day 30) → kill switch (Day 45).

### Key Documents Created
- `/docs/plans/MISSION-CONTROL-MODULE-A.md` — Complete architecture plan
- `/docs/domains/MISSION-CONTROL-DOMAIN.md` — Domain documentation
- `/docs/changelogs/MISSION-CONTROL-CHANGELOG.md` — This changelog

---

## Session: February 11, 2026 (PayFac & Revenue Model)

### Summary
Extended the Module A architecture plan with three new sections covering payment processing control (PayFac model), subscription tier enforcement with hardware limits, and revenue/fee structure with late payment escalation. Answered owner questions about Docker, PWA, offline capability, and Datacap credential management.

### What Was Done
- Added **Section 13: Payment Processing Control (PayFac Model)** — GWI owns master Datacap account, venues are sub-merchants, cloud-pushed encrypted credentials, tamper prevention, per-reader management
- Added **Section 14: Hardware Limits & Subscription Tiers** — Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with device caps, feature gating, two-level enforcement (cloud + local cache)
- Added **Section 15: Revenue & Fee Structure** — Three revenue streams (subscription, processing markup, revenue share), settlement deduction, late payment escalation (Day 1→45)
- Added Threat Model entries T11-T14 (processing bypass attempts)
- Added Deliverables Checklist items 15-17
- Updated Appendix A (Sync Agent status API) with `paymentConfig` and `subscriptionLimits` fields
- Updated Appendix C (Operational Defaults) with 3 new tables (Payment Processing, Subscription & Hardware Limits, Billing & Late Payment)
- Updated Domain doc with PayFac and Billing layers + expanded responsibilities
- Added 3 new skills (321-323) to Skills Index
- Added 3 new tasks (T-065 to T-067) to PM Task Board

### Architecture Decisions Made (continued from Session 1)
11. **PayFac Model**: GWI owns master Datacap account. Venues are sub-merchants — cannot bring their own processor or bypass GWI processing.
12. **Cloud-Pushed Credentials**: Datacap merchantId/operatorId/secureDeviceIds encrypted AES-256-GCM at rest, delivered via RSA-encrypted SSE command. POS has NO settings UI for credentials.
13. **Tamper Prevention**: Sync Agent overwrites any local DB credential tampering on 60s heartbeat. Unregistered readers rejected.
14. **Subscription Tiers**: Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with hardware device limits and feature gating.
15. **Processing Fee Deduction**: GWI processing markup deducted from Datacap settlement (off the top), not billed separately to merchant.
16. **Late Payment Escalation**: Stripe retry (Day 1-5) → email (Day 5) → warning banner (Day 14) → read-only (Day 30) → kill switch (Day 45).

### Owner Q&A Documented
- **Docker**: Pre-installed on Ubuntu NUC. GWI builds Docker images via GitHub Actions, signed with Cosign. Updates pushed from Mission Control dashboard — operators never touch servers.
- **PWA**: Terminals are browsers pointing at the NUC's local IP. Works as installable Progressive Web App on any device.
- **Offline**: NUC hosts everything locally (app + PostgreSQL + Socket.io). 100% functional with no internet. Sync Agent queues data for when internet returns.
- **Datacap credentials**: Admin enters MID + operatorId + secureDeviceIds in Mission Control per location. Credentials auto-push to NUC via encrypted SSE. Venue has zero access to modify.

### How to Resume
1. Say: `PM Mode: Mission Control`
2. Review `/docs/plans/MISSION-CONTROL-MODULE-A.md` for full architecture (now 15 sections + 3 appendices)
3. Review PM Task Board for Phase 2A tasks (T-054 to T-067)
4. Start with Skill 300: Cloud Project Bootstrap (create separate Next.js project)

### Next Session Priority
**Phase 2A: Foundation (Weeks 1-3)**
1. Create separate cloud Next.js project with Neon PostgreSQL
2. Cloud Prisma schema (all cloud models including PaymentConfig, SubscriptionLimits, BillingConfig)
3. `POST /api/fleet/register` — server registration endpoint
4. `POST /api/fleet/heartbeat` — heartbeat ingestion
5. `POST /api/fleet/license/validate` — license validation
6. Provisioning script for Ubuntu servers
7. Basic fleet dashboard (status cards, online/offline)

---

## Session: February 12, 2026 (Phase 2A: Foundation Build)

### Summary
Built the entire Mission Control cloud project foundation in a single session using PM Agent Team mode. Three code writer agents (cloud-bootstrap, schema-writer, auth-writer) executed 6 tasks in 2 waves with proper dependency ordering. All tasks accepted, build passes cleanly.

### Team Structure
- **Lead PM**: Non-coding orchestrator (planned tasks, wrote prompts, reviewed output)
- **cloud-bootstrap**: Wave 1: project bootstrap → Wave 2: registration API
- **schema-writer**: Wave 1: Prisma schema → Wave 2: heartbeat API
- **auth-writer**: Wave 1: auth/HMAC/crypto → Wave 2: license validation API

### Wave 1 (Foundation — No Dependencies)
| Task | Agent | Status | Key Output |
|------|-------|--------|------------|
| MC-INFRA-T01: Bootstrap | cloud-bootstrap | ✅ ACCEPTED | Next.js 16.1.6, Prisma 7.4, Clerk 6.37, Zod 4.3 |
| MC-SCHEMA-T02: Schema | schema-writer | ✅ ACCEPTED | 11 enums, 10 models, 15 indexes |
| MC-AUTH-T03: Auth/Crypto | auth-writer | ✅ ACCEPTED | 4 files: hmac.ts, crypto.ts, auth.ts, middleware.ts |

### Wave 2 (APIs — Depends on Wave 1)
| Task | Agent | Status | Key Output |
|------|-------|--------|------------|
| MC-API-T04: Registration | cloud-bootstrap | ✅ ACCEPTED | POST /api/fleet/register — token validation, fingerprint check, RSA encrypt |
| MC-API-T05: Heartbeat | schema-writer | ✅ ACCEPTED | POST /api/fleet/heartbeat — HMAC auth, metrics, pending commands |
| MC-API-T06: License | auth-writer | ✅ ACCEPTED | POST /api/fleet/license/validate — status priority chain, tier features, signed response |

### Technical Decisions
1. **Prisma 7.4** (not 6.x like POS): adapter-based client, `prisma-client` provider, `prisma.config.ts` for connection, import from `@/generated/prisma/client`
2. **request.clone() pattern**: `validateFleetRequest()` consumes the body via `request.text()`. All handlers that also need the body must clone first.
3. **Registration is the only unauthenticated fleet endpoint**: Server has no API key yet, authenticates via one-time registration token instead.
4. **License status priority chain**: kill switch → location deactivated → org subscription → location license → expiry/grace → PAST_DUE → ACTIVE
5. **Tier features as flat string arrays**: STARTER/PRO/ENTERPRISE with cumulative feature flags

### Files Created
```
gwi-mission-control/
├── package.json                          # Next.js 16 + Prisma 7 + Clerk
├── prisma/
│   └── schema.prisma                     # 11 enums, 10 models, 15 indexes
├── prisma.config.ts                      # Prisma 7 connection config
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root with ClerkProvider
│   │   ├── page.tsx                      # Auth-gated redirect
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   ├── sign-up/[[...sign-up]]/page.tsx
│   │   └── api/fleet/
│   │       ├── register/route.ts         # POST — server registration
│   │       ├── heartbeat/route.ts        # POST — heartbeat ingestion
│   │       └── license/validate/route.ts # POST — license validation
│   ├── lib/
│   │   ├── db.ts                         # Prisma client (adapter pattern)
│   │   ├── auth.ts                       # Clerk RBAC helpers
│   │   ├── hmac.ts                       # HMAC signing + fleet auth
│   │   └── crypto.ts                     # AES-256-GCM, RSA, API keys
│   ├── middleware.ts                     # Fleet bypass Clerk, else protect
│   └── generated/prisma/                 # Generated Prisma client
├── .env.example
├── CLAUDE.md
└── tsconfig.json
```

### Build Verification
```
✓ Compiled successfully in 1217.3ms
✓ All 3 fleet API routes registered
✓ TypeScript clean (no errors)
✓ Lint clean
```

### Review Notes
- **T04 (Registration)**: Clean atomic transaction with RSA rollback on failure. Audit log included. No HMAC auth (correct — server has no key yet).
- **T05 (Heartbeat)**: Proper request.clone() pattern. Uses ServerStatus/CommandStatus enums directly. Transaction for heartbeat + server update. Returns pendingCommands for command polling.
- **T06 (License)**: Comprehensive determineLicenseStatus() with correct priority ordering. HMAC-signed response for tamper-proof caching. Minor: uses `(db as any)` and `NextResponse.json()` directly instead of helpers — acceptable for now.

### Pending Work (Next Session)
| Priority | Task | Notes |
|----------|------|-------|
| P2 | T-059: Fleet Dashboard (Basic) | Status cards, online/degraded/offline per location |
| P2 | T-060: Provisioning Script | Bash: collect fingerprint, generate RSA, register with cloud |
| P2 | T-061: SSE Command Stream | GET /api/fleet/commands/stream, ACK pipeline |
| P1 | T-064: Tenant Isolation | Postgres Schema per org + RLS policies |
| P1 | T-065: PayFac Credential Management | Cloud-pushed Datacap credentials |

### Known Issues
1. `(db as any)` in hmac.ts and license/validate — TODO for proper typing
2. `middleware.ts` deprecated warning (Next.js 16 wants "proxy" convention) — cosmetic, works fine
3. No database migrations run yet (schema only validated + generated)

---

## How to Resume
1. Say: `PM Mode: Mission Control`
2. Review PM Task Board for remaining Phase 2A/2B tasks
3. Next priority: T-059 (Fleet Dashboard) or T-064 (Tenant Isolation)
4. Project location: `/Users/brianlewis/Documents/My websites/gwi-mission-control/`

---

## Pending Workers
None — all agents shut down after Wave 2 completion.

## Known Issues
1. `(db as any)` casts in hmac.ts and license route — needs proper Prisma typing
2. Next.js 16 "middleware" deprecation warning — cosmetic only
