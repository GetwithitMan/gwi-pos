# Skill 367: Dynamic Order Type Tabs & Table Selection Enforcement

## Status: DONE
## Domain: Orders, UI
## Dependencies: 358 (Unified POS Header), 09 (Features & Config)

## Summary

Replaced hardcoded header tabs (Tables | Takeout | Delivery | Bar Mode) with dynamic tabs from admin-configured order types. Enforces table selection for dine_in before allowing item addition. Renamed "Bar Mode" to "Bar". Supports mode switching with order type conversion.

## What Changed

### Dynamic Header Tabs
- `UnifiedPOSHeader.tsx` renders tabs from `orderTypes` prop (fetched from `/api/order-types`)
- `dine_in` → displays as "Tables", `bar_tab` → displays as "Bar", others → `ot.name`
- `NavTab` enhanced with `accentColor` prop for per-type hex colors from admin config
- Falls back to hardcoded defaults if no order types configured

### Table Selection Enforcement
- `FloorPlanHome.tsx` derives `tableRequiredButMissing` from order type's `workflowRules.requireTableSelection`
- Blocks `handleCategoryClick` and `handleQuickBarItemClick` with toast warning
- Shows "Tap a table to start an order" overlay in order panel when no table selected
- Send button guard validates table and customer name requirements

### Order Type Conversion on Mode Switch
- `order-store.ts` `updateOrderType()` supports explicit field clearing via `'in' checks`
- Switching from dine_in to takeout detaches table (`tableId: null, tableName: null`)

### Tables Tab Active State Fix
- `isTablesActive` now includes `activeOrderType === 'dine_in'` (was only `!activeOrderType`)

## Key Files

| File | Changes |
|------|---------|
| `src/hooks/useOrderTypes.ts` | NEW — Fetch order types hook with SYSTEM_ORDER_TYPES fallback |
| `src/components/orders/UnifiedPOSHeader.tsx` | Dynamic tabs, NavTab accentColor, isTablesActive fix |
| `src/components/floor-plan/FloorPlanHome.tsx` | Table enforcement, overlay, item blocking, widened QuickOrderType |
| `src/stores/order-store.ts` | updateOrderType explicit field clearing |
| `src/app/(pos)/orders/page.tsx` | Wire orderTypes to header and FloorPlanHome |

## Admin Configuration

Order types are configured at `/settings/order-types`. Each type has:
- `workflowRules.requireTableSelection` — Enforces table selection (dine_in default: true)
- `workflowRules.requireCustomerName` — Enforces name entry (bar_tab default: true)
- `color` — Hex color for tab accent
- `icon` — Icon name for tab display
- `fieldDefinitions` — Custom fields (phone, address, etc.)

## Verification

1. Tables tab highlights when active (dine_in or no order type)
2. Custom order types from admin appear as tabs with correct colors
3. Table selection required for dine_in — items blocked until table selected
4. Takeout/delivery items addable immediately
5. Bar tab switches to bartender view
6. Mode switch preserves items, detaches table
