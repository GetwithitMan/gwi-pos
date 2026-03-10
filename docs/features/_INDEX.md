# GWI POS — Feature Registry

**This is the master hub for all features across the GWI POS system.**

Every feature in this registry has a dedicated doc in `docs/features/`. Before changing any feature, read its doc and check `_CROSS-REF-MATRIX.md` for dependencies.

**Repos in this system:**
| Repo | Role |
|------|------|
| `gwi-pos` | NUC server + Next.js web POS (admin, crew, terminals, KDS) |
| `gwi-android-register` | Android POS register — PRIMARY client |
| `gwi-cfd` | Customer-Facing Display (PAX A3700) — payment screens |
| `gwi-backoffice` | Cloud event ingestion + aggregate reporting |
| `gwi-mission-control` | Fleet management, licensing, deployments |

---

## Feature Index

> **Status key:** `Active` = built and live | `Schema Built` = models exist, no API/UI yet | `Planned` = specced but not built — do NOT implement without a planning session

### Core Transaction Features

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Orders** | [orders.md](orders.md) | Active | pos, android | Menu, Payments, KDS, Floor Plan, Tips |
| **Payments** | [payments.md](payments.md) | Active | pos, android, cfd, backoffice | Orders, Tips, Tabs, Hardware, Roles |
| **Tabs (Bar Tabs)** | [tabs.md](tabs.md) | Active | pos, android | Payments, Orders, Employees |
| **Discounts & Comps** | [discounts.md](discounts.md) | Active | pos, android | Orders, Roles, Payments, Reports |
| **Coupons (Promo Codes)** | [coupons.md](coupons.md) | Active | pos | Discounts, Orders, Payments, Reports |
| **Auto Discounts** | [auto-discounts.md](auto-discounts.md) | Planned | pos | Discounts, Orders, Menu, Settings |
| **Tax Rules** | [tax-rules.md](tax-rules.md) | Active | pos | Settings, Payments, Reports |
| **Store-and-Forward (SAF)** | [store-and-forward.md](store-and-forward.md) | Active | pos, android | Payments, Hardware, Offline Sync |
| **Refund vs Void** | [refund-void.md](refund-void.md) | Active | pos, android | Payments, Orders, Roles |
| **Remote Void Approval** | [remote-void-approval.md](remote-void-approval.md) | Active | pos | Refund/Void, Roles, Payments |
| **Chargebacks** | [chargebacks.md](chargebacks.md) | Active | pos | Payments, Orders, Tips |
| **Pricing Programs** | [pricing-programs.md](pricing-programs.md) | Active | pos, mission-control | Payments, Settings, Reports |
| **Gift Cards** | [gift-cards.md](gift-cards.md) | Active | pos, android | Payments, Orders |
| **House Accounts** | [house-accounts.md](house-accounts.md) | Active | pos | Customers, Payments, Reports |
| **Walkout Retry** | [walkout-retry.md](walkout-retry.md) | Active | pos | Payments, Tabs, Hardware |

### Menu & Product Features

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Menu Management** | [menu.md](menu.md) | Active | pos, android | Orders, Inventory, Modifiers, KDS |
| **Modifiers** | [modifiers.md](modifiers.md) | Active | pos, android | Menu, Orders, Inventory, KDS |
| **Inventory** | [inventory.md](inventory.md) | Active | pos | Menu, Orders, Payments, Reports |
| **Purchase Orders & Receiving** | [purchase-orders.md](purchase-orders.md) | Active | pos | Inventory, Vendors, Invoices, Menu, Reports |
| **Daily Prep Count** | [daily-prep-count.md](daily-prep-count.md) | Active | pos | Inventory, Menu, KDS |
| **Liquor Management** | [liquor.md](liquor.md) | Active | pos, android | Menu, Inventory, Orders, Reports |
| **Combo Meals** | [combos.md](combos.md) | Active | pos, android | Menu, Orders, Payments |
| **Pizza Builder** | [pizza-builder.md](pizza-builder.md) | Active | pos, android | Menu, Orders, Modifiers |
| **Entertainment** | [entertainment.md](entertainment.md) | Active | pos, android | Orders, Floor Plan, KDS, Payments |
| **Happy Hour** | [happy-hour.md](happy-hour.md) | Active | pos | Menu, Payments, Settings |
| **Upsell Prompts** | [upsell-prompts.md](upsell-prompts.md) | Schema Built | pos, android | Menu, Orders, Reports |
| **Repeat Orders** | [repeat-orders.md](repeat-orders.md) | Planned | pos, android | Orders, Menu |
| **Custom Menus** | [custom-menus.md](custom-menus.md) | Planned | pos, android | Menu, Employees, Settings |

### Tipping & Compensation

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Tips & Tip Banking** | [tips.md](tips.md) | Active | pos, android | Payments, Shifts, Employees, Orders, Roles |
| **Shifts & Payroll** | [shifts.md](shifts.md) | Active | pos, android | Employees, Tips, Reports, Time Clock |
| **Commissioned Items** | [commissioned-items.md](commissioned-items.md) | Active | pos | Menu, Employees, Reports, Payments |

### Staff & Access Features

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Roles & Permissions** | [roles-permissions.md](roles-permissions.md) | Active | pos, android | All features (cross-cutting) |
| **Employees** | [employees.md](employees.md) | Active | pos, android | Roles, Tips, Shifts, Reports |
| **Time Clock** | [time-clock.md](time-clock.md) | Active | pos, android | Employees, Shifts, Tips |
| **Scheduling** | [scheduling.md](scheduling.md) | Active | pos | Employees, Shifts, Time Clock |
| **Mobile Tab Management** | [mobile-tab-management.md](mobile-tab-management.md) | Active | pos | Tabs, Payments, Employees |
| **Paid In / Out** | [paid-in-out.md](paid-in-out.md) | Active | pos | Cash Drawers, Shifts, Roles, Reports |
| **Staff Training Mode** | [staff-training.md](staff-training.md) | Planned | pos, android | Orders, Payments, Settings |

### Venue & Service Features

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Floor Plan** | [floor-plan.md](floor-plan.md) | Active | pos, android | Orders, Entertainment, Employees |
| **KDS (Kitchen Display)** | [kds.md](kds.md) | Active | pos, android | Orders, Hardware, Menu |
| **Coursing** | [coursing.md](coursing.md) | Active | pos | Orders, KDS, Menu |
| **Events & Tickets** | [events-tickets.md](events-tickets.md) | Active | pos | Orders, Customers, Payments |
| **Customers** | [customers.md](customers.md) | Active | pos | Orders, Payments, Events |
| **Bottle Service** | [bottle-service.md](bottle-service.md) | Active | pos, android | Tabs, Payments, Floor Plan, Menu |
| **Reservations** | [reservations.md](reservations.md) | Planned | pos | Customers, Floor Plan, Events, Settings |
| **Host Management** | [host-management.md](host-management.md) | Planned | pos | Floor Plan, Employees, Reservations |

### Hardware & Devices

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Hardware** | [hardware.md](hardware.md) | Active | pos, android | KDS, Orders, Payments |
| **CFD (Customer-Facing Display)** | [cfd.md](cfd.md) | Active | pos, android, cfd | Payments, Orders, Hardware |
| **Cash Drawers** | [cash-drawers.md](cash-drawers.md) | Active | pos | Payments, Shifts, Hardware |
| **Printer Settings** | [printer-settings.md](printer-settings.md) | Planned | pos | Hardware, Orders, KDS |

### Platform & Settings

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Settings** | [settings.md](settings.md) | Active | pos, mission-control | All features (consumed by every route) |
| **Security Settings** | [security-settings.md](security-settings.md) | Active | pos, android | Settings, Employees, Roles |
| **Audit Trail** | [audit-trail.md](audit-trail.md) | Active | pos, backoffice | Orders, Payments, Employees, Settings |
| **Reports** | [reports.md](reports.md) | Active | pos, backoffice | Orders, Payments, Tips, Employees, Inventory |
| **Notifications & Alerts** | [notifications.md](notifications.md) | Active | pos | All features (multi-channel: email, SMS, Slack) |
| **EOD Reset** | [eod-reset.md](eod-reset.md) | Active | pos | Orders, Floor Plan, Reports, Audit Trail |
| **Offline Sync** | [offline-sync.md](offline-sync.md) | Active | pos, android | All features (cross-cutting) |
| **Error Reporting** | [error-reporting.md](error-reporting.md) | Active | pos | All features (observability) |
| **Mission Control** | [mission-control.md](mission-control.md) | Active | mission-control, pos | Settings, Employees, Payments |
| **Live Dashboard** | [live-dashboard.md](live-dashboard.md) | Active | pos | Reports, Orders, Payments, Employees |

### Infrastructure & HA

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **HA Failover (Backup NUC)** | [../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md](../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md#phase-1--backup-nuc--ha-failover) | In Progress | pos, mission-control, android | Offline Sync, Hardware, Mission Control |
| **Cellular Edge Path** | [../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md](../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md#phase-2--cellular-edge-path) | In Progress | pos, mission-control, android | Orders, Payments, Offline Sync, Security |
| **Fulfillment Routing** | [../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md](../architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md#phase-3--fulfillment-routing) | In Progress | pos | Orders, KDS, Hardware, Menu, Print Routing |
| **Cloud-Primary Sync** | Neon-canonical SOR, outage queue, conflict resolution, bridge worker | `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md` Phase 6 | Active | pos, mission-control | Offline Sync, Orders, Payments, Mission Control |
| **Migration Architecture** | Unified migration runner, tracking table, 12 extracted migrations | `scripts/migrations/`, `scripts/nuc-pre-migrate.js` | Active | pos | Settings, Offline Sync |

### Guest & Ordering Channels

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Online Ordering** | [online-ordering.md](online-ordering.md) | Active | pos, backoffice | Menu, Orders, Payments (Datacap PayAPI), Settings |
| **Pay-at-Table (PAT)** | [pay-at-table.md](pay-at-table.md) | Active | pos | Payments, Tabs, Hardware, Floor Plan |
| **QR Self-Ordering** | [qr-ordering.md](qr-ordering.md) | Planned | pos | Menu, Orders, Payments, Floor Plan |
| **Delivery Management** | [delivery.md](delivery.md) | Planned | pos | Orders, Customers, Settings |

### Enterprise & Integrations

| Feature | Doc | Status | Repos | Top Dependencies |
|---------|-----|--------|-------|-----------------|
| **Multi-Location Management** | [multi-location.md](multi-location.md) | Planned | mission-control, pos | Settings, Menu, Employees, Reports |
| **Invoicing & B2B** | [invoicing.md](invoicing.md) | Active | pos | Customers, Payments, Reports |
| **Hotel PMS Integration (Oracle OPERA)** | [hotel-pms.md](hotel-pms.md) | Active | pos | Payments, Orders, Settings |
| **7shifts Labor Integration** | [7shifts-integration.md](7shifts-integration.md) | Active | pos | Employees, Scheduling, Time Clock, Settings |
| **MarginEdge Integration** | [marginedge-integration.md](marginedge-integration.md) | Active | pos | Inventory, Vendors, Settings |
| **Berg Liquor Controls** | [berg-integration.md](berg-integration.md) | Active | pos | Liquor, Inventory, Reports, Settings |

---

## Undocumented Built Features

These exist in code but have no formal feature doc yet. Create docs before building on them.

| Feature | Evidence | Priority |
|---------|----------|----------|
| **Print Routing** | `src/lib/print-template-factory.ts` — tag-based routing manifests, 5 kitchen ticket templates, primary→backup failover | High — affects Orders, KDS, Hardware |
| **Customer Receipt** | `buildReceiptWithSettings()` in `print-factory.ts` — full builder (dual pricing, tip suggestions, signature, surcharge) but **no `/api/print/receipt` endpoint** | High — affects Payments, Hardware |
| **Print Routing** | `src/lib/print-template-factory.ts` — tag-based routing manifests, 5 kitchen ticket templates, primary→backup failover | High — affects Orders, KDS, Hardware |
| **Customer Receipt** | `buildReceiptWithSettings()` in `print-factory.ts` — full builder (dual pricing, tip suggestions, signature, surcharge) but **no `/api/print/receipt` endpoint** | High — affects Payments, Hardware |
| **CashTipDeclaration** | `CashTipDeclaration` model, `/api/tips/cash-declarations` — no shift-close seal endpoint (documented in `tips.md` Known Constraints) | High — affects Tips, Shifts |
| **TipDebt** | `TipDebt` model — auto-created on void/refund, auto-reclaimed FIFO, no manual write-off API (documented in `tips.md` Known Constraints) | High — affects Tips, Payments |
| Prep Stations | `/api/prep-stations` | Medium — affects KDS, Hardware |
| Stock Alerts | `/api/stock-alerts` | Medium — affects Inventory |
| Digital Receipts | `DigitalReceipt` Prisma model, `POST /api/receipts` | Medium — affects Payments, Hardware |
| Hardware Commands | `HardwareCommand` model, `hardware-command-worker.ts` (3s polling, PRINTER_PING/TEST/READER_PING) | Medium — affects Hardware, Mission Control |
| Integration Status | `/api/integrations/status` | Low |
| Import Tools | `/api/import/menu` | Low |
| System/Internal Routes | `/api/system/*`, `/api/internal/*` | Low |
| Mobile Sessions | `MobileSession` Prisma model | Low |
| Simulated Payment Reader | `/api/simulated-reader/*` | Low (test-mode only) |

> **Note:** Void Remote Approval (`remote-void-approval.md`), Chargebacks (`chargebacks.md`), and Scheduling (`scheduling.md`) were previously listed here — all now have full feature docs.

---

## Known Gaps & Wiring Issues

Discovered during the 2026-03-03 documentation audit. Fix before going live.

| Gap | Severity | Source | Details |
|-----|----------|--------|---------|
| **WalkoutRetry no write-off API** | **Critical** | Financial audit | `writtenOffAt`/`writtenOffBy` fields in schema, zero API endpoint — exhausted walkout debts cannot be manually resolved. See `walkout-retry.md` |
| **WalkoutRetry no scheduler** | **Critical** | Walkout audit | Route comment says "used by cron/scheduler" but no scheduler exists anywhere in codebase — all retries require MANUAL triggering via API |
| **Mobile socket relay drops events silently** | High | Mobile audit | `tab:close-request`, `tab:transfer-request`, `tab:alert-manager` emitted by `MobileTabActions.tsx` — `socket-server.ts` has ZERO handlers for them. If no POS terminal is in the same location room, events are silently dropped |
| **`walkoutAutoDetectMinutes` setting not wired** | Medium | Walkout audit | Setting exists (default 120 min) to auto-detect idle tabs as walkouts — no background job monitors this threshold |
| TipAdjustment undocumented in tips.md | Low | Financial audit | `POST /api/tips/adjustments` exists and handles all 5 adjustment types — now documented in `tips.md`. Was incorrectly flagged as missing. |
| **Proportional tip refund race condition** | **Critical** | Financial audit | In `refund-payment/route.ts`: fire-and-forget tip reduction → then fire-and-forget chargeback fired with original amount — if first fails, double-chargeback possible |
| APK signature verification missing | High | Original audit | Android update installer installs without verifying APK signature |
| Gift card offline redemption not supported | High | Original audit | `db.$transaction` atomicity prevents SAF path — must decline when NUC unreachable |
| No thermal customer receipt API | High | Print audit | `buildReceiptWithSettings()` fully built in `print-factory.ts` — NO `/api/print/receipt` endpoint exists. Customer receipt is browser-only or email. |
| **TipDebt no write-off endpoint** | High | Financial audit | `writtenOffAt`/`writtenOffBy` fields exist on `TipDebt` schema, no API to mark debts unrecoverable — accumulate indefinitely |
| **CashTipDeclaration no seal** | High | Financial audit | `/api/tips/cash-declarations` creates declarations, but no documented endpoint seals them at shift-close — editable post-shift |
| **Chargeback status update endpoint missing** | High | Original audit | No `PUT /api/chargebacks/[id]` — cases stay permanently `open`, cannot record dispute outcome (won/lost/responded) |
| `shift:opened` / `shift:closed` socket events not wired | Medium | Original audit | Referenced in test specs but no actual `emit()` call found in codebase |
| `employees:changed` orphan emitter | Medium | Socket audit | Employee CRUD routes emit `employees:changed` but NO web listener subscribes — employees admin page does not update in real-time |
| `employees:changed` vs `employees:updated` naming conflict | Medium | Socket audit | `employees:changed` emitted from CRUD routes; `employees:updated` emitted from `cache-invalidate.ts` — two different event names for same concept |
| `inventory:changed` orphan emitter | Medium | Socket audit | Emitted from 3 routes (`ingredients`, `sync-inventory`, `bulk-move`) — no web listener. Menu items show stale stock until page refresh |
| `shifts:changed` orphan emitter | Medium | Socket audit | Shift CRUD routes emit `shifts:changed` — no web listener. Shifts admin page requires manual refresh |
| Floor Plan `FLOOR_PLAN_EDIT`/`TABLE_TRANSFER` not in permission registry | Medium | Original audit | Enforcement is UI-only — API routes do not call `requirePermission()` for floor plan edits |
| `terminal:card-detected` not forwarded to CFD | Medium | Original audit | Android emits this event but socket-server relay to CFD not confirmed |
| Audit Trail `entityType` filter hardcoded | Medium | Original audit | `audit/activity/route.ts` only returns `order`+`payment` entries — employee/menu/settings audit records exist but are inaccessible via UI |
| `shift.variance` field write path unknown | Medium | Reports audit | Queried in cash-liabilities and shift reports — no route found that writes `Shift.variance`. May be calculated at shift-close (undocumented) or a dead field |
| Coupon `usageLimit` race condition | Medium | Original audit | `PUT /api/coupons/[id]` (redeem) checks then increments without atomic DB guard — concurrent redemptions can exceed limit |
| Coupon `discountAmount` client-supplied | Medium | Original audit | Server does not recalculate coupon discount — client passes the value. Potential for manipulation |
| Events & Tickets has no permission keys | Medium | Original audit | No keys in `permission-registry.ts` — no granular control (manager-only by auth level) |
| Chargeback UI page not confirmed | Medium | Original audit | No admin UI page found; chargebacks may be API-only |
| `/api/monitoring/error` route may not exist | Medium | Integration audit | `error-capture.ts` sends errors to this route but no handler confirmed — all error logging may silently fail |
| Neon sync timezone risk | Medium | Integration audit | `downstream-sync-worker.ts` uses `::timestamp` cast — warning in code comments about `::timestamptz` drift on non-UTC NUC systems |
| Alert service Slack not wired | Medium | Integration audit | `alert-service.ts` routes CRITICAL alerts to Slack — channel structure exists, no webhook URL configured |
| Android native combo builder not built | Medium | Original audit | POS has combo builder; Android uses text-based flow only |
| Android native pizza builder not built | Medium | Original audit | POS has visual builder; Android uses standard modifier flow |
| VP3350 USB read loop | Medium | Original audit | TODO comment: replace per-transaction TCP reads with persistent loop |
| Entertainment order sheet on Android | Medium | Original audit | TODO comment in `OrderMainContent.kt` — sheet not yet opened |
| Coursing auto-mode timer is client-driven | Medium | Original audit | Server does not enforce course fire timing — client can miss auto-advance |
| `TipShare` legacy model in use | Medium | Reports audit | `tip-shares` report reads legacy `TipShare` model (not `TipLedgerEntry`) — explicitly not migrated. Dual source-of-truth risk |
| `businessDayDate` population undocumented | Low | Reports audit | `Order.businessDayDate` used for date filtering in multiple reports — how it's populated vs `createdAt` not documented |
| `costAtSale` on OrderItem write-path unclear | Low | Reports audit | Product-mix report falls back to `MenuItem.cost` when `costAtSale` is null — when is this field populated? |
| Print routing undocumented | Low | Print audit | Tag-based routing (grill, pizza, expo, bar), primary→backup failover — all in `print-template-factory.ts` with no feature doc |
| Direct print buffer size limit undocumented | Low | Print audit | `POST /api/print/direct` has 16KB recommended / 64KB hard limit — not in any user-facing doc |
| `tab:items-updated` is dead code | Low | Original audit | Event defined but never emitted — wire it or remove it |
| `order-types:updated` / `settings:updated` orphan emitters | Low | Socket audit | Emitted from `cache-invalidate.ts` — no web listeners. Can be removed or wired |
| Scheduling has no socket events | Low | Original audit | Schedule publish/update does not broadcast to active terminals |
| Online order dispatch worker undocumented | Low | Integration audit | `online-order-worker.ts` — 15s Neon polling → local dispatch to KDS. Not in any feature doc |
| Hardware command worker extensibility | Low | Integration audit | `hardware-command-worker.ts` switch statement hardcoded to 3 types — no protocol for adding new command types |
| `gwi_access_logs` has no Prisma migration | Low | Original audit | Cloud audit log table created via raw `CREATE TABLE IF NOT EXISTS` — not tracked in schema |
| Audit Trail CSV export is current-page only | Low | Original audit | Export button serializes current in-memory page, not full dataset |
| Happy Hour no dedicated API | Low | Original audit | All config stored as JSON in `Location.settings` — no discrete audit trail for changes |
| Combo analytics endpoint not implemented | Low | Original audit | `GET /api/combos/analytics` planned but not built |
| Tax holidays/exemption certificates not implemented | Low | Original audit | Planned in Skill 36, not yet built |
| **PAT `/pay-at-table` route is public** | High | PAT audit | `/pay-at-table` is in `cloud-auth.ts` public paths — access control relies entirely on valid query params, no session auth |
| **PAT `locationId = ''` in Datacap call** | High | PAT audit | iPad PAT sends empty `locationId` to Datacap sale endpoint — relies on Datacap to resolve from reader ID. May silently fail for misconfigured readers |
| **No terminal-side PAT "in progress" UI** | Medium | PAT audit | `pat:pay-request` socket sent to terminal, but no handler renders a "payment in progress" notice — terminal operator unaware |
| `pat:split-request` / `pat:split-result` dead code | Low | PAT audit | Defined in `multi-surface.ts` but never emitted or consumed — split PAT flow does not exist |
| `POST /api/orders/eod-cleanup` has no permission check | Medium | EOD audit | Lighter cleanup route beyond `withVenue` — no `requirePermission()` call |
| EOD Reset has no admin UI trigger | Medium | EOD audit | `POST /api/eod/reset` requires `MGR_CLOSE_DAY` permission but no admin page button — must call API directly |
| `cancelledDrafts` always 0 from primary EOD route | Low | EOD audit | Draft cancellation is handled by `eod-cleanup` route, which does NOT emit `eod:reset-complete` — primary route payload is always `cancelledDrafts: 0` |
| No dedicated tax breakdown report | Low | Reports audit | Tax data exists in `Order.taxTotal` but no `/api/reports/taxes` endpoint for per-rule breakdown |
| No chargeback aging/breakdown report | Low | Reports audit | `ChargebackCase` model exists, no report endpoint for dispute tracking or aging |
| Liquor API routes undocumented | Low | Original audit | 16+ routes in `/api/liquor/` not listed in `liquor.md` |

---

## Feature Connectivity Overview

### High-Hub Features (touch 6+ other features — test broadly when changing)
- **Orders** — 9 dependencies (hub of entire system)
- **Payments** — 10 dependencies (most critical path)
- **Tips** — 7 dependencies (financial accuracy critical)
- **Settings** — consumed by every API route
- **Roles & Permissions** — governs access to every feature
- **Offline Sync** — must work with every mutation

### Leaf Features (lower cross-domain impact)
- Pizza Builder (touches Menu, Orders, Modifiers only)
- Events & Tickets (touches Orders, Customers only)
- Entertainment (touches Orders, Floor Plan, KDS only)
- Coursing (touches Orders, KDS, Menu only)
- House Accounts (touches Customers, Payments only)
- Chargebacks (touches Payments, Tips only)

---

## Architecture Quick Reference

| Concern | Rule | Doc |
|---------|------|-----|
| Order mutations | MUST emit events via `emitOrderEvent()` | `docs/guides/ORDER-LIFECYCLE.md` |
| DB queries | NEVER query Neon from API routes — local PG only | `docs/guides/ARCHITECTURE-RULES.md` |
| Payments | Datacap only — NEVER Stripe/Square | `docs/guides/PAYMENTS-RULES.md` |
| Real-time | Socket-first — never polling | `docs/guides/SOCKET-REALTIME.md` |
| Timestamps | DB-generated NOW() only | `docs/guides/ARCHITECTURE-RULES.md` |
| Multi-tenancy | Every query: `locationId + deletedAt: null` | `docs/guides/ARCHITECTURE-RULES.md` |
| Print calls | Fire-and-forget ALWAYS (7s timeout risk) | `docs/guides/CODING-STANDARDS.md` |
| Permissions | `requirePermission()` — never `{ soft: true }` | `docs/features/roles-permissions.md` |
| Financial records | Every financial model MUST have a documented close/resolve path | `docs/features/walkout-retry.md`, `docs/features/chargebacks.md` |
| Socket events | Before adding `emit()`, verify a listener exists. 6 known orphan emitters in codebase. | `docs/guides/SOCKET-REALTIME.md` |

---

## Repo Statistics

| Metric | Count |
|--------|-------|
| Feature docs (active/built) | 45 |
| Feature docs (schema built) | 1 |
| Feature docs (planned/roadmap) | 14 |
| Feature docs total | 60 |
| Flow docs | 12 |
| API routes (gwi-pos) | 452 |
| UI pages (gwi-pos) | 189+ |
| Prisma models | 154 |
| SPEC files (original design specs) | 62 |
| Skill docs (implementation records) | 297 |
| Skill entries in index | 478 |
| Domain docs | 27 |
| Android screens | 12+ |
| CFD states | 8 |
| Socket event types | 63 (reverse-flow audit 2026-03-03) |

*Last updated: 2026-03-03 (post reverse-flow audit)*
