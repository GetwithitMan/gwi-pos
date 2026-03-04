# Feature: Inventory Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Inventory → read every listed dependency doc.

## Summary
Inventory Management tracks ingredients, prep items, stock levels, recipes, and automatic deductions. When a customer pays for an order, `deductInventoryForOrder()` fires (fire-and-forget) to reduce ingredient stock based on recipe components and modifier links. The system supports vendor management, invoice tracking, daily counts, waste logging, 86 status (out-of-stock), and theoretical vs actual variance reporting for food cost analysis.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, deduction engine | Full |
| `gwi-android-register` | 86 status display, stock alerts | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Inventory reports aggregation | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/ingredients` → `src/app/(admin)/ingredients/page.tsx` | Managers |
| POS Web | 86 badge on menu items (read-only) | All staff |
| Android | 86 status indicator on menu items | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/inventory-calculations.ts` | Core deduction engine (sale + waste), modifier fallback paths |
| `src/lib/units.ts` | 50+ unit definitions, precision hints |
| `src/lib/unit-conversions.ts` | Weight/volume conversions, yield calculations |
| `src/lib/inventory/index.ts` | Barrel export: `deductInventoryForOrder` |
| `src/lib/inventory/order-deduction.ts` | Order-level deduction logic |
| `src/lib/liquor-inventory.ts` | `processLiquorInventory()` — liquor-specific deductions |
| `src/hooks/useIngredientLibrary.ts` | Business logic for ingredient library page |
| `src/hooks/useIngredientCost.ts` | Shared cost calculation hook |
| `src/hooks/useHierarchyCache.ts` | LRU cache with 5-min TTL for hierarchy data |
| `src/components/ingredients/IngredientHierarchy.tsx` | Hierarchy view with checkbox selection |
| `src/components/ingredients/IngredientLibrary.tsx` | Main library component |
| `src/components/ingredients/PrepItemEditor.tsx` | Prep item input/output editor |
| `src/components/ingredients/InventoryItemEditor.tsx` | Inventory item editor |
| `src/components/ingredients/BulkActionBar.tsx` | Bulk operations UI |
| `src/components/ingredients/DeletedItemsPanel.tsx` | Restore workflow |
| `src/app/(admin)/ingredients/page.tsx` | Ingredient library admin page |
| `src/app/api/ingredients/route.ts` | GET/POST ingredients |
| `src/app/api/ingredients/[id]/route.ts` | GET/PUT/DELETE single ingredient |
| `src/app/api/ingredients/[id]/cost/route.ts` | Cost per unit calculation |
| `src/app/api/ingredients/[id]/hierarchy/route.ts` | Full hierarchy tree |
| `src/app/api/ingredients/[id]/recipe-cost/route.ts` | Aggregated recipe cost |
| `src/app/api/ingredients/[id]/recipe/route.ts` | Ingredient recipe |
| `src/app/api/ingredients/bulk-parent/route.ts` | Bulk move to category |
| `src/app/api/ingredients/bulk-move/route.ts` | Bulk move operations |
| `src/app/api/inventory/route.ts` | Main inventory endpoint |
| `src/app/api/inventory/items/route.ts` | Inventory items CRUD |
| `src/app/api/inventory/items/[id]/route.ts` | Single inventory item |
| `src/app/api/inventory/stock-adjust/route.ts` | Stock adjustments with audit trail |
| `src/app/api/inventory/settings/route.ts` | Location inventory settings |
| `src/app/api/inventory/86-status/route.ts` | 86 status management |
| `src/app/api/inventory/86-status/bulk/route.ts` | Bulk 86 updates |
| `src/app/api/inventory/daily-counts/route.ts` | Daily count sessions |
| `src/app/api/inventory/daily-counts/[id]/route.ts` | Single count session |
| `src/app/api/inventory/daily-counts/[id]/submit/route.ts` | Submit count |
| `src/app/api/inventory/daily-counts/[id]/approve/route.ts` | Approve count |
| `src/app/api/inventory/vendors/route.ts` | Vendor management |
| `src/app/api/inventory/vendors/[id]/route.ts` | Single vendor |
| `src/app/api/inventory/invoices/route.ts` | Invoice tracking |
| `src/app/api/inventory/invoices/[id]/route.ts` | Single invoice |
| `src/app/api/inventory/prep/route.ts` | Prep items |
| `src/app/api/inventory/prep/[id]/route.ts` | Single prep item |
| `src/app/api/inventory/prep-items/route.ts` | Prep item list |
| `src/app/api/inventory/prep-tray-configs/route.ts` | Prep tray configurations |
| `src/app/api/inventory/prep-tray-configs/[id]/route.ts` | Single prep tray config |
| `src/app/api/inventory/waste/route.ts` | Waste logging |
| `src/app/api/inventory/waste/[id]/route.ts` | Single waste entry |
| `src/app/api/inventory/storage-locations/route.ts` | Storage locations |
| `src/app/api/inventory/storage-locations/[id]/route.ts` | Single storage location |
| `src/app/api/inventory/counts/route.ts` | Inventory counts |
| `src/app/api/inventory/counts/[id]/route.ts` | Single count |
| `src/app/api/inventory/transactions/route.ts` | Transaction history |
| `src/app/api/inventory/void-reasons/route.ts` | Void reason configuration |
| `src/app/api/inventory/void-reasons/[id]/route.ts` | Single void reason |
| `src/app/api/menu/items/[id]/ingredients/route.ts` | Menu item ingredient links |
| `src/app/api/menu/items/[id]/recipe/route.ts` | Menu item recipe components |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET/POST` | `/api/ingredients` | Manager | List/create ingredients |
| `GET/PUT/DELETE` | `/api/ingredients/[id]` | Manager | Single ingredient CRUD |
| `GET` | `/api/ingredients/[id]/cost` | Manager | Cost per unit |
| `GET` | `/api/ingredients/[id]/hierarchy` | Manager | Full hierarchy tree |
| `GET` | `/api/ingredients/[id]/recipe-cost` | Manager | Aggregated recipe cost |
| `POST` | `/api/ingredients/bulk-parent` | Manager | Bulk move to category |
| `GET/POST` | `/api/inventory/items` | Manager | Inventory items |
| `POST` | `/api/inventory/stock-adjust` | Manager | Stock adjustment with audit |
| `GET/POST` | `/api/inventory/settings` | Manager | Inventory settings |
| `GET/POST` | `/api/inventory/86-status` | Employee PIN | 86 status |
| `POST` | `/api/inventory/86-status/bulk` | Manager | Bulk 86 updates |
| `GET/POST` | `/api/inventory/daily-counts` | Manager | Daily count sessions |
| `POST` | `/api/inventory/daily-counts/[id]/submit` | Employee PIN | Submit count |
| `POST` | `/api/inventory/daily-counts/[id]/approve` | Manager | Approve count |
| `GET/POST` | `/api/inventory/vendors` | Manager | Vendor management |
| `GET/POST` | `/api/inventory/invoices` | Manager | Invoice tracking |
| `GET/POST` | `/api/inventory/waste` | Employee PIN | Waste logging |
| `GET/POST` | `/api/inventory/void-reasons` | Manager | Void reason config |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| None | — | Inventory deductions are fire-and-forget post-payment; no dedicated socket events |

**Note:** 86 status changes propagate via `menu:updated` since `MenuItem.isAvailable` is the source of truth.

---

## Data Model

Key Prisma models:

```
Ingredient {
  id, locationId, name, description, categoryId
  inventoryItemId  String?   // Links to InventoryItem for stock tracking
  prepItemId       String?   // Links to PrepItem for made-in-house items
  standardQuantity Decimal?  // e.g., 1.5
  standardUnit     String?   // "oz", "slice", "each"
  sourceType       String    // "delivered" | "made"
  purchaseUnit, purchaseCost, unitsPerPurchase  // Vendor purchase info
  allowNo, allowLite, allowExtra, allowOnSide   // Customer customizations
  extraPrice       Decimal   // Upcharge for "Extra"
  liteMultiplier   Decimal   // 0.5 default
  extraMultiplier  Decimal   // 2.0 default
}

InventoryItem {
  id, locationId, name, sku
  department       String    // "Food", "Beverage", "Retail" — for P&L COGS split
  itemType         String    // "food", "liquor", "beer", "wine", "supply"
  revenueCenter    String    // "kitchen", "bar"
  category, subcategory, brand
}

StockAlert {
  id, locationId, menuItemId
  alertType        String    // low_stock, out_of_stock, reorder
  currentStock, threshold
  status           StockAlertStatus  // active, acknowledged, resolved
}

PrepItem {
  id, locationId, name
  // Input → output transformation (e.g., whole chicken → chicken breast portions)
}
```

---

## Business Logic

### Primary Flow — Auto-Deduction on Payment
1. Customer pays for order → payment API fires
2. `deductInventoryForOrder(orderId)` called fire-and-forget (NEVER blocks payment)
3. For each order item: resolve recipe components via `MenuItemIngredient` → `Ingredient`
4. For each modifier: check `Modifier.ingredientId` for direct ingredient link
5. Apply pre-modifier multipliers (lite = 0.5x, extra = 2.0x)
6. Deduct from `InventoryItem` stock
7. `processLiquorInventory()` handles liquor-specific pour-size deductions separately

### Void/Comp Reversal
1. When item is voided, deductions are reversed (stock added back)
2. `VoidReason.deductInventory` flag controls whether void still deducts (e.g., "Kitchen Error - Made" = food wasted, still deduct)

### Edge Cases & Business Rules
- **NEVER block payment on inventory** — deductions are always fire-and-forget
- Void reverses deductions unless `VoidReason.deductInventory` is true
- Dual pricing impacts cost per unit calculations
- 86 status sets `MenuItem.isAvailable = false` → item hidden/greyed on POS
- Daily counts: submit → manager approve workflow for physical count reconciliation
- Theoretical vs actual variance = (theoretical usage from recipes) - (actual counted stock)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Menu | Ingredient linking, 86 status affects item availability |
| Reports | PMIX food cost, theoretical vs actual variance |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Auto-deduction triggered on payment |
| Menu | Ingredient linked to modifier/item |
| Settings | Units of measure configuration |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — deduction MUST remain fire-and-forget
- [ ] **Menu** — does ingredient link change affect menu item pricing?
- [ ] **Reports** — does deduction logic change affect PMIX/variance reports?
- [ ] **Offline** — deductions must work with local PG only

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View inventory | `INVENTORY_VIEW` | Standard |
| Adjust stock | `INVENTORY_ADJUST` | High |
| 86 items | `INVENTORY_86` | Standard |
| Approve counts | `INVENTORY_APPROVE` | High |
| Manage vendors | `INVENTORY_VENDOR` | High |

---

## Known Constraints & Limits
- `processLiquorInventory()` can trigger 30+ queries per cocktail order — batching optimization pending
- Deduction engine has modifier fallback paths for legacy data without `ingredientId`
- LRU cache with 5-min TTL for hierarchy data to avoid repeated deep queries
- Weight-based items use `soldByWeight` + `pricePerWeightUnit` on MenuItem

---

## Android-Specific Notes
- 86 status badge displayed on menu items when `isAvailable = false`
- Stock alert notifications shown to managers
- No direct inventory management UI on Android — admin only via web

---

## Related Docs
- **Domain doc:** `docs/domains/INVENTORY-DOMAIN.md`
- **Architecture guide:** `docs/guides/ARCHITECTURE-RULES.md`
- **Skills:** Skill 37, 38, 39, 125, 126, 127, 204, 205, 211, 213, 214, 215, 216
- **Changelog:** `docs/changelogs/INVENTORY-CHANGELOG.md`

---

*Last updated: 2026-03-03*
