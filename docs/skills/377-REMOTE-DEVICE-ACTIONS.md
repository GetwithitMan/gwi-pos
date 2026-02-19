# Skill 377: Remote Device Actions

**Date:** February 19, 2026
**Domain:** Infrastructure / Fleet Management
**Status:** DONE

## Dependencies

- Skill 307: SSE Command Stream
- Skill 308: Sync Agent
- Skill 376: Device Fleet Management

## Overview

Remote kiosk restart and terminal reload capabilities from Mission Control. Admins can remotely restart the Chromium kiosk service or force-reload individual or all terminal browser sessions on any managed NUC. Commands flow from MC through the SSE command stream to the sync agent, which executes them locally on the NUC.

## Key Files

### Mission Control (gwi-mission-control)

| File | Purpose |
|------|---------|
| Prisma schema (CommandType enum) | Added `RESTART_KIOSK`, `RELOAD_TERMINALS`, `RELOAD_TERMINAL` to the `CommandType` enum. |
| `POST /api/admin/locations/[id]/remote-action` | API route — creates a `FleetCommand` with HIGH priority and 1-hour expiry for the requested action. |
| `RemoteActionsCard.tsx` | UI card with buttons for restart kiosk, reload all terminals. Includes confirmation dialogs before executing. |

### Sync Agent (gwi-mission-control)

| File | Purpose |
|------|---------|
| `command-handlers.ts` | Three new handlers: `handleRestartKiosk`, `handleReloadTerminals`, `handleReloadTerminal`. |

### POS (gwi-pos)

| File | Purpose |
|------|---------|
| `src/app/api/internal/reload-terminals/route.ts` | Internal API — calls `emitToLocation('system:reload')` to broadcast reload to all terminals. |
| `src/app/api/internal/reload-terminal/route.ts` | Internal API — emits reload to a specific terminal by `terminalId`. |
| `SystemReloadListener.tsx` | Root layout component that listens for the `system:reload` socket event and triggers `window.location.reload()`. |

## Implementation Details

### MC Schema Changes

Three new values added to the `CommandType` enum:
- `RESTART_KIOSK` — restarts the Chromium kiosk systemd service
- `RELOAD_TERMINALS` — reloads all terminal browser sessions
- `RELOAD_TERMINAL` — reloads a specific terminal browser session

### MC API (`POST /api/admin/locations/[id]/remote-action`)

- Accepts `action` (one of the three command types) and optional `terminalId` (for single-terminal reload)
- Creates a `FleetCommand` record with:
  - `priority: HIGH`
  - `expiresAt: now() + 1 hour`
  - `payload` containing action-specific data
- Command is picked up by the NUC's sync agent via SSE

### Sync Agent Command Handlers

Three new handlers in `command-handlers.ts`:

1. **`handleRestartKiosk`** — Executes `sudo systemctl restart pulse-kiosk` on the NUC. Restarts the Chromium kiosk service, which reloads all local browser windows.

2. **`handleReloadTerminals`** — POSTs to `http://localhost:3005/api/internal/reload-terminals`. Triggers a socket broadcast that reloads all connected terminal sessions.

3. **`handleReloadTerminal`** — POSTs to `http://localhost:3005/api/internal/reload-terminal` with `{ terminalId }` in the body. Triggers a targeted reload for a single terminal.

### POS Internal Endpoints

- **`/api/internal/reload-terminals`** — Calls `emitToLocation(locationId, 'system:reload', {})` to broadcast to all terminals at the location.
- **`/api/internal/reload-terminal`** — Accepts `terminalId` in the request body, emits `system:reload` to that specific terminal's socket room.

### POS SystemReloadListener Component

- Mounted in the root layout so it is active on every page
- Uses `getSharedSocket()` to listen for the `system:reload` event
- On receiving the event, calls `window.location.reload()` to force a full page refresh
- Cleans up socket listener on unmount via `releaseSharedSocket()`

### MC UI: RemoteActionsCard

- **Restart Kiosk** button — opens confirmation dialog ("This will restart the Chromium kiosk on the NUC. All browser windows will close and reopen."), then POSTs `RESTART_KIOSK` action
- **Reload All Terminals** button — opens confirmation dialog, then POSTs `RELOAD_TERMINALS` action
- Success/error toast notifications after action dispatch

## Testing / Verification

1. Restart kiosk — click button in MC, confirm kiosk service restarts on NUC (`systemctl status pulse-kiosk`)
2. Reload all terminals — click button, confirm all terminal browser sessions reload (visible page refresh)
3. Reload single terminal — trigger via API with terminalId, confirm only that terminal reloads
4. SystemReloadListener — verify component is mounted in root layout and responds to `system:reload` event
5. Command expiry — verify commands older than 1 hour are not executed by the sync agent
6. Confirmation dialogs — verify dialogs appear before actions are dispatched (no accidental restarts)
7. Error handling — verify graceful failure if POS server is unreachable when sync agent tries to POST

## Related Skills

- **Skill 307**: SSE Command Stream — transport layer for remote commands
- **Skill 308**: Sync Agent — executes commands on the NUC
- **Skill 376**: Device Fleet Management — device inventory that remote actions target
