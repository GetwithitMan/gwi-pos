# Skill 454: Pricing Options — Size Variants for Food Items

**Date:** 2026-02-27
**Status:** DONE

## Overview

Added size variant pricing for food menu items. Items can now have up to 4 size options (S/M/L, Bowl/Cup) that replace the base price. Each size links to prep items for proper inventory deduction and cost tracking. Includes a `costAtSale` snapshot for historically accurate food cost reports.

## Schema Changes

### New Field on OrderItem
- `costAtSale Decimal?` — Total ingredient cost (base recipe + pricing option links) snapshotted at time of order
- `@@index([menuItemId, pricingOptionId])` — Composite index for report grouping performance

### Models (created in prior phase, now fully wired)
- `PricingOptionGroup` — Groups options per item (name, sortOrder, isRequired, showAsQuickPick)
- `PricingOption` — Individual option (label, price, priceCC, isDefault, color)
- `PricingOptionInventoryLink` — Links an option to a PrepItem or InventoryItem (usageQuantity, usageUnit, calculatedCost)

## Menu Builder UI

### Basics Tab — "Enable Size Options" Toggle
- Located after price fields, before sold-by-weight section
- When toggled ON: creates a single "Sizes" PricingOptionGroup (showAsQuickPick=false)
- Shows inline size rows: label + price + color dot
- Base price field dims with note "Base price overridden by size options"
- "Add Size" button, max 4 enforced in UI
- When toggled OFF: deletes the non-quick-pick group, re-enables base price

Component: `SizingOptionsInline.tsx` (new)

### Inventory Linking per Size
- Each size row has a collapsible "Link Inventory ▸" section
- Shows linked prep items with name, editable quantity/unit, calculated cost, remove button
- "Add Prep Item" opens the IngredientHierarchyPicker (reused from recipe builder)
- Supports inline creation of categories, inventory items, and prep items
- Total cost displayed at bottom

Component: `PricingOptionInventoryLinker.tsx` (new, 497 lines)

## API Routes

### Inventory Link CRUD (new)
```
GET    /api/menu/items/{id}/pricing-options/{groupId}/options/{optionId}/inventory-links
POST   /api/menu/items/{id}/pricing-options/{groupId}/options/{optionId}/inventory-links
PUT    /api/menu/items/{id}/pricing-options/{groupId}/options/{optionId}/inventory-links/{linkId}
DELETE /api/menu/items/{id}/pricing-options/{groupId}/options/{optionId}/inventory-links/{linkId}
```

- POST auto-calculates `calculatedCost` from linked item's `costPerUnit × usageQuantity`
- All routes use `withVenue()`, `getLocationId()`, soft-delete, cache invalidation, socket dispatch
- Full ownership chain verification (link → option → group → menuItem → location)

### Max 4 Enforcement (server-side)
- `POST .../options/route.ts` — Counts existing options, rejects if >= 4
- `POST .../pricing-options/route.ts` — Validates inline options array length

## Cost Snapshot (costAtSale)

### Fire-and-forget calculation
In `POST /api/orders/{id}/items` (items/route.ts):
1. After creating order items, calculates cost asynchronously
2. Sums food recipe ingredients (bottleProduct.pourCost × pourCount)
3. If pricingOptionId set, adds pricing option inventory link costs via `calculateVariantCost()`
4. Updates `OrderItem.costAtSale` — null on failure (reports handle gracefully)

### Sync
- Delta endpoint returns `costAtSale` as Number (Decimal→Number conversion)

## Inventory Deduction Flow

```
Order "Bowl of Chicken Soup" paid →
  1. Base recipe deduction (shared ingredients — seasoning, etc.)
  2. PricingOptionInventoryLink deduction (Bowl Prep × 1 each → explodes Bowl Prep recipe)
  3. costAtSale = base recipe cost + Bowl Prep cost (snapshotted)
```

The deduction engine (order-deduction.ts) already processes PricingOptionInventoryLink additively on top of the base recipe.

## POS Integration

### FloorPlanMenuItem Quick Pick Buttons
- Size options with `showAsQuickPick=false` → opens PricingOptionPicker modal on tap
- Quick picks with `showAsQuickPick=true` → inline sub-buttons on item cards
- Both limited to 4 options via `.slice(0, 4)`

### BartenderView
- Fully wired: `onOpenPricingOptionPicker` callback + PricingOptionPicker modal
- Quick pick button row after hot modifiers section

### useOrderingEngine
- `handleMenuItemTap` detects pricing options, opens picker for non-quick-pick groups
- `addItemDirectly` accepts `pricingOptionId` + `pricingOptionLabel`
- Variant options override item price; label-only options keep base price

## Reports

### PMIX (product-mix/route.ts)
- Groups by composite key: `menuItemId::pricingOptionLabel` (falls back to plain menuItemId)
- Shows "Pizza (Large)" and "Pizza (Small)" as separate line items
- Uses `costAtSale` for food cost % when available

### Sales (sales/route.ts)
- Same composite grouping key
- pricingOptionLabel included in response data

### Daily (daily/route.ts)
- No changes needed — category-level totals only, no item breakdown

## Android

### Room Entities
- `PricingOptionGroupEntity` + `PricingOptionEntity` (new, created in prior phase)
- `PricingOptionDao` with upsert-then-prune (new)
- `CachedOrderItemEntity` — added `pricingOptionId`, `pricingOptionLabel`, `costAtSale` (Long cents)

### Sync
- Bootstrap + delta sync pricing option groups with options
- ServerOrderMapper maps costAtSale to Long cents
- DB version 21 (destructive migration)

### UI
- `PricingOptionSheet` — ModalBottomSheet for size selection
- `MenuItemCard` — PricingOptionButtonRow for quick pick sub-buttons
- OrderViewModel — batch loads pricing options, manages sheet state

## Files Changed

### New Files (POS)
| File | Lines | Purpose |
|------|-------|---------|
| `SizingOptionsInline.tsx` | ~120 | Basics tab size toggle + inline rows |
| `PricingOptionInventoryLinker.tsx` | ~497 | Prep item linking per size option |
| `QuickPickTab.tsx` | ~80 | Quick Pick tab (showAsQuickPick=true only) |
| `PricingOptionGroupEditor.tsx` | ~141 | Group card editor |
| `PricingOptionRow.tsx` | ~160 | Option row (label, price, color, default) |
| `usePricingOptions.ts` | ~205 | CRUD hook with optimistic updates |
| `PricingOptionPicker.tsx` | ~70 | POS modal for size selection |
| `inventory-links/route.ts` | ~180 | GET+POST for inventory links |
| `inventory-links/[linkId]/route.ts` | ~120 | PUT+DELETE for inventory links |

### New Files (Android)
| File | Purpose |
|------|---------|
| `PricingOptionGroupEntity.kt` | Room entity |
| `PricingOptionEntity.kt` | Room entity (Long cents) |
| `PricingOptionDao.kt` | DAO with upsert-then-prune |
| `PricingOptionSheet.kt` | Compose ModalBottomSheet |

### Modified Files (POS) — 23 files
Key changes: schema.prisma, ItemSettingsModal, ItemEditor, BartenderView, FloorPlanHome, FloorPlanMenuItem, useOrderingEngine, order-store, order-utils, order-deduction, recipe-costing, kitchen print route, PMIX report, sales report, items route, menu route, bootstrap routes, sync routes

### Modified Files (Android) — 12 files
Key changes: AppDatabase (v21), CachedOrderItemEntity, OrderDtos, ServerOrderMapper, SyncDto, DtoMappers, BootstrapWorker, SyncWorker, DatabaseModule, OrderViewModel, MenuItemCard, MenuGrid, OrderScreen

## Dependencies
- Skill 125 (Ingredient Costing & Recipes) — recipe cost calculations
- Skill 211 (Hierarchical Ingredient Picker) — reused in PricingOptionInventoryLinker
- Skill 215 (Unified Modifier Inventory Deduction) — deduction engine pattern
- Skill 289 (Edit Item Modal) — ItemSettingsModal extended with new tab + Basics section
