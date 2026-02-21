# GWI POS NUC Installer Specification

## Overview

The NUC Installer (`installer.run`) is a single bash script that provisions Ubuntu 22.04+ NUCs as dedicated POS stations. It handles everything from package installation to Mission Control registration to kiosk mode configuration.

## Quick Start

```bash
curl -sSL https://www.thepasspos.com/installer.run | sudo bash
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
- `pulse-pos` — Node.js POS server (`node -r ./preload.js server.js`)
- `pulse-kiosk` — Chromium in kiosk mode pointing to `http://localhost:3000`

### Terminal

Additional display terminals at the venue (bar screens, host stand, etc.). No local POS stack — just a browser pointing at the server NUC.

**Installs:**
- Chromium kiosk (full-screen browser)
- RealVNC (optional)

**Systemd Services:**
- `pulse-kiosk` — Chromium in kiosk mode pointing to server URL (e.g., `http://192.168.1.50:3000`)

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
        │   ├─ Venue domain (e.g., fruittabar.ordercontrolcenter.com)
        │   ├─ Registration code (from MC admin)
        │   ├─ RealVNC: Company name, terminal name, cloud token
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
        │    ├─ Create pulse-pos.service
        │    ├─ Create pulse-kiosk.service (→ localhost:3000)
        │    ├─ Install backup-pos.sh + cron (4 AM)
        │    └─ Start services (wait for health check)
        │
        ├─── Terminal branch ────────────────
        │    ├─ Create pulse-kiosk.service (→ server URL)
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
├── .env                    # Environment variables (chmod 600)
├── installer.run           # Copy of installer for re-runs
├── backup-pos.sh           # Daily PostgreSQL backup script
├── backups/                # pg_dump .sql.gz files (7-day retention)
└── app/                    # GWI POS application (server role only)
    ├── .env                # Symlink to /opt/gwi-pos/.env
    ├── .env.local          # Copy of .env for Next.js
    ├── server.js           # Compiled server (from server.ts)
    ├── preload.js          # AsyncLocalStorage polyfill
    ├── .next/              # Next.js build output
    ├── prisma/             # Prisma schema + migrations
    └── ...
```

## Systemd Services

### pulse-pos.service (Server only)

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

### pulse-kiosk.service (Both roles)

```ini
[Unit]
Description=GWI POS Kiosk
After=graphical.target [pulse-pos.service for server]

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
sudo systemctl stop pulse-pos pulse-kiosk
sudo rm -rf /opt/gwi-pos
sudo rm -f /etc/systemd/system/pulse-pos.service /etc/systemd/system/pulse-kiosk.service
sudo systemctl daemon-reload
```

Then re-run `installer.run`.

## RealVNC Integration

When a VNC cloud token is provided during installation:

1. Downloads RealVNC Server .deb package
2. Installs via `apt-get`
3. Enrolls with naming convention: `PulsePOS-{Company}-{Location}-{Role}`
4. Example: `PulsePOS-GWI-FruitBar-Server`

This allows remote support via RealVNC Connect portal.

## Supported Domains

The installer validates venue domains against these parent domains:
- `*.ordercontrolcenter.com`
- `*.barpos.restaurant`

## Useful Commands After Installation

```bash
# Service management
sudo systemctl status pulse-pos       # Check POS server
sudo systemctl status pulse-kiosk     # Check kiosk
sudo journalctl -u pulse-pos -f       # Tail POS logs
sudo journalctl -u pulse-kiosk -f     # Tail kiosk logs

# Manual restart
sudo systemctl restart pulse-pos
sudo systemctl restart pulse-kiosk

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
| 1 | Fresh server install | Run on clean Ubuntu 22.04 → POS at `http://localhost:3000` |
| 2 | Fresh terminal install | Run on second NUC → Chromium opens pointing at server |
| 3 | Idempotent re-run | Run installer again → DB backed up, code updated, no data loss |
| 4 | Offline operation | Disconnect network after install → POS works with local Postgres |
| 5 | RealVNC | NUC appears in RealVNC account |
| 6 | Service recovery | `sudo reboot` → all services auto-start |
| 7 | Backup rotation | Check `/opt/gwi-pos/backups/` for daily .sql.gz, 7-day retention |
| 8 | MC registration | POST with valid code → 200; POST with bad code → 400/401 |
