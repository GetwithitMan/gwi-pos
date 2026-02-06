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

### How to Resume Tomorrow
1. Say: `PM Mode: Menu`
2. Review this changelog
3. **All workers complete** — Ready to commit
4. Consider committing all W1-W6 changes together as one feature commit
5. Clean up root-level .md files (MODIFIER-MODAL-DARK-THEME-CHANGES.md, etc.)
6. Manual QA: test tiered pricing and exclusion on POS modifier modal
7. Consider deleting `ModifierGroupsEditor.tsx` after confirming stability
