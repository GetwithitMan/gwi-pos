# GWI Deployment Guide

**Updated:** February 12, 2026
**Covers:** GWI POS + Mission Control

---

## System Overview

GWI runs as **two separate Next.js applications** connected through shared secrets and APIs.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    MISSION CONTROL (Cloud Admin)                     │
│  Vercel: gwi-mission-control                                        │
│  DB:     Neon PostgreSQL → mission_control                          │
│  Auth:   Clerk B2B Organizations                                    │
│                                                                      │
│  Domains:                                                            │
│    app.thepasspos.com           → Admin dashboard (super_admin)      │
│    ordercontrolcenter.com       → Venue portal (org_admin)           │
│    {slug}.ordercontrolcenter.com → Venue admin (Clerk + JWT bridge)  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │ PROVISION_API_KEY (shared HMAC secret)
                       │ JWT tokens for cloud admin sessions
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    GWI POS (Point of Sale)                            │
│  Vercel: gwi-pos                                                     │
│  DB:     Neon PostgreSQL → gwi_pos (master)                          │
│          Per-venue DBs   → gwi_pos_{slug} (provisioned)              │
│  Auth:   PIN login (local) + JWT validation (cloud admin)            │
│                                                                      │
│  Domains:                                                            │
│    *.ordercontrolcenter.com → Cloud admin for venues                 │
│    barpos.restaurant        → Future: public/online ordering         │
│    *.barpos.restaurant      → Future: per-venue online ordering      │
│    localhost:3000            → Local dev (Socket.io enabled)         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Vercel Projects

| Property | GWI POS | Mission Control |
|----------|---------|-----------------|
| **Project Name** | gwi-pos | gwi-mission-control |
| **Project ID** | `prj_juX1NhejgVXkB3YV9Bw2Xe68RzEV` | `prj_koiBu5uQFTYZVl4ufrPteGzQGj7w` |
| **Org/Team ID** | `team_mkG1PbPLq8cgRvXzX6jkyUxS` | `team_mkG1PbPLq8cgRvXzX6jkyUxS` |
| **Framework** | Next.js | Next.js |
| **Node Version** | 24.x | 24.x |
| **Git Repo** | GetwithitMan/gwi-pos | GetwithitMan/gwi-mission-control |
| **Branch** | main | main |
| **Build Command** | `node scripts/vercel-build.js` | `prisma generate && next build` |
| **Deploy Trigger** | Push to main | Push to main |

---

## Domains & Routing

### GWI POS Domains

| Domain | Purpose | Status |
|--------|---------|--------|
| `gwi-pos.vercel.app` | Default Vercel domain | Active |
| `*.ordercontrolcenter.com` | Per-venue cloud admin (`{slug}.ordercontrolcenter.com`) | Active |
| `barpos.restaurant` | Future: public site | Registered |
| `*.barpos.restaurant` | Future: per-venue online ordering | Registered |

### Mission Control Domains

| Domain | Purpose | Portal Mode | Auth |
|--------|---------|-------------|------|
| `app.thepasspos.com` | Fleet admin dashboard | `admin` | Clerk (super_admin) |
| `ordercontrolcenter.com` | Venue owner portal | `venue` | Clerk (org_admin) |
| `www.ordercontrolcenter.com` | Venue owner portal (www) | `venue` | Clerk (org_admin) |
| `{slug}.ordercontrolcenter.com` | Venue admin (rewrites to `/venue/{slug}/*`) | `venue_public` | Clerk + JWT bridge |

### How Domain Routing Works (Mission Control)

Mission Control uses **triple-domain routing** via `src/lib/domain.ts` + `src/middleware.ts`:

```
Request comes in
  ↓
getDomainInfo(host) detects portal type:
  ↓
  app.thepasspos.com          → portal: 'admin'       → /dashboard/*
  ordercontrolcenter.com      → portal: 'venue'       → /portal/*
  {slug}.occ.com              → portal: 'venue_public' → rewrite to /venue/{slug}/*
  localhost / preview          → PORTAL_MODE env var    → 'admin' (default)
```

### How Venue Cloud Admin Works

When a venue admin at `joes-bar.ordercontrolcenter.com` clicks "Open POS Admin":

```
1. MC middleware detects slug="joes-bar" from subdomain
2. MC authenticates via Clerk (org membership check)
3. MC navigates to /pos-access/joes-bar
4. MC generates JWT (HMAC-SHA256 signed with PROVISION_API_KEY):
   {sub, email, name, slug, orgId, role, posLocationId, exp: 8h}
5. Redirects to: https://joes-bar.ordercontrolcenter.com/api/auth/cloud-session?token=...
6. POS validates JWT, creates httpOnly session cookie (8h)
7. POS resolves Location using JWT's posLocationId (or findFirst fallback)
8. Redirects to /settings (POS cloud admin)
```

---

## Database Architecture

### Neon PostgreSQL (Shared Endpoint)

Both apps connect to the **same Neon endpoint** but use **different databases**:

| Database | App | Purpose |
|----------|-----|---------|
| `mission_control` | Mission Control | Organizations, locations, servers, fleet commands |
| `gwi_pos` | GWI POS (master) | Development/demo data, cloud admin for `gwi-admin-dev` |
| `gwi_pos_{slug}` | GWI POS (per-venue) | Each venue's isolated data (created by provisioning) |

**Neon Endpoint:** `ep-withered-forest-ahcqgqj7` (US-East-1)

**Connection Types:**
- **Pooler** (`-pooler` suffix in host): For app queries. Serverless-friendly, connection pooling.
- **Direct** (no `-pooler`): For schema migrations only (`prisma db push`, `prisma migrate`).

### POS Database Routing

```
src/lib/db.ts provides:

  db                    → Master PrismaClient (gwi_pos database)
  getDbForVenue(slug)   → Per-venue PrismaClient (gwi_pos_{slug})
  venueDbName(slug)     → Converts "joes-bar" → "gwi_pos_joes_bar"
```

**Current state:** All API routes use `db` (master). Per-venue routing (`getDbForVenue`) is built but not yet wired to API routes (see T-068 in task board).

---

## Environment Variables

### GWI POS — Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Neon pooler connection | `postgresql://...@...-pooler.../gwi_pos?sslmode=require` |
| `DIRECT_URL` | Neon direct connection (migrations) | `postgresql://...@.../gwi_pos?sslmode=require` |
| `NEXTAUTH_SECRET` | Session signing secret | Random 32+ char string |
| `NEXTAUTH_URL` | App base URL | `http://localhost:3000` |
| `NEXT_PUBLIC_EVENT_PROVIDER` | Realtime mode | `socket` (dev) or omit (Vercel) |
| `PROVISION_API_KEY` | Shared secret with MC | Must match MC's `PROVISION_API_KEY` |

### GWI POS — Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP port | `3000` |
| `HOSTNAME` | Bind address | `localhost` |
| `INTERNAL_API_SECRET` | Socket broadcast auth | Dev default |
| `TWILIO_ACCOUNT_SID` | SMS for remote voids | None |
| `TWILIO_AUTH_TOKEN` | SMS auth | None |
| `TWILIO_FROM_NUMBER` | SMS sender | None |

### Mission Control — Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Neon pooler connection | `postgresql://...@...-pooler.../mission_control?sslmode=require` |
| `DIRECT_URL` | Neon direct connection | `postgresql://...@.../mission_control?sslmode=require` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key | `pk_test_...` or `pk_live_...` |
| `CLERK_SECRET_KEY` | Clerk secret key | `sk_test_...` or `sk_live_...` |
| `HMAC_SECRET` | Fleet API auth (256-bit hex) | 64-char hex string |
| `ENCRYPTION_KEY` | AES-256-GCM for payment config (256-bit hex) | 64-char hex string |
| `PROVISION_API_KEY` | Shared secret with POS | Must match POS's `PROVISION_API_KEY` |

### Mission Control — Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORTAL_MODE` | Override portal detection (localhost only) | `admin` |
| `POS_BASE_URL` | POS app URL for provisioning API calls | `https://gwi-pos.vercel.app` |
| `FLEET_API_BASE_URL` | Fleet API base | `https://api.gwipos.com` |

### Shared Secrets (Must Match Between Apps)

| Secret | Set In POS As | Set In MC As | Used For |
|--------|---------------|--------------|----------|
| HMAC signing key | `PROVISION_API_KEY` | `PROVISION_API_KEY` | JWT signing (cloud auth) + provision API auth |

---

## Build & Deploy

### GWI POS

**Vercel Build** (`scripts/vercel-build.js`):
```
1. npx prisma generate          → Generate Prisma client
2. npx prisma db push --accept-data-loss  → Push schema to Neon
3. npx next build                → Build Next.js (standalone output)
```

**Local Dev:**
```bash
npm run dev        # tsx server.ts (custom server + Socket.io)
# Reads .env.local (PostgreSQL Neon)
# Serves on http://localhost:3000
```

**Key Config (`next.config.ts`):**
```typescript
output: 'standalone'    // Self-contained build for Docker
poweredByHeader: false  // Security: hide x-powered-by
reactStrictMode: true
```

### Mission Control

**Vercel Build** (standard):
```
1. npm install          → postinstall runs prisma generate
2. prisma generate && next build
```

**Local Dev:**
```bash
npm run dev        # Standard Next.js dev server
# Reads .env.local (PostgreSQL Neon + Clerk)
# Serves on http://localhost:3000
```

---

## How Provisioning Works

When a new venue is created in Mission Control:

```
Step 1: Admin creates Organization + Location in MC dashboard
        ↓
Step 2: MC calls provisionPosDatabase(locationId, slug, name)
        → src/lib/neon-provisioning.ts
        ↓
Step 3: MC sends POST to POS /api/internal/provision
        Headers: x-api-key: {PROVISION_API_KEY}
        Body: { slug: "joes-bar", name: "Joe's Bar" }
        ↓
Step 4: POS creates Neon database "gwi_pos_joes_bar"
        → npx prisma db push (creates 139 tables)
        → Seeds: Organization, Location, 6 Roles, Employee (PIN 1234),
          7 OrderTypes, 5 Categories, 6 Tables with seats
        ↓
Step 5: POS returns { databaseName, posLocationId, slug, posUrl }
        ↓
Step 6: MC stores on CloudLocation:
        - databaseName: "gwi_pos_joes_bar"
        - posLocationId: "clxyz..." (the seeded Location.id)
        - posProvisioned: true
        ↓
Step 7: When admin opens POS cloud admin, JWT includes posLocationId
        → POS cloud-session resolves Location deterministically
        → No FK constraint errors, no locationId mismatch
```

### Provisioning API Security

- POS `/api/internal/provision` requires `x-api-key` header matching `PROVISION_API_KEY`
- POS `/api/internal/venue-health` also requires the same key
- POS middleware skips these routes from normal auth

---

## Authentication Architecture

### POS Authentication (Local)

```
PIN Login → /login → POST /api/auth/login → cookie: employee session
```
- 4-digit PIN per employee
- Session stored in httpOnly cookie
- No external auth provider

### POS Authentication (Cloud Admin)

```
Clerk (MC) → JWT → /api/auth/cloud-session → cookie: cloud session
```
- JWT signed with HMAC-SHA256 using `PROVISION_API_KEY`
- JWT contains: sub, email, name, slug, orgId, role, posLocationId
- Cloud session cookie: httpOnly, 8-hour expiry
- Cloud admin gets `permissions: ['admin']`

### Mission Control Authentication

```
Clerk B2B → Organization membership → Role-based access
```

| Role | Access Level | Can See |
|------|-------------|---------|
| `super_admin` | Everything | All orgs, all locations, fleet dashboard |
| `org_admin` | Organization-scoped | Their org's locations, billing, team |
| `location_manager` | Location-scoped | Their locations (read-only portal) |

### Mission Control API Auth

| API Category | Auth Method | Header/Cookie |
|--------------|-------------|---------------|
| `/api/admin/*` | Clerk B2B JWT | Clerk session cookie |
| `/api/fleet/*` | HMAC-SHA256 + hardware fingerprint | `Authorization: Bearer {apiKey}` + `X-Request-Signature` |
| `/api/venue/*` | Public (no auth) | None |
| `/api/internal/*` | API key | `x-api-key` header |

---

## Security

### Encryption

| What | Algorithm | Key | Where Used |
|------|-----------|-----|-----------|
| Cloud auth JWT | HMAC-SHA256 | `PROVISION_API_KEY` | MC ↔ POS token signing |
| Fleet API signing | HMAC-SHA256 | Per-server `apiKey` | Server heartbeats |
| Payment config at rest | AES-256-GCM | `ENCRYPTION_KEY` | MC CloudLocation.paymentConfig |
| Server API key delivery | RSA-2048 + OAEP | Per-server RSA keypair | Server registration |
| License response signing | HMAC-SHA256 | `HMAC_SECRET` | Tamper-proof license cache |

### Secrets Never in Git

| File | Contains | In .gitignore |
|------|----------|---------------|
| `.env.local` | Database URLs, API keys, Clerk keys | Yes |
| `.env` | Base config only (no secrets) | Yes |
| `.env.production.local` | Vercel OIDC token | Yes |

### Production Secrets Location

All production secrets are managed in **Vercel Dashboard → Project → Settings → Environment Variables**.

---

## Local Development vs Vercel

| Capability | Local Dev | Vercel |
|------------|-----------|--------|
| Socket.io (realtime) | Enabled (custom server.ts) | Not available (serverless) |
| Custom server | server.ts via tsx | Vercel's built-in Next.js |
| Database | Neon PostgreSQL (shared) | Neon PostgreSQL (shared) |
| Hot reload | Yes | N/A (deploy on push) |
| KDS realtime | Full Socket.io | Polling fallback |
| Floor plan sync | Socket.io broadcast | Polling fallback |

### Why Socket.io Doesn't Work on Vercel

Vercel runs serverless functions — each request is a new process. Socket.io requires a persistent server process to maintain WebSocket connections. This is by design: the POS app is meant to run on **local servers** at restaurants (Docker/PM2) where Socket.io works.

Vercel deployment is for:
- Cloud admin portal (settings, menu, employees — no realtime needed)
- Development/demo
- Online ordering (future — will use polling or Vercel's WebSocket support)

---

## Docker Deployment (Restaurant Servers)

For production restaurant servers, GWI POS runs in Docker on Ubuntu:

```
docker/
├── Dockerfile                   # Multi-stage build (deps → builder → runner)
├── docker-compose.yml           # SQLite deployment (simpler)
└── docker-compose.postgres.yml  # PostgreSQL deployment (recommended)
```

### Docker Compose Services

| Service | Image | Purpose |
|---------|-------|---------|
| gwi-pos | Custom (Dockerfile) | Next.js + Socket.io on custom server |
| postgres | postgres:16-alpine | Local PostgreSQL (optional) |
| watchtower | containrrr/watchtower | Auto-pulls new images |
| backup | Custom alpine cron | Scheduled database backups |

### Key Docker Config

```dockerfile
# Database persisted at mounted volume
ENV DATABASE_URL="file:/app/data/pos.db"

# Runs custom server (NOT next start)
CMD ["node", "server.js"]

# Health check
HEALTHCHECK CMD curl -f http://localhost:3000/api/health || exit 1
```

---

## Git Workflow

Both repos follow the same pattern:

```
Feature work on main branch → Push → Vercel auto-deploys

# POS
cd "/Users/brianlewis/Documents/My websites/2-8 2026-B-am GWI POINT OF SALE"
git push origin main   # Triggers Vercel build + deploy

# Mission Control
cd "/Users/brianlewis/Documents/My websites/gwi-mission-control"
git push origin main   # Triggers Vercel build + deploy
```

### Commit Convention

```
feat: description (Skill XXX)    # New feature
fix: description                 # Bug fix
docs: description                # Documentation only
```

---

## Monitoring & Health

### POS Health Check

```
GET /api/health → 200 if server is ready
```

Docker checks every 30s with 10s timeout, 3 retries.

### Mission Control Health

```
GET /api/fleet/heartbeat   # Server-to-cloud heartbeat (every 60s)
GET /api/monitoring/health  # Application health
```

### Vercel Deployment Status

```bash
# Check latest deployments
# POS:
npx vercel ls --token ... --scope team_mkG1PbPLq8cgRvXzX6jkyUxS

# Or use Vercel dashboard
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| FK constraint error on cloud admin | locationId doesn't exist in Location table | Check posLocationId handoff (Skill 329) |
| "Invalid ingredient IDs" | locationId mismatch between records | Verify cloud-session uses correct Location |
| Cloud admin 403 | Clerk org membership missing or wrong role | Check Clerk dashboard, verify org membership |
| Build fails on Vercel | Prisma schema mismatch | Check `prisma db push` output in build logs |
| Socket.io not connecting | Running on Vercel (not supported) | Expected — use local dev or Docker |
| Provisioning fails | `PROVISION_API_KEY` not set or mismatched | Check env vars in both Vercel projects |

### Checking Vercel Build Logs

```bash
# Via Vercel MCP tool or dashboard
# Project → Deployments → Click deployment → Build Logs
```

### Checking Database

```bash
# POS (local dev)
npm run db:studio   # Opens Prisma Studio at localhost:5555

# Mission Control
npx prisma studio   # Same, for MC database
```

---

## Known Technical Debt

| ID | Issue | Impact | Priority |
|----|-------|--------|----------|
| T-068 | Per-venue DB routing not wired | All API routes use master `db`, not `getDbForVenue(slug)` | Medium |
| T-069 | 13 routes with hardcoded `DEFAULT_LOCATION_ID = 'loc-1'` | Will break for provisioned venues | High |
| — | Socket.io on Vercel | Cloud admin has no realtime updates | Low (by design) |
| — | `prisma db push --accept-data-loss` in build | Could drop columns on schema change | Medium |

---

## File Reference

### GWI POS — Deployment Files

| File | Purpose |
|------|---------|
| `.vercel/project.json` | Vercel project metadata |
| `vercel.json` | Build command override |
| `scripts/vercel-build.js` | Custom build: generate + push + build |
| `next.config.ts` | `output: 'standalone'` for Docker |
| `server.ts` | Custom HTTP server with Socket.io |
| `.env.local` | Dev environment (PostgreSQL Neon) |
| `.env` | Base config (SQLite for Docker) |
| `docker/Dockerfile` | Multi-stage production build |
| `docker/docker-compose.yml` | SQLite deployment |
| `docker/docker-compose.postgres.yml` | PostgreSQL deployment |
| `src/lib/db.ts` | Master + per-venue Prisma clients |
| `src/lib/cloud-auth.ts` | JWT verification for cloud admin |
| `src/app/api/auth/cloud-session/route.ts` | Cloud session creation |
| `src/app/api/internal/provision/route.ts` | Venue database provisioning |

### Mission Control — Deployment Files

| File | Purpose |
|------|---------|
| `.vercel/project.json` | Vercel project metadata |
| `prisma/schema.prisma` | PostgreSQL schema (33 tables) |
| `.env.example` | Environment variable template |
| `src/middleware.ts` | Clerk auth + domain routing |
| `src/lib/domain.ts` | Triple-domain portal detection |
| `src/lib/auth.ts` | RBAC + Clerk integration |
| `src/lib/hmac.ts` | Fleet API HMAC authentication |
| `src/lib/crypto.ts` | AES-256-GCM + RSA encryption |
| `src/lib/neon-provisioning.ts` | Venue database provisioning caller |
| `src/lib/pos-access-token.ts` | JWT generation for POS cloud auth |
| `src/app/pos-access/[slug]/page.tsx` | JWT redirect to POS cloud admin |
| `docs/runbooks/provisioning.md` | Step-by-step venue onboarding |
| `docs/runbooks/suspension.md` | Billing escalation + kill switch |
