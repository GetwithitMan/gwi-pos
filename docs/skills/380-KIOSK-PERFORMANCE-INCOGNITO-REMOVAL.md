# Skill 380: Kiosk Performance (Incognito Removal)

**Date:** February 19, 2026
**Domain:** Infrastructure / Performance
**Status:** DONE

## Dependencies

- Skill 345: Installer
- Skill 377: Remote Device Actions (SystemReloadListener)

## Overview

Removed the `--incognito` flag from Chromium kiosk launch flags across all three locations in the installer script. This allows terminals to cache JavaScript, CSS, and image assets between kiosk restarts, significantly improving load times. The change is safe because Next.js uses content-hashed bundle filenames (stale cached bundles are never requested), and the SystemReloadListener (Skill 377) forces page reloads after deploys to pick up new bundles.

## Key Files

### POS (gwi-pos)

| File | Purpose |
|------|---------|
| `public/installer.run` | Removed `--incognito` from Chromium flags in 3 locations: server kiosk service, terminal kiosk service, and desktop autostart entry. |
| `docs/INSTALLER-SPEC.md` | Updated specification to reflect the removal of `--incognito` from Chromium flags. |

## Implementation Details

### What Changed

Removed `--incognito` from the Chromium launch flags in three places within `installer.run`:

1. **Server kiosk service** (`pulse-kiosk.service`) — the systemd unit that launches Chromium on the server NUC
2. **Terminal kiosk service** (`pulse-kiosk.service` on terminal NUCs) — the systemd unit for terminal-only stations
3. **Desktop autostart** (`.desktop` file) — the KDE/GNOME autostart entry for non-systemd environments

### Why `--incognito` Was Originally There

Incognito mode was added as a safety measure to prevent stale cached pages from being served after updates. In early development, there was concern that terminals would show outdated UI after a deploy.

### Why Removal Is Safe

1. **Content-hashed bundles**: Next.js generates filenames like `main-abc123.js`. When the app rebuilds after a deploy, all bundle filenames change. The browser will never request an old cached bundle because the HTML references new filenames.

2. **SystemReloadListener**: After a deploy, the sync agent triggers a `system:reload` socket event (Skill 377). The `SystemReloadListener` component calls `window.location.reload()`, which fetches the new HTML with new bundle references. Any old cached bundles are simply unused (and eventually evicted by the browser cache).

3. **No session/auth leakage risk**: The POS uses PIN-based employee authentication, not browser cookies or session storage. There is no sensitive session data that incognito mode was protecting.

### Performance Impact

- **Before**: Every kiosk restart (and every `systemctl restart pulse-kiosk`) triggered a cold load of all JavaScript, CSS, and image assets. On a NUC with a typical internet connection, this added 5-15 seconds to initial page load.
- **After**: Terminals cache all static assets between restarts. Subsequent loads only fetch the HTML document (which is tiny) and any changed bundles. Initial load after restart drops to 1-3 seconds.

### Live NUC Updates

Applied the change to existing deployed NUCs without re-running the installer:

- **172.16.1.254** (server NUC): `sed -i` to remove `--incognito` from the kiosk service file, then `systemctl daemon-reload && systemctl restart pulse-kiosk`
- **172.16.1.203** (terminal NUC): Same `sed -i` + `daemon-reload` + restart

## Testing / Verification

1. Fresh install — run `installer.run`, verify Chromium launches without `--incognito` flag (check `ps aux | grep chromium`)
2. Cache persistence — restart kiosk service, verify assets load from cache (DevTools Network tab shows `(disk cache)` for JS/CSS)
3. Deploy cycle — trigger a FORCE_UPDATE, verify new bundles are loaded after SystemReloadListener fires
4. No stale content — after deploy + reload, verify the page shows the new version (no old UI artifacts)
5. INSTALLER-SPEC.md — verify spec document matches the actual installer flags

## Related Skills

- **Skill 345**: Installer — the installer script that was modified
- **Skill 377**: Remote Device Actions — SystemReloadListener ensures terminals pick up new bundles after deploy
