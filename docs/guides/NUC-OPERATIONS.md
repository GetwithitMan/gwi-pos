# NUC Operations Guide

Reference doc for AI agents working on the GWI POS codebase. Covers NUC provisioning, migration, kiosk management, and go-live checklist.

---

## Installer Flow

Each venue runs on an Ubuntu NUC provisioned by `installer.run` (~1,650 lines). One command:

```bash
curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run
```

### What the Installer Does

1. **Registration** — RSA-2048 keypair + hardware fingerprint → `POST /api/fleet/register` → RSA-encrypted secrets back
2. **PostgreSQL** — Installs PG 16, creates database (server role only)
3. **POS App** — Git clone → `npm ci` → `prisma db push` → `npm run build` → `thepasspos.service` (port 3005)
4. **Kiosk** — Chromium in kiosk mode via `thepasspos-kiosk.service` (preflight checks: X11 session + Chromium installed)
5. **Heartbeat** — 60s cron: jq-built HMAC-signed JSON with CPU/memory/disk/localIp/posLocationId → MC
6. **Sync Agent** — `thepasspos-sync.service` (only created if `sync-agent.js` exists in repo)
7. **Backups** — Daily `pg_dump` at 4 AM, 7-day retention (`set -o pipefail` + stderr capture)
8. **Kiosk Control** — Dedicated `kiosk-control.sh` script for sudoers (stops service + kills Chromium)
9. **Terminal Exit Service** — `thepasspos-exit-kiosk.service` (Python on localhost:3006, CORS restricted)

---

## Two Station Roles

| Role | What's Installed |
|------|-----------------|
| Server | PostgreSQL + Node.js POS (port 3005) + Chromium kiosk + heartbeat + sync agent + backups + VNC |
| Terminal | Chromium kiosk (points to server IP:3005) + exit-kiosk micro-service + VNC |

---

## Registration

- RSA-2048 keypair generated on first run
- Hardware fingerprint includes CPU serial, MAC address, disk serial
- Keypair stored at `/opt/gwi-pos/keys/`
- Registration token from Mission Control required

---

## Dual Migration Scripts (CRITICAL)

Two scripts handle schema migrations across environments:

| Script | Environment | Uses |
|--------|-------------|------|
| `scripts/vercel-build.js` | Neon (cloud/dev) | Direct SQL via connection string |
| `scripts/nuc-pre-migrate.js` | NUC (production) | PrismaClient |

**Adding new migrations: MUST add to BOTH scripts.** Use idempotent checks (e.g., `IF NOT EXISTS`, `DO $$ ... END $$`).

**Problem solved:** Prisma `db push` fails on String→Enum cast. Fix: pre-flight SQL with `ALTER COLUMN TYPE ... USING cast`.

### P3005 Baseline (db-push → migrate deploy transition)

NUCs originally provisioned with `prisma db push` have no `_prisma_migrations` table. When the installer switched to `prisma migrate deploy`, it fails with P3005 ("schema not empty"). The installer and sync agent handle this automatically:

1. `prisma migrate deploy` → P3005 detected
2. Mark all existing migrations as applied via `prisma migrate resolve --applied`
3. Run `prisma db push` to create any tables the baselined migrations would have created
4. Future `migrate deploy` runs work normally (only applies new migrations)

**Important:** `nuc-pre-migrate.js` creates supplementary tables (BergDevice, PmsChargeAttempt, etc.) that make the schema "non-empty" even before core tables exist. The `db push` step after baselining is critical to create the core tables (Organization, Location, Order, etc.).

### Server .env Canonicalization

The installer canonicalizes critical .env values on every server re-run: `PORT=3005`, `NODE_ENV=production`, `STATION_ROLE=server`, `DB_NAME=thepasspos`, `DB_USER=thepasspos`. This fixes stale values from old installers (PORT=3000, DB_NAME=pulse_pos).

---

## CRITICAL: Never Run `sudo npm run build`

Running `npm run build` as root (`sudo npm run build`) changes ownership of `.next/build/` to `root`. The next deploy (running as `smarttab`) will fail with EACCES because it cannot overwrite root-owned files. This happened on Fruita Grill NUC (2026-03-12).

**If this happens, fix with:**
```bash
chown -R smarttab:smarttab /opt/gwi-pos/app/.next/
```
Then re-run the deploy or rebuild as `smarttab`.

**Rule:** All build commands on a NUC must run as the `smarttab` user, never as root.

---

## SSH Credentials

| Host | User | Password |
|------|------|----------|
| 172.16.1.254 | smarttab | 123 |
| 172.16.1.203 | smarttab | 123 |

---

## Sync Agent

- `thepasspos-sync.service` — standalone Node.js process (not part of POS server)
- SSE (Server-Sent Events) listener connecting to Mission Control
- Listens for cloud commands: `FORCE_UPDATE`, `KILL_SWITCH`, `FORCE_UPDATE_APK`, etc.
- Auto-reconnects on connection loss
- Systemd unit only created if `sync-agent.js` exists in the repo
- Timeouts: pre-migrate 180s, build 600s, prisma generate/migrate 120s each

---

## Heartbeat

- 60-second cron job (`/opt/gwi-pos/heartbeat.sh`)
- JSON payload built with `jq` (safe escaping, not printf)
- HMAC-SHA256 signed with `openssl dgst`
- Metrics: CPU, memory, disk, localIp, posLocationId, app version, batch status
- Posts to Mission Control fleet API
- Log: `/opt/gwi-pos/heartbeat.log` (auto-trimmed to 200 lines)

---

## Kiosk Management

- Chromium in kiosk mode via systemd service (`thepasspos-kiosk.service`)
- **Kiosk Exit Zone:** Hidden 64×64px div in top-left corner of every page
  - Tap 5 times in 3 seconds → calls `POST /api/system/exit-kiosk`
  - Stops kiosk service + kills Chromium
  - No auth required (intentional — admin must be able to exit without PIN)

---

## Backups

- Daily `pg_dump` at 4 AM local time
- 7-day retention (older backups auto-deleted)
- Backup location: `/opt/gwi-pos/backups/`

---

## Go-Live Cleanup

Before deploying to a production venue:

1. Set real Datacap credentials via Mission Control
2. Set all `PaymentReader.communicationMode` to `'local'`
3. Set `settings.payments.processor` to `'datacap'`
4. Remove simulated payment defaults (search tag: `SIMULATED_DEFAULTS`)
5. Verify: `grep -r "SIMULATED_DEFAULTS" src/` returns zero matches

---

## Dual-Repo Installer Sync (CRITICAL)

The installer exists in **two** repos and both must stay in sync:

| Repo | Path | Purpose |
|------|------|---------|
| **gwi-pos** (source of truth) | `public/installer.run` | Canonical copy — edit here first |
| **gwi-mission-control** | `scripts/installer.run` | Served to NUCs via `GET /installer.run` route |

**After any installer change:** edit gwi-pos → copy to gwi-mission-control → commit + push both repos → wait for MC Vercel deploy.

---

## Key Files

| File | Purpose |
|------|---------|
| `public/installer.run` | NUC provisioning script (source of truth) |
| `scripts/vercel-build.js` | Neon migration script |
| `scripts/nuc-pre-migrate.js` | NUC migration script |
| `public/sync-agent.js` | Sync agent (copied to NUC at `/opt/gwi-pos/sync-agent.js`) |
| `src/components/KioskExitZone.tsx` | Kiosk exit tap zone |
| `src/app/api/system/exit-kiosk/route.ts` | Kiosk exit API (uses `kiosk-control.sh`) |

---

## Skill Docs

- **Skill 345:** Installer
- **Skill 346:** Kiosk Exit Zone
- **Skill 347:** Heartbeat IP + Auto-Provisioning
