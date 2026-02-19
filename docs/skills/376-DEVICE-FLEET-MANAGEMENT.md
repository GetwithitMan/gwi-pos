# Skill 376: Device Fleet Management

**Date:** February 19, 2026
**Domain:** Infrastructure / Fleet Management
**Status:** DONE

## Dependencies

- Skill 303: Heartbeat
- Skill 322: Hardware Limits
- Skill 345: Installer

## Overview

Device inventory sync from POS locations to Mission Control via the heartbeat pipeline. Each NUC reports its connected devices (terminals, handhelds, KDS screens, printers, payment readers) as part of its regular heartbeat. Mission Control persists this inventory and exposes it through an admin API and UI card with progress bars showing usage against subscription-tier hardware limits.

## Key Files

### POS (gwi-pos)

| File | Purpose |
|------|---------|
| `src/app/api/internal/device-inventory/route.ts` | Internal API endpoint queried by the sync agent. Returns counts and details for Terminal, KDSScreen, Printer, and PaymentReader models. |

### Mission Control (gwi-mission-control)

| File | Purpose |
|------|---------|
| `heartbeat.ts` (sync-agent) | `fetchDeviceInventory()` — calls POS internal endpoint with 3s timeout, includes device inventory in heartbeat request body. |
| Heartbeat route | Extended Zod schema to validate incoming device inventory. Persists to `ServerNode.deviceInventory`, `ServerNode.deviceCounts`, and `ServerNode.deviceInventoryAt`. |
| Prisma schema | Added `deviceInventory Json?`, `deviceCounts Json?`, `deviceInventoryAt DateTime?` fields on the `ServerNode` model. |
| `GET /api/admin/locations/[id]/devices` | Admin API — returns devices, counts, and resolved hardware limits via `resolveHardwareLimits()`. |
| `DeviceInventoryCard.tsx` | UI card displaying device counts vs. limits with progress bars, status dots, and relative timestamps. |

## Implementation Details

### POS Internal API (`/api/internal/device-inventory`)

- Queries four Prisma models: `Terminal`, `KDSScreen`, `Printer`, `PaymentReader`
- Returns structured JSON with device arrays and summary counts
- Internal-only endpoint (not exposed externally, called by local sync agent)

### Sync Agent Heartbeat Integration

- `fetchDeviceInventory()` calls `http://localhost:3005/api/internal/device-inventory` with a 3-second timeout
- On timeout or error, heartbeat still sends without device inventory (graceful degradation)
- Device inventory payload is included in the heartbeat body alongside existing CPU/memory/disk metrics

### MC Heartbeat Route (Schema Extension)

- Extended the Zod validation schema to accept optional `deviceInventory` and `deviceCounts` fields
- On successful validation, persists to three `ServerNode` columns:
  - `deviceInventory` — full device detail JSON (names, IPs, types, statuses)
  - `deviceCounts` — summary counts per device type
  - `deviceInventoryAt` — timestamp of when inventory was last reported

### MC Admin API (`GET /api/admin/locations/[id]/devices`)

- Returns the persisted device inventory, counts, and timestamp
- Calls `resolveHardwareLimits()` to determine the subscription tier limits for each device type
- Response shape: `{ devices, counts, limits, inventoryAt }`

### MC UI: DeviceInventoryCard

- `SECTION_CONFIG` maps device types to their hardware limit keys:
  - `terminals` -> `maxPOSTerminals`
  - `handhelds` -> `maxHandhelds`
  - `kdsScreens` -> `maxKDSScreens`
  - `printers` -> `maxPrinters`
  - `paymentReaders` -> `maxPaymentReaders`
- `ProgressBar` component shows usage fraction with warning styling at 80%+ utilization
- `StatusDot` component shows green/amber/red based on device connectivity
- `formatRelativeTime()` helper converts `deviceInventoryAt` to human-readable relative time (e.g., "2 minutes ago")

## Testing / Verification

1. NUC heartbeat includes device inventory — check MC server node record for `deviceInventory` populated
2. POS internal endpoint returns correct device counts — `curl http://localhost:3005/api/internal/device-inventory`
3. MC admin API returns devices with resolved limits — `GET /api/admin/locations/[id]/devices`
4. DeviceInventoryCard renders progress bars correctly — verify at 0%, 50%, 80%, 100% thresholds
5. Graceful degradation — stop POS server, confirm heartbeat still sends without device inventory
6. Relative time display — confirm `formatRelativeTime` shows correct "X minutes ago" text

## Related Skills

- **Skill 303**: Heartbeat — base heartbeat infrastructure this extends
- **Skill 322**: Hardware Limits — subscription-tier device limits used for progress bar caps
- **Skill 345**: Installer — provisions NUCs that report device inventory
