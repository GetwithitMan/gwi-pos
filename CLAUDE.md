# CLAUDE.md — GWI POS

Bar/restaurant POS. Hybrid SaaS: local NUC servers + Neon cloud sync. Fewest-clicks philosophy.

## Task Protocol

### Assess Every Turn
Before touching code: What is being asked? How many files/domains? Research needed? Parallelizable?

### Solo vs Team

| Condition | Action |
|-----------|--------|
| Single-file edit, < 20 lines | Solo |
| Bug fix in one known location | Solo |
| Question about codebase | Solo or Explore agent |
| **2+ files across domains** | **Team** |
| **Research + implementation** | **Team** (Explore researches while you plan) |
| **Schema + API + UI** | **Team** (parallelize layers) |
| **3+ files touched** | **Team** |
| **"PM Mode" or "use a team"** | **Team** (always) |
| **New feature (not a patch)** | **Team** |

### Team Composition
1. Spawn **Explore** agent first (background research)
2. Break down task with **TodoWrite**
3. Spawn **general-purpose** agents per workstream
4. Validate with **Bash** agent (build, lint, type-check)

### Forensic Research (bugs, "something's wrong")
Spawn 3 parallel Explore agents — **Forensic-Data** (trace data flow DB→API→store→UI), **Forensic-Integration** (imports, socket events, side effects), **Forensic-History** (git log, changelogs, recent changes). Each MUST read full files 2+ levels deep. Cross-reference before fixing.

**Triggers:** "doesn't work", fix didn't solve it, data wrong/missing/stale, differs between terminals, "used to work", about to change untraced code.

**Rule: Never fix what you don't fully understand.**

### Bias: When in Doubt, Team It

---

## Pre-Build Protocol

**MANDATORY: Run this checklist before writing ANY code for a feature.**
This prevents double-building, conflicting implementations, and broken cross-feature invariants.

### Step 1 — Name the Feature
State explicitly what feature you are adding to or changing.
→ Find it in `docs/features/_INDEX.md`

### Step 2 — Read the Feature Doc
`docs/features/[feature-name].md`
- Read the entire doc — especially **Business Logic**, **Known Constraints**, and **Cross-Feature Dependencies**
- If no feature doc exists yet, check `docs/domains/` for the domain doc

### Step 3 — Check the Cross-Reference Matrix + Flow Docs
`docs/features/_CROSS-REF-MATRIX.md`
- Find your feature in the matrix
- Read every feature listed in **Depends On** and **Depended On By**
- These are the features your change can break

`docs/flows/_INDEX.md` — if your change touches a critical journey (payment, order, sync, tab lifecycle, shift close), read that flow doc. Flow docs trace the full end-to-end path that must remain intact.

### Step 4 — Read Cross-Referenced Feature Docs
For each feature in Step 3:
- Read its **Code Locations** section — know what files to not break
- Read its **Business Logic** and **Known Constraints** — understand invariants you must preserve

### Step 5 — Impact Check (answer each question)
| Question | Where to Check |
|----------|---------------|
| Are there open bugs in this area? | `docs/planning/KNOWN-BUGS.md` — **read before changing anything around a known bug** |
| Does this violate a regression invariant? | `docs/planning/AUDIT_REGRESSION.md` — 31 invariants that must hold after every change |
| Does this add/remove a permission? | `docs/features/roles-permissions.md` + `src/lib/permission-registry.ts` |
| Does this affect report calculations? | `docs/features/reports.md` + `docs/domains/REPORTS-DOMAIN.md` |
| Does this mutation work offline? | `docs/features/offline-sync.md` — every mutation needs outbox support |
| Does this change need new socket events? | `docs/guides/SOCKET-REALTIME.md` |
| Does this touch an Order or OrderItem? | `docs/guides/ORDER-LIFECYCLE.md` — events MANDATORY |
| Does this touch Payments? | `docs/guides/PAYMENTS-RULES.md` — Datacap only |
| Does this change schema? | Requires migration + `nuc-pre-migrate.js` update |
| Does this affect Android? | `docs/guides/ANDROID-INTEGRATION.md` |
| Does this affect the CFD? | `docs/features/cfd.md` — socket event changes ripple |

### Step 6 — Plan Before Building
Only after Steps 1–5:
- List ALL files that will change (gwi-pos + android + cfd if needed)
- Identify any new socket events to add/update
- Confirm no existing constraint is violated
- Use a Team if 3+ files will change

### Pre-Build Anti-Patterns
- ❌ Adding a new discount type without checking Roles (who can use it)
- ❌ Adding a new payment method without checking Tips (how it affects tip basis)
- ❌ Changing an order mutation without emitting events
- ❌ Adding a setting without checking which features consume it
- ❌ Touching the tip ledger without checking the immutability constraint
- ❌ Adding a new employee action without adding a permission key

---

## Hard Rules

### Offline-First (7 rules)
- NEVER query Neon from POS API routes — all `db.*` → local PG
- NEVER make POS startup/login/orders/payments depend on cloud
- NEVER set NUC `DATABASE_URL` to neon.tech
- Clock discipline: DB-generated `NOW()` only, never client timestamps
- **Full rules:** `docs/guides/ARCHITECTURE-RULES.md`

### Event-Sourced Orders
- EVERY Order/OrderItem mutation MUST emit events via `emitOrderEvent()`
- NEVER write to `db.order`/`db.orderItem` without events
- NEVER read from `db.order`/`db.orderItem` — use snapshots
- **Full rules:** `docs/guides/ORDER-LIFECYCLE.md`

### Payments (Datacap Only)
- NEVER add Stripe/Square/Braintree — Datacap is the only processor
- Money first, reports second — never sacrifice payment reliability
- All payment code in `src/lib/datacap/` only
- **Full rules:** `docs/guides/PAYMENTS-RULES.md`

### Performance
- Socket-first: `emitToLocation()` / `getSharedSocket()` — never `io()` or polling
- Delta updates: removal → local state, addition → debounced refresh
- Fire-and-forget: `void doWork().catch(console.error)` for side effects
- **Full rules:** `docs/guides/CODING-STANDARDS.md`

### Multi-Tenancy
- Every table has `locationId` (except Organization, Location)
- Always filter: `locationId` + `deletedAt: null`
- Soft deletes only: `deletedAt: new Date()`
- **Full rules:** `docs/guides/ARCHITECTURE-RULES.md`

### Android
- Android is PRIMARY client, web is secondary fallback
- Touch targets min 48x48dp, no hover interactions
- Event-sourced orders: Android sends events → POS assigns `serverSequence`
- **Full rules:** `docs/guides/ANDROID-INTEGRATION.md`

## Quick Reference

### Demo Credentials
| Role | PIN |
|------|-----|
| Super Admin (Dev Admin) | 0000 |
| Manager | 1234 |
| Server | 2345 |
| Bartender | 3456 |

### Dev Commands
```bash
npm install          # Install dependencies
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # Lint
npx tsc --noEmit     # Type check
npm run db:studio    # Prisma Studio
```

### Custom Server
`server.ts` wraps Next.js for Socket.io + multi-tenant DB routing. All API routes use `withVenue()` from `src/lib/with-venue.ts`. See `docs/guides/CODING-STANDARDS.md` for patterns.

### Key Model Hierarchy
`Organization` → `Location` → `Category` → `MenuItem` → `OrderItem` → `OrderItemModifier`
`ModifierGroup` → `Modifier` | `Order` → `OrderItem` | `OrderSnapshot` → `OrderItemSnapshot`

### Key Feature Quick-Ref
| Feature | Detail |
|---------|--------|
| Category types | `food`, `drinks`, `liquor`, `entertainment`, `combos`, `retail` |
| Modifier types | JSON array, multi-select: `universal`, `food`, `liquor`, `retail`, `entertainment`, `combo` |
| Pour sizes | `shot` (1.0x), `double` (2.0x), `tall` (1.5x), `short` (0.75x) — `MenuItem.pourSizes` |
| Stacking | `allowStacking: true` — tap same modifier twice for 2x |
| Linked items | `Modifier.linkedMenuItemId` — spirit upgrades with price/inventory tracking |
| Timed rentals | Block time (fixed) or per-minute billing, timer auto-start on send |
| Tip sharing | Auto tip-outs at shift close → payroll. See `docs/domains/TIPS-DOMAIN.md` |

## Doc Routing Table

**MANDATORY: Before editing code in any area below, READ the linked docs first.** Feature docs describe what exists and what it touches. Guide docs describe rules you cannot violate.

> **Hub files (read these on any multi-feature task):**
> - `docs/features/_INDEX.md` — master feature registry
> - `docs/features/_CROSS-REF-MATRIX.md` — what every feature touches

### Feature Docs (read before changing any feature)

| Working On | Feature Doc | Domain Doc | Key Files |
|------------|-------------|------------|-----------|
| Orders | `docs/features/orders.md` | `docs/guides/ORDER-LIFECYCLE.md` | `src/lib/order-events/` |
| Payments / Datacap | `docs/features/payments.md` | `docs/guides/PAYMENTS-RULES.md` | `src/lib/datacap/` |
| Dual pricing | `docs/features/payments.md` · **`docs/skills/SPEC-31-DUAL-PRICING.md`** (canonical spec) | `docs/guides/PAYMENTS-RULES.md` | `src/lib/pricing.ts` |
| Tips / tip-outs | `docs/features/tips.md` | `docs/domains/TIPS-DOMAIN.md` | `src/lib/domain/tips/` |
| Discounts / comps | `docs/features/discounts.md` | — | `src/app/api/orders/[id]/discount/` |
| Roles / permissions | `docs/features/roles-permissions.md` | `docs/domains/EMPLOYEES-DOMAIN.md` | `src/lib/permission-registry.ts` |
| Menu / modifiers | `docs/features/menu.md` | `docs/domains/MENU-DOMAIN.md` | `src/app/(admin)/menu/` |
| Modifiers only | `docs/features/modifiers.md` | `docs/domains/MENU-DOMAIN.md` | `src/app/api/modifiers/` |
| Inventory / recipes | `docs/features/inventory.md` | `docs/domains/INVENTORY-DOMAIN.md` | `src/lib/inventory-calculations.ts` |
| Purchase orders / receiving | `docs/features/purchase-orders.md` | `docs/skills/SPEC-491-PURCHASE-ORDERS.md` | `src/app/api/inventory/orders/`, `src/app/(admin)/inventory/orders/` |
| Tabs / pre-auth | `docs/features/tabs.md` | `docs/domains/TABS-DOMAIN.md` | `src/app/api/tabs/` |
| KDS / kitchen | `docs/features/kds.md` | `docs/domains/KDS-DOMAIN.md` | `src/app/(kds)/` |
| Shifts / payroll | `docs/features/shifts.md` | `docs/domains/EMPLOYEES-DOMAIN.md` | `src/app/api/shifts/` |
| Employees | `docs/features/employees.md` | `docs/domains/EMPLOYEES-DOMAIN.md` | `src/app/(admin)/employees/` |
| Time clock | `docs/features/time-clock.md` | `docs/domains/EMPLOYEES-DOMAIN.md` | `src/app/api/time-clock/` |
| Hardware / printers | `docs/features/hardware.md` | `docs/domains/HARDWARE-DOMAIN.md` | `src/lib/escpos/` |
| CFD / customer display | `docs/features/cfd.md` | `docs/domains/CUSTOMER-DISPLAY-DOMAIN.md` | `src/app/api/cfd/` |
| Floor plan | `docs/features/floor-plan.md` | `docs/domains/FLOOR-PLAN-DOMAIN.md` | `src/components/floor-plan/` |
| Reports | `docs/features/reports.md` | `docs/domains/REPORTS-DOMAIN.md` | `src/app/(admin)/reports/` |
| Settings | `docs/features/settings.md` | `docs/domains/SETTINGS-DOMAIN.md` | `src/app/(admin)/settings/` |
| Entertainment | `docs/features/entertainment.md` | `docs/domains/ENTERTAINMENT-DOMAIN.md` | `src/app/(admin)/timed-rentals/` |
| Liquor builder | `docs/features/liquor.md` | `docs/domains/LIQUOR-MANAGEMENT-DOMAIN.md` | `src/app/(admin)/liquor-builder/` |
| Combos | `docs/features/combos.md` | — | `src/app/(admin)/combos/` |
| Pizza builder | `docs/features/pizza-builder.md` | `docs/domains/PIZZA-BUILDER-DOMAIN.md` | `src/app/(admin)/pizza-builder/` |
| Tax rules | `docs/features/tax-rules.md` | — | `src/app/api/tax-rules/` |
| Customers | `docs/features/customers.md` | `docs/domains/GUEST-DOMAIN.md` | `src/app/api/customers/` |
| Offline sync | `docs/features/offline-sync.md` | `docs/domains/OFFLINE-SYNC-DOMAIN.md` | `src/lib/neon-client.ts` |
| Cash drawers | `docs/features/cash-drawers.md` | — | `src/app/api/drawers/` |
| Events / tickets | `docs/features/events-tickets.md` | `docs/domains/EVENTS-DOMAIN.md` | `src/app/api/events/` |
| Error reporting | `docs/features/error-reporting.md` | `docs/domains/ERROR-REPORTING-DOMAIN.md` | `src/app/api/errors/` |
| Mission Control | `docs/features/mission-control.md` | `docs/domains/MISSION-CONTROL-DOMAIN.md` | `src/app/api/fleet/` |
| Store-and-forward (SAF) | `docs/features/store-and-forward.md` | `docs/guides/PAYMENTS-RULES.md` | `src/lib/datacap/`, `src/app/api/datacap/saf/` |
| Refund / void | `docs/features/refund-void.md` | `docs/guides/PAYMENTS-RULES.md` | `src/app/api/orders/[id]/void-payment/`, `src/app/api/orders/[id]/refund-payment/` |
| Remote void approval | `docs/features/remote-void-approval.md` | `docs/guides/PAYMENTS-RULES.md` | `src/app/api/voids/remote-approval/` |
| Chargebacks | `docs/features/chargebacks.md` | — | `src/app/api/chargebacks/` |
| Pricing programs | `docs/features/pricing-programs.md` | `docs/guides/PAYMENTS-RULES.md` | `src/lib/pricing.ts`, `src/hooks/usePricing.ts` |
| Gift cards | `docs/features/gift-cards.md` | — | `src/app/api/gift-cards/` |
| House accounts | `docs/features/house-accounts.md` | — | `src/app/api/house-accounts/` |
| Coursing | `docs/features/coursing.md` | — | `src/app/api/orders/[id]/courses/`, `src/app/api/orders/[id]/fire-course/` |
| Scheduling | `docs/features/scheduling.md` | — | `src/app/api/schedules/`, `src/app/api/scheduled-shifts/` |
| Security settings | `docs/features/security-settings.md` | — | `src/app/(admin)/settings/security/` |
| Audit trail | `docs/features/audit-trail.md` | — | `src/app/api/audit/`, `src/lib/audit-log.ts` |
| Happy hour pricing | `docs/features/happy-hour.md` | — | `src/lib/settings.ts` (`isHappyHourActive`, `getHappyHourPrice`) |
| Daily prep counts | `docs/features/daily-prep-count.md` | — | `src/app/api/daily-prep-counts/` |
| Coupons / promo codes | `docs/features/coupons.md` | — | `src/app/api/coupons/` |
| Walkout retry | `docs/features/walkout-retry.md` | — | `src/app/api/orders/[id]/mark-walkout/`, `src/app/api/datacap/walkout-retry/` — ⚠️ no scheduler, no write-off API |
| Mobile tab management | `docs/features/mobile-tab-management.md` | — | `src/app/(mobile)/`, `src/components/mobile/MobileTabActions.tsx` — ⚠️ socket relay has no server handlers |
| Pay-at-Table (PAT) | `docs/features/pay-at-table.md` | — | `src/types/multi-surface.ts` (pat:* events) |
| Notifications / alerts | `docs/features/notifications.md` | — | `src/lib/alert-service.ts`, `src/lib/email-service.ts`, `src/app/api/receipts/email/` |
| EOD Reset | `docs/features/eod-reset.md` | — | `src/app/api/eod/reset/` |
| Print routing | `docs/features/print-routing.md` | — | `src/lib/print-template-factory.ts`, `src/lib/print-factory.ts` |
| Customer receipts | `docs/features/customer-receipts.md` | — | `src/lib/print-factory.ts` (`buildReceiptWithSettings`), `src/app/api/receipts/` |
| Discounts (auto) | `docs/features/auto-discounts.md` | — | *(Planned — not built)* |
| Upsell prompts | `docs/features/upsell-prompts.md` | — | *(Schema built — models exist, no API/UI)* |
| Repeat orders | `docs/features/repeat-orders.md` | — | *(Planned — not built)* |
| Custom menus | `docs/features/custom-menus.md` | — | *(Planned — not built)* |
| Commissioned items | `docs/features/commissioned-items.md` | — | `src/components/menu/ItemSettingsModal.tsx`, `src/app/api/reports/commission/`, `src/app/(pos)/crew/commission/` |
| Paid in / out | `docs/features/paid-in-out.md` | — | `src/app/api/paid-in-out/`, `src/app/(admin)/cash-drawer/paid-in-out/` |
| Staff training mode | `docs/features/staff-training.md` | — | *(Planned — not built)* |
| Live dashboard | `docs/features/live-dashboard.md` | — | `src/app/api/dashboard/live/`, `src/app/(admin)/dashboard/` |
| Online ordering | `docs/features/online-ordering.md` | — | `src/app/(admin)/settings/online-ordering/` — uses Datacap PayAPI |
| QR self-ordering | `docs/features/qr-ordering.md` | — | *(Partially built — `/api/public/resolve-order-code` exists)* |
| Delivery management | `docs/features/delivery.md` | — | *(Planned — not built)* |
| Bottle service | `docs/features/bottle-service.md` | — | `src/app/api/bottle-service/` |
| Reservations | `docs/features/reservations.md` | — | *(Planned — not built)* |
| Host management | `docs/features/host-management.md` | — | *(Planned — not built)* |
| Multi-location | `docs/features/multi-location.md` | — | *(Planned — not built)* |
| Invoicing / B2B | `docs/features/invoicing.md` | — | *(Planned — not built)* |
| Hotel PMS integration | `docs/features/hotel-pms.md` | — | `src/lib/oracle-pms-client.ts`, `src/app/api/integrations/oracle-pms/`, `src/app/(admin)/settings/integrations/oracle-pms/page.tsx` |
| 7shifts labor integration | `docs/features/7shifts-integration.md` | `docs/skills/SPEC-485-7SHIFTS-INTEGRATION.md` | `src/lib/7shifts-client.ts`, `src/app/api/integrations/7shifts/`, `src/app/api/webhooks/7shifts/`, `src/app/(admin)/settings/integrations/7shifts/` |
| MarginEdge COGS integration | `docs/features/marginedge-integration.md` | `docs/skills/SPEC-490-MARGINEDGE-INTEGRATION.md` | `src/lib/marginedge-client.ts`, `src/app/api/integrations/marginedge/`, `src/app/api/cron/marginedge-sync/` |
| Printer settings | `docs/features/printer-settings.md` | — | *(Planned — not built)* |

### Flow Docs (read when your change crosses feature boundaries)

> Read a flow doc when your change is *anywhere in the path* of a critical system journey.

| Touching This Journey | Flow Doc |
|----------------------|----------|
| Order sent from register → kitchen | `docs/flows/order-placement.md` |
| Card swipe / charge → payment recorded | `docs/flows/card-payment.md` |
| Card payment while Datacap offline | `docs/flows/offline-payment-saf.md` |
| Bar tab opened → closed → tip captured | `docs/flows/tab-open-to-close.md` |
| Employee clocks in → shift closes | `docs/flows/shift-start-to-close.md` |
| Payment reversal (void or refund) | `docs/flows/void-vs-refund.md` |
| Android sends an event to POS | `docs/flows/android-sync.md` |
| Kitchen bumps an order on KDS | `docs/flows/kds-bump.md` |
| Employee PIN login | `docs/flows/employee-login.md` |
| Terminal reconnects after offline | `docs/flows/offline-recovery.md` |
| Gift card redemption | `docs/flows/gift-card-payment.md` |
| Discount applied to order | `docs/flows/discount-application.md` |

### Architecture Guides (always-applicable rules)

| Working On | Read First | Key Files |
|------------|-----------|-----------|
| Any API route | `docs/guides/CODING-STANDARDS.md` | `src/lib/with-venue.ts` |
| Socket / real-time | `docs/guides/SOCKET-REALTIME.md` | `src/lib/socket-server.ts`, `shared-socket.ts` |
| Android interop | `docs/guides/ANDROID-INTEGRATION.md` | `src/app/api/sync/` |
| NUC deployment | `docs/guides/NUC-OPERATIONS.md` | `public/installer.run` |
| Database / schema | `docs/guides/ARCHITECTURE-RULES.md` | `prisma/schema.prisma` |
| UI / components | `docs/guides/CODING-STANDARDS.md` | `src/stores/` |
| Splits | — | `src/app/api/orders/[id]/split/` |
| PM Mode / teams | `docs/guides/PM-MODE-GUIDE.md` | — |
| Code review | `docs/CODE-REVIEW-CHECKLIST.md` | — |
| Error handling | `docs/development/ERROR-HANDLING-STANDARDS.md` | — |
| Pre-launch testing | `docs/planning/PRE-LAUNCH-CHECKLIST.md` | — |

## Living Log & Documentation

- **Living Log:** `docs/logs/LIVING-LOG.md` — Update at end of every session (date, commits, features, bugs, blockers)
- **Known Bugs:** `docs/planning/KNOWN-BUGS.md` — Open bugs + confirmed fixes. Update when a bug is found or resolved.
- **Flow docs:** `docs/flows/_INDEX.md` — 10 end-to-end system journeys. Read the relevant flow before touching any critical path (payments, orders, sync, shift close, login).
- **Regression invariants:** `docs/planning/AUDIT_REGRESSION.md` — 26 critical invariants. Verify after every significant change.
- **Domain changelogs:** `docs/changelogs/[DOMAIN]-CHANGELOG.md`
- **Skills index:** `docs/skills/SKILLS-INDEX.md` (347+ skill docs)
- **Task board:** `docs/guides/PM-TASK-BOARD.md`
- **PM Mode triggers:** `PM Mode: [Domain]`, `PM Mode: [Domain] (Single Agent)`, `PM Mode: [Domain] (Agent Team)`, `EOD: [Domain]`

### Keeping Feature Docs Current
When you add or significantly change a feature:
1. Update `docs/features/[feature].md` — add new routes, models, flows, constraints
2. Update `docs/features/_CROSS-REF-MATRIX.md` if dependencies changed
3. Update `docs/features/_INDEX.md` if a new feature was added
4. Note the change in `docs/logs/LIVING-LOG.md`

Feature docs are the source of truth for **what exists**. Domain docs are the source of truth for **how it works architecturally**. Both must stay in sync.
