# Feature: Liquor Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Spirit category and bottle product management with pour cost tracking, cocktail recipe builder, spirit tier upsells (well/call/premium/top shelf), and liquor-specific inventory deductions. Liquor items are standard menu items with `categoryType: 'liquor'`. Spirit upgrades use `Modifier.linkedMenuItemId` for price and inventory tracking. Single-tier stacking only (no spirit stacking by design).

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin liquor builder, POS ordering, inventory | Full |
| `gwi-android-register` | Spirit tier quick-select, pour size selection | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud sync of liquor data | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/liquor-builder` (6-tab builder) | Managers |
| POS Web | ModifierModal (spirit tier select, pour size) | Bartenders, Servers |
| Android | Spirit tier quick-select, pour size | Bartenders |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/liquor/categories/route.ts` | Spirit category CRUD |
| `src/app/api/liquor/bottles/route.ts` | Bottle product CRUD |
| `src/app/api/liquor/bottles/[id]/create-menu-item/route.ts` | Create menu item from bottle |
| `src/app/api/liquor/bottles/sync-inventory/route.ts` | Sync bottles → inventory items |
| `src/app/api/liquor/recipes/route.ts` | Cocktail recipes with cost calculations |
| `src/app/api/liquor/upsells/route.ts` | Upsell statistics and recording |
| `src/app/api/liquor/menu-items/route.ts` | List liquor menu items |
| `src/app/(admin)/liquor-builder/page.tsx` | Main builder page (2061 lines) |
| `src/app/(admin)/liquor-builder/types.ts` | TypeScript interfaces |
| `src/lib/liquor-inventory.ts` | `processLiquorInventory()`, spirit substitution |
| `src/components/modifiers/useModifierSelections.ts` | Pour size + spirit tier selection |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/liquor/categories` | Employee PIN | List spirit categories with counts |
| `POST` | `/api/liquor/categories` | Manager | Create spirit category |
| `GET` | `/api/liquor/categories/[id]` | Employee PIN | Get category with bottles |
| `PUT` | `/api/liquor/categories/[id]` | Manager | Update category |
| `DELETE` | `/api/liquor/categories/[id]` | Manager | Soft-delete (no bottles assigned) |
| `GET` | `/api/liquor/bottles` | Employee PIN | List bottle products |
| `POST` | `/api/liquor/bottles` | Manager | Create bottle (auto-calculate metrics) |
| `PUT` | `/api/liquor/bottles/[id]` | Manager | Update bottle (recalculates metrics) |
| `DELETE` | `/api/liquor/bottles/[id]` | Manager | Soft-delete (not used in recipes) |
| `POST` | `/api/liquor/bottles/[id]/create-menu-item` | Manager | Create menu item linked to bottle |
| `POST` | `/api/liquor/bottles/sync-inventory` | Manager | Sync bottles without InventoryItem |
| `GET` | `/api/liquor/recipes` | Employee PIN | List cocktails with cost breakdown |
| `GET/POST` | `/api/liquor/upsells` | Employee PIN | Upsell stats and recording |
| `GET` | `/api/liquor/menu-items` | Employee PIN | List liquor menu items |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `menu:updated` | — | Bottle/category/menu item changes |

---

## Data Model

```
SpiritCategory {
  id              String
  locationId      String
  name            String            // "Tequila", "Vodka", "Gin"
  categoryType    String            // spirit | beer | wine
  sortOrder       Int
  isActive        Boolean
}

BottleProduct {
  id              String
  locationId      String
  name            String            // "Seagram's 7"
  brand           String?
  spiritCategoryId String
  tier            String            // well | call | premium | top_shelf
  bottleSizeMl    Int               // 750, 1000, 1750
  bottleSizeOz    Decimal?          // auto-calculated
  unitCost        Decimal           // $25.99 per bottle
  pourSizeOz      Decimal?          // override location default (1.5oz)
  poursPerBottle  Int?              // auto-calculated
  pourCost        Decimal?          // auto-calculated
  containerType   String            // bottle | can | draft | glass
  currentStock    Int
  lowStockAlert   Int?
  inventoryItemId String?           // unified inventory link
  needsVerification Boolean         // from menu builder, needs review
}

RecipeIngredient {
  id              String
  menuItemId      String            // cocktail menu item
  bottleProductId String?           // spirit ingredient
  ingredientId    String?           // food ingredient
  pourCount       Decimal           // 1, 0.5, 2
  pourSizeOz      Decimal?          // override
  isRequired      Boolean
  isSubstitutable Boolean           // can swap for different tier
  unit            String?           // "each", "oz", "slice", "wedge"
}

SpiritModifierGroup {
  id              String
  modifierGroupId String            // links to ModifierGroup
  spiritCategoryId String
  upsellEnabled   Boolean
  defaultTier     String            // well | call | premium | top_shelf
}

SpiritUpsellEvent {
  id              String
  orderId         String
  baseTier        String
  upsellTier      String
  priceDifference Decimal
  wasAccepted     Boolean
}
```

---

## Business Logic

### Pour Cost Calculation
```
bottleSizeOz = bottleSizeMl / 29.5735
poursPerBottle = floor(bottleSizeOz / effectivePourSizeOz)
pourCost = unitCost / poursPerBottle
```
Example: 750mL bottle @ $25 with 1.5oz pours → 16 pours → $1.5625/pour

### Pour Sizes
| Size | Multiplier | Description |
|------|-----------|-------------|
| Shot | 1.0x | Standard pour |
| Double | 2.0x | Double the pour |
| Tall | 1.5x | Tall glass |
| Short | 0.75x | Short glass |

### Inventory Deduction Flow
1. Order paid → `processLiquorInventory(orderId)` called
2. For each liquor item with recipe: fetch recipe ingredients
3. Check for spirit substitutions from modifiers (`linkedBottleProductId`)
4. Calculate: `pourCount × quantity × pourMultiplier`
5. Deduct from bottle stock, create inventory transactions
6. Returns `{ processed[], totalCost }`

### Spirit Substitution
- Modifier with `linkedBottleProductId` overrides recipe spirit
- Recipe ingredient must have `isSubstitutable: true`
- Validated by `spiritCategoryId` match

### Edge Cases & Business Rules
- Single-tier stacking ONLY — no spirit stacking by design
- Bottles from menu builder: `needsVerification: true` until admin reviews
- `containerType` supports: bottle, can, draft, glass
- Wine-specific: `alcoholSubtype` (red/white/rose/sparkling), `vintage` year
- Beer-specific: `alcoholSubtype` (domestic/import/craft/seltzer/na)
- Bottle → MenuItem is soft 1:1 (one bottle, one menu item)

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Pour size selection, spirit tier on order items |
| Reports | Liquor reports: pour cost %, bottle variance |
| Inventory | Bottle deductions on payment |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Liquor items are menu items with `categoryType: 'liquor'` |
| Modifiers | Spirit tier modifiers with `linkedMenuItemId` |
| Inventory | Bottle stock tracking |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Modifiers** — spirit tier and linked menu item interactions
- [ ] **Inventory** — bottle deduction calculations
- [ ] **Orders** — pour size and multiplier on order items
- [ ] **Menu** — `categoryType: 'liquor'` routing

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View liquor builder | Manager role | High |
| Edit bottles/categories | Manager role | High |

---

## Known Constraints & Limits
- Default pour size: 1.5 oz (configurable per bottle)
- ML to OZ conversion: 29.5735 mL/oz
- Bottle metrics auto-recalculated on size/cost/pour changes
- Inventory unification: multiple bottle sizes can share one InventoryItem

---

## Android-Specific Notes
- Spirit tier quick-select on modifier modal
- Pour size selection (shot/double/tall/short)
- Touch-friendly tier buttons

---

## Related Docs
- **Domain doc:** `docs/domains/LIQUOR-MANAGEMENT-DOMAIN.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Liquor Management row
- **Modifiers:** `docs/features/modifiers.md`
- **Inventory:** `docs/domains/INVENTORY-DOMAIN.md`

---

*Last updated: 2026-03-03*
