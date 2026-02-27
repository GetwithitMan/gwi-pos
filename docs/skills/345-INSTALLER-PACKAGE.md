# Skill 345: NUC Installer Package

**Status:** DONE
**Domain:** Mission Control / DevOps
**Created:** 2026-02-14
**Updated:** 2026-02-14
**Dependencies:** Skill 302 (Server Registration API), Skill 303 (Heartbeat Ingestion)

## Summary

Production-ready installer script (`public/installer.run`, ~1,454 lines) that provisions Ubuntu 22.04+ / Kubuntu 24.04+ NUCs as dedicated POS stations. One curl command, a few prompts, and the NUC is a registered POS device in kiosk mode with RealVNC remote access, heartbeat telemetry, and sync agent.

## Deliverables

| # | File | Repo | Description |
|---|------|------|-------------|
| 1 | `public/installer.run` | POS | Full installer bash script (~1,454 lines) |
| 2 | `src/components/KioskExitZone.tsx` | POS | Hidden 5-tap zone to exit kiosk mode |
| 3 | `src/app/api/system/exit-kiosk/route.ts` | POS | API endpoint to stop kiosk service + kill Chromium |
| 4 | `src/app/layout.tsx` | POS | KioskExitZone rendered in root layout |
| 5 | `installer-v2.txt` | POS | Copy for manual review (untracked) |

## Architecture

### Two Station Roles

| Role | What Gets Installed | Use Case |
|------|-------------------|----------|
| **Server** | PostgreSQL + Node.js POS app + Chromium kiosk + heartbeat + sync agent + backups | Primary NUC at each venue |
| **Terminal** | Chromium kiosk only (points to server) + optional RealVNC | Additional display terminals |

### Registration Flow (RSA Key Exchange)

```
NUC (installer.run)                     Cloud (app.thepasspos.com)
        │                                        │
        ├── Generate RSA-2048 keypair locally     │
        │                                        │
        ├── POST /api/fleet/register ──────────►│
        │   { domain, code, role,                │
        │     publicKey, fingerprint }           │
        │                                        ├── Extract slug from domain
        │                                        ├── Look up CloudLocation by slug
        │                                        ├── Validate ServerRegistrationToken
        │                                        ├── Create ServerNode record
        │                                        ├── RSA-encrypt secrets with publicKey
        │                                        ├── Mark token USED
        │◄────────── 200 { encryptedEnv } ──────┤
        │                                        │
        ├── RSA-decrypt secrets with private key  │
        ├── Write /opt/gwi-pos/.env              │
        ├── Install PostgreSQL + create DB       │
        ├── Clone repo + npm ci + build          │
        ├── Create systemd services              │
        ├── Configure heartbeat cron             │
        ├── Install sync agent                   │
        ├── Start kiosk                          │
        └── DONE                                 │
```

### Domains

| Concept | URL |
|---------|-----|
| Venue subdomains | `{slug}.ordercontrolcenter.com` |
| MC dashboard | `app.thepasspos.com` |
| Fleet registration | `app.thepasspos.com/api/fleet/register` |
| Installer download | `https://gwi-pos.vercel.app/installer.run` |
| Git repo | `https://github.com/GetwithitMan/gwi-pos.git` |

## Installer Sections (~1,454 lines)

### 1. Pre-flight Checks (lines 48-80)
- Ubuntu 22.04+ required
- Must run as root (sudo)
- Network connectivity to `app.thepasspos.com`
- Creates `posuser` system user if not exists

### 2. Registration (lines ~120-350)
- Prompts for domain (e.g. `fruittabar.ordercontrolcenter.com`)
- Prompts for 6-character registration code
- Prompts for role: `server` or `terminal`
- Generates RSA-2048 keypair → `/opt/gwi-pos/keys/`
- Generates hardware fingerprint from CPU, disk serial, MAC address
- POSTs to MC fleet register API with public key
- RSA-decrypts response to get DATABASE_URL, SERVER_API_KEY, etc.

### 3. PostgreSQL Setup (lines ~350-450, server role only)
- Installs PostgreSQL 16
- Creates `thepasspos` database and user
- Configures password from encrypted secrets

### 4. POS Application Install (lines ~450-700, server role only)
- Git clone → `/opt/gwi-pos/app`
- Writes `.env.local` from decrypted env + copies to app dir
- `npm ci --production`
- `npx prisma generate` + `npx prisma db push`
- `npm run build`
- Creates `thepasspos.service` (Node.js: `node -r ./preload.js server.js`)

### 5. Kiosk Setup (lines ~700-820, both roles)
- Desktop launcher (`.desktop` file) for KDE Plasma
- KDE autostart entry
- `thepasspos-kiosk.service` as systemd fallback
- Chromium flags: `--kiosk --start-fullscreen --no-first-run --disable-translate --noerrdialogs`
- Auto-login configuration for `posuser`

### 6. Sudoers Rules (lines 822-834)
Allows POS Node.js process to manage kiosk:
```
posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos
posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop thepasspos-kiosk
posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl start thepasspos-kiosk
posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos-kiosk
posuser ALL=(ALL) NOPASSWD: /usr/bin/pkill -f chromium*
```

### 7. Heartbeat Script + Cron (lines 839-941, server role only)
- `heartbeat.sh` at `/opt/gwi-pos/heartbeat.sh`
- HMAC-SHA256 signed JSON payload
- Sends: version, uptime, cpuPercent, memoryUsedMb, memoryTotalMb, diskUsedGb, diskTotalGb, **localIp**, **posLocationId**
- Response logged to `/opt/gwi-pos/heartbeat.log` (capped at 500 lines)
- Runs every 60 seconds via crontab
- First heartbeat fires immediately during install (visible result)
- Error logging captures HTTP code + response body (first 200 chars)

### 8. Sync Agent (lines ~945-1100, server role only)
- `sync-agent.js` at `/opt/gwi-pos/sync-agent.js`
- Connects to MC SSE stream (`/api/fleet/commands/stream`)
- Receives FORCE_UPDATE, UPDATE_CONFIG, FORCE_SYNC commands
- Runs as `thepasspos-sync.service` systemd unit
- Auto-reconnects with exponential backoff (1s → 30s)

### 9. Backup Script (lines ~1100-1200, server role only)
- `backup-pos.sh` at `/opt/gwi-pos/backup-pos.sh`
- PostgreSQL `pg_dump` to `/opt/gwi-pos/backups/`
- 7-day retention (older backups auto-deleted)
- Daily cron at 4 AM

### 10. .env.local Sync (lines ~635-638)
- Copies `.env` → `app/.env.local` as root, then `chown posuser:posuser`
- Fixes permission issues where `sudo -u posuser cp` fails if source owned by root

### 11. RealVNC (lines ~1200-1350, optional)
- Downloads RealVNC Server .deb
- Enrolls with cloud token: `PulsePOS-{Company}-{Location}-{Role}`

### 12. Desktop Launcher (lines ~1350-1450)
- `.desktop` file with proper `Exec=` and `Type=Application`
- KDE Plasma: `chmod +x` is sufficient for trust (no `gio set` needed)
- GNOME fallback: `gio set metadata::trusted true`
- Auto-start in `~/.config/autostart/`

## Kiosk Exit Zone (Skill 345b)

### Problem
NUCs run in Chromium kiosk mode (fullscreen, no address bar, no close button). Admins need a way to exit without SSH.

### Solution
Hidden 5-tap zone in top-left corner (64×64px, invisible).

### Components

**`KioskExitZone.tsx`** — Client component in root layout:
- 5 taps within 3 seconds triggers exit
- `fetch('/api/system/exit-kiosk', { method: 'POST' })`
- Works on every page (login, orders, admin, KDS, etc.)

**`/api/system/exit-kiosk/route.ts`** — Server API:
- Production: `sudo systemctl stop thepasspos-kiosk; sudo pkill -f "chromium.*localhost"`
- Dev: Returns `{ ok: true, dev: true }` (no-op)
- Sudoers allows `posuser` to run these without password

## Hardening Fixes Applied (Feb 14, 2026)

| Fix | Problem | Solution |
|-----|---------|----------|
| .env.local sync | `sudo -u posuser cp` failed on root-owned file | `cp` as root + `chown posuser:posuser` |
| Sudoers pkill | `chromium*localhost` didn't match desktop launcher | Changed to `chromium*` (broader pattern) |
| Heartbeat rewrite | No error logging, no localIp, no posLocationId | Full rewrite with verbose logging + response capture |
| KDE desktop trust | `gio set metadata::trusted` is GNOME-only | `chmod +x` for KDE, `gio set` for GNOME fallback |
| First heartbeat test | No visibility into whether heartbeat works | Runs immediately during install, shows OK/FAIL |
| `set -euo pipefail` | `grep -v` returns exit 1 on empty input | Uses `|| true` to prevent subshell crashes |

## Heartbeat Payload

```json
{
  "version": "1.0.0",
  "uptime": 3600,
  "activeOrders": 0,
  "cpuPercent": 15.3,
  "memoryUsedMb": 2048,
  "memoryTotalMb": 8192,
  "diskUsedGb": 12,
  "diskTotalGb": 128,
  "localIp": "192.168.1.50",
  "posLocationId": "cmll6q1gp..."
}
```

## Security

- RSA-2048 key exchange (secrets never sent in plaintext)
- HMAC-SHA256 on every heartbeat (body integrity + auth)
- Registration codes are one-time use via `ServerRegistrationToken` model
- Codes have 24h expiry
- Hardware fingerprint captured (CPU + disk serial + MAC)
- Sudoers locked to specific commands (no wildcard sudo)

## Usage

```bash
# Fresh install
curl -sSL https://gwi-pos.vercel.app/installer.run | sudo bash

# Re-run (update existing)
sudo bash /opt/gwi-pos/installer.run
```

## Idempotency

Re-running installer on existing install:
1. Detects `/opt/gwi-pos` exists
2. Skips registration (reads existing `.env`)
3. Runs backup before changes
4. Re-pulls code, rebuilds, restarts services
5. Updates heartbeat/sync agent scripts

## Related Skills

- **Skill 302**: Server Registration API (MC fleet register endpoint)
- **Skill 303**: Heartbeat Ingestion (MC heartbeat endpoint)
- **Skill 306**: Provisioning Script (older `provision.sh`, superseded by installer.run)
- **Skill 308**: Sync Agent Sidecar (Docker version, adapted for systemd in installer)
- **Skill 346**: Kiosk Exit Zone (5-tap exit, root layout)
- **Skill 347**: MC Heartbeat IP Display & Auto-Provisioning
