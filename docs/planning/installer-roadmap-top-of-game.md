# GWI POS Installer — Road to Best-in-Class

Strategic roadmap based on live analysis of SmartTab's installer vs ours (2026-03-23).

---

## Where We Stand Today

### We win on (already best-in-class)
- **Security** — 16 Ansible hardening roles vs their `NOPASSWD: ALL` + world-writable USB
- **Offline-first** — Full local PG + Neon sync vs their cloud-only dependency (venue dies without internet)
- **HA** — keepalived + streaming replication + VIP failover vs nothing
- **Fleet ops** — MC heartbeat, remote deploy, remote restart, schema push vs a version-check API
- **Architecture** — Web-based: any browser is a terminal. Their Java desktop app needs a full JRE on every screen
- **Multi-role** — Server/backup/terminal vs every NUC is identical
- **Resumability** — `--resume-from=STAGE` vs re-run everything
- **Migrations** — Advisory-locked numbered migrations, dual-DB vs no local database at all
- **Android ecosystem** — Native KDS apps, native register app, host stand app vs Java-only

### They win on (gaps we need to close)
- **Zero-touch updates** — Their launcher auto-updates itself + POS + re-provisions. No SSH needed.
- **Hardware plug-and-play** — Fingerprint, EMV chip, card readers all auto-detected and configured
- **OS polish** — Boot splash → login → desktop → notifications all branded and locked down
- **Bundled delivery** — Ships its own JRE, works offline from first byte. Our installer needs internet for git/npm
- **Operator simplicity** — Their installer is a GUI. Ours is a CLI that expects Linux knowledge

### Nobody wins on (industry-wide gaps)
- True zero-touch provisioning (plug in NUC, it finds its venue identity automatically)
- Hardware inventory that feeds back to fleet management
- Installer that validates the venue is actually taking orders before declaring success

---

## The Strategic Moves (in priority order)

### Tier 1 — Close the Polish Gap (1-2 days each)

These are embarrassing omissions. SmartTab handles them, we don't, and venues notice.

#### 1. Notification Suppression
**Problem:** Ubuntu pops up "Software Update Available", "Low Disk Space", "Restart Required" over the POS during service.
**Fix:** Add to `installer/roles/kiosk_hardening/`:
- Remove `update-notifier`, `update-manager`, `gnome-software`, `plasma-discover-notifier`, `ubuntu-advantage-desktop-daemon`
- Blank all `Action=` lines in `/usr/share/knotifications5/*.notifyrc`
- Remove snap `snapd-desktop-integration`
- Disable `unattended-upgrades` reboot prompts (keep the security updates, suppress the nag)

#### 2. Boot-to-Desktop Branding
**Problem:** NUC boots with Ubuntu logo, Ubuntu login screen, default wallpaper. Looks generic.
**Fix:** Add to `installer/roles/branding/`:
- Custom Plymouth theme (GWI logo) → `update-alternatives` + `update-initramfs -u`
- Custom SDDM/GDM login background
- Custom desktop wallpaper (applied via D-Bus for KDE, gsettings for GNOME)
- Custom KDE Plasma splash screen

#### 3. Sleep/Hibernate/Lock Hardening
**Problem:** Screen dims, locks, or sleeps during slow periods. Staff has to enter a password to wake.
**Fix:** Add to `installer/roles/kiosk_hardening/` (some of this may already be partial):
- Mask `sleep.target`, `suspend.target`, `hibernate.target`, `hybrid-sleep.target`
- Mask `plasma-powerdevil.service`
- Set `Autolock=false`, `Timeout=0`, `LockOnResume=false`
- Disable DPMS screen blanking

### Tier 2 — Self-Managing NUCs (1-2 weeks)

This is where we leapfrog SmartTab. Their launcher polls S3 for updates. Ours should be MC-orchestrated.

#### 4. Sync Agent Handles Baseline + App Updates
**Current:** To update the Ansible baseline or redeploy the app, we SSH in or the sync agent handles git-based deploys.
**Target:** MC sends a fleet command, sync agent executes it, reports back. No SSH ever.

Expand sync agent to handle:
- `fleet:run-baseline` → Runs Stage 11 (Ansible hardening) with new roles
- `fleet:update-installer-modules` → Pulls latest installer modules from repo
- `fleet:run-stage` → Runs any specific stage (e.g., re-run 09-remote-access after config change)
- `fleet:reboot` → Graceful reboot with pre-checks
- Report: success/failure + changed count + duration back to MC

**This gives us SmartTab's self-updating capability but MC-controlled, not blind S3 polling.**

#### 5. Self-Healing Watchdog
**Current:** systemd `Restart=always` restarts crashed services. But if the app starts but is unhealthy (DB connection lost, OOM thrashing, stuck migration), nobody knows until a venue calls.
**Target:** Proactive health monitoring that acts before the venue notices.

Create `thepasspos-watchdog.service` (or timer):
- Every 30s: `curl -sf http://localhost:3005/api/health`
- If unhealthy for 3 consecutive checks:
  1. Capture diagnostics (top, free, pg_isready, journal tail)
  2. Attempt service restart
  3. If still unhealthy after restart: alert MC via heartbeat escalation
  4. If unhealthy for 10 minutes: attempt full pre-start recovery (prisma push, RLS disable, seed check)
- MC dashboard shows: healthy / degraded / down with last-healthy timestamp

#### 6. Hardware Inventory Reporting
**Current:** Heartbeat sends CPU/memory/disk. MC doesn't know what hardware is connected.
**Target:** MC knows exactly what's on every NUC.

Add to heartbeat payload:
```json
{
  "hardware": {
    "touchscreen": true,
    "touchscreen_model": "eGalax Inc. USB TouchController",
    "thermal_printer": "Epson TM-T88VI",
    "card_reader": null,
    "fingerprint": null,
    "serial_devices": ["ttyUSB0"],
    "usb_devices": [{"vendor": "0416", "product": "5011", "name": "..."}]
  },
  "software": {
    "node_version": "20.11.0",
    "pg_version": "17.3",
    "ansible_version": "10.7.0",
    "baseline_version": "1.2.0",
    "last_baseline_run": "2026-03-20T04:00:00Z",
    "last_backup": "2026-03-23T04:00:12Z",
    "kernel": "6.8.0-45-generic"
  }
}
```

MC can then:
- Flag NUCs with no thermal printer (forgot to plug it in)
- Flag NUCs with outdated baseline
- Flag NUCs with failed backups
- Auto-suggest hardware setup needed

### Tier 3 — Zero-Touch Provisioning (2-4 weeks)

This is where nobody in the POS industry is yet. The holy grail.

#### 7. Offline Installer Bundle
**Problem:** Our installer needs internet for `git clone` + `npm ci` + `npx prisma generate` + Neon seed. Rural venues with 5Mbps DSL take 30+ minutes. If the connection drops mid-npm-install, you're stuck.
**Target:** Single binary installs the entire POS without internet. Only needs internet for MC registration + Neon seed.

Implementation:
- CI builds a fat installer: `installer.run` + embedded `node-v20-linux-x64.tar.gz` + pre-built `.next/` + `node_modules/` + `.deb` packages
- Stage 04 uses bundled Node.js if NodeSource repo unreachable
- Stage 05 uses pre-built app if git clone fails (offline mode)
- Stage 06 still needs Neon for seed (but can defer: "seed when internet available")
- Total size: ~200MB (compressed) vs current ~5GB download during install

**SmartTab ships a 55MB self-extracting archive with bundled JRE. We should ship a ~200MB one with bundled Node + pre-built app.**

#### 8. One-Click Venue Deployment from MC
**Current flow:**
1. Operator gets a NUC
2. Installs Ubuntu manually
3. SSHes in, downloads installer.run
4. Runs installer, enters registration token
5. Waits 20 minutes
6. Tests

**Target flow:**
1. Operator boots NUC with GWI USB stick (pre-baked Ubuntu + installer)
2. NUC boots, auto-runs installer
3. Installer shows GUI: "Scan QR code or enter venue code"
4. MC generated the venue code in advance (one-click in MC UI)
5. NUC registers itself, provisions, reports ready
6. MC shows green checkmark

What this requires:
- Custom Ubuntu ISO with our installer pre-loaded (or a first-boot script)
- Simple GUI for registration (could be a local web page on port 80 — no Java needed)
- MC "Create Venue" flow generates a short registration code (6-digit alphanumeric)
- Registration code maps to: venue identity, Neon DB URL, deploy token, etc.
- NUC calls MC with code, gets full provisioning payload

**This eliminates the "Linux knowledge" requirement entirely.**

#### 9. Hardware Auto-Detection + Driver Management
**Current:** Our Ansible roles detect touchscreens and printers. But it's best-effort.
**Target:** The installer probes all connected hardware, installs correct drivers, and reports what it found.

Add a hardware detection stage (Stage 00 or Stage 12):
```bash
# Detect touchscreen
if grep -q ID_INPUT_TOUCHSCREEN=1 /sys/class/input/event*/device/uevent; then
    TOUCHSCREEN_DETECTED=true
    # Probe for eGalax (vendor 0eef)
    if lsusb -d 0eef: | grep -q .; then install_egtouch_driver; fi
    # Probe for ELO (dmidecode)
    if dmidecode | grep -q 'Product Name: Elo'; then install_elo_driver; fi
fi

# Detect thermal printer
if lsusb | grep -qiE '04b8:.*(TM-|Receipt)'; then
    PRINTER_DETECTED=true
    install_epson_cups_drivers
fi

# Detect card reader (if we ever support USB card readers)
# Detect cash drawer (USB or serial)
# Detect scale (CAS PDN)
```

Report everything to MC via heartbeat so fleet dashboard shows hardware status per venue.

### Tier 4 — Architectural Advantages to Press (ongoing)

These aren't installer features — they're platform advantages our web architecture enables that SmartTab can never match.

#### 10. Any Screen is a Terminal
SmartTab needs a full NUC + Java runtime for every screen. We need a browser.
- **iPad as a terminal** — Zero install, just open URL. No app store approval needed.
- **Phone as a server pad** — Waitstaff uses their own phone. SmartTab can't do this.
- **Customer-facing display** — Cheap Android tablet running Chromium in kiosk mode.
- **KDS on any screen** — Our web KDS works on a $35 Fire tablet. Their KDS needs the full Java stack.

**Press this advantage:** Make sure our terminal/kiosk experience is flawless on iPads, cheap Android tablets, and Chromebooks. This is our moat.

#### 11. Cloud-Primary = Instant Multi-Venue
SmartTab's cloud-only architecture means the venue is dead without internet. Our offline-first architecture means the venue works regardless. But we also sync to Neon, which means:
- Multi-venue reporting in MC (they can't do this — each NUC is an island)
- Cellular terminals that work on LTE (food trucks, events, outdoor bars)
- Centralized menu management across venues (enterprise catalog)

**Press this advantage:** The enterprise catalog + MC provisioning + multi-venue reporting is a suite SmartTab can't build without rearchitecting.

#### 12. OTA Updates Without Reboots
SmartTab has to restart their Java app (and sometimes reboot the NUC) to apply updates. Their launcher literally kills the POS, replaces the JAR, and restarts.

We could do rolling restarts:
- Build new `.next/` alongside running app
- Swap symlink
- `systemctl restart thepasspos` — 3 second downtime
- Or even: Next.js supports graceful shutdown — drain connections, then restart

**Press this advantage:** "Update your POS during lunch rush with zero downtime" is a killer pitch.

---

## Prioritized Implementation Plan

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Notification suppression | 2 hours | Prevents embarrassment |
| **P0** | Boot/login/desktop branding | 4 hours | Professional first impression |
| **P0** | Sleep/lock hardening (verify complete) | 1 hour | Prevents service disruptions |
| **P1** | Sync agent handles baseline updates | 2 days | Eliminates SSH for fleet management |
| **P1** | Self-healing watchdog | 1 day | Proactive vs reactive support |
| **P1** | Hardware inventory in heartbeat | 4 hours | Fleet visibility |
| **P2** | Offline installer bundle | 1 week | Rural venue support |
| **P2** | MC one-click venue deployment | 2 weeks | Zero Linux knowledge needed |
| **P2** | Hardware auto-detection stage | 3 days | Plug-and-play hardware |
| **P3** | Custom Ubuntu ISO / USB stick | 1 week | True zero-touch |
| **P3** | Rolling restart (zero downtime updates) | 3 days | Update during service |

---

## The Pitch

After implementing P0+P1 (roughly 1 week of work):

> **GWI POS is the only POS system that:**
> - Works fully offline with automatic cloud sync when connectivity returns
> - Supports HA failover (hot standby promotes in seconds, no data loss)
> - Runs on any device with a browser (iPad, phone, Chromebook, tablet, NUC)
> - Has enterprise fleet management (remote deploy, health monitoring, schema orchestration)
> - Enforces 16-role security baseline on every NUC (firewall, SSH hardening, kernel hardening)
> - Self-heals and self-reports without operator intervention
> - Supports multi-venue centralized management from day one

SmartTab can match us on hardware drivers and boot branding. They cannot match us on architecture, security, offline capability, or fleet management without a ground-up rewrite of their Java monolith.

---

## What NOT to Copy from SmartTab

1. **Don't build a Java launcher.** Their launcher exists because desktop apps can't update themselves. Our web app + sync agent handles this better.
2. **Don't ship Oracle JDK.** They bundle a proprietary JRE. We use system Node.js from signed repos. Cleaner.
3. **Don't do `NOPASSWD: ALL`.** Ever. Their security is embarrassing.
4. **Don't make USB world-writable.** `MODE="0666"` on all USB devices is a security nightmare. Whitelist specific devices.
5. **Don't depend on cloud-only.** Their POS literally cannot function without internet. This is a dealbreaker for any venue with unreliable connectivity.
6. **Don't use SQLite for POS data.** They use SQLite (single-writer, no concurrent access, no replication). We use PostgreSQL (multi-writer, streaming replication, full SQL). Right choice.
