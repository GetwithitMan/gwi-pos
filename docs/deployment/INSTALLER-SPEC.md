# GWI POS NUC Installer Specification

## Overview

The NUC Installer (`installer.run`) is a single bash script that provisions Ubuntu 22.04+ NUCs as dedicated POS stations. It handles everything from package installation to Mission Control registration to kiosk mode configuration.

## Quick Start

```bash
curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run
```

## Prerequisites

- Ubuntu 22.04 or later (Desktop edition recommended for kiosk)
- Root/sudo access
- Internet connectivity to `app.thepasspos.com`
- A valid registration code from Mission Control admin

## Station Roles

### Server

The primary NUC at each venue. Runs the full POS stack locally for offline operation and sub-10ms response times.

**Installs:**
- PostgreSQL 14+ (local database)
- Node.js 20+ (application runtime)
- GWI POS application (cloned from GitHub)
- Chromium kiosk (full-screen browser)
- Daily backup cron job
- RealVNC (optional, for remote support)

**Systemd Services:**
- `thepasspos` — Node.js POS server (`node -r ./preload.js server.js`)
- `thepasspos-kiosk` — Chromium in kiosk mode pointing to `http://localhost:3005`
- `thepasspos-sync` — Sync agent (SSE listener for cloud commands)

**Port:** 3005 (configured unquoted in `.env` — systemd `EnvironmentFile` treats quoted values as literal)

### Terminal

Additional display terminals at the venue (bar screens, host stand, etc.). No local POS stack — just a browser pointing at the server NUC.

**Installs:**
- Chromium kiosk (full-screen browser)
- RealVNC (optional)

**Systemd Services:**
- `thepasspos-kiosk` — Chromium in kiosk mode pointing to server URL (e.g., `http://192.168.1.50:3005`)
- `thepasspos-exit-kiosk` — Python micro-service on localhost:3006 for local kiosk exit

## Installation Flow

```
curl installer.run | sudo bash
        │
        ├─ Pre-flight checks
        │   ├─ Ubuntu 22.04+?
        │   ├─ Running as root?
        │   └─ Network to app.thepasspos.com?
        │
        ├─ Interactive prompts
        │   ├─ Role: Server or Terminal?
        │   ├─ Registration code (UUID from MC admin)
        │   ├─ VNC password (or auto-generate)
        │   └─ (Terminal only) Server URL
        │
        ├─ MC Registration
        │   POST app.thepasspos.com/api/fleet/register
        │   → Returns env vars + repo URL
        │   → On failure: ERROR + EXIT
        │
        ├─ Write /opt/gwi-pos/.env (chmod 600)
        │
        ├─ Install common packages
        │   Node.js 20, Chromium, git, jq
        │
        ├─── Server branch ──────────────────
        │    ├─ Install PostgreSQL
        │    ├─ Create DB + user (idempotent)
        │    ├─ Clone/pull repo → /opt/gwi-pos/app
        │    ├─ npm ci + prisma generate + db push + build
        │    ├─ Create pre-start.sh (runs on every boot/restart)
        │    │    1. prisma generate (regenerate client)
        │    │    2. prisma db push (sync schema)
        │    │    3. nuc-pre-migrate.js (custom migrations)
        │    ├─ Create thepasspos.service (ExecStartPre=pre-start.sh)
        │    ├─ Create thepasspos-kiosk.service (→ localhost:3005)
        │    ├─ Create thepasspos-sync.service (sync agent)
        │    ├─ Install heartbeat.sh + cron (every 60s)
        │    ├─ Install backup-pos.sh + cron (4 AM)
        │    └─ Start services (wait for health check)
        │
        ├─── Terminal branch ────────────────
        │    ├─ Create thepasspos-kiosk.service (→ server URL)
        │    └─ Start kiosk service
        │
        ├─ RealVNC enrollment (if token provided)
        │
        ├─ Desktop launcher (.desktop file)
        │
        └─ Summary + useful commands
```

## File Layout on NUC

```
/opt/gwi-pos/
├── .env                    # Environment variables (chmod 600, unquoted values)
├── backup-pos.sh           # Daily PostgreSQL backup script (server only)
├── heartbeat.sh            # 60s HMAC-signed metrics to Mission Control (server only)
├── sync-agent.js           # SSE listener for cloud commands (server only)
├── kiosk-control.sh        # Stops kiosk service + kills Chromium (sudoers-allowed)
├── wait-for-pos.sh         # Waits for POS health endpoint before starting kiosk
├── clear-kiosk-session.sh  # Clears stale Chromium session data
├── exit-kiosk-server.py    # Terminal-only: localhost:3006 kiosk exit micro-service
├── backups/                # pg_dump .sql.gz files (7-day retention)
├── keys/                   # RSA keypair (server_key.pem, server_key_pub.pem)
└── app/                    # GWI POS application (server role only)
    ├── .env.local          # Symlink to /opt/gwi-pos/.env
    ├── server.js           # Compiled server (from server.ts)
    ├── preload.js          # AsyncLocalStorage polyfill
    ├── .next/              # Next.js build output
    ├── prisma/             # Prisma schema + migrations
    └── ...
```

## Systemd Services

### thepasspos.service (Server only)

```ini
[Unit]
Description=GWI POS Server
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
User=<posuser>
WorkingDirectory=/opt/gwi-pos/app
EnvironmentFile=/opt/gwi-pos/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node -r ./preload.js server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### thepasspos-kiosk.service (Both roles)

```ini
[Unit]
Description=GWI POS Kiosk
After=graphical.target [thepasspos.service for server]

[Service]
User=<posuser>
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --check-for-update-interval=31536000 <target-url>
Restart=always
RestartSec=3

[Install]
WantedBy=graphical.target
```

## Fleet Registration API

### Endpoint

`POST https://app.thepasspos.com/api/fleet/register`

### Request

```json
{
  "domain": "fruittabar.ordercontrolcenter.com",
  "code": "ABC123",
  "role": "server"
}
```

### Validation

1. Extract slug from domain (`fruittabar` from `fruittabar.ordercontrolcenter.com`)
2. Look up Location by slug in master database
3. Validate registration code:
   - Code exists on Location (`registrationToken`)
   - Code not already used (`registrationTokenUsed`)
   - Code not expired (`registrationTokenExpiresAt`)
   - Code matches submitted value

### Response (Server)

Returns full environment variables including:
- `DATABASE_URL` / `DIRECT_URL` — Local PostgreSQL connection string with generated password
- `LOCATION_ID` / `LOCATION_NAME` — Venue identity
- `SERVER_NODE_ID` / `SERVER_API_KEY` — Server node identity and auth
- `MISSION_CONTROL_URL` / `SYNC_API_URL` — Cloud connectivity
- `NEXTAUTH_SECRET` — Session encryption
- `DB_USER` / `DB_PASSWORD` / `DB_NAME` — For local PostgreSQL setup
- `repoUrl` — Git repository URL for cloning

### Response (Terminal)

Returns minimal environment:
- `LOCATION_ID` / `LOCATION_NAME` / `SERVER_NODE_ID`
- `repoUrl: null`

### Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Missing fields, invalid role, invalid domain, no reg code, code already used |
| 401 | Wrong registration code |
| 404 | Venue not found |
| 500 | Internal server error |

## Backup System

### Script: `/opt/gwi-pos/backup-pos.sh`

- Runs `pg_dump` piped through `gzip`
- Stores in `/opt/gwi-pos/backups/pos-YYYYMMDD-HHMMSS.sql.gz`
- 7-day retention (older backups auto-deleted)
- Reads DB credentials from `/opt/gwi-pos/.env`

### Schedule

- **Cron**: Daily at 4:00 AM
- **Pre-update**: Runs before installer re-run (idempotent update)

## Idempotency

Re-running `installer.run` on an existing installation:

### Server Re-run
1. Detects `/opt/gwi-pos` directory exists
2. Runs `backup-pos.sh` (snapshot before changes)
3. Prompts for registration (can use new code)
4. Overwrites `.env` with new values
5. `git fetch --all && git reset --hard origin/main`
6. `npm ci && prisma generate && prisma db push && npm run build`
7. Overwrites systemd services
8. Restarts all services

### Terminal Re-run
1. Overwrites kiosk service with new URL
2. Restarts kiosk

### Factory Reset

```bash
sudo systemctl stop thepasspos thepasspos-kiosk thepasspos-sync thepasspos-exit-kiosk
sudo rm -rf /opt/gwi-pos
sudo rm -f /etc/systemd/system/thepasspos.service /etc/systemd/system/thepasspos-kiosk.service /etc/systemd/system/thepasspos-sync.service /etc/systemd/system/thepasspos-exit-kiosk.service
sudo rm -f /etc/sudoers.d/gwi-pos
sudo systemctl daemon-reload
```

Then re-run `installer.run`.

## RealVNC Integration

When a VNC cloud token is provided during installation:

1. Downloads RealVNC Server .deb package via `curl`
2. Installs via `dpkg -i`
3. Enrolls with provided cloud connectivity token
4. Both x11vnc (LAN) and RealVNC (cloud) available

This allows remote support via RealVNC Connect portal.

## Dual-Repo Installer Sync (CRITICAL)

The installer exists in **two** repos. Both must stay in sync:

| Repo | Path | Purpose |
|------|------|---------|
| **gwi-pos** (source of truth) | `public/installer.run` | Canonical copy, edit here first |
| **gwi-mission-control** | `scripts/installer.run` | Served via `GET /installer.run` route handler |

**After any installer change:**
1. Edit `gwi-pos/public/installer.run`
2. Copy to `gwi-mission-control/scripts/installer.run`
3. Commit + push **both** repos
4. Wait for MC Vercel deploy before re-running on NUCs

The MC route at `src/app/installer.run/route.ts` reads from `scripts/installer.run` at runtime (5-min cache).

## Useful Commands After Installation

```bash
# Service management
sudo systemctl status thepasspos       # Check POS server
sudo systemctl status thepasspos-kiosk     # Check kiosk
sudo journalctl -u thepasspos -f       # Tail POS logs
sudo journalctl -u thepasspos-kiosk -f     # Tail kiosk logs

# Manual restart
sudo systemctl restart thepasspos
sudo systemctl restart thepasspos-kiosk

# Manual backup
sudo -u <posuser> /opt/gwi-pos/backup-pos.sh

# List backups
ls -lh /opt/gwi-pos/backups/

# Re-run installer (update)
sudo bash /opt/gwi-pos/installer.run
```

## Verification Checklist

| # | Test | How to Verify |
|---|------|---------------|
| 1 | Fresh server install | Run on clean Ubuntu 22.04 → POS at `http://localhost:3005` |
| 2 | Fresh terminal install | Run on second NUC → Chromium opens pointing at server |
| 3 | Idempotent re-run | Run installer again → DB backed up, code updated, no data loss |
| 4 | Offline operation | Disconnect network after install → POS works with local Postgres |
| 5 | RealVNC | NUC appears in RealVNC account |
| 6 | Service recovery | `sudo reboot` → all services auto-start |
| 7 | Backup rotation | Check `/opt/gwi-pos/backups/` for daily .sql.gz, 7-day retention |
| 8 | MC registration | POST with valid code → 200; POST with bad code → 400/401 |
