# Feature: Hardware

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Hardware manages all physical devices connected to the POS system: thermal receipt printers, impact kitchen printers, card readers (Datacap VP3300/VP3350), KDS screens, cash drawers, scales, and barcode scanners. It handles device configuration, print routing with priority-based failover, ESC/POS protocol communication, KDS device pairing with security tokens, and remote hardware commands via the `HardwareCommand` model.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, ESC/POS engine, print routing | Full |
| `gwi-android-register` | Full hardware stack (readers, printers, scales, barcode) | Full |
| `gwi-cfd` | Display device (PAX A3700) | Partial |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | Terminal fleet management | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/hardware` | Managers |
| Admin | `/settings/hardware/printers` | Managers |
| Admin | `/settings/hardware/kds-screens` | Managers |
| Admin | `/settings/hardware/terminals` | Managers |
| Admin | `/settings/hardware/routing` | Managers |
| Admin | `/settings/hardware/payment-readers` | Managers |
| Admin | `/settings/hardware/cfd` | Managers |
| Admin | `/settings/hardware/scales` | Managers |
| Admin | `/settings/hardware/prep-stations` | Managers |
| Admin | `/settings/hardware/health` | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/hardware/printers/route.ts` | Printer CRUD (GET/POST) |
| `src/app/api/hardware/printers/[id]/route.ts` | Single printer (PUT/DELETE) |
| `src/app/api/hardware/printers/[id]/ping/route.ts` | Test printer connectivity |
| `src/app/api/hardware/printers/[id]/test/route.ts` | Print test page |
| `src/app/api/hardware/print-routes/route.ts` | Print route CRUD |
| `src/app/api/hardware/print-routes/[id]/route.ts` | Single print route |
| `src/app/api/hardware/print-routes/[id]/test/route.ts` | Test print route |
| `src/app/api/hardware/kds-screens/route.ts` | KDS screen CRUD |
| `src/app/api/hardware/kds-screens/[id]/route.ts` | Single KDS screen |
| `src/app/api/hardware/kds-screens/pair/route.ts` | KDS pairing |
| `src/app/api/hardware/kds-screens/auth/route.ts` | KDS authentication |
| `src/app/api/hardware/kds-screens/[id]/generate-code/route.ts` | Generate pairing code |
| `src/app/api/hardware/kds-screens/[id]/unpair/route.ts` | Unpair KDS |
| `src/app/api/hardware/kds-screens/[id]/heartbeat/route.ts` | KDS heartbeat |
| `src/app/api/hardware/terminals/route.ts` | Terminal CRUD |
| `src/app/api/hardware/terminals/[id]/route.ts` | Single terminal |
| `src/app/api/hardware/terminals/pair/route.ts` | Web terminal pairing |
| `src/app/api/hardware/terminals/pair-native/route.ts` | Android terminal pairing |
| `src/app/api/hardware/terminals/heartbeat/route.ts` | Web heartbeat |
| `src/app/api/hardware/terminals/heartbeat-native/route.ts` | Android heartbeat |
| `src/app/api/hardware/terminals/[id]/pair-cfd/route.ts` | CFD device pairing |
| `src/app/api/hardware/terminals/[id]/unpair/route.ts` | Unpair terminal |
| `src/app/api/hardware/terminals/[id]/generate-code/route.ts` | Generate pairing code |
| `src/app/api/hardware/payment-readers/route.ts` | Payment reader CRUD |
| `src/app/api/hardware/payment-readers/[id]/route.ts` | Single reader |
| `src/app/api/hardware/payment-readers/scan/route.ts` | Scan for readers |
| `src/app/api/hardware/payment-readers/[id]/ping/route.ts` | Test reader connectivity |
| `src/app/api/hardware/payment-readers/[id]/verify/route.ts` | Verify reader identity |
| `src/app/api/hardware/payment-readers/[id]/cloud/process/route.ts` | Cloud payment processing |
| `src/app/api/hardware/payment-readers/[id]/cloud/cancel/route.ts` | Cancel cloud transaction |
| `src/app/api/hardware/payment-readers/[id]/cloud/device/info/route.ts` | Cloud device info |
| `src/app/api/hardware/readers/health/route.ts` | Reader health check |
| `src/app/api/hardware/cfd-settings/route.ts` | CFD display settings |
| `src/app/api/print/kitchen/route.ts` | Kitchen ticket generation |
| `src/app/api/print/direct/route.ts` | Direct raw print |
| `src/app/api/print/cash-drawer/route.ts` | Cash drawer kick |
| `src/app/api/print/daily-report/route.ts` | Print daily report |
| `src/app/api/print/shift-closeout/route.ts` | Print shift closeout |
| `src/lib/escpos/commands.ts` | ESC/POS command constants |
| `src/lib/escpos/document.ts` | Document building utilities |
| `src/lib/escpos/daily-report-receipt.ts` | Daily report receipt builder |
| `src/lib/escpos/shift-closeout-receipt.ts` | Shift closeout receipt builder |
| `src/lib/printer-connection.ts` | TCP socket connection to printers |
| `src/types/printer-settings.ts` | Printer settings types |
| `src/types/pizza-print-settings.ts` | Pizza print settings types |
| `src/types/print-route-settings.ts` | Route-specific settings |
| `src/components/hardware/PrintRouteEditor.tsx` | Route editor with live preview |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET/POST` | `/api/hardware/printers` | Manager | Printer CRUD |
| `PUT/DELETE` | `/api/hardware/printers/[id]` | Manager | Single printer |
| `POST` | `/api/hardware/printers/[id]/ping` | Manager | Test connectivity (TCP) |
| `POST` | `/api/hardware/printers/[id]/test` | Manager | Print test page |
| `GET/POST` | `/api/hardware/print-routes` | Manager | Print route CRUD |
| `PUT/DELETE` | `/api/hardware/print-routes/[id]` | Manager | Single route |
| `POST` | `/api/hardware/print-routes/[id]/test` | Manager | Test route |
| `GET/POST` | `/api/hardware/kds-screens` | Manager | KDS screen CRUD |
| `POST` | `/api/hardware/kds-screens/pair` | Manager | Pair KDS device |
| `POST` | `/api/hardware/kds-screens/auth` | Device token | KDS authenticate |
| `GET/POST` | `/api/hardware/terminals` | Manager | Terminal CRUD |
| `POST` | `/api/hardware/terminals/pair` | Manager | Pair web terminal |
| `POST` | `/api/hardware/terminals/pair-native` | Manager | Pair Android terminal |
| `POST` | `/api/hardware/terminals/heartbeat` | Terminal | Web heartbeat |
| `POST` | `/api/hardware/terminals/heartbeat-native` | Terminal | Android heartbeat |
| `POST/DELETE` | `/api/hardware/terminals/[id]/pair-cfd` | Manager | CFD pairing |
| `GET/POST` | `/api/hardware/payment-readers` | Manager | Reader CRUD |
| `POST` | `/api/hardware/payment-readers/scan` | Manager | USB/network scan |
| `GET/PUT` | `/api/hardware/cfd-settings` | Manager | CFD display settings |
| `POST` | `/api/print/kitchen` | Employee PIN | Kitchen ticket |
| `POST` | `/api/print/direct` | Employee PIN | Raw print command |
| `POST` | `/api/print/cash-drawer` | Employee PIN | Open cash drawer |
| `POST` | `/api/print/daily-report` | Manager | Print daily report |
| `POST` | `/api/print/shift-closeout` | Manager | Print shift closeout |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `terminal:status_changed` | `{ terminalId, status, name }` | Terminal connect/disconnect/heartbeat |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `terminal:ping` | Android / Web | Keep-alive heartbeat |
| `terminal:config-update` | Mission Control | Remote config push |

---

## Data Model

```
Printer {
  id, locationId, name, printerType, model
  ipAddress, port (default 9100)
  printerRole (kitchen/receipt/label)
  isDefault, paperWidth (80/40mm), supportsCut
}

PrintRoute {
  id, locationId, name, routeType, isActive, priority
  categoryIds (Json), itemTypes (Json), stationId
  printerId (primary), backupPrinterId (failover)
}

PaymentReader {
  id, locationId, name, serialNumber, ipAddress, port
  connectionType (USB/IP/BLUETOOTH/WIFI)
  deviceType (PAX/INGENICO/IDTECH)
  communicationMode (local/cloud/simulated)
}

Terminal {
  id, locationId, name, category (FIXED_STATION/HANDHELD/KDS/CFD_DISPLAY)
  deviceToken, pairingCode, pairingCodeExpiresAt
  cfdTerminalId (FK → paired CFD)
}

HardwareCommand {
  id, locationId, commandType, targetDeviceId
  payload (Json), status (PENDING/PROCESSING/COMPLETED/FAILED)
  resultPayload (Json), expiresAt (60s TTL)
}

KdsScreen {
  id, locationId, name, deviceToken
  tags (Json), stationId
}
```

---

## Business Logic

### Print Flow
1. API route receives print request (kitchen ticket, receipt, etc.)
2. Print route engine resolves target printer by category/item type/station
3. ESC/POS document builder generates command bytes
4. TCP connection opened to printer IP:port (default 9100)
5. Command bytes sent, connection closed
6. If primary printer fails, backup printer attempted

### Device Pairing Flow
1. Admin creates device record (terminal, KDS, payment reader)
2. System generates 6-digit pairing code with expiry
3. Device enters pairing code on its screen
4. Server validates code, issues persistent `deviceToken`
5. All subsequent requests authenticate via `deviceToken`

### Edge Cases & Business Rules
- Print calls MUST be fire-and-forget — TCP timeout is 5–7+ seconds if printer offline
- NEVER await print before clearing UI — call `printKitchenTicket(id).catch(() => {})`
- Per-modifier print routing configured per modifier group
- Card readers: VP3300 (USB) and VP3350 (USB + Bluetooth) — Datacap only
- Cash drawer opens via ESC/POS kick command through receipt printer
- KDS heartbeat every 30s; marked offline after 60s stale

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| KDS | KDS screens are hardware devices — pairing, heartbeat |
| CFD | CFD display is a paired terminal device |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Receipt printing triggered on payment |
| Payments | Card reader used for transactions, receipt printer for receipts |
| KDS | Kitchen ticket print routing |
| Menu | Per-modifier print routing configuration |
| Settings | Hardware configuration stored in location settings |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **KDS** — device pairing changes affect KDS screens
- [ ] **Payments** — card reader changes affect payment flow
- [ ] **Orders** — print route changes affect kitchen ticket routing
- [ ] **CFD** — terminal pairing changes affect CFD display
- [ ] **Offline** — print must work when NUC is offline from cloud

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View hardware | `HARDWARE_VIEW` | Standard |
| Configure printers | `HARDWARE_MANAGE` | High |
| Manage terminals | `TERMINAL_MANAGE` | High |
| Pair devices | `HARDWARE_MANAGE` | High |

---

## Known Constraints & Limits
- TCP connection timeout: 5000ms default, but actual SYN timeout can reach 7–10s
- ESC/POS thermal printers: 80mm or 40mm paper width only
- Print routes evaluated by priority (lower number = higher priority)
- One default printer per role per location
- HardwareCommand records auto-expire after 60 seconds
- Pairing codes expire (configurable, typically 5 minutes)

---

## Android-Specific Notes
- Android supports full hardware stack: VP3350 Bluetooth readers, USB printers, USB scales, barcode scanners
- VP3350 Bluetooth: TODO to replace per-transaction reads with persistent connection loop
- Native heartbeat endpoint: `/api/hardware/terminals/heartbeat-native`
- Native pairing endpoint: `/api/hardware/terminals/pair-native`
- Android sends `terminal:ping` over socket for keep-alive

---

## Related Docs
- **Domain doc:** `docs/domains/HARDWARE-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 08 (Receipt Printing), Skill 102 (KDS Device Security), Skill 103 (Print Routing), Skill 212 (Per-Modifier Print Routing), Skill 377 (Remote Device Actions)
- **Changelog:** `docs/changelogs/HARDWARE-CHANGELOG.md`

---

*Last updated: 2026-03-03*
