# Skill 363: Installer HTTP Scheme Auto-Prepend for Terminal Server URL

**Date:** February 17, 2026
**Commits:** `df70be3`, `a4c8894`
**Domain:** DevOps / Installer
**Status:** Complete

## Problem

When setting up a terminal-role NUC, the installer prompts for the server URL (the IP address of the server NUC on the local network). Users naturally typed bare IP addresses like `172.16.1.254:3005`, which failed URL validation because the installer required a full `http://` or `https://` prefix. The error message "Invalid server URL format" was confusing — users didn't know they needed to type the scheme.

A secondary issue: on re-installs, the installer's `.env` copy step (`cp .env app/.env.local`) failed with `cp: '.env' and 'app/.env.local' are the same file` when the destination was a symlink pointing back to the source. With `set -euo pipefail` active, this aborted the entire install.

## Solution

### Fix 1: Auto-Prepend HTTP Scheme (`df70be3`)

- If the user-entered server URL does not start with `http://` or `https://`, the installer auto-prepends `http://`
- Updated the prompt example text to show the bare IP format: `e.g. 172.16.1.254:3005`
- A log message confirms the auto-corrected URL so the user can verify
- Validation still runs after prepending — malformed URLs are still rejected

### Fix 2: .env Copy on Re-Install (`a4c8894`)

- Added `rm -f /opt/gwi-pos/app/.env.local` before the copy step
- Clears any existing file or symlink before writing the fresh copy
- Prevents the "same file" error on re-installs where a symlink existed

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `public/installer.run` | Auto-prepend `http://` to bare server URLs in terminal setup |
| 2 | `public/installer.run` | Updated prompt example text to show bare IP format |
| 3 | `public/installer.run` | Log message showing auto-corrected URL |
| 4 | `public/installer.run` | `rm -f` before `.env.local` copy to handle symlinks on re-install |

## Key Details

- Only affects terminal-role installs (server role doesn't prompt for a server URL)
- The auto-prepend uses `http://` (not `https://`) because local NUC-to-NUC communication is over the LAN
- The scheme detection is case-insensitive (`HTTP://` also recognized)
- Existing installs that already typed `http://` are unaffected (no double-prepend)

## Verification

1. Terminal install — type `172.16.1.254:3005` → installer logs "Using http://172.16.1.254:3005" → kiosk connects
2. Terminal install — type `http://172.16.1.254:3005` → no double-prepend, works normally
3. Terminal install — type `garbage!!!` → still rejected after prepend (validation catches it)
4. Re-install on existing NUC — `.env.local` copy succeeds even if symlink exists
5. `set -euo pipefail` — no unhandled errors during re-install flow

## Related Skills

- **Skill 345**: NUC Installer Package (parent installer script)
- **Skill 361**: Default Port Migration (port in prompt example updated to 3005)
- **Skill 362**: Kiosk Service Hardening (kiosk service fixes in same installer)
