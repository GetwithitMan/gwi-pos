# Feature: Modifiers

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Modifiers allow optional additions, customizations, and upgrades to menu items. Supports pre-modifications (no/lite/extra/side), stacking (tap twice for 2x), spirit tier upgrades via linked menu items, tiered pricing, nested child groups, per-modifier print routing, and multi-channel visibility (POS/online).

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, POS UI, business logic | Full |
| `gwi-android-register` | Full modifier modal with multi-select, stacking | Full |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | ModifierModal (opens when tapping item with groups) | All staff |
| Admin | `/menu` → Item Editor → Modifier Groups | Managers |
| Android | ModifierModal (full multi-select, stacking, spirit tier) | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/menu/modifiers/route.ts` | Global modifier group CRUD |
| `src/app/api/menu/modifiers/[id]/route.ts` | Single group GET/PUT/DELETE |
| `src/app/api/menu/items/[id]/modifier-groups/route.ts` | Item-owned groups CRUD, copy, deep duplicate |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/route.ts` | Reparent/move group in hierarchy |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | Create/update/delete modifiers in group |
| `src/app/api/menu/items/[id]/modifiers/route.ts` | Ordering endpoint (channel-filtered, top-level only) |
| `src/app/api/orders/[id]/items/[itemId]/modifiers/route.ts` | Update modifiers on existing order item |
| `src/components/modifiers/ModifierModal.tsx` | Order entry modifier picker |
| `src/components/modifiers/ModifierGroupSection.tsx` | Single group renderer |
| `src/components/modifiers/useModifierSelections.ts` | Selection state and logic hook |
| `src/components/modifiers/SwapPicker.tsx` | Ingredient swap UI |
| `src/components/modifiers/IngredientsSection.tsx` | Ingredient modifications |
| `src/lib/socket-dispatch.ts` | `dispatchMenuStructureChanged()` emits `menu:structure-changed` |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/menu/modifiers` | Employee PIN | List all global modifier groups with modifiers |
| `POST` | `/api/menu/modifiers` | Manager | Create global modifier group |
| `GET` | `/api/menu/modifiers/[id]` | Employee PIN | Get single group with modifiers + child groups |
| `PUT` | `/api/menu/modifiers/[id]` | Manager | Update group and nested modifiers (batch upsert) |
| `DELETE` | `/api/menu/modifiers/[id]` | Manager | Soft-delete group (cascade to modifiers) |
| `GET` | `/api/menu/items/[id]/modifier-groups` | Employee PIN | Fetch all item-owned groups (full hierarchy) |
| `POST` | `/api/menu/items/[id]/modifier-groups` | Manager | Create item-owned group (supports template, copy) |
| `PATCH` | `/api/menu/items/[id]/modifier-groups` | Manager | Bulk update sort orders |
| `PUT` | `/api/menu/items/[id]/modifier-groups` | Manager | Reparent a group (move between hierarchy levels) |
| `GET` | `/api/menu/items/[id]/modifiers` | Employee PIN | POS ordering endpoint (channel-filtered, top-level) |
| `POST` | `/api/menu/items/[id]/modifier-groups/[groupId]/modifiers` | Manager | Add modifier to group |
| `PUT` | `/api/menu/items/[id]/modifier-groups/[groupId]/modifiers` | Manager | Update modifier in group |
| `DELETE` | `/api/menu/items/[id]/modifier-groups/[groupId]/modifiers` | Manager | Soft-delete modifier |
| `PUT` | `/api/orders/[id]/items/[itemId]/modifiers` | Employee PIN | Update modifiers on order item (resend) |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `menu:structure-changed` | `{ action, entityId, entityType }` | Modifier group or modifier created/updated/deleted |

---

## Data Model

```
ModifierGroup {
  id                  String
  locationId          String
  menuItemId          String?           // null = global/shared, set = item-owned
  name                String
  modifierTypes       Json              // ["universal", "food", "liquor", "retail", "entertainment", "combo"]
  minSelections       Int               // 0 = optional
  maxSelections       Int               // 1 = single-select
  isRequired          Boolean
  allowStacking       Boolean           // tap same modifier twice for 2x
  tieredPricingConfig Json?             // { mode: "flat_tiers"|"free_threshold", tiers: [...] }
  exclusionGroupKey   String?           // cross-group duplicate prevention
  isSpiritGroup       Boolean           // liquor spirit selection
  hasOnlineOverride   Boolean
  sortOrder           Int
  deletedAt           DateTime?
}

Modifier {
  id                    String
  modifierGroupId       String
  name                  String
  price                 Decimal           // base upcharge
  priceType             Enum              // upcharge | override | from_item
  allowNo/Lite/Extra/OnSide  Boolean     // pre-modifier flags
  extraPrice            Decimal           // price when "extra" selected
  liteMultiplier        Decimal?          // null = location default 0.5x
  extraMultiplier       Decimal?          // null = location default 2.0x
  ingredientId          String?           // auto-deduct ingredient on order
  childModifierGroupId  String?           // nested sub-modifiers
  linkedMenuItemId      String?           // spirit upgrades — price + reporting from item
  spiritTier            String?           // well | call | premium | top_shelf
  linkedBottleProductId String?           // bottle inventory link
  pourSizeOz            Decimal?          // pour size override
  printerRouting        Enum              // follow | also | only
  printerIds            Json?             // array of printer IDs
  commissionType        String?           // fixed | percent
  commissionValue       Decimal?
  showOnPOS             Boolean
  showOnline            Boolean
  isDefault             Boolean
  isLabel               Boolean           // grouping header only
  deletedAt             DateTime?
}

OrderItemModifier {
  id                    String
  orderItemId           String
  modifierId            String?
  name                  String            // snapshot at time of sale
  price                 Decimal           // actual price charged
  preModifier           String?           // "no", "lite", "extra", "side"
  depth                 Int               // 0=top, 1=child, 2=grandchild
  quantity              Int
  linkedMenuItemId      String?           // snapshot for reporting
  spiritTier            String?
  deletedAt             DateTime?
}
```

---

## Business Logic

### Primary Flow
1. Manager configures modifier groups on menu item (admin UI)
2. Server taps menu item in POS → ModifierModal opens
3. Modal loads groups via `GET /api/menu/items/[id]/modifiers` (channel-filtered)
4. Server selects modifiers (single-select, multi-select, or stacking)
5. Pre-modifiers applied: no/lite/extra/side (compound strings like "side,extra")
6. For spirit groups: tier quick-select (well/call/premium/top shelf)
7. Pour size selected if liquor item (shot 1.0x, double 2.0x, tall 1.5x, short 0.75x)
8. On confirm → modifiers added to order item with price calculations
9. `menu:structure-changed` socket event refreshes all terminals

### Modifier Type Colors
| Type | Color | Applies To |
|------|-------|------------|
| `universal` | Gray | All item types |
| `food` | Green | Food items |
| `liquor` | Purple | Liquor/drinks |
| `retail` | Amber | Retail items |
| `entertainment` | Orange | Entertainment |
| `combo` | Pink | Combo meals |

### Edge Cases & Business Rules
- **Stacking**: `allowStacking: true` → same modifier selectable multiple times (quantity increments)
- **Tiered pricing**: groups support `flat_tiers` or `free_threshold` modes based on selection count
- **Exclusion rules**: groups with same `exclusionGroupKey` prevent duplicate selections across groups
- **Linked menu items**: `linkedMenuItemId` tracks sales against actual menu item (spirit upgrades)
- **Pre-modifier compounds**: "no" is exclusive (cannot combine), others can combine: "side,extra"
- **Child groups**: `childModifierGroupId` enables nested selections (depth 0→1→2)
- **Channel visibility**: `showOnPOS`/`showOnline` filter per ordering channel
- **Print routing**: `follow` (with item), `also` (item + specific printers), `only` (specific printers only)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Modifier selection on order items; modifiers affect item price |
| KDS | Modifier display depth on kitchen tickets |
| Liquor | Pour size + spirit tier modifiers |
| Pizza Builder | Topping modifiers use modifier groups |
| Inventory | `ingredientId` on modifier triggers auto-deduction |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Modifier groups attach to menu items |
| Inventory | Modifier ingredients linked to stock |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — modifier price changes affect order totals
- [ ] **KDS** — modifier display depth and print routing
- [ ] **Inventory** — ingredient deduction on modifier selection
- [ ] **Liquor** — spirit tier and pour size interactions
- [ ] **Permissions** — menu editing permissions gate modifier management
- [ ] **Socket** — `menu:structure-changed` event consumed by all terminals

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View modifiers (ordering) | Employee PIN | Standard |
| Create/Edit/Delete modifiers | Manager role | High |

---

## Known Constraints & Limits
- `maxSelections` enforced when setting `isDefault: true` — cannot exceed group limit
- Orphaned `childModifierGroupId` references auto-cleaned in background on admin fetch
- Pre-modifier "no" is exclusive — cannot combine with lite/extra/side
- `depth` field tracks nesting: 0=top, 1=child, 2=grandchild (3+ levels not tested)

---

## Android-Specific Notes
- Full modifier modal with multi-select and stacking support
- Spirit tier quick-select UI for liquor groups
- Pour size selection (shot/double/tall/short)
- Touch targets min 48x48dp for modifier buttons

---

## Related Docs
- **Domain doc:** `docs/domains/MENU-DOMAIN.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Modifiers row
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 4, 99, 100, 129, 142, 143, 208, 210, 212, 217, 233

---

*Last updated: 2026-03-03*
