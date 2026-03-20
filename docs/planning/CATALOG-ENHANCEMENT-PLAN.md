# Catalog Enhancement Plan — Multi-Builder Copy + Basic Retail

## Problem

MC catalog copy only handles 4 tables (Category, MenuItem, ModifierGroup, Modifier). When copying a venue's catalog to another venue, all builder-specific data is lost:
- Liquor: BottleProduct, SpiritCategory, recipes gone
- Pizza: sizes, crusts, sauces, toppings, specialties gone
- Combos: combo structure, slots, options gone
- Barcodes: UPC/EAN codes lost
- Pricing variants: size/variant options lost

Items show up in the right builder (categoryType IS preserved), but the builder-specific configuration that makes them functional is missing.

## Architecture Decision

**Neon-to-Neon direct copy** for builder-specific data. No new MC Cloud models needed.

Rationale:
- Adding 19 new Prisma models to MC would be a massive schema change
- Pizza data is NUC-owned (synced to Neon) — MC Cloud models don't exist for it
- Liquor data is bidirectional — Neon has the authoritative copy
- The copy reads from source venue's Neon DB and writes to target venue's Neon DB
- This respects data ownership and is simpler to implement

## Phases

### Phase 1a: Basic Retail Exposure (~30 min)

**One-line change.** Add `retail` to `CATEGORY_TYPES` in POS menu builder.

**What already works for retail:**
- `retail` in `CategoryType` enum
- Barcode scanning (4 API routes, full CRUD + lookup + bulk import)
- Weight-based selling (CAS scale integration, 65 files)
- Inventory tracking (trackInventory, currentStock, lowStockAlert)
- SKU field on MenuItem
- Reports track retailTotal
- POS ordering just works (retail items = MenuItems)

**Files:**
- `src/app/(admin)/menu/types.ts` — add `{ value: 'retail', label: 'Retail', color: '#f59e0b' }`

### Phase 1b: Combo Copy (~3 hours)

**Tables:** ComboTemplate → ComboComponent → ComboComponentOption

**New file:** `MC src/lib/venue-neon-builder-copy.ts`
- Reads from source venue Neon, writes to target venue Neon
- Deterministic ID generation: `mc-ct-{targetSuffix}-{sourceId}`
- FK remapping using existing ID maps from core 4 copy

**FK chain:**
- ComboTemplate.menuItemId → menuItemIdMap
- ComboComponent.comboTemplateId → comboTemplateIdMap
- ComboComponent.menuItemId → menuItemIdMap (optional)
- ComboComponentOption.menuItemId → menuItemIdMap

### Phase 2: Liquor Builder Data (~4 hours)

**Tables:** SpiritCategory → BottleProduct → RecipeIngredient, SpiritModifierGroup

**Key:** BottleProduct.inventoryItemId → NULL (venue-local inventory, not copied)

**FK chain:**
- BottleProduct.spiritCategoryId → spiritCategoryIdMap
- RecipeIngredient.menuItemId → menuItemIdMap
- RecipeIngredient.bottleProductId → bottleProductIdMap
- SpiritModifierGroup.modifierGroupId → modifierGroupIdMap
- SpiritModifierGroup.spiritCategoryId → spiritCategoryIdMap

### Phase 3: Pizza Builder Data (~5 hours)

**Tables:** PizzaConfig, PizzaSize, PizzaCrust, PizzaSauce, PizzaCheese, PizzaTopping, PizzaSpecialty

**Key:** PizzaSpecialty.toppings is a JSON array with toppingId references that must be remapped.

**Special:** PizzaConfig is a singleton (1 per location) — use ON CONFLICT upsert.

**FK chain:**
- PizzaSpecialty.menuItemId → menuItemIdMap
- PizzaSpecialty.defaultCrustId → pizzaCrustIdMap
- PizzaSpecialty.defaultSauceId → pizzaSauceIdMap
- PizzaSpecialty.defaultCheeseId → pizzaCheeseIdMap
- PizzaSpecialty.toppings JSON → remap toppingId inside array

### Phase 4: Remaining Types (~3 hours)

**Tables:** PricingOptionGroup → PricingOption, ModifierGroupTemplate → ModifierTemplate, ItemBarcode

**FK chain:**
- PricingOptionGroup.menuItemId → menuItemIdMap
- PricingOption.groupId → pricingOptionGroupIdMap
- ModifierTemplate.templateId → modifierGroupTemplateIdMap
- ItemBarcode.menuItemId → menuItemIdMap

## Full Delete Order (all 23 tables, reverse FK)

```
ComboComponentOption → ComboComponent → ComboTemplate
SpiritModifierGroup → RecipeIngredient → BottleProduct → SpiritCategory
PizzaSpecialty → PizzaTopping → PizzaCheese → PizzaSauce → PizzaCrust → PizzaSize → PizzaConfig
PricingOption → PricingOptionGroup
ModifierTemplate → ModifierGroupTemplate
ItemBarcode
Modifier → ModifierGroup → MenuItem → Category
```

## Full Insert Order (all 23 tables, FK dependency)

```
Category → MenuItem → ModifierGroup → Modifier
PricingOptionGroup → PricingOption
ComboTemplate → ComboComponent → ComboComponentOption
SpiritCategory → BottleProduct → RecipeIngredient → SpiritModifierGroup
PizzaConfig → PizzaSize → PizzaCrust → PizzaSauce → PizzaCheese → PizzaTopping → PizzaSpecialty
ModifierGroupTemplate → ModifierTemplate
ItemBarcode
```

## DATA_CHANGED FleetCommand Payload

After copy, notify NUC to refresh all 23 tables:
```
['Category', 'MenuItem', 'ModifierGroup', 'Modifier',
 'ComboTemplate', 'ComboComponent', 'ComboComponentOption',
 'SpiritCategory', 'BottleProduct', 'RecipeIngredient', 'SpiritModifierGroup',
 'PizzaConfig', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese', 'PizzaTopping', 'PizzaSpecialty',
 'PricingOptionGroup', 'PricingOption',
 'ModifierGroupTemplate', 'ModifierTemplate',
 'ItemBarcode']
```

## Error Handling

Builder data copy failures are **non-fatal**. Core 4 tables succeed, builder failures reported in response. Single transaction wraps all Neon writes to prevent partial states.

## Files Modified

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1a | 0 | POS: `menu/types.ts` |
| 1b | MC: `venue-neon-builder-copy.ts` | MC: `catalog/copy/route.ts`, `venue-neon-push.ts`, `push-to-venue/route.ts` |
| 2 | 0 | MC: `venue-neon-builder-copy.ts`, `catalog/copy/route.ts`, `venue-neon-push.ts` |
| 3 | 0 | MC: `venue-neon-builder-copy.ts`, `catalog/copy/route.ts`, `venue-neon-push.ts` |
| 4 | 0 | MC: `venue-neon-builder-copy.ts`, `catalog/copy/route.ts`, `venue-neon-push.ts` |

**Total: 1 new file, 4 modified files, ~15.5 hours across 4 phases**

## Future: Advanced Retail (Phase 2 of retail)

When ready for full retail builder:
- Add `RetailVariant` model (size/color/style matrix with per-variant SKU/price/cost/stock)
- Retail Builder admin page (`/retail-builder`)
- RetailVariantPicker modal on POS order screen
- Variant-level barcode resolution
- Auto-86 when variant stock hits zero
- Retail-specific reports (sell-through, margin, aging, shrinkage)
