# Skill 381: Release Requires Kiosk Restart

**Date:** February 19, 2026
**Domain:** Infrastructure / Release Management
**Status:** DONE

## Dependencies

- Skill 334: Release Management
- Skill 377: Remote Device Actions

## Overview

Added a "Requires kiosk restart after deploy" option to the release creation flow. When enabled, the deploy pipeline automatically reloads all terminal browser sessions after the NUC finishes building, without manual intervention. This handles releases that include changes requiring a full page reload (e.g., new root layout components, service worker updates, socket connection changes).

## Key Files

### Mission Control (gwi-mission-control)

| File | Purpose |
|------|---------|
| Prisma schema (`Release` model) | Added `requiresKioskRestart Boolean @default(false)` field. |
| `CreateReleaseModal.tsx` | Added checkbox for "Requires kiosk restart after deploy". |
| `ReleaseList.tsx` | Amber "Restart" badge displayed when `requiresKioskRestart` is true. |
| Releases API route | Accepts `requiresKioskRestart` field in create/update payloads. |
| `release-manager.ts` | `deployToLocation()` fetches `requiresKioskRestart` from the release, adds `postDeployAction: 'RELOAD_TERMINALS'` to the FORCE_UPDATE command payload. |

### Sync Agent (gwi-mission-control)

| File | Purpose |
|------|---------|
| `command-handlers.ts` (FORCE_UPDATE handler) | At the end of `handleForceUpdate`, checks for `postDeployAction === 'RELOAD_TERMINALS'`. If present, waits 5 seconds then POSTs to `/api/internal/reload-terminals`. |

### POS (gwi-pos)

| File | Purpose |
|------|---------|
| `src/app/api/internal/reload-terminals/route.ts` | Internal API that emits `system:reload` socket event to all terminals (from Skill 377). |

## Implementation Details

### MC Schema Addition

```prisma
model Release {
  // ... existing fields
  requiresKioskRestart Boolean @default(false)
}
```

Default is `false` — most releases do not require a kiosk restart. Only releases with structural changes (new layout components, socket changes, etc.) need this flag.

### MC UI: CreateReleaseModal

- New checkbox: "Requires kiosk restart after deploy"
- Unchecked by default
- Tooltip explains: "When enabled, all terminal browser sessions will automatically reload after the deploy completes."

### MC UI: ReleaseList

- Releases with `requiresKioskRestart: true` display an amber "Restart" badge next to the version number
- Visual indicator helps admins understand which releases will trigger terminal reloads

### MC Release Manager: `deployToLocation()`

- When creating the FORCE_UPDATE command for a location, fetches the release record
- If `release.requiresKioskRestart` is true, adds `postDeployAction: 'RELOAD_TERMINALS'` to the FORCE_UPDATE payload
- The payload is included in the FleetCommand that gets delivered to the NUC via SSE

### Sync Agent: Post-Deploy Action

At the end of `handleForceUpdate`, after the build completes successfully:

1. Checks if `payload.postDeployAction === 'RELOAD_TERMINALS'`
2. If present, waits **5 seconds** for the POS server to restart and become healthy (the build process restarts the `thepasspos` systemd service)
3. POSTs to `http://localhost:3005/api/internal/reload-terminals`
4. This triggers the `system:reload` socket event, which the `SystemReloadListener` component picks up on every terminal, causing `window.location.reload()`

### End-to-End Flow

```
Admin creates release (requiresKioskRestart: true)
  -> Admin deploys to location
    -> MC creates FORCE_UPDATE command with postDeployAction: 'RELOAD_TERMINALS'
      -> NUC sync agent receives command via SSE
        -> Sync agent runs git pull, npm ci, prisma generate, prisma db push, npm run build
          -> Sync agent restarts thepasspos service
            -> Waits 5 seconds for POS server to come up
              -> POSTs to /api/internal/reload-terminals
                -> POS emits system:reload via Socket.io
                  -> All terminals reload their browser sessions
                    -> Terminals load the new version
```

### Why 5 Seconds?

The POS server (Next.js + custom server.ts) typically takes 2-4 seconds to restart after `systemctl restart thepasspos`. The 5-second delay provides a margin to ensure the server is accepting requests before the reload-terminals POST is sent. If the server is not yet ready, the POST will fail silently (the terminals will still eventually load the new version on their next natural page navigation or heartbeat-triggered check).

## Testing / Verification

1. Create release with flag — verify checkbox appears in CreateReleaseModal and persists to database
2. Release list badge — verify amber "Restart" badge appears for releases with `requiresKioskRestart: true`
3. Deploy with flag — trigger deploy, verify FORCE_UPDATE payload includes `postDeployAction: 'RELOAD_TERMINALS'`
4. Post-deploy reload — after build completes, verify terminals reload within ~5-10 seconds
5. Deploy without flag — verify terminals do NOT reload after deploy when `requiresKioskRestart: false`
6. Build failure — verify post-deploy action does NOT execute if the build fails (handler aborts before reaching post-deploy logic)
7. POS server not ready — verify graceful failure if 5s delay is insufficient (no crash, terminals eventually load new version)

## Related Skills

- **Skill 334**: Release Management — release creation and deployment pipeline
- **Skill 377**: Remote Device Actions — SystemReloadListener and reload-terminals endpoint
