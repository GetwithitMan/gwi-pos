# NUC Operations Guide

Reference doc for AI agents working on the GWI POS codebase. Covers NUC provisioning, migration, kiosk management, and go-live checklist.

**Architecture version:** v2.0.10 -- Docker/gwi-node appliance model. Docker is the ONLY runtime. No bare Node.js, no `thepasspos.service`, no `thepasspos-sync.service`.

---

## Architecture Overview

Each NUC runs two Docker containers managed by a host-level systemd service:

| Component | What It Is | How It Runs |
|-----------|-----------|-------------|
| **gwi-node.service** | Host-level systemd service | Runs `gwi-node.sh watch` -- polls for deploy trigger files |
| **gwi-pos** container | POS application (Next.js + Socket.io) | Docker, port 3005, host networking |
| **gwi-agent** container | MC command listener + heartbeat | Docker, runs `sync-agent.js`, host networking |

**Key principle: Container signals, host executes.** The gwi-agent container writes deploy requests to a trigger file. The gwi-node.service on the host reads the trigger, pulls images, runs migrations, and swaps containers. Containers never call host scripts directly.

### Trigger-File Protocol

The deploy flow uses a file-based protocol for container-to-host communication:

1. **Mission Control** sends a fleet command (e.g., `FORCE_UPDATE`) via SSE to the gwi-agent container
2. **gwi-agent** writes a trigger file to `/opt/gwi-pos/shared/state/deploy-requests/<attemptId>.json`
3. **gwi-node.service** (polling every 3s) detects the new file
4. **gwi-node.sh** reads the trigger, acquires a deploy lock, pulls the Docker image from GHCR (Cosign-verified), runs schema migrations inside a temporary container, stops old containers, starts new ones, waits for health checks
5. **gwi-node.sh** writes a result file to `/opt/gwi-pos/shared/state/deploy-results/<attemptId>.json`
6. **gwi-agent** reads the result file and ACKs back to Mission Control

Trigger file format:
```json
{
  "attemptId": "uuid",
  "commandId": "uuid",
  "action": "deploy",
  "payload": {
    "version": "2.0.10",
    "imageRef": "ghcr.io/getwithitman/gwi-pos:v2.0.10",
    "imageDigest": "sha256:...",
    "manifestUrl": "https://pub-....r2.dev/latest/manifest.json"
  }
}
```

Result file format:
```json
{
  "attemptId": "uuid",
  "commandId": "uuid",
  "action": "deploy",
  "status": "COMPLETED",
  "targetVersion": "2.0.10",
  "resultVersion": "2.0.10",
  "startedAt": "...",
  "completedAt": "...",
  "finalStatus": "healthy",
  "error": null,
  "deployId": "uuid",
  "imageRef": "ghcr.io/getwithitman/gwi-pos:v2.0.10",
  "deployLogPath": "/opt/gwi-pos/shared/logs/deploys/2026-04-04T..."
}
```

### Legacy Service Masking

The old `thepasspos.service` and `thepasspos-sync.service` are permanently masked on all NUCs. The gwi-node bootstrap re-masks them after every successful deploy. There is no fallback to bare Node.js -- if Docker fails, the venue is down until fixed.

---

## Installer Flow

Each venue runs on an Ubuntu NUC provisioned by `installer.run` (~1,650 lines). One command:

```bash
curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run
```

### What the Installer Does

1. **Registration** -- RSA-2048 keypair + hardware fingerprint -> `POST /api/fleet/register` -> RSA-encrypted secrets back
2. **PostgreSQL** -- Installs PG 16, creates database (server role only)
3. **Docker + gwi-node** -- Installs Docker engine, copies `gwi-node.sh` to `/opt/gwi-pos/gwi-node.sh`, creates `gwi-node.service`, runs `gwi-node.sh install` which pulls the Docker image from GHCR and starts `gwi-pos` + `gwi-agent` containers
4. **Kiosk** -- Chromium in kiosk mode via `thepasspos-kiosk.service` (preflight checks: X11 session + Chromium installed)
5. **Heartbeat** -- 60s cron: jq-built HMAC-signed JSON with CPU/memory/disk/localIp/posLocationId -> MC
6. **Backups** -- Daily `pg_dump` at 4 AM, 7-day retention (`set -o pipefail` + stderr capture)
7. **Kiosk Control** -- Dedicated `kiosk-control.sh` script for sudoers (stops service + kills Chromium)
8. **Terminal Exit Service** -- `thepasspos-exit-kiosk.service` (Python on localhost:3006, CORS restricted)
9. **System Hardening** -- Ansible baseline enforcement (Stage 11): firewall, SSH, autologin, sleep masking, 16 roles total

---

## Two Station Roles

| Role | What's Installed |
|------|-----------------|
| Server | PostgreSQL + Docker (gwi-pos + gwi-agent containers on port 3005) + gwi-node.service + Chromium kiosk + heartbeat + backups + VNC |
| Terminal | Chromium kiosk (points to server IP:3005) + exit-kiosk micro-service + VNC |

---

## Registration

- RSA-2048 keypair generated on first run
- Hardware fingerprint includes CPU serial, MAC address, disk serial
- Keypair stored at `/opt/gwi-pos/keys/`
- Registration token from Mission Control required

---

## gwi-node.sh -- The Single Deploy Agent

`gwi-node.sh` (located at `/opt/gwi-pos/gwi-node.sh`) is the only deploy agent on every NUC. It has six subcommands:

| Subcommand | What It Does |
|-----------|-------------|
| `install` | Installs Docker if needed, creates dirs, then runs `deploy` |
| `deploy` | Fetches manifest from R2, self-updates from target image, pulls Docker image, runs schema migrations, swaps containers, health checks |
| `rollback` | Restores the previous Docker image (stored in `previous-image.txt`) |
| `status` | Shows running version, container state, health endpoint |
| `self-update` | Extracts the latest `gwi-node.sh` from the running container image |
| `watch` | Long-running mode: polls `deploy-requests/` dir every 3s, dispatches triggers |

### Deploy Lifecycle (detail)

1. Resolve target image from R2 manifest (3 retries)
2. Self-update: extract `gwi-node.sh` from the target image, replace on disk, re-exec if changed
3. Acquire file lock (`/opt/gwi-pos/shared/state/gwi-node.lock`, 300s timeout)
4. Pull Docker image from GHCR, verify digest if provided
5. Run schema migration: `docker run --rm ... node deploy-tools/src/migrate.js` (local PG)
6. Run Neon migration if `NEON_DATABASE_URL` present in `.env`
7. Stop old containers (`gwi-pos`, `gwi-agent`) and disable legacy services
8. Preflight: ensure port 3005 is free, create runtime dirs with correct permissions
9. Start new `gwi-pos` container (host networking, mounts `/opt/gwi-pos/shared` and `/opt/gwi-pos/state`)
10. Health check: poll `/api/health/ready` (30 attempts x 2s, need 3 consecutive 200s)
11. On success: write `running-version.json`, start `gwi-agent` container, bootstrap host watcher (refresh service unit, mask legacy services), prune dangling images
12. On failure: auto-rollback to previous image, capture diagnostics, write deploy log

### Host Watcher Bootstrap

After every successful deploy, gwi-node runs `bootstrap_host_watcher()` which:
- Extracts the latest `gwi-node.sh` and `gwi-node.service` from the deployed image
- Updates them on the host if they changed
- Ensures trigger directories exist with correct permissions
- Masks `thepasspos` and `thepasspos-sync` (idempotent)
- Reloads/restarts `gwi-node.service`

This means the host agent self-updates from the Docker image on every deploy -- no separate update mechanism needed.

---

## Docker Containers

Both containers run from the same image (`ghcr.io/getwithitman/gwi-pos:<version>`), built by GitHub Actions with Cosign signing and SBOM.

### gwi-pos Container
- **Purpose:** POS application server (Next.js + Socket.io custom server)
- **Port:** 3005 (host networking)
- **Env:** Loaded from `/opt/gwi-pos/shared/.env`
- **Volumes:** `/opt/gwi-pos/shared` (env, state, logs), `/opt/gwi-pos/state` (writable by app user uid 1001)
- **Health check:** `curl -f http://localhost:3005/api/health/ready` every 30s
- **Restart policy:** `unless-stopped`

### gwi-agent Container
- **Purpose:** MC command listener (SSE), heartbeat, deploy trigger writer
- **Command:** `node public/sync-agent.js`
- **User:** root (needs Docker socket access)
- **Volumes:** `/var/run/docker.sock` (to inspect containers), `/opt/gwi-pos/shared` (to write trigger files)
- **Listens for:** `FORCE_UPDATE`, `KILL_SWITCH`, `FORCE_UPDATE_APK`, and other fleet commands from MC
- **Restart policy:** `unless-stopped`

---

## Dual Migration Scripts (CRITICAL)

Two scripts handle schema migrations across environments:

| Script | Environment | Uses |
|--------|-------------|------|
| `scripts/vercel-build.js` | Neon (cloud/dev) | Direct SQL via connection string |
| `scripts/nuc-pre-migrate.js` | NUC (production) | PrismaClient |

**Adding new migrations: MUST add to BOTH scripts.** Use idempotent checks (e.g., `IF NOT EXISTS`, `DO $$ ... END $$`).

**Problem solved:** Prisma `db push` fails on String->Enum cast. Fix: pre-flight SQL with `ALTER COLUMN TYPE ... USING cast`.

### Schema Migrations During Deploy

When gwi-node deploys a new image, it runs migrations inside a temporary container before starting the app:

```bash
docker run --rm --env-file /opt/gwi-pos/shared/.env --network=host $IMAGE_REF \
  node deploy-tools/src/migrate.js
```

This handles both local PG and (if `NEON_DATABASE_URL` is set) Neon migrations. The migration runs in a disposable container -- if it fails, the old containers continue running unchanged.

### Migration Safety Rules (updated 2026-03-14)

1. **Database only moves forward** -- NEVER roll back the database schema. Rollback = deploy previous app code only.
2. **No `--accept-data-loss`** -- Pre-start script uses `prisma db push` WITHOUT this flag. If the code's schema is older than the DB, Prisma blocks instead of dropping columns.
3. **Startup schema verification** -- `schema-verify.ts` checks critical tables/columns on boot. Missing elements are logged as CRITICAL errors.
4. **One-version compatibility** -- New migrations must be backward-compatible with N-1 code. Add columns as nullable, never rename or drop in the same release.
5. **Forward-only migrations** -- `scripts/migrations/NNN-*.js` have `up()` only, no `down()`. The tracking table (`_gwi_migrations`) prevents re-runs.

### P3005 Baseline (db-push -> migrate deploy transition)

NUCs originally provisioned with `prisma db push` have no `_prisma_migrations` table. When the installer switched to `prisma migrate deploy`, it fails with P3005 ("schema not empty"). The installer and sync agent handle this automatically:

1. `prisma migrate deploy` -> P3005 detected
2. Mark all existing migrations as applied via `prisma migrate resolve --applied`
3. Run `prisma db push` to create any tables the baselined migrations would have created
4. Future `migrate deploy` runs work normally (only applies new migrations)

**Important:** `nuc-pre-migrate.js` creates supplementary tables (BergDevice, PmsChargeAttempt, etc.) that make the schema "non-empty" even before core tables exist. The `db push` step after baselining is critical to create the core tables (Organization, Location, Order, etc.).

### Server .env Canonicalization

The installer canonicalizes critical .env values on every server re-run: `PORT=3005`, `NODE_ENV=production`, `STATION_ROLE=server`, `DB_NAME=thepasspos`, `DB_USER=thepasspos`. This fixes stale values from old installers (PORT=3000, DB_NAME=pulse_pos).

---

## CRITICAL: Never Run `sudo npm run build`

This rule still applies to any manual intervention on a NUC. Running build commands as root changes ownership of files to `root`, which can break subsequent container operations.

**Rule:** All manual build/debug commands on a NUC must run as the `gwipos` user, never as root. Normal deploys are handled entirely by gwi-node and Docker -- no manual builds needed.

---

## SSH Credentials

| Host | User | Password |
|------|------|----------|
| 172.16.20.50 (Shaunels) | gwipos | 123 |
| 192.168.0.232 (Zoya's) | gwipos | 123 |
| 172.16.1.60 (Monument) | gwipos | 123 |

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
- **Kiosk Exit Zone:** Hidden 64x64px div in top-left corner of every page
  - Tap 5 times in 3 seconds -> calls `POST /api/system/exit-kiosk`
  - Stops kiosk service + kills Chromium
  - No auth required (intentional -- admin must be able to exit without PIN)

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
| **gwi-pos** (source of truth) | `public/installer.run` | Canonical copy -- edit here first |
| **gwi-mission-control** | `scripts/installer.run` | Served to NUCs via `GET /installer.run` route |

**After any installer change:** edit gwi-pos -> copy to gwi-mission-control -> commit + push both repos -> wait for MC Vercel deploy.

---

## Self-Healing and Auto-Recovery

### gwi-node Self-Update

On every deploy, gwi-node extracts the latest `gwi-node.sh` from the target Docker image. If the script has changed (SHA comparison), it atomically replaces itself on disk and re-executes with the same arguments (plus `--skip-self-update` to prevent loops). This means the deploy agent is always current with the deployed image version.

### Host Watcher Bootstrap

After each successful deploy, `bootstrap_host_watcher()` ensures:
- `gwi-node.sh` on host matches the version in the image
- `gwi-node.service` unit file is current and enabled
- Trigger directories (`deploy-requests/`, `deploy-results/`) exist with correct permissions
- Legacy `thepasspos` and `thepasspos-sync` services remain masked
- The watcher service is running

### Auto-Rollback

If the new container fails health checks (30 attempts x 2s, need 3 consecutive 200s), gwi-node automatically:
1. Stops and removes the failed container
2. Captures diagnostics (docker ps, container logs, port listeners, systemd state)
3. Starts the previous image (stored in `/opt/gwi-pos/shared/state/previous-image.txt`)
4. Verifies rollback health
5. Writes deploy log with `finalStatus: "rolled_back"` or `"rollback_failed"`

### Stale Trigger Cleanup

In watch mode, gwi-node cleans up trigger files older than 30 minutes. These get a result file with `status: "FAILED"` and reason `"Trigger file exceeded 30m age limit"`.

### Dashboard .deb Auto-Update

During POS deploys, the update-agent checks for a new `gwi-dashboard.deb` in the repo and installs it automatically:

- The dashboard binary is included in the POS git repo
- After deploy, the agent runs `sudo dpkg -i gwi-dashboard.deb` if a newer version exists
- No separate deploy pipeline needed for the dashboard

### _venue_schema_state Self-Healing (3-Layer Protection)

The `_venue_schema_state` row in local PG is critical for schema version tracking. Three layers prevent it from going missing or stale:

1. **Installer fallback:** If the row doesn't exist after Stage 6 (schema), the installer creates a fallback row with the current schema version
2. **Bootstrap self-heal:** On every POS boot, if the row is missing or has a stale version, the bootstrap process re-creates it from the current Prisma schema
3. **5-minute periodic recheck:** A background timer verifies the row every 5 minutes and self-heals if needed

### Installer Auto-Reboot

After a full install (all stages complete), the installer automatically reboots the NUC to ensure all services start cleanly with the correct systemd configuration. This only triggers on fresh installs, not on `--resume-from` partial runs.

---

## Troubleshooting

### Primary Commands (v2.0.10)

```bash
# Container status
docker ps                                          # List running containers (expect gwi-pos + gwi-agent)
docker ps -a                                       # Include stopped containers
docker inspect gwi-pos --format '{{.Config.Image}}' # Current image tag

# Container logs
docker logs gwi-pos                                # POS app logs
docker logs gwi-pos --tail 100 -f                  # Follow last 100 lines
docker logs gwi-agent                              # Sync agent logs
docker logs gwi-agent --tail 100 -f

# gwi-node host service
journalctl -u gwi-node -f                         # Follow gwi-node watcher output
journalctl -u gwi-node --since "1 hour ago"       # Recent watcher activity
systemctl status gwi-node                          # Service state

# Deploy history
ls -lt /opt/gwi-pos/shared/logs/deploys/           # Deploy log files (JSON)
cat /opt/gwi-pos/shared/state/running-version.json # Current running version

# Trigger file inspection
ls /opt/gwi-pos/shared/state/deploy-requests/      # Pending triggers (should be empty normally)
ls /opt/gwi-pos/shared/state/deploy-results/       # Completed results

# Health check
curl -s http://localhost:3005/api/health/ready | python3 -m json.tool

# Manual deploy (emergency)
sudo /opt/gwi-pos/gwi-node.sh deploy              # Deploy latest from R2 manifest
sudo /opt/gwi-pos/gwi-node.sh deploy --image-ref ghcr.io/getwithitman/gwi-pos:v2.0.10  # Specific version
sudo /opt/gwi-pos/gwi-node.sh rollback            # Roll back to previous image
sudo /opt/gwi-pos/gwi-node.sh status              # Show running state

# Restart containers without redeploy
docker restart gwi-pos
docker restart gwi-agent
```

### Common Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| POS unreachable | `docker ps` -- is gwi-pos running? | `docker logs gwi-pos` for crash reason, then `sudo /opt/gwi-pos/gwi-node.sh deploy` |
| Deploy stuck | Check `ls /opt/gwi-pos/shared/state/deploy-requests/` | If stale trigger exists, delete it; check `cat /opt/gwi-pos/shared/state/gwi-node.lock` |
| Agent not listening | `docker ps` -- is gwi-agent running? | `docker logs gwi-agent`; restart: `docker restart gwi-agent` |
| Port 3005 occupied | `ss -tlnp "sport = :3005"` | gwi-node preflight handles this automatically; manual: kill the PID then redeploy |
| gwi-node.service not running | `systemctl status gwi-node` | `sudo systemctl start gwi-node` |
| Legacy services somehow active | `systemctl is-active thepasspos` | `sudo systemctl mask thepasspos thepasspos-sync` |

---

## Key Files

| File | Purpose |
|------|---------|
| `public/scripts/gwi-node.sh` | Host deploy agent (source of truth, deployed to `/opt/gwi-pos/gwi-node.sh`) |
| `public/scripts/gwi-node.service` | Systemd unit for watch mode |
| `public/sync-agent.js` | Sync agent / gwi-agent entrypoint (runs inside container) |
| `docker/Dockerfile` | POS + agent Docker image |
| `docker/docker-compose.prod.yml` | Production compose (reference for container config) |
| `scripts/vercel-build.js` | Neon migration script |
| `scripts/nuc-pre-migrate.js` | NUC migration script |
| `public/installer.run` | NUC provisioning orchestrator |
| `public/installer-modules/` | 11 installer stage modules |
| `src/components/KioskExitZone.tsx` | Kiosk exit tap zone |
| `src/app/api/system/exit-kiosk/route.ts` | Kiosk exit API (uses `kiosk-control.sh`) |

### Key Paths on a NUC

| Path | Purpose |
|------|---------|
| `/opt/gwi-pos/gwi-node.sh` | Deploy agent binary |
| `/opt/gwi-pos/shared/.env` | Environment file (mounted into containers) |
| `/opt/gwi-pos/shared/state/` | State dir (trigger files, deploy lock, running version) |
| `/opt/gwi-pos/shared/state/deploy-requests/` | Pending deploy trigger files (gwi-agent writes here) |
| `/opt/gwi-pos/shared/state/deploy-results/` | Completed deploy results (gwi-node writes here) |
| `/opt/gwi-pos/shared/state/running-version.json` | Current deployed version metadata |
| `/opt/gwi-pos/shared/state/previous-image.txt` | Previous Docker image ref (for rollback) |
| `/opt/gwi-pos/shared/state/gwi-node.lock` | Deploy lock file |
| `/opt/gwi-pos/shared/logs/deploys/` | Deploy log files (JSON, one per deploy) |
| `/opt/gwi-pos/state/` | App-writable state (container user uid 1001) |
| `/opt/gwi-pos/keys/` | RSA keypair for registration |
| `/opt/gwi-pos/backups/` | Daily PG backups |
| `/etc/systemd/system/gwi-node.service` | Systemd unit for gwi-node watcher |

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

### Troubleshooting Baseline
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
