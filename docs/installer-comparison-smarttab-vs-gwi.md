# Installer Comparison: SmartTab vs GWI POS

Analysis from live observation of SmartTab installer on NUC 172.16.1.60 (2026-03-23) compared against GWI POS installer codebase.

---

## Architecture Comparison

| Aspect | SmartTab | GWI POS |
|--------|----------|---------|
| **Delivery** | Self-extracting `installer.run` (55MB) with bundled JRE | Self-extracting `installer.run` with embedded stage modules |
| **Orchestration** | JavaFX GUI app + bash scripts + Ansible | Pure bash orchestrator + 12 modular stages |
| **Provisioning** | Ansible playbooks (per Ubuntu version) | Bash stages + Ansible baseline (Stage 11) |
| **Station roles** | Single role (all NUCs identical) | 3 roles: server, backup, terminal |
| **Resumability** | None (re-runs everything) | `--resume-from=STAGE` flag |
| **Error handling** | Crash-loop (launcher restarts on failure) | Hard stop on failure, manual resume |
| **Self-update** | Built-in (launcher polls S3 for new versions) | Sync agent receives deploy commands from MC |
| **Cloud registration** | Pre-configured in launcher SQLite | Interactive MC registration with RSA key exchange |
| **POS app type** | JavaFX desktop app (SmartTAB.jar) | Next.js web app (node server.js) |
| **Database** | None local (cloud API only) | PostgreSQL 17 local + Neon cloud sync |
| **HA/Failover** | None | keepalived + PG streaming replication + VIP |

---

## Feature-by-Feature Comparison

### System Provisioning

| Feature | SmartTab | GWI POS | Winner |
|---------|----------|---------|--------|
| **OS branding** | Plymouth boot splash, KDE wallpaper, splash screen, login screen | Branding role (wallpaper, logos) via Ansible | SmartTab (more thorough) |
| **Auto-login** | SDDM autologin config | GDM3/SDDM auto-login via display_manager role | Tie |
| **Sleep/hibernate** | Masks systemd targets + PowerDevil | Kiosk hardening role disables suspend/shutdown | Tie |
| **Screen lock** | Disables autolock, timeout=0, no lock on resume | Handled by kiosk hardening | Tie |
| **Session restore** | Disables KDE session restore | N/A (web app, not applicable) | N/A |
| **Notifications** | Removes 9 notification packages + disables knotify actions | Not explicitly handled | SmartTab |
| **Desktop environment** | Forces KDE Plasma (removes kubuntu-desktop, installs kde-plasma-desktop) | Detects existing DE (SDDM vs GDM3), doesn't force change | Different approach |

### Security

| Feature | SmartTab | GWI POS | Winner |
|---------|----------|---------|--------|
| **Sudo policy** | `NOPASSWD: ALL` for entire sudo group | Whitelisted commands only via sudoers.d | **GWI** (much safer) |
| **SSH hardening** | None | sshd_hardening role (key-only auth, cipher selection) | **GWI** |
| **Firewall** | None | ufw/firewalld with explicit port rules | **GWI** |
| **Network hardening** | None | IPv6 disable, SYN cookies, IP spoofing prevention | **GWI** |
| **USB device policy** | `MODE="0666"` on ALL USB devices (world-writable) | USB mount restrictions + device whitelisting | **GWI** (much safer) |
| **Secrets management** | Auth key in plaintext CLI args, visible in `ps aux` | .env file (root:posuser 640), RSA key exchange, encrypted DB URLs | **GWI** |
| **Download verification** | No checksum verification on any downloads | GPG-signed repos (NodeSource, PGDG) | **GWI** |
| **Auto-updates (security)** | None | unattended-upgrades for security patches | **GWI** |
| **Kernel hardening** | None | os_hardening role (sysctl tuning) | **GWI** |
| **Kiosk lockdown** | None (JavaFX app, not browser) | Alt-F4 prevention, xbindkeys, no dev tools | **GWI** |
| **Encryption at rest** | None | AES-256-CBC encrypted backups with PBKDF2 | **GWI** |
| **Service user isolation** | Runs as normal user (gwipos) | Dedicated POSUSER, non-root, whitelisted sudo | **GWI** |

### Hardware Support

| Hardware | SmartTab | GWI POS | Notes |
|----------|----------|---------|-------|
| **Touchscreen** | eGalax USB (eGTouch driver from S3), libinput right-click disable, Onboard keyboard | Ansible touchscreen role (udev rules, xinput calibration) | SmartTab more thorough for eGalax |
| **ELO touchscreen** | ELO USB drivers + Intel graphics + calibration (conditional on dmidecode) | Not explicitly handled | SmartTab |
| **Thermal printer** | Epson TM CUPS PPD drivers from S3 | Ansible thermal_printer role (Epson udev + cups) | Tie |
| **MagTek card reader** | udev rule + native .so libs + libssl1.1 compat hack | Not applicable (Datacap EMV, not MagTek) | Different payment hw |
| **ID TECH GoChip** | IDTECH native libs in `/usr/lib/smarttab/GoChip/`, ldconfig | Not applicable | SmartTab-specific |
| **Crossmatch fingerprint** | U.are.U 320 driver (v3.2.0), expect-automated installer | Not applicable | SmartTab-specific |
| **Cash drawer** | Not observed | `cashDrawerBridge` native binary in our POS | GWI handles directly |
| **Berg serial** | dialout group + kernel module (pl2303) | Not applicable | SmartTab-specific |

### Remote Access

| Feature | SmartTab | GWI POS | Winner |
|---------|----------|---------|--------|
| **VNC** | Not installed by POS installer (TeamViewer instead) | x11vnc + RealVNC Connect server | **GWI** (dual VNC) |
| **TeamViewer** | Installed, autostart, desktop shortcut | Not installed | Different approach |
| **SSH** | openssh-server installed but no hardening | SSH with key-only auth, hardened ciphers | **GWI** (more secure) |
| **Desktop launcher** | `/usr/bin/SmartTAB` symlink | `.desktop` files + Chromium fullscreen shortcut | Tie |

### Deployment & Updates

| Feature | SmartTab | GWI POS | Winner |
|---------|----------|---------|--------|
| **App delivery** | S3 zip download, extracted to ~/.smarttab | Git clone from repo, npm build on device | Different model |
| **Update mechanism** | Launcher polls S3, self-updates, backs up old version | Sync agent receives MC fleet command, git pull + rebuild | **GWI** (MC-controlled rollout) |
| **Rollback** | Backup in `data/backups/app_<timestamp>/` | Git history + previous build | Tie |
| **Version pinning** | Launcher checks API, gets latest version | MC fleet command specifies git tag (e.g., v1.0.60) | **GWI** (explicit pinning) |
| **Database migrations** | None (no local DB) | Prisma db push + numbered migrations + advisory locks | **GWI** (has local DB) |
| **Seed data** | Downloaded from venue API at runtime | seed-from-neon.sh pulls from Neon on first boot | Tie |

### Monitoring & Operations

| Feature | SmartTab | GWI POS | Winner |
|---------|----------|---------|--------|
| **Heartbeat** | None observed | Every 60s to MC (CPU, memory, disk, orders, batch status, HMAC-signed) | **GWI** |
| **Log files** | smarttab.log, payments.log, magtek.log, mobile.log + 6 more | systemd journal + structured logs | SmartTab (more granular) |
| **Backups** | None (no local DB) | Daily pg_dump at 4 AM, encrypted, 7-day retention, optional S3 upload | **GWI** |
| **HA failover** | None | keepalived VRRP + streaming replication + promote/rejoin scripts | **GWI** |
| **Fleet management** | Global API at api.smarttab.com (version check only) | Full MC dashboard (health, deploy, remote restart, schema push) | **GWI** |

### NTP/Time Sync

| Feature | SmartTab | GWI POS | Notes |
|---------|----------|---------|-------|
| **NTP** | POS installer installs `ntp` + `ntpdate`, syncs to time.nist.gov | Launcher installer installs `chrony` (preflight stage) | Both handle it, different tools. Chrony is generally better for intermittent connectivity. |

---

## What SmartTab Does That We Should Steal

### 1. Self-Updating Launcher Agent
SmartTab's launcher is a persistent agent that:
- Polls for updates on every boot
- Self-updates without operator intervention
- Backs up old version before update
- Re-provisions after update (re-runs Ansible)
- Manages POS app lifecycle (install, start, restart, update)

**Our gap:** Our sync agent handles deploy commands but doesn't manage system-level provisioning. If we push a new Ansible baseline, we need to SSH in or trigger it via MC. SmartTab's launcher would just pick it up.

**Recommendation:** Extend our sync agent to also handle baseline enforcement triggers from MC. When MC pushes a new baseline version, the sync agent runs Stage 11 automatically.

### 2. OS Branding (Boot → Login → Desktop)
SmartTab brands EVERYTHING:
- Plymouth boot splash (custom theme + initramfs rebuild)
- KDE splash screen (custom QML)
- Desktop wallpaper (via D-Bus)
- Login screen (LightDM/SDDM background)
- Disables ALL desktop notifications

**Our gap:** We have a branding Ansible role but it's less thorough. No Plymouth theme, no splash screen, no notification suppression.

**Recommendation:** Add to our branding role:
- Custom Plymouth theme (boot logo)
- Notification suppression (remove plasma-discover-notifier, disable knotify)
- Custom SDDM/GDM login background

### 3. Desktop Notification Suppression
SmartTab removes 9 notification packages and blanks every `Action=` line in knotifyrc files. This prevents "Software Update Available", "Disk Space Low", etc. from popping up on the POS screen.

**Our gap:** We don't suppress OS notifications. A "Restart Required" popup in the middle of dinner rush is bad.

**Recommendation:** Add a `notification_suppression` task to our branding or kiosk_hardening role.

### 4. Multi-Ubuntu Version Support
SmartTab ships playbooks for Ubuntu 12, 18, and 24. Their `setup.sh` detects the Ubuntu codename and selects the right playbook.

**Our gap:** We only support Ubuntu 22.04+. Our preflight check rejects anything else.

**Recommendation:** Not urgent (we control hardware), but if we ever support diverse fleet hardware, this pattern is worth adopting.

### 5. Bundled JRE (Zero System Dependencies)
SmartTab ships its own JRE inside the installer binary. No dependency on system Java.

**Our gap:** We depend on NodeSource repo for Node.js 20. If the repo is down during install, we fail.

**Recommendation:** Consider bundling a Node.js binary in our installer for offline installs. Or at minimum, cache the .deb in our installer payload.

### 6. Automatic Restart Loop
SmartTab's `start_launcher.sh` has a watchdog loop — if the launcher crashes, it waits 5s and restarts. Same for the POS app. This is independent of systemd.

**Our gap:** We use systemd `Restart=always` which is equivalent. But SmartTab's approach gives them app-level restart control (the launcher can decide NOT to restart, or to update before restarting).

**Recommendation:** Our systemd approach is fine. But we could add a pre-restart hook in our service that checks for pending updates before restarting the crashed app.

---

## What We Do Better

### 1. Security (Massively)
SmartTab's security posture is poor:
- `%sudo ALL=(ALL:ALL) NOPASSWD: ALL` — any sudo user has root
- `SUBSYSTEM=="usb", MODE="0666"` — all USB devices world-writable
- No firewall
- No SSH hardening
- Auth keys in plaintext CLI args
- No download verification
- No encrypted backups
- No kernel hardening

We have 16 Ansible security roles. This is our biggest advantage.

### 2. Architecture (Server/Backup/Terminal)
SmartTab treats every NUC identically. No HA, no failover, no role differentiation.

We support:
- Server (full POS + local DB)
- Backup (hot standby + keepalived VIP failover)
- Terminal (kiosk-only, connects to server)

### 3. Offline-First with Cloud Sync
SmartTab depends entirely on their cloud API. If the venue loses internet, the POS is dead.

We run a full local PostgreSQL + Neon sync. Venue operates fully offline. Cellular terminals write through Vercel → Neon. NUC syncs bidirectionally.

### 4. Modular Resumable Installation
SmartTab's installer is monolithic — if it fails at the thermal printer step, you re-run everything.

Ours has `--resume-from=STAGE`. If Stage 06 (schema) fails, you fix it and resume from there.

### 5. Fleet Management
SmartTab has a simple version-check API. No fleet dashboard, no remote operations, no heartbeat.

We have full MC integration: heartbeat telemetry, remote deploy, remote restart, schema push, health monitoring.

### 6. Migration System
SmartTab has no local database and thus no migration system.

We have advisory-locked numbered migrations, dual-database support (local PG + Neon), idempotent re-runs, and pre-start validation.

### 7. Encrypted Backups
SmartTab has no backup system (no local data to back up).

We have daily encrypted pg_dump, 7-day retention, optional S3 upload, and a restore script.

---

## Concrete Improvements for Our Installer

### Priority 1 — Quick Wins

#### A. Add Notification Suppression
Add to `installer/roles/kiosk_hardening/` or create `installer/roles/notification_suppression/`:
```yaml
# Remove notification packages
- name: Remove desktop notification packages
  become: yes
  apt:
    name:
      - update-notifier
      - update-manager
      - gnome-software
      - plasma-discover-notifier
      - plasma-discover
      - ubuntu-advantage-desktop-daemon
    state: absent
    autoremove: yes

# Disable knotify actions (KDE)
- name: Blank knotify Action= lines
  become: yes
  replace:
    path: "{{ item }}"
    regexp: '^Action=.*$'
    replace: 'Action='
  loop: "{{ notifyrc_files.stdout_lines }}"
```

#### B. Add Plymouth Boot Branding
Add to `installer/roles/branding/`:
- Ship a GWI Plymouth theme (logo + progress bar)
- `update-alternatives --install` + `update-initramfs -u`
- Custom SDDM/GDM login background

#### C. Bundle Node.js in Installer
Embed `node-v20.x-linux-x64.tar.gz` in the installer payload so Stage 04 can install Node.js without internet access to NodeSource.

### Priority 2 — Medium-Term

#### D. Sync Agent Handles Baseline Updates
When MC pushes a new baseline version:
1. Sync agent receives `fleet:run-baseline` command
2. Runs `11-system-hardening.sh` with the new baseline
3. Reports result back to MC

This gives us SmartTab's "self-provisioning" capability without a separate launcher app.

#### E. Add Self-Healing Watchdog
Create a simple cron job or systemd timer that:
1. Checks if thepasspos service is healthy (curl /api/health)
2. If unhealthy for >3 consecutive checks, restarts the service
3. Reports to MC

SmartTab does this at the app level (launcher watches POS). We should do it at the system level.

#### F. Add System Inventory Reporting
SmartTab's launcher reports `isPosAppInstalled`, `posAppVersion`, `launcherVersion` to their API.

Our heartbeat already sends CPU/memory/disk. Add:
- Installed package versions (node, postgresql, ansible)
- Baseline version applied
- Hardware inventory (touchscreen detected, printer model, etc.)
- Last successful backup timestamp

### Priority 3 — Nice to Have

#### G. Offline Installer Mode
SmartTab's installer.run works without internet (bundles JRE, downloads from S3).

Our installer requires internet for git clone + npm install. For rural venues with bad internet:
- Bundle the built app in the installer (no git clone, no npm install)
- Cache all .deb packages
- Only need internet for MC registration + Neon seed

#### H. KDE Splash Screen
If we want a polished first-boot experience, add a custom KDE/GNOME splash screen. Low priority but nice for demos.

#### I. Touchscreen Auto-Detection and Configuration
SmartTab auto-detects eGalax touchscreens and installs drivers. Our touchscreen role exists but could be more auto-detecting (probe `ID_INPUT_TOUCHSCREEN=1` like SmartTab does).

---

## Summary

**SmartTab excels at:** OS branding, self-updating launcher, multi-hardware support (fingerprint, EMV, card readers), notification suppression, zero-dependency delivery

**GWI POS excels at:** Security (massively), offline-first architecture, HA failover, fleet management, modular/resumable installation, encrypted backups, migration system, role differentiation

**Top 3 things to steal:**
1. Notification suppression (prevents embarrassing OS popups during service)
2. Plymouth boot branding (professional first impression)
3. Sync agent baseline triggers (self-provisioning without SSH access)
