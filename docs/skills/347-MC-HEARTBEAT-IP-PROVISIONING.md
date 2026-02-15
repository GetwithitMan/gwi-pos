# Skill 347: MC Heartbeat IP Display & Auto-Provisioning

**Status:** DONE
**Domain:** Mission Control
**Created:** 2026-02-14
**Dependencies:** Skill 303 (Heartbeat Ingestion), Skill 345 (NUC Installer Package)

## Summary

Enhanced the Mission Control heartbeat API to accept `posLocationId` and auto-provision the CloudLocation record. Added local IP address display to all server management UIs (admin dashboard, venue portal, portal server list).

## Problem

1. **No IP visibility**: Server nodes reported their local IP in heartbeats, but no UI displayed it. Admins couldn't see which NUC had which LAN address without SSH.
2. **Manual provisioning**: After a NUC registered and sent its first heartbeat, the CloudLocation record still showed `posProvisioned: false` and `posLocationId: null`. An admin had to manually mark it provisioned.

## Solution

### Auto-Provisioning
The heartbeat API now accepts `posLocationId` in the payload. On first heartbeat with a valid `posLocationId`, the API automatically sets:
- `CloudLocation.posLocationId` = the POS Location ID
- `CloudLocation.posProvisioned` = true

Uses `updateMany` with an OR condition to only trigger once (when posLocationId is null OR posProvisioned is false).

### IP Display
Added `localIp` display to three server management views:
- Admin location detail page (server cards)
- Venue admin servers page (metrics grid)
- Portal server list (table column)

## Deliverables

| # | File | Repo | Description |
|---|------|------|-------------|
| 1 | `src/app/api/fleet/heartbeat/route.ts` | MC | Accept `posLocationId`, auto-provision CloudLocation |
| 2 | `src/app/venue/[slug]/admin/servers/page.tsx` | MC | Display localIp in server subtitle + metrics |
| 3 | `src/components/admin/ServerActions.tsx` | MC | Display localIp in server info line |
| 4 | `src/app/dashboard/locations/[id]/page.tsx` | MC | Pass localIp through to ServerActions |
| 5 | `src/components/portal/PortalServerList.tsx` | MC | Add IP Address column to table |
| 6 | `src/app/portal/servers/page.tsx` | MC | Pass localIp through to PortalServerList |

## API Changes

### Heartbeat Zod Schema (Updated)

```typescript
const HeartbeatSchema = z.object({
  version: z.string(),
  uptime: z.number().int().nonneg(),
  activeOrders: z.number().int().nonneg(),
  cpuPercent: z.number().min(0).max(100),
  memoryUsedMb: z.number().nonneg(),
  memoryTotalMb: z.number().nonneg(),
  diskUsedGb: z.number().nonneg(),
  diskTotalGb: z.number().nonneg(),
  localIp: z.string().optional(),        // Already existed
  posLocationId: z.string().optional(),   // NEW — POS Location ID
})
```

### Auto-Provisioning Logic

```typescript
// After heartbeat transaction completes...
if (body.posLocationId) {
  await db.cloudLocation.updateMany({
    where: {
      id: locationId,
      OR: [
        { posLocationId: null },
        { posProvisioned: false },
      ],
    },
    data: {
      posLocationId: body.posLocationId,
      posProvisioned: true,
    },
  })
}
```

Key design decisions:
- **`updateMany` not `update`**: Avoids throwing if no rows match the OR condition
- **OR condition**: Only triggers when not yet provisioned (idempotent)
- **After transaction**: Doesn't block the heartbeat response if this fails
- **No error on failure**: If posLocationId is wrong or already set, heartbeat still succeeds

## UI Changes

### Admin Location Detail (`/dashboard/locations/[id]`)
- `serverRows` mapping now includes `localIp: node.localIp`
- Passed to `ServerActions` component

### ServerActions Component
- Added `localIp: string | null` to `ServerRow` interface
- Displays IP in the server info line: `{server.localIp && <span>{server.localIp}</span>}`
- Shows alongside status, version, and last heartbeat time

### Venue Admin Servers (`/venue/[slug]/admin/servers`)
- Server subtitle: `{server.localIp && <> · {server.localIp}</>}` after hostname
- Metrics grid expanded from 5 to 6 columns
- New "Local IP" metric card: `{server.localIp ?? 'N/A'}`

### Portal Server List (`/portal/servers`)
- Added `localIp: string | null` to `ServerRow` interface
- New "IP Address" table header column
- IP cell with monospace font: `font-mono text-xs text-gray-500`
- Shows `'-'` when IP is null

## Data Flow

```
NUC heartbeat.sh                    MC /api/fleet/heartbeat          MC UI
      │                                      │                         │
      ├── localIp = hostname -I              │                         │
      ├── posLocationId = $LOCATION_ID       │                         │
      │                                      │                         │
      ├── POST heartbeat ──────────────────►│                         │
      │                                      ├── Save to ServerHeartbeat│
      │                                      ├── Update ServerNode.localIp
      │                                      ├── If posLocationId:     │
      │                                      │   Set CloudLocation     │
      │                                      │   .posLocationId        │
      │                                      │   .posProvisioned=true  │
      │                                      │                         │
      │                                      │    ─── Page load ──────►│
      │                                      │                         ├── Display localIp
      │                                      │                         │   in all server UIs
```

## Schema (No Changes)

The MC schema already had the necessary fields:
- `ServerNode.localIp` — Updated on every heartbeat
- `ServerHeartbeat.localIp` — Stored per heartbeat record
- `CloudLocation.posLocationId` — Now auto-populated
- `CloudLocation.posProvisioned` — Now auto-set to true

## Related Skills

- **Skill 303**: Heartbeat Ingestion (base heartbeat API)
- **Skill 345**: NUC Installer Package (sends localIp + posLocationId in heartbeat)
- **Skill 329**: Venue Provisioning locationId Handoff (original posLocationId flow via registration)
