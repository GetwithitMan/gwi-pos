# Skill 401 — Auto-Reboot After Batch

**Domain:** Infrastructure / MC Config / NUC
**Date:** 2026-02-20
**Commits:** a38a8cf (gwi-pos), cde2cc9 (gwi-mission-control)
**Addresses:** NUC servers accumulate memory leaks over time; nightly reboots need to be automatic and timed to occur after batch close when the venue is quiet

---

## Overview

When a batch close is detected by Mission Control's heartbeat route, it can automatically send a `SCHEDULE_REBOOT` fleet command to the NUC, causing the server to reboot N minutes later. The delay is configurable per location (default 15 minutes), giving any in-flight processes time to finish before the reboot. The feature is opt-in via an `AutoRebootCard` in the MC Config tab.

---

## Why This Exists

NUC servers running Node.js 24/7 accumulate memory over weeks of continuous operation. A nightly reboot keeps servers fresh without any service interruption, because the batch close happens after the venue closes and there are no active orders. Previously, reboots had to be scheduled manually via SSH or a one-off fleet command. This automates the pattern: batch closes → MC detects it → SCHEDULE_REBOOT dispatched → NUC reboots 15 minutes later.

---

## Architecture

```
NUC closes batch
    │
    ▼ POST /api/fleet/heartbeat (MC)
        batchStatus: 'closed', batchClosedAt: <new timestamp>

MC heartbeat route
    │
    ├─ Stores batch fields on ServerNode
    │
    └─ Auto-reboot check:
        if location.settings.autoReboot.enabled === true
        AND batchStatus === 'closed'
        AND batchClosedAt > prevLastBatchAt + 60s  ← new batch
            │
            └─ Create FleetCommand: SCHEDULE_REBOOT
               payload: { delayMinutes }
               expiresAt: now + 2h

SSE command stream → NUC sync agent
    │
    └─ SCHEDULE_REBOOT handler
        execSync(`sudo shutdown -r +${delayMinutes}`)
```

The 60-second gap check (`batchClosedAt > prevLastBatchAt + 60s`) prevents duplicate `SCHEDULE_REBOOT` commands from being queued on every heartbeat after the initial batch close detection.

---

## Location Settings

### `AutoRebootSettings` interface

```typescript
interface AutoRebootSettings {
  enabled: boolean
  delayMinutes: number  // 1–60, default 15
}
```

Stored as `location.settings.autoReboot` in the `CloudLocation.settings` JSON column.

**Defaults:**
```typescript
{ enabled: false, delayMinutes: 15 }
```

---

## Mission Control — Heartbeat Route

After storing batch fields, the route performs the auto-reboot check:

```typescript
const autoReboot = location.settings?.autoReboot ?? { enabled: false, delayMinutes: 15 }

if (
  autoReboot.enabled &&
  body.batchStatus === 'closed' &&
  body.batchClosedAt &&
  isNewBatch(body.batchClosedAt, prevLastBatchAt)   // > 60s gap
) {
  await prisma.fleetCommand.create({
    data: {
      serverNodeId: serverNode.id,
      command: 'SCHEDULE_REBOOT',
      payload: { delayMinutes: autoReboot.delayMinutes },
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),  // 2h expiry
    }
  })
}
```

The 2-hour expiry prevents stale reboot commands from executing if the NUC was offline during batch close and reconnects hours later.

---

## Mission Control — `AutoRebootCard` (Config Tab)

Located in the Location detail Config tab. Allows per-location control over the auto-reboot feature.

### UI elements

- Toggle switch: Enable / Disable auto-reboot after batch
- Delay minutes input: number field, range 1–60, shown only when enabled
- Save button: `PUT /api/admin/locations/[id]` with updated `settings.autoReboot`
- After save: queues a `DATA_CHANGED` fleet command so the NUC is notified to reload its settings cache

### Behavior

| State | Effect |
|-------|--------|
| Toggle OFF | No SCHEDULE_REBOOT commands created after batch close |
| Toggle ON, delay 15 | SCHEDULE_REBOOT queued with `{ delayMinutes: 15 }` on batch detect |
| Toggle ON, delay 5 | SCHEDULE_REBOOT queued with `{ delayMinutes: 5 }` — minimum delay |

---

## Sync Agent — Command Handlers

Both handlers were added in Skill 399. Documented here for completeness:

```javascript
case 'SCHEDULE_REBOOT': {
  const delayMinutes = payload?.delayMinutes ?? 15
  execSync(`sudo shutdown -r +${delayMinutes}`)
  ackCommand(commandId, 'scheduled')
  break
}

case 'CANCEL_REBOOT': {
  execSync('sudo shutdown -c')
  ackCommand(commandId, 'cancelled')
  break
}
```

The `CANCEL_REBOOT` command can be sent manually from Mission Control's fleet dashboard if an auto-reboot was triggered at an inconvenient time.

---

## Files Changed

### gwi-mission-control

| File | Change |
|------|--------|
| `src/app/api/fleet/heartbeat/route.ts` | Modified — auto-reboot check after storing batch fields; creates SCHEDULE_REBOOT FleetCommand |
| `src/components/fleet/AutoRebootCard.tsx` | New — toggle + delay minutes input, saves to location.settings.autoReboot, queues DATA_CHANGED |
| `src/app/(dashboard)/locations/[id]/config/page.tsx` | Modified — AutoRebootCard added to Config tab |
| `src/app/api/admin/locations/[id]/route.ts` | Modified — PUT accepts and stores `settings.autoReboot` |
| `src/types/location-settings.ts` | Modified — AutoRebootSettings interface added |

### gwi-pos (via Skill 399)

| File | Change |
|------|--------|
| `public/sync-agent.js` | SCHEDULE_REBOOT + CANCEL_REBOOT handlers (see Skill 399) |
| `public/installer.run` | sudoers: `/sbin/shutdown`, `/usr/sbin/shutdown` (see Skill 399) |

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| AutoRebootSettings type | MC `src/types/location-settings.ts` | Typed interface for settings JSON |
| Heartbeat auto-reboot trigger | MC `api/fleet/heartbeat/route.ts` | Creates SCHEDULE_REBOOT on new batch close |
| AutoRebootCard UI | MC `components/fleet/AutoRebootCard.tsx` | Per-location toggle + delay config |
| Config tab integration | MC location config page | AutoRebootCard visible in UI |
| Location PUT update | MC `api/admin/locations/[id]/route.ts` | Persists autoReboot settings |
| DATA_CHANGED fleet command | MC via AutoRebootCard save | NUC notified to reload settings |
| SCHEDULE_REBOOT handler | NUC `public/sync-agent.js` (Skill 399) | Executes `sudo shutdown -r +N` |
| CANCEL_REBOOT handler | NUC `public/sync-agent.js` (Skill 399) | Executes `sudo shutdown -c` |
