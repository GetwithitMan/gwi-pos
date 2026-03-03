# Skill 460 — Android ModifierSheet Redesign + Ingredient Fix + Performance

**Date:** 2026-03-02
**Repos affected:** `gwi-android-register`, `gwi-pos`
**Commits:**
- `1079272` (POS) — bootstrap adds `ingredientLinks[]` to menu items
- `9094233` (Android) — real ingredient data, heuristic removed
- `2b71fc8` (Android) — ModalBottomSheet, N+1 fix, child parallelism, cache warming, tap feedback
- `a0ece57` (Android) — All mode: tab bar scrolls to group section
- `a478774` (Android) — All mode removed entirely; Steps mode only (−163 lines)

> **Final state:** `ModifierSheet.kt` uses `ModalBottomSheet`, Steps-only mode, batch DB queries,
> parallelized child-group loading, background prefetch, and cache warming at category selection.

---

## What Was Done

Two related problems were fixed in the same session:

### 1. ModifierSheet UI Redesign (prior session, same day)

The `ModifierSheet.kt` was completely rewritten from `FlowRow` chips to a tab-based layout matching the web POS design:

- **Ingredient section** — collapsible "🥗 Customize Ingredients (N changes)" row at top; real ingredient data from `MenuItemEntity.ingredientLinks`; per-ingredient pre-mod buttons (No/Lite/Extra/Side)
- **Square tab buttons** — one tab per modifier group; red border if required+unfulfilled, green+✓ if fulfilled, indigo fill when active
- **List rows** — full-width tappable rows (not chips); 4dp colored left strip; inline pre-mod bar and child group sections
- **Steps / All toggle** — Steps shows one group at a time; All shows everything scrollable
- **Running total footer** — live dollar total as modifiers are selected

### 2. Ingredient Section Showing Wrong Data (bug fix)

**Symptom:** The "Customize Ingredients" section displayed modifier group items (Fries, Salad, Ranch Dressing, etc.) instead of actual ingredients (Hamburger Patty).

**Root cause:** The ingredient section used a heuristic — it classified modifier groups as "ingredient groups" if any of their modifiers had `allowNo || allowLite || allowExtra || allowOnSide = true`. The "Side Choice" modifier group had `allowNo = true` on its modifiers, so it was misidentified as an ingredient group.

**Fix:** Replaced the heuristic entirely with real `MenuItemIngredient` data from a dedicated DB table, served through the bootstrap sync endpoint.

---

## Architecture of the Fix

### Data Model

`MenuItemIngredient` (Prisma) is a **completely separate model** from `ModifierGroup`/`Modifier`. It joins `MenuItem → Ingredient` and stores per-item overrides for the pre-mod flags and price.

```
MenuItem
  ├── ownedModifierGroups (ModifierGroup → Modifier)   ← toppings, sizes, add-ons
  └── ingredients (MenuItemIngredient → Ingredient)    ← what the item IS made of
```

### POS: Bootstrap Endpoint (`/api/sync/bootstrap/route.ts`)

Added `ingredients` include to the menu item query:

```typescript
ingredients: {
  where: { deletedAt: null },
  include: {
    ingredient: {
      select: { id, name, allowNo, allowLite, allowExtra, allowOnSide, extraPrice },
    },
  },
  orderBy: { sortOrder: 'asc' },
},
```

Mapped to `ingredientLinks` array in each menu item response, with per-item override → ingredient default fallback for all 4 pre-mod flags and extraPrice.

### Android: `IngredientLinkInfo.kt` (new domain model)

```kotlin
@JsonClass(generateAdapter = true)
data class IngredientLinkInfo(
    val id: String,
    val ingredientId: String,
    val name: String,
    val isIncluded: Boolean = true,
    val allowNo: Boolean = false,
    val allowLite: Boolean = false,
    val allowExtra: Boolean = false,
    val allowOnSide: Boolean = false,
    val extraPriceCents: Long? = null,
    val sortOrder: Int = 0,
)
```

### Android: DB Migration 33 → 34

```sql
ALTER TABLE menu_items ADD COLUMN ingredientLinks TEXT DEFAULT NULL
```

Stored as JSON via `EntityTypeConverters` (Moshi `List<IngredientLinkInfo>`). No migration of existing rows needed — `NULL` means no ingredients (fallback gracefully).

### Android: Data Flow

```
bootstrap JSON → MenuItemDto.ingredientLinks (List<IngredientLinkDto>)
  → MenuItemDto.toEntity() → MenuItemEntity.ingredientLinks (List<IngredientLinkInfo>)
  → EntityTypeConverters → stored as TEXT in Room
  → OrderViewModel shows modifier sheet → OrderSheet.Modifier.ingredientLinks
  → ModifierSheet.kt → IngredientSection composable
```

`BootstrapWorker.kt` required **no changes** — it already calls `menuItem.toEntity()` for every `MenuItemDto`.

### Android: ModifierSheet Changes

- Removed heuristic classification
- Added `ingredientLinks: List<IngredientLinkInfo> = emptyList()` parameter
- Added `selectedIngredients: SnapshotStateMap<String, String?>` — ingredient ID → preModifier token, separate from `selectedByGroup`
- Ingredient section condition: `!isBarCategory && ingredientLinks.isNotEmpty()` (not based on modifier flags)
- `toggleIngredientPreMod(link, preMod)` operates on `selectedIngredients` directly; clearing all pre-mods keeps ingredient selected (normal = included as-is)
- `buildRequests()` emits `ModifierRequest` entries for active ingredient selections (preMod token carried in `preModifier` field, `name = link.name`)
- Non-ingredient modifier groups: **all groups** go to the tab bar (no heuristic filtering)

---

## Pre-existing `buildRequests()` Bug Fixed (same session)

**Symptom:** Order panel showed "NO No Lettuce" — double prefix.

**Root cause:** `buildRequests()` was setting both `name = "No Lettuce"` (display string) and `preModifier = "no"` (semantic token). `OrderItemControls.kt` renders `preModifier` as a colored badge + `mod.name` separately, causing double display.

**Fix:** `name = sel.name` (plain modifier name). `preModifier` carries the semantic token.

---

## Files Changed

### `gwi-pos`
| File | Change |
|------|--------|
| `src/app/api/sync/bootstrap/route.ts` | Add `ingredients` include + `ingredientLinks` mapping |

### `gwi-android-register`
| File | Change |
|------|--------|
| `domain/model/IngredientLinkInfo.kt` | **New** — Moshi-annotated domain model |
| `data/remote/dto/SyncDto.kt` | Add `IngredientLinkDto` + field on `MenuItemDto` |
| `data/local/entity/MenuItemEntity.kt` | Add `ingredientLinks: List<IngredientLinkInfo>?` column |
| `data/local/entity/EntityTypeConverters.kt` | Add TypeConverters for `List<IngredientLinkInfo>?` |
| `data/local/AppDatabase.kt` | Version 33 → 34 |
| `di/DatabaseModule.kt` | MIGRATION_33_34 (ALTER TABLE) |
| `data/remote/dto/DtoMappers.kt` | Map `ingredientLinks` in `MenuItemDto.toEntity()` |
| `ui/pos/model/OrderStateTypes.kt` | Add `ingredientLinks` field to `OrderSheet.Modifier` |
| `ui/pos/OrderViewModel.kt` | Pass `ingredientLinks` when showing modifier sheet |
| `ui/pos/OrderSheets.kt` | Pass `ingredientLinks = sheet.ingredientLinks` to `ModifierSheet` |
| `ui/pos/components/ModifierSheet.kt` | Use real data; remove heuristic; new ingredient state |

---

## Key Rules / Invariants

1. **Never use modifier pre-mod flags to detect ingredient groups.** `allowNo/Lite/Extra/OnSide` on `ModifierEntity` is for ingredient-style free-text modifiers, but the same flags appear on regular modifier options. Use `MenuItemIngredient` data exclusively.
2. **Ingredients and modifier groups are completely separate Prisma models.** Never conflate them.
3. **Ingredient pre-mods keep ingredient selected.** Clearing all tokens (No/Lite/Extra/Side) does NOT deselect the ingredient — it means "included as normal."
4. **`buildRequests()` uses plain names.** The `name` field in `ModifierRequest` must be the raw modifier/ingredient name. The `preModifier` field carries the semantic token. `OrderItemControls.kt` renders them separately.
5. **Bar category items skip the ingredient section.** The condition is `!isBarCategory && ingredientLinks.isNotEmpty()`.

---

## Performance Addendum (commits `2b71fc8`, `a0ece57`, `a478774`)

After the initial redesign, a performance pass addressed latency in the tap-to-sheet pipeline.

### Problems Fixed

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| N+1 DB query on sheet open | `groups.associate { getModifiersByGroup(it.id) }` — one query per group | `getModifiersByGroups(ids)` single batch + `groupBy` |
| Child group load blocks selection | Sequential `withContext(IO)` calls per child | `coroutineScope { async {} }` + `ConcurrentHashMap` cache |
| Rapid selection causes query bursts | No debounce on snapshotFlow | `snapshotFlow` debounce 50ms |
| Child groups cold on open | Loaded only on first tap | Background prefetch via fire-and-forget after sheet opens |
| No tap feedback | First render after `LaunchedEffect` took ≥1 frame | `loadingMenuItemId: String?` in `OrderUiState`; `MenuItemCard.alpha(0.6f)` |
| Stale modifier cache after menu update | `clearMenuCaches()` not called on bootstrap | Called in `MenuUpdated` + `RELOAD_ANDROID_TERMINAL` handlers |
| Cold category cache | `modGroupCache` only filled on item tap | `getModifierGroupsByItems()` batch DAO, fired on `selectCategory()` |

### ModalBottomSheet vs Dialog

`Dialog` (the original container) rendered in an overlay window outside the Compose hierarchy.
`ModalBottomSheet` is a first-class Compose composable — it slides from the bottom with proper
system back-gesture support and correct insets, matching the physical motion model of Android POS.

### All Mode Removal

The Steps/All view toggle was removed in `a478774`. Rationale:
- All mode required `coroutineScope` + `animateScrollTo` state and was rarely used in real POS workflows
- Steps mode (one group at a time) is better suited to fast service scenarios
- Tab bar already provides the navigation affordance; All mode was redundant
- −163 lines of state management code
