# Skill 365: Cloud-to-Terminal Real-Time Data Sync

## Status: DONE
## Domain: Mission Control, Deployment
## Dependencies: 345 (Installer), 347 (Heartbeat)

## Summary

When an admin edits data in Mission Control (cloud), changes now propagate in real-time to NUC terminals via a multi-hop chain: POS Vercel → MC notify → FleetCommand → SSE → NUC sync agent → cache-invalidate → Socket.io → terminals.

## Architecture

```
Cloud Admin edits menu/table/setting
  ↓
POS Vercel API (cloud-notify.ts)
  ↓ POST /api/fleet/commands/notify (Bearer FLEET_NOTIFY_SECRET)
MC Vercel (notify/route.ts)
  ↓ Creates FleetCommand (type: DATA_CHANGED, priority: HIGH, 5min TTL)
NUC Sync Agent (SSE stream polling)
  ↓ Receives DATA_CHANGED command
POS NUC (cache-invalidate endpoint)
  ↓ Clears menu-cache / location-cache
Socket.io → All connected terminals
```

## Key Files

### POS Repo
| File | Purpose |
|------|---------|
| `src/lib/cloud-notify.ts` | Fire-and-forget notification to MC. Trims FLEET_NOTIFY_SECRET and MC_BASE_URL env vars. |
| 15 API routes | Call `notifyDataChanged()` after DB writes (menu items, categories, tables, settings, etc.) |

### MC Repo
| File | Purpose |
|------|---------|
| `src/app/api/fleet/commands/notify/route.ts` | Receives notifications, looks up CloudLocation by `posLocationId`, creates FleetCommand |

## Bugs Fixed

1. **FLEET_NOTIFY_SECRET 401** — Both Vercel projects had trailing `\n` in env var. HTTP headers strip newlines, so POS sent clean value but MC compared with `\n`. Fix: `.trim()` on both sides.
2. **Prisma FK violation 500** — POS sent its own `locationId` (POS DB CUID) but MC's `FleetCommand.locationId` is FK to `CloudLocation.id`. Fix: Lookup `CloudLocation` by `posLocationId` field, use MC's `cloudLocation.id`.
3. **Installer clone permission denied** — `mkdir -p` creates as root, `chown` was non-recursive. Fix: `chown -R`.

## Environment Variables

- `FLEET_NOTIFY_SECRET` — Shared secret between POS Vercel and MC Vercel (always `.trim()`)
- `MC_BASE_URL` — MC Vercel URL (always `.trim()`)
