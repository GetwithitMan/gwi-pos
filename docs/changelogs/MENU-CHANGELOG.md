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

### How to Resume
1. Say: `PM Mode: Menu`
2. Review this changelog
3. Prioritize items 1-8 above
4. Items 7 and 8 are related (POS modifier modal redesign) — likely one combined effort
