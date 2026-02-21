# PM Cross-Domain Task Board

> **MANDATORY:** Every PM must review this board at session start and update it at EOD.
> This is the single source of truth for cross-domain work handoffs.
> Tasks stay here until the assigned PM picks them up and moves them to their domain changelog.

## How This Works

1. **Any PM** can add tasks to this board during EOD — even tasks outside their domain
2. **Morning startup**: PM reads this board BEFORE asking "What tasks are we working on today?"
3. **Task ownership**: Each task is assigned to the PM domain best suited to handle it
4. **No overlap**: If a task touches files in another domain, it goes on THEIR board — not yours
5. **Pickup protocol**: When a PM picks up a task, they move it to "In Progress" with their session date
6. **Completion**: When done, move to "Completed" with date. Remove after 7 days.

## Task Format

```
| ID | Task | Assigned To | Created By | Date | Priority | Notes |
```

- **ID**: `T-XXX` sequential
- **Assigned To**: Domain PM who should do the work (e.g., `PM: Inventory`, `PM: Menu`, `PM: Orders`)
- **Created By**: Domain PM who identified the task (e.g., `PM: Inventory`)
- **Priority**: `P0` (blocker), `P1` (high), `P2` (medium), `P3` (low)

---

## Backlog (Not Started)

| ID | Task | Assigned To | Created By | Date | Priority | Notes |
|----|------|-------------|------------|------|----------|-------|
| T-003 | Modifier-level variance drill-down in AvT reports — show which modifiers contributed to variance | PM: Reports | PM: Inventory | 2026-02-06 | P3 | DEFER: needs schema change (InventoryItemTransaction.modifierId), theoretical-usage refactor, new UI. 3-4 days. Build after inventory engine stabilizes. |
| T-005 | Modifier recipe support — allow modifiers to have multi-ingredient recipes (not just single ingredient link) | PM: Menu | PM: Inventory | 2026-02-06 | P3 | R365 "concatenation" model. Big feature. |
| T-006 | Pour size integration with ingredient deduction path — apply pour size multiplier to Path B deductions | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Currently pour sizes only affect pricing, not ingredient qty |
| T-007 | Conditional deduction rules — time-of-day or menu-context-based ingredient quantities | PM: Inventory | PM: Inventory | 2026-02-06 | P3 | e.g., happy hour smaller portions |
| T-008 | End-to-end inventory deduction test — place order with Ranch modifier on live POS, pay, verify stock decrease | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Critical verification for Skill 215. Test plan in skill doc. |
| T-009 | Test "Extra Ranch" deduction — verify 2x multiplier (3.0 oz instead of 1.5 oz) | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Part of Skill 215 verification |
| T-010 | Test "No Ranch" on item with base Ranch — verify base recipe Ranch NOT deducted | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Part of Skill 215 verification |
| T-011 | Unify Liquor + Food Inventory Engines — migrate liquor cocktail recipes into unified MenuItemRecipe structure | PM: Inventory | PM: Inventory | 2026-02-06 | P3 | DEFERRED post-MVP. Both engines work. Migration: 10-17 days, HIGH risk (500+ bottle InventoryItem backfill, pour-count representation decision, transaction history). Unify when unified COGS reporting becomes a business req. |
| T-024 | CFD terminal pairing — admin pairs CFD device to specific POS terminal. Similar to KDS pairing flow. | PM: Hardware | PM: Payments | 2026-02-06 | P3 | Needed before CFD Socket.io events work in multi-terminal setups. |
| T-026 | Card token persistence verification — Run test transactions with real Datacap hardware to verify processor returns same token for same card on repeat uses. Critical blocker for Skill 228. | PM: Payments | PM: Payments | 2026-02-06 | P1 | Must complete before any Skill 228 work. See docs/skills/228-CARD-TOKEN-LOYALTY.md Phase 1. Contact processor if tokens don't persist. |
| T-027 | Card token loyalty schema — Add Customer and CardProfile models, create migrations, build API routes for customer CRUD and card linking. Skill 228 Phase 2. | PM: Payments | PM: Payments | 2026-02-06 | P2 | Blocked by T-026. Creates /api/customers routes and token lookup endpoints. |
| T-028 | Loyalty enrollment flow — Build first-visit enrollment modal (phone capture), integrate token recognition into PaymentModal, create LinkCardModal for multi-card linking. Skill 228 Phase 3-5. | PM: Payments | PM: Payments | 2026-02-06 | P2 | Blocked by T-027. Components: LoyaltyEnrollmentModal, LinkCardModal, auto-recognition logic. |
| T-029 | Customer management admin UI — Build /customers admin page with list, search, detail view, card management, points history. Skill 228 Phase 6. | PM: Payments | PM: Payments | 2026-02-06 | P3 | Can be built in parallel with T-028. Admin-facing only. |
| T-030 | Advanced loyalty features — Auto-apply tier discounts, predictive ordering ("Your usual?"), birthday rewards, customer analytics dashboard. Skill 228 Phase 7. | PM: Payments | PM: Payments | 2026-02-06 | P3 | Blocked by T-028. Polish and marketing features. |
| T-046 | Verify socket layer end-to-end on Docker (production) — Socket server runs only in Docker. Verify: useOrderSockets connects, open orders update cross-terminal within 1s, entertainment status changes propagate, no double-refresh on order create. | PM: Orders | PM: Orders | 2026-02-09 | P1 | Skill 248. Dev shows timeout (expected). Must verify on Docker with socket server running. |
| T-049 | Verify KDS full flow on Kitchen screen (Chrome 108) — After oklch fix, confirm: pair page renders dark, auth succeeds, main KDS displays tickets, socket updates work, bump works. User said "mostly working" — needs full verification. | PM: KDS | PM: KDS | 2026-02-10 | P1 | KDS device: KA-15PCAPAIO4, Chrome 108, Android 10, 1920x1080. postcss.config.mjs fix applied but not fully verified. |
| T-070 | Password-protect barpos.restaurant via Vercel — Enable Vercel Deployment Protection on POS project to prevent public access to demo POS (login PIN is just 1234) | PM: Mission Control | PM: Mission Control | 2026-02-12 | P2 | One Vercel setting. No code change needed. |
| T-074 | Verify MC release deploy end-to-end — After Vercel deploy of commit d7851af, test deploy button. Expected: "No active server at this location" (no physical server registered). Verify no 500 error. | PM: Mission Control | PM: Mission Control | 2026-02-12 | P1 | Deploy fix committed but not yet verified on live. |
| T-076 | Backup Server Failover Architecture — Enforce 1 primary server per venue in MC, add backup server role (registered but dormant), manual override to promote backup. Terminal/handheld failover via mDNS/Avahi service discovery (replace hardcoded IPs). Offline failover when MC unreachable. PostgreSQL streaming replication between primary↔backup. MC dashboard promote/demote UI. | PM: Mission Control | PM: Mission Control | 2026-02-14 | P2 | Research done: no maxServers in hardware-limits.ts, no primary/backup in ServerNode schema, terminals use hardcoded IP (no discovery), no PG replication. Needs: schema changes (ServerNode.role enum), mDNS for zero-config discovery, PG streaming replication, MC UI for promote/demote, offline failover trigger. |

## In Progress

| ID | Task | Assigned To | Picked Up | Notes |
|----|------|-------------|-----------|-------|

## Completed

| ID | Task | Completed By | Date | Notes |
|----|------|-------------|------|-------|
| T-025 | Mobile device authentication — remove ?employeeId bypass | PM: Employees | 2026-02-20 | Removed searchParams.get('employeeId') bypass from mobile/tabs/page.tsx and mobile/tabs/[id]/page.tsx. checkAuth() now runs unconditionally on mount. Session cookie required. Commit `d1868b3` |
| T-016 | POS front-end ordering UI lift | PM: Menu | 2026-02-20 | Glassmorphism: FloorPlanMenuItem blur/shadow, OrderPanel backdrop-blur + seat headers, CategoriesBar blur+border, ModifierGroupSection required/optional badges, ModifierModal Special Instructions. Commit `ac292bf` |
| T-031 | Remove production console logging from Floor Plan hot paths | PM: Floor Plan | 2026-02-20 | Removed console.error from 5 hot-path handlers → toast.error(). Commit `423febb` |
| T-032 | Replace Math.random() with deterministic table placement | PM: Floor Plan | 2026-02-20 | ALREADY DONE — deterministic grid placement was already in place. Verified. |
| T-033 | Add API failure rollback + user notifications to Floor Plan | PM: Floor Plan | 2026-02-20 | toast.error + optimistic rollback (prevTables snapshot + restore) + response.ok check. Commit `423febb` |
| T-044 | Verify VOID/COMP stamps render on FloorPlanHome | PM: Orders | 2026-02-20 | ALREADY DONE — stamps, voidReason, wasMade all correctly wired end-to-end. Verified. |
| T-047 | Wire dispatchOpenOrdersChanged into void/delete route | PM: Orders | 2026-02-20 | ALREADY DONE — both comp-void and void-tab routes already fire the event. Verified. |
| T-077 | EOD Auto-Close Stale Orders | PM: Orders | 2026-02-20 | eod-cleanup now uses businessDayDate logic; eod/reset emits eod:reset-complete socket event; FloorPlanHome shows dismissable EOD Summary overlay. Commit `87b0a09` |
| T-079 | Handle partial payment approval flow | PM: Payments | 2026-02-20 | Void & Retry now calls onCancel() after void to auto-return to method selection; Payment Progress banner shown when pendingPayments > 0. Commit `ef9eb04` |
| T-080 (Phase 2) | Pricing Program MC Admin UI | PM: Mission Control | 2026-02-20 | PricingProgramCard.tsx (750 lines) in gwi-mission-control. 6-pill model selector, per-model fields, surcharge compliance check. Commit `7c13ecf` |
| T-080 (Phase 3) | Pricing Program POS Checkout UI | PM: Payments | 2026-02-20 | usePricing computes surchargeAmount; PaymentModal shows surcharge line + disclosure before confirm. Commit `9a8c423` |
| T-080 (Phase 5) | Pricing Program Receipts + Print | PM: Hardware | 2026-02-20 | Receipt.tsx surcharge row; print-factory ESC/POS surcharge line; daily+shift closeout surchargeTotal field. Commit `9a8c423` |
| T-021 | Batch close admin UI | PM: Settings | 2026-02-20 | Batch Settlement card in settings/payments: reader selector, Close Batch button, confirmation modal with live summary (batch#, txn count, SAF warning). GET /api/datacap/batch for preview, POST to confirm. Gated by isSuperAdmin. Commit `7fe7fb5` |
| T-022 | Tip adjustment report | PM: Reports | 2026-02-20 | /reports/tip-adjustment: date-range filter, 3 summary cards, per-row inline Datacap gratuity adjust. Disabled for SAF/offline payments. Optimistic state update. Commit `0beee97` |
| T-034 | Add context logging to normalizeCoord + fail-fast in dev | PM: Floor Plan | 2026-02-20 | Added optional context param { tableId, action }. Dev: throw Error on invalid coord. Prod: log context in warn. bulk-update route passes context. Commit `b3442a6` |
| T-036 | Verify soft delete filters in all Floor Plan queries | PM: Floor Plan | 2026-02-20 | All floor-plan/, tables/, seats/ queries compliant. Fixed 2 missing filters in floor-plan-elements POST (menuItem + section findUnique → findFirst with deletedAt: null). Commit `b3442a6` |
| T-023 | Reader health dashboard | PM: Hardware | 2026-02-19 | PaymentReaderLog schema + reader-health.ts lib + GET /api/hardware/readers/health + /settings/hardware/health page. logReaderTransaction() wired into Datacap client.ts withPadReset. Commit `3ff3755` |
| T-048 | KDS device browser version audit | PM: Hardware | 2026-02-19 | Chrome version extracted from UA in kds-screens heartbeat route. deviceInfo passed through in GET response. Chrome version badge on kds-screens admin page. Commit `ea967d9` |
| T-038 | Fix usePOSLayout loadLayout timing | PM: Orders | 2026-02-20 | employeeId guard in useEffect + dependency array. Commit `b91bf0b` |
| T-039 | Add Quick Pick Numbers toggle to gear dropdown | PM: Orders | 2026-02-20 | Added to UnifiedPOSHeader, wired in orders/page.tsx, fixed pre-existing quickBarEnabled bug. Commit `b91bf0b` |
| T-052 | Quick pick bar default to true | PM: Orders | 2026-02-20 | Already defaulted to true. Verified. Commit `b91bf0b` |
| T-053 | Auth store persistence + hydration guards | PM: Orders | 2026-02-20 | partialize verified correct. Added useAuthenticationGuard to floorplan/editor. scheduling/employees/reports already had it. Commit `b91bf0b` |
| T-045 | Settings admin pages | PM: Settings | 2026-02-20 | Added Walkout Recovery sub-section + AutoReboot card to settings/page.tsx. Price Rounding toggles + all TipBank sections already existed. Commit `63c41dd` |
| T-078 | Open/Stale Orders Manager UI | PM: Orders | 2026-02-20 | New /orders/manager admin page (825 lines). GET /api/orders extended with dateFrom/dateTo/balanceFilter. Bulk cancel action added. AdminNav link added. Commit `353dd07` |
| T-080 (Phase 6) | Backoffice surcharge reports | PM: Reports | 2026-02-20 | payment_facts.surcharge_amount column + migration; EventIngestionService extracts surchargeAmount; ReportService adds surchargeTotal/effectiveRate/netRevenue; new GET /api/reports/surcharge-summary endpoint. gwi-backoffice commit `d6d8d95` |
| T-080 | Full Pricing Program System (all phases) | PM: Payments | 2026-02-20 | Phase 1: PricingProgram interface + strategy functions. Phase 2: MC PricingProgramCard. Phase 3+5: surcharge in checkout + receipts. Phase 4: settings viewer. Phase 6: backoffice reports. Commits: `d295212`, `7c13ecf`, `9a8c423` |
| T-043 | Clean up duplicate IngredientModification interface | PM: Orders | 2026-02-20 | Removed local re-declaration in order-store.ts; import from @/types/orders instead. Commit `c9730de` |
| T-012 | Remove customization options from Ingredient Admin | PM: Inventory | 2026-02-20 | VERIFIED NO CHANGE NEEDED — Ingredient Admin never exposed pre-modifier customization. These fields were never added to the UI. |
| T-013 | Per-modifier liteMultiplier/extraMultiplier in Item Builder | PM: Menu | 2026-02-20 | Prisma schema + item-editor-types + modifiers API (POST/PUT) + formatModifierGroup + ItemEditor × inputs + order-deduction per-modifier override. Commit `63d72ca` |
| T-042 | Multi-select pre-modifiers | PM: Menu | 2026-02-20 | Compound string format ("side,extra") — no schema change. parsePreModifiers/togglePreModifierToken helpers. UI badges, kitchen print, KDS, inventory multiplier (max token wins). 12 files. Commit `77c1de6` |
| T-073 | QR code generation for order codes (MC) | PM: Mission Control | 2026-02-20 | QrCodeModal (256px canvas, Download PNG, Print). "Generate QR Code" button in VenueUrlCard. gwi-mission-control commit `f06611e` |
| T-075 | Environment field on CloudLocation (MC) | PM: Mission Control | 2026-02-20 | LocationEnvironment enum (DEVELOPMENT/STAGING/PRODUCTION) + field. EnvironmentSelector component. Deploy modal groups by environment. gwi-mission-control commit `f06611e` |
| T-071 | Online ordering middleware routing | PM: Mission Control | 2026-02-20 | Middleware bypass for /:orderCode/:slug + /api/online\|public/* paths. x-venue-slug header set. Zero auth for customer routes. Commit `34e237b` |
| T-072 | Online ordering customer pages | PM: Mission Control | 2026-02-20 | src/app/[orderCode]/[slug]/page.tsx (962 lines) — 3-step flow (menu→cart→Datacap). resolve-order-code public API. error.tsx + not-found.tsx. Next.js 15 async params. Commit `34e237b` |
| T-014 | Bulk "Move to Category" for ingredients | PM: Inventory | 2026-02-20 | ALREADY DONE — IngredientLibrary.tsx fully wired: handleBulkMove() calls PUT /api/ingredients/bulk-move; prep-item move-under inline handler also complete. No code change needed. |
| T-004 | Unit mismatch warning on modifier→ingredient links | PM: Inventory | 2026-02-20 | inventory-link API returns warning field on cross-category UOM. useModifierEditor shows toast.warning. order-deduction console.warn on Path A+B null-conversion. Commit `19ebc15` |
| T-002 | Prep item explosion for modifier deductions (Path B) | PM: Inventory | 2026-02-20 | ORDER_INVENTORY_INCLUDE gains prepItem.ingredients.inventoryItem. Path B: else if (ingredient?.prepItem) calls explodePrepItem(), skips removed ingredients. Mirrors base recipe pattern. 1 file, 32 lines. Commit `b71b8fe` |
| T-017 | Inventory ↔ Menu sync verification (Beef Patty bug) | PM: Menu | 2026-02-20 | CODE FIXED — Skill 291 (commit f11e25f) fixed expansion state reset + POST data shape normalization. "Casa Fries" bug non-reproducible. Remaining: E2E hardware verification (needs live POS). |
| T-050 | Tailwind v4 dev/prod CSS optimization parity | PM: Development-RnD | 2026-02-20 | Added optimize: true to @tailwindcss/postcss in postcss.config.mjs. Forces Lightning CSS in dev to match prod. oklab transpilation unaffected. Commit `12da703` |
| T-001 | Link Ranch ingredients to InventoryItems in seed | PM: Inventory | 2026-02-20 | inv-ranch-dressing-001 upsert + ing-ranch/ing-ranch-dressing/ing-ranch-side/ing-ranch-drizzle all linked. Shared InventoryItem (Ranch Dressing, 128oz/gallon, $0.05/oz). Commit `4870737` |
| T-018 | Wire Socket.io events to CFD page | PM: KDS | 2026-02-19 | CFD page wired to POS socket events. Commit `1e9c00e` |
| T-019 | Wire Socket.io events to Bartender Mobile | PM: KDS | 2026-02-19 | MobileTabActions socket events wired. Commit `1e9c00e` |
| T-020 | Wire Socket.io events to Pay-at-Table | PM: KDS | 2026-02-19 | Pay-at-Table socket sync on payment completion. Commit `72f725b` |
| T-040 | Verify per-item delay countdown + auto-fire | PM: Orders | 2026-02-10 | FIXED — delayStartedAt stamp bug in send route. Fire button on held items. |
| T-051 | Clean up ghost seed data | PM: Floor Plan | 2026-02-20 | Covered by T-036 — all floor plan queries verified compliant with deletedAt: null. Ghost tables remain soft-deleted. No seed.ts change needed. |
| FIX | Deployment build fix — /order page Suspense | PM: Orders | 2026-02-20 | useSearchParams() at root level caused prerender bailout. Wrapped in Suspense boundary. Commit `b4c6f2b` |
| T-015 | Sync updated Skill 215 doc to worktree | PM: Inventory | 2026-02-06 | Verified — 215 doc synced with all 13 sections |
| T-035 | Block legacy combine endpoint | PM: Floor Plan | 2026-02-11 | **SUPERSEDED** — All combine code removed (Skill 326). 116 files, -16,211 lines |
| T-037 | Perimeter polygon safety guard | PM: Floor Plan | 2026-02-11 | **SUPERSEDED** — groups/ directory fully deleted (Skill 326) |
| T-041 | Verify modifier depth indentation visually | PM: Menu | 2026-02-07 | Fixed: `childToParentGroupId` parent-chain walk in useModifierSelections.ts. Depth 0=`•`, depth 1+=`↳` with 20px indent. Committed as `a1ec1c7` |
| NEW | Cash rounding pipeline fix (Skill 327) | PM: Payments/Reports | 2026-02-11 | Dual rounding system sync, payment validation, artifact detection, daily report tracking |
| NEW | Complete combine removal (Skill 326) | PM: Floor Plan | 2026-02-11 | ALL virtual + physical combine deleted. 116 files, -16,211 lines. Tables standalone only. |
| NEW | Seat management fixes (Skill 328) | PM: Floor Plan/Orders | 2026-02-12 | Add seat after send, seatNumber persistence on items, extra seats restore on reopen |
| T-054 | Mission Control: Cloud Project Bootstrap | PM: Mission Control | 2026-02-12 | Next.js 16 + Prisma 7 + Clerk + Neon PostgreSQL |
| T-055 | Mission Control: Cloud Prisma Schema | PM: Mission Control | 2026-02-12 | 11 enums, 10 models, 15 indexes |
| T-056 | Mission Control: Server Registration API | PM: Mission Control | 2026-02-12 | Token validation, fingerprint uniqueness, RSA encryption, audit log |
| T-057 | Mission Control: Heartbeat Ingestion API | PM: Mission Control | 2026-02-12 | HMAC auth, ServerHeartbeat record, ServerStatus.ONLINE, pending commands |
| T-058 | Mission Control: License Validation API | PM: Mission Control | 2026-02-12 | HMAC auth, determineLicenseStatus(), tier features, HMAC-signed response |
| T-059 | Mission Control: Fleet Dashboard | PM: Mission Control | 2026-02-12 | Wave 3 — StatusCard, ServerList, OrgSelector, fleet-status.ts |
| T-061 | Mission Control: SSE Command Stream | PM: Mission Control | 2026-02-12 | Wave 3 — SSE stream + command ACK, priority ordering, Last-Event-ID replay |
| T-060 | Mission Control: Provisioning Script | PM: Mission Control | 2026-02-12 | Wave 4A — Bash: fingerprint, RSA, register, decrypt, .env |
| T-064 | Mission Control: Tenant Isolation | PM: Mission Control | 2026-02-12 | Wave 4A — Per-org schemas, FORCE RLS, withTenantContext, fail-closed |
| T-065 | Mission Control: PayFac Credential Management | PM: Mission Control | 2026-02-12 | Wave 4A — AES encrypt at rest, RSA per-server push, heartbeat hash verification, dedup |
| T-063 | Mission Control: Kill Switch | PM: Mission Control | 2026-02-12 | Wave 4B — kill/revive lib, single+bulk kill, status endpoint, UPDATE_CONFIG revive |
| T-066 | Mission Control: Subscription Tiers & Hardware Limits | PM: Mission Control | 2026-02-12 | Wave 4B — 3-tier limits, per-location overrides, tier comparison UI, FORCE_SYNC on change |
| T-067 | Mission Control: Billing & Late Payment | PM: Mission Control | 2026-02-12 | Wave 4C — Datacap-based (no Stripe), settlement deduction + card-on-file, manual escalation, billing dashboard |
| T-062 | Mission Control: Sync Agent Sidecar | PM: Mission Control | 2026-02-12 | 11 TypeScript files, Docker container: heartbeat, SSE consumer, command worker, license validator, HMAC client, status API |
| NEW | Cloud Auth + Venue Admin Access (Skills 329-332) | PM: Mission Control | 2026-02-12 | Cloud JWT auth, team management, venue portal, posLocationId handoff |
| NEW | Online Ordering URL Infrastructure (Skill 336) | PM: Mission Control | 2026-02-12 | orderCode + onlineOrderingEnabled added to CloudLocation, auto-generated on create, VenueUrlCard shows ordering URL |
| NEW | MC Release Deploy Fix (Skill 335) | PM: Mission Control | 2026-02-12 | Fixed 500 error — resolveCloudOrgId() for audit log FK, try-catch on all release routes |
| T-068 | Per-venue DB routing (Skill 337) | PM: Mission Control | 2026-02-13 | withVenue() + AsyncLocalStorage. All 348 routes wrapped. 3-tier Proxy resolution. 5 commits. |
| T-069 | Remove hardcoded DEFAULT_LOCATION_ID (Skill 337) | PM: Mission Control | 2026-02-13 | Resolved by withVenue() — all routes now read from request context, not hardcoded IDs |
| NEW | Multi-Tenant DB Routing (Skill 337) | PM: Mission Control | 2026-02-13 | AsyncLocalStorage + withVenue() for all 348 API routes. Per-venue Neon DB. Safety rail on slug mismatch. |
| NEW | Cloud Session Validation & Guard (Skill 338) | PM: Mission Control | 2026-02-13 | validate-session endpoint, useCloudSessionGuard layout guard, cloud sign-out, fixes stale locationId |
| NEW | Reports Auth Fix — 14 pages (Skill 374) | PM: Reports | 2026-02-19 | All 14 report pages missing `employeeId` in fetch → 401. Fixed all pages + deterministic `getLocationId()` + deleted stale location record. |
| NEW | NUC-to-Cloud Event Pipeline (Skill 375) | PM: Cloud Sync | 2026-02-19 | Phase 1 COMPLETE. cloud-events.ts + cloud-event-queue.ts + pay route wiring. 7+ orders, $50.71 gross. 3 bugs fixed. Both repos committed & pushed. |
| NEW | Stale location cleanup | PM: Reports | 2026-02-19 | Deleted `cmlkcq9ut0001ky04fv4ph4hh` ("gwi-admin-dev") causing wrong locationId in reports. |

---

## Domain PM Registry

Reference for which PM owns which files. Use this to assign tasks correctly.

| Domain PM | Owns These File Patterns | Key Responsibilities |
|-----------|--------------------------|---------------------|
| PM: Inventory | `/api/ingredients/`, `/api/inventory/`, `/src/lib/inventory-calculations.ts`, `/src/components/ingredients/`, `/src/hooks/useIngredient*.ts` | Ingredient CRUD, stock, recipes, deduction engine, hierarchy |
| PM: Menu | `/api/menu/`, `/src/components/menu-builder/`, `/src/components/menu/` | Categories, items, modifier groups, item builder, modifier flow |
| PM: Orders | `/api/orders/`, `/src/components/orders/`, `/src/app/(pos)/orders/` | Order CRUD, items, send, payment, void/comp |
| PM: Floor Plan | `/api/tables/`, `/api/seats/`, `/api/floor-plan-elements/`, `/src/components/floor-plan/`, `/src/domains/floor-plan/` | Tables, seats, sections, virtual groups, canvas |
| PM: Reports | `/api/reports/`, `/src/app/(admin)/reports/` | Daily, shift, sales, PMIX, tips, voids, variance |
| PM: KDS | `/api/kds/`, `/src/app/(kds)/`, `/api/hardware/kds-screens/` | KDS display, stations, device pairing, tickets |
| PM: Payments | `/api/payments/`, `/api/datacap/`, `/api/bottle-service/`, `/api/orders/[id]/bottle-service/`, `/src/components/payments/`, `/src/components/tabs/`, `/src/components/mobile/`, `/src/components/cfd/`, `/src/lib/datacap/`, `/src/hooks/useDatacap.ts`, `/src/app/(cfd)/`, `/src/app/(mobile)/`, `/src/app/(pos)/pay-at-table/` | Datacap integration, bar tabs, bottle service, CFD, Pay-at-Table, Bartender Mobile |
| PM: Hardware | `/api/hardware/`, `/src/lib/escpos/`, `/api/print/` | Printers, print routes, ESC/POS, cash drawer |
| PM: Entertainment | `/api/entertainment/`, `/src/components/entertainment/`, `/src/app/(kds)/entertainment/` | Timed rentals, sessions, waitlist, KDS dashboard |
| PM: Employees | `/api/employees/`, `/api/roles/`, `/api/time-clock/` | Employee CRUD, roles, permissions, clock in/out |
| PM: Settings | `/api/order-types/`, `/api/inventory/settings/`, `/src/app/(admin)/settings/` | Order types, tip settings, system config |
| PM: Mission Control | `/api/fleet/*`, `/api/admin/*`, cloud Prisma schema, `/sync-agent/*`, `/scripts/provision.sh` | Cloud admin console, fleet management, server registration, license enforcement, data sync, secure updates |

## Cross-Domain Conflict Rules

When a task touches files in MULTIPLE domains:
1. Assign to the domain that owns the **primary** file being changed
2. Add a note: "Touches [Other Domain] files: [list]"
3. The assigned PM coordinates with the other PM before writing code
4. If a worker prompt touches another domain's files, that domain's PM must review it

**Example:** "Add ingredient fallback to deduction engine" → Assigned to PM: Inventory (owns `inventory-calculations.ts`) even though it touches modifier data from PM: Menu's domain.

---

## T-080: Full Pricing Program System — Detailed Spec

### Overview

Expand the pricing engine from a single "Cash Discount" model to support all standard credit card processing models. GWI admins configure the pricing program per-location in Mission Control; merchants see a read-only display on POS.

### Supported Pricing Models

| Model | How It Works | Who Pays the Fee | Legal Notes |
|-------|-------------|-----------------|-------------|
| **Cash Discount** (done) | Card price is base, cash gets a discount | Customer (indirectly) | Legal in all 50 states |
| **Surcharge** | Cash price is base, card pays extra fee | Customer (explicit line item) | Banned in CT, MA, PR. Visa/MC cap at 3%. Must be disclosed. |
| **Flat Rate** | Simple % + per-txn fee (like Square/Stripe) | Merchant (absorbed) | No customer-facing impact |
| **Interchange Plus** | Pass-through interchange + fixed markup | Merchant (absorbed) | No customer-facing impact |
| **Tiered** | Qualified / Mid-qualified / Non-qualified rates | Merchant (absorbed) | No customer-facing impact |

### Data Model

```typescript
// Replace DualPricingSettings with:
interface PricingProgram {
  model: 'cash_discount' | 'surcharge' | 'flat_rate' | 'interchange_plus' | 'tiered' | 'none'
  enabled: boolean

  // Cash Discount settings (model === 'cash_discount')
  cashDiscountPercent?: number        // 0-10%
  applyToCredit?: boolean
  applyToDebit?: boolean
  showSavingsMessage?: boolean

  // Surcharge settings (model === 'surcharge')
  surchargePercent?: number           // 0-4% (Visa/MC cap at 3%)
  surchargeApplyToCredit?: boolean    // Usually credit only
  surchargeApplyToDebit?: boolean     // Usually false (prohibited by some networks)
  surchargeDisclosure?: string        // Required disclosure text

  // Flat Rate settings (model === 'flat_rate')
  flatRatePercent?: number            // e.g., 2.9%
  flatRatePerTxn?: number             // e.g., $0.30

  // Interchange Plus settings (model === 'interchange_plus')
  markupPercent?: number              // e.g., 0.3% above interchange
  markupPerTxn?: number               // e.g., $0.10

  // Tiered settings (model === 'tiered')
  qualifiedRate?: number              // e.g., 1.69%
  midQualifiedRate?: number           // e.g., 2.39%
  nonQualifiedRate?: number           // e.g., 3.49%
  tieredPerTxn?: number               // e.g., $0.25

  // State compliance
  venueState?: string                 // For surcharge legality checks
}
```

### Implementation Phases

#### Phase 1: Refactor Pricing Engine (POS)
**Files:** `src/lib/pricing.ts`, `src/lib/settings.ts`
- Replace `DualPricingSettings` with `PricingProgram` interface
- Add strategy functions per model:
  - `calculateSurcharge(cashPrice, percent)` → adds fee as separate line
  - `calculateFlatRateCost(amount, percent, perTxn)` → merchant cost calc
  - `calculateInterchangePlusCost(amount, interchange, markup, perTxn)` → merchant cost calc
- Keep `calculateCardPrice()` and `calculateCashDiscount()` working (backward compat)
- Flat Rate / Interchange Plus / Tiered don't change customer-facing prices — they're merchant cost tracking only
- Add `getSurchargeAmount()` for receipt line item display
- Add state compliance check: `isSurchargeLegal(state)` → returns false for CT, MA, PR

#### Phase 2: MC Admin UI
**Files:** `gwi-mission-control/src/components/admin/CashDiscountCard.tsx` → rename to `PricingProgramCard.tsx`
- Replace current card with model selector dropdown
- Conditional form fields based on selected model
- Surcharge: show compliance warning for restricted states, cap at 3% with validation
- Flat Rate / Interchange Plus / Tiered: show "merchant cost" calculator (not customer-facing)
- Example calculation display adapts per model:
  - Cash Discount: `$10.00 → Card: $10.40 | Cash: $10.00`
  - Surcharge: `$10.00 + $0.30 surcharge = $10.30`
  - Flat Rate: `$10.00 sale → Your cost: $0.59 (2.9% + $0.30)`
- Save as `settings.pricingProgram` (migrate from `settings.dualPricing`)

#### Phase 3: POS Checkout UI
**Files:** `src/components/payment/PaymentModal.tsx`, `src/hooks/usePricing.ts`
- Surcharge model: show surcharge as separate line item before total
  - "Credit Card Surcharge (3.0%): $0.30"
  - Customer must see surcharge BEFORE they confirm payment
- Cash Discount model: keep current behavior (toggle between cash/card totals)
- Flat Rate / Interchange Plus / Tiered: no change to customer display (merchant-absorbed)
- Required surcharge disclosure text at bottom of payment screen

#### Phase 4: POS Read-Only Viewer
**Files:** `src/app/(admin)/settings/page.tsx`
- Extend current read-only viewer to show active model name
- Model-specific display (surcharge shows rate + disclosure, flat rate shows merchant cost, etc.)
- Same "Contact your administrator" note

#### Phase 5: Receipt & Print
**Files:** `src/components/receipt/Receipt.tsx`, `src/lib/escpos/`
- Surcharge: print as separate line item on receipt (legally required)
- Cash Discount: print savings message (already done)
- Flat Rate / Interchange Plus / Tiered: no receipt change (merchant internal)
- Surcharge disclosure statement must print on receipt

#### Phase 6: Backoffice Reports
**Files:** `gwi-backoffice/` report endpoints
- Add processing cost tracking: actual merchant cost per transaction
- Effective rate report: total fees / total volume
- Model-specific breakdowns in daily/monthly reports
- P&L impact: revenue vs processing costs

### Migration Path

```sql
-- CloudLocation.settings JSON migration
-- Old: { "dualPricing": { "enabled": true, "cashDiscountPercent": 4, ... } }
-- New: { "pricingProgram": { "model": "cash_discount", "enabled": true, "cashDiscountPercent": 4, ... } }
```

Write a one-time migration that:
1. Reads existing `settings.dualPricing`
2. Maps to new `settings.pricingProgram` with `model: 'cash_discount'`
3. Keeps backward compat: pricing engine falls back to `dualPricing` if `pricingProgram` missing

### Compliance Checklist

- [ ] Surcharge banned states: Connecticut, Massachusetts, Puerto Rico
- [ ] Visa/Mastercard surcharge cap: 3% (validate in MC admin)
- [ ] Surcharge cannot exceed merchant's actual cost of acceptance
- [ ] Surcharge must be disclosed at point of entry (signage), point of sale (before confirmation), and on receipt
- [ ] Surcharge typically credit-only (debit surcharging prohibited by many networks)
- [ ] Merchant must notify card brands 30 days before starting surcharge program

### Dependencies

- **Blocked by:** None (can start anytime)
- **Nice to have first:** T-079 (partial payment flow) — split-tender interacts with surcharge calculations
- **Touches:** `pricing.ts`, `usePricing.ts`, `PaymentModal.tsx`, `Receipt.tsx`, MC `PricingProgramCard`, backoffice reports
