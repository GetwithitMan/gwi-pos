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

## In Progress

| ID | Task | Assigned To | Picked Up | Notes |
|----|------|-------------|-----------|-------|
| | | | | |

## Completed

| ID | Task | Completed By | Date | Notes |
|----|------|-------------|------|-------|
| T-015 | Sync updated Skill 215 doc to worktree | PM: Inventory | 2026-02-06 | Verified — 215 doc synced with all 13 sections |

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
| PM: Payments | `/api/payments/`, `/src/components/payments/` | Processing, tips, receipts |
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
