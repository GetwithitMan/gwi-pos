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
| Admin | `/liquor-inventory` → `LiquorInventory` component | Managers |
| Admin | `/settings/liquor-builder` (alias for `/liquor-builder`) | Managers |
| Admin | `/reports/liquor` | Managers |
| POS Web | `BartenderView` — bar hot buttons, spirit tier, pour size | Bartenders |
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
| `src/app/api/orders/[id]/bottle-service/route.ts` | `POST` open bottle service tab (pre-auth + tier), `GET` bottle service status |
| `src/app/(admin)/liquor-builder/page.tsx` | Main builder page (spirits, bottles, drinks, modifiers, recipes, inventory) |
| `src/app/(admin)/liquor-builder/types.ts` | TypeScript interfaces (`SpiritCategory`, `BottleProduct`) |
| `src/app/(admin)/liquor-builder/CategoryModal.tsx` | Spirit category create/edit modal |
| `src/app/(admin)/liquor-builder/BottleModal.tsx` | Bottle product create/edit modal |
| `src/app/(admin)/liquor-builder/CreateMenuItemModal.tsx` | Create menu item from bottle product |
| `src/app/(admin)/liquor-builder/LiquorModifierGroupEditor.tsx` | Inline modifier group editor |
| `src/app/(admin)/liquor-inventory/page.tsx` | Liquor inventory admin page |
| `src/app/(admin)/settings/liquor-builder/page.tsx` | Alias redirect to `/liquor-builder` |
| `src/app/(admin)/reports/liquor/page.tsx` | Liquor reports |
| `src/components/liquor/LiquorInventory.tsx` | Liquor inventory component (bottle stock, categories, tiers, container types) |
| `src/components/liquor/LiquorModifiers.tsx` | Liquor modifier template management (reusable groups for drinks) |
| `src/components/bartender/BartenderView.tsx` | Bar POS view with hot buttons, spirit tier selection, pour sizes |
| `src/components/bartender/SpiritSelectionModal.tsx` | Spirit upgrade selection modal |
| `src/components/bartender/bartender-settings.ts` | Bar hot modifier config, common bar modifier names |
| `src/components/tabs/BottleServiceBanner.tsx` | Bottle service progress banner (spend tracking, re-auth alerts) |
| `src/lib/liquor-inventory.ts` | `processLiquorInventory()`, `recordSpiritUpsells()`, `getLiquorUsageSummary()` |
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
| `POST` | `/api/orders/[id]/bottle-service` | Employee PIN | Open bottle service tab (pre-auth + tier selection) |
| `GET` | `/api/orders/[id]/bottle-service` | Employee PIN | Get bottle service status (spend progress, alerts) |

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

BottleServiceTier {
  id                  String
  locationId          String
  name                String            // "Bronze", "Silver", "Gold", "Platinum"
  description         String?
  color               String            // Banner/badge color (default: gold #D4AF37)
  depositAmount       Decimal           // Pre-auth amount ($500, $1000, $2000)
  minimumSpend        Decimal           // Soft minimum spend requirement
  autoGratuityPercent Decimal?          // Override auto-gratuity for this tier
  sortOrder           Int
  isActive            Boolean
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

### Bartender View (Bar Hot Buttons)
- `BartenderView` is the primary bar POS interface at `src/components/bartender/BartenderView.tsx`
- Shows categories filtered to `categoryShow: 'bar'` or `categoryType: 'drinks'/'liquor'`
- Hot modifiers: common bar modifiers (e.g., rocks, neat, dirty, shaken) displayed as quick-tap buttons below each item
- Hot modifier config defined in `src/components/bartender/bartender-settings.ts` (`COMMON_BAR_MODIFIERS`, `HOT_MODIFIER_CONFIG`)
- Spirit tier quick-select: distinct color-coded buttons for Well, Call, Premium, Top Shelf
- Pour size quick-select: Shot (1x), Double (2x), Tall (1.5x), Short (0.75x) with teal gradient colors
- Custom pour sizes supported via `MenuItem.pourSizes` JSON field
- `SpiritSelectionModal` provides full-screen spirit upgrade selection

### Bottle Service
- Managed via `POST/GET /api/orders/[id]/bottle-service`
- Opening a bottle service tab: selects a `BottleServiceTier`, runs a Datacap EMV PreAuth for the deposit amount
- Creates `OrderCard` record and sets `Order.isBottleService = true`
- Tiers (`BottleServiceTier`): name, color, deposit amount, minimum spend, optional auto-gratuity percent
- `BottleServiceBanner` component tracks spend progress, minimum spend status, re-auth alerts
- Re-auth alert triggers when spend reaches 80% of deposit amount
- Increment auth failure flag persists so bartender sees "card limit reached" alert
- Socket-driven refresh: listens to `order:updated`, `order:item-added`, `tab:updated`, `payment:processed`
- 20s fallback polling only when socket is disconnected

### Liquor Inventory Management
- `LiquorInventory` component at `src/components/liquor/LiquorInventory.tsx`
- Displays bottle products organized by spirit category with tier badges (Well/Call/Premium/Top Shelf)
- Beer tier labels: DOM/IMP/CRFT/PREM+; Wine tier labels: HOUSE/GLASS/RESV/CELLR
- Container type display: Can, Btl, Draft, Glass
- Subtype classification with color-coded badges (domestic, import, craft for beer; red, white, rose for wine)
- Category and bottle create/edit modals inline

### Liquor Modifier Templates
- `LiquorModifiers` component at `src/components/liquor/LiquorModifiers.tsx`
- Manages reusable modifier groups with `modifierTypes: ['liquor']` (excludes spirit groups and linked-item groups)
- Left panel lists templates with active modifier count; right panel has inline `LiquorModifierGroupEditor`
- Create/delete groups via `POST/DELETE /api/menu/modifiers` and `/api/menu/modifiers/[id]`

### Inventory Deduction Details
- `processLiquorInventory()` batches all bottle product and inventory item lookups to minimize DB queries
- Uses Prisma's atomic `decrement` on `InventoryItem.currentStock` to prevent race conditions on concurrent payments
- Creates `InventoryItemTransaction` records for audit trail (type: `sale`, referenceType: `order`)
- Negative stock is allowed (soft warning only) — reconciled via count sheet at bar close
- `recordSpiritUpsells()` tracks upsell acceptance for analytics
- `getLiquorUsageSummary()` provides per-order pour cost breakdown

### Edge Cases & Business Rules
- Single-tier stacking ONLY — no spirit stacking by design
- Bottles from menu builder: `needsVerification: true` until admin reviews
- `containerType` supports: bottle, can, draft, glass
- Wine-specific: `alcoholSubtype` (red/white/rose/sparkling), `vintage` year
- Beer-specific: `alcoholSubtype` (domestic/import/craft/seltzer/na)
- Bottle → MenuItem is soft 1:1 (one bottle, one menu item)
- `InventoryItem.currentStock` (oz) is canonical; `BottleProduct.currentStock` is deprecated
- Inventory deduction is fire-and-forget — never blocks payment

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Pour size selection, spirit tier on order items |
| Reports | Liquor reports: pour cost %, bottle variance |
| Inventory | Bottle deductions on payment |
| Tabs | Bottle service tab with deposit pre-auth and minimum spend tracking |
| Payments | Bottle service deposit pre-auth via Datacap |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Liquor items are menu items with `categoryType: 'liquor'` |
| Modifiers | Spirit tier modifiers with `linkedMenuItemId` |
| Inventory | Bottle stock tracking |
| Payments | Payment triggers `processLiquorInventory()` for deductions |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Modifiers** — spirit tier and linked menu item interactions
- [ ] **Inventory** — bottle deduction calculations
- [ ] **Orders** — pour size and multiplier on order items
- [ ] **Menu** — `categoryType: 'liquor'` routing
- [ ] **Bottle Service** — deposit pre-auth, minimum spend, re-auth alerts

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
- Negative stock allowed at bar — reconciled via count sheet (soft warning only)
- Bottle service re-auth alert threshold: 80% of deposit amount
- `BottleProduct.currentStock` is deprecated — use `InventoryItem.currentStock` (oz) as canonical

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
- **Bottle service:** `docs/features/bottle-service.md`
- **Tabs:** `docs/features/tabs.md`

---

*Last updated: 2026-03-14*
