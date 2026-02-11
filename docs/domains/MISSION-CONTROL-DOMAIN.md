# Domain 25: Mission Control (Cloud Admin Console)

**Trigger:** `PM Mode: Mission Control`
**Changelog:** `/docs/changelogs/MISSION-CONTROL-CHANGELOG.md`
**Architecture Plan:** `/docs/plans/MISSION-CONTROL-MODULE-A.md`

---

## Domain Overview

Mission Control is the **cloud-hosted multi-tenant admin console** ("The Mothership") that manages the fleet of local GWI POS servers. It is a separate Next.js application deployed on Vercel with Neon PostgreSQL, communicating with local servers via outbound-only HTTPS connections.

**Purpose:** Fleet management, server registration, license enforcement, secure updates, data sync, and real-time monitoring across all restaurant locations.

**Key Principle:** The Sync Agent sidecar is the ONLY process that talks to the cloud. The POS app NEVER calls the Mothership directly.

---

## Architecture

```
Cloud (Vercel + Neon PostgreSQL)
├── Fleet Dashboard (real-time status cards)
├── Sync Engine (data ingest)
├── Licensing (enforce subscriptions)
├── Update Manager (controlled rollouts)
└── Admin Auth (Clerk B2B, org-scoped MFA)

Local Servers (Ubuntu + Docker)
├── Sync Agent (sidecar container)
│   ├── Heartbeat (60s → cloud)
│   ├── SSE Listener (commands from cloud)
│   ├── Data Sync (5min batches)
│   └── License Validator (boot + periodic)
└── GWI POS App (unchanged for Module A)
```

---

## Layers

| Layer | Scope | Key Files / API Routes |
|-------|-------|----------------------|
| **Fleet API** | Server-to-cloud endpoints (serverApiKey + HMAC auth) | `/api/fleet/register`, `/api/fleet/heartbeat`, `/api/fleet/health-report`, `/api/fleet/sync/*`, `/api/fleet/license/validate`, `/api/fleet/commands/stream`, `/api/fleet/commands/[id]/ack`, `/api/fleet/errors/report` |
| **Admin API** | Admin console endpoints (Clerk B2B + org-scoped JWT) | `/api/admin/organizations`, `/api/admin/locations`, `/api/admin/locations/[id]/provision`, `/api/admin/locations/[id]/commands`, `/api/admin/servers/fleet-status`, `/api/admin/servers/[id]/kill`, `/api/admin/servers/[id]/revive`, `/api/admin/updates/push`, `/api/admin/audit-log` |
| **Cloud Schema** | Neon PostgreSQL models (tenant-isolated) | `CloudOrganization`, `CloudLocation`, `ServerNode`, `ServerHeartbeat`, `ServerRegistrationToken`, `SyncSession`, `SyncBatch`, `FleetCommand`, `FleetAuditLog`, `AdminUser` |
| **Fleet Dashboard** | Real-time monitoring UI | `/app/dashboard/*`, `/components/fleet/*` |
| **Sync Agent** | Docker sidecar (Node.js) | `/sync-agent/src/*` (separate repo/directory) |
| **Provisioning** | Ubuntu host scripts | `/scripts/provision.sh`, `/scripts/collect-fingerprint.sh` |
| **License Engine** | License validation + grace period | `/lib/license/*`, `/api/fleet/license/*` |
| **Update Pipeline** | Cosign-signed image rollouts | GitHub Actions, `/api/admin/updates/*` |
| **Tenant Isolation** | Postgres Schemas + RLS | Migration scripts, DB roles, RLS policies |
| **Wildcard Routing** | Online ordering subdomains | Edge Middleware, `*.gwipos.com` DNS |
| **Payment Processing (PayFac)** | Centralized Datacap credential management, processing rate control | `/api/admin/locations/[id]/payment-config`, Sync Agent `update_payment_config` command |
| **Subscription & Billing** | Tier enforcement, hardware limits, Stripe billing, late payment flow | `/api/admin/billing/*`, `SubscriptionLimits`, `BillingConfig` models |

---

## Responsibilities

### This Domain IS Responsible For:
- Cloud Neon PostgreSQL schema (all cloud models)
- Server registration flow (one-time tokens, hardware fingerprint, RSA key exchange)
- Fleet monitoring dashboard (heartbeats, status, alerts)
- License enforcement (validation, caching, grace periods, kill switch)
- Secure communication (HMAC signing, SSE commands, ACK pipeline)
- Data sync engine (upload/download batches, conflict resolution)
- Secure update pipeline (Cosign, canary/rolling/immediate rollout)
- Admin authentication (Clerk B2B organizations, RBAC)
- Provisioning scripts for Ubuntu servers
- Wildcard subdomain routing for online ordering
- Audit logging (all admin actions)
- Alerting (email, SMS for critical conditions)
- Multi-tenant data isolation (Postgres schemas + RLS)
- **Payment processing control (PayFac model)** — GWI owns master Datacap account, venues are sub-merchants
- **Datacap credential management** — merchantId, operatorId, secureDeviceIds set in Mothership, pushed via SSE
- **Processing rate configuration** — per-location rate setting, fee deduction from settlement
- **Subscription tier enforcement** — hardware limits, feature gating, upgrade/downgrade handling
- **Billing & late payment flow** — Stripe integration, grace periods, read-only mode, kill switch

### This Domain is NOT Responsible For:
- POS application code changes (Module A requires zero POS changes)
- Local database schema (Prisma/SQLite — owned by respective domains)
- KDS, printers, card readers (owned by Hardware domain)
- Payment transaction processing logic (owned by Payments domain — Datacap XML, EMV flows)
- Menu/inventory management (owned by respective domains)
- Floor plan or table management (owned by Floor Plan domain)

---

## Integration Points

| Integration | Direction | Description |
|-------------|-----------|-------------|
| **Sync Agent ↔ POS** | Local only (Docker bridge) | Sync Agent reads POS DB for sync. POS reads `GET http://sync-agent:8081/status` for license/kill state. |
| **Sync Agent ↔ Cloud** | Outbound HTTPS | All fleet API calls, SSE command stream. Server never accepts inbound internet connections. |
| **Cloud ↔ Clerk B2B** | External service | Admin authentication, org-scoped sessions, MFA |
| **Cloud ↔ Stripe** | External service | Subscription billing, license tier enforcement |
| **Cloud ↔ S3** | External service | Database backup storage |
| **Cloud ↔ GitHub** | CI/CD | Cosign-signed Docker image builds, SBOM generation |
| **Go-Live Domain** | Cross-domain | Provisioning is the final step of go-live for new locations |
| **Offline & Sync Domain** | Cross-domain | Sync Agent implements the offline sync algorithm designed in Domain 20 |

---

## Implementation Phases

| Phase | Name | Timeline | Key Deliverables |
|-------|------|----------|-----------------|
| **2A** | Foundation | Weeks 1-3 | Cloud project, Prisma schema, registration, heartbeat, license validation, basic dashboard |
| **2B** | Communication | Weeks 4-6 | SSE commands, Sync Agent sidecar, kill switch, license cache, alerting |
| **2C** | Data Sync | Weeks 7-10 | Upload/download batches, syncedAt watermark, conflict resolution, sync health |
| **2D** | Updates & Licensing | Weeks 11-13 | Cosign pipeline, rollout strategies, rollback, Stripe billing |

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Stolen/cloned disk | Hardware fingerprint bound to physical hardware |
| MITM on sync | HTTPS + HMAC body signing + RSA key exchange |
| Compromised API key | Rotatable via `revoke_credential` command, new key encrypted with RSA |
| Unauthorized registration | One-time tokens, 24h expiry, admin-generated, audit logged |
| Insider admin abuse | All actions in FleetAuditLog, MFA required, RBAC |
| Command replay | Unique IDs + Last-Event-ID + expiresAt |
| License cache tamper | HMAC-signed by cloud |
| Malicious Docker image | Cosign-signed, auto-rollback on health check failure |
| Cross-tenant leak | Postgres Schema isolation + RLS (two-layer defense) |

---

## Standard Hardware Kit (Per Location)

| Component | Hardware | Protocol |
|-----------|----------|----------|
| Server | Intel NUC, Ubuntu 22.04 LTS, LUKS encryption | Docker + Docker Compose |
| Network | Ubiquiti UniFi (gateway + switches + APs) | VLANs for POS isolation |
| Receipt Printers | Epson TM-T88 (thermal) | ESC/POS over TCP |
| Kitchen Printers | Epson TM-U220 (impact, red ribbon) | ESC/POS over TCP |
| Payment Terminals | Datacap readers (EMV + contactless) | Local → NUC → Datacap cloud |
| POS Terminals | Touch screens (browser) + iPads (PWA) | WiFi/Ethernet to NUC |
| KDS Screens | Browser-based displays | Device-paired via httpOnly cookies |

---

## Related Skills

| Skill | Name | Status | Phase |
|-------|------|--------|-------|
| 300 | Cloud Project Bootstrap | TODO | 2A |
| 301 | Cloud Prisma Schema | TODO | 2A |
| 302 | Server Registration API | TODO | 2A |
| 303 | Heartbeat Ingestion | TODO | 2A |
| 304 | License Validation API | TODO | 2A |
| 305 | Fleet Dashboard (Basic) | TODO | 2A |
| 306 | Provisioning Script | TODO | 2A |
| 307 | SSE Command Stream | TODO | 2B |
| 308 | Sync Agent Sidecar | TODO | 2B |
| 309 | Kill Switch | TODO | 2B |
| 310 | License Cache + Grace Period | TODO | 2B |
| 311 | Alerting (Email + SMS) | TODO | 2B |
| 312 | Data Sync Upload | TODO | 2C |
| 313 | Data Sync Download | TODO | 2C |
| 314 | Conflict Resolution | TODO | 2C |
| 315 | Sync Health Dashboard | TODO | 2C |
| 316 | Cosign Image Pipeline | TODO | 2D |
| 317 | Controlled Rollout | TODO | 2D |
| 318 | Stripe Billing Integration | TODO | 2D |
| 319 | Wildcard Subdomain Routing | TODO | 2D |
| 320 | Tenant Isolation (Schemas + RLS) | TODO | 2A |

---

## Key Documents

| Document | Path | Description |
|----------|------|-------------|
| Architecture Plan | `/docs/plans/MISSION-CONTROL-MODULE-A.md` | Complete Module A plan (12 sections + 3 appendices) |
| Hardware Plan | `/Ideas/Hardware Plan/The plan GWI POS HARDWARE.rtf` | Original hardware plan document |
| GWI Architecture | `/docs/GWI-ARCHITECTURE.md` | Overall system architecture |
| Offline Sync Algorithm | `/docs/OFFLINE-SYNC-ALGORITHM.md` | Sync algorithm design (not yet implemented) |
