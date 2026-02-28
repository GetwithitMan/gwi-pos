# NUC Operations Guide

Reference doc for AI agents working on the GWI POS codebase. Covers NUC provisioning, migration, kiosk management, and go-live checklist.

---

## Installer Flow

Each venue runs on an Ubuntu NUC provisioned by `public/installer.run` (~1,454 lines). One command:

```bash
curl -sSL https://gwi-pos.vercel.app/installer.run | sudo bash
```

### What the Installer Does

1. **Registration** — RSA-2048 keypair + hardware fingerprint → `POST /api/fleet/register` → RSA-encrypted secrets back
2. **PostgreSQL** — Installs PG 16, creates `thepasspos` database (server role only)
3. **POS App** — Git clone → `npm ci` → `prisma db push` → `npm run build` → `thepasspos.service` (systemd)
4. **Kiosk** — Chromium in kiosk mode via `thepasspos-kiosk.service` + KDE/GNOME autostart
5. **Heartbeat** — 60s cron: HMAC-signed JSON with CPU/memory/disk/localIp/posLocationId → MC
6. **Sync Agent** — SSE listener for cloud commands (FORCE_UPDATE, KILL_SWITCH, etc.)
7. **Backups** — Daily `pg_dump` at 4 AM, 7-day retention

---

## Two Station Roles

| Role | What's Installed |
|------|-----------------|
| Server | PostgreSQL + Node.js POS + Chromium kiosk + heartbeat + sync agent + backups |
| Terminal | Chromium kiosk only (points to server IP) + optional RealVNC |

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

---

## SSH Credentials

| Host | User | Password |
|------|------|----------|
| 172.16.1.254 | smarttab | 123 |
| 172.16.1.203 | smarttab | 123 |

---

## Sync Agent

- SSE (Server-Sent Events) listener connecting to Mission Control
- Listens for cloud commands: `FORCE_UPDATE`, `KILL_SWITCH`, `FORCE_UPDATE_APK`, etc.
- Auto-reconnects on connection loss
- Runs as background worker within the POS process

---

## Heartbeat

- 60-second cron job
- HMAC-signed JSON payload with: CPU usage, memory, disk, localIp, posLocationId
- Posts to Mission Control fleet API
- Used for monitoring and auto-provisioning

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

## Key Files

| File | Purpose |
|------|---------|
| `public/installer.run` | NUC provisioning script (~1,454 lines) |
| `scripts/vercel-build.js` | Neon migration script |
| `scripts/nuc-pre-migrate.js` | NUC migration script |
| `src/components/KioskExitZone.tsx` | Kiosk exit tap zone |
| `src/app/api/system/exit-kiosk/route.ts` | Kiosk exit API |

---

## Skill Docs

- **Skill 345:** Installer
- **Skill 346:** Kiosk Exit Zone
- **Skill 347:** Heartbeat IP + Auto-Provisioning
