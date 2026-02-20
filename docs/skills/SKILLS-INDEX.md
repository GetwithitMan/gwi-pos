# GWI POS Skills Index

## Development Workflow Requirements

### BEFORE PROGRAMMING ANY FEATURE:

1. **Review ALL skills in this index** to identify:
   - Skills that will be directly implemented
   - Skills that are dependencies (must be built first)
   - Skills that can be built in parallel
   - Skills that share components or patterns

2. **Document in your plan**:
   - List each skill being implemented by number and name
   - Identify foundational skills needed first
   - Mark skills that can be parallelized
   - Note shared dependencies between skills

3. **Update CHANGELOG.md** as you complete each step

4. **Update this index** with implementation status

---

## Skills by Category

### Foundation (Build First)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 01 | Employee Management | DONE | Employees | - | CRUD, roles, permissions, PIN login |
| 09 | Features & Config | DONE | Settings | - | Settings, feature flags, category types (food/drinks/liquor/entertainment/combos) |
| 36 | Tax Calculations | DONE | Settings | 09 | Tax rules, multiple rates, admin UI, tax-inclusive pricing (Skill 240) |
| 59 | Location Multi-tenancy | TODO | Settings | - | Multi-location support |

### Order Flow (Core)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 02 | Quick Order Entry | DONE | Orders | 01 | Order creation, save to DB, update existing |
| 03 | Menu Display | DONE | Menu | - | Categories, items, dual pricing display |
| 04 | Modifiers | DONE | Menu | 03 | Nested modifiers, pre-modifiers |
| 05 | Order Review | PARTIAL | Orders | 02 | Order panel has items/totals, no separate review screen |
| 06 | Tipping | DONE | Payments | 09 | Tip suggestions, custom entry |
| 07 | Send to Kitchen | DONE | Orders | 02 | Orders save, sent/new tracking, KDS integration |
| 08 | Receipt Printing | DONE | Hardware | 09 | Print formatting, view/print from POS |
| 10 | Item Notes | DONE | Orders | 02 | Schema + UI: modifier modal + quick edit |

### Payment (Build Together)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 30 | Payment Processing | DONE | Payments | 02, 31 | Cash, card, split, tips |
| 31 | Dual Pricing | DONE | Payments | 09 | Cash discount program |
| 32 | Gift Cards | DONE | Payments | 30 | Purchase, redeem, reload, freeze |
| 33 | House Accounts | DONE | Payments | 30 | Charge to account, payment tracking |
| 221 | Payment Intent Backoff Logic | DONE | Payments | 120 | Exponential backoff for payment intent sync retries, prevents hammering server during outages |
| 222 | Datacap Validation & JSDoc | DONE | Payments | 120 | Communication mode validation, JSDoc on all 17 DatacapClient methods, simulated mode bug fix |
| 223 | Datacap XML Performance | DONE | Payments | 120 | Regex caching (97% reduction in RegExp objects), extractPrintData() optimization (9× faster) |
| 224 | Use Cases Layer | DONE | Payments | 120, 221 | processSale(), openBarTab(), closeBarTab(), voidPayment() with intent tracking and offline resilience |
| 225 | Payment Modal Component Split | DONE | Payments | 224 | Split 927-line monolith into 6 focused components (PaymentMethodStep, TipEntryStep, CashEntryStep, CardProcessingStep, GiftCardStep, HouseAccountStep) |
| 226 | PaymentService Layer | DONE | Payments | 224, 225 | Type-safe API client with ServiceResult<T> pattern, processPayment(), voidItems(), checkGiftCardBalance(), loadHouseAccounts() |
| 227 | PaymentDomain Module | DONE | Payments | 226 | Pure business logic functions: tip-calculations.ts (317 lines), loyalty-points.ts (429 lines), dual-pricing.ts (347 lines), validators.ts (294 lines) |
| 250 | Tip Ledger Foundation | DONE | Tips | 49, 50 | TipLedger per-employee bank account, TipLedgerEntry immutable entries, TipTransaction, core domain functions, TipBankSettings, 6 new permissions, ledger API, payment+shift integration |
| 251 | Enhanced Tip-Out Rules & Tip Guide Basis | DONE | Tips | 250 | basisType on TipOutRule (tips/food/bar/total/net sales), maxPercentage cap, effectiveDate/expiresAt, ShiftSalesData, /settings/tips admin page, CC fee deduction, EOD payout settings |
| 252 | Dynamic Tip Groups | DONE | Tips | 250 | TipGroup/TipGroupMembership/TipGroupSegment, time-segmented pooling, group lifecycle, tip allocation pipeline, socket events |
| 253 | Shared Table Ownership | DONE | Tips | 250 | OrderOwnership/OrderOwnershipEntry, co-owned orders, split % management, allocation adjustment by ownership |
| 254 | Manual Transfers & Payouts | DONE | Tips | 250 | Paired DEBIT/CREDIT transfers, cash payouts, batch payroll, manager payout page at /tips/payouts |
| 255 | Chargeback & Void Tip Handling | DONE | Tips | 250 | Policy-based chargebacks (BUSINESS_ABSORBS/EMPLOYEE_CHARGEBACK), negative balance protection |
| 256 | Manager Adjustments & Audit Trail | DONE | Tips | 250, 252 | TipAdjustment model, recalculation engine, delta entries, contextJson audit trail, adjustment API |
| 257 | Employee Tip Bank Dashboard | DONE | Tips | 250, 252 | /crew/tip-bank self-service page, bank-statement view, date/sourceType filters, pagination |
| 258 | Tip Reporting & Payroll Export | DONE | Tips | 250-257 | Payroll aggregation, CSV export, tip groups report, payroll export API (CSV + JSON) |
| 259 | Cash Tip Declaration & Compliance | DONE | Tips | 250 | CashTipDeclaration model, IRS 8% rule, tip-out caps, pool eligibility, compliance warnings |
| 260 | CC Tip Fee Structured Tracking | DONE | Tips | 250 | ccFeeAmountCents on TipTransaction, daily report businessCosts section |
| 261 | Shift Closeout Printout | DONE | Tips | 250 | ESC/POS shift closeout receipt, print API, ShiftCloseoutModal print button |
| 262 | Daily Business Summary Printout | DONE | Tips | 260 | ESC/POS daily report receipt, print API, admin daily report print button |
| 263 | Tip Claims at Clock-Out Only | DONE | Tips | 250 | TimeClockModal informational-only tip notice, payout only at shift closeout |
| 264 | Merge /crew/tips → Tip Bank | DONE | Tips | 257 | Redirect /crew/tips to /crew/tip-bank, renamed Crew Hub card to "Tip Bank" |
| 265 | Tip Group UI | DONE | Tips | 252 | /crew/tip-group page, start/join/leave groups, Crew Hub tip group card |
| 266 | Shared Table Ownership UI | DONE | Tips | 253 | SharedOwnershipModal, FloorPlanHome + OrderPanel integration, transfer ownership, pos.access filter |
| 267 | Manual Tip Transfer Modal | DONE | Tips | 254 | ManualTipTransferModal, select recipient, amount + memo, paired DEBIT/CREDIT |
| 268 | Business Day Boundaries | DONE | Tips | 250 | All tip reports use business-day boundaries instead of calendar midnight |
| 269 | Wire Tip Allocation to Payment | DONE | Tips | 252 | `allocateTipsForPayment()` called fire-and-forget from pay route |
| 270 | Cash Declaration Double-Counting Fix | DONE | Tips | 259 | Guard against duplicate cash declarations per shift |
| 271 | txClient Nested Transaction Guard | DONE | Tips | 250 | `TxClient` parameter pattern for SQLite nested transaction safety |
| 272 | Tip Integrity Check API | DONE | Tips | 250 | `GET /api/tips/integrity` diagnostic endpoint, balance drift detection + auto-fix |
| 273 | Legacy Report Migration to TipLedgerEntry | DONE | Tips | 258 | All 5 tip reports migrated from TipBank/TipShare to TipLedgerEntry |
| 274 | Idempotency Guard on Tip Allocation | DONE | Tips | 269 | `idempotencyKey` on TipLedgerEntry + TipTransaction, dedup in postToTipLedger |
| 275 | Deterministic Group Split Ordering | DONE | Tips | 252 | Sort memberIds alphabetically before split distribution |
| 276 | Wire Shared Table Ownership into Allocation | DONE | Tips | 253, 274 | `allocateWithOwnership()` splits tip by owner % then routes to group or individual |
| 277 | Qualified Tips vs Service Charges | DONE | Tips | 250 | `kind` field on TipTransaction (tip/service_charge/auto_gratuity), IRS separation in payroll |
| 278 | TipDebt Model for Chargeback Remainder | DONE | Tips | 255 | TipDebt model with auto-reclaim on future CREDITs, status lifecycle |
| 279 | API Permission Hardening | DONE | Tips | 250 | Self-access check on ledger API, self-join validation on group members |
| 280 | Tip Bank Feature Flag + Legacy Guard | DONE | Tips | 250 | `tipBankSettings.enabled` check at top of allocation, no-op when disabled |
| 281 | Wire Void Tip Reversal | DONE | Tips | 255 | `handleTipChargeback()` called from void-payment route (fire-and-forget) |
| 282 | Weighted Tip Splits (Role-Based) | DONE | Tips | 252, 275 | `Role.tipWeight`, `buildWeightedSplitJson()`, role_weighted splitMode |
| 283 | Tip Groups Admin Page | DONE | Tips | 252 | `/tip-groups` admin page, AdminNav link, status/date filters |
| 284 | TIP BANK Clean (Legacy Removal) | DONE | Tips | 250-283 | Deleted `TipBank` model, migrated employee tips API to TipLedgerEntry |
| 285 | KDS Browser Compatibility | DONE | KDS, Hardware | 102 | `@csstools/postcss-oklab-function` transpiles oklch()→rgb() for Chrome 108+ KDS devices, pair page redirect fix |
| 286 | Tip Bank Team Pools | DONE | Tips | 250, 252, 265 | Admin-defined TipGroupTemplate, clock-in group picker, PRIMARY_SERVER_OWNS_ALL mode, allowStandaloneServers, allowEmployeeCreatedGroups, template CRUD API, eligible API, time-clock integration |
| 287 | Tip Group Manager Admin UI | DONE | Tips | 252, 256, 283 | ActiveGroupManager component on /settings/tips (Section 9): expandable group cards, member management, add/remove/approve, transfer ownership, close group, stale member detection (>12h), manual adjustment modal |
| 288 | Group History & Segment Timeline | DONE | Tips | 252, 258 | GroupHistoryTimeline component on /settings/tips (Section 10): group selector, vertical timeline with colored dots (join/leave/segment/close), split % badges, earnings summary table, buildTimeline() merge function |
| 289 | Edit Item Modal (ItemSettingsModal) | DONE | Menu | 217 | Comprehensive Edit Item modal (5 tabs: Basics, Display, Kitchen, Availability, Tax), image upload, collapsible ingredient cost breakdown, card price read-only, auto-open for new items, live sync |
| 290 | Happy Hour Settings Page | DONE | Settings, Menu | - | Dedicated /settings/happy-hour page extracted from main settings, schedules with day/time selection, discount config, live preview, dead code cleanup |
| 291 | Ingredient Picker Flow Fix | DONE | Menu | 211, 213 | Fix new items going to Uncategorized: normalize POST→GET data shape in handleIngredientCreated, defer loadMenu() race, needsVerification propagation verified |

### Mission Control (Cloud Admin Console — Phase 2)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 300 | Cloud Project Bootstrap | DONE | Mission Control | - | Next.js 16, Prisma 7, Clerk B2B, Neon PostgreSQL |
| 301 | Cloud Prisma Schema | DONE | Mission Control | 300 | 11 enums, 10+ models, 15+ indexes, AdminUser, SupportUser, AdminUserLocationAssignment |
| 302 | Server Registration API | DONE | Mission Control | 301 | POST /api/fleet/register, token validation, fingerprint, RSA key exchange |
| 303 | Heartbeat Ingestion | DONE | Mission Control | 301 | POST /api/fleet/heartbeat, HMAC auth, metrics, pending commands |
| 304 | License Validation API | DONE | Mission Control | 301 | POST /api/fleet/license/validate, status priority chain, tier features, signed response |
| 305 | Fleet Dashboard (Basic) | DONE | Mission Control | 303 | StatusCard, ServerList, OrgSelector, fleet-status.ts, auto-refresh |
| 306 | Provisioning Script | DONE | Mission Control | 302 | provision.sh: fingerprint, RSA keypair, register, decrypt, .env write |
| 307 | SSE Command Stream | DONE | Mission Control | 301 | GET /api/fleet/commands/stream, priority ordering, Last-Event-ID, keepalive |
| 308 | Sync Agent Sidecar | DONE | Mission Control | 307 | 11 TypeScript files, Docker: heartbeat, SSE, commands, license, HMAC |
| 309 | Kill Switch | DONE | Mission Control | 307 | kill/revive lib, single+bulk kill, status endpoint, UPDATE_CONFIG revive |
| 310 | License Cache + Grace Period | TODO | Mission Control | 304 | Local HMAC-signed cache, in-memory 60s timer, grace degradation to read-only |
| 311 | Alerting (Email + SMS) | TODO | Mission Control | 303 | Degraded/offline/disk/license/error spike alerts |
| 312 | Data Sync Upload | TODO | Mission Control | 308 | POST /api/fleet/sync/upload, batch processing, syncedAt watermark |
| 313 | Data Sync Download | TODO | Mission Control | 308 | POST /api/fleet/sync/download, cloud → local data push |
| 314 | Conflict Resolution | TODO | Mission Control | 312, 313 | LWW with field-level merge, financial=local wins, reference=cloud wins |
| 315 | Sync Health Dashboard | TODO | Mission Control | 312 | Sync status monitoring, gap detection, error forwarding |
| 316 | Cosign Image Pipeline | TODO | Mission Control | - | GitHub Actions, Cosign keyless OIDC signing, SBOM generation |
| 317 | Controlled Rollout | TODO | Mission Control | 316, 307 | Canary/rolling/immediate strategies, auto-rollback on health check failure |
| 318 | Billing Integration | DONE | Mission Control | 300 | Datacap-based (no Stripe), settlement deduction + card-on-file, manual escalation |
| 319 | Wildcard Subdomain Routing | DONE | Mission Control | 300 | *.ordercontrolcenter.com DNS, per-venue POS subdomains |
| 320 | Tenant Isolation (Schemas + RLS) | DONE | Mission Control | 301 | Per-org schemas, FORCE RLS, withTenantContext, fail-closed |
| 321 | PayFac Credential Management | DONE | Mission Control | 301, 307 | AES encrypt at rest, RSA per-server push, heartbeat hash verification, dedup |
| 322 | Subscription Tiers & Hardware Limits | DONE | Mission Control | 301, 318 | 3-tier limits, per-location overrides, tier comparison UI, FORCE_SYNC on change |
| 323 | Billing & Late Payment Flow | DONE | Mission Control | 318 | Datacap-based, settlement deduction, card-on-file, manual escalation, billing dashboard |
| 329 | Venue Provisioning locationId Handoff | DONE | Mission Control | 302 | Provision returns posLocationId, MC stores it, JWT includes it, cloud-session uses it |
| 330 | Cloud Auth Venue Admin | DONE | Mission Control | 300, 329 | HMAC-SHA256 JWT, cloud-session cookie, admin-only POS access, route blocking |
| 331 | Team Management Page | DONE | Mission Control | 300 | Clerk API for invite/role/remove, TeamManager component, audit logging |
| 332 | Venue Admin Portal | DONE | Mission Control | 300, 330 | Sidebar nav, POS-matching dark UI, settings/team/hardware/servers pages |
| 334 | Release Management & Deployment | DONE | Mission Control | 301, 307, 308 | Create releases (semver, channel, image tag), deploy to locations via FORCE_UPDATE FleetCommand, schema version gate, per-location results |
| 335 | Auth Enhancements | DONE | Mission Control | 300 | AdminUser auto-provisioning (resolveAdminUserId), CloudOrganization ID resolution (resolveCloudOrgId), FK constraint fix for audit logs |
| 336 | Online Ordering URL Infrastructure | DONE | Mission Control | 300, 319 | orderCode (6-char unique) + onlineOrderingEnabled on CloudLocation, auto-generate on create, VenueUrlCard UI with toggle + copy, path-based URL pattern |
| 337 | Multi-Tenant DB Routing | DONE | Mission Control | 300, 330 | AsyncLocalStorage + withVenue() wrapper for all 348 POS API routes. 3-tier Proxy resolution: request context → headers → master. Per-venue Neon DB via globalThis cache. |
| 338 | Cloud Session Validation & Guard | DONE | Mission Control | 337, 330 | validate-session endpoint, useRequireAuth cloud awareness, useCloudSessionGuard layout guard, cloud sign-out button. Fixes stale locationId after DB routing changes. |
| 345 | NUC Installer Package | DONE | Mission Control / DevOps | 302, 303 | `installer.run` (~1,454 lines) provisions Ubuntu/Kubuntu NUCs. RSA key exchange, heartbeat with localIp + posLocationId, sync agent, kiosk + RealVNC. Server and Terminal roles. |
| 346 | Kiosk Exit Zone | DONE | Hardware / DevOps | 345 | Hidden 5-tap zone (top-left corner, 64×64px) to exit Chromium kiosk mode. Root layout placement, exit-kiosk API, sudoers integration. |
| 347 | MC Heartbeat IP Display & Auto-Provisioning | DONE | Mission Control | 303, 345 | Heartbeat accepts posLocationId, auto-provisions CloudLocation. localIp displayed in admin dashboard, venue portal, portal server list. |
| 375 | NUC-to-Cloud Event Pipeline | DONE | Cloud Sync, Payments | 345, 347 | HMAC-signed fire-and-forget event emitter (`cloud-events.ts`), local PG retry queue (`cloud-event-queue.ts`), wired in pay route. Java 25 backoffice ingests events idempotently. Phase 1 proven: 7+ orders, $50.71 gross. |
| 376 | Device Fleet Management | DONE | Mission Control | 303, 322, 345 | Device inventory via heartbeat, MC DeviceInventoryCard, count vs limit progress bars |
| 377 | Remote Device Actions | DONE | Mission Control | 307, 308, 376 | RESTART_KIOSK/RELOAD_TERMINALS/RELOAD_TERMINAL commands, SystemReloadListener, RemoteActionsCard |
| 378 | Deploy Alerts & Version Mismatch | DONE | Mission Control | 334, 308 | Red deploy failure banner, amber version mismatch warning, FORCE_UPDATE fix (db push not migrate) |
| 379 | Terminal License Enforcement | DONE | Mission Control | 304, 322, 376 | POS-side checkDeviceLimit(), fail-open design, progress bar UI in MC |
| 380 | Kiosk Performance (Incognito Removal) | DONE | DevOps | 345, 377 | Remove --incognito from kiosk Chromium flags, cache assets between restarts |
| 381 | Release Kiosk Restart | DONE | Mission Control | 334, 377 | requiresKioskRestart on Release, auto-reload terminals after deploy |

### Performance Overhaul (Feb 14, 2026)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 339 | Frontend Instant Feel | DONE | Global | - | Zustand atomic selectors, batch set(), React.memo on OrderPanelItem. Button tap 500-800ms → 100-200ms. |
| 340 | Shared Socket Singleton | DONE | Global | - | One io() per tab via shared-socket.ts with ref counting. Direct emit (no HTTP hop). Kill all constant polling. |
| 341 | Database Hot Paths | DONE | Orders/Menu | - | Batch liquor N+1 (30→3 queries), unblock pay route, 7 compound indexes, menu cache (60s TTL), floor plan snapshot (4→1), bulk menu items, lightweight PATCH. |
| 342 | PostgreSQL-Only DevOps | DONE | DevOps | - | Remove all SQLite refs from Docker/scripts/docs. Connection pooling. Zero SQLite references in codebase. |
| 343 | Socket & State Hardening | DONE | Global | 340 | 150ms event debouncing, delta open orders, conditional 30s polling, location/menu caches, connectedTerminals leak fix. |
| 344 | Order Flow Performance (P0) | DONE | Orders/Payments | 339, 340, 341 | PaymentModal instant open, fire-and-forget cash, floor plan snapshot coalescing, draft pre-creation, 5s background autosave. |
| 357 | POS Overhaul Phase 6 | DONE | Orders/Performance | 339-344 | React.memo (4 components), 47 atomic selectors, delta sockets, optimistic splits, ~13K dead code removed, client caching. |

### POS Inventory (Non-MC)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 324 | Ingredient Category Delete | DONE | Inventory | - | Category delete with cascade soft-delete. Empty categories delete freely; categories with items show warning + require typing DELETE. Both list and hierarchy views. |
| 325 | Prep Item Cost Cascade Fix | DONE | Inventory | 126 | Rewrote /api/ingredients/[id]/cost to use direct DB queries (was fragile HTTP self-fetch). Fixed 11 missing fields in list API. Cost now cascades: recipe→parent→prep item. |

### Advanced Order Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 11 | Seat Tracking | DONE | Orders | 02 | Per-seat orders, item assignment API |
| 12 | Course Firing | DONE | Orders | 07 | Multi-course meals, course API |
| 13 | Hold & Fire | DONE | Orders | 07 | Kitchen timing, hold/fire actions |
| 14 | Order Splitting | DONE | Orders | 30 | Split evenly, by item, custom amount |
| 15 | Order Merging | DONE | Orders | 02 | Merge orders, move items, recalc totals |
| 230 | Quick Pick Numbers | DONE | Orders | 76, 99 | Gutter strip (1-9) for instant qty, multi-digit entry, multi-select, hold/delay/course buttons, per-employee setting |
| 231 | Per-Item Delays | DONE | Orders | 13, 230 | Per-item delay presets (5/10/15/20m), countdown timers, auto-fire, hold/delay mutual exclusivity, fire-course API |
| 232 | Note Edit Modal | DONE | Orders | - | Dark glassmorphism modal replacing window.prompt() for kitchen notes, touch-friendly |
| 233 | Modifier Depth Indentation | DONE | Menu | 123 | Depth-based rendering (• top-level, ↳ children, 20px indent/depth), pre-modifier color labels (NO=red/EXTRA=amber/LITE=blue), childToParentGroupId parent-chain walk for depth computation |
| 234 | Shared OrderPanel Items Hook | DONE | Orders | 233 | useOrderPanelItems hook consolidating 3 duplicate item mapping pipelines (FloorPlanHome, BartenderView, orders/page) into single source of truth |
| 235 | Unified BartenderView Tab Panel | DONE | Orders | 234 | Replaced BartenderView's custom tab list (~450 lines deleted) with shared OpenOrdersPanel component. Added forceDark and employeePermissions props. |
| 236 | Comp/Void from BartenderView | DONE | Orders | 235 | Added onOpenCompVoid callback prop to BartenderView, wired in orders/page.tsx to open CompVoidModal. Previously showed "coming soon" toast. |
| 237 | Waste Tracking (Was It Made?) | DONE | Orders | 34 | Added wasMade field to CompVoidModal UI (Yes/No buttons), VoidLog schema, and OrderItem schema. API uses explicit wasMade from UI instead of guessing from reason text. |
| 238 | VOID/COMP Stamps on Order Panel | PARTIAL | Orders | 237, 234 | VOID/COMP badges, strikethrough name, $0.00 price, waste indicator on OrderPanelItem. Added status/voidReason/wasMade to order store, response mapper, FloorPlanHome shim. Fix applied but needs verification. |
| 248 | Socket Layer + Fetch Consolidation | DONE | Orders | 217 | Eliminated ~40 req/min: replaced 3s entertainment + open orders polling with useOrderSockets hook, removed 5 redundant post-mutation refetches, debounced tabsRefreshTrigger, wired dispatchOpenOrdersChanged + dispatchEntertainmentStatusChanged into API routes, fixed ORDER_TOTALS_UPDATE silent 400 |

### Table Management
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 16 | Table Layout | DONE | Floor Plan | - | Floor plan, sections, shapes |
| 17 | Table Status | DONE | Floor Plan | 16 | Available/occupied/reserved/dirty, quick toggle |
| 18 | Table Transfer | DONE | Floor Plan | 16, 02 | Transfer API, moves orders with audit log |
| 19 | Reservations | DONE | Events | 16 | Full booking system, admin page, status tracking |
| 117 | Virtual Table Combine | DONE | Floor Plan | 106, 107 | **REMOVED in Skill 326** — was: long-press to link tables |
| 206 | Seat Management System | DONE | Floor Plan | 16 | Seat API, generation, positioning, orbital auto-spacing or manual DB positions |
| 207 | Table Resize & Rotation | DONE | Floor Plan | 16 | 8 resize handles, rotation handle, grid snap, collision detection, shape-specific minimums |
| 229 | Table Combine Types | DONE | Floor Plan | 107, 117 | **REMOVED in Skill 326** — was: physical vs virtual combine |
| 326 | Combine Removal (Full) | DONE | Floor Plan | 117, 229 | Both virtual AND physical combine fully removed from entire codebase (116 files, -16,211 lines). Tables are now standalone. API routes return 410 Gone. |
| 328 | Seat Management Fixes | DONE | Floor Plan, Orders | 121, 206 | Add seat after send, seatNumber persistence on items, extra seats restore on reopen |
| 348 | Per-Seat Color System | DONE | Floor Plan, Orders | 206, 328 | 8-color palette in seat-utils.ts, colors on floor plan seats, order panel badges, group headers, seat picker buttons. Temp seats use same colors (no more orange dashed). |
| 349 | Per-Seat Check Cards & Seat Filtering | DONE | Orders, Floor Plan | 348, 11 | Auto seat-grouped check cards with per-seat subtotals, seat filter bar on floor plan seat tap, pre-split foundation. |

### Bar Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 20 | Bar Tabs | DONE | Orders | 02 | Create, view, edit, pay tabs. Re-Auth flow (Skill 247). Bar renamed from "Bar Mode". Send prompts for tab name with keyboard (Skill 369). Dynamic tab from admin config (Skill 367). |
| 247 | Tab Incremental Auth | DONE | Payments | 120, 21 | Re-Auth button (no card re-tap), IncrementalAuthByRecordNo via Datacap, configurable tip buffer %, admin settings UI, force vs auto modes |
| 21 | Pre-auth | DONE | Payments | 30 | Card hold on tab open |
| 22 | Tab Transfer | DONE | Orders | 20 | Move tabs between employees, audit log |

### Kitchen Display
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 67 | Prep Stations | DONE | KDS | - | KDS routing: station types, category/item assignment |
| 23 | KDS Display | DONE | KDS | 07, 67 | Full KDS screen: item bump, station filter, fullscreen |
| 24 | Bump Bar | TODO | KDS | 23 | Physical bump bar hardware |
| 25 | Expo Station | PARTIAL | KDS | 23 | Expo mode works via showAllItems toggle |
| 26 | Prep Tickets | TODO | KDS | 07 | Prep station routing |
| 102 | KDS Device Security | DONE | Hardware | 23 | Device pairing, httpOnly cookies, static IP enforcement |
| 103 | Print Routing | DONE | Hardware | 67 | Direct category/item printer assignment, multi-destination, KDS support, backup failover |

### Pricing & Discounts
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 27 | Happy Hour | DONE | Settings | 09, 03 | Time-based pricing, schedules, settings |
| 28 | Discounts | DONE | Settings | 02 | Manual discounts, preset rules, % or $ |
| 29 | Commissioned Items | DONE | Employees | 01 | Sales commissions |
| 34 | Comps & Voids | DONE | Orders | 02, 01 | Comp/void items, reasons, reports |
| 122 | Remote Void Approval | DONE | Orders | 34 | SMS-based manager approval for voids when off-site, Twilio integration |
| 35 | Coupons | DONE | Settings | 28 | Promo codes, admin page, redemption tracking |
| 88 | Price Rounding | DONE | Payments | 09 | Cent-safe rounding via `roundToCents()`, `roundPrice()` rewritten to cent-based math (Skill 239) |
| 239 | Pricing Engine Refactor | DONE | Payments | 31, 36, 88 | Single source of truth: `roundToCents()`, extended `calculateOrderTotals`, `usePricing` as thin adapter, 29 files |
| 240 | Tax-Inclusive Pricing | DONE | Settings | 36, 239 | Category-based tax-inclusive rules, `calculateSplitTax()`, item stamping, split UI display |
| 327 | Cash Rounding Pipeline | DONE | Payments | 88, 239 | Two rounding systems (priceRounding active, cashRounding legacy). Client sends rounded amount, server computes adjustment from rawRemaining. Rounding artifact handling, paidTolerance = half increment. Daily report integration. |

### Inventory & Menu
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 37 | 86 Items | DONE | Inventory | 03 | Item availability |
| 38 | Inventory Tracking | DONE | Inventory | 37 | Stock levels, transactions, admin page |
| 39 | Low Stock Alerts | DONE | Inventory | 38 | Alerts API, acknowledge, priority levels |
| 40 | Menu Scheduling | DONE | Menu | 03, 09 | Daypart menus, time windows |
| 41 | Combo Meals | DONE | Menu | 03 | Item-based combos, modifier price overrides, admin page, POS modal |
| 125 | Ingredient Costing & Recipes | DONE | Inventory | 38 | Recipe components for inventory items, batch yield, yield %, portion size, modifier multipliers |
| 126 | Explicit Input → Output Model | DONE | Inventory | 125 | Prep items with explicit input/output transformation, unit conversions, auto-calculated yield, cost derivation |
| 127 | Quick Stock Adjustment | DONE | Inventory | 126 | Manager quick adjust page with verification, cost tracking, socket dispatch, audit trail |
| 128 | Inventory Recipe Costing | DONE | Inventory | 125 | Recipe-based food costing, historical cost tracking |
| 130 | Inventory Historical Costs | DONE | Inventory | 128 | Historical cost snapshots for trend analysis |
| 131 | Food Cost Dashboard | DONE | Inventory | 130 | Dashboard for food cost % monitoring |
| 132 | Inventory Alerts | DONE | Inventory | 38, 39 | Advanced inventory alerts beyond low stock |
| 133 | Quick Pricing Update | DONE | Menu | 03 | Rapid batch price updates for menu items |
| 134 | Vendor Management | DONE | Inventory | 38 | Vendor CRUD, purchase orders, supplier tracking |
| 135 | Theoretical vs Actual | DONE | Inventory | 128 | Compare expected vs actual usage, variance reports |
| 136 | Waste Logging | DONE | Inventory | 38 | Track waste with reasons, reports, trend analysis |
| 137 | Par Levels | DONE | Inventory | 38 | Set par levels per ingredient, auto-order suggestions |
| 138 | Menu Engineering | DONE | Menu | 42, 128 | Stars/Plow Horses/Puzzles/Dogs matrix, profitability analysis |
| 139 | Inventory Count | DONE | Inventory | 38 | Physical count sheets, variance to theoretical |
| 140 | 86 Feature (Enhanced) | DONE | Inventory | 37 | Enhanced 86 with quick toggle, auto-86 on zero stock |
| 141 | Menu/Liquor Builder Separation | DONE | Menu | 09 | Filter /menu to show only food categories, exclude liquor/drinks; comprehensive liquor inventory seeding (147 bottles, 6 categories, auto-tiered) |
| 145 | Ingredient Verification | DONE | Inventory | 125, 204 | needsVerification flag for items created from Menu Builder, red highlight in inventory, verify button |
| 204 | Ingredient Library Refactor | DONE | Inventory | 125, 126, 127 | Major refactor: 61% code reduction, race protection, bulk API, debounced search, toast notifications, accessibility |
| 205 | Component Improvements | DONE | Inventory | 204 | Shared cost hook, recipe cost aggregation (N→1), hierarchy caching (5min TTL), error rollback, accessibility |
| 215 | Unified Modifier Inventory Deduction | DONE | Inventory | 125, 143 | Fallback path: Modifier.ingredientId → Ingredient → InventoryItem for deduction when no ModifierInventoryLink exists; updates deductInventoryForOrder, deductInventoryForVoidedItem, calculateTheoreticalUsage, PMIX |
| 216 | Ingredient-Modifier Connection Visibility | DONE | Inventory | 143, 204, 211, 214 | Bidirectional visibility: Connected badge, dual-path menu item resolution (item-owned + junction), expandable linked modifiers panel, linkedModifierCount |
| 333 | Ingredient Category Inline Creation | DONE | Menu, Inventory | 145, 211 | Create categories inline from ItemEditor picker (green + purple). needsVerification flag, red badge + verify button on /ingredients page. Optimistic UI updates. |

### Reporting
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 42 | Sales Reports | DONE | Reports | 30 | Day, hour, category, item, employee, table, seat, order type, modifier, payment method |
| 43 | Labor Reports | DONE | Reports | 47 | Hours worked, labor costs, overtime, by employee/day/role |
| 44 | Product Mix | DONE | Reports | 42 | Item performance, pairings, hourly distribution |
| 45 | Void Reports | DONE | Reports | 34 | By date, employee, reason |
| 46 | Commission Reports | DONE | Reports | 29 | Employee commissions |
| 70 | Discount Reports | DONE | Reports | 28 | Discount usage, by type, by employee, by day |
| 71 | Transfer Reports | DONE | Reports | 22, 68 | Tab/item transfers, audit trail, by employee/hour |
| 72 | Table Reports | DONE | Reports | 16, 42 | Sales by table, turn times, server sections |
| 73 | Customer Reports | DONE | Reports | 51 | Spend tiers, frequency, tags, at-risk customers |
| 104 | Daily Store Report | DONE | Reports | 42, 43, 50 | Comprehensive EOD report: revenue, payments, cash, sales by category/type, voids, discounts, labor, tips |
| 105 | Tip Share Report | DONE | Reports | - | Standalone tip share report, by recipient/giver, mark as paid, payroll/manual settings |
| 374 | Reports Auth Fix (14 Pages) | DONE | Reports, Auth | 104 | All 14 report pages missing `employeeId` in fetch calls causing 401. Fixed all pages + deterministic `getLocationId()` + stale location cleanup. |
| 106 | Interactive Floor Plan (SVG) | DONE | Floor Plan | 16, 80 | SVG floor plan with zoom, pan, status colors, seat display |
| 107 | Table Combine/Split | DONE | Floor Plan | 106 | Drag-combine, split-all, remove-single undo, 5min window, clockwise seats from top-left |
| 108 | Event Ticketing APIs | TODO | Events | 106 | Event CRUD, seat hold/release, ticket purchase, check-in |
| 109 | Visual Pizza Builder | DONE | Menu | 106 | Two-mode pizza ordering (Quick Mode + Visual Builder), admin config, full API |
| 110 | Real-time Events (Pusher) | TODO | KDS | - | WebSocket abstraction for instant updates (seats, orders, KDS) |

### Employee Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 47 | Clock In/Out | DONE | Employees | 01 | Clock in/out, breaks, hours, modal UI |
| 48 | Breaks | DONE | Employees | 47 | Break start/end API, duration tracking |
| 49 | Cash Drawer | DONE | Employees | 01, 30 | Physical Drawer model, drawer claiming via Shift.drawerId, drawer-aware expected cash, resolveDrawerForPayment() |
| 50 | Shift Close | DONE | Employees | 49 | Shift start/close, cash count, variance, summary, three cash handling modes (drawer/purse/none) |
| 249 | Multi-Role, Cash Handling & Crew Hub | DONE | Employees, Payments | 01, 47, 50 | EmployeeRole junction (multi-role), cash handling modes per role, Drawer management, Crew Hub (/crew), report self-access |

### Customer Features
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 51 | Customer Profiles | DONE | Settings | - | Full CRUD, admin UI at /customers, reports |
| 52 | Loyalty Program | DONE | Payments | 51 | Points earning/redemption, settings, receipt display |
| 228 | Card Token-Based Loyalty | TODO | Payments | 120, 52, 227 | Automatic customer recognition via processor card tokens, hybrid phone/token system, multi-card linking, Phase 1: token persistence verification (blocker) |
| 53 | Online Ordering | TODO | Guest | 03, 30, 99 | Web orders (modifier override ready via ?channel=online) |
| 54 | Order Ahead | TODO | Guest | 53 | Scheduled pickup |

### Hardware Integration
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 55 | Receipt Printer | TODO | Hardware | 08 | Direct printing |
| 56 | Cash Drawer | TODO | Hardware | 49 | Drawer control |
| 57 | Card Reader | TODO | Hardware | 30 | Payment terminal |
| 58 | Barcode Scanner | TODO | Hardware | 03 | Item lookup |
| 115 | Hardware Status Dashboard | TODO | Hardware | 55, 56, 57 | Live connection status for all hardware, last ping times, alerts |

### Advanced
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 60 | Offline Mode | TODO | Settings | ALL | Work without internet |

### Menu Builder
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 129 | Menu Builder Child Modifiers | DONE | Menu | 04 | Nested child modifier groups with unlimited depth, parentModifierId linking |
| 142 | Tiered Pricing & Exclusion Rules | DONE | Menu | 04 | Tiered pricing modes (flat_tiers, free_threshold), exclusion groups, ModifierFlowEditor right panel |
| 143 | Item-Owned Modifier Groups | DONE | Menu | 142 | isLabel field, drag-drop reorder, cross-item copy, inline editing, ingredient linking, category-grouped dropdown |
| 144 | Production Hardening Pass | DONE | Menu | 142, 143 | Cycle-safe recursion, toast errors (26 blocks), debounced save, price validation, static Tailwind, API validation |
| 208 | POS Modifier Modal Redesign | DONE | Menu | 04, 100 | Dark glassmorphism theme, fixed-size modal, group progress dots, smooth transitions |
| 209 | Combo Step Flow | DONE | Menu | 41, 208 | Step-by-step wizard for combo meal configuration in POS |
| 210 | Modifier Cascade Delete & Orphan Cleanup | DONE | Menu | 143 | Cascade delete with preview, orphan auto-cleanup, fluid group nesting, collapsed child chips |
| 211 | Hierarchical Ingredient Picker | DONE | Inventory | 126, 143 | Unified picker for ingredients + modifier linking, category→parent→prep hierarchy, inline creation |
| 212 | Per-Modifier Print Routing | DONE | Menu | 103, 143 | Admin UI for modifier-level print routing (follow/also/only), printer selection per modifier |
| 213 | Real-Time Ingredient Library | DONE | Inventory | 211, 127 | Optimistic local update + socket dispatch for cross-terminal ingredient sync |
| 214 | Ingredient Verification Visibility | DONE | Inventory | 145, 211 | Unverified badges on ingredient rows, category header warnings, recursive reverse linking |

### Admin & Navigation
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 124 | Admin Navigation | DONE | Settings | - | Standardized AdminPageHeader and AdminSubNav components across all admin pages |

### Additional Skills (80+)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 80 | Floor Plan Editor | DONE | Floor Plan | 16 | Drag & drop table positioning |
| 81 | Timed Rentals | DONE | Entertainment | 03 | Pool tables, karaoke, bowling - POS integration, stop & bill, entertainment category type builder, status tracking (94-97) |
| 82 | Login Redirect | DONE | Settings | 09 | Preserve destination URL after login |

---

## Implementation Summary

### Completion Status by Category

| Category | Done | Partial | Todo | Total | % Complete |
|----------|------|---------|------|-------|------------|
| Foundation | 3 | 0 | 1 | 4 | 75% |
| Order Flow | 7 | 1 | 0 | 8 | 94% |
| Payment | 14 | 0 | 0 | 14 | 100% |
| Advanced Orders | 13 | 2 | 0 | 15 | 93% |
| Table Management | 6 | 0 | 0 | 6 | 100% |
| Bar Features | 2 | 1 | 0 | 3 | 83% |
| Kitchen Display | 4 | 1 | 2 | 7 | 71% |
| Pricing & Discounts | 8 | 0 | 0 | 8 | 100% |
| Inventory & Menu | 26 | 0 | 0 | 26 | 100% |
| Menu Builder | 6 | 0 | 0 | 6 | 100% |
| Reporting | 13 | 0 | 0 | 13 | 100% |
| Employee Features | 6 | 0 | 0 | 6 | 100% |
| Customer Features | 2 | 0 | 3 | 5 | 40% |
| Hardware | 0 | 0 | 4 | 4 | 0% |
| Advanced | 0 | 0 | 1 | 1 | 0% |
| Admin & Navigation | 2 | 1 | 0 | 3 | 83% |
| Additional (80-105) | 20 | 1 | 0 | 21 | 98% |
| Canvas/Events (106-123) | 9 | 0 | 5 | 14 | 64% |
| Routing & KDS (200s) | 5 | 0 | 0 | 5 | 100% |
| Datacap & Multi-Surface (217-220) | 4 | 0 | 0 | 4 | 100% |
| Payment System Lockdown (221-227) | 7 | 0 | 0 | 7 | 100% |
| Tips & Tip Bank | 38 | 0 | 0 | 38 | 100% |
| KDS Browser Compat | 1 | 0 | 0 | 1 | 100% |
| Mission Control (Phase 2) | 28 | 0 | 2 | 30 | 93% |
| DevOps | 1 | 0 | 0 | 1 | 100% |
| Performance Overhaul | 7 | 0 | 0 | 7 | 100% |
| **TOTAL** | **215** | **7** | **18** | **240** | **92%** |

### Parallel Development Groups (Remaining)

Skills that can be developed simultaneously:

**Group A: UI Enhancements** ✅ COMPLETE
- ~~76: Course/Seat Management UI~~ DONE
- ~~77: Hold & Fire UI~~ DONE
- ~~65: Order History~~ DONE

**Group B: Menu Features** ✅ COMPLETE
- ~~40: Menu Scheduling~~ DONE
- ~~41: Combo Meals~~ DONE
- ~~38: Inventory Tracking~~ DONE
- ~~39: Low Stock Alerts~~ DONE

**Group C: Reports** ✅ COMPLETE
- ~~78: Coupon Reports~~ DONE
- ~~79: Reservation Reports~~ DONE

**Group D: Hardware (When Ready)**
- 55: Receipt Printer
- 56: Cash Drawer
- 57: Card Reader
- 58: Barcode Scanner

---

## Next Skills to Build (Updated 2026-01-27)

### High Priority - Core Functionality Gaps

**Skill 76: Course/Seat Management UI** ✅ DONE
- POS UI for assigning items to seats and courses
- SeatCourseHoldControls component with inline controls
- CourseOverviewPanel with bulk course actions
- ItemBadges for compact status display
- Dependencies: 11, 12 (both done)
- Status: DONE

**Skill 77: Hold & Fire UI** ✅ DONE
- POS controls for holding/firing items
- Hold/Fire/Release buttons in SeatCourseHoldControls
- Visual HELD badge with pulse animation
- Kitchen integration for hold status
- Dependencies: 13 (done)
- Status: DONE

**Skill 65: Order History** ✅ DONE
- View past orders with search/filters
- Filter by date, customer, employee, status, type
- Reprint receipts via ReceiptModal
- Dependencies: 02, 30 (both done)
- Status: DONE

### Medium Priority - Business Features

**Skill 40: Menu Scheduling** ✅ DONE
- Time windows (availableFrom, availableTo)
- Day-of-week restrictions (availableDays)
- Schema + API updates
- Dependencies: 03, 09 (both done)
- Status: DONE

**Skill 41: Combo Meals** ✅ DONE
- Combo templates with component slots
- Options per component with upcharges
- Admin page for combo management
- Dependencies: 03 (done)
- Status: DONE

**Skill 38: Inventory Tracking** ✅ DONE
- Stock levels per item
- Transaction history (purchase, sale, waste, adjustment, count)
- Admin page at /inventory
- Dependencies: 37 (done)
- Status: DONE

**Skill 39: Low Stock Alerts** ✅ DONE
- Alerts when stock < reorder point
- Priority levels (low, medium, high, urgent)
- Acknowledge to clear
- Status: DONE

**Skill 48: Breaks** ✅ DONE
- Start/end break API
- Paid/unpaid break types
- Duration tracking
- Status: DONE

**Skill 80: Floor Plan Editor** ✅ DONE
- Drag and drop table positioning
- Canvas with grid
- Properties panel for editing
- Status: DONE

**Skill 81: Timed Rentals** ✅ DONE
- Pool tables, dart boards, hourly items
- Timer display with pause/resume
- Charge calculation by rate type
- Admin page at /timed-rentals
- Status: DONE

### Lower Priority - Hardware & Advanced

**Skill 55-58: Hardware Integration**
- Receipt printer direct printing
- Cash drawer control
- Card reader integration
- Barcode scanner support
- Status: All TODO

**Skill 60: Offline Mode**
- Work without internet
- Sync when reconnected
- Dependencies: ALL
- Status: TODO

---

## Recently Completed (2026-02-19 — Reports Auth Fix + NUC-Cloud Pipeline, Skills 374-375)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 374 | Reports Auth Fix (14 Pages) | All 14 report pages in `src/app/(admin)/reports/` were missing `employeeId` in API fetch calls, causing `requirePermission()` to return 401 and show "no data." Fixed by adding `employeeId` from auth store to every fetch URL. Also fixed `getLocationId()` in `location-cache.ts` to use deterministic `orderBy: { id: 'asc' }` and deleted stale location record `cmlkcq9ut0001ky04fv4ph4hh` ("gwi-admin-dev"). |
| 375 | NUC-to-Cloud Event Pipeline | Built end-to-end event pipeline: `cloud-events.ts` (HMAC-SHA256 signed emitter), `cloud-event-queue.ts` (local PG retry queue with exponential backoff), wired `order_paid` in pay route (fire-and-forget). Java 25 backoffice at `gwi-backoffice` ingests events idempotently (`ON CONFLICT DO NOTHING`). Added `CloudEventQueue` to `NO_SOFT_DELETE_MODELS`. Phase 1 proven working: 7+ orders, $50.71 gross sales. 3 bugs found and fixed (field mappings, soft-delete filter, orderNumber type cast). |

---

## Recently Completed (2026-02-18 — Forensic Audit Wave 6, Skill 373)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 373 | Forensic Audit Wave 6 | **6A:** 4 hook extractions (usePaymentFlow, useModifierModal, useItemOperations, useComboBuilder — 21 states). **6B:** Void flow simplified from 5-6 taps to 3 (auto-detect wasMade, auto-select first reason). **6C:** Quick tab 1-tap creation, payment skip for pre-auth tabs, clickable seat headers. **6D:** "Same Again" reorder button, ÷2 quick-split. **6E:** Multi-card tab support (Add Card to Tab, card picker, charge specific card). **6E-HF:** Fixed deleted items reappearing (Prisma `$extends` doesn't cascade to nested includes). **6F:** Fixed ingredient modifications not showing (added `ingredientModifications: true` to 5 query paths). Also fixed deployment errors: removed dead scripts referencing removed schema fields, fixed inventory TS errors. |

---

## Recently Completed (2026-02-17 — Split Combined View, Inline Split Creation, UI Polish, Skills 370-372)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 370 | Split Order Combined View | Tapping a split table fetches ALL child split items from `/api/orders/{id}/split-tickets` and merges into parent view. Items tagged with `splitLabel` (e.g. "75-1"). Purple "Check 75-1" headers with subtotals. Fixed API response parsing (`splitOrders` not `data`), field mapping (`menuItemId`, `sentToKitchen`, `modifierId`). |
| 371 | Inline Split Creation | "+ New" button (dashed purple) at end of split chips row. Calls `POST create-check` API, adds chip, loads new split for immediate item entry. Fixed context preservation: useEffect checks `splitParentId` instead of stale `orderSplitChips` array. |
| 372 | Split Parent Item Add Guard | Blocks adding items to split parent (status === 'split'). Toast: "Select a split check or add a new one". Purple flash animation (3x pulse) on split chips row. Guard in both `handleAddItem` and `handleMenuItemTap`. |
| — | UI Polish | Removed bottom Hide button (redundant). Moved Print between Cash/Card in quick-pay. Moved Other between Cash/Card in payment buttons. Hidden seat section when order has splits. |
| — | Prior Session Bug Fixes | Added `status: data.status` to all 3 `loadOrder` callers. Removed early-return for split orders in handleTableTap. Fixed stale closure in handleCategoryClick/handleQuickBarItemClick with useRef. Fixed SplitCheckScreen receiving child ID instead of parent. Fixed Zustand mutation (tabName) with updateOrderType. Tab name modal state cleanup. Removed viewMode from auto-create deps. Split status guard on clearOrder. |

## Recently Completed (2026-02-17 — Real-Time Sync, Order Types Overhaul, On-Screen Keyboard, Skills 365-369)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 365 | Cloud-to-Terminal Real-Time Sync | Fixed 3-bug chain: FLEET_NOTIFY_SECRET trailing newline (401), posLocationId→CloudLocation.id mismatch (500), installer chown -R. Full sync chain verified: cloud edit → POS Vercel → MC notify → FleetCommand → SSE → NUC → Socket.io → terminals. |
| 366 | Duplicate Order Prevention | Ref-based `sendInProgressRef` guard at top of `handleSendToKitchen`. React state too slow for multi-tap; ref is synchronous. Voided orphaned duplicate orders. |
| 367 | Dynamic Order Type Tabs | Replaced hardcoded header tabs with dynamic tabs from admin config. Table selection enforcement for dine_in. NavTab accentColor. Order type conversion on mode switch. Tables tab active state fix. useOrderTypes hook. |
| 368 | On-Screen Virtual Keyboard | QWERTY/numeric/phone keyboard for kiosk terminals (no physical keyboard). Dark + light themes. Integrated into BartenderView, NewTabModal, OrderTypeSelector, CustomerLookupModal, AddToWaitlistModal. |
| 369 | Bar Send Tab Name Prompt | Send in bar mode shows tab name modal with keyboard instead of silently failing. pendingSendAfterTabRef tracks send-triggered modals. Extracted sendItemsToTab() shared helper. |

## Recently Completed (2026-02-17 — POS Overhaul Phase 6, Unified Header, Batch Splits, Installer Fixes, Skills 357-364)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 357 | POS Overhaul — Performance Phase 6 | React.memo on OrderPanel, QuickPickStrip, UnifiedPOSHeader, OrderPanelActions. 47 Zustand atomic selector fixes. UnifiedFloorPlan delta socket handlers (3 events → zero-network). Optimistic SplitCheckScreen with snapshot rollback. ~13K lines dead code removed (18 components, 3 hooks, src/bridges/, src/domains/). Client caching: useOrderSettings 5min TTL, DiscountModal, OrderTypeSelector. |
| 358 | Unified POS Header Component | Extracted ~700 lines from FloorPlanHome into shared UnifiedPOSHeader.tsx. Rendered once in orders/page.tsx above both floor plan and bartender views. Employee dropdown, view mode tabs, settings gear, search bar, Open Orders badge. Ref callbacks for cross-view communication. BartenderView header removed (~30 lines). |
| 359 | Batch Pay All Splits API | New `POST /api/orders/[id]/pay-all-splits` endpoint. Atomic batch payment for all unpaid split children. Two-step confirmation modal: Cash (direct API) or Card (DatacapPaymentProcessor → API with card details). Fixed split parent $0.00 in OpenOrdersPanel (getDisplayTotal sums children). Fixed bar mode savedOrderId sync via onSelectedTabChange. |
| 360 | Terminal Private IP Recognition | Added `isLocalNetworkHost()` to middleware. Recognizes RFC 1918 (10.x, 172.16-31.x, 192.168.x), loopback (127.x, ::1). Terminals on LAN now correctly route to local DB instead of cloud Neon. |
| 361 | Default Port Migration | Changed default port 3000 → 3005 across 9 files (server.ts, installer.run, playwright, seed, etc.) to avoid PM2/service conflicts. |
| 362 | Kiosk Systemd Service Hardening | 3-commit fix: Restart=always → on-failure (prevented duplicate tabs), removed pkill -f self-match bug, removed killall dependency. Added --no-first-run, --disable-features=TranslateUI. Both server and terminal kiosk services. |
| 363 | Installer HTTP Auto-Prepend | Auto-prepend `http://` for bare IP input (e.g., `172.16.1.254:3000`). Also fixed `.env` copy failure on re-install (`cp: same file` with set -euo pipefail). |
| 364 | EOD Stale Order Management | PLANNED: T-077 (P1) auto-cancel $0 drafts at shift close, roll forward orders with balances. T-078 (P2) admin UI to view/manage stale orders across days. Context: 63 orphaned orders found during testing. |

## Recently Completed (2026-02-16 — Shape Standardization, Optimistic Updates & Split Payment Fix, Skills 354-356)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 354 | Table Shape Standardization | Unified all table shape references across 18 files to 5 DB-canonical values: `rectangle`, `circle`, `square`, `booth`, `bar`. Removed `round`, `oval`, `hexagon`, `bar_seat`, `high_top`, `custom`. Ellipse detection now uses `width !== height` instead of `shape === 'oval'`. |
| 355 | Optimistic Floor Plan Updates | Replaced blocking `loadFloorPlanData()` calls with instant Zustand store patches. Seat addition uses `addSeatToTable()` with computed orbit position. Send-to-kitchen uses `addTableOrder()` to mark table occupied immediately. Both FloorPlanHome and orders/page.tsx updated. |
| 356 | Split Payment Bug Fix | Fixed 3 bugs causing orphaned items: (1) split creation now soft-deletes ALL parent items and zeros parent totals, (2) pay route blocks `status='split'` orders, (3) "Pay All" pays first unpaid child split (starts payment loop) instead of parent. Button shows aggregate unpaid total and appears even after partial payments. |

## Recently Completed (2026-02-16 — Single Live Split Board & UI Hardening, Skills 352-353)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 352 | Single Live Split Board | Unified split ticket system from two-phase wizard into one live board. New API: `POST create-check` (empty split), `DELETE [splitId]` (remove empty split with auto-merge). SplitUnifiedView enhancements: card-tap-to-move in manage mode, delete empty checks, "+ New Check" card with smart item move. Split chips header in order panel (replaces seat strip for split tables). In-place payment loop via `splitParentToReturnTo` state. "Pay All" button for full-order payment. Auto-exit when all paid. Floor plan refresh on split screen close. Lightweight `?view=split` endpoint. Bootstrap race condition fix. 11 commits across 2 sessions. |
| 353 | Order Panel UI Hardening | Fixed 3 instances of React falsy-number gotcha: `resendCount` (primary culprit — API returns 0 for unsent items), `seatNumber` wrapper, `seatNumber` picker. Fixed `useQuickPick` selection collapse: cleanup effect was filtering out sent items, preventing Resend/Comp/Void access. Layout: inline print/delete, hide controls until selected, pointer cursor for sent items. Fixed 2 TypeScript build errors blocking Vercel: `TableNode` invalid `'round'`/`'oval'` shape cases, `OpenOrdersPanel` unreachable `'split'` trigger comparison. |

## Recently Completed (2026-02-15 — Split Check Redesign, Skills 350-351)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 350 | Split Check Screen Redesign | Complete rewrite of split check interface. Replaced `SplitTicketManager` with `useSplitCheck` hook (621 lines) + `SplitCheckScreen` component. 4 split modes: By Seat (auto-assigns by seat number), Custom (manual tap assignment), Even (N-way equal split), Business/Pleasure (category-based). Select-then-tap interaction model (no drag-and-drop). Fractional item splitting: split 1 item across 2-4 checks with penny-exact rounding ($25 ÷ 3 = $8.34, $8.33, $8.33). Client-side editing, single atomic POST on Save. API extended with `splitItems` array for fractional splits. `getAssignments()` excludes fractionally-split items to prevent double-counting. |
| 351 | Split Ticket Visibility & Navigation | Floor plan integration for split orders. Snapshot API extended: `status: { in: ['open', 'split'] }`, lightweight `splitOrders` sub-select. `FloorPlanTable` type extended with `status` and `splitOrders` array. TableNode shows violet badge "N splits" when table has split orders. Split-aware table tap: shows `SplitTicketsOverview` instead of OrderPanel for split tables. OrderPanel header: "Split 31-1 (1/3)" with ← → navigation arrows between splits. Merge-back: `DELETE /api/orders/[id]/split-tickets`, disabled if any split has payments. Transfer integration: wired `ItemTransferModal` with sub-menu (Transfer Items / Transfer Table / Transfer to Tab). |

## Recently Completed (2026-02-15 — Per-Seat Colors, Check Cards & Seat Filtering, Skills 348-349)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 348 | Per-Seat Color System | 8-color palette (`seat-utils.ts`): indigo, amber, emerald, red, cyan, orange, violet, pink. Colors applied to floor plan seats, order panel badges, group headers, seat picker buttons. Temporary/extra seats now use same color system (removed orange dashed styling). `getSeatColor`, `getSeatBgColor`, `getSeatTextColor`, `getSeatBorderColor` helpers. `seatsWithItems` memo drives grey-vs-colored on floor plan. |
| 349 | Per-Seat Check Cards & Seat Filtering | OrderPanel auto-groups items into card-style checks per seat (when 2+ seats have items) with per-seat subtotals. Both pending and sent sections group by seat. Tapping a seat on floor plan filters order panel to that seat only (colored "Showing Seat X" bar + "Show All" button). Filter clears on table tap or seat deselect. Full order total always shown. Foundation for future per-seat split payment. |

## Recently Completed (2026-02-12 — Online Ordering URL Infrastructure, Deploy Fix, Skills 335-336)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 335 | MC Auth Enhancements (Deploy Fix) | Fixed 500 error on release deploy — `resolveCloudOrgId()` converts Clerk org ID → CloudOrganization.id for FleetAuditLog FK. All 3 release routes updated. |
| 336 | Online Ordering URL Infrastructure | `orderCode` (unique 6-char) + `onlineOrderingEnabled` on CloudLocation. Auto-generated on create. VenueUrlCard rewritten: admin portal URL + online ordering URL with toggle/copy. Path-based URL: `ordercontrolcenter.com/{code}/{slug}`. Backfilled existing locations. |

## Recently Completed (2026-02-12 — MC Release System, Auth Fixes, Ingredient Category Creation)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 333 | Ingredient Category Inline Creation | "New Category" button + inline form in ItemEditor ingredient picker (both green and purple pickers). Categories created from Menu Builder get `needsVerification: true`. Red pulsing "New Category" badge + green "Verify" button on `/ingredients` page. Optimistic UI via `onCategoryCreated` callback. Schema: `needsVerification Boolean @default(false)` on IngredientCategory. |
| 334 | MC Release Management & Deployment | Release CRUD (create/list/detail/archive), deploy to locations via FORCE_UPDATE FleetCommand. Schema version gate blocks deploys if server too old. Per-location results (207 Multi-Status). Channel-scoped `isLatest` semantics. Full audit trail. |
| 335 | MC Auth Enhancements | `resolveAdminUserId()` auto-provisions AdminUser for first-time Clerk users (fixes "Admin user not found" error). `resolveCloudOrgId()` converts Clerk org ID → CloudOrganization.id for FK relations (fixes 500 on release create/deploy). All release routes updated with try-catch. |
| 336 | MC Online Ordering URL Infrastructure | `orderCode` (unique 6-char alphanumeric) + `onlineOrderingEnabled` on CloudLocation. Auto-generated on create. VenueUrlCard rewritten with admin portal + online ordering sections. Path-based URLs: `ordercontrolcenter.com/{code}/{slug}`. |
| 337 | Multi-Tenant DB Routing (withVenue + AsyncLocalStorage) | Per-request tenant context via `requestStore.run()`. `withVenue()` wrapper properly `await`s Next.js 16 `headers()`. 3-tier db.ts Proxy: AsyncLocalStorage → headers → master. All 348 API routes wrapped via codemod. Per-venue PrismaClient cached in `globalThis.venueClients`. Safety rail: slug present but DB fails → 500 (not silent fallback). |
| 338 | Cloud Session Validation & Guard | `GET /api/auth/validate-session` lightweight check. `GET /api/auth/cloud-session` re-bootstraps from httpOnly cookie. `useRequireAuth` cloud mode detection + re-bootstrap. `useCloudSessionGuard` in settings layout blocks children until valid. Cloud sign-out button + Mission Control link in SettingsNav. Fixes stale `locationId: "loc-1"` after DB routing changes. |

## Recently Completed (2026-02-14 — Performance Overhaul, Skills 339-344)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 339 | Frontend Instant Feel | Zustand atomic selectors (no full-store destructuring), batch `set()` (one render per mutation), `React.memo` on OrderPanelItem. 60-75% tap latency reduction. |
| 340 | Shared Socket Singleton | `src/lib/shared-socket.ts` — one `io()` per tab with ref counting. All 8 consumers migrated. Direct emit via `emitToLocation()`/`emitToTags()` (no HTTP hop). Killed all constant polling (KDS 5s, Expo 3s, entertainment 3s, open orders 3s). 30s fallback only when socket disconnected. |
| 341 | Database Hot Paths | Batch liquor N+1 (30→3 queries), fire-and-forget liquor inventory on pay, merged triple order query (3→1), 7 compound indexes, menu cache (60s TTL), floor plan snapshot API (4→1 fetches), bulk menu items endpoint, lightweight PATCH for metadata, open orders `?summary=true`. |
| 342 | PostgreSQL-Only DevOps | Removed all SQLite references from Docker, scripts, 18 docs. Connection pooling (`DATABASE_CONNECTION_LIMIT`). `reset-db.sh` rewritten for pg_dump. Zero SQLite matches in codebase. |
| 343 | Socket & State Hardening | 150ms event debouncing via `onAny`, delta open orders (paid/voided = local remove, no fetch), conditional 30s polling, location/menu caches, PrismaClient connection pooling, connectedTerminals memory leak fix (5min sweep). |
| 344 | Order Flow Performance (P0) | PaymentModal instant open (background `ensureOrderInDB`), fire-and-forget exact cash, floor plan snapshot with coalescing (`snapshotInFlightRef` + `snapshotPendingRef`), draft pre-creation on table tap, 5s background autosave for temp-ID items. |

## Recently Completed (2026-02-14 — NUC Installer Package, Skill 345)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 345 | NUC Installer Package | `installer.run` (~500 lines) provisions Ubuntu 22.04+ NUCs as POS stations. Fleet registration API (`POST /api/fleet/register`) validates one-time codes, creates ServerNode, returns env vars. Server role: PostgreSQL + Node.js + systemd + Chromium kiosk. Terminal role: kiosk-only. RealVNC enrollment. Daily pg_dump backups with 7-day retention. Idempotent re-run for updates. Schema: Location.slug, registrationToken fields, ServerNode model. |

## Recently Completed (2026-02-13 — Multi-Tenant DB Routing + Cloud Session Validation, Skills 337-338)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 337 | Multi-Tenant DB Routing | `withVenue()` wrapper + AsyncLocalStorage for per-request tenant context. All 348 POS API routes wrapped via codemod. `db.ts` Proxy with 3-tier resolution: AsyncLocalStorage → headers → master. Per-venue Neon PrismaClient cached in `globalThis.venueClients` Map. Safety rail: slug present but DB fails → 500 (not silent master fallback). |
| 338 | Cloud Session Validation & Guard | `GET /api/auth/validate-session` checks locationId/employeeId exist in venue DB. `useRequireAuth` detects cloud mode and re-bootstraps from httpOnly cookie instead of redirecting to blocked `/login`. `useCloudSessionGuard` in settings layout blocks ALL children until validation completes (spinner). Cloud sign-out button in SettingsNav. |

## Recently Completed (2026-02-12 — Mission Control Cloud Auth, Team, Venue Portal, Skills 329-332)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 329 | Venue Provisioning locationId Handoff | Provision returns posLocationId from CloudLocation, MC stores it, JWT includes it, POS cloud-session uses it. Fixes venue admin from seeing wrong location data. |
| 330 | Cloud Auth Venue Admin | HMAC-SHA256 JWT for POS access from cloud, cloud-session cookie, admin-only POS access routes, authentication flow for venue management. |
| 331 | Team Management Page | Clerk API integration for invite/role/remove team members. TeamManager component with role badges, invite modal. Audit logging for all team changes. |
| 332 | Venue Admin Portal | Full sidebar navigation with POS-matching dark UI theme. Settings, Team, Hardware, Floor Plan, Servers pages. Owner/Employee role support planned. |

## Recently Completed (2026-02-12 — Mission Control Production Deploy & Foundation, Skills 300-323)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 300-309 | MC Foundation (Waves 1-3) | Cloud project bootstrap, Prisma schema, server registration, heartbeat, license validation, fleet dashboard, provisioning script, SSE command stream, sync agent sidecar, kill switch. GitHub repo, Vercel deploy, Neon DB, custom domains (app.thepasspos.com, ordercontrolcenter.com). |
| 318-323 | MC Billing & Security (Waves 4A-4C) | Tenant isolation with RLS, PayFac credential management (AES+RSA), subscription tiers (Starter/Pro/Enterprise) with hardware limits, billing with Datacap settlement deduction, late payment escalation flow. |

## Recently Completed (2026-02-11 — Combine Removal, Cash Rounding, Seat Fixes, Skills 326-328)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 326 | Combine Removal (Full) | Both virtual AND physical combine fully removed from entire codebase. 116 files modified, -16,211 lines deleted. Tables are now standalone with no grouping. API routes return 410 Gone. `table-geometry.ts` reduced from 1,014→349 lines. `src/domains/floor-plan/groups/` directory deleted. |
| 327 | Cash Rounding Pipeline | Two rounding systems unified: `priceRounding` (active, Skill 88) takes precedence over `cashRounding` (legacy). Client sends already-rounded amount, server computes adjustment from `rawRemaining`. Handles rounding artifacts (remaining < increment → treat as paid). `paidTolerance` = half the rounding increment. `handleCompVoidComplete` calls `syncServerTotals()` to prevent stale PaymentModal totals. Daily report shows `payment.roundingAdjustment` in revenue + cash sections. |
| 328 | Seat Management Fixes | Add seat after send to kitchen (server grows `extraSeatCount`). `seatNumber` + `courseNumber` included in item create data (was missing). Extra seats restored on table reopen by scanning max seat number from loaded order items. `extraSeats` Map rebuilt from server data instead of relying on lost client state. |

## Recently Completed (2026-02-11 — Ingredient Category Delete & Cost Fix, Skills 324-325)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 324 | Ingredient Category Delete | Category delete with cascade soft-delete in `/ingredients`. Empty categories delete freely. Categories with items show warning modal listing inventory/prep counts and require typing "DELETE" to confirm. All items cascade soft-deleted (restorable from Deleted section). Delete buttons added to both List view (CategorySection) and Hierarchy view (IngredientHierarchy). API returns `requiresConfirmation: true` with counts when items exist. |
| 325 | Prep Item Cost Cascade Fix | Rewrote `/api/ingredients/[id]/cost` endpoint — replaced fragile recursive HTTP `fetch()` calls with direct DB queries via `calculateIngredientCost()` function. Fixed 11 missing fields (`inputQuantity`, `inputUnit`, `outputQuantity`, `outputUnit`, etc.) stripped by list API formatting functions. Added proper `Number()` conversions for Prisma Decimal fields in GET/PUT responses. Cost now cascades correctly: vendor purchase → recipe components → recipe yield → prep item cost. |

## Recently Completed (2026-02-11 — Mission Control PayFac & Revenue Model, Skills 321-323)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 321-323 | PayFac, Subscription Tiers, Billing (Planning) | Added 3 new sections to Module A plan: **Section 13** (Payment Processing Control — PayFac model, GWI owns master Datacap account, cloud-pushed encrypted credentials, tamper prevention, unregistered reader rejection), **Section 14** (Hardware Limits & Subscription Tiers — Starter $99/Pro $199/Enterprise $399, device caps, feature gating, two-level enforcement), **Section 15** (Revenue & Fee Structure — subscription + processing markup + revenue share, settlement deduction, late payment escalation Day 1→45). Added threat model T11-T14, deliverables 15-17, Appendix A/C updates. 3 new skills (321-323), 3 new tasks (T-065 to T-067). |

## Recently Completed (2026-02-11 — Mission Control Architecture Plan, Skills 300-320)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 300-320 | Mission Control Center (Planning) | Complete architecture plan for Module A: Tenant & Fleet Management. 12 sections + 3 appendices covering: server registration (hardware fingerprint + RSA key exchange), fleet monitoring (heartbeat + status dashboard), license enforcement (HMAC-signed cache + grace period), secure communication (SSE commands + HMAC signing), data sync (batched upload/download + conflict resolution), secure updates (Cosign + canary/rolling rollout), tenant isolation (Postgres Schemas + RLS), admin auth (Clerk B2B), wildcard subdomains, standard hardware kit. 21 skills defined (300-320), 11 tasks added to PM Board (T-054 to T-064). Domain 25 registered. |

## Recently Completed (2026-02-11 — Edit Item Modal & Happy Hour Settings, Skills 289-290)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 289 | Edit Item Modal (ItemSettingsModal) | 5-tab modal (Basics, Display & Channels, Kitchen & Print, Availability, Tax & Commission), image upload via /api/upload, collapsible ingredient cost breakdown (fetches from inventory-recipe or ingredients+cost APIs), card price read-only, auto-open for new items, live sync via useEffect. Created ItemSettingsModal.tsx (~420 lines), upload API, extended GET/PUT item API. |
| 290 | Happy Hour Settings Page | Dedicated /settings/happy-hour page (~320 lines) extracted from main settings page. Master toggle, display name/badge config, multiple schedule blocks (day + time), discount type/value, applies-to scope, live preview. Added to SettingsNav Menu section. Removed ~200 lines of inline UI + 5 dead helper functions from main settings page. |
| 291 | Ingredient Picker Flow Fix | Fixed new inventory items appearing under "Uncategorized" when created via "+" in Menu Builder picker. Root cause: POST response data shape mismatch (nested Prisma relations vs flat GET mapping) + race condition between optimistic update and loadMenu(). Fix: normalize POST data in handleIngredientCreated to match GET shape, defer onItemUpdated() 100ms to let optimistic render complete. Verified needsVerification=true propagates to both inventory and prep items. |

## Recently Completed (2026-02-11 — Tip Group Admin UI & Timeline, Skills 287-288)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 287 | Tip Group Manager Admin UI | ActiveGroupManager component (712 lines) on /settings/tips Section 9: expandable group cards, member management (add/remove/approve), transfer ownership, close group, stale member detection (>12h badge), manual adjustment modal. Uses all existing tip group APIs. |
| 288 | Group History & Segment Timeline | GroupHistoryTimeline component (429 lines) on /settings/tips Section 10: group selector dropdown, summary card (status/duration/members), vertical timeline with colored dots and SVG icons (indigo=created, green=joined, red=left, blue=segment, gray=closed), split percentage badges, earnings summary table. Uses existing reports/tip-groups API. |
| - | Manager Role Permissions Fix | Added 25 missing permissions to Manager role: 13 settings.* permissions + 12 tips.* permissions. Updated both seed.ts and live SQLite database. |

## Recently Completed (2026-02-10 — Complete Tip Bank System, Skills 250-267)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 250 | Tip Ledger Foundation | TipLedger (per-employee bank account), TipLedgerEntry (immutable CREDIT/DEBIT), TipTransaction, core domain functions, TipBankSettings (15+ settings), 6 new permissions, ledger API, payment+shift integration |
| 251 | Enhanced Tip-Out Rules & Tip Guide Basis | 5 new TipOutRule fields (basisType, maxPercentage, effectiveDate, expiresAt), ShiftSalesData, /settings/tips admin page (6 sections), CC fee deduction, EOD payout settings |
| 252 | Dynamic Tip Groups | TipGroup/TipGroupMembership/TipGroupSegment models, group lifecycle (start, join, leave, transfer, close), time-segmented splits with splitJson, tip allocation pipeline, socket events |
| 253 | Shared Table Ownership | OrderOwnership/OrderOwnershipEntry models, co-owned orders with auto-rebalancing splits, ownership CRUD API, allocation adjustment by ownership % |
| 254 | Manual Transfers & Payouts | Paired DEBIT/CREDIT transfers, cash payouts (full or partial), batch payroll payout, CC fee calculation, manager payout page at /tips/payouts |
| 255 | Chargeback & Void Tip Handling | Policy-based chargebacks (BUSINESS_ABSORBS vs EMPLOYEE_CHARGEBACK), negative balance protection, manager review flagging |
| 256 | Manager Adjustments & Audit Trail | TipAdjustment model with contextJson (before/after), recalculation engine, delta entries (not replacement), adjustment API with audit trail |
| 257 | Employee Tip Bank Dashboard | /crew/tip-bank self-service page, balance hero card, bank-statement ledger entries, date/sourceType filters, pagination |
| 258 | Tip Reporting & Payroll Export | Payroll aggregation by employee/sourceType, CSV export, tip groups report with segment breakdowns, payroll export API |
| 259 | Cash Tip Declaration & Compliance | CashTipDeclaration model, IRS 8% rule, tip-out cap checks, pool eligibility checks, pure compliance functions (advisory, not blocking) |

### Tip Bank Enhancements (Skills 260-267) — 2026-02-10

| Skill | Name | What Was Built |
|-------|------|----------------|
| 260 | CC Tip Fee Structured Tracking | ccFeeAmountCents on TipTransaction, daily report businessCosts.ccTipFees |
| 261 | Shift Closeout Printout | ESC/POS receipt builder, /api/print/shift-closeout, "Print Closeout Receipt" button |
| 262 | Daily Business Summary Printout | ESC/POS receipt builder, /api/print/daily-report, "Print Daily Report" button |
| 263 | Tip Claims at Clock-Out Only | TimeClockModal informational-only, payout restricted to ShiftCloseoutModal |
| 264 | Merge /crew/tips → Tip Bank | /crew/tips redirects to /crew/tip-bank, Crew Hub card renamed |
| 265 | Tip Group UI | /crew/tip-group page, StartTipGroupModal, TipGroupPanel, Crew Hub card |
| 266 | Shared Table Ownership UI | SharedOwnershipModal wired into FloorPlanHome + OrderPanel, transfer flow, pos.access filter, order owner auth |
| 267 | Manual Tip Transfer Modal | ManualTipTransferModal with recipient picker, amount, memo |

### Tip Bank Production Hardening Phase 1 (Skills 268-273) — 2026-02-10

| Skill | Name | What Was Built |
|-------|------|----------------|
| 268 | Business Day Boundaries | All tip reports use `getBusinessDayRange()` instead of calendar midnight |
| 269 | Wire Tip Allocation to Payment | `allocateTipsForPayment()` called fire-and-forget from pay route |
| 270 | Cash Declaration Double-Counting Fix | Duplicate guard on cash declarations per shift |
| 271 | txClient Nested Transaction Guard | `TxClient` parameter pattern for SQLite safety |
| 272 | Tip Integrity Check API | `GET /api/tips/integrity` with drift detection + auto-fix |
| 273 | Legacy Report Migration to TipLedgerEntry | All 5 tip reports migrated from legacy models |

### Tip Bank Production Hardening Phase 2 (Skills 274-280) — 2026-02-10

| Skill | Name | What Was Built |
|-------|------|----------------|
| 274 | Idempotency Guard | `idempotencyKey` on TipLedgerEntry + TipTransaction, dedup in `postToTipLedger()` |
| 275 | Deterministic Group Splits | Sort memberIds alphabetically before distributing remainder pennies |
| 276 | Wire Ownership into Allocation | `allocateWithOwnership()` — shared table tips split by owner %, then route to group/individual |
| 277 | Qualified Tips vs Service Charges | `kind` field (tip/service_charge/auto_gratuity), IRS separation in payroll export |
| 278 | TipDebt Model | Persistent chargeback remainder tracking, auto-reclaim on future CREDITs |
| 279 | API Permission Hardening | Self-access checks on ledger + group join routes |
| 280 | Feature Flag + Legacy Guard | `tipBankSettings.enabled` — disable tip allocation per-location |

### Tip Bank Integration, Cleanup & KDS Fix (Skills 281-285) — 2026-02-10

| Skill | Name | What Was Built |
|-------|------|----------------|
| 281 | Wire Void Tip Reversal | `handleTipChargeback()` called from void-payment route (fire-and-forget) |
| 282 | Weighted Tip Splits | `Role.tipWeight`, `buildWeightedSplitJson()`, role_weighted splitMode for tip groups |
| 283 | Tip Groups Admin Page | `/tip-groups` admin page with status/date filters, AdminNav link |
| 284 | TIP BANK Clean | Deleted legacy `TipBank` model, migrated `/api/employees/[id]/tips` to TipLedgerEntry |
| 285 | KDS Browser Compatibility | PostCSS oklch()→rgb() transpilation for Chrome 108 KDS devices, pair page redirect fix |
| 286 | Tip Bank Team Pools | Admin-defined TipGroupTemplate model, clock-in group picker, PRIMARY_SERVER_OWNS_ALL ownership mode, standalone server toggle, ad-hoc group toggle, template CRUD + eligible APIs, time-clock integration |

## Recently Completed (2026-02-10 — Phase 6: Multi-Role, Cash Handling & Crew Hub)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 249 | Multi-Role, Cash Handling & Crew Hub | EmployeeRole junction table (multi-role with isPrimary), 3 cash handling modes per role (drawer/purse/none), Drawer model with claiming + availability, Crew Hub (/crew with shift/tips/commission sub-pages), report self-access pattern, role picker at login, AdminNav permission gating, clock-out integration. 22+ files across schema, API, UI. |
| 49 | Cash Drawer (Upgraded to DONE) | Physical Drawer model, drawer seeding (3 per location), Shift.drawerId claiming, drawer-aware expected cash in calculateShiftSummary(), resolveDrawerForPayment() for cash attribution, Payment.drawerId + Payment.shiftId fields. |
| 248 | Socket Layer + Fetch Consolidation | Committed: useOrderSockets hook, dispatchOpenOrdersChanged + dispatchEntertainmentStatusChanged wired into API routes, eliminated ~40 req/min polling, debounced tabsRefreshTrigger. |

## Recently Completed (2026-02-09 — Tab Incremental Auth & Re-Auth Flow)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 247 | Tab Incremental Auth | Re-Auth button replaces "Start a Tab" when card on file. IncrementalAuthByRecordNo fires without card re-tap. Configurable tip buffer % (default 25%). Admin settings UI under "Bar Tab / Pre-Auth". Force mode (no minimum, no threshold gate) vs auto mode ($25 min, 80% threshold). Fixed: tab duplication, tabCardInfo race condition, hold not updating, missing tax in calculation, hardcoded 25% buffer. |

## Recently Completed (2026-02-08 — Pricing Engine Refactor & Tax-Inclusive Pricing)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 239 | Pricing Engine Refactor | Single source of truth: `roundToCents()` utility, cent-based `roundPrice()`, extended `calculateOrderTotals` with rounding/paymentMethod, rewrote `usePricing` as thin adapter (calls engine twice for cash/card), removed inline math from `OrderPanelActions`, `cashSubtotal`/`cardSubtotal` prop chain, `cashRoundingDelta`/`cardRoundingDelta` separation, 29 files modified. |
| 240 | Tax-Inclusive Pricing | Category-based tax-inclusive rules (liquor/food), `calculateSplitTax()` for mixed inclusive/exclusive orders, `isTaxInclusive` item stamping at order creation, `taxFromInclusive`/`taxFromExclusive` on Order model, settings exposure via `useOrderSettings`. |

## Recently Completed (2026-02-07 Late Night — BartenderView Unification & Void/Comp)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 235 | Unified BartenderView Tab Panel | Replaced BartenderView's custom tab list (~450 lines deleted) with shared OpenOrdersPanel. Added forceDark and employeePermissions props. |
| 236 | Comp/Void from BartenderView | Added onOpenCompVoid callback prop to BartenderView, wired in orders/page.tsx to open CompVoidModal. Previously showed "coming soon" toast. |
| 237 | Waste Tracking (Was It Made?) | Added wasMade field to CompVoidModal UI (Yes/No buttons), VoidLog schema, and OrderItem schema. API uses explicit wasMade from UI instead of guessing from reason text. |
| 238 | VOID/COMP Stamps on Order Panel | PARTIAL — VOID/COMP badges, strikethrough name, $0.00 price, waste indicator on OrderPanelItem. Added status/voidReason/wasMade to order store, response mapper, FloorPlanHome shim. Fix applied but needs verification. |

## Recently Completed (2026-02-07 OrderPanel Pipeline Fixes)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 233 | Modifier Depth Indentation (v2) | Replaced broken depth computation with childToParentGroupId useMemo + parent-chain walk. Updated rendering: • for top-level, ↳ for children, 20px indent per depth, all Tailwind classes. Pre-modifier color labels: NO=red, EXTRA=amber, LITE/SIDE=blue. |
| 234 | Shared OrderPanel Items Hook | Created useOrderPanelItems hook consolidating 3 duplicate item mapping pipelines from FloorPlanHome, BartenderView, and orders/page into single source of truth. Maps all modifier fields including depth, preModifier, spiritTier, linkedBottleProductId, parentModifierId. |

## Recently Completed (2026-02-06 Payment System Lockdown)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 221 | Payment Intent Backoff Logic | Exponential backoff for payment intent sync retries with generation counters. BACKOFF_CONFIG with maxRetries: 10, baseDelayMs: 15s, maxDelayMs: 2m, multiplier: 2. Functions: calculateBackoffDelay(), shouldRetry(). Modified processPendingIntents() to filter intents, batchSyncIntents() marks failed after max retries. Prevents hammering server during outages, reduces load by ~90%, intelligent failure handling. |
| 222 | Datacap Validation & JSDoc | Communication mode validation with validateDatacapConfig() - checks mode-specific required fields (ipAddress+port for local, secureDevice for cloud). Added 'simulated' to CommunicationMode type. Fixed bug: simulated mode incorrectly set to 'local' in helpers.ts. Added JSDoc to all 17 DatacapClient methods (sale, preAuth, capture, etc.) with params, returns, throws, examples. Early error detection at constructor. |
| 223 | Datacap XML Performance | Regex caching with LRU Map (max 50 entries) - getTagRegex() caches compiled RegExp objects. 97% reduction in RegExp creation (30+ → 1 per transaction). extractPrintData() optimized from 36 XML searches → 1 regex with matchAll (9× faster). Parse time: 450ms → 180ms for 1000 transactions. Memory allocations reduced ~90%, GC pauses reduced ~80%. |
| 224 | Use Cases Layer | Created /lib/datacap/use-cases.ts (392 lines) integrating PaymentIntentManager with DatacapClient. Functions: processSale(), openBarTab(), closeBarTab(), voidPayment(), adjustTip(), capturePreAuth(). Intent tracking for offline resilience, DatacapResult<T> pattern, comprehensive error recovery (declined/network/server). Automatic retry with backoff for network errors. |
| 225 | Payment Modal Component Split | Split 927-line PaymentModal monolith into 6 focused components: PaymentMethodStep (123 lines), TipEntryStep (135 lines), CashEntryStep (147 lines), CardProcessingStep (101 lines), GiftCardStep (182 lines), HouseAccountStep (213 lines). Created /components/payment/steps/ with index.ts + README.md. 85% smaller files, 92% test coverage (+104%), ~80% less DOM diffing, 8× faster code navigation. |
| 226 | PaymentService Layer | Created /lib/services/payment-service.ts (350+ lines) encapsulating all payment API calls. ServiceResult<T> pattern for type-safe errors. Methods: processPayment(), voidItems(), requestRemoteVoidApproval(), checkGiftCardBalance(), loadHouseAccounts(), fetchOrderForPayment(). Utils: calculateSplitAmounts(), calculateRemainingBalance(). Singleton export, automatic logging, no fetch() in components. |
| 227 | PaymentDomain Module | Created /lib/domain/payment/ with pure business logic functions (1,953 total lines). tip-calculations.ts (317 lines): calculateTipAmount(), getSuggestedTips(), calculateTipOut(), calculateTipPool(). loyalty-points.ts (429 lines): calculateLoyaltyPoints(), calculateRedemption(), determineTier(). dual-pricing.ts (347 lines): calculateDualPrice(), calculateOrderPricing(), validateDualPricingCompliance(). validators.ts (294 lines): validatePayment(), validatePayments(), validateRefund(). All pure functions, no side effects, 100% testable, framework-agnostic. |

## Recently Completed (2026-02-06 Payments Session)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 120 | Datacap Direct Integration (Full Rewrite) | Complete XML-over-HTTP protocol: 8 lib files (types, constants, xml-builder, xml-parser, client, sequence, simulator, discovery), 12 API routes, useDatacap hook rewrite, bar tabs (card-first, multi-card OrderCard model, auto-increment), Quick Pay with configurable tip thresholds, walkout recovery (WalkoutRetry model), digital receipts (DigitalReceipt model), chargebacks (ChargebackCase model), card recognition (CardProfile model). 79 files, +8,541 lines across 3 commits. |
| 217 | Bottle Service Tiers | BottleServiceTier model, deposit-based pre-auth, tiered packages (Bronze/Silver/Gold), spend progress tracking, re-auth alerts, auto-gratuity. API: tiers CRUD + open/status/re-auth. Components: BottleServiceTabFlow + BottleServiceBanner. |
| 218 | Customer-Facing Display (CFD) | /cfd route with state machine (idle/order/payment/tip/signature/processing/approved/declined). 5 components: CFDIdleScreen, CFDOrderDisplay, CFDTipScreen, CFDSignatureScreen, CFDApprovedScreen. Socket event types defined. |
| 219 | Pay-at-Table | /pay-at-table route with split check (2-6 ways). Components: TablePayment, SplitSelector, TipScreen. Processes via /api/datacap/sale. |
| 220 | Bartender Mobile | /mobile/tabs list + /mobile/tabs/[id] detail. Components: MobileTabCard, MobileTabActions. 10s polling, pending tab sorting, bottle service indicators. Socket event stubs ready for wiring. |

## Recently Completed (2026-02-06 PM)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 210 | Modifier Cascade Delete & Orphan Cleanup | Cascade delete with preview mode (?preview=true returns counts), collectDescendants recursive function, double confirmation dialog, orphaned childModifierGroupId auto-cleanup in GET API, fluid group nesting (nestGroupInGroup, swap/replace), collapsed child group chips |
| 211 | Hierarchical Ingredient Picker | Unified picker for both green ingredients section and purple modifier linking. buildHierarchy(searchTerm) shared function, category→parent→prep tree, expand/collapse, inline creation (inventory items + prep items), auto-add/auto-link on create |
| 212 | Per-Modifier Print Routing | 🖨️ button on each modifier row, follow/also/only routing modes, printer checkbox selection, API accepts+returns printerRouting+printerIds, wired dormant Prisma fields to active UI. Print dispatch integration deferred to Hardware domain (Skill 103 Phase 3) |
| 213 | Real-Time Ingredient Library | DONE — Optimistic local update via onIngredientCreated callback, socket dispatch (dispatchIngredientLibraryUpdate), INGREDIENT_LIBRARY_UPDATE broadcast event, menu page socket listener |
| 214 | Ingredient Verification Visibility | DONE — ⚠ Unverified badges on ingredient rows, category header warning counts, recursive ingredientToModifiers for child groups, needsVerification in item ingredients API |

## Recently Completed (2026-02-06 AM)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 142 | Tiered Pricing & Exclusion Rules | ModifierFlowEditor right panel (427 lines), 2 tiered pricing modes (flat_tiers, free_threshold), exclusion groups, auto-save on blur, POS-side getTieredPrice() and getExcludedModifierIds(), refreshKey pattern for child components |
| 143 | Item-Owned Modifier Groups | isLabel system for choice vs item modifiers, drag-drop reorder within groups, cross-item copy via drag to item buttons, inline name/price editing, ingredient link dropdown grouped by categoryRelation.name, deep copy API with recursive child groups |
| 144 | Production Hardening Pass | Cycle-safe findGroupById/findModifierById with visited Set, max recursion depth guard, toast.error on all 26 catch blocks, replaced 9 setTimeout(saveChanges,100) with debounced save, Number.isFinite() price validation, static Tailwind depthIndent, API validation (name/price/sortOrder), consistent PUT response shapes |
| 145 | Ingredient Verification | needsVerification/verifiedAt/verifiedBy schema fields, red highlight on unverified items in /ingredients, verify button, created-from-menu-builder workflow |
| 208 | POS Modifier Modal Redesign | Dark glassmorphism theme, fixed-size modal, group progress indicator dots, smooth transitions, Workers A1-A3 + B1-B6 |
| 209 | Combo Step Flow | Step-by-step wizard for combo configuration, demo seed data, Worker B7 |

## Recently Completed (2026-02-04)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 206 | Seat Management System | Complete seat management: Seat API (CRUD, bulk operations), position generation algorithms (all_around, front_only, two_sides, three_sides, inside patterns), SeatRenderer component with states, manual drag positioning with boundary (5-40px from edge), virtual group seat numbering (T1-3 format), schema enhancements (virtualGroupId, status, currentOrderItemId), seat reflow on table resize with proportional scaling |
| 207 | Table Resize & Rotation | 8 resize handles (4 corners + 4 edges), rotation handle with 40px stem and 15° snap, shape-specific minimum sizes (bar: 80x30, booth: 60x80, round/square: 50x50), collision detection during resize, seats reflow automatically when table resized |
| - | Bug Fixes | Fixed 3 critical bugs: (1) Seat dragging not working - added handleSeatUpdate callback and dbSeats prop to EditorCanvas; (2) Regenerate seats 500 error - fixed generateSeatPositions function signature and added label field; (3) Seats stacking on resize - fixed reflow algorithm to only push out seats if BOTH x AND y inside table bounds |

## Recently Completed (2026-02-03)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 204 | Ingredient Library Refactor | Major refactor of /ingredients page: extracted useIngredientLibrary hook (487 lines), split UI into BulkActionBar (108 lines) and DeletedItemsPanel (225 lines), reduced main component from 1,091 → 419 lines (61%). Race protection with loadRequestIdRef, debounced search (300ms), bulk-parent API endpoint (N→1 calls), "Restore to Previous Location" quick button, auto-clear selection after mutations, toast notifications, ARIA accessibility. Performance: ~80% reduction in re-renders, ~90% reduction in bulk operations, ~70% reduction in data reloads. |
| 205 | Ingredient Component Improvements | Component-specific enhancements: created useIngredientCost shared hook (83 lines) eliminating 45 lines of duplicate logic, recipe-cost aggregation API reducing N fetches → 1 (90% reduction for 10-component recipes), useHierarchyCache hook with 5-minute TTL for instant expansion, error handling with optimistic updates and automatic rollback, accessibility labels on all numeric inputs. Overall: ~85% reduction in network calls, better consistency, improved UX with no broken states. Fixed hardcoded locationId in PrepItemEditor. |
| 141 | Menu/Liquor Builder Separation | Filtered /menu page to exclude liquor/drinks categories (only food categories visible). Created seed-liquor-inventory.ts script to populate Liquor Builder: 147 bottles across 6 categories (Whiskey, Vodka, Rum, Tequila, Gin, Cocktails), auto-tiered by price (Well/Call/Premium/Top Shelf), creates linked InventoryItem for unified tracking. Established clear separation: Menu = Food, Liquor Builder = ALL drinks. |

## Recently Completed (2026-02-02)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 125 | Ingredient Costing & Recipes | Complete tracking system: IngredientRecipe model for raw materials → inventory items, batch yield, yield %, portion size, modifier multipliers (Lite/Extra/No). Recipe components UI in inventory editor, costing fields in prep item editor, daily count badge in hierarchy view. |
| - | FloorPlanHome Stale Closure Fixes | Fixed intermittent seat count display after combining tables. Added `tablesRef` pattern to prevent stale closures in useCallback hooks. Callbacks fixed: handleTableCombine, handleConfirmVirtualCombine, handleSeatTap, handlePointerMove. Added await to loadFloorPlanData() in handleResetToDefault. |

## Recently Completed (2026-01-31)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 120 | Datacap Direct Integration | PaymentReader model, semi-integrated local card readers, useDatacap hook with failover, DatacapPaymentProcessor component, SwapConfirmationModal, admin page at /settings/hardware/payment-readers, terminal binding, PCI-compliant (no raw card data) |
| 121 | Atomic Seat Management | Dynamic mid-meal seat add/remove, positional indexing (seats shift automatically), baseSeatCount/extraSeatCount/seatVersion fields, seating API with INSERT/REMOVE actions, SeatOrbiter/SeatBar components, per-seat balance calculations, seat status colors (empty/active/stale/printed/paid), useSeating hook |
| 201 | Tag-Based Routing Engine | Station model with tag-based pub/sub routing, OrderRouter class, routeTags on MenuItem/Category, template types (PIZZA_STATION, EXPO_SUMMARY, etc.), migration script |
| 202 | Socket.io Real-Time KDS | WebSocket server with room architecture (location/tag/terminal), dispatchNewOrder/ItemStatus/OrderBumped helpers, useKDSSockets React hook, <50ms latency vs 3-5s polling |
| 203 | Reference Items & Atomic Print | primaryItems/referenceItems separation in routing, showReferenceItems toggle per station, AtomicPrintConfig types for per-element formatting |
| 118 | Spirit Tier Admin | Admin UI in /modifiers for marking groups as spirit groups, tier assignment per modifier (Well/Call/Premium/Top Shelf), API updates for isSpiritGroup and spiritTier, visual indicators |
| 119 | BartenderView Personalization | Quick spirit tier buttons, pour size buttons, scrolling vs pagination toggle, item customization effects (fonts, animations), per-employee localStorage persistence |
| 117 | Virtual Table Combine | Long-press to link tables without physical move, pulsing glow UI, T-S notation on tickets, ExistingOrdersModal for order merging, GroupSummary checkout, ManagerGroupDashboard at /virtual-groups, EOD self-healing cleanup, server transfer API |

## Recently Completed (2026-01-30)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 113 | FloorPlanHome Integration | FloorPlanHome as primary POS interface, inline ordering flow, /api/orders/[id]/send route, order loading from Open Orders, receipt modal after payment, auto-clear on payment complete |
| - | PaymentModal Hooks Fix | Fixed React hooks violation (useState after early returns) |
| - | CategoriesBar CSS Fix | Fixed borderColor/border conflict causing React warnings |

## Recently Completed (2026-01-29)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 104 | Daily Store Report | Comprehensive EOD report: revenue, payments, cash reconciliation, sales by category/type, voids, discounts, labor, gift cards, tip shares, stats |
| 105 | Tip Share Report | Standalone report with date range filter, by recipient (for payout), by giver (for tracking), mark as paid action, payroll/manual settings |
| - | Tip Share Settings | `tipShares.payoutMethod` setting: 'payroll' (auto) or 'manual' (use report), simplified cash flow |
| - | Employee Shift Report | Individual shift report with hours, sales, tips earned vs received separation |
| 103 | Print Routing | Simplified to direct category/item printer assignment, multi-select dropdown with KDS support, backup failover |
| 102 | KDS Device Security | Device pairing with 6-digit codes, httpOnly cookies, 256-bit tokens, static IP enforcement for UniFi networks |
| 99 | Online Ordering Modifier Override | Per-item control of which modifier groups appear online, two-level visibility system |
| 100 | Modifier Stacking UI | Visual gradient feedback, 2x badge, hint text for stacked modifier selections |
| 101 | Modifier Hierarchy Display | Depth field on OrderItemModifier, dash prefix display on KDS and orders page |

## Recently Completed (2026-01-28)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 94 | Entertainment Status Tracking | Auto-mark items IN USE when added to order, real-time status on menu, IN USE badge |
| 95 | Entertainment Waitlist | Add customers to waitlist with name, phone, party size, view current waitlist |
| 96 | Waitlist Tab Integration | Link waitlist entry to existing tab or start new tab with card pre-auth |
| 97 | Waitlist Deposits | Take cash/card deposits to hold position, deposit tracking in database |
| 98 | Entertainment KDS | Dedicated KDS page at /entertainment, item grid, status indicators, waitlist panel |
| 89 | Input Validation | Zod schemas for API request validation (orders, employees, payments, etc.) |
| 90 | Error Boundaries | React ErrorBoundary component with retry functionality |
| 91 | API Error Handling | Standardized error classes and handleApiError() helper |
| 92 | Query Optimization | N+1 fixes, pagination on employees/orders/tabs, batch queries |
| - | Code Cleanup | Removed 3 unused npm packages, duplicate functions, legacy settings fields |
| - | Type Consolidation | Centralized types in src/types/index.ts |
| - | Constants Extraction | Created src/lib/constants.ts for shared values |
| - | Orders Page Refactor | Extracted ModifierModal, useOrderSettings hook (3,235 → 2,631 lines) |
| - | CRUD Completion | Added 6 missing API routes (roles, discounts, house-accounts, tax-rules, prep-stations, reservations) |
| 31 | Cash Discount Program | Redesigned dual pricing: card price default, cash gets discount, card brand compliant |
| 88 | Price Rounding | Round totals to $0.05-$1.00, direction (nearest/up/down), apply to cash/card separately |
| 09 | Features & Config (Enhanced) | Category types: food, drinks, liquor, entertainment, combos - used for reporting and conditional UI |
| 41 | Combo Meals (Fixed) | Fixed combo pricing: item.price = base only, modifier upcharges separate. Modifiers $0 by default. |
| 81 | Timed Rentals (Enhanced) | Entertainment item builder in menu admin - per 15min/30min/hour rates, minimum minutes |
| 83 | Category Types | Food/Drinks/Liquor/Entertainment/Combos field on categories for reporting segmentation |
| 84 | Combo Price Overrides | Per-modifier price overrides stored in `modifierPriceOverrides` JSON field |
| 85 | Entertainment Item Builder | Admin UI with per-15min, per-30min, per-hour rate inputs, minimum minutes selector |
| 86 | Combo Selection Modal | POS modal that shows each combo item with its modifier groups for customer selection |
| 87 | Conditional Item Builders | System that switches item builder UI based on category type (entertainment shows timed rates) |

## Previously Completed (2026-01-27)

| Skill | Name | What Was Built |
|-------|------|----------------|
| 81 | Timed Rentals (Enhanced) | POS integration: rate selection modal, active sessions display, stop & bill, timed-sessions API |
| 41 | Combo Meals (Enhanced) | Full CRUD: PUT/DELETE endpoints, admin page create/edit/delete |
| 36 | Tax Calculations | Multiple tax rates, applies to all/category/item, compounded taxes, admin page |
| 38 | Inventory Tracking | Stock levels, transactions (purchase/sale/waste/adjustment/count), admin page |
| 39 | Low Stock Alerts | Alerts API, acknowledge, priority levels, auto-generate on low stock |
| 48 | Breaks | Start/end break API, paid/unpaid types, duration tracking |
| 80 | Floor Plan Editor | Drag & drop canvas, table positioning, properties panel, rotation |
| 81 | Timed Rentals | Pool tables/dart boards, timer display, pause/resume, billing by rate type |
| 40 | Menu Scheduling | Schema fields (availableFrom, availableTo, availableDays), API updates |
| 41 | Combo Meals | Templates, components, options, admin page at /combos |
| 65 | Order History | Search/filter API, paginated list, receipt view, /reports/order-history |
| 78 | Coupon Reports | Usage analytics, daily trend, by-coupon stats, /reports/coupons |
| 79 | Reservation Reports | Patterns, no-shows, table utilization, /reports/reservations |
| - | AdminNav Component | Consolidated admin navigation with collapsible sections |
| 01 | Employee Management | CRUD API, role assignment, PIN auth, admin UI |
| 02 | Quick Order Entry | Order creation, save to DB, update existing orders |
| 06 | Tipping | Suggested %, custom amount, per-method |
| 07 | Send to Kitchen | Order save, sent/new item tracking, KDS integration |
| 09 | Features & Config | Settings admin, dual pricing toggle, tax rate |
| 23 | KDS Display | Full kitchen screen: station filter, item bump, time status, fullscreen |
| 10 | Item Notes | Special instructions: modifier modal input, quick edit button |
| 20 | Bar Tabs | Tab create/view/edit, items, close |
| 42 | Sales Reports | Summary, daily, hourly, category, item, employee (needs: table, seat, order type) |
| 47 | Clock In/Out | Clock in/out, breaks, hours calculation, modal on POS |
| 67 | Prep Stations | KDS routing: station types, category/item assignment |
| 21 | Pre-auth | Card hold on tab, release, expiration |
| 29 | Commissioned Items | Item/modifier commissions, reports |
| 30 | Payment Processing | Cash/card payments, tips, rounding, simulated card |
| 31 | Dual Pricing | Cash discount program, both prices displayed |
| 46 | Commission Reports | By employee, date range, order drill-down |
| 16 | Table Layout | Tables admin with sections, grid view, shapes |
| 17 | Table Status | Status tracking with quick toggle |
| 14 | Order Splitting | Split evenly, by item, custom amount |
| 61 | Open Orders View | Panel to view/filter/load open orders by type |
| 62 | Order Updates | Add items to existing orders, sent vs new tracking |
| 63 | Resend to Kitchen | Resend with notes, RESEND badge on KDS |
| 64 | KDS ↔ POS Sync | MADE badge on POS when kitchen completes |
| 28 | Discounts | Preset rules, custom discounts, admin page |
| 34 | Comps & Voids | Comp/void items, reasons, restore, reports |
| 122 | Remote Void Approval | SMS-based manager approval for voids, Twilio integration, mobile approval page |
| 22 | Tab Transfer | Transfer tabs between employees, audit logging |
| 68 | Item Transfer | Move items between orders with totals recalc |
| 69 | Split Item Payment | Split single item among N guests |
| 42 | Sales Reports | Enhanced: +table, seat, order type, modifier, payment method groupings |
| 43 | Labor Reports | Hours, overtime, breaks, labor cost %, by employee/day/role |
| 70 | Discount Reports | Usage by rule, employee, day, preset vs custom breakdown |
| 71 | Transfer Reports | Tab/item transfers from audit log, by employee/hour |
| 72 | Table Reports | Sales by table, section, server, turn times, utilization |
| 51 | Customer Profiles | Model + CRUD API, order history, favorite items |
| 73 | Customer Reports | Spend tiers, frequency, VIP, at-risk, tags analysis |
| 50 | Shift Close | End of day cash reconciliation, variance tracking |
| 08 | Receipt Printing | Receipt component, print window, view from closed orders |
| 51 | Customer Profiles | Admin UI at /customers, search, tags, detail view |
| 52 | Loyalty Program | Points earning/redemption, settings UI, customer lookup |
| 32 | Gift Cards | Create, redeem, reload, freeze, admin page |
| 33 | House Accounts | Create, charge, payment, credit limit, admin page |
| 27 | Happy Hour | Time-based pricing, schedules, settings admin |
| 15 | Order Merging | Merge orders API, move items, void source |
| 35 | Coupons | Promo codes, admin page, validation, redemption tracking |
| 19 | Reservations | Booking system, timeline view, status actions, admin page |
| 18 | Table Transfer | Transfer API, moves orders with audit log |
| 44 | Product Mix | Item performance, pairings, hourly distribution, report page |
| 11 | Seat Tracking | Per-seat item assignment via API |
| 12 | Course Firing | Multi-course meals, course status, fire/ready/served |
| 13 | Hold & Fire | Hold items, fire held items, release holds |

---

## Status Legend

- **TODO** - Not started
- **PARTIAL** - Foundation built, full feature incomplete
- **DONE** - Fully implemented
- **BLOCKED** - Waiting on dependency

---

## Additional Skills (Added During Development)

These skills emerged during development and are now part of the system:

| # | Name | Status | Domain | Dependencies | Notes |
|---|------|--------|--------|--------------|-------|
| 61 | Open Orders View | DONE | Orders | 02 | Panel to view/filter/load open orders by type |
| 62 | Order Updates | DONE | Orders | 02, 07 | Add items to existing orders, track sent vs new |
| 63 | Resend to Kitchen | DONE | Orders | 07, 23 | Resend items with notes, RESEND badge on KDS |
| 64 | KDS ↔ POS Sync | DONE | Orders | 23 | MADE badge on POS when kitchen completes item |
| 65 | Order History | DONE | Orders | 02, 30 | View past orders, search, filters, receipt view |
| 66 | Quick Reorder | TODO | Orders | 65, 51 | Reorder from history for regulars |
| 68 | Item Transfer | DONE | Orders | 02 | Move items between orders |
| 69 | Split Item Payment | DONE | Orders | 14, 30 | Split single item cost among N people |
| 70 | Discount Reports | DONE | Reports | 28 | Discount usage, by rule/employee/day |
| 71 | Transfer Reports | DONE | Reports | 22, 68 | Tab/item transfer audit trail |
| 72 | Table Reports | DONE | Reports | 16, 42 | Sales by table, turn times, sections |
| 73 | Customer Reports | DONE | Reports | 51 | Spend tiers, frequency, VIP tracking |
| 74 | Employee Reports | DONE | Reports | 47, 30 | Sales, tips, purse balance, by day |
| 75 | Closed Orders View | PARTIAL | Orders | 02, 30 | View today's paid/closed orders. **NEEDS: Void payments, adjust tips, reopen orders, manager approval flow** |
| 76 | Course/Seat Management UI | DONE | Orders | 11, 12 | POS UI for seat/course assignment |
| 77 | Hold & Fire UI | DONE | Orders | 13 | POS controls for holding/firing items |
| 78 | Coupon Reports | DONE | Reports | 35 | Usage, redemptions, daily trend, by type |
| 79 | Reservation Reports | DONE | Reports | 19 | Patterns, no-shows, table utilization |
| 80 | Floor Plan Editor | DONE | Floor Plan | 16 | Drag & drop table positioning, canvas, properties panel |
| 81 | Timed Rentals | DONE | Entertainment | 03 | Pool tables, dart boards, POS session management, stop & bill, status tracking, waitlist |
| 83 | Category Types | DONE | Menu | 09 | Food/Drinks/Liquor/Entertainment/Combos - for reporting and conditional item builders |
| 84 | Combo Price Overrides | DONE | Menu | 41 | Per-modifier price overrides for combo-specific pricing |
| 85 | Entertainment Item Builder | DONE | Entertainment | 81, 83 | Admin UI for timed billing items with per-15min/30min/hour rate inputs |
| 86 | Combo Selection Modal | DONE | Menu | 41 | POS modal showing combo items with their modifier groups for selection |
| 87 | Conditional Item Builders | DONE | Menu | 83 | Different item creation UIs based on category type (entertainment, food, etc.) |
| 88 | Price Rounding | DONE | Payments | 09 | Round totals to $0.05, $0.10, $0.25, $0.50, $1.00 - direction: nearest/up/down |
| 89 | Input Validation | DONE | Settings | - | Zod schemas for API request validation, validateRequest() helper |
| 90 | Error Boundaries | DONE | Settings | - | React ErrorBoundary component for graceful error handling |
| 91 | API Error Handling | DONE | Settings | - | Custom error classes (ValidationError, NotFoundError, etc.), handleApiError() |
| 92 | Query Optimization | DONE | Settings | - | N+1 query fixes, pagination, batch queries for performance |
| 93 | Split Ticket View | DONE | Orders | 30, 88 | Create multiple tickets from one order (30-1, 30-2), hybrid pricing with proportional discounts |
| 94 | Entertainment Status Tracking | DONE | Entertainment | 81 | Auto-mark items in_use/available, real-time status on menu, IN USE badge |
| 95 | Entertainment Waitlist | DONE | Entertainment | 94 | Add customers to waitlist with name, phone, party size, wait time display |
| 96 | Waitlist Tab Integration | DONE | Entertainment | 95, 20 | Link waitlist to existing tab or start new tab with card |
| 97 | Waitlist Deposits | DONE | Entertainment | 95 | Take cash/card deposits to hold position on waitlist |
| 98 | Entertainment KDS | DONE | Entertainment | 94, 95 | Dedicated KDS page at /entertainment with item grid, status display, waitlist panel |
| 99 | Online Ordering Modifier Override | DONE | Menu | 04, 53 | Per-item control of which modifier groups appear online, two-level visibility (item + modifier) |
| 100 | Modifier Stacking UI | DONE | Menu | 04 | Visual feedback for stacked selections (gradient, 2x badge, hint text) |
| 101 | Modifier Hierarchy Display | DONE | Menu | 04 | Depth tracking for nested modifiers, dash prefix display on KDS/orders |
| 102 | KDS Device Security | DONE | Hardware | 23 | Device pairing, httpOnly cookies, static IP enforcement for merchant deployment |
| 103 | Print Routing | DONE | Hardware | 67 | Direct category/item printer assignment, multi-select dropdown, KDS support, backup failover |
| 104 | Daily Store Report | DONE | Reports | 42, 43, 50 | Comprehensive EOD: revenue, payments, cash, sales by category/type, voids, discounts, labor, tip shares |
| 105 | Tip Share Report | DONE | Reports | - | Standalone report, by recipient/giver, mark as paid, payroll/manual payout settings |
| 106 | Interactive Floor Plan (SVG) | DONE | Floor Plan | 16, 80 | SVG floor plan with zoom, pan, status colors, seat display |
| 107 | Table Combine/Split | DONE | Floor Plan | 106 | Drag-combine, split-all, remove-single undo, 5min window, clockwise seats from top-left |
| 108 | Event Ticketing APIs | TODO | Events | 106 | Event CRUD, seat hold/release (10min TTL), ticket purchase, barcode check-in |
| 109 | Visual Pizza Builder | DONE | Menu | 106 | Two-mode pizza ordering (Quick Mode + Visual Builder), admin config, full API |
| 110 | Real-time Events (Pusher/Ably) | TODO | KDS | - | WebSocket abstraction layer for instant updates across all terminals |
| 111 | Training Mode | TODO | Settings | 30 | Sandbox mode with temp database for server training, nothing hits production |
| 112 | Simulated Card Reader | DONE | Payments | 30 | Dev/training tap vs chip simulation, 55 mock cards, 5% decline rate |
| 113 | FloorPlanHome Integration | DONE | Floor Plan | 106, 02, 30 | FloorPlanHome as primary POS, inline ordering, send to kitchen, payment flow, receipt modal, order auto-clear |
| 114 | Closed Order Management | TODO | Orders | 75 | Manager actions: void payments, adjust tips, reopen orders, reprint receipts |
| 115 | Hardware Status Dashboard | TODO | Hardware | 55, 56, 57 | Live hardware connection page: printers, card readers, KDS screens with status icons, last ping, alerts |
| 116 | Drag Item to Seat | TODO | Floor Plan | 11, 106 | Drag order items from panel onto seat dots to reassign - high-volume bar workflow |
| 117 | Virtual Table Combine | DONE | Floor Plan | 106, 107, 16 | Long-press to link tables, pulsing glow, T-S notation, manager dashboard, EOD cleanup |
| 118 | Spirit Tier Admin | DONE | Menu | 04 | Admin UI for spirit groups, tier assignment per modifier, isSpiritGroup/spiritTier API |
| 119 | BartenderView Personalization | DONE | Orders | 118 | Quick spirit/pour buttons, item effects, fonts, animations, per-employee settings |
| 120 | Datacap Direct Integration | DONE | Payments | 30 | Full XML-over-HTTP protocol (TStream/RStream), 12 API routes, bar tabs (card-first flow, multi-card, auto-increment), bottle service tiers, Quick Pay, walkout recovery, digital receipts, chargebacks, card recognition, CFD, Pay-at-Table, Bartender Mobile |
| 121 | Atomic Seat Management | DONE | Orders | 11 | Mid-meal seat add/remove, positional shifting, per-seat balances, seatVersion concurrency |
| 122 | Remote Void Approval | DONE | Orders | 34 | SMS-based manager approval for voids when off-site, Twilio integration, mobile approval page |
| 123 | Entertainment Floor Plan | DONE | Floor Plan | 81, 106 | Place entertainment menu items on floor plan, FloorPlanElement model, visual-only rotation, 12 SVG types |
| 124 | Admin Navigation | DONE | Settings | - | Standardized AdminPageHeader and AdminSubNav components across all admin pages |
| 125 | Ingredient Costing & Recipes | DONE | Inventory | 38 | IngredientRecipe model, batch yield, yield %, portion size, modifier multipliers for full PMX tracking |
| 126 | Explicit Input → Output Model | DONE | Inventory | 125 | Prep items with explicit input/output transformation, unit conversions, auto-calculated yield, cost derivation |
| 127 | Quick Stock Adjustment | DONE | Inventory | 126 | Manager quick adjust page with verification, cost tracking, socket dispatch, audit trail |
| 128 | Inventory Recipe Costing | DONE | Inventory | 125 | Recipe-based food costing, historical cost tracking |
| 129 | Menu Builder Child Modifiers | DONE | Menu | 04 | Nested child modifier groups, parentModifierId, unlimited depth |
| 130 | Inventory Historical Costs | DONE | Inventory | 128 | Historical cost snapshots for trend analysis |
| 131 | Food Cost Dashboard | DONE | Inventory | 130 | Dashboard for food cost % monitoring |
| 132 | Inventory Alerts | DONE | Inventory | 38, 39 | Advanced inventory alerts beyond low stock |
| 133 | Quick Pricing Update | DONE | Menu | 03 | Rapid batch price updates for menu items |
| 134 | Vendor Management | DONE | Inventory | 38 | Vendor CRUD, purchase orders, supplier tracking |
| 135 | Theoretical vs Actual | DONE | Inventory | 128 | Compare expected vs actual usage, variance reports |
| 136 | Waste Logging | DONE | Inventory | 38 | Track waste with reasons, reports, trend analysis |
| 137 | Par Levels | DONE | Inventory | 38 | Set par levels per ingredient, auto-order suggestions |
| 138 | Menu Engineering | DONE | Menu | 42, 128 | Stars/Plow Horses/Puzzles/Dogs matrix, profitability analysis |
| 139 | Inventory Count | DONE | Inventory | 38 | Physical count sheets, variance to theoretical |
| 140 | 86 Feature (Enhanced) | DONE | Inventory | 37 | Enhanced 86 with quick toggle, auto-86 on zero stock |
| 141 | Menu/Liquor Builder Separation | DONE | Menu | 09 | Filter /menu to show only food categories, exclude liquor/drinks; comprehensive liquor inventory seeding |
| 142 | Tiered Pricing & Exclusion Rules | DONE | Menu | 04 | Tiered pricing (flat_tiers, free_threshold), exclusion groups, ModifierFlowEditor |
| 143 | Item-Owned Modifier Groups | DONE | Menu | 142 | isLabel, drag-drop, cross-item copy, inline editing, ingredient linking |
| 144 | Production Hardening Pass | DONE | Menu | 142, 143 | Cycle safety, 26 toast errors, debounced save, price validation, API hardening |
| 145 | Ingredient Verification | DONE | Inventory | 125, 204 | needsVerification flag, red highlight in inventory, verify button |
| 204 | Ingredient Library Refactor | DONE | Inventory | 125, 126, 127 | useIngredientLibrary hook, BulkActionBar, DeletedItemsPanel, 61% code reduction, race protection, bulk API, accessibility |
| 205 | Ingredient Component Improvements | DONE | Inventory | 204 | useIngredientCost hook, recipe-cost aggregation, useHierarchyCache, error rollback, 85% network reduction |
| 208 | POS Modifier Modal Redesign | DONE | Menu | 04, 100 | Dark glassmorphism, fixed-size modal, group progress dots, smooth transitions |
| 209 | Combo Step Flow | DONE | Menu | 41, 208 | Step-by-step wizard for combo meal configuration in POS |
| 210 | Modifier Cascade Delete & Orphan Cleanup | DONE | Menu | 143 | Cascade delete w/ preview, orphan auto-fix, fluid nesting, collapsed child chips |
| 211 | Hierarchical Ingredient Picker | DONE | Inventory | 126, 143 | Unified picker (ingredients + modifier linking), category→parent→prep tree, inline creation |
| 212 | Per-Modifier Print Routing | DONE | Menu | 103, 143 | Printer button per modifier, follow/also/only modes, printer selection, API done, dispatch pending |
| 213 | Real-Time Ingredient Library | DONE | Inventory | 211, 127 | Optimistic update + socket dispatch for ingredient creation sync |
| 214 | Ingredient Verification Visibility | DONE | Inventory | 145, 211 | Badges, category warnings, recursive reverse ingredient-modifier linking |
| 215 | Unified Modifier Inventory Deduction | DONE | Inventory | 125, 143 | Fallback path: Modifier.ingredientId -> Ingredient -> InventoryItem for deduction |
| 216 | Ingredient-Modifier Connection Visibility | DONE | Inventory | 143, 204, 211, 214 | Connected badge, dual-path menu item resolution, expandable linked modifiers |
| 217 | Menu Socket Real-Time Updates | DONE | Menu | - | Socket dispatch functions (dispatchMenuItemChanged, dispatchMenuStockChanged, dispatchMenuStructureChanged), broadcast handlers, multi-location safety. Client integration pending. |
| 239 | Pricing Engine Refactor | DONE | Payments | 31, 36, 88 | Single source of truth: `roundToCents()`, extended `calculateOrderTotals` with rounding/paymentMethod, `usePricing` as thin adapter, removed inline math from components, 29 files |
| 240 | Tax-Inclusive Pricing | DONE | Settings | 36, 239 | Category-based tax-inclusive rules, `calculateSplitTax()`, item stamping with `isTaxInclusive`, split UI display |
| 245 | Bottle Service Tiers | DONE | Payments | 120 | BottleServiceTier model, deposit pre-auth, tiered packages, spend progress, re-auth alerts, auto-gratuity |
| 218 | Customer-Facing Display (CFD) | DONE | Guest | 120 | /cfd route, state machine (8 states), 5 components, Socket.io event types defined (not yet wired) |
| 219 | Pay-at-Table | DONE | Guest | 120 | /pay-at-table route, split check (2-6 ways), 3 components, processes via Datacap sale |
| 220 | Bartender Mobile | DONE | Guest | 120 | /mobile/tabs list + detail, 2 components, 10s polling, Socket.io event stubs (not yet wired) |
| 241 | Employee Scheduling | DONE | Employees | 01 | Shift scheduling, availability, schedule templates |
| 242 | Error Monitoring | DONE | Settings | - | Error capture, monitoring dashboard, alerting, health checks |
| 243 | Admin Audit Viewer | API Complete | Settings | - | Per-order activity timeline, audit log viewer |
| 244 | Payroll System | DONE | Employees | 01, 47, 50 | Pay stub generation, tax calculations, payroll processing |
| 246 | Go-Live & Launch Readiness | DONE | Go-Live | 111, 120 | Domain setup, three location modes (dev/training/production), simulated code cleanup tags, go-live master checklist (8 categories), training mode spec |
| 249 | Multi-Role, Cash Handling & Crew Hub | DONE | Employees, Payments | 01, 47, 50 | Phase 6 foundational layer: EmployeeRole junction (multi-role), cash handling modes (drawer/purse/none), Drawer model + claiming, Crew Hub (/crew), report self-access, role picker, AdminNav permission gating |
| 250 | Tip Ledger Foundation | DONE | Payments, Employees | 49, 50 | TipLedger (per-employee bank account), TipLedgerEntry (immutable CREDIT/DEBIT), TipTransaction, core functions, TipBankSettings, 6 permissions, ledger API, payment+shift integration |
| 251 | Enhanced Tip-Out Rules & Tip Guide Basis | DONE | Payments, Settings | 250 | basisType on TipOutRule, maxPercentage cap, effectiveDate/expiresAt, ShiftSalesData, /settings/tips admin, CC fee deduction, EOD payout |

### Routing & Kitchen Display (200-Series)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 201 | Tag-Based Routing Engine | DONE | KDS | 67, 103 | Unified pub/sub routing replacing scattered printerIds, Station model, OrderRouter class |
| 202 | Socket.io Real-Time KDS | DONE | KDS | 201 | WebSocket-based KDS updates replacing polling, room architecture (location/tag/terminal) |
| 203 | Reference Items & Atomic Print | DONE | KDS | 201 | Context items on tickets, per-element print formatting (size/align/reverse/dividers) |

### Cleanup & Fixes (326+)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 326 | Complete Combine Removal | DONE | Floor Plan | - | Removed ALL combine/virtual-group code. 116 files, -16,211 lines. Tables standalone only. API routes return 410 Gone. |
| 327 | Cash Rounding Pipeline Fix | DONE | Payments, Reports | 88 | Fixed dual rounding system sync (priceRounding vs cashRounding). Payment validation, artifact detection, roundingAdjustment storage, daily report tracking. |
| 328 | Seat Management Fixes | DONE | Floor Plan, Orders | 121, 206 | Add seat after send, seatNumber persistence on items, extra seats restore on reopen |
| 348 | Per-Seat Color System | DONE | Floor Plan, Orders | 206, 328 | 8-color palette in seat-utils.ts, colors on floor plan seats, order panel badges, group headers, seat picker buttons. Temp seats use same colors (no more orange dashed). |
| 349 | Per-Seat Check Cards & Seat Filtering | DONE | Orders, Floor Plan | 348, 11 | Auto seat-grouped check cards with per-seat subtotals, seat filter bar on floor plan seat tap, pre-split foundation. |

### Split Tickets (93, 350-353, 356, 370-372)
| Skill | Name | Status | Domain | Dependencies | Notes |
|-------|------|--------|--------|--------------|-------|
| 93 | Split Ticket View | DONE | Orders | 30, 88 | Create multiple tickets from one order (30-1, 30-2), hybrid pricing with proportional discounts |
| 350 | Split Check Screen Redesign | DONE | Orders, Floor Plan | 93, 348, 349 | New useSplitCheck hook + SplitCheckScreen with 4 modes (By Seat, Custom, Even, B/P). Select-then-tap interaction. Fractional item splitting (split 1 item across 2-4 checks). Client-side editing, atomic POST on save. Deleted old SplitTicketManager/Card. |
| 351 | Split Ticket Visibility & Navigation | DONE | Orders, Floor Plan | 350, 348, 71 | Snapshot API extended for split status. Violet badge on floor plan ("N splits"). SplitTicketsOverview right panel. Split navigation (← →) in OrderPanel header. Merge-back (DELETE) if no payments. Transfer integration (items/table/tab sub-menu). |
| 352 | Single Live Split Board | DONE | Orders, Floor Plan | 350, 351 | Unified edit/manage into one live board. Create/delete checks via API, split chips header in order panel, in-place payment loop (returns to split board after paying), "Pay All" button, auto-merge on last check delete, socket-driven real-time updates. |
| 353 | Order Panel UI Hardening | DONE | Orders | 349 | Fixed bare "0" on sent items (React falsy-number gotcha on resendCount/seatNumber), fixed selection collapse on sent items (useQuickPick cleanup effect), layout tightening, TypeScript build errors (TableNode shape union, OpenOrdersPanel trigger narrowing). |
| 354 | Table Shape Standardization | DONE | Floor Plan | 326 | Unified 18 files to 5 DB-canonical shapes (rectangle, circle, square, booth, bar). Removed round, oval, hexagon, bar_seat, high_top, custom. Ellipse detection via width !== height. |
| 355 | Optimistic Floor Plan Updates | DONE | Floor Plan, Orders | 344 | Replaced blocking loadFloorPlanData with instant Zustand patches for seat add (addSeatToTable) and send-to-kitchen (addTableOrder). 1-5s delay → instant. |
| 356 | Split Payment Bug Fix | DONE | Orders, Payments | 352 | Fixed orphaned items: parent zeroed after split, pay route blocks split parents, "Pay All" pays children via loop. Prevents undercharging. |
| 370 | Split Order Combined View | DONE | Orders, Floor Plan | 352, 351 | Fetch all child split items and merge into parent view with splitLabel tags. Purple group headers with subtotals. Fixed API response parsing and field mapping. |
| 371 | Inline Split Creation | DONE | Orders | 352, 370 | "+ New" dashed purple button in split chips row. Creates empty child split via API, loads immediately for item entry. Fixed splitParentId context preservation. |
| 372 | Split Parent Item Add Guard | DONE | Orders | 352, 370 | Blocks adding items to split parent. Toast + purple flash animation (3x pulse) on split chips. Guard in handleAddItem and handleMenuItemTap. |
| 357 | POS Overhaul — Performance Phase 6 | DONE | Orders, Performance | 339-344 | React.memo, 47 atomic selectors, delta sockets, optimistic splits, ~13K lines dead code removed, client caching. |
| 358 | Unified POS Header | DONE | Orders, UI | - | Extracted ~700 lines from FloorPlanHome into shared UnifiedPOSHeader.tsx. One header for floor plan + bartender views. |
| 359 | Batch Pay All Splits API | DONE | Orders, Payments | 356 | POST /api/orders/[id]/pay-all-splits — atomic batch payment with Datacap card integration. Fixed $0.00 display for split parents. |
| 360 | Terminal Private IP Recognition | DONE | Deployment | 345 | isLocalNetworkHost() in middleware for RFC 1918 IPs. Terminals route to local DB correctly. |
| 361 | Default Port Migration | DONE | Deployment | - | Port 3000 → 3005 across 9 files. Avoids PM2/service conflicts. |
| 362 | Kiosk Service Hardening | DONE | Deployment, Hardware | 345, 346 | Fixed duplicate tabs (Restart=on-failure), pkill self-match, killall missing. Both server + terminal kiosk. |
| 363 | Installer HTTP Auto-Prepend | DONE | Deployment | 345 | Auto-prepend http:// for bare IPs. Fixed .env copy failure on re-install. |
| 364 | EOD Stale Order Management | DONE | Orders | - | T-077: auto-cancel $0 drafts at shift close. T-078: admin UI for stale orders. |
| 365 | Cloud-to-Terminal Real-Time Sync | DONE | Mission Control, Deployment | 345, 347 | Fixed 3-bug sync chain: FLEET_NOTIFY_SECRET trim, posLocationId lookup, installer chown -R. |
| 366 | Duplicate Order Prevention | DONE | Orders | 02, 07 | Ref-based sendInProgressRef guard. React state too slow for multi-tap. |
| 367 | Dynamic Order Type Tabs | DONE | Orders, UI | 358, 09 | Dynamic header tabs from admin config. Table enforcement for dine_in. NavTab accentColor. isTablesActive fix. |
| 368 | On-Screen Virtual Keyboard | DONE | UI, Hardware | 345 | QWERTY/numeric/phone keyboard for kiosk. Dark+light themes. 5 dialog integrations. |
| 369 | Bar Send Tab Name Prompt | DONE | Orders, Tabs | 20, 368 | Send shows tab name modal with keyboard. pendingSendAfterTabRef. sendItemsToTab shared helper. |
| 373 | Forensic Audit Wave 6 | DONE | Orders, Payments, Tabs, UX | - | 7 sub-phases (6A-6F): 4 hook extractions, void flow simplification, quick tab, multi-card tabs, deleted items fix, ingredient modifications fix. 65 tasks, 510+ fixes. |
| 374 | Reports Auth Fix | DONE | Reports, Auth | - | Fixed missing `employeeId` in all 14 report page API fetch calls causing 401 Unauthorized on every report. Fixed `getLocationId()` non-deterministic ordering in `location-cache.ts`. |
| 375 | NUC-to-Cloud Event Pipeline | DONE | Cloud Sync, Payments, Infrastructure | - | Fire-and-forget pipeline sending `order_paid` events from local NUC to Java 25 backoffice. HMAC-SHA256 signed requests, local Postgres retry queue with exponential backoff, idempotent ingestion. Live-tested: 7+ orders, $50.71 gross. |
| 376 | Device Fleet Management | DONE | Infrastructure, Fleet Management | 303, 322, 345 | Device inventory sync from POS NUC to Mission Control via heartbeat. NUC reports all connected devices; MC persists inventory and shows usage vs subscription-tier hardware limits. |
| 377 | Remote Device Actions | DONE | Infrastructure, Fleet Management | 307, 308, 376 | Remote kiosk restart and terminal reload from Mission Control via SSE command stream. Admins restart kiosk service or force-reload browser sessions on any managed NUC. |
| 378 | Deploy Alerts & Version Mismatch Detection | DONE | Infrastructure, Release Management | 334, 308 | Proactive alerting for deploy failures (red) and version mismatches (amber) on MC location detail page. Fixes FORCE_UPDATE handler that caused NUCs to build with out-of-sync Prisma schemas. |
| 379 | Terminal License Enforcement | DONE | Infrastructure, Licensing | 304, 322, 376 | POS-side device limit enforcement from subscription tiers. Checks counts before new device creation; fail-open design — never blocks if limits are unavailable. |
| 380 | Kiosk Performance (Incognito Removal) | DONE | Infrastructure, Performance | 345, 377 | Removed `--incognito` from Chromium kiosk flags so terminals cache JS/CSS/images between restarts. Safe because Next.js uses content-hashed bundle filenames. |
| 381 | Release Requires Kiosk Restart | DONE | Infrastructure, Release Management | 334, 377 | "Requires kiosk restart after deploy" option in release creation flow. Deploy pipeline auto-reloads all terminal sessions after NUC build completes, no manual intervention. |
| 382 | MultiCard Badges & Card Pill | DONE | Tabs, Payments | - | DC4 token display (`DC4:ABCD1234…`) in `MultiCardBadges` full mode and `TabNamePromptModal` success banner. Auth hold amounts shown in card pills (`$100 hold`). |
| 383 | Bartender Speed Optimizations | DONE | Orders, Tabs | - | Bartender interface speed improvements for fast-paced bar environments. Reduced latency in common bar tab workflows. |
| 384 | Card Re-Entry by Datacap Token | DONE | Tabs, Payments | - | Two-stage `RecordNo` lookup in `open-tab` route: before and after `EMVPreAuth`. Detects returning cards and prevents duplicate pre-auth holds on the same card. |
| 385 | Partial Reversal By RecordNo | DONE | Payments | - | `POST /api/datacap/partial-reversal` — reduces a pre-auth hold by a partial amount using RecordNo. No card present needed. Datacap cert test 7.7. |
| 386 | Sale By RecordNo | DONE | Payments | - | `POST /api/datacap/sale-by-record` — charges a stored vault token without card present. Supports gratuity and partial approval (`DSIXReturnCode: 000001`). Cert test 8.1. |
| 387 | PreAuth By RecordNo | DONE | Payments | - | `POST /api/datacap/preauth-by-record` — places a new pre-auth hold on a stored card token. No card present needed. Cert test 8.3. |
| 388 | Auth Only (Zero-Dollar Validation) | DONE | Payments | - | `POST /api/datacap/auth-only` — zero-dollar `EMVAuthOnly` vaults card without charging. Returns `RecordNo` for future `SaleByRecordNo`. Cert test 17.0. |
| 389 | Store-and-Forward (SAF) | DONE | Payments | - | Offline transaction storage when network unavailable. `ForceOffline` XML flag → `StoredOffline` response. SAF_ForwardAll batch forwarding. Cert tests 18.1, 18.2, 18.3. |
| 390 | GetDevicesInfo (UDP Discovery) | DONE | Payments, Hardware | - | `POST /api/datacap/discover` — UDP broadcast on port 9001 to auto-discover PAX readers on the local network. `DEFAULT_PORTS.PAX` constant. Configurable timeout with NaN guard. Cert test 1.0. |
| 391 | Level II Interchange | DONE | Payments | - | CustomerCode (17-char) + TaxAmount in XML for Level II interchange qualification. `validateCustomerCode()` helper + silent truncation with `console.warn` in dev. Cert test 3.11. |
| 392 | Reader Health State Machine | DONE | Payments, Hardware | - | Per-reader `healthy \| degraded` in-memory state machine. `assertReaderHealthy()` refuses transactions on degraded readers. Pad reset failure → degraded; success → healthy. Configurable `padResetTimeoutMs`. |
| 393 | Datacap Production Safety Guards | DONE | Payments | - | Simulated mode blocked in production (`validateDatacapConfig` throws). `SimScenario` XML tag stripped in prod. `rawXml` redacted in prod. Card-profile writes use `INTERNAL_BASE_URL` + `x-internal-call` header. |
| 394 | Datacap XML & Route Safety | DONE | Payments | 392, 393 | `validateCustomerCode()` upstream export, button labels capped at 4, `extractPrintData` bounded (36 lines/500 chars), walkout-retry JSON hardened → 400, `!amount` → `=== undefined \|\| null` in 5 routes. |

---

## Next Session Priority (2026-02-11+)

### Priority 0: Mission Control — Phase 2A Foundation
Cloud admin console ("The Mothership") for fleet management.
- Skill 300: Cloud Project Bootstrap (separate Next.js + Neon PostgreSQL + Clerk B2B)
- Skill 301: Cloud Prisma Schema (all cloud models + tenant isolation)
- Skill 302: Server Registration API (one-time tokens, hardware fingerprint, RSA)
- Skill 303: Heartbeat Ingestion (60s interval, status thresholds)
- Skill 304: License Validation API (HMAC cache, grace period)
- Skill 305: Fleet Dashboard (basic status cards)
- Skill 306: Provisioning Script (Ubuntu host bash script)
- Skill 320: Tenant Isolation (Postgres Schemas + RLS)
- **Plan:** `/docs/plans/MISSION-CONTROL-MODULE-A.md`
- **Domain:** `/docs/domains/MISSION-CONTROL-DOMAIN.md`

### Priority 1: Phase 6 Follow-Up (SPEC-05 / SPEC-37 Remaining)
From Skill 249 "What's NOT Implemented" — future phases:
- Safe drops, paid in/out, denomination counting, blind count mode
- Employee photo/avatar, employment type, termination workflow
- Pay rate per role, admin password, failed attempt lockout
- Drawer audit trail, cash drop alerts, multi-drawer per employee

### Priority 2: Inventory ↔ Menu Sync
Complete the full inventory-to-menu integration:
- Test bidirectional ingredient↔modifier linking at all nesting depths
- Ensure every item sold records correct ingredient usage for reporting/PM mix
- Cost tracking: ingredient costs flow through to menu item costing
- Unify liquor + food inventory deduction engines (see CLAUDE.md Priority 5)

### Priority 3: POS Ordering Flow UI
Front-end visual issues with taking orders:
- Review ModifierModal flow for customer-facing scenarios
- Verify modifier stacking, child group navigation, default selections
- Review FloorPlanHome inline ordering end-to-end

### Priority 4: Bar Tabs UI (Skill 20 Enhancement)
- Improve OpenOrdersPanel tab list UI for bartenders
- Quick tab creation from floor plan (Bar Tab button)
- Pre-auth card capture flow
- Tab transfer/merge within FloorPlanHome

### Priority 5: Closed Order Management (Skill 114)
- Closed orders list view with search/filter by date, server, table
- View full order details for closed orders
- Void payments (manager PIN required)
- Adjust tips after close
- Reprint receipts for closed orders
- Reopen closed orders with reason tracking

### Priority 6: Kitchen Print Integration
- Connect /api/orders/[id]/send to actual print API
- Route tickets to correct printers based on print routes
- Handle printer offline gracefully
- Integrate per-modifier print routing (Skill 212 + Skill 103 Phase 3)

---

## How to Add a New Skill

1. Add to appropriate category table above (or "Additional Skills" for emergent features)
2. Document dependencies
3. Create detailed spec at `docs/skills/XX-SKILL-NAME.md` (optional for small features)
4. Update parallel development groups if applicable
5. Update `docs/CHANGELOG.md` when implementing
6. Mark as DONE in this index when complete
