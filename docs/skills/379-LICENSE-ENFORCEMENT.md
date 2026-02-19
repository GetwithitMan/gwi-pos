# Skill 379: Terminal License Enforcement

**Date:** February 19, 2026
**Domain:** Infrastructure / Licensing
**Status:** DONE

## Dependencies

- Skill 304: License Validation
- Skill 322: Hardware Limits
- Skill 376: Device Fleet Management

## Overview

POS-side enforcement of device limits derived from subscription tiers. When a venue attempts to create a new device (terminal, handheld, KDS screen, printer, or payment reader), the system checks the current count against the subscription limit. Uses a fail-open design: if limits are unavailable (sync agent down, network issue), device creation is always allowed to avoid bricking existing operations.

## Key Files

### POS (gwi-pos)

| File | Purpose |
|------|---------|
| `src/lib/license-enforcement.ts` | `checkDeviceLimit(type, locationId)` — core enforcement function. Reads limits from sync-agent status API. |

### Mission Control (gwi-mission-control)

| File | Purpose |
|------|---------|
| `DeviceInventoryCard.tsx` | UI card showing progress bars with count vs. limit per device type. Red at 80%+, warning icon at 100%. |

## Implementation Details

### POS License Enforcement (`src/lib/license-enforcement.ts`)

**`checkDeviceLimit(type, locationId)`**

- `type` — one of: `terminals`, `handhelds`, `kdsScreens`, `printers`, `paymentReaders`
- Reads hardware limits from the sync-agent status API at `http://localhost:8081/status`
- The sync agent caches the subscription tier limits received from Mission Control during license validation
- Compares the current device count for the given type against the limit

**Return value:**
- `{ allowed: true }` — creation permitted
- `{ allowed: false, reason: string, current: number, limit: number }` — creation blocked with details

**Fail-open design:**
- If the sync-agent status API is unreachable (timeout, connection refused), returns `{ allowed: true }`
- If the limits field is missing or malformed, returns `{ allowed: true }`
- Rationale: never brick existing devices or prevent a venue from operating due to a licensing infrastructure issue. The MC dashboard shows the overage for admin follow-up.

### Device Types and Limit Keys

| Device Type | Limit Key | Description |
|-------------|-----------|-------------|
| `terminals` | `maxPOSTerminals` | Fixed POS terminal stations |
| `handhelds` | `maxHandhelds` | Mobile handheld devices (phones/iPads) |
| `kdsScreens` | `maxKDSScreens` | Kitchen display screens |
| `printers` | `maxPrinters` | Receipt and kitchen printers |
| `paymentReaders` | `maxPaymentReaders` | Payment card readers |

### MC DeviceInventoryCard (Limit Visualization)

- Shows a progress bar for each device type: current count / subscription limit
- Progress bar color thresholds:
  - Green: 0-79% utilization
  - Amber/Red: 80%+ utilization (warning state)
  - Warning icon displayed at 100% (limit reached)
- Allows admins to see at a glance which device types are approaching or at their limit
- Links to subscription upgrade flow when limits are reached

## Testing / Verification

1. Under limit — create a device when count < limit, verify creation succeeds
2. At limit — attempt to create a device when count == limit, verify creation is blocked with appropriate error message
3. Over limit display — verify MC DeviceInventoryCard shows red progress bar and warning icon when at 100%
4. Fail-open — stop the sync agent, attempt device creation, verify it succeeds (fail-open)
5. Fail-open (malformed) — corrupt the status response, verify device creation still succeeds
6. Progress bar thresholds — verify green at 50%, amber/red at 80%, warning icon at 100%
7. All device types — verify enforcement works for each of the 5 device types independently

## Related Skills

- **Skill 304**: License Validation — subscription tier validation from MC
- **Skill 322**: Hardware Limits — defines the limit values per subscription tier
- **Skill 376**: Device Fleet Management — device inventory tracking and reporting
