# Feature: Print Routing

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Print Routing → read every listed dependency doc.

## Summary
Print routing determines which physical printers receive which order items when an order is sent to the kitchen. The system uses a tag-based routing engine (`OrderRouter`) that matches item route tags to station subscriptions, then `PrintTemplateFactory` converts routing manifests into ESC/POS buffers and sends them to printers via TCP. The system supports backup printer failover, modifier-level print routing (follow/also/only), print job retry with exponential backoff, and configurable print templates per printer. Kitchen tickets, customer receipts, shift closeouts, daily reports, and cash drawer kicks each have dedicated print routes.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Routing engine, ESC/POS builders, printer management, print job tracking | Full |
| `gwi-android-register` | Triggers kitchen print via API | Partial |
| `gwi-pax-a6650` | Triggers kitchen print via API | Partial |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/hardware/printers` → printer CRUD, test, settings | Managers |
| POS Web | Print status indicators, failed job alerts | All staff |
| POS Web | Order send → automatic kitchen print | Servers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/order-router.ts` | `OrderRouter.resolveRouting()` — tag-based routing engine that produces station manifests |
| `src/lib/print-template-factory.ts` | `printKitchenTicketsForManifests()` — converts routing manifests to ESC/POS buffers and sends to printers |
| `src/lib/print-retry.ts` | `retryFailedPrintJobs()`, `dispatchPrintWithRetry()` — retry infrastructure with backup printer fallback |
| `src/lib/printer-connection.ts` | `sendToPrinter()` — TCP socket send, `testPrinterConnection()` — connection test |
| `src/lib/escpos/commands.ts` | ESC/POS command constants (`ESCPOS`), line builders, `buildDocument()`, `buildDocumentNoCut()`, `PAPER_WIDTH` |
| `src/lib/escpos/customer-receipt.ts` | `buildCustomerReceipt()` — customer receipt ESC/POS builder |
| `src/lib/escpos/shift-closeout-receipt.ts` | `buildShiftCloseoutReceipt()` — shift closeout report printer |
| `src/lib/escpos/daily-report-receipt.ts` | `buildDailyReportReceipt()` — daily report printer |
| `src/types/print/print-template-settings.ts` | `PrintTemplateSettings` — full template configuration type with defaults |
| `src/types/print/receipt-settings.ts` | `GlobalReceiptSettings` — location-level receipt config |
| `src/types/print/print-settings.ts` | Printer-specific settings types |
| `src/app/api/print/kitchen/route.ts` | `POST` — print kitchen ticket (legacy direct route, also used for reprints) |
| `src/app/api/print/receipt/route.ts` | `POST` — print customer receipt to receipt printer |
| `src/app/api/print/failed-jobs/route.ts` | `GET/POST/DELETE` — list, retry, and acknowledge failed print jobs |
| `src/app/api/print/retry/route.ts` | `POST/GET` — trigger retry of queued jobs, list failed/queued jobs |
| `src/app/api/print/cash-drawer/route.ts` | `POST` — send cash drawer kick command to receipt printer |
| `src/app/api/print/shift-closeout/route.ts` | `POST` — print shift closeout receipt |
| `src/app/api/print/daily-report/route.ts` | `POST` — print daily report receipt |
| `src/app/api/hardware/printers/route.ts` | `GET/POST` — list and create printers for a location |
| `src/app/(admin)/settings/hardware/printers/page.tsx` | Printer management admin UI |
| `src/lib/socket-dispatch.ts` | `dispatchPrintJobFailed()` — socket event for print failure alerts |
| `src/lib/alert-service.ts` | `dispatchAlert()` — alert on printer failures (severity: HIGH, category: hardware) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/print/kitchen` | Employee PIN | Print kitchen ticket for an order (supports specific items for resends) |
| `POST` | `/api/print/receipt` | Employee PIN | Print customer receipt to receipt printer |
| `POST` | `/api/print/cash-drawer` | `pos.no_sale` | Send drawer kick to receipt printer |
| `POST` | `/api/print/shift-closeout` | Employee PIN | Print shift closeout receipt |
| `POST` | `/api/print/daily-report` | Employee PIN | Print daily report to receipt printer |
| `GET` | `/api/print/failed-jobs` | Employee PIN | List failed print jobs with printer status |
| `POST` | `/api/print/failed-jobs` | Employee PIN | Retry specific or all failed print jobs |
| `DELETE` | `/api/print/failed-jobs` | Employee PIN | Acknowledge (soft-delete) permanently failed jobs |
| `POST` | `/api/print/retry` | Employee PIN | Trigger retry of queued print jobs |
| `GET` | `/api/print/retry` | Employee PIN | List queued/failed print jobs with summary counts |
| `GET` | `/api/hardware/printers` | Employee PIN | List printers for a location (filterable by role) |
| `POST` | `/api/hardware/printers` | `settings.hardware` | Create a new printer (subscription-gated device limits) |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `print-job:failed` | `{ orderId, orderNumber?, printerName, printerId?, error }` | Print job fails (primary or backup) |

---

## Data Model

### Printer
```
id           String       @id
locationId   String
name         String                   // "Kitchen Printer", "Bar Printer"
printerType  PrinterType              // thermal | impact
model        String?                  // "TM-T88VII", "TM-U220"
ipAddress    String
port         Int          @default(9100)
printerRole  PrinterRole  @default(kitchen) // receipt | kitchen | bar
isDefault    Boolean      @default(false)
paperWidth   Int          @default(80)      // 80mm or 40mm
supportsCut  Boolean      @default(true)
isActive     Boolean      @default(true)
lastPingAt   DateTime?
lastPingOk   Boolean      @default(false)
printSettings Json?                   // PrintTemplateSettings JSON
sortOrder    Int          @default(0)
```

### PrintRoute
```
id              String    @id
locationId      String
name            String                // "Pizza Printer 1", "Bar Printer"
routeType       String                // "category" | "item_type" | "station" | "custom"
isActive        Boolean   @default(true)
priority        Int       @default(0)
categoryIds     Json?                 // Array of category IDs
itemTypes       Json?                 // Array of item types (food, liquor, etc.)
stationId       String?               // Specific station
printerId       String?               // Target printer
backupPrinterId String?               // Backup printer for failover
failoverTimeout Int?      @default(5000) // ms before trying backup
```

### PrintJob
```
id           String         @id
locationId   String
jobType      String                   // "kitchen_ticket" | "receipt" | "reference"
orderId      String?
printerId    String
status       PrintJobStatus           // pending | queued | sent | failed | failed_permanent
errorMessage String?
retryCount   Int            @default(0)
content      String?                  // Base64 ESC/POS buffer for reprint
sentAt       DateTime?
```

### Enums
```
PrinterType:  thermal | impact
PrinterRole:  receipt | kitchen | bar
PrintJobStatus: pending | queued | sent | failed | failed_permanent
ModifierPrinterRouting: follow | also | only
```

---

## Business Logic

### Tag-Based Routing (`OrderRouter`)
1. Order items have `routeTags` (from `MenuItem.routeTags` or inherited from `Category.routeTags`)
2. `PrepStation` records subscribe to tags via their tags array
3. `OrderRouter.resolveRouting()` matches item tags to station subscriptions
4. Produces `RoutingResult` with `RoutingManifest[]` grouped by station
5. Expo stations receive ALL items regardless of tags
6. Each manifest includes: station info, primary items, reference items, printer config

### Print Job Execution (`PrintTemplateFactory`)
1. `printKitchenTicketsForManifests()` receives routing result from `OrderRouter`
2. Filters to PRINTER-type stations only (KDS stations handled by socket dispatch)
3. For each printer manifest:
   a. Builds ESC/POS buffer via `buildTicketBuffer()`
   b. Sends via `sendToPrinter()` (TCP socket to printer IP:port)
   c. On success: logs `PrintJob` record
   d. On failure: attempts backup printer, then emits socket alert

### Backup Printer Failover
Two-strategy failover when primary printer fails:
1. **Configured backup:** Check `PrintRoute` for a `backupPrinterId` that matches the failed printer
2. **Same-role fallback:** Find any other active printer with the same `printerRole` at the location

Both strategies are used in:
- `PrintTemplateFactory.attemptBackupPrinter()` — for live send failures
- `print-retry.ts: attemptBackupForJob()` — for retry queue failures

### Print Job Retry
1. Failed jobs enter status `queued` with `retryCount` tracking
2. `retryFailedPrintJobs()` processes queued jobs ordered by `createdAt`
3. Re-sends stored content (`content` field, Base64-encoded ESC/POS buffer)
4. After `MAX_RETRY_COUNT` (3) failures: attempts backup printer
5. If no backup succeeds: marks as `failed_permanent`, emits socket event + alert
6. `dispatchPrintWithRetry()` provides fire-and-forget HTTP dispatch with 1 retry after 3s
7. Permanently failed jobs logged to `AuditLog` for manager visibility

### Kitchen Ticket Format
Kitchen tickets contain:
1. **Station name** — double-size, centered
2. **Resend indicator** — inverse text "** RESEND **" if applicable
3. **Order info** — order number (double-height), order type, table/tab, server, time
4. **Items** — each item in uppercase with seat prefix, quantity, modifiers (with depth indentation and pre-modifier labels like "NO", "EXTRA"), ingredient modifications, special notes (bold)
5. **Reference items** — other items in the order (when `showReferenceItems` is enabled)
6. Modifier stacking: aggregated by (name, preModifier, depth) with count suffix

### Modifier-Level Print Routing
Modifiers have a `printerRouting` field with three modes:
- **follow** (default): modifier prints with the main item wherever it routes
- **also**: modifier prints with the main item AND to additional printers specified in `Modifier.printerIds`
- **only**: modifier prints ONLY to printers in `Modifier.printerIds`, not with the main item

### Item-Level and Category-Level Routing
- `MenuItem.printerIds` — JSON array of printer IDs overriding category-level routing
- `MenuItem.backupPrinterIds` — backup printers if primary fails
- `Category.printerIds` — JSON array of printer IDs for all items in the category
- Tag-based routing via `MenuItem.routeTags` and `Category.routeTags` (new system)

### Print Template Settings
Each printer has a `printSettings` JSON field (`PrintTemplateSettings`) controlling:
- Header elements (station name, order number, order type, table, server, time) — each independently configurable for alignment, size, bold, caps, reverse print, red print
- Divider styles between sections (dash, double, star, dot, blank, thick)
- Item display (quantity format, size, bold, caps)
- Seat number display (prefix, inline, header, grouped)
- Category headers (enabled, style, size)
- Modifier display (indent, prefix, size, bold, caps)
- Pre-modifier highlighting (stars, brackets, parens)
- Special notes styling
- Alert rules (allergy, rush, fire, VIP — with thermal reverse/impact red styles)
- Collapsing (aggregate duplicate items)
- Reference item printing
- Footer (time, ticket number, custom text)
- Indicators (resend, rush, fire, void — with reverse print option)
- Receipt-specific (tip line, signature, suggested tips, promo text, terms)
- Pizza-specific (size prominent, show inches, crust, section style)
- Entertainment-specific (waitlist, session start/end, time warnings)

### Paper Width
| Width | Characters | Usage |
|-------|-----------|-------|
| 80mm | 48 chars | Standard kitchen/receipt |
| 58mm | 32 chars | Compact thermal |
| 40mm | 20 chars | Narrow label |

### Printer Types
- **thermal**: Standard thermal receipt/kitchen printer (supports paper cut)
- **impact**: Dot-matrix impact printer (no cut, uses separate size commands)

### Print Job Types
- `kitchen` — kitchen ticket (via `PrintTemplateFactory` or `/api/print/kitchen`)
- `receipt` — customer receipt (via `/api/print/receipt`)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| KDS | Kitchen items routed to KDS stations via same `OrderRouter` (socket, not print) |
| Orders | Order send triggers kitchen print |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Order items provide the data and routing tags for print routing |
| Menu | Category and item `printerIds` and `routeTags` determine where items print |
| Modifiers | `Modifier.printerRouting` controls modifier-level print routing |
| Settings | Printer configuration (IP, port, role, template settings) |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does order send still trigger kitchen print correctly?
- [ ] **KDS** — does the routing engine still produce correct KDS manifests?
- [ ] **Backup failover** — do both failover strategies (configured backup + same-role) still work?
- [ ] **Print retry** — does the retry queue still process correctly after max retries?
- [ ] **Template settings** — does `mergePrintTemplateSettings()` handle new fields?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Print kitchen ticket | Employee PIN | Standard |
| Print receipt | Employee PIN | Standard |
| Open cash drawer (no sale) | `pos.no_sale` | Standard |
| Manage printers | `settings.hardware` | High |

---

## Known Constraints & Limits
- TCP connection timeout: 10s for sends, 5s for test pings
- Print retry max: 3 attempts before marking `failed_permanent`
- `dispatchPrintWithRetry()` retries once after 3s delay
- Printer name must be unique per location (unique constraint)
- Printer count is subscription-gated via `checkDeviceLimit(locationId, 'printer')`
- `PrintJob.content` stores Base64-encoded ESC/POS buffer for reprint — jobs without stored content cannot be retried
- PrintJob logging is fire-and-forget — never blocks the print operation
- Impact printers use separate ESC/POS size commands (`IMPACT_NORMAL`, `IMPACT_DOUBLE_HEIGHT`, etc.)
- Station-only configs (no matching `Printer` record by IP/port) skip PrintJob logging
- `dispatchPrintJobFailed` and `dispatchAlert` are fire-and-forget on print failures

---

## Android-Specific Notes
- Android triggers kitchen print via `POST /api/print/kitchen` after order send
- No direct printer management on Android — admin only via web
- Print failure socket events displayed as alerts on Android

---

## Related Docs
- **Customer receipts:** `docs/features/customer-receipts.md`
- **Hardware:** `docs/features/hardware.md`
- **KDS:** `docs/features/kds.md`
- **Orders:** `docs/features/orders.md`
- **Architecture rules:** `docs/guides/ARCHITECTURE-RULES.md`

---

*Last updated: 2026-03-14*
