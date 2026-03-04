# Feature: Menu Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Menu Management → read every listed dependency doc.

## Summary
Menu Management is the configuration backbone of the POS — it defines every sellable item, pricing tier, modifier workflow, and kitchen routing rule. Managers build categories (food, drinks, liquor, entertainment, combos, retail), add menu items with pricing/pour sizes/inventory links, and attach modifier groups with tiered pricing, stacking, and sub-modifiers. Changes propagate in real time via Socket.io to all terminals and Android clients.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, POS UI | Full |
| `gwi-android-register` | Menu browser, modifier modal, spirit tier quick-select | Full |
| `gwi-cfd` | Featured item display on idle screen | Partial |
| `gwi-backoffice` | Menu sync ingestion | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/menu` → `src/app/(admin)/menu/page.tsx` | Managers |
| POS Web | Menu grid in order panel (reads menu data) | All staff |
| Android | Menu browser, modifier modal, spirit tier quick-select | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/menu/route.ts` | GET full menu with categories and items |
| `src/app/api/menu/categories/route.ts` | GET/POST categories |
| `src/app/api/menu/categories/[id]/route.ts` | PUT/DELETE single category |
| `src/app/api/menu/items/route.ts` | POST create item |
| `src/app/api/menu/items/[id]/route.ts` | GET/PUT/DELETE single item |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | GET/POST item modifier groups (nested) |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | DELETE cascade with preview |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | Modifiers within group |
| `src/app/api/menu/items/[id]/modifiers/route.ts` | GET/POST modifier links with online visibility |
| `src/app/api/menu/items/[id]/ingredients/route.ts` | GET item ingredients with verification |
| `src/app/api/menu/items/[id]/recipe/route.ts` | GET/POST recipe components |
| `src/app/api/menu/items/[id]/pricing-options/route.ts` | Pricing option groups (size/variant) |
| `src/app/api/menu/items/[id]/pricing-options/[groupId]/options/route.ts` | Individual pricing options |
| `src/app/api/menu/items/[id]/pricing-options/[groupId]/options/[optionId]/inventory-links/route.ts` | Pricing option inventory links |
| `src/app/api/menu/items/[id]/inventory-recipe/route.ts` | Inventory recipe view |
| `src/app/api/menu/items/bulk/route.ts` | Bulk item operations |
| `src/app/api/menu/modifiers/route.ts` | GET/POST modifier groups |
| `src/app/api/menu/modifiers/[id]/route.ts` | PUT/DELETE single modifier group |
| `src/app/api/menu/search/route.ts` | Menu search |
| `src/app/(admin)/menu/page.tsx` | Menu admin page |
| `src/components/menu/ItemEditor.tsx` | Item editor with ingredient pickers |
| `src/components/menu/ModifierFlowEditor.tsx` | Modifier flow editor with tiered pricing |
| `src/components/menu/ItemTreeView.tsx` | Item hierarchy tree |
| `src/components/menu/RecipeBuilder.tsx` | Recipe component editor |
| `src/types/public-menu.ts` | Public menu API contracts |
| `src/lib/socket-dispatch.ts` | `dispatchMenuUpdate()` — menu change socket dispatches |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/menu` | Employee PIN | Full menu with categories and items |
| `GET/POST` | `/api/menu/categories` | Manager (POST) | Category CRUD |
| `PUT/DELETE` | `/api/menu/categories/[id]` | Manager | Single category update/delete |
| `POST` | `/api/menu/items` | Manager | Create menu item |
| `GET/PUT/DELETE` | `/api/menu/items/[id]` | Manager (PUT/DELETE) | Single item CRUD |
| `GET/POST` | `/api/menu/items/[id]/modifier-groups` | Manager | Item-owned modifier groups |
| `DELETE` | `/api/menu/items/[id]/modifier-groups/[groupId]` | Manager | Cascade delete with preview |
| `GET/POST` | `/api/menu/items/[id]/modifiers` | Manager | Modifier links |
| `GET` | `/api/menu/items/[id]/ingredients` | Employee PIN | Item ingredients |
| `GET/POST` | `/api/menu/items/[id]/recipe` | Manager | Recipe components |
| `GET/POST` | `/api/menu/items/[id]/pricing-options` | Manager | Pricing option groups |
| `GET/POST` | `/api/menu/modifiers` | Manager (POST) | Modifier group CRUD |
| `PUT/DELETE` | `/api/menu/modifiers/[id]` | Manager | Single modifier group |
| `POST` | `/api/menu/items/bulk` | Manager | Bulk operations |
| `GET` | `/api/menu/search` | Employee PIN | Menu search |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `menu:updated` | `{ locationId, ...menuData }` | Any menu item/category/modifier CRUD |
| `menu:item-changed` | `{ locationId, itemId, action }` | Granular item-level change (alongside `menu:updated`) |
| `menu:structure-changed` | `{ locationId, action }` | Granular structure change (category add/remove, alongside `menu:updated`) |

---

## Data Model

Key Prisma models:

```
Category {
  id, locationId, name, displayName, description, color, imageUrl
  categoryType    CategoryType    // food | drinks | liquor | entertainment | combos | retail
  sortOrder, isActive, showOnPOS, showOnline
  categoryShow    CategoryShow    // all | food | bar
  prepStationId, courseNumber, printerIds (Json), routeTags (Json)
  deletedAt                       // soft delete
}

MenuItem {
  id, locationId, categoryId, name, displayName, sku, imageUrl
  price           Decimal         // Cash/base price
  priceCC         Decimal?        // Credit card price (dual pricing)
  cost            Decimal?        // For profit tracking
  onlinePrice     Decimal?        // Online ordering override
  pourSizes       Json?           // { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 }
  defaultPourSize String?         // shot | double | tall | short
  itemType        MenuItemType    // standard | combo | timed | etc.
  trackInventory, currentStock, lowStockAlert, isAvailable
  routeTags       Json?           // Tag-based KDS routing
  deletedAt                       // soft delete
}

ModifierGroup {
  id, locationId, menuItemId?     // Item-owned (null = shared/legacy)
  name, modifierTypes (Json)      // ["universal"] | ["food","liquor"]
  minSelections, maxSelections, isRequired
  allowStacking   Boolean         // Tap same modifier twice for 2x
  tieredPricingConfig Json?       // flat_tiers or free_threshold
  exclusionGroupKey String?       // Prevents duplicate selections across groups
}

Modifier {
  id, locationId, modifierGroupId, name
  price           Decimal         // Upcharge amount
  linkedMenuItemId String?        // Spirit upgrades with price + inventory tracking
  ingredientId    String?         // Inventory deduction link
  childModifierGroupId String?    // Sub-modifier support
  allowNo, allowLite, allowOnSide, allowExtra  // Pre-modifier booleans
}
```

---

## Business Logic

### Primary Flow
1. Manager creates categories with a `categoryType` (food, drinks, liquor, entertainment, combos, retail)
2. Manager adds menu items to categories with pricing (base + optional CC price for dual pricing)
3. Manager attaches modifier groups to items (item-owned) with tiered pricing config
4. Manager creates modifiers in groups, optionally linking to other menu items (`linkedMenuItemId`) for spirit upgrades
5. `dispatchMenuUpdate()` fires `menu:updated` socket event to all terminals
6. POS and Android clients receive update and refresh menu data

### Edge Cases & Business Rules
- **Pour sizes**: Liquor items support `shot` (1.0x), `double` (2.0x), `tall` (1.5x), `short` (0.75x) multipliers on `MenuItem.pourSizes`
- **Modifier stacking**: `allowStacking: true` lets staff tap same modifier twice for 2x quantity
- **Linked items**: `Modifier.linkedMenuItemId` enables spirit upgrades — modifier uses linked item's price and tracks its inventory
- **Tiered pricing**: `flat_tiers` (all selections use tier price) or `free_threshold` (first N free, then modifier's own price)
- **Exclusion groups**: Groups sharing an `exclusionGroupKey` prevent duplicate modifier selections across groups on the same item
- **Category type routing**: `categoryType` determines item builder UI, modifier filtering, report grouping, and KDS routing
- **Online ordering overrides**: `hasOnlineOverride` enables separate modifier config for online orders
- **Cascade delete**: Deleting a modifier group cascades to all child modifiers with preview

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Item selection, pricing, modifier modal |
| KDS | Per-modifier print routing, tag-based station assignment |
| Inventory | Ingredient linking via `Modifier.ingredientId`, recipe components |
| Liquor Management | Liquor items = menu items with `categoryType: 'liquor'` |
| Combo Meals | Combo components are menu items |
| Entertainment | Entertainment items are menu items |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Category types, feature flags |
| Inventory | Ingredient linking for deduction |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does item/modifier change affect order creation or pricing?
- [ ] **KDS** — does routing tag change affect ticket distribution?
- [ ] **Inventory** — does ingredient link change affect deductions?
- [ ] **Permissions** — does this change affect who can edit menu?
- [ ] **Socket** — does this change require new/updated `menu:updated` payload?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View menu | `MENU_VIEW` | Standard |
| Create/edit items | `MENU_EDIT` | High |
| Delete items | `MENU_DELETE` | Critical |
| Edit modifiers | `MODIFIER_EDIT` | High |
| Edit pricing | `MENU_PRICING` | High |

---

## Known Constraints & Limits
- Modifier nesting depth is unlimited but deep nesting impacts KDS ticket display
- `categoryType` is immutable after items exist in the category (requires migration)
- Pour size multipliers apply to base price only unless `applyPourToModifiers` is enabled
- Menu scheduling (`availableFrom`/`availableTo`/`availableDays`) uses 24h format

---

## Android-Specific Notes
- Full menu browser with category grid and item list
- Modifier modal supports multi-level sub-modifiers
- Spirit tier quick-select for liquor items with pour size buttons
- Menu data synced via `/api/menu` GET on app launch and refreshed on `menu:updated` socket event

---

## Related Docs
- **Domain doc:** `docs/domains/MENU-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 03, 04, 41, 99, 100, 109, 129, 142, 143, 144, 208, 210, 212, 217, 233
- **Changelog:** `docs/changelogs/MENU-CHANGELOG.md`

---

*Last updated: 2026-03-03*
