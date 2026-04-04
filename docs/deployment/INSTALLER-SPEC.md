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
- Docker Engine (container runtime — the ONLY app runtime as of v2.0.0, current v2.0.10)
- gwi-node.sh (single deploy agent — manages Docker lifecycle)
- Chromium kiosk (full-screen browser)
- Daily backup cron job
- RealVNC (optional, for remote support)

**Systemd Services:**
- `gwi-node.service` — Host-level deploy agent. Runs `gwi-node.sh watch`, polling trigger directories for deploy requests from the gwi-agent container. Manages Docker lifecycle for both gwi-pos and gwi-agent containers.
- `thepasspos-kiosk` — Chromium in kiosk mode pointing to `http://localhost:3005`

**Docker Containers (managed by gwi-node.sh, not systemd):**
- `gwi-pos` — POS server on port 3005 (same Docker image as gwi-agent, different CMD)
- `gwi-agent` — Sync agent running `sync-agent.js` (SSE listener for MC fleet commands, writes trigger files for deploy requests)

**Port:** 3005 (configured unquoted in `.env` — systemd `EnvironmentFile` treats quoted values as literal)

**Runtime model:** Docker is the only runtime. There is no bare Node.js process, no tarball path, no mode markers. The legacy `thepasspos.service` and `thepasspos-sync.service` systemd units are masked by the installer and will never start.

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
        │    ├─ Install Docker Engine (if not present)
        │    ├─ Copy gwi-node.sh to /opt/gwi-pos/gwi-node.sh
        │    ├─ Stage 05: `gwi-node.sh install`
        │    │    → Pulls Docker image from Cloudflare R2
        │    │    → Runs deploy-tools (migrate.js + apply-schema.js) inside container
        │    │    → Starts gwi-pos container on port 3005
        │    │    → Starts gwi-agent container (sync-agent.js)
        │    │    → Stops/disables legacy thepasspos.service
        │    ├─ Create thepasspos-kiosk.service (→ localhost:3005)
        │    ├─ Stage 07: Install gwi-node.service + trigger dirs
        │    │    → Copies gwi-node.sh + gwi-node.service to host
        │    │    → Creates deploy-requests/ and deploy-results/ dirs
        │    │    → Masks legacy services (thepasspos, thepasspos-sync)
        │    │    → Starts gwi-node.service (watch mode)
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
        ├─ Stage 11: System Hardening (Ansible Baseline Enforcement)
        │   ├─ Bootstrap Ansible venv in /opt/gwi-pos/.ansible-venv/
        │   ├─ Acquire flock on /opt/gwi-pos/state/baseline.lock
        │   ├─ Run 16 Ansible roles (ANSIBLE_STDOUT_CALLBACK=json)
        │   ├─ Write structured state artifacts to /opt/gwi-pos/state/
        │   ├─ Install support tools to /opt/gwi-pos/bin/
        │   └─ Non-fatal during Phase A rollout (track_warn on failure)
        │
        └─ Summary + useful commands
```

## File Layout on NUC

```
/opt/gwi-pos/
├── .env                    # Environment variables (chmod 600, unquoted values)
├── gwi-node.sh             # Single deploy agent (v2.0.10) — install/deploy/status/watch
├── backup-pos.sh           # Daily PostgreSQL backup script (server only)
├── heartbeat.sh            # 60s HMAC-signed metrics to Mission Control (server only)
├── sync-agent.js           # SSE listener for cloud commands (runs inside gwi-agent container, writes trigger files)
├── kiosk-control.sh        # Stops kiosk service + kills Chromium (sudoers-allowed)
├── wait-for-pos.sh         # Waits for POS health endpoint before starting kiosk
├── clear-kiosk-session.sh  # Clears stale Chromium session data
├── exit-kiosk-server.py    # Terminal-only: localhost:3006 kiosk exit micro-service
├── shared/                 # Shared state between host and containers (bind-mounted)
│   ├── .env                    # Environment file (copied from /opt/gwi-pos/.env)
│   ├── state/
│   │   ├── deploy-requests/    # Trigger files: gwi-agent writes, gwi-node reads (chmod 777)
│   │   ├── deploy-results/     # Outcome files: gwi-node writes, gwi-agent reads (chmod 755)
│   │   ├── running-version.json # Current deployed image tag + digest
│   │   └── gwi-node.lock       # Deploy mutex
│   └── logs/
│       └── deploys/            # Per-deploy JSON logs
├── backups/                # pg_dump .sql.gz files (7-day retention)
│   └── baseline-snapshot-*.tar.gz  # Config snapshots before reboot (last 3 kept)
├── keys/                   # RSA keypair (server_key.pem, server_key_pub.pem)
├── .ansible-venv/          # Pinned Ansible virtual environment (ansible-core 2.16.4)
├── bin/                    # Support tools (installed by Stage 11)
│   ├── generate-support-bundle.sh  # Packages state JSONs + redacted logs into tarball
│   ├── baseline-diff               # Compares observed state vs manifest (human + --json)
│   └── gwi-baseline-restore.sh     # Restores selected configs from baseline snapshot
├── state/                  # Structured local state artifacts (all JSON, schema-versioned)
│   ├── run-state.json              # Current execution state + lock metadata
│   ├── stage11-result.json         # Last baseline run outcome + per-role results
│   ├── baseline-applied.json       # Baseline version + roles applied
│   ├── policy-applied.json         # Policy version + source + contents
│   ├── ansible-result.json         # Raw Ansible JSON callback output (last run only)
│   ├── ansible-stderr.log          # Ansible stderr (last run only)
│   ├── artifact-manifest.json      # App SHA, baseline SHA, package versions
│   ├── hardening-status.json       # Per-check pass/fail from verify-health.sh
│   ├── inventory.json              # USB, printers, touchscreen, OS, services
│   ├── drift-scan.json             # Drift items + config checksums (30min timer)
│   ├── sync-status.json            # Sync readiness + schema block state
│   ├── install-events.jsonl        # Append-only event log (one JSON object per line)
│   ├── baseline.lock               # flock target (not JSON, just an fd target)
│   └── report-queue/               # Queued reports for offline retry (max 50 / 10MB / 7d)
└── app/                    # GWI POS application (server role only)
    ├── .env.local          # Symlink to /opt/gwi-pos/.env
    ├── server.js           # Compiled server (from server.ts)
    ├── preload.js          # AsyncLocalStorage polyfill
    ├── .next/              # Next.js build output
    ├── prisma/             # Prisma schema + migrations
    ├── installer/          # Ansible project (pulled with app code)
    │   ├── VERSION                     # e.g., baseline-2026.03.20.1
    │   ├── site.yml                    # Master playbook (16 roles)
    │   ├── ansible.cfg                 # Local execution, JSON output, no retry files
    │   ├── inventory/local.yml         # Localhost-only inventory
    │   ├── group_vars/all.yml          # Shared variables
    │   ├── manifests/                  # Device expectation manifests
    │   │   ├── server.json
    │   │   ├── backup.json
    │   │   └── terminal.json
    │   ├── roles/                      # 16 Ansible roles
    │   │   ├── os_hardening/
    │   │   ├── firewall/
    │   │   ├── display_manager/
    │   │   ├── sshd_hardening/
    │   │   ├── network_hardening/
    │   │   ├── kiosk_hardening/
    │   │   ├── log_rotation/
    │   │   ├── security_updates/
    │   │   ├── thermal_printer/
    │   │   ├── touchscreen/
    │   │   ├── usb_devices/
    │   │   ├── branding/
    │   │   ├── node_inventory/
    │   │   ├── post_reboot_verify/
    │   │   ├── mc_phone_home/
    │   │   └── reboot_manager/
    │   └── assets/plymouth/gwi-pos/    # Plymouth boot theme assets
    └── ...
```

## Systemd Services

### gwi-node.service (Server only, v2.0.10)

The host-level deploy agent. Runs `gwi-node.sh watch` which polls the trigger directory (`shared/state/deploy-requests/`) for deploy requests written by the gwi-agent container. When a trigger file appears, gwi-node executes the deploy: pulls the Docker image, runs migrations, swaps the container, and writes the result to `shared/state/deploy-results/`.

This is the **only** systemd service for the POS application stack. Both the `gwi-pos` and `gwi-agent` Docker containers are managed by gwi-node.sh, not by individual systemd units.

```bash
# gwi-node manages all Docker containers
gwi-node.sh deploy    # Pull image, migrate, swap containers
gwi-node.sh status    # Show running containers, image tag, uptime
gwi-node.sh watch     # Poll trigger dir (this is what gwi-node.service runs)

# Container logs
docker logs gwi-pos       # POS server logs
docker logs gwi-agent     # Sync agent logs
docker ps                 # Check running containers
```

**Trigger-file deploy protocol:** The gwi-agent container (running sync-agent.js) receives fleet commands from Mission Control via SSE. When a FORCE_UPDATE command arrives, gwi-agent writes a JSON trigger file to `shared/state/deploy-requests/`. gwi-node.service (on the host) detects the file, executes the deploy, and writes the outcome to `shared/state/deploy-results/`. The agent reads the result and ACKs back to MC. This container-signals-host-executes pattern avoids giving the container Docker socket access.

**Legacy services:** `thepasspos.service` (bare Node.js process) and `thepasspos-sync.service` (bare Node.js sync agent) are masked by Stage 07. They will never start, even after reboot. Docker containers are the only runtime.

### thepasspos-kiosk.service (Both roles)

```ini
[Unit]
Description=GWI POS Kiosk
After=graphical.target

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
5. Calls `gwi-node deploy` (pulls latest Docker image, runs migrations, swaps gwi-pos + gwi-agent containers)
6. Refreshes gwi-node.service, kiosk service, and trigger directories
7. Masks legacy services, restarts gwi-node.service and kiosk

### Terminal Re-run
1. Overwrites kiosk service with new URL
2. Restarts kiosk

### Factory Reset

```bash
docker stop gwi-pos gwi-agent 2>/dev/null; docker rm gwi-pos gwi-agent 2>/dev/null
sudo systemctl stop gwi-node thepasspos-kiosk thepasspos-exit-kiosk 2>/dev/null
sudo systemctl disable gwi-node 2>/dev/null
sudo rm -rf /opt/gwi-pos
sudo rm -f /etc/systemd/system/gwi-node.service /etc/systemd/system/thepasspos-kiosk.service /etc/systemd/system/thepasspos-exit-kiosk.service
sudo rm -f /etc/sudoers.d/gwi-pos
sudo systemctl daemon-reload
docker image prune -af  # Remove cached images
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
# gwi-node (single deploy agent on host)
gwi-node.sh deploy                     # Pull latest image, migrate, swap containers
gwi-node.sh status                     # Show running containers, image tag, uptime
gwi-node.sh watch                      # Poll trigger dirs (what gwi-node.service runs)

# Docker container management
docker ps                              # Check running containers (gwi-pos + gwi-agent)
docker logs gwi-pos                    # Tail POS server logs
docker logs gwi-pos --tail 100 -f      # Follow last 100 lines
docker logs gwi-agent                  # Tail sync agent logs
docker logs gwi-agent --tail 100 -f    # Follow sync agent logs

# gwi-node.service (host watcher)
sudo systemctl status gwi-node             # Check host deploy watcher
sudo journalctl -u gwi-node -f            # Tail gwi-node logs

# Kiosk service
sudo systemctl status thepasspos-kiosk     # Check kiosk
sudo journalctl -u thepasspos-kiosk -f     # Tail kiosk logs

# Manual restart
gwi-node.sh deploy                     # Redeploy (same image = restart both containers)
sudo systemctl restart thepasspos-kiosk

# Trigger directory inspection
ls -la /opt/gwi-pos/shared/state/deploy-requests/   # Pending deploy requests
ls -la /opt/gwi-pos/shared/state/deploy-results/     # Deploy outcomes

# Manual backup
sudo -u <posuser> /opt/gwi-pos/backup-pos.sh

# List backups
ls -lh /opt/gwi-pos/backups/

# Re-run installer (update)
sudo bash /opt/gwi-pos/installer.run
```

## Troubleshooting

### Container won't start

```bash
# Check container status and recent logs
docker ps -a                                     # See all containers (including stopped)
docker logs gwi-pos --tail 50                    # Last 50 lines of POS logs
docker inspect gwi-pos | jq '.[0].State'         # Container state details

# Check if port 3005 is in use by something else
ss -tlnp | grep 3005

# Force redeploy (pulls image again)
gwi-node.sh deploy --force
```

### Deploy stuck or failed

```bash
# Check deploy logs
ls -lt /opt/gwi-pos/shared/logs/deploys/         # List deploy logs by time
cat /opt/gwi-pos/shared/logs/deploys/<latest>.json | jq .

# Check for stale lock
cat /opt/gwi-pos/shared/state/gwi-node.lock

# Check gwi-node.service is running
sudo systemctl status gwi-node
sudo journalctl -u gwi-node --since "10 min ago"
```

### Sync agent not connecting to MC

```bash
# Check gwi-agent container
docker logs gwi-agent --tail 50
docker ps | grep gwi-agent                       # Is it running?

# Check trigger file flow
ls -la /opt/gwi-pos/shared/state/deploy-requests/
ls -la /opt/gwi-pos/shared/state/deploy-results/
```

### Legacy services still running (should be masked)

```bash
# Verify legacy services are masked
systemctl is-enabled thepasspos 2>/dev/null       # Should be "masked"
systemctl is-enabled thepasspos-sync 2>/dev/null  # Should be "masked"

# If not masked, re-run Stage 07 or mask manually
sudo systemctl stop thepasspos thepasspos-sync 2>/dev/null
sudo systemctl disable thepasspos thepasspos-sync 2>/dev/null
sudo systemctl mask thepasspos thepasspos-sync 2>/dev/null
```

## Verification Checklist

| # | Test | How to Verify |
|---|------|---------------|
| 1 | Fresh server install | Run on clean Ubuntu 22.04 → POS at `http://localhost:3005` |
| 2 | Fresh terminal install | Run on second NUC → Chromium opens pointing at server |
| 3 | Idempotent re-run | Run installer again → DB backed up, code updated, no data loss |
| 4 | Offline operation | Disconnect network after install → POS works with local Postgres |
| 5 | RealVNC | NUC appears in RealVNC account |
| 6 | Service recovery | `sudo reboot` → gwi-node.service starts, containers come up, kiosk opens |
| 7 | Backup rotation | Check `/opt/gwi-pos/backups/` for daily .sql.gz, 7-day retention |
| 8 | MC registration | POST with valid code → 200; POST with bad code → 400/401 |
| 9 | Docker containers running | `docker ps` shows both `gwi-pos` and `gwi-agent` containers healthy |
| 10 | gwi-node.service active | `systemctl is-active gwi-node` → `active` |
| 11 | Legacy services masked | `systemctl is-enabled thepasspos` and `thepasspos-sync` → `masked` |
| 12 | Trigger dirs exist | `ls /opt/gwi-pos/shared/state/deploy-requests/` and `deploy-results/` exist |
| 13 | MC-triggered deploy | MC sends FORCE_UPDATE → trigger file written → deploy executes → ACK |
| 14 | Stage 11 baseline | `cat /opt/gwi-pos/state/stage11-result.json` → outcome not `failed_required` |
| 15 | Stage 11 idempotency | Re-run Stage 11 → `changed_count: 0` for non-observational roles |
| 16 | Stage 11 reboot recovery | Pending reboot persisted, reboots once, verify fires, lock not stranded |
| 17 | Stage 11 offline | MC unreachable → baseline runs, reports queue, support bundle works |
| 18 | Drift detection | Manual config change → `baseline-diff` detects and classifies correctly |
| 19 | Support bundle | `generate-support-bundle.sh` → tarball with redacted secrets, valid manifest |

---

## Stage 11: System Hardening (Ansible Baseline Enforcement)

### Purpose

Stage 11 adds idempotent OS hardening, device configuration, branding, post-reboot verification, and drift detection to every NUC. It runs after all existing stages (1-10) complete and uses Ansible to enforce a baseline configuration that can be re-applied safely at any time.

The system is designed around three principles:
1. **Machine-readable** — All output uses `ANSIBLE_STDOUT_CALLBACK=json`. No logic depends on parsing human log text.
2. **Idempotent** — Second run produces zero meaningful changes unless the machine actually drifted.
3. **Offline-safe** — MC being unreachable never bricks the node. Reports queue locally with bounded backoff.

### Entry Point

**Function:** `run_system_hardening()` in `public/installer-modules/11-system-hardening.sh`

**Module contract:** Same as stages 1-10 — single `run_*()` entry function, returns 0 on success, non-zero on failure. The orchestrator (`installer.run`) calls it as the last stage.

### Prerequisites

- Stages 1-10 completed successfully
- Python 3.8+ available (Ubuntu 22.04/24.04 ship with it)
- Ansible bootstrapped in `/opt/gwi-pos/.ansible-venv/` — the wrapper creates a Python venv and installs `ansible-core==2.16.4` (pinned) on first run; subsequent runs reuse the existing venv

### Execution Flow

```
run_system_hardening()
    │
    ├─ Bootstrap Ansible venv (if not present)
    │   python3 -m venv /opt/gwi-pos/.ansible-venv/
    │   pip install ansible-core==2.16.4
    │
    ├─ Scaffold /opt/gwi-pos/state/ directory
    │
    ├─ Acquire execution lock
    │   flock -w 300 /opt/gwi-pos/state/baseline.lock
    │   (wait up to 5 minutes, then fail)
    │
    ├─ Write run-state.json (state: running, triggered_by: installer)
    │
    ├─ Resolve tag filters
    │   HARDENING_TAGS env → --tags (run only these roles)
    │   SKIP_HARDENING_TAGS env → --skip-tags (skip these roles)
    │
    ├─ Execute Ansible playbook
    │   ANSIBLE_STDOUT_CALLBACK=json \
    │     ansible-playbook -i inventory/local.yml site.yml \
    │     --extra-vars "gwi_station_role=server gwi_posuser=..." \
    │     > state/ansible-result.json 2> state/ansible-stderr.log
    │
    ├─ Parse ansible-result.json
    │   Classify per-role outcomes (ok/changed/failed/skipped)
    │   Determine overall outcome based on role classification
    │
    ├─ Write stage11-result.json
    │   outcome: success | success_with_warnings | failed_required | failed_optional
    │   per_role_results: [{ role, class, status, changed_count }]
    │
    ├─ Append to install-events.jsonl
    │
    ├─ Install support tools → /opt/gwi-pos/bin/
    │
    └─ Return exit code
        Phase A: track_warn on failure (non-fatal)
        Future: fail-closed for required roles after rollout stabilizes
```

### Phase A Rollout Protection

During Phase A (initial rollout to fleet), Stage 11 failures are **non-fatal** — the wrapper calls `track_warn` rather than returning non-zero. This prevents a hardening bug from bricking production NUCs. However, failures are still fully recorded:

- `stage11-result.json` reports the real classified outcome (e.g., `failed_required`)
- `install-events.jsonl` gets an append entry
- `run-state.json` transitions to `degraded`
- Heartbeat carries the degraded state to MC

After 3+ venues and 2+ weeks of stable operation, required roles are promoted to fail-closed (non-zero exit halts the installer).

### Tag Filtering

Operators can scope which roles run using environment variables:

```bash
# Run only firewall and os_hardening roles
HARDENING_TAGS=firewall,os_hardening sudo ./installer.run --resume-from=system_hardening

# Run everything except security_updates
SKIP_HARDENING_TAGS=security_updates sudo ./installer.run --resume-from=system_hardening
```

Tags map to the Ansible tags assigned in `site.yml`: `required`, `optional`, `hardware`, plus each role name as an implicit tag.

---

## Ansible Roles (16 Total)

Roles execute in the order listed in `installer/site.yml`. Each role is idempotent and must converge cleanly on second run.

### Role Classification

| Class | Failure Behavior | "Applicable" Source |
|-------|-----------------|---------------------|
| required | Fail-closed (after Phase A rollout stabilizes) | Always applicable |
| required_if_applicable | Fail if manifest says expected, skip if not | `installer/manifests/*.json` |
| optional | Warn only | N/A |

### Required Roles

| Role | Purpose |
|------|---------|
| `os_hardening` | Mask sleep/suspend/hibernate targets, disable automatic suspend, configure kernel parameters. Supports both KDE (logind.conf.d) and GNOME (gsettings). |
| `firewall` | Configure UFW: allow SSH (22), POS (3005), kiosk exit (3006), HA (VRRP/112). Deny everything else by default. HA-aware and role-aware (terminal rules differ from server). |
| `display_manager` | Configure autologin for POS user on SDDM (KDE) or GDM3 (GNOME). Force X11 session type (Wayland causes touchscreen/kiosk issues). Detect desktop environment at runtime. |
| `sshd_hardening` | Disable root login, disable password auth (key-only), install and configure fail2ban with sane defaults. Drop config in `/etc/ssh/sshd_config.d/`. |
| `post_reboot_verify` | Post-reboot health check: verify 3-tier service readiness (critical/degraded/informational), clock health via chronyc, baseline state persistence. Writes `hardening-status.json`. |
| `reboot_manager` | Conditional reboot controller. Maximum 1 reboot per baseline run, 60-second grace period (`shutdown -r +1`). Snapshots config before reboot. Venue-hours-aware: checks local `/api/system/batch-status` — proceeds only if no active orders in 30 minutes, otherwise defers (max 3 attempts, then queues for MC approval). Must be the last role in site.yml. |

### Hardware Roles (required_if_applicable)

These roles check the device expectation manifest (`installer/manifests/server.json` or `terminal.json`). If the manifest says a device is expected but the device is missing, the role **fails** (not skips). If the manifest says the device is optional or absent, the role skips cleanly.

| Role | Purpose |
|------|---------|
| `thermal_printer` | Configure CUPS and udev rules for Epson TM-T20III/T88V/T88VI/TM-m30III (vendor 04b8). Server only (`when: gwi_station_role != 'terminal'`). |
| `touchscreen` | Configure libinput for touch input, disable right-click-on-hold, set up on-screen keyboard. Handles eGalax/eGTouch (vendor 0eef) specifically. |
| `usb_devices` | Configure udev rules for card readers (ID Tech VP3300/VP3350, vendor 0acd) and CAS PDN scales (FTDI 0403, Prolific 067b). Server only. |

### Optional Roles

| Role | Purpose |
|------|---------|
| `network_hardening` | Configure chrony (NTP), disable IPv6 if not needed, harden DNS settings. Reports clock health status (`CLOCK_UNSYNCED`, `TIME_SOURCE_UNHEALTHY`). |
| `kiosk_hardening` | Disable ALT+F4, hide taskbar, disable USB auto-mount in desktop environment. Prevents accidental kiosk escape. |
| `log_rotation` | Configure logrotate for POS logs + journald persistent storage with size limits. Ensures journal survives reboot for diagnostics. |
| `security_updates` | Configure unattended-upgrades for security patches only. Conservative policy — security updates only, no feature upgrades. |
| `branding` | Apply Plymouth boot theme, desktop wallpaper, legal/consent banner (MOTD + `/etc/issue.net`). Uses placeholder assets from `installer/assets/plymouth/gwi-pos/`. |
| `node_inventory` | Collect hardware inventory (USB devices, printers, touchscreens, OS version, services) and clock health. Writes `inventory.json`. Observational — always produces `changed` timestamps (does not fail idempotency). |
| `mc_phone_home` | Report baseline status, drift results, and install events to Mission Control via heartbeat piggyback. Manages offline report queue under `state/report-queue/` with bounded retry (60s, 120s, 240s... max 1h). Enforces queue limits: 50 files, 10 MB, 7-day retention. Server only. |

---

## Local State Files

All files live under `/opt/gwi-pos/state/`. Every JSON file includes a standard header:

```json
{
  "schema_version": "1.0",
  "producer": "<service-or-script-name>",
  "generated_at": "<ISO8601>",
  "node_id": "<from .env SERVER_NODE_ID>",
  "baseline_version": "<from installer/VERSION>"
}
```

| File | Producer | Purpose |
|------|----------|---------|
| `run-state.json` | Stage 11 wrapper | Current execution state (`idle`, `running`, `degraded`, `pending_reboot`), lock PID, `triggered_by` (`installer`, `mc`, `support`, `verify`, `cron`), `host_boot_id` |
| `stage11-result.json` | Stage 11 wrapper | Last run outcome (`success`, `success_with_warnings`, `failed_required`, `failed_optional`), Ansible exit code, per-role results with classification, `triggered_by` |
| `baseline-applied.json` | Ansible post_tasks | Baseline version, list of roles applied, `last_known_good_at` timestamp |
| `policy-applied.json` | Stage 11 wrapper | Policy version, `policy_source` (`manifest`, `bootstrap-auto`, `mission-control`), policy contents |
| `ansible-result.json` | Stage 11 wrapper | Raw Ansible JSON callback output. Last run only (overwritten each run). History lives in `install-events.jsonl`. |
| `ansible-stderr.log` | Stage 11 wrapper | Ansible stderr capture. Last run only (overwritten each run). |
| `artifact-manifest.json` | Stage 11 post-run | App commit SHA, baseline version + SHA, ansible-core version, key package versions (postgresql, nodejs, chromium) |
| `hardening-status.json` | verify-health.sh | Per-check pass/fail results, 3-tier service health (critical/degraded/informational), clock health |
| `inventory.json` | node_inventory role | USB devices, printers, touchscreen, OS version, systemd services |
| `drift-scan.json` | Drift scanner timer (30min) | Drift items, config file checksums, clock health, comparison against manifest/policy |
| `sync-status.json` | venue-bootstrap (POS app) | Sync readiness, schema block state, retry count. Read by verify-health.sh and heartbeat.sh |
| `install-events.jsonl` | Stage 11 wrapper | Append-only event log. Each line is one independent JSON object. Entries include `triggered_by` and event type |
| `baseline.lock` | flock | Lock target file (not JSON). Used by `flock -w 300` for mutual exclusion across all baseline entrypoints |
| `report-queue/*.json` | mc_phone_home | Queued reports for offline retry. Max 50 files, 10 MB total, 7-day retention. Pruned entries logged to `install-events.jsonl` |

---

## Execution Lock

All baseline execution entrypoints share a single lock to prevent concurrent runs:

- **Lock file:** `/opt/gwi-pos/state/baseline.lock` (used by `flock`, not a JSON file)
- **Lock metadata:** Stored in `run-state.json` (PID, `started_at`, `triggered_by`)
- **Acquisition:** `flock -w 300` — wait up to 5 minutes, then fail
- **Entrypoints sharing the lock:** Installer Stage 11, MC-triggered re-baseline, support-invoked run, scheduled audit
- **Stale lock:** Warn after 15 minutes, stale after 60 minutes (PID dead or age exceeded)
- **Force unlock:** Explicit `baseline-force-unlock` command + audit log entry
- **Reboot:** Kernel releases the fd, so reboot clears the lock automatically

**Run-state machine:**
```
idle → running → success → idle
              → success_with_warnings → idle
              → failed_required → degraded
              → pending_reboot → (reboot) → running_verify → idle | degraded
```

---

## Support Tools

Installed to `/opt/gwi-pos/bin/` by Stage 11.

### generate-support-bundle.sh

Packages all state JSONs, journal excerpts (10,000 lines max), service statuses, `ufw status verbose`, `chronyc tracking`, `lsusb -v`, `lsblk -f`, `dmesg | tail -200`, `ip addr`, and a redacted `.env` into a single tarball.

**Output:** `support-bundle-YYYYMMDD-HHMMSS.tar.gz`

**Redaction rules:**
- Redact all `.env` values matching `SECRET|TOKEN|PASSWORD|PRIVATE|KEY|API_KEY`
- Redact bearer tokens and JWTs in logs
- Hash hardware fingerprint for external sharing
- Never include database dumps

The tarball includes a top-level `bundle-manifest.json` listing all included files, truncated logs, redaction status, and tool version.

```bash
sudo /opt/gwi-pos/bin/generate-support-bundle.sh
# → /opt/gwi-pos/support-bundle-20260320-143022.tar.gz
```

### baseline-diff

Compares observed node state against the device expectation manifest. Produces human-readable output by default, or structured JSON with `--json`.

```bash
sudo /opt/gwi-pos/bin/baseline-diff
# DRIFT DETECTED (2 items):
#   [ERROR] FIREWALL_DISABLED — ufw is inactive
#     FIX: sudo ./installer.run --resume-from=system_hardening HARDENING_TAGS=firewall
#   [WARN]  PRINTER_MISSING — manifest expects 1 Epson TM, found 0
#     FIX: check USB connection, then re-run thermal_printer role

sudo /opt/gwi-pos/bin/baseline-diff --json
# → structured JSON with drift items, severity, remediation suggestions
```

### gwi-baseline-restore.sh

Restores selected config files from the most recent baseline snapshot (`/opt/gwi-pos/backups/baseline-snapshot-*.tar.gz`). This is **config file restore only** — it does not roll back packages, kernels, apt state, or database state. For emergency recovery use.

```bash
sudo /opt/gwi-pos/bin/gwi-baseline-restore.sh
# Lists available snapshots and prompts for selection
```

---

## Reinstall / Recovery Behavior

### Core Rule

On install, reinstall, and boot, the node converges to the **latest approved app release for its rollout channel** and the compatible schema state required by that release. The installer never hardcodes schema versions or deployment tags.

### What Reinstall Preserves

| Preserved | Location |
|-----------|----------|
| Node identity + secrets | `/opt/gwi-pos/.env` |
| RSA keypair | `/opt/gwi-pos/keys/` |
| PostgreSQL data | Local database |
| Baseline + policy state | `/opt/gwi-pos/state/` |
| Backups + config snapshots | `/opt/gwi-pos/backups/` |
| MC registration | `SERVER_NODE_ID`, `API_KEY` in `.env` |
| Rollout channel | `ROLLOUT_CHANNEL` in `.env` |

### What Reinstall Re-applies

- App deployment via `gwi-node deploy` (pulls Docker image for approved version, starts gwi-pos + gwi-agent containers)
- Schema migrations (deploy-tools inside container: `migrate.js` + `apply-schema.js`)
- All 16 Ansible baseline roles (idempotent — only changes what drifted)
- gwi-node.service, trigger directories, legacy service masking (`07-services.sh` recreates idempotently)
- Kiosk service file (`07-services.sh`)
- Support tools (`bin/*`)

### Safety Guarantees

- **Idempotent:** Re-running on an already-provisioned node is safe
- **No silent downgrade:** App, schema, and baseline versions are never silently downgraded
- **Degraded visibility:** If app version and schema are incompatible after deploy, a visible degraded state is produced in `stage11-result.json` and reported to MC
- **No hardcoded versions:** Desired app version comes from rollout policy. Schema version comes from the app release. Baseline version comes from `installer/VERSION`.

### Legacy NUC Migration

Existing NUCs deployed before baseline enforcement receive a bootstrap-auto policy on first Stage 11 run:

1. Detect: no `state/policy-applied.json` but `.env` has `SERVER_NODE_ID` (already provisioned)
2. Collect current observed state via inventory collector
3. Write observed state as `policy-applied.json` with `policy_version: "bootstrap-auto"`, `policy_source: "bootstrap-auto"`
4. MC treats `bootstrap-auto` as "initial baseline adopted, not drifted"
5. Once MC pushes a real policy version, `bootstrap-auto` is never re-created automatically

---

## Stage 11 Verification Commands

After Stage 11 runs, use these commands to verify correct operation:

```bash
# --- Overall result ---
cat /opt/gwi-pos/state/stage11-result.json | jq '.outcome'
# Expected: "success" or "success_with_warnings"

cat /opt/gwi-pos/state/run-state.json | jq '.state'
# Expected: "idle" (or "degraded" if required roles failed)

# --- Sleep targets masked ---
systemctl is-enabled sleep.target suspend.target hibernate.target
# Expected: all "masked"

# --- Firewall active ---
sudo ufw status verbose
# Expected: Status: active, default deny incoming, allow 22/3005/3006

# --- Autologin configured ---
# KDE (SDDM):
cat /etc/sddm.conf.d/gwi-autologin.conf
# GNOME (GDM3):
grep -A5 '\[daemon\]' /etc/gdm3/custom.conf

# --- X11 session (not Wayland) ---
echo $XDG_SESSION_TYPE
# Expected: "x11"

# --- SSH hardened ---
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication'
# Expected: permitrootlogin no, passwordauthentication no
sudo systemctl is-active fail2ban
# Expected: active

# --- USB udev rules ---
ls /etc/udev/rules.d/99-*.rules
# Expected: rules for thermal printer, card reader, scale (server role)

# --- Log rotation ---
ls /etc/logrotate.d/gwi-pos
# Expected: exists

journalctl --disk-usage
# Expected: within configured limits

# --- Ansible venv ---
/opt/gwi-pos/.ansible-venv/bin/ansible --version
# Expected: ansible-core 2.16.4

# --- Baseline applied ---
cat /opt/gwi-pos/state/baseline-applied.json | jq '.baseline_version'
# Expected: matches installer/VERSION

# --- Drift scan ---
sudo /opt/gwi-pos/bin/baseline-diff
# Expected: "NO DRIFT DETECTED" (or known acceptable items)

# --- Support bundle ---
sudo /opt/gwi-pos/bin/generate-support-bundle.sh
ls -lh /opt/gwi-pos/support-bundle-*.tar.gz
# Expected: tarball created, reasonable size

# --- Clock health ---
chronyc tracking
# Expected: "Leap status: Normal"

# --- Install event history ---
tail -5 /opt/gwi-pos/state/install-events.jsonl | jq .
# Expected: structured JSON entries with event type and triggered_by
```
