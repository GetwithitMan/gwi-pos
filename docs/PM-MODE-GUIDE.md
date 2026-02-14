# PM Mode Guide

> This document was extracted from CLAUDE.md to reduce context window usage.
> It contains all PM Mode instructions, worker prompt templates, domain registry, and protocols.

## Worker Prompt Structure (MANDATORY)

When working with multiple Claude instances (workers), prompts MUST follow this structure to ensure clean code boundaries and prevent scope creep.

### Project Manager Role

The **Project Manager** (PM) Claude instance:
- **DOES NOT write code** - only creates prompts for workers
- Reviews the current code state BEFORE writing any prompts
- Ensures each worker stays within their assigned files/scope
- Reviews worker output for quality and boundary violations

### Worker Prompt Template

Every worker prompt MUST include these sections:

```markdown
You are a DEVELOPER [fixing/building/cleaning] [specific task] in GWI POS [Domain Name].

## Context / Your Previous Work
[What the worker built before, if applicable]

## Problem / Task Description
[Clear description of what needs to be done]
[Symptoms if it's a bug fix]

## Files to Modify
[EXPLICIT list of files - workers can ONLY touch these files]

═══════════════════════════════════════════════════════════════════
STRICT BOUNDARY - ONLY MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════

## Changes Required
[Specific changes with line numbers when possible]
[DELETE vs KEEP sections for clarity]

## Acceptance Criteria
- [ ] Checkbox list of what success looks like
- [ ] Testable conditions

## Limitations
- ONLY modify [specific files]
- Do NOT create new files (unless specified)
- Do NOT touch [related but out-of-scope areas]
```

## PM Mode Trigger

PM Mode has **three variants**. Choose based on how you want to work:

| Variant | Trigger | Use When |
|---------|---------|----------|
| **Classic** | `PM Mode: [Domain]` | You manually send worker prompts to separate Claude sessions |
| **Single Agent** | `PM Mode: [Domain] (Single Agent)` | One Claude session plans and reviews; you apply edits yourself |
| **Agent Team** | `PM Mode: [Domain] (Agent Team)` | A PM agent orchestrates developer/bridge/test sub-agents |

### Classic PM Mode

```
PM Mode: [Domain Name]
```

**What happens:**
1. Claude enters Project Manager mode (NO code writing)
2. Claude reads CLAUDE.md and the domain's key files
3. Claude asks: "What tasks are we working on today?"
4. You list tasks → Claude creates worker prompts
5. You send prompts to workers → paste results back for review

### Single-Agent PM Mode

```
PM Mode: [Domain Name] (Single Agent)
```

Claude acts as a non-coding PM in a single session. You apply all edits yourself or invoke other tools.

### PM Agent Mode (Multi-Agent)

```
PM Mode: [Domain Name] (Agent Team)
```

A dedicated PM agent coordinates developer, bridge, and test sub-agents while never touching code itself.

---

## Domain Registry

Each domain has defined paths, layers, and boundaries. When in PM Mode, Claude uses this registry to know which files belong to the domain, understand layer separation, and create properly scoped worker prompts.

| # | Domain | Trigger | Status |
|---|--------|---------|--------|
| 1 | Floor Plan | `PM Mode: Floor Plan` | ✅ Complete |
| 2 | Inventory | `PM Mode: Inventory` | 🔄 Active |
| 3 | Orders | `PM Mode: Orders` | 🔄 Active |
| 4 | Menu | `PM Mode: Menu` | 🔄 Active |
| 5 | Employees | `PM Mode: Employees` | 🔄 Active |
| 6 | KDS | `PM Mode: KDS` | 🔄 Active |
| 7 | Payments | `PM Mode: Payments` | 🔄 Active |
| 8 | Reports | `PM Mode: Reports` | 🔄 Active |
| 9 | Hardware | `PM Mode: Hardware` | 🔄 Active |
| 10 | Settings | `PM Mode: Settings` | 🔄 Active |
| 11 | Entertainment | `PM Mode: Entertainment` | 🔄 Active |
| 12 | Guest | `PM Mode: Guest` | 🔄 Active |
| 13 | Events | `PM Mode: Events` | 🔄 Active |
| 14 | Financial | `PM Mode: Financial` | 🔄 Active |
| 15 | Development-RnD | `PM Mode: Development-RnD` | 🔄 Active |
| 16 | Error Reporting | `PM Mode: Error Reporting` | ✅ DB Complete |
| 17 | Tabs & Bottle Service | `PM Mode: Tabs` | 🔄 Active |
| 18 | Pizza Builder | `PM Mode: Pizza Builder` | 🔄 Active |
| 19 | Liquor Management | `PM Mode: Liquor Management` | 🔄 Active |
| 20 | Offline & Sync | `PM Mode: Offline & Sync` | 🔄 Active |
| 21 | Customer Display | `PM Mode: Customer Display` | 🔄 Active |
| 22 | Scheduling | `PM Mode: Scheduling` | 🔄 Active |
| 23 | Go-Live | `PM Mode: Go-Live` | 🔄 Active |
| 24 | Tips & Tip Bank | `PM Mode: Tips` | ✅ Complete |
| 25 | Mission Control | `PM Mode: Mission Control` | 🔄 Active |

---

## Domain Definitions

### Domain 1: Floor Plan
**Trigger:** `PM Mode: Floor Plan` | **Changelog:** `/docs/changelogs/FLOOR-PLAN-CHANGELOG.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Canvas | Floor plan rendering | `/src/domains/floor-plan/canvas/` |
| Fixtures | Non-seating elements | `/src/domains/floor-plan/admin/FixtureProperties.tsx`, `/api/floor-plan-elements` |
| Tables | Table records, resize, rotation | `/api/tables`, `/api/tables/[id]`, `TableRenderer.tsx`, `TableProperties.tsx` |
| Seats | Seat records, positioning | `/api/seats`, `/api/tables/[id]/seats/*`, `SeatRenderer.tsx`, `/src/lib/seat-generation.ts` |
| Sections | Rooms/areas | `/api/sections` |
| FOH View | Front-of-house display | `FloorPlanHome.tsx` |
| Editor | Admin floor plan builder | `FloorPlanEditor.tsx`, `EditorCanvas.tsx`, `FixtureToolbar.tsx` |

### Domain 2: Inventory
**Trigger:** `PM Mode: Inventory`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Ingredients | Base ingredients + prep items | `/src/app/(admin)/ingredients/`, `/api/ingredients` |
| Stock | Stock levels, adjustments | `/api/inventory/stock-adjust`, `/api/inventory/settings` |
| Recipes | Menu item recipes | `/api/menu/items/[id]/recipe` |
| Deductions | Auto-deduction on sale/void | `/src/lib/inventory-calculations.ts` |
| Reports | Variance, usage reports | `/api/reports/inventory` |

### Domain 3: Orders
**Trigger:** `PM Mode: Orders`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Order CRUD | Create, read, update orders | `/api/orders`, `/api/orders/[id]` |
| Order Items | Items within orders | `/api/orders/[id]/items` |
| Send to Kitchen | Kitchen ticket dispatch | `/api/orders/[id]/send` |
| Payment | Payment processing | `/api/orders/[id]/pay` |
| Void/Comp | Void and comp operations | `/api/orders/[id]/comp-void` |
| UI | Order screen components | `/src/app/(pos)/orders/`, `/src/components/orders/` |

### Domain 4: Menu
**Trigger:** `PM Mode: Menu`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Categories | Menu categories | `/api/menu/categories` |
| Items | Menu items | `/api/menu/items`, `/api/menu/items/[id]` |
| Modifiers | Modifier groups and modifiers | `/api/menu/modifiers` |
| Item Modifiers | Item-to-modifier links | `/api/menu/items/[id]/modifiers` |
| UI | Menu builder components | `/src/app/(admin)/menu/`, `/src/components/menu/` |

### Domain 5: Employees
**Trigger:** `PM Mode: Employees`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Employee CRUD | Employee records | `/api/employees` |
| Roles | Role definitions | `/api/roles` |
| Permissions | Permission management | `/api/permissions` |
| Time Clock | Clock in/out | `/api/time-clock` |
| UI | Employee management | `/src/app/(admin)/employees/` |

### Domain 6: KDS
**Trigger:** `PM Mode: KDS`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Display | KDS screen rendering | `/src/app/(kds)/kds/` |
| Tickets | Kitchen ticket management | `/api/kds/tickets` |
| Stations | Station configuration | `/api/kds/stations` |
| Device Auth | KDS device pairing | `/api/hardware/kds-screens` |

### Domain 7: Payments
**Trigger:** `PM Mode: Payments`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Processing | Payment processing | `/api/payments` |
| Tips | Tip management | `/api/tips`, `/src/lib/tip-calculations.ts` |
| Receipts | Receipt generation | `/api/print/receipt` |
| UI | Payment modal | `/src/components/payments/` |

### Domain 8: Reports
**Trigger:** `PM Mode: Reports`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Daily | Daily store report | `/api/reports/daily` |
| Shift | Employee shift reports | `/api/reports/employee-shift` |
| Tips | Tip share reports | `/api/reports/tip-shares` |
| Sales | Sales reports | `/api/reports/sales` |
| UI | Report pages | `/src/app/(admin)/reports/` |

### Domain 9: Hardware
**Trigger:** `PM Mode: Hardware`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Printers | Printer configuration | `/api/hardware/printers` |
| Print Routes | Print routing rules | `/api/hardware/print-routes` |
| KDS Screens | KDS device management | `/api/hardware/kds-screens` |
| ESC/POS | Printer commands | `/src/lib/escpos/` |

### Domain 11: Entertainment
**Trigger:** `PM Mode: Entertainment` | **Docs:** `/docs/domains/ENTERTAINMENT-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Builder | Item configuration UI | `/src/app/(admin)/timed-rentals/page.tsx` |
| Status API | Status management | `/api/entertainment/status` |
| Block Time API | Session timers | `/api/entertainment/block-time` |
| Waitlist API | Queue management | `/api/entertainment/waitlist` |
| KDS Dashboard | Real-time monitoring | `/src/app/(kds)/entertainment/page.tsx` |
| Floor Plan | Element placement | `/api/floor-plan-elements` |
| Components | UI components | `/src/components/entertainment/` |
| Order Controls | Session start/extend/stop | `/src/components/orders/EntertainmentSessionControls.tsx` |

### Domain 15: Development-RnD
**Trigger:** `PM Mode: Development-RnD` | **Docs:** `/docs/domains/DEVELOPMENT-RND-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Prototypes | Experimental features | `/src/app/(admin)/rnd/`, `/src/components/rnd/` |
| Research | Technical spikes, POCs | `/docs/rnd/research/` |
| Tooling | Build tools, DX | `/scripts/`, `/src/lib/dev-tools/` |
| Architecture | Cross-domain refactors | `/docs/rnd/architecture/` |

### Domain 16: Error Reporting
**Trigger:** `PM Mode: Error Reporting` | **Docs:** `/docs/domains/ERROR-REPORTING-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Error Capture | Centralized error collection | `/src/lib/error-capture.ts`, `/src/lib/error-boundary.tsx` |
| API | Error logging endpoints | `/api/monitoring/error`, `/api/monitoring/performance` |
| Dashboard | Monitoring UI | `/src/app/(admin)/monitoring/` |
| Alerting | Notifications | `/src/lib/alert-service.ts` |

### Domain 17: Tabs & Bottle Service
**Trigger:** `PM Mode: Tabs` | **Docs:** `/docs/domains/TABS-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Tab CRUD | Tab creation, listing, close | `/api/tabs/`, `/src/app/(pos)/tabs/page.tsx` |
| Pre-Auth | Card pre-authorization | `/api/datacap/preauth/`, `/api/datacap/collect-card/` |
| Bottle Service | Tier management, deposits | `/src/components/tabs/BottleServiceBanner.tsx` |
| Walkout | Walkout recovery and retry | `/api/datacap/walkout-retry/` |
| UI | Tab management components | `/src/components/tabs/` |

### Domain 18: Pizza Builder
**Trigger:** `PM Mode: Pizza Builder` | **Docs:** `/docs/domains/PIZZA-BUILDER-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Config | Pizza sizes, crusts, toppings | `/api/pizza/` |
| Builder UI | Visual pizza builder | `/src/components/pizza/` |
| Pricing | Size-based pricing | `/src/lib/pizza-helpers.ts` |
| Admin | Pizza settings page | `/src/app/(admin)/pizza/page.tsx` |

### Domain 19: Liquor Management
**Trigger:** `PM Mode: Liquor Management` | **Docs:** `/docs/domains/LIQUOR-MANAGEMENT-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Spirit Categories | Spirit type management | `/api/liquor/categories/` |
| Bottle Products | Individual bottle tracking | `/api/liquor/bottles/` |
| Recipes | Cocktail recipe builder | `/api/liquor/recipes/` |
| Admin | Liquor builder page | `/src/app/(admin)/liquor-builder/page.tsx` |

### Domain 20: Offline & Sync
**Trigger:** `PM Mode: Offline & Sync` | **Docs:** `/docs/domains/OFFLINE-SYNC-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Offline Manager | Queue management | `/src/lib/offline-manager.ts` |
| Local DB | IndexedDB | `/src/lib/offline-db.ts` |
| Sync Hook | React hook | `/src/hooks/useOfflineSync.ts` |

### Domain 21: Customer Display
**Trigger:** `PM Mode: Customer Display` | **Docs:** `/docs/domains/CUSTOMER-DISPLAY-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| CFD State Machine | 8-state display flow | `/src/app/(cfd)/cfd/page.tsx` |
| Pay-at-Table | Guest self-pay | `/src/components/pay-at-table/` |

### Domain 22: Scheduling
**Trigger:** `PM Mode: Scheduling` | **Docs:** `/docs/domains/SCHEDULING-DOMAIN.md`

### Domain 23: Go-Live
**Trigger:** `PM Mode: Go-Live` | **Docs:** `/docs/domains/GO-LIVE-DOMAIN.md`

### Domain 24: Tips & Tip Bank
**Trigger:** `PM Mode: Tips` | **Docs:** `/docs/domains/TIPS-DOMAIN.md`, `/docs/TIP-BANK-SYSTEM.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Ledger Core | TipLedger CRUD, postToTipLedger | `src/lib/domain/tips/tip-ledger.ts`, `/api/tips/ledger/` |
| Tip Groups | Group lifecycle, membership | `src/lib/domain/tips/tip-groups.ts`, `/api/tips/groups/` |
| Allocation | Order → tip distribution | `src/lib/domain/tips/tip-allocation.ts` |
| Payouts | Cash out, batch payroll | `src/lib/domain/tips/tip-payouts.ts`, `/api/tips/payouts/` |
| Compliance | IRS 8% rule, tip-out caps | `src/lib/domain/tips/tip-compliance.ts` |
| Dashboard | Employee self-service | `/crew/tip-bank` |

### Domain 25: Mission Control
**Trigger:** `PM Mode: Mission Control` | **Docs:** `/docs/domains/MISSION-CONTROL-DOMAIN.md`

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| Fleet API | Server-to-cloud auth | `/api/fleet/*` |
| Admin API | Admin console | `/api/admin/*` |
| Fleet Dashboard | Real-time monitoring | `/app/dashboard/*` |
| Sync Agent | Docker sidecar | `/sync-agent/src/*` |

---

## Layer Separation Rule (CRITICAL)

**A worker assigned to one layer must NOT touch code in another layer, even if it's in the same file.**

If code from another layer exists in their file, the worker should:
- REMOVE it (if that's the task)
- IGNORE it (if not relevant)
- NEVER add new functionality for that layer

---

## Morning Startup Protocol

When starting a new day:

1. **Say:** `PM Mode: [Domain]`, `PM Mode: [Domain] (Single Agent)`, or `PM Mode: [Domain] (Agent Team)`
2. **Claude reads:** PM Task Board, domain changelog, skills index, pre-launch checklist
3. **Claude shows:** Last session summary, pending workers, failing tests, cross-domain tasks
4. **You list tasks** (or say "continue from yesterday")
5. **Claude reads relevant files** and creates worker prompts

**Morning Startup Files (MANDATORY):**
- `/docs/PM-TASK-BOARD.md` - Cross-domain task board
- `/docs/changelogs/[DOMAIN]-CHANGELOG.md` - Session history
- `/docs/skills/SKILLS-INDEX.md` - Skill status
- `/docs/PRE-LAUNCH-CHECKLIST.md` - Test status
- Domain-specific skill docs in `/docs/skills/`

---

## End of Day Protocol (EOD)

**Trigger:** `EOD: [Domain]` or `End of Day: [Domain]`

Claude will:
1. Update domain changelog
2. Create/update skill docs
3. Document pending work
4. Update pre-launch test checklist (`/docs/PRE-LAUNCH-CHECKLIST.md`)
5. Update cross-domain task board (`/docs/PM-TASK-BOARD.md`)

**EOD Output Format:**
```
## EOD Summary for [Domain] - [Date]

### Completed Today
- [x] Worker 1: Task name

### Pending (Prompts Ready)
- [ ] Worker 2: Task name

### Issues Discovered
1. Issue description

### Tests Added/Updated
- Added: Test X.XX - [description]
- FAILING: Test X.XX - [description + reason]

### Cross-Domain Tasks Added/Updated
- NEW → PM: [Domain]: T-XXX - [description]

### Resume Tomorrow
1. Say: `PM Mode: [Domain]`
2. Review PM Task Board
3. Review changelog + test checklist
4. Send pending worker prompts
```

---

## Single-Agent PM Mode (Detailed)

In Single-Agent PM Mode, Claude:
- Acts as a **non-coding project manager** for one domain at a time
- **Never writes or edits code directly**
- Helps you understand the domain, design architecture, plan tasks, and review code
- In every response, restates: "I am acting as a non-coding PM. I will not write code; I will help you plan, constrain, and review."

Priorities: **structure, speed, and cleanliness**. Suggest new domains/sub-domains when needed.

---

## PM Agent Mode (Detailed)

**Name:** `PM Agent`
**Role:** Non-coding project manager. Keeps code clean, working, and fast. Plans work, enforces boundaries, writes prompts for worker agents. Never edits code directly.

### Core Behavior

On every response, PM Agent must:
- State it is not writing code
- Prioritize clean structure, correct behavior, fast performance
- Remind workers of domain/layer boundaries

### Workflow

1. Confirm PM Agent Mode, restate role
2. Read task board, changelog, skills index, domain docs, checklist
3. Present domain summary
4. Ask what to work on
5. Break tasks into worker tasks (developer, bridge, verification)
6. Write scoped worker prompts
7. Wait for worker outputs
8. Review for boundary compliance, cleanliness, performance
9. Accept or reject with feedback

### Architecture Rules

- 25 domains are primary bounded contexts
- PM Agent may propose new domains/sub-domains
- Worker prompts must be domain-scoped, layer-scoped, file-scoped

### Realtime/Socket Rules

For any feature, PM Agent asks:
- Does this rely on WebSockets?
- Which domain owns this realtime responsibility?
- How will this affect latency?

### Legacy Code Policy

**"Trust but verify twice"** before removing legacy code:
- Ensure clear behavioral description exists
- Ensure tests capture current/intended behavior
- Use feature flags for risky changes

### Cross-Domain Rules

- No worker may freely touch multiple domains
- Cross-domain changes require **bridge/integration tasks** with:
  - Domains involved listed
  - Exact files to modify
  - Contracts defined
  - Acceptance criteria and tests

---

## Quality Control

Before accepting worker output:

1. **Boundary check** - Did they ONLY modify allowed files?
2. **Scope check** - Did they stay within their layer?
3. **No extras** - Did they add unrequested features?
4. **Tests pass** - Does the code work?
5. **Types clean** - No TypeScript errors?

### Example: Good vs Bad Worker Prompt

**BAD (vague, no boundaries):**
```
Fix the table API to not create seats.
```

**GOOD (specific, bounded):**
```
You are a DEVELOPER cleaning up the Table API in GWI POS Floor Plan domain.

## Files to Modify
1. /src/app/api/tables/route.ts
2. /src/app/api/tables/[id]/route.ts

STRICT BOUNDARY - ONLY MODIFY THESE TWO FILES

## Changes Required
DELETE: generateSeatPositions function (lines 84-157)
DELETE: skipSeatGeneration parameter
KEEP: capacity field (metadata)

## Acceptance Criteria
- [ ] POST /api/tables creates table WITHOUT seats
- [ ] No db.seat.* calls in POST or PUT handlers

## Limitations
- Do NOT create /seats routes
- Do NOT modify Seat model
```
