# Skill 345: NUC Installer Package

**Status:** DONE
**Domain:** Mission Control / DevOps
**Created:** 2026-02-14
**Dependencies:** Skill 302 (Server Registration API)

## Summary

Production-ready installer script (`installer.run`) that provisions Ubuntu 22.04+ NUCs as dedicated POS stations. One curl command, a few prompts, and the NUC is a registered POS device in kiosk mode with RealVNC remote access.

## Deliverables

| # | File | Description |
|---|------|-------------|
| 1 | `scripts/installer.run` | Full installer bash script (~500 lines) |
| 2 | `scripts/backup-pos.sh` | PostgreSQL backup script (installed to `/opt/gwi-pos/`) |
| 3 | `src/app/api/fleet/register/route.ts` | MC fleet registration API endpoint |
| 4 | `docs/INSTALLER-SPEC.md` | Full specification document |
| 5 | `INSTALL.txt` | Updated with `installer.run` instructions |

## Architecture

### Two Station Roles

| Role | What Gets Installed | Use Case |
|------|-------------------|----------|
| **Server** | PostgreSQL + Node.js POS app + Chromium kiosk | Primary NUC at each venue |
| **Terminal** | Chromium kiosk only (points to server) | Additional display terminals |

### Registration Flow

```
NUC (installer.run)                     Cloud (app.thepasspos.com)
        │                                        │
        ├── POST /api/fleet/register ──────────►│
        │   { domain, code, role }               │
        │                                        ├── Extract slug from domain
        │                                        ├── Look up Location by slug
        │                                        ├── Validate registration code
        │                                        ├── Create ServerNode record
        │                                        ├── Generate secrets
        │◄────────── 200 { env, repoUrl } ──────┤
        │                                        │
        ├── Write /opt/gwi-pos/.env              │
        ├── Install dependencies                 │
        ├── Clone repo + build                   │
        ├── Create systemd services              │
        ├── Start kiosk                          │
        └── DONE                                 │
```

### Domains

| Concept | URL |
|---------|-----|
| Venue subdomains | `{slug}.ordercontrolcenter.com` |
| MC dashboard | `app.thepasspos.com` |
| Fleet registration | `app.thepasspos.com/api/fleet/register` |
| Git repo | `https://github.com/GetwithitMan/gwi-pos.git` |

## Fleet Registration API

**Endpoint:** `POST /api/fleet/register`

### Request
```json
{
  "domain": "fruittabar.ordercontrolcenter.com",
  "code": "ABC123",
  "role": "server"
}
```

### Response (Server Role)
```json
{
  "data": {
    "env": {
      "DATABASE_URL": "postgresql://pulse_pos:<generated>@localhost:5432/pulse_pos",
      "DIRECT_URL": "postgresql://pulse_pos:<generated>@localhost:5432/pulse_pos",
      "LOCATION_ID": "cmll6q1gp...",
      "LOCATION_NAME": "Fruit Bar & Grill",
      "SERVER_NODE_ID": "cmll...",
      "SERVER_API_KEY": "<64-char hex>",
      "MISSION_CONTROL_URL": "https://app.thepasspos.com",
      "SYNC_ENABLED": "true",
      "SYNC_API_URL": "https://app.thepasspos.com/api/fleet",
      "NEXT_PUBLIC_EVENT_PROVIDER": "socket",
      "NEXTAUTH_SECRET": "<64-char hex>",
      "PORT": "3000",
      "NODE_ENV": "production",
      "DB_USER": "pulse_pos",
      "DB_PASSWORD": "<32-char hex>",
      "DB_NAME": "pulse_pos"
    },
    "repoUrl": "https://github.com/GetwithitMan/gwi-pos.git"
  }
}
```

### Response (Terminal Role)
```json
{
  "data": {
    "env": {
      "LOCATION_ID": "cmll...",
      "LOCATION_NAME": "Fruit Bar & Grill",
      "SERVER_NODE_ID": "cmll..."
    },
    "repoUrl": null
  }
}
```

### Security
- Registration codes are one-time use (marked used after success)
- Codes have 24h expiry (`registrationTokenExpiresAt`)
- Secrets generated per-registration (serverApiKey, nextAuthSecret, dbPassword)
- IP address captured from `x-forwarded-for` header

## Schema Changes

### Location Model (added fields)
```prisma
slug                       String?   @unique
registrationToken          String?   @unique
registrationTokenExpiresAt DateTime?
registrationTokenUsed      Boolean   @default(false)
serverNodes                ServerNode[]
```

### ServerNode Model (new)
```prisma
model ServerNode {
  id                  String    @id @default(cuid())
  locationId          String
  location            Location  @relation(fields: [locationId], references: [id])
  serverApiKey        String    @unique
  role                String    @default("server")
  status              String    @default("registered")
  hardwareFingerprint String?
  currentVersion      String?
  lastHeartbeatAt     DateTime?
  ipAddress           String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@index([locationId])
}
```

## Installer Details

### Pre-flight Checks
- Ubuntu 22.04+ required
- Must run as root (sudo)
- Network connectivity to `app.thepasspos.com`

### Server Role Installation
1. PostgreSQL installed + DB/user created
2. Git clone → `/opt/gwi-pos/app`
3. `npm ci` + `prisma generate` + `prisma db push` + `npm run build`
4. `pulse-pos.service` (Node.js POS server)
5. `pulse-kiosk.service` (Chromium kiosk → localhost:3000)
6. Daily backup cron at 4 AM

### Terminal Role Installation
1. `pulse-kiosk.service` (Chromium kiosk → server URL)
2. No PostgreSQL, no POS app

### Systemd Services
- `pulse-pos`: `node -r ./preload.js server.js` (server only)
- `pulse-kiosk`: `chromium-browser --kiosk` (both roles)

### RealVNC Enrollment
- Downloads RealVNC Server .deb
- Joins cloud with token: `PulsePOS-{Company}-{Location}-{Role}`

### Idempotency
Re-running installer on existing install:
1. Detects `/opt/gwi-pos` exists
2. Runs backup before changes
3. Re-pulls code, rebuilds, restarts services

## Key Files

| File | Purpose |
|------|---------|
| `scripts/installer.run` | Main installer script |
| `scripts/backup-pos.sh` | PostgreSQL backup with 7-day retention |
| `src/app/api/fleet/register/route.ts` | Fleet registration API |
| `docs/INSTALLER-SPEC.md` | Full specification |
| `INSTALL.txt` | Quick-start instructions |

## Usage

```bash
# Fresh install
curl -sSL https://www.thepasspos.com/installer.run | sudo bash

# Re-run (update existing)
sudo bash /opt/gwi-pos/installer.run
```
