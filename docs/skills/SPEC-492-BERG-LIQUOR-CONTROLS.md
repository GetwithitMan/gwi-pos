# SPEC-492: Berg Liquor Controls Integration

> **Status: DONE** — Sprints 0 + A completed 2026-03-05.
> **Feature doc:** `docs/features/berg-integration.md`
> **Priority:** Medium
> **Dependencies:** Skill 52 (Liquor Build), Skill 128 (Inventory)

## Overview

Two-tier opt-in integration with Berg Electronic Control Unit (ECU) liquor dispensing hardware.

- **Tier 1 (Reports-Only):** No hardware required. Operators create PLU mappings between Berg dispenser PLU codes and GWI menu items or liquor products. A manual comparison report lets managers enter Berg's own pour totals and see variance against GWI POS sales — useful for identifying over-pours, spillage, or comping patterns without any physical connection.
- **Tier 2 (Hardware Bridge):** A standalone `berg-bridge.ts` PM2 process connects to the ECU via RS-232 serial cable, parses dispense events in real time, and pushes them into GWI via a secure HTTP POST. Each dispense event creates an immutable `BergDispenseEvent` audit record and — depending on the configured release mode — can auto-add items to open orders.

### Two-Tier Deployment Model

```
Tier 1 (always available when bergReportsEnabled = true)
  └── PLU Mapping CRUD (/settings/integrations/berg)
  └── Comparison Report with manual variance entry (/reports/berg-comparison)

Tier 2 (requires BERG_ENABLED env + hardware)
  └── berg-bridge.ts  ─── RS-232 ──► Berg ECU
         │
         ▼ HTTP POST /api/berg/dispense
  └── BergDispenseEvent audit record
  └── Pour mode logic (BEST_EFFORT | REQUIRES_OPEN_ORDER)
  └── Auto-ring to OrderItem (RING_AND_SLING mode — Sprint B)
```

---

## Enum Semantics

### BergInterfaceMethod
| Value | Meaning |
|-------|---------|
| `SERIAL_RS232` | Berg ECU connected via DB-9 RS-232 to USB adapter on NUC |
| `ETHERNET_TCP` | Future: ECU connected via Ethernet (not yet implemented) |

### BergPourReleaseMode
| Value | Meaning |
|-------|---------|
| `FREE_POUR` | ECU releases valve on button press immediately — no order check |
| `BEST_EFFORT` | Pour is logged; a matching open order is found and charged if possible, but pour is never blocked |
| `REQUIRES_OPEN_ORDER` | Pour is blocked at ECU until an open order with a matching item is found |
| `RING_AND_SLING` | Pour triggers auto-add of the matched item to the assigned open order (Sprint B) |

### BergTimeoutPolicy
| Value | Meaning |
|-------|---------|
| `FAIL_OPEN` | If GWI is unreachable, ECU releases pour anyway (never blocks service) |
| `FAIL_CLOSED` | If GWI is unreachable within timeout window, ECU blocks the pour |

### BergAutoRingMode
| Value | Meaning |
|-------|---------|
| `DISABLED` | No automatic order item creation |
| `ASSIGN_TO_CHECK` | Dispense event creates/assigns an OrderItem on the employee's current open order |
| `PROMPT_EMPLOYEE` | Future: prompt employee on terminal to confirm auto-ring before OrderItem is created |

---

## Operation Mode Presets (Planned UI — Sprint B)

| Preset Card | Settings Applied | Use Case |
|-------------|-----------------|----------|
| **Bar Friendly** | `BEST_EFFORT` + `FAIL_OPEN` + `DISABLED` auto-ring | Never blocks service; logs all dispenses for end-of-night comparison |
| **Maximum Control** | `REQUIRES_OPEN_ORDER` + `FAIL_CLOSED` + `ASSIGN_TO_CHECK` | Full accountability; blocks unauthorized pours; auto-charges every pour |
| **Log Only / Reports** | `FREE_POUR` + `FAIL_OPEN` + `DISABLED` auto-ring | Tier 1 equivalent with hardware; all pours logged, never blocked, no order integration |

---

## Code Locations

### gwi-pos — New Files
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/berg/lrc.ts` | LRC checksum calculation and validation for Berg packet protocol |
| `src/lib/berg/packet-parser.ts` | STX/ETX state machine parser for Berg serial protocol |
| `src/lib/berg/hmac.ts` | HMAC-SHA256 bridge authentication (berg-bridge → /api/berg/dispense) |
| `src/lib/berg/plu-resolver.ts` | PLU → MenuItem/BottleProduct resolution with scope hierarchy (device → location) |
| `scripts/berg-bridge.ts` | Standalone PM2 process: serial port management, packet parser, exponential reconnect backoff (1s→30s), NTP auto-fix on startup |
| `src/app/api/berg/plu-mappings/route.ts` | GET list + POST create — PLU mapping CRUD |
| `src/app/api/berg/plu-mappings/[id]/route.ts` | GET + PUT + DELETE — single mapping management |
| `src/app/api/berg/devices/route.ts` | GET list + POST create — BergDevice management |
| `src/app/api/berg/devices/[id]/route.ts` | PUT + DELETE — device configuration updates |
| `src/app/api/berg/detect-ports/route.ts` | GET — SerialPort.list() for UI auto-detect, guarded by BERG_ENABLED env |
| `src/app/api/berg/status/route.ts` | GET — per-device 24h stats, dedup rate alert (>5%), NTP check |
| `src/app/api/berg/dispense/route.ts` | POST — dispense event ingest: HMAC auth, idempotency, PLU resolution, pour mode logic |
| `src/app/api/reports/berg-comparison/route.ts` | GET — POS pour data per PLU, JSON + CSV export in Berg-compatible column format |
| `src/app/(admin)/settings/integrations/berg/page.tsx` | Settings UI: toggle, device management, port auto-detect, PLU mapping CRUD table |
| `src/app/(admin)/reports/berg-comparison/page.tsx` | Manual Comparison Mode: enter Berg totals → live delta with variance coloring |

### gwi-pos — Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `BergPluMapping`, `BergDevice`, `BergDispenseEvent` models + 7 enums + `bergReportsEnabled` on LocationSettings |
| `scripts/nuc-pre-migrate.js` | DDL for all new tables and enum types |
| `ecosystem.config.js` | `berg-bridge` PM2 app entry (disabled by default, requires BERG_ENABLED=true) |
| `next.config.ts` | `serialport` added to `serverExternalPackages` |
| `src/components/admin/AdminNav.tsx` | "Berg Controls" link (Settings) + "Berg Comparison" link (Reports) |

---

## Data Models

### BergPluMapping
```
BergPluMapping {
  id            String   @id @default(cuid())
  locationId    String
  pluCode       String                          // Berg ECU PLU number
  menuItemId    String?                         // linked GWI MenuItem
  bottleProductId String?                       // linked BottleProduct (legacy liquor)
  displayName   String?                         // friendly name for comparison report
  mappingScopeKey String  @unique               // "{locationId}:{pluCode}:{scope}" — prevents duplicate mappings
  scope         String   @default("location")   // "device" or "location"
  deviceId      String?                         // required when scope = "device"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### BergDevice
```
BergDevice {
  id                String              @id @default(cuid())
  locationId        String
  name              String                          // human-readable label (e.g. "Back Bar ECU")
  model             BergDeviceModel                 // MODEL_1504_704 | LASER | ALL_BOTTLE_ABID | TAP2 | FLOW_MONITOR
  interfaceMethod   BergInterfaceMethod             // SERIAL_RS232 | ETHERNET_TCP
  portPath          String?                         // e.g. "/dev/ttyUSB0"
  baudRate          Int     @default(9600)
  releaseMode       BergPourReleaseMode
  autoRingMode      BergAutoRingMode    @default(DISABLED)
  timeoutPolicy     BergTimeoutPolicy   @default(FAIL_OPEN)
  timeoutMs         Int     @default(3000)
  bridgeSecretHash  String?                         // bcrypt of one-time-displayed bridgeSecret
  terminalId        String?                         // employee terminal scope for RING_AND_SLING (maps to offlineTerminalId)
  isActive          Boolean @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

### BergDispenseEvent
```
BergDispenseEvent {
  id              String              @id @default(cuid())
  locationId      String
  deviceId        String
  pluCode         String
  volumeMl        Float?
  rawPacket       String                              // full hex-encoded packet — never mutated
  lrcValid        Boolean
  parseStatus     BergParseStatus                     // PARSED | PARTIAL | FAILED
  dispenseStatus  BergDispenseStatus                  // MATCHED | UNMATCHED | DEDUPED | ERROR
  unmatchedType   String?                             // freeform reason when dispenseStatus = UNMATCHED
  menuItemId      String?                             // resolved menu item (null if unmatched)
  orderId         String?                             // order auto-ringed to (null if not ringed)
  idempotencyKey  String  @unique                     // SHA-256(deviceId + pluCode + rawPacket + timestamp-window)
  businessDate    DateTime                            // from getCurrentBusinessDay()
  ackLatencyMs    Int?                                // time from packet receive to HTTP POST acknowledgment
  createdAt       DateTime @default(now())
}
```

---

## Bridge Architecture

The `berg-bridge.ts` process is a standalone Node.js service managed by PM2 (separate from the Next.js app). It:

1. Opens the configured serial port (from `BergDevice` records fetched at startup).
2. Feeds bytes into a **STX/ETX state machine parser** (`packet-parser.ts`): idle → reading → complete.
3. Validates each packet with **LRC checksum** (`lrc.ts`). Rejects corrupt packets and logs them.
4. Computes an **idempotency key** (SHA-256 of `deviceId + pluCode + rawPacket + timestamp-window`) to prevent double-counting if the serial port replays a packet.
5. Posts the dispense event to `/api/berg/dispense` with an **HMAC-SHA256 Authorization header** (`hmac.ts`). The `bridgeSecretHash` stored on `BergDevice` is verified server-side.
6. On connection failure: **exponential reconnect backoff** starting at 1s, doubling each attempt, capped at 30s.
7. On startup: checks system clock against NTP. If drift >500ms, logs a warning and attempts `ntpdate` correction.

The idempotency window is configurable via `BERG_IDEMPOTENCY_WINDOW_MS` env var (default: 2000ms). Two dispense events for the same PLU within the window from the same device are treated as duplicates.

---

## PLU Resolution Order

When a dispense event arrives, `plu-resolver.ts` resolves the PLU to a menu item using this priority chain:

1. Device-scoped `BergPluMapping` where `mappingScopeKey = "{locationId}:{pluCode}:device:{deviceId}"`
2. Location-scoped `BergPluMapping` where `mappingScopeKey = "{locationId}:{pluCode}:location"`
3. If no mapping found → `dispenseStatus = UNMATCHED`

---

## PLU Range Hints by Device Model

| Model | PLU Range | Notes |
|-------|-----------|-------|
| `MODEL_1504_704` | 1–1504 | Standard Berg 1504-button model |
| `LASER` | 1–704 | Laser-model ECU |
| `ALL_BOTTLE_ABID` | 1–999 | All-bottle ABID variant |
| `TAP2` | 1–64 | TAP2 draught controller |
| `FLOW_MONITOR` | 1–128 | Flow-only monitor (no valve control) |

These are advisory UI hints in the device settings form. Berg programming sheets (from ECU configuration software) are the authoritative source.

---

## Pre-Implementation Checklist

Before deploying Tier 2 on any NUC:

- [ ] **Serial cable pinout:** Confirm DB-9 null-modem vs straight-through with Berg tech sheet for the specific ECU model. Wrong pinout = no data.
- [ ] **PLU range from Berg programming sheet:** Request ECU programming report from Berg. PLU assignments must match before mapping table is built.
- [ ] **NTP verify:** Run `ntpq -p` on the NUC. Clock drift >500ms causes idempotency false positives.
- [ ] **node-gyp prereqs:** `serialport` is a native Node addon. NUC must have `build-essential` + `python3` installed. Run `npm rebuild` after any Node.js version change.
- [ ] **BERG_ENABLED=true** in NUC `.env` before starting berg-bridge PM2 process.
- [ ] **One-time bridgeSecret display:** After creating a BergDevice, copy the plaintext bridgeSecret from the UI immediately — it is hashed and never shown again.
- [ ] **Test with `FLOW_MONITOR` model first** on new sites — read-only, no valve control, safe for initial serial integration testing.

---

## Remaining Sprints

### Sprint B — Settings UI Completion
- Device CRUD polish (edit device form, inline port test)
- Test tools panel: "Listen Mode" — stream raw packets in real-time in the settings UI for debugging
- Mode preset cards UI (Bar Friendly / Maximum Control / Log Only) as clickable preset buttons
- `RING_AND_SLING` auto-ring: assign dispense event to open order by `terminalId → offlineTerminalId` scope

### Sprint C — Full Reporting Suite
- **Dispense Log:** paginated table of `BergDispenseEvent` records with filters (date, device, PLU, status, matched/unmatched)
- **Variance Report:** time-windowed POS sales vs Berg pour count per PLU — exportable CSV
- **Unmatched Pours Report:** list of `UNMATCHED` dispense events — helps operators identify unmapped PLUs
- **Health Report:** per-device uptime, LRC error rate, dedup rate, average ACK latency, NTP status

---

## Known Constraints

- `unmatchedType` is stored as `String?` (not an enum) to allow arbitrary reason strings from the bridge without requiring schema changes for new unmatched categories.
- `RING_AND_SLING` auto-ring is defined in schema and enum but the order-assignment logic is deferred to Sprint B. Attempting to configure it before Sprint B will not auto-ring — events will be logged as `MATCHED` but no `orderId` will be populated.
- **Double-deduction warning:** If `RING_AND_SLING` is wired and the Inventory Deduction Outbox (Sprint 0) is also active, a single pour could trigger both a Berg auto-ring OrderItem creation AND a standard inventory deduction on payment. Verify deduction outbox configuration before enabling `RING_AND_SLING`.
- `terminalId` on `BergDevice` is matched against `Terminal.offlineTerminalId` (not `Terminal.id`) to correctly scope auto-ring to the right physical terminal.
- Berg bridge is a **NUC-only** component — it cannot run on Vercel. `BERG_ENABLED` env var gates all serial-dependent routes at the Next.js API layer to prevent Vercel build errors from `serialport`.

*Last updated: 2026-03-05*
