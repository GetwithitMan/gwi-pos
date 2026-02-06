# Menu Domain Changelog

## Session: Feb 5, 2026 — Menu Builder Overhaul (Tiered Pricing + Exclusion Rules)

### Plan
Full plan at: `/Users/brianlewis/.claude/plans/hazy-twirling-hopper.md`

**Goal:** Fix infinite re-render bug, make center panel modifier groups editable, create new right panel for modifier flow rules (tiered pricing + exclusion/duplicate prevention), implement POS-side logic.

**Execution Order:** W1 → W2+W3 (parallel) → W4 → W5+W6 (parallel)

**Status:** ALL 6 WORKERS COMPLETE ✅

---

### Workers Completed

#### W1: Schema Migration + API Updates ✅
**Status:** PASSED PM Review
**Files Modified:**
- `prisma/schema.prisma` — Added `tieredPricingConfig Json?` and `exclusionGroupKey String?` to ModifierGroup
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` — PUT accepts new fields + fixed missing `allowStacking`
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — GET returns new fields in `formatModifierGroup`
**Notes:** Schema pushed via `npm run db:backup && npm run db:push`. Backup created before migration.

#### W2: Fix Infinite Re-render Bug ✅
**Status:** PASSED PM Review
**File Modified:** `src/app/(admin)/menu/page.tsx`
**Changes:**
- Added `refreshKey` state (line 215)
- Created `loadMenuRef` ref pattern (lines 279-281) to avoid stale closures
- Fixed initial load useEffect — removed `loadMenu` from deps
- Fixed category-change useEffect — removed `isLoading` and `loadMenu` from deps
- Fixed entertainment auto-refresh — uses `loadMenuRef.current()`
- Replaced destructive `onItemUpdated`/`onUpdated` callbacks with `refreshKey` increment pattern
- Passes `refreshKey` prop to ItemTreeView, ItemEditor, ModifierGroupsEditor
- Removed 7 console.log debug statements

#### W3: Make ItemEditor Fully Editable ✅
**Status:** PASSED PM Review
**File Modified:** `src/components/menu/ItemEditor.tsx` (grew from ~382 to ~919 lines)
**Changes:**
- Updated Modifier/ModifierGroup interfaces with all fields (NLSE toggles, tieredPricingConfig, exclusionGroupKey, child groups)
- Added `refreshKey` and `onSelectGroup` props
- Ported all CRUD functions from ModifierGroupsEditor: `createGroup()`, `updateGroup()`, `deleteGroup()`, `addModifier()`, `updateModifier()`, `deleteModifier()`, `createChildGroup()`, `linkIngredient()`
- Replaced read-only modifier summary with full interactive editor
- Added `renderModifierRow()` helper — modifier name, ingredient link, NLSE toggles, price, delete, child group button
- Added `renderChildGroup()` helper — recursive child groups with indentation
- Collapsible group cards with settings row (min/max, required, stacking)

#### W4: Create ModifierFlowEditor (NEW right panel) ✅
**Status:** PASSED PM Review
**Files Created/Modified:**
- **CREATED:** `src/components/menu/ModifierFlowEditor.tsx` (427 lines)
- **MODIFIED:** `src/app/(admin)/menu/page.tsx`
**Changes:**
- New right panel component with 3 sections:
  1. Group Summary (read-only) — name, badges for required/stacking/selections/modifier count
  2. Tiered Pricing — toggle + two mode checkboxes (flat_tiers, free_threshold), tier rows, overflow price
  3. Exclusion Rules — text input for `exclusionGroupKey`, auto-detects related groups sharing same key
- Auto-saves on blur for all inputs
- Menu page: replaced `ModifierGroupsEditor` import with `ModifierFlowEditor`
- Added `selectedGroupId` state, wired `onSelectGroup` to ItemEditor
- Clear `selectedGroupId` on category change, item change, and item delete

#### W5: POS-Side Tiered Pricing + Exclusion Logic ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/types/index.ts` — Added `tieredPricingConfig` and `exclusionGroupKey` fields to `ModifierGroup` interface (lines 79-92)
- `src/components/modifiers/useModifierSelections.ts` (grew from 607 to 682 lines):
  - Added `getTieredPrice()` helper (lines 96-129) — calculates free threshold, flat tiers, and combined modes
  - Added `getExcludedModifierIds()` helper (lines 131-152) — returns modifier IDs from other groups with same key
  - Updated `formatModPrice()` to accept optional `overridePrice` param (line 168)
  - Updated `modifierTotal` calculation to use tiered pricing per-group (lines 515-529)
  - Exposed both new functions in hook return object (lines 605-610)
- `src/components/modifiers/ModifierGroupSection.tsx` (grew from 299 to 327 lines):
  - Added `getTieredPrice` and `getExcludedModifierIds` props (lines 24-25)
  - Computed `excludedIds` set at render time (lines 134-136)
  - Grayed out excluded modifiers with `opacity-30 cursor-not-allowed` (line 197)
  - Toast warning on excluded modifier click (line 220)
  - Dynamic price display: "FREE" label for zero-price tiered, strikethrough original price (lines 241-250)
- `src/components/modifiers/ModifierModal.tsx` — Destructured + passed new props to ModifierGroupSection (lines 87-88, 238-239)

#### W6: ItemTreeView Refresh Sync ✅
**Status:** PASSED PM Review
**File Modified:** `src/components/menu/ItemTreeView.tsx`
**Changes:**
- Added `refreshKey?: number` to `ItemTreeViewProps` interface (line 47)
- Destructured `refreshKey` in component (line 52)
- Added `refreshKey` to useEffect dependency array (line 84)
- Tree view now re-fetches all data when modifier groups are created/updated/deleted in ItemEditor

---

### All Uncommitted Changes (10 modified + 1 new)
```
 M prisma/schema.prisma                                            (W1)
 M src/app/(admin)/menu/page.tsx                                   (W2, W4)
 M src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts  (W1)
 M src/app/api/menu/items/[id]/modifier-groups/route.ts            (W1)
 M src/components/menu/ItemEditor.tsx                               (W3)
 M src/components/menu/ItemTreeView.tsx                             (W6)
 M src/components/modifiers/ModifierGroupSection.tsx                (W5)
 M src/components/modifiers/ModifierModal.tsx                       (W5)
 M src/components/modifiers/useModifierSelections.ts                (W5)
 M src/types/index.ts                                              (W5)
?? src/components/menu/ModifierFlowEditor.tsx                       (W4 - NEW)
```

**Also untracked (cleanup candidates):**
- `MODIFIER-MODAL-DARK-THEME-CHANGES.md`
- `MODIFIER-MODAL-HOOK-EXTRACTION.md`
- `WORKER-W1-SCHEMA-MIGRATION-SUMMARY.md`
- `docs/changelogs/MENU-CHANGELOG.md`

---

### Known Issues
1. **ModifierGroupsEditor.tsx still exists** — Kept for reference/rollback but no longer imported. Can be deleted once changes are confirmed stable.
2. **Untracked .md files in root** — Worker summary files from earlier sessions should be cleaned up or gitignored.
3. **No E2E testing yet** — Tiered pricing and exclusion features need manual QA on the POS modifier modal.

### Resolved Issues (from previous session)
- ~~ModifierGroupsEditor still rendered in right panel~~ — Replaced by W4 (ModifierFlowEditor)
- ~~ModifierGroupsEditor line 217 no-op bug~~ — Moot, component replaced
- ~~ItemTreeView doesn't watch refreshKey~~ — Fixed by W6

### Architectural Decisions Made
1. **refreshKey pattern** over null-then-restore for child component data reloading
2. **loadMenuRef pattern** to avoid stale closures in useEffect deps
3. **Two tiered pricing modes** — flat_tiers + free_threshold, user requested checkbox to enable both
4. **exclusionGroupKey string** on ModifierGroup for simple cross-group duplicate prevention
5. **Item-owned modifier groups** as primary pattern (menuItemId on group, not junction table)
6. **Prisma.JsonNull** required for SQLite when setting JSON fields to null
7. **ModifierFlowEditor as detail panel** — Shows when a group is expanded in ItemEditor, not standalone
8. **Auto-save on blur** — ModifierFlowEditor saves tiered pricing/exclusion changes on input blur
9. **Additive POS logic** — getTieredPrice/getExcludedModifierIds are fully optional; existing behavior unchanged when not configured

---

## Session: Feb 5, 2026 (Evening) — QA + Bug Fixes + Commit

### Completed
- ✅ Committed W1-W6 as `8d8fcda` (12 files, +1335/-80)
- ✅ Cleaned up 3 root-level .md summary files
- ✅ **Database restored** from backup `pos-20260205-163038.db` — W1's `db:push` had wiped floor plan + orders. Re-added columns safely via `ALTER TABLE`
- ✅ **QA passed** — Admin menu builder 3-panel layout working, ModifierFlowEditor loads correctly
- ✅ Fixed 2 nested `<button>` hydration errors (page.tsx category edit icon, ItemEditor ingredients "+ Add")
- ✅ Fixed ModifierFlowEditor reading `data.modifierGroups` instead of `data.data` from API
- ✅ Deleted unused `ModifierGroupsEditor.tsx` (663 lines removed)
- ✅ Committed fixes as `4c62837`

### ⚠️ Lesson Learned: NEVER use `db:push` on a populated database
W1's `db:push` destroyed the real floor plan and all 42 orders. Always use `ALTER TABLE` for additive-only changes, or test `db:push` on a copy first.

---

## Session: Feb 6, 2026 — Item-Owned Modifier Groups + Production Hardening

### Plan
Build out the full item-owned modifier group system with drag-drop, cross-item copy, ingredient linking, and then harden everything for production based on team code review.

**Execution Order:** W7-W8 → W9+W10 (parallel) → W11 → W12 → W13-A+W13-B (parallel)

**Status:** ALL 9 WORKERS COMPLETE ✅

---

### Workers Completed

#### W7: isLabel API + ItemEditor UI ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` — Added isLabel field support
- `src/components/menu/ItemEditor.tsx` — Choice vs item modifier visual distinction (amber/folder for choices)

#### W8: Drag-Drop Fix + Inline Editing ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Restored +▶ button for child groups, inline name/price editing via double-click

#### W9: Complete Drag-Drop Overhaul ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Group drag isolation, modifier row reorder with ⠿ handles, visual drop indicators

#### W10: Ingredient Dropdown Category Grouping ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Ingredient link dropdown grouped by category with sticky headers

#### W11: Ingredient Dropdown Category Fix ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/app/(admin)/menu/page.tsx` — Map `categoryRelation.name` instead of legacy `category` string

#### W12: Cross-Item Modifier Group Copy ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/app/(admin)/menu/page.tsx` — Drag-drop handlers on item buttons, `handleCopyModifierGroup()`
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — `copyFromItemId` for deep copy with recursive child groups

#### W13-A: Frontend Quality Hardening ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Cycle-safe recursion, 13 toast errors, price validation, static Tailwind, depth guard
- `src/components/menu/ModifierFlowEditor.tsx` — 9 debounced saves, 5 toast errors, input validation, __new__ guard
- `src/app/(admin)/menu/page.tsx` — 8 toast errors, success toasts

#### W13-B: API Route Hardening ✅
**Status:** PASSED PM Review
**Files Modified:**
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — POST validation, PATCH sortOrder validation, deep copy response enhancement
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` — PUT validation (name, min/max), full nested response shape
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` — POST/PUT price validation, consistent response

### Also Completed (During Hardening)
- ✅ Ingredient verification system: `needsVerification`, `verifiedAt`, `verifiedBy` on Ingredient schema
- ✅ Red highlight for unverified items in `/ingredients` page
- ✅ Verify button clears flag with employee attribution

---

### Git Commits
- `6173a2a` — feat(menu): Item-owned modifier groups with drag-drop, cross-item copy, ingredient linking (W1-W12)
- `02737a0` — harden(menu): Production-readiness pass — code review fixes (W13-A, W13-B)

### Code Review Findings Addressed
| # | Finding | Status |
|---|---------|--------|
| 1 | Route handler params as Promise | NOT A BUG (Next 15+ requires await) |
| 2 | Ingredient editor vs API shape mismatch | Deferred (old modal, being replaced) |
| 3 | Modifier groups partial PUT response | ✅ FIXED — Full nested response |
| 4 | Recursive choice cycle detection | ✅ FIXED — visited Set |
| 5 | Drag-drop ghost interactions | Partially addressed (visual constraints deferred) |
| 6 | Dynamic Tailwind classes | ✅ FIXED — Static depthIndent mapping |
| 7 | Hardcoded ingredient defaults | Deferred (new workflow replaces) |
| 8 | Null vs 0 price coercion | ✅ FIXED — Number.isFinite() |
| 9 | Cross-item copy ghost ingredients | Low risk (single-location) |
| 10 | Multiple components fetching same data | Deferred (Phase 2 architecture) |
| 11 | setTimeout race conditions | ✅ FIXED — Debounced save |
| 12 | __new__ exclusion key guard | ✅ FIXED — Disabled state |
| 13 | Numeric input validation | ✅ FIXED — min/step/isFinite |
| 14 | Silent catch blocks | ✅ FIXED — 26 toast.error() added |
| 15 | Type duplication | Deferred (tech debt pass) |

### Architectural Decisions Made
1. **isLabel for choice vs item** — Binary flag cleaner than separate model
2. **Cross-item copy via DataTransfer** — Standard drag API, no custom state management
3. **categoryRelation.name over category string** — Legacy string had 162 nulls, inconsistent casing
4. **Production hardening before feature completion** — Code review drove this, right call for stability
5. **Ingredient verification as creation-time flag** — Don't block menu building, let inventory verify later

---

## Next Session TODO — Menu Domain

### 1. Ingredient Visibility Toggle
Ingredients need a "visible to customer" flag. Non-visible ingredients are tracked for inventory but don't appear in the POS modifier modal. Example: 6pc Wings includes "Chicken Wings, Raw" as an ingredient for inventory tracking, but customers can't modify it (no "No/Extra/On Side" options).
- Add `showOnPOS` boolean (default true) to ingredient links
- Admin UI: toggle per ingredient "Show to customer?"
- POS: filter out non-visible ingredients from modifier modal

### 2. Stacking Clarification + Tiered Pricing Modes
Current "Stacking" means selecting the same modifier multiple times. Verify this is working correctly.
- Review if tiered pricing needs additional mode options beyond flat_tiers and free_threshold
- Consider: quantity-based pricing, volume discounts, etc.

### 3. Free Threshold → Extra Pricing
"First N selections free, then charge individual 'extra' price per modifier." This is the free_threshold mode — verify it correctly falls back to each modifier's individual price (not a flat overflow price) after the free count is exceeded.
- Ensure per-modifier `extraPrice` is used after free threshold
- Test on POS: e.g., "First 2 wing flavors free, 3rd flavor charges $0.50"

### 4. Exclusion Group Key → Dropdown Selector
Replace the text input with a dropdown that shows other modifier groups on the same item. Simplifies setup — admin picks from existing groups instead of typing a key string.
- Example: Item has "Side Choice 1" and "Side Choice 2" groups. Setting exclusion on both means if they pick Asparagus in Side 1, it's greyed out in Side 2.
- Dropdown populated from `allGroups` (already fetched in ModifierFlowEditor)

### 5. Duplicate Modifier Group
Add ability to duplicate a modifier group on an item. The duplicate must be renamed to ensure uniqueness.
- "Duplicate Group" button on each group card in ItemEditor
- Auto-name: "Wing Flavors (Copy)" — require rename before save
- Copy all modifiers, settings, tiered pricing config

### 6. Drag-and-Drop Modifier Group Reordering
Allow reordering modifier groups via drag-and-drop in the admin ItemEditor. The front-end POS modal follows the same `sortOrder`.
- Use a drag handle on each group card
- Update `sortOrder` field on drop
- Persist order via API
- POS modifier modal respects `sortOrder`

### 7. POS Modifier Modal — Consistent Window + Progress Indicators
Redesign the POS modifier modal for a consistent single-size window. Show small indicator squares under the item name representing each modifier group. Required groups get a red border. Completed groups get a green fill.
- Fixed modal size (no resizing between groups)
- Group progress bar/dots at top of modal
- Red border = required, unfilled
- Green fill = completed
- Current group highlighted

### 8. POS Modifier Modal — UX Overhaul
Major upgrade to the front-end modifier workflow. Current issues: window size changes between groups, too many flashes/transitions, jarring experience.
- Smooth transitions between groups (slide or fade, not resize)
- Stable layout — content area stays same size
- Reduce visual noise / flashing
- Consider tabbed or stepped wizard approach
- Touch-friendly for tablets

---

## Session: Feb 6, 2026 (Afternoon) — Deep Item Builder + Ingredient Linking + Print Routing

### Context
Continued from morning session. Focused on making the Item Builder a complete, self-contained tool where every ingredient and modifier is properly linked for cost reporting, PM mix, and inventory tracking. Also introduced per-modifier print routing configuration.

### PM Mode Workers Created (8 total)

#### W1: Clean Up Legacy Shared Modifiers ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — GET returns ONLY item-owned groups (removed MenuItemModifierGroup junction queries, ~30 lines removed)
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — PATCH validates only owned groups
- `src/components/menu/ItemTreeView.tsx` — Removed "Shared Modifiers" tree section, removed `sharedGroups` state, removed fetch to `/modifiers` endpoint
**Impact:** Left sidebar no longer shows legacy "Add Toppings" / "Choose Your Side". Only item-owned groups appear.

#### W2: Per-Modifier Print Routing UI ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Added 🖨️ button on each modifier row with dropdown (follow/also/only), printer checkbox list
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` — POST/PUT accept and return `printerRouting` + `printerIds`
- `src/app/api/menu/items/[id]/modifier-groups/route.ts` — GET returns `printerRouting` + `printerIds` in modifier objects
- `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` — PUT response includes `printerRouting` + `printerIds`
**Impact:** Each modifier can now decide: follow item's printer (default), also print to additional printers, or only print to specific printers. Schema fields `Modifier.printerRouting` and `Modifier.printerIds` were already in Prisma — this wired them to UI and API.

#### W3: Hierarchical Ingredient Picker for Item Ingredients ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Replaced flat ingredient picker with hierarchical dropdown matching modifier linking UI (categories → parents → prep items, expand/collapse, inline creation)
- `buildHierarchy()` refactored to accept `searchTerm` parameter (reusable for both pickers)
**Impact:** Both the green ingredient picker and purple modifier linking dropdown now share the same hierarchical UX.

#### W4: Filter Child Groups from ItemTreeView ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemTreeView.tsx` — Added `childGroupIdSet` filter before rendering, only top-level groups appear in left sidebar
**Impact:** Fixed "4x Dressings" bug where child modifier groups appeared at the top level alongside parent groups.

#### W5: Ingredient ↔ Modifier Bidirectional Link Indicators ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Added `ingredientToModifiers` useMemo cross-reference, ingredient rows show `🔗 modifier names`, unlinked modifiers show "unlinked" hint
**Impact:** Ingredients show which modifiers reference them, modifiers without links get visual nudge.

#### W6: Fix Ingredient Linking — Stale Badge + Persistent Expand State ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Reset `expandedCategories` and `expandedParents` in `linkIngredient()` (after link made), in 🔗 close handler (when toggling off), and verified optimistic update merges `ingredientName` correctly via spread operator
**Impact:** Fixed "Beef Patty → shows Casa Fries" bug. All three close paths (link, toggle off, open new) now reset expand state. No stale hierarchy between linking sessions.

#### W7: Real-Time Ingredient Library Updates (Socket + Optimistic) ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Added `onIngredientCreated` prop, called in `createInventoryItem()` and `createPrepItem()` after API success
- `src/app/(admin)/menu/page.tsx` — `handleIngredientCreated` callback with optimistic `setIngredientsLibrary`, socket listener for `ingredient:library-update` event
- `src/lib/socket-dispatch.ts` — New `dispatchIngredientLibraryUpdate()` function (fire-and-forget pattern)
- `src/app/api/internal/socket/broadcast/route.ts` — New `INGREDIENT_LIBRARY_UPDATE` event type, emits `ingredient:library-update`
- `src/app/api/ingredients/route.ts` — Dispatch on POST success
**Impact:** Creating ingredients inline instantly updates the hierarchy for the creator (optimistic). Socket event syncs across terminals without page refresh.

#### W8: Unverified Badges + Category Warnings + Recursive Reverse Linking ✅ SENT
**Status:** COMPLETED by worker
**Files Modified:**
- `src/components/menu/ItemEditor.tsx` — Added `needsVerification` to Ingredient interface, red "⚠ Unverified" badge on ingredient rows, ⚠ count badge on category headers in both pickers (green + purple), recursive `processModifiers()` helper for `ingredientToModifiers` useMemo
- `src/app/api/menu/items/[id]/ingredients/route.ts` — Returns `needsVerification: mi.ingredient.needsVerification || false` in GET response
**Impact:** Full verification visibility across the item builder. Category headers warn about unverified items. Reverse ingredient-to-modifier linking works at all nesting depths including child groups.

---

### Other Completed Work (This Session)

#### Cascade Delete with Preview
- DELETE API supports `?preview=true` returning counts before deletion
- Double confirmation in ItemEditor (`deleteGroup` function)
- `collectDescendants` recursive function collects all nested groups + modifiers

#### Orphaned childModifierGroupId Auto-Cleanup
- `formatModifierGroup` in GET API detects orphaned references (pointing to deleted groups)
- Returns `null` for missing child groups instead of stale IDs
- Auto-cleans database in background (fire-and-forget `db.modifier.updateMany`)
- Fixed: 🍂 icons, hidden +▶ buttons, blocked drop targets

#### Fluid Group Nesting (Drag Groups In/Out)
- `nestGroupInGroup()` function — auto-creates modifier, reparents dragged group
- Drop zones in both top-level and child group expanded sections
- `handleGroupDropOnModifier` supports swap/replace when modifier already has child
- `isGroupDropTarget` allows drops on any modifier

#### Duplicate Group Stays Within Parent
- `duplicateGroup` detects if source was a child group
- Auto-creates modifier in same parent to hold the duplicate

#### Collapsed Child Group Chips
- Child groups render as compact `○ GroupName (count)` chips when collapsed
- Clicking chip expands, clicking header collapses
- Color cycling preserved

---

### Files Modified (This Session — 17 files uncommitted)

| File | Workers | Changes |
|------|---------|---------|
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | W1, W2 | Remove shared group queries, add printerRouting to GET |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | W2 | Cascade delete with preview, printerRouting in PUT response |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | W2 | POST/PUT accept printerRouting + printerIds |
| `src/app/api/menu/items/[id]/ingredients/route.ts` | W8 | Returns `needsVerification` field |
| `src/components/menu/ItemEditor.tsx` | W1-W8 | Major — cascade delete, orphan fix, nesting, hierarchical picker, print routing, bidirectional linking, stale state fix, unverified badges, recursive reverse linking |
| `src/components/menu/ItemTreeView.tsx` | W1, W4 | Remove shared modifiers section, filter child groups |
| `src/components/menu/ModifierFlowEditor.tsx` | - | Tiered pricing auto-close fix (from previous session carry-over) |
| `src/components/floor-plan/FloorPlanHome.tsx` | - | Auto-add defaults (from previous session carry-over) |
| `src/components/ingredients/IngredientHierarchy.tsx` | - | Checkbox selection (from previous session carry-over) |
| `src/app/(admin)/menu/page.tsx` | W7 | Socket listener for ingredient updates, `handleIngredientCreated` callback |
| `src/lib/socket-dispatch.ts` | W7 | New `dispatchIngredientLibraryUpdate()` function |
| `src/app/api/internal/socket/broadcast/route.ts` | W7 | New `INGREDIENT_LIBRARY_UPDATE` event type |
| `src/app/api/ingredients/route.ts` | W7 | Fire-and-forget socket dispatch on POST |

---

### New Skills Documented (This Session)
- **Skill 210:** Modifier Cascade Delete & Orphan Cleanup
- **Skill 211:** Hierarchical Ingredient Picker (Unified)
- **Skill 212:** Per-Modifier Print Routing
- **Skill 213:** Real-Time Ingredient Library (Socket + Optimistic)
- **Skill 214:** Ingredient Verification Visibility

### Architectural Decisions Made
1. **Item-owned groups ONLY in left sidebar** — Shared groups (via junction table) fully hidden, table retained in schema for data preservation
2. **Per-modifier print routing over per-group** — Finer control: individual modifiers can route to different printers (e.g., "Extra Bacon" → kitchen, "Add Shot" → bar)
3. **Optimistic + Socket for ingredient creation** — Instant local feedback + cross-terminal sync via existing socket infrastructure
4. **Bidirectional linking display** — Ingredients show which modifiers reference them AND modifiers show which ingredient they link to
5. **Recursive ingredientToModifiers** — Cross-reference must recurse into child groups, not just top-level

### Known Issues
1. ~~Workers W7 and W8 still in progress~~ — ✅ COMPLETED
2. ~~expandedCategories/expandedParents shared state~~ — ✅ FIXED by W6 (reset on all close paths)
3. **No E2E testing for print routing** — UI is configuration-only; actual print dispatching deferred to Hardware domain
4. **Ingredient linking still showing wrong names in some cases** — W6 fixed the expand state bug, but user reports "Beef Patty → Casa Fries" persists. May be stale `ingredientsLibrary` data or a timing issue with optimistic updates. Needs further investigation if reproducing.
5. **Inventory ↔ Menu sync is #1 priority** — Per user direction, ensuring every item sold records correct ingredient usage for reporting/PM mix is the most important next task.

---

### All Pending Workers: NONE
All 8 workers (W1-W8) have been completed. ✅

---

### Cross-Domain Notes for Hardware Team

**⚠️ IMPORTANT: Per-Modifier Print Routing was added this session.**

The `Modifier` model now has active UI for:
- `printerRouting`: `"follow"` (default), `"also"`, `"only"`
- `printerIds`: JSON array of printer IDs

When building the print dispatch system (Hardware domain, Skill 103 Phase 3):
1. After resolving item-level routing, check each modifier's `printerRouting`
2. If `"follow"` → modifier prints wherever the item prints (no action needed)
3. If `"also"` → modifier prints to item's printer(s) AND `printerIds`
4. If `"only"` → modifier prints ONLY to `printerIds` (not item's printer)
5. This enables: "Extra Bacon" → Kitchen Printer, "Add Espresso Shot" → Bar Printer

The admin UI at `/settings/hardware/routing` (Skill 103) should also surface these modifier-level overrides in its route resolution display.

---

## Next Session TODO — Menu Domain

### ⭐ Priority 1: Inventory ↔ Menu Sync (BIGGEST TODO)
Per user direction — this is the most important thing to get right:
- Test ingredient linking end-to-end: link ingredient → sell item → verify deduction
- Ensure every item sold records correct ingredient usage for reporting/PM mix
- Cost tracking: ingredient costs flow through to menu item costing
- Investigate if "Beef Patty → Casa Fries" linking bug persists after W6 fix
- Unify liquor + food inventory deduction engines

### Priority 2: POS Ordering Flow UI
Front-end visual issues with taking orders:
- Review ModifierModal flow for customer-facing scenarios
- Test Add Item vs Add Choice (plan exists: `~/.claude/plans/playful-wobbling-gadget.md`)
- Verify modifier stacking, child group navigation, default selections
- Review FloorPlanHome inline ordering end-to-end

### Priority 3: (CARRYOVER) Ingredient Visibility Toggle
- Add `showOnPOS` boolean to ingredient links
- Admin UI: toggle per ingredient "Show to customer?"
- POS: filter non-visible from modifier modal

### Priority 4: Stacking Clarification + Tiered Pricing Modes
- Review if tiered pricing needs additional modes
- Consider: quantity-based pricing, volume discounts
- Verify per-modifier `extraPrice` used after free threshold

### Priority 5: Admin UX Polish
- Exclusion Group Key → Dropdown Selector (replace text input)
- Drag-and-Drop Modifier Group Reordering (admin)

---

### How to Resume
1. Say: `PM Mode: Menu`
2. **Review `/docs/PM-TASK-BOARD.md`** — check for tasks assigned to PM: Menu
3. Review this changelog
4. Review Pre-Launch Test Checklist in CLAUDE.md (Section 2: Modifiers & Menu Builder)
5. All W1-W8 workers are COMPLETE ✅
6. Focus on Priority 1: POS Front-End Ordering UI Lift (T-016)

---

## Session: Feb 6, 2026 (Late) — PM Infrastructure + Cross-Domain Task Assignment

### Context
This session was primarily run under PM: Inventory (Skill 215: Unified Modifier Inventory Deduction). PM: Menu is receiving EOD updates because cross-domain infrastructure was built and tasks were assigned.

### No Code Workers This Session
No Menu-domain code was written. This was an infrastructure and documentation session.

### What Happened (Relevant to Menu Domain)

1. **PM Cross-Domain Task Board created** (`/docs/PM-TASK-BOARD.md`)
   - Central task board all PMs must check on startup and update at EOD
   - Tasks assigned to PM: Menu listed below

2. **Pre-Launch Test Checklist created** (CLAUDE.md)
   - 96 tests across 12 categories
   - Section 2 "Modifiers & Menu Builder" has 10 tests for Menu domain
   - All tests currently ⬜ (untested)

3. **CLAUDE.md Upcoming Work reprioritized**
   - NEW Priority 1: **POS Front-End Ordering UI Lift** (assigned PM: Menu)
   - Previous priorities bumped down by 1

4. **Skills renumbered**
   - Old Skill 210 "Unified Modifier Inventory Deduction" → renamed to **Skill 215** (210 was already taken by Modifier Cascade Delete)
   - New Skill 216: Ingredient-Modifier Connection Visibility

### Tasks Assigned to PM: Menu (from Task Board)

| ID | Task | Priority | Created By | Notes |
|----|------|----------|------------|-------|
| T-005 | Modifier recipe support — multi-ingredient recipes for modifiers | P3 | PM: Inventory | R365 "concatenation" model. Big feature. |
| T-013 | Add customization to Item Builder Modifiers — No/Lite/Extra/On Side toggles, extra price, multipliers, swap config | P2 | PM: Inventory | Some may already exist in ModifierGroup/Modifier models |
| T-016 | **POS front-end ordering UI lift** — ModifierModal flow, item selection UX, order panel polish, glassmorphism consistency | **P1** | PM: Inventory | Desperately needs UI attention |

### Known Issues (Carryover)
1. **"Beef Patty → Casa Fries" linking bug** — May persist after W6 fix. Needs reproduction testing.
2. **No E2E testing for print routing** — UI config only; dispatch deferred to Hardware domain
3. **No E2E testing for tiered pricing/exclusion** — Needs manual QA on POS modifier modal

### Next Session TODO — Menu Domain (UPDATED)

### ⭐ Priority 1: POS Front-End Ordering UI Lift (T-016)
This is now the #1 priority per user direction. The ordering experience desperately needs a UI overhaul:
- [ ] ModifierModal flow redesign — better group navigation, stacking, child groups
- [ ] Item selection UX — category/item grid, touch targets, visual hierarchy
- [ ] Order summary panel polish — item display, modifier depth, quantity controls
- [ ] Glassmorphism consistency across all POS order screens
- [ ] Pre-modifier (No/Lite/Extra) interaction clarity
- [ ] Spirit tier quick-select polish (Call/Prem/Top)
- [ ] Pour size selector polish (Shot/Dbl/Tall/Shrt)
- [ ] Combo step flow UX
- [ ] Mobile/tablet responsive touch targets
- [ ] Animation/transition cleanup

### Priority 2: Modifier Customization in Item Builder (T-013)
- [ ] Allow No/Lite/Extra/On Side toggles per modifier in group editor
- [ ] Extra price upcharge per modifier
- [ ] Lite/Extra multipliers for inventory
- [ ] Swap group configuration

### Priority 3: Inventory ↔ Menu Sync Verification
- [ ] Test ingredient linking end-to-end
- [ ] Investigate "Beef Patty → Casa Fries" bug if still reproducing
- [ ] Verify modifier ingredient deduction via Skill 215

### Priority 4: (CARRYOVER) Ingredient Visibility Toggle
- [ ] `showOnPOS` boolean
- [ ] Admin toggle
- [ ] POS filter

### Priority 5: Admin UX Polish (CARRYOVER)
- [ ] Exclusion Group Key → Dropdown Selector
- [ ] Drag-and-Drop Modifier Group Reordering

### Priority 6: Modifier Recipe Support (T-005)
- [ ] Multi-ingredient recipes for modifiers (big feature, P3)

---

### How to Resume
1. Say: `PM Mode: Menu`
2. **Review `/docs/PM-TASK-BOARD.md`** — check for tasks assigned to PM: Menu
3. Review this changelog
4. Review Pre-Launch Test Checklist in CLAUDE.md (Section 2)
5. Pick up T-016 (POS UI lift) as first priority
