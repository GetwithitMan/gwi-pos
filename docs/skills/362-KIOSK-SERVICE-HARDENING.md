# Skill 362: Kiosk Systemd Service Hardening (Duplicate Tab Prevention)

**Date:** February 17, 2026
**Commits:** `f284cdd`, `1e857b3`, `c468429` (3-commit fix series)
**Domain:** Hardware / DevOps
**Status:** Complete

## Problem

Three cascading issues in the kiosk systemd service definition caused infinite duplicate Chromium tabs on NUC terminals:

### Problem 1: Restart=always + Chromium Snap Fork

Chromium installed via snap forks on startup — the parent process exits immediately after spawning the actual browser process. With `Restart=always`, systemd interpreted the parent exit as a crash and spawned a new instance every 5 seconds. Result: dozens of duplicate tabs accumulating until the NUC ran out of memory.

### Problem 2: ExecStartPre pkill Self-Match

The cleanup command `ExecStartPre=/bin/bash -c 'pkill -f chromium || true'` was designed to kill stale Chromium processes before starting a new one. However, `pkill -f` matches against the full command line of all processes — including its own `/bin/bash -c 'pkill -f chromium || true'` parent. This killed the bash process, delivering a fatal signal to systemd's control process, which logged as a service start failure.

### Problem 3: killall Not Installed

The first fix attempt replaced `pkill -f` with `killall chromium-browser chromium`. But `killall` is provided by the `psmisc` package, which is not installed by default on fresh Ubuntu 24.04 terminal images. The service failed to start on terminals that had never had psmisc installed.

## Solution (3-Commit Series)

### Commit 1 (`f284cdd`): Fix Restart Policy

- Changed `Restart=always` to `Restart=on-failure`
- Increased `RestartSec` from 5s to 10s
- Chromium's normal fork-and-exit no longer triggers restart loops
- Genuine crashes (non-zero exit) still trigger restart with 10s cooldown

### Commit 2 (`1e857b3`): Fix pkill Self-Match

- Replaced `pkill -f chromium` with `killall chromium-browser chromium`
- `killall` matches by process name only (not command line), avoiding self-match
- Added `|| true` to handle "no process found" gracefully

### Commit 3 (`c468429`): Remove ExecStartPre Entirely

- Removed the `ExecStartPre` kill command from the service definition
- The installer script already kills all Chromium processes before starting the kiosk service
- Eliminating the pre-start kill avoids the psmisc dependency entirely
- Added Chromium flags: `--no-first-run`, `--disable-features=TranslateUI`

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `public/installer.run` | Server kiosk service: Restart policy, ExecStartPre removal, Chromium flags |
| 2 | `public/installer.run` | Terminal kiosk service: Same fixes applied to terminal role definition |

## Key Details

- Both server and terminal kiosk service blocks were updated (installer has two separate service definitions)
- `--no-first-run` suppresses Chromium's first-run welcome dialog on fresh installs
- `--disable-features=TranslateUI` prevents the translation popup bar from appearing over POS UI
- The installer's pre-service `pkill` (outside systemd) still runs to clean up any stale processes from previous installs

## Verification

1. Fresh server install — kiosk starts with single Chromium tab, no duplicates after 60s
2. Fresh terminal install — same behavior, single tab
3. `systemctl status pulse-kiosk` — shows `active (running)`, no rapid restart loops
4. Kill Chromium manually — service restarts once after 10s (Restart=on-failure works)
5. Normal service stop — no restart triggered (clean exit = success)
6. `journalctl -u pulse-kiosk` — no ExecStartPre errors

## Related Skills

- **Skill 345**: NUC Installer Package (parent installer script)
- **Skill 346**: Kiosk Exit Zone (5-tap exit from kiosk mode)
- **Skill 361**: Default Port Migration (kiosk URL updated to port 3005)
