# Feature: Berg Liquor Controls Integration

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find "Berg Liquor Controls" → read every listed dependency doc.

## Summary

Two-tier opt-in integration with Berg ECU liquor dispensing hardware. Tier 1 (reports-only) requires zero hardware and is available immediately when `bergReportsEnabled` is toggled on. Tier 2 adds a live RS-232 serial bridge for real-time dispense event capture.

**Three data flows:**
1. **PLU Mapping** — operators map Berg PLU codes to GWI menu items or liquor products (Tier 1 + 2)
2. **Comparison Report** — manual variance mode: enter Berg's own pour totals → see delta against GWI POS sales (Tier 1)
3. **Live Dispense Events** — berg-bridge.ts serial service captures each pour → idempotent POST to `/api/berg/dispense` → immutable `BergDispenseEvent` audit record → optional auto-ring to open order (Tier 2)

## Status

`Active` (Tier 1 + Tier 2 foundation built — Sprints B + C pending)

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | All APIs, berg-bridge serial service, settings UI, comparison report | Full |
| `gwi-android-register` | N/A — Berg sync is server-initiated | None |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path | Who Accesses |
|-----------|------|--------------|
| Admin — Settings | `/settings/integrations/berg` | Managers / Admins |
| Admin — Reports | `/reports/berg-comparison` | Managers / Admins |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/berg/lrc.ts` | LRC checksum calculation and validation |
| `src/lib/berg/packet-parser.ts` | STX/ETX state machine parser for Berg serial protocol |
| `src/lib/berg/hmac.ts` | HMAC-SHA256 bridge authentication |
| `src/lib/berg/plu-resolver.ts` | PLU → MenuItem/BottleProduct resolution with device/location scope hierarchy |
| `scripts/berg-bridge.ts` | Standalone PM2 serial service: packet parser, reconnect backoff, NTP auto-fix |
| `src/app/api/berg/plu-mappings/route.ts` | GET + POST — PLU mapping CRUD |
| `src/app/api/berg/plu-mappings/[id]/route.ts` | GET + PUT + DELETE — single mapping |
| `src/app/api/berg/devices/route.ts` | GET + POST — BergDevice management |
| `src/app/api/berg/devices/[id]/route.ts` | PUT + DELETE — device config |
| `src/app/api/berg/detect-ports/route.ts` | GET — SerialPort.list() for UI auto-detect (BERG_ENABLED guarded) |
| `src/app/api/berg/status/route.ts` | GET — per-device 24h stats, dedup rate alert, NTP check |
| `src/app/api/berg/dispense/route.ts` | POST — dispense ingest: HMAC auth, idempotency, PLU resolution, pour mode |
| `src/app/api/reports/berg-comparison/route.ts` | GET — POS pour data per PLU, JSON + CSV export |
| `src/app/(admin)/settings/integrations/berg/page.tsx` | Toggle, device management, port auto-detect, PLU mapping CRUD |
| `src/app/(admin)/reports/berg-comparison/page.tsx` | Manual Comparison Mode with variance coloring |

---

## Data Models

### BergPluMapping
```
id              String    @id
locationId      String
pluCode         String    — Berg ECU PLU number
menuItemId      String?   — linked GWI MenuItem
bottleProductId String?   — linked BottleProduct (legacy liquor)
displayName     String?   — friendly name for comparison report
mappingScopeKey String    @unique — "{locationId}:{pluCode}:{scope}" dedup key
scope           String    — "device" or "location"
deviceId        String?   — required when scope = "device"
```

### BergDevice
```
id               String              @id
locationId       String
name             String              — human label (e.g. "Back Bar ECU")
model            BergDeviceModel     — MODEL_1504_704 | LASER | ALL_BOTTLE_ABID | TAP2 | FLOW_MONITOR
interfaceMethod  BergInterfaceMethod — SERIAL_RS232 | ETHERNET_TCP
portPath         String?             — e.g. "/dev/ttyUSB0"
baudRate         Int                 @default(9600)
releaseMode      BergPourReleaseMode — FREE_POUR | BEST_EFFORT | REQUIRES_OPEN_ORDER | RING_AND_SLING
autoRingMode     BergAutoRingMode    — DISABLED | ASSIGN_TO_CHECK | PROMPT_EMPLOYEE
timeoutPolicy    BergTimeoutPolicy   — FAIL_OPEN | FAIL_CLOSED
timeoutMs        Int                 @default(3000)
bridgeSecretHash String?             — bcrypt of one-time-displayed bridgeSecret
terminalId       String?             — maps to Terminal.offlineTerminalId for RING_AND_SLING scope
isActive         Boolean             @default(true)
```

### BergDispenseEvent
```
id             String              @id
locationId     String
deviceId       String
pluCode        String
volumeMl       Float?
rawPacket      String              — full hex-encoded packet (immutable)
lrcValid       Boolean
parseStatus    BergParseStatus     — PARSED | PARTIAL | FAILED
dispenseStatus BergDispenseStatus  — MATCHED | UNMATCHED | DEDUPED | ERROR
unmatchedType  String?             — freeform reason when UNMATCHED
menuItemId     String?             — resolved menu item
orderId        String?             — order auto-ringed to
idempotencyKey String              @unique — SHA-256(deviceId+pluCode+rawPacket+window)
businessDate   DateTime            — from getCurrentBusinessDay()
ackLatencyMs   Int?
createdAt      DateTime            @default(now())
```

### LocationSettings (existing — new field)
```
bergReportsEnabled  Boolean  — Tier 1 toggle; gates PLU CRUD + comparison report
```

---

## API Routes

### Tier 1 — Settings & Reporting
| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/berg/plu-mappings` | withVenue | List all PLU mappings for location |
| POST | `/api/berg/plu-mappings` | SETTINGS_EDIT | Create new PLU mapping |
| GET | `/api/berg/plu-mappings/[id]` | withVenue | Get single mapping |
| PUT | `/api/berg/plu-mappings/[id]` | SETTINGS_EDIT | Update mapping |
| DELETE | `/api/berg/plu-mappings/[id]` | SETTINGS_EDIT | Delete mapping |
| GET | `/api/reports/berg-comparison` | REPORTS_VIEW | POS pour data per PLU (JSON or CSV) |

### Tier 2 — Hardware Management
| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/berg/devices` | withVenue | List BergDevice records |
| POST | `/api/berg/devices` | SETTINGS_EDIT | Create device config |
| PUT | `/api/berg/devices/[id]` | SETTINGS_EDIT | Update device config |
| DELETE | `/api/berg/devices/[id]` | SETTINGS_EDIT | Remove device |
| GET | `/api/berg/detect-ports` | SETTINGS_EDIT | List available serial ports (BERG_ENABLED only) |
| GET | `/api/berg/status` | withVenue | Per-device 24h health stats |
| POST | `/api/berg/dispense` | HMAC (bridge auth) | Ingest dispense event from berg-bridge |

---

## Business Logic

### Pour Release Modes
| Mode | Behavior |
|------|----------|
| `FREE_POUR` | ECU dispenses freely; events are logged passively |
| `BEST_EFFORT` | Dispense always allowed; GWI matches to open order when possible |
| `REQUIRES_OPEN_ORDER` | Bridge withholds ACK until matching open order found; ECU blocks pour on timeout |
| `RING_AND_SLING` | Matched dispense auto-creates OrderItem on employee's open order (Sprint B) |

### Idempotency
- Key: `SHA-256(deviceId + pluCode + rawPacket + timestamp-window)`
- Window configurable via `BERG_IDEMPOTENCY_WINDOW_MS` env var (default: 2000ms)
- Events within the window with the same key are marked `DEDUPED` and not double-counted
- `BergDispenseEvent.idempotencyKey` has a `@unique` constraint — DB-level duplicate guard

### PLU Resolution Order
1. Device-scoped `BergPluMapping` (scope = `"device"`, matching `deviceId`)
2. Location-scoped `BergPluMapping` (scope = `"location"`)
3. No match → `dispenseStatus = UNMATCHED`, `unmatchedType` records reason

### Comparison Report (Tier 1 Manual Mode)
- Manager loads the report page and manually enters Berg's own pour counts per PLU (taken from Berg's onboard report printer or ECU software export)
- GWI calculates POS pour counts from sales data using PLU mapping
- Variance = Berg count minus GWI count; colored green (within tolerance) or red (significant variance)
- CSV export uses Berg-compatible column format to allow side-by-side comparison with Berg's own exports

---

## Known Constraints

- **`unmatchedType` is a `String?`** — not an enum. This allows the bridge to send arbitrary reason codes without requiring schema migrations for new unmatched categories.
- **`RING_AND_SLING` is deferred to Sprint B.** Configuring it before Sprint B will log events as `MATCHED` but will NOT populate `orderId` or create OrderItems.
- **Double-deduction risk:** If `RING_AND_SLING` is enabled alongside the Inventory Deduction Outbox, a single pour may trigger both a Berg auto-ring AND a standard inventory deduction at payment. Review deduction outbox config before enabling `RING_AND_SLING`.
- **`terminalId` maps to `Terminal.offlineTerminalId`** (not `Terminal.id`) for RING_AND_SLING order scope assignment.
- **NUC-only bridge:** `berg-bridge.ts` cannot run on Vercel. `BERG_ENABLED` env var gates serial-dependent routes to prevent Vercel build failures.
- **node-gyp required:** `serialport` is a native Node addon. `build-essential` + `python3` must be installed on the NUC, and `npm rebuild` must run after any Node.js version change.
- **One-time bridgeSecret display:** After device creation, the plaintext `bridgeSecret` is shown once in the settings UI. It is then hashed and never retrievable — treat like a password.

---

## Cross-Feature Dependencies

| Feature | How It Depends |
|---------|---------------|
| **Liquor** | `BergPluMapping` links `pluCode` to `BottleProduct` (via `bottleProductId`) or `MenuItem` for PLU resolution |
| **Inventory** | Deduction Outbox must be configured carefully alongside `RING_AND_SLING` to avoid double-deduction |
| **Orders** | `RING_AND_SLING` auto-ring writes an `OrderItem` to an open order; requires `orderId` scope matching via `terminalId` |
| **Settings** | `bergReportsEnabled` flag in `LocationSettings` gates all Tier 1 features; `BergDevice` config lives in dedicated table (not `Location.settings` JSON) |
| **Reports** | Berg Comparison Report is a new report under `/reports/berg-comparison`; Sprint C will add Dispense Log, Variance, Unmatched Pours, and Health reports |

---

## Permissions Required

| Action | Permission |
|--------|-----------|
| View PLU mappings, comparison report, device list, status | `withVenue` (no employee permission) |
| Create/edit/delete PLU mappings and devices | `SETTINGS_EDIT` |
| Access detect-ports endpoint | `SETTINGS_EDIT` |

---

## Setup Checklist

- [ ] Toggle `bergReportsEnabled` on in `/settings/integrations/berg`
- [ ] Build PLU mapping table (match Berg PLU codes to GWI menu items)
- [ ] Run Berg Comparison Report in Manual Mode to verify mapping accuracy
- [ ] (Tier 2 only) Confirm serial cable pinout with Berg tech sheet
- [ ] (Tier 2 only) Verify NUC has `build-essential` + `python3` for `serialport` native build
- [ ] (Tier 2 only) Set `BERG_ENABLED=true` in NUC `.env`
- [ ] (Tier 2 only) Create `BergDevice` record in settings UI — copy the one-time bridgeSecret
- [ ] (Tier 2 only) Start `berg-bridge` PM2 process: `pm2 start ecosystem.config.js --only berg-bridge`
- [ ] (Tier 2 only) Verify `/api/berg/status` shows `connected: true` and `lrcErrorRate < 5%`

---

## Remaining Work

### Sprint B — Settings UI Completion
- Device CRUD polish, inline port test button
- "Listen Mode" test tools panel (stream raw packets in settings UI)
- Mode preset cards UI (Bar Friendly / Maximum Control / Log Only)
- `RING_AND_SLING` order assignment logic via `terminalId → offlineTerminalId`

### Sprint C — Full Reporting Suite
- Dispense Log (paginated `BergDispenseEvent` table with filters)
- Variance Report (time-windowed POS vs Berg pour counts per PLU)
- Unmatched Pours Report (filter `dispenseStatus = UNMATCHED`)
- Health Report (per-device uptime, LRC error rate, dedup rate, ACK latency, NTP status)

---

## Related Docs

- `docs/skills/SPEC-492-BERG-LIQUOR-CONTROLS.md` — Full technical implementation spec
- `docs/features/liquor.md` — Liquor management, BottleProduct model
- `docs/features/inventory.md` — Deduction Outbox, InventoryItem
- `docs/features/orders.md` — OrderItem creation (relevant for RING_AND_SLING)
- `docs/features/reports.md` — Report architecture
