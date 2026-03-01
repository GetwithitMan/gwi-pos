# Test Registry — GWI POS

> Master index of all test suites. Each suite is a standalone file an agent can read and execute.
> Run all with `FULL SYSTEM TEST` or individual suites with `SYSTEM TEST: [Domain]`.

---

## Suite Index

| # | Suite | File | Tests | Agent | Trigger Command |
|---|-------|------|-------|-------|----------------|
| 01 | Order Lifecycle | `suites/01-order-lifecycle.md` | 28 | ORDER AGENT | `SYSTEM TEST: Orders` |
| 02 | Payments | `suites/02-payments.md` | 35 | PAYMENT AGENT | `SYSTEM TEST: Payments` |
| 03 | Bar Tabs & Pre-Auth | `suites/03-bar-tabs-preauth.md` | 22 | TAB & SPLIT AGENT | `SYSTEM TEST: Tabs` |
| 04 | Splits & Transfers | `suites/04-splits-transfers.md` | 20 | TAB & SPLIT AGENT | `SYSTEM TEST: Splits` |
| 05 | Voids, Comps & Discounts | `suites/05-voids-comps-discounts.md` | 30 | VOID & DISCOUNT AGENT | `SYSTEM TEST: Voids` |
| 06 | KDS, Kitchen & Printing | `suites/06-kds-kitchen-printing.md` | 26 | KDS & PRINT AGENT | `SYSTEM TEST: KDS` |
| 07 | Tips & Shifts | `suites/07-tips-shifts.md` | 24 | TIP & SHIFT AGENT | `SYSTEM TEST: Tips` |
| 08 | Reports | `suites/08-reports.md` | 40 | REPORT AGENT | `SYSTEM TEST: Reports` |
| 09 | Inventory | `suites/09-inventory.md` | 18 | INFRASTRUCTURE AGENT | `SYSTEM TEST: Inventory` |
| 10 | Sockets, Sync & Performance | `suites/10-sockets-sync-performance.md` | 32 | INFRASTRUCTURE AGENT | `SYSTEM TEST: Sockets` |
| 11 | Floor Plan & Tables | `suites/11-floor-plan-tables.md` | 16 | FEATURE AGENT | `SYSTEM TEST: FloorPlan` |
| 12 | Menu, Modifiers & Entertainment | `suites/12-menu-modifiers-entertainment.md` | 24 | FEATURE AGENT | `SYSTEM TEST: Menu` |
| 13 | Auth, Roles & Permissions | `suites/13-auth-roles-permissions.md` | 20 | INFRASTRUCTURE AGENT | `SYSTEM TEST: Auth` |
| 14 | Customers, Loyalty & Online | `suites/14-customers-loyalty-online.md` | 15 | FEATURE AGENT | `SYSTEM TEST: Customers` |
| | **TOTAL** | | **350** | | |

---

## Suite Dependencies

Some suites create data that later suites verify:

```
Phase 1: Auth (13) — verify login works
    │
Phase 2: Orders (01) + KDS (06) — create and process orders
    │
Phase 3: Payments (02) + Tabs (03) + Splits (04) + Voids (05) — financial operations
    │
Phase 4: Tips (07) — verify tip allocation from Phase 3
    │
Phase 5: Reports (08) — verify ALL numbers from Phases 2-4
    │
Phase 6: Inventory (09) + Sockets (10) + Floor Plan (11) + Menu (12) + Customers (14)
         (independent, can run in parallel)
```

---

## How to Add a New Test

1. Create or edit the relevant suite file in `docs/tests/suites/`
2. Follow the test format:
   ```
   ### TEST [suite]-[number]: [Name]
   **Priority:** P0/P1/P2
   **Prereq:** [any setup needed]
   **Steps:**
   1. [action]
   2. [action]
   **Verify:**
   - [ ] [assertion]
   - [ ] [assertion]
   **Timing:** [metric name] < [target]
   ```
3. Update the test count in this registry
4. If the test needs a new agent, update FULL-SYSTEM-TEST.md

---

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| P0 — Blocker | Money, data loss, or crash | Cannot ship. Fix immediately. |
| P1 — Critical | Feature broken, wrong numbers | Must fix before release. |
| P2 — Major | UX degradation, slow perf | Fix in next sprint. |
| P3 — Minor | Cosmetic, edge case | Track in backlog. |

---

## Quick Reference: Key Endpoints Per Suite

### Orders (01)
- `POST /api/orders` — create
- `POST /api/orders/[id]/items` — add items
- `POST /api/orders/[id]/send` — send to kitchen
- `GET /api/orders/open?summary=true` — open orders list

### Payments (02)
- `POST /api/orders/[id]/pay` — process payment
- `POST /api/orders/[id]/pay-all-splits` — pay all splits

### Tabs (03)
- `POST /api/orders/[id]/pre-auth` — pre-authorize
- `POST /api/orders/[id]/close-tab` — capture + close
- `POST /api/orders/[id]/retry-capture` — retry failed capture

### Splits (04)
- `POST /api/orders/[id]/split-tickets` — create split
- `POST /api/orders/[id]/split-tickets/create-check` — create check from split

### Voids (05)
- `POST /api/orders/[id]/comp-void` — void or comp item
- `POST /api/orders/[id]/void-payment` — void payment

### KDS (06)
- `GET /api/kds?locationId=X&stationId=Y` — KDS orders
- `GET /api/kds/expo` — expo view

### Tips (07)
- `GET/PUT /api/settings/tips` — tip settings
- `POST /api/orders/batch-adjust-tips` — batch adjust

### Reports (08)
- `GET /api/reports/daily` — daily summary
- `GET /api/reports/sales` — sales by category
- `GET /api/reports/product-mix` — PMIX
- `GET /api/reports/tips` — tip report
- `GET /api/reports/voids` — void report

### Inventory (09)
- `deductInventoryForOrder()` — auto-deduction
- `deductInventoryForVoidedItem()` — waste path

### Sockets (10)
- `order:created`, `orders:list-changed`, `payment:processed`
- `kds:order-received`, `kds:item-status`, `kds:order-bumped`
- `order:totals-updated`, `floor-plan:updated`

### Auth (13)
- `POST /api/auth/login` — PIN login
- PINs: 1234 (manager), 2345 (server), 3456 (bartender)
