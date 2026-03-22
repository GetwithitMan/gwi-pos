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

### Pre-Start Script: Automatic Prisma Client Regeneration

The pre-start script (`/opt/gwi-pos/pre-start.sh`) runs on **every** NUC boot/restart before the POS service starts. It:

1. **Regenerates the Prisma client** (`prisma generate`) — ensures the client matches the deployed `schema.prisma`, even if the build was interrupted or `npm ci` was partial. This eliminates the "stale Prisma client" bug that previously required manual `npx prisma generate` on venues after updates.
2. **Pushes the schema** (`prisma db push --skip-generate`) — syncs local PG to match the Prisma schema (creates new tables/columns). **No `--accept-data-loss` flag** — if the code's schema is older than the DB, Prisma blocks instead of dropping columns.
3. **Runs custom migrations** (`nuc-pre-migrate.js`) — applies any pending `scripts/migrations/NNN-*.js` files.

**This means:** A NUC that crashes mid-update, loses power during build, or gets a partial `npm ci` will self-heal on the next restart. No manual Prisma intervention needed.

### Migration Safety Rules (updated 2026-03-14)

1. **Database only moves forward** — NEVER roll back the database schema. Rollback = deploy previous app code only.
2. **No `--accept-data-loss`** — Pre-start script uses `prisma db push` WITHOUT this flag. If the code's schema is older than the DB, Prisma blocks instead of dropping columns.
3. **Startup schema verification** — `schema-verify.ts` checks critical tables/columns on boot. Missing elements are logged as CRITICAL errors.
4. **One-version compatibility** — New migrations must be backward-compatible with N-1 code. Add columns as nullable, never rename or drop in the same release.
5. **Forward-only migrations** — `scripts/migrations/NNN-*.js` have `up()` only, no `down()`. The tracking table (`_gwi_migrations`) prevents re-runs.

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

## Self-Healing and Auto-Recovery

### Update-Agent File Permission Recovery

The update-agent (sync-agent.js) now auto-heals file permission issues before git operations:

```bash
# Runs before git fetch/checkout to prevent EACCES failures
sudo chown -R smarttab:smarttab /opt/gwi-pos/app/
```

This prevents the recurring issue where `sudo npm run build` or root-owned files block subsequent deploys.

### Dashboard .deb Auto-Update

During POS deploys, the update-agent checks for a new `gwi-dashboard.deb` in the repo and installs it automatically:

- The dashboard binary is included in the POS git repo
- After `npm ci` + build, the agent runs `sudo dpkg -i gwi-dashboard.deb` if a newer version exists
- No separate deploy pipeline needed for the dashboard

### _venue_schema_state Self-Healing (3-Layer Protection)

The `_venue_schema_state` row in local PG is critical for schema version tracking. Three layers prevent it from going missing or stale:

1. **Installer fallback:** If the row doesn't exist after Stage 6 (schema), the installer creates a fallback row with the current schema version
2. **Bootstrap self-heal:** On every POS boot, if the row is missing or has a stale version, the bootstrap process re-creates it from the current Prisma schema
3. **5-minute periodic recheck:** A background timer verifies the row every 5 minutes and self-heals if needed

### Installer Auto-Reboot

After a full install (all stages complete), the installer automatically reboots the NUC to ensure all services start cleanly with the correct systemd configuration. This only triggers on fresh installs, not on `--resume-from` partial runs.

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

---

## Baseline Enforcement (Stage 11)

### Verification Commands
```bash
# Check if baseline was applied
cat /opt/gwi-pos/state/baseline-applied.json | jq .baseline_version

# Check last Stage 11 result
cat /opt/gwi-pos/state/stage11-result.json | jq '{outcome, changed_count, duration_seconds}'

# Check hardening status (post-boot verification)
cat /opt/gwi-pos/state/hardening-status.json | jq '{overall, checks}'

# Check for drift
cat /opt/gwi-pos/state/drift-scan.json | jq '{drift_detected, drifted_items}'

# Check sync status (schema mismatch detection)
cat /opt/gwi-pos/state/sync-status.json | jq '{syncReady, blockReason}'

# Check current run state
cat /opt/gwi-pos/state/run-state.json | jq '{state, last_outcome}'
```

### OS Hardening Verification
```bash
# Sleep targets masked
systemctl is-enabled sleep.target    # should be "masked"
systemctl is-enabled suspend.target  # should be "masked"

# Firewall active
sudo ufw status verbose

# Autologin configured
cat /etc/sddm.conf.d/gwi-autologin.conf 2>/dev/null || grep AutomaticLogin /etc/gdm3/custom.conf

# Screen lock disabled
cat ~/.config/kscreenlockerrc 2>/dev/null  # KDE
# or: gsettings get org.gnome.desktop.screensaver lock-enabled  # GNOME

# SSH hardened
cat /etc/ssh/sshd_config.d/99-gwi-pos.conf
systemctl is-active fail2ban

# Unattended upgrades
apt-config dump | grep Unattended-Upgrade::Allowed-Origins
```

### Device Verification
```bash
# udev rules installed
ls /etc/udev/rules.d/99-epson-tm.rules /etc/udev/rules.d/99-gwi-pos-devices.rules

# User groups
groups $(stat -c '%U' /opt/gwi-pos/.env)  # should include lpadmin, plugdev, dialout

# Plymouth theme
plymouth-set-default-theme -l | grep gwi
```

### Support Tools
```bash
# Generate support bundle (for field techs / escalations)
sudo /opt/gwi-pos/bin/generate-support-bundle.sh
# Output: /opt/gwi-pos/support-bundle-YYYYMMDD-HHMMSS.tar.gz

# Check baseline drift (human-readable)
/opt/gwi-pos/bin/baseline-diff
# or JSON: /opt/gwi-pos/bin/baseline-diff --json

# Restore baseline config from snapshot (emergency only)
sudo /opt/gwi-pos/bin/gwi-baseline-restore.sh                    # list snapshots
sudo /opt/gwi-pos/bin/gwi-baseline-restore.sh <snapshot> --confirm  # restore
```

### Re-running Baseline
```bash
# Re-run all hardening roles
sudo ./installer.run --resume-from=system_hardening

# Re-run specific roles only
HARDENING_TAGS=firewall,os_hardening sudo ./installer.run --resume-from=system_hardening

# Skip specific roles
SKIP_HARDENING_TAGS=branding sudo ./installer.run --resume-from=system_hardening

# Dry-run (check mode, no changes)
HARDENING_DRY_RUN=1 sudo ./installer.run --resume-from=system_hardening
```

### Troubleshooting
```bash
# Check Ansible output from last run
cat /opt/gwi-pos/state/ansible-stderr.log

# Check baseline lock state (if runs seem stuck)
cat /opt/gwi-pos/state/run-state.json | jq '{state, lock_pid, triggered_by}'

# Force unlock (only if PID is dead)
# Manual: rm /opt/gwi-pos/state/baseline.lock

# Check offline report queue
ls /opt/gwi-pos/state/report-queue/
```
