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
| T-001 | Link remaining Ranch-related ingredients to InventoryItems (Ranch, Ranch Dressing, Ranch Drizzle all missing inventoryItemId) | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Only "Ranch (side)" is linked. Others need InventoryItems created and linked |
| T-002 | Prep item explosion for modifiers — when modifier → ingredient is a prep item (not inventory item), explode into sub-ingredients for deduction | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Documented in Skill 215 Section 13 |
| T-003 | Modifier-level variance drill-down in AvT reports — show which modifiers contributed to variance | PM: Reports | PM: Inventory | 2026-02-06 | P3 | Requires AvT report UI work |
| T-004 | Unit mismatch warning — detect cross-category UOM (volume→weight) on modifier→ingredient links and warn in UI | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Currently silently falls back to storageUnit |
| T-005 | Modifier recipe support — allow modifiers to have multi-ingredient recipes (not just single ingredient link) | PM: Menu | PM: Inventory | 2026-02-06 | P3 | R365 "concatenation" model. Big feature. |
| T-006 | Pour size integration with ingredient deduction path — apply pour size multiplier to Path B deductions | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Currently pour sizes only affect pricing, not ingredient qty |
| T-007 | Conditional deduction rules — time-of-day or menu-context-based ingredient quantities | PM: Inventory | PM: Inventory | 2026-02-06 | P3 | e.g., happy hour smaller portions |
| T-008 | End-to-end inventory deduction test — place order with Ranch modifier on live POS, pay, verify stock decrease | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Critical verification for Skill 215. Test plan in skill doc. |
| T-009 | Test "Extra Ranch" deduction — verify 2x multiplier (3.0 oz instead of 1.5 oz) | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Part of Skill 215 verification |
| T-010 | Test "No Ranch" on item with base Ranch — verify base recipe Ranch NOT deducted | PM: Inventory | PM: Inventory | 2026-02-06 | P1 | Part of Skill 215 verification |
| T-011 | Unify Liquor + Food Inventory Engines — migrate liquor cocktail recipes into unified MenuItemRecipe structure | PM: Inventory | PM: Inventory | 2026-02-06 | P2 | Currently two separate engines: processLiquorInventory() and deductInventoryForOrder() |
| T-012 | Remove customization options from Ingredient Admin — No/Lite/Extra/On Side, Extra Price, Multipliers, Swap belong in Modifier Groups in Item Builder, not ingredients | PM: Inventory | PM: Menu | 2026-02-06 | P2 | Ingredient-level customization confuses the data model. These are modifier-level concerns. |
| T-013 | Add customization to Item Builder Modifiers — Allow No/Lite/Extra/On Side toggles, extra price upcharge, lite/extra multipliers, swap group config in modifier group editor | PM: Menu | PM: Inventory | 2026-02-06 | P2 | Some may already exist in ModifierGroup/Modifier models |
| T-014 | Bulk "Move to Category" action for selected ingredients in hierarchy view | PM: Inventory | PM: Inventory | 2026-02-06 | P3 | Checkbox selection works, bulk action not yet wired |
| T-017 | Inventory ↔ Menu sync verification — test ingredient linking end-to-end, investigate "Beef Patty → Casa Fries" bug | PM: Menu | PM: Inventory | 2026-02-06 | P2 | Carryover from Menu changelog. May be stale ingredientsLibrary data. |
| T-016 | POS front-end ordering UI lift — ModifierModal flow, item selection UX, order panel polish, overall visual/interaction overhaul for the customer-facing ordering experience | PM: Menu | PM: Inventory | 2026-02-06 | P1 | Desperately needs UI attention. Covers: modifier selection flow, stacking/child navigation, category/item layout, order summary panel, glassmorphism consistency |
| T-018 | Wire Socket.io events to CFD page — connect POS terminal events (cfd:show-order, cfd:payment-started, etc.) to /cfd page state machine. Currently scaffolded but not connected. | PM: KDS | PM: Payments | 2026-02-06 | P2 | CFD page at /cfd has state machine ready. Needs Socket.io room join + event listeners wired to POS payment flow. Touches: src/app/(cfd)/cfd/page.tsx, socket-dispatch.ts |
| T-019 | Wire Socket.io events to Bartender Mobile — connect tab:close-request, tab:closed, tab:status-update events between /mobile/tabs and POS terminal. Currently logging intent only. | PM: KDS | PM: Payments | 2026-02-06 | P2 | MobileTabActions.tsx has switch/case stubs. Needs real socket emit + terminal-side listener. Touches: src/components/mobile/MobileTabActions.tsx, socket-dispatch.ts |
| T-020 | Wire Socket.io events to Pay-at-Table — connect pay:request/result events between /pay-at-table and POS terminal for real-time payment sync. | PM: KDS | PM: Payments | 2026-02-06 | P2 | Pay-at-table page processes locally. Needs socket events for POS terminal awareness. |
| T-021 | Batch close admin UI — add "Close Batch" button in settings/payments with BatchSummary preview and confirmation dialog. Calls /api/datacap/batch. | PM: Settings | PM: Payments | 2026-02-06 | P2 | API route exists. Needs settings page UI section. |
| T-022 | Tip adjustment report — list today's sales with RecordNo tokens, allow manager to adjust tips via AdjustByRecordNo. Could be a new report or section in existing reports. | PM: Reports | PM: Payments | 2026-02-06 | P2 | Datacap /api/datacap/adjust route exists. Needs report UI with editable tip column. |
| T-023 | Reader health dashboard — show avgResponseTime, successRate trending per PaymentReader. Update metrics after each transaction. | PM: Hardware | PM: Payments | 2026-02-06 | P3 | PaymentReader model exists. Needs metrics fields + UI in settings/hardware. |
| T-024 | CFD terminal pairing — admin pairs CFD device to specific POS terminal. Similar to KDS pairing flow. | PM: Hardware | PM: Payments | 2026-02-06 | P3 | Needed before CFD Socket.io events work in multi-terminal setups. |
| T-025 | Mobile device authentication — PIN-based session for bartender phone access. Uses planned RegisteredDevice/DeviceSession models from CLAUDE.md. | PM: Employees | PM: Payments | 2026-02-06 | P3 | /mobile/tabs currently uses ?employeeId query param. Needs proper auth. |
| T-026 | Card token persistence verification — Run test transactions with real Datacap hardware to verify processor returns same token for same card on repeat uses. Critical blocker for Skill 228. | PM: Payments | PM: Payments | 2026-02-06 | P1 | Must complete before any Skill 228 work. See docs/skills/228-CARD-TOKEN-LOYALTY.md Phase 1. Contact processor if tokens don't persist. |
| T-027 | Card token loyalty schema — Add Customer and CardProfile models, create migrations, build API routes for customer CRUD and card linking. Skill 228 Phase 2. | PM: Payments | PM: Payments | 2026-02-06 | P2 | Blocked by T-026. Creates /api/customers routes and token lookup endpoints. |
| T-028 | Loyalty enrollment flow — Build first-visit enrollment modal (phone capture), integrate token recognition into PaymentModal, create LinkCardModal for multi-card linking. Skill 228 Phase 3-5. | PM: Payments | PM: Payments | 2026-02-06 | P2 | Blocked by T-027. Components: LoyaltyEnrollmentModal, LinkCardModal, auto-recognition logic. |
| T-029 | Customer management admin UI — Build /customers admin page with list, search, detail view, card management, points history. Skill 228 Phase 6. | PM: Payments | PM: Payments | 2026-02-06 | P3 | Can be built in parallel with T-028. Admin-facing only. |
| T-030 | Advanced loyalty features — Auto-apply tier discounts, predictive ordering ("Your usual?"), birthday rewards, customer analytics dashboard. Skill 228 Phase 7. | PM: Payments | PM: Payments | 2026-02-06 | P3 | Blocked by T-028. Polish and marketing features. |
| T-031 | Remove production console logging from Floor Plan hot paths — Replace console.log/warn with logger utility in collision detection, normalizeCoord, canPlaceTableAt | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P0 | DEPLOYMENT BLOCKER. Hammers console in render loops, kills performance. Files: EditorCanvas.tsx, collisionDetection.ts, table-positioning.ts |
| T-032 | Replace Math.random() with deterministic table placement — Use center-of-section or auto-grid instead of random coords for initial table/element placement | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P0 | DEPLOYMENT BLOCKER. Non-deterministic placement confuses operators. Files: /api/tables/route.ts, /api/floor-plan-elements/route.ts |
| T-033 | Add API failure rollback + user notifications to Floor Plan editor — All drag/resize/property updates must rollback on failure + show toast | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P0 | DEPLOYMENT BLOCKER. Silent failures = lost work. Files: FloorPlanEditor.tsx, EditorCanvas.tsx, TableProperties.tsx |
| T-034 | Add context logging to normalizeCoord + fail-fast in dev — Log table ID and action context, throw in dev builds instead of silent fallback to 100 | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P1 | High risk of silent table position corruption. File: table-positioning.ts |
| T-035 | Block legacy combine endpoint and add dual-system guard — Return 410 Gone from /api/tables/combine, prevent virtual-combine on legacy-combined tables | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P1 | Prevents data corruption from dual combine systems. Files: /api/tables/combine/route.ts, /api/tables/virtual-combine/route.ts |
| T-036 | Verify soft delete filters in all Floor Plan queries — Ensure deletedAt != null filter on /api/floor-plan and /api/tables to prevent ghost tables | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P1 | Data integrity check. Files: /api/floor-plan/route.ts, /api/tables/route.ts |
| T-037 | Add perimeter polygon safety guard — Max iteration limit + fallback path in buildGroupPerimeterPolygon to prevent infinite loops | PM: Floor Plan | PM: Floor Plan | 2026-02-07 | P2 | Edge case safety. File: groups/virtualGroup.ts or groups/perimeterSeats.ts |
| T-038 | Fix `usePOSLayout.loadLayout` Failed to fetch on page load — timing issue where layout API fires before employee ID is available. Needs guard or retry. | PM: Orders | PM: Orders | 2026-02-07 | P2 | Pre-existing issue. File: src/hooks/usePOSLayout.ts |
| T-039 | Add Quick Pick Numbers toggle to gear dropdown on all 3 views — FloorPlanHome, BartenderView, orders/page need gear menu option for `quickPickEnabled` | PM: Orders | PM: Orders | 2026-02-07 | P2 | Settings infrastructure done (`src/lib/settings.ts`), just needs UI toggle wiring |
| T-040 | Verify per-item delay countdown + auto-fire end-to-end — Add 5m delay to item, send order, verify countdown renders, verify item auto-fires when timer hits 0 | PM: Orders | PM: Orders | 2026-02-07 | P1 | Critical feature verification. Timer logic in OrderPanelItem.tsx, fire logic in useActiveOrder.ts |
| T-042 | Multi-select pre-modifiers — Allow combining pre-modifiers (e.g. "Side Extra Ranch"). Requires `preModifier` field to become array or compound string. | PM: Menu | PM: Menu | 2026-02-07 | P3 | Discovered during OrderPanel session. Workaround: stack modifier twice with different pre-mods. Files: useModifierSelections.ts, ModifierGroupSection.tsx, OrderPanelItem.tsx |
| T-043 | Clean up duplicate IngredientModification interface in order-store.ts — shadows import from @/types/orders.ts | PM: Orders | PM: Menu | 2026-02-07 | P3 | Tech debt. File: src/stores/order-store.ts |
| T-044 | Verify VOID/COMP stamps render on FloorPlanHome after setInlineOrderItems shim fix (status/voidReason/wasMade fields). Also test on BartenderView and orders page. | PM: Orders | PM: Orders | 2026-02-07 | P0 | Skill 238 fix applied but not verified. Files: FloorPlanHome.tsx, BartenderView.tsx, orders/page.tsx, OrderPanelItem.tsx |

## In Progress

| ID | Task | Assigned To | Picked Up | Notes |
|----|------|-------------|-----------|-------|
| T-016 | POS front-end ordering UI lift — ModifierModal flow, item selection UX, order panel polish | PM: Menu | 2026-02-07 | OrderPanel modifier depth, pricing, pre-modifier buttons fixed this session. Remaining: ModifierModal redesign, item grid layout, glassmorphism consistency |

## Completed

| ID | Task | Completed By | Date | Notes |
|----|------|-------------|------|-------|
| T-015 | Sync updated Skill 215 doc to worktree | PM: Inventory | 2026-02-06 | Verified — 215 doc synced with all 13 sections |
| T-041 | Verify modifier depth indentation visually | PM: Menu | 2026-02-07 | Fixed: `childToParentGroupId` parent-chain walk in useModifierSelections.ts. Depth 0=`•`, depth 1+=`↳` with 20px indent. Committed as `a1ec1c7` |

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

## Cross-Domain Conflict Rules

When a task touches files in MULTIPLE domains:
1. Assign to the domain that owns the **primary** file being changed
2. Add a note: "Touches [Other Domain] files: [list]"
3. The assigned PM coordinates with the other PM before writing code
4. If a worker prompt touches another domain's files, that domain's PM must review it

**Example:** "Add ingredient fallback to deduction engine" → Assigned to PM: Inventory (owns `inventory-calculations.ts`) even though it touches modifier data from PM: Menu's domain.
