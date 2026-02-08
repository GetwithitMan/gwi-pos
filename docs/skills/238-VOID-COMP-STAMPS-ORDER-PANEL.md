# Skill 238: VOID/COMP Stamps on Order Panel

**Status:** PARTIAL (fix applied, needs verification)
**Date:** February 7, 2026
**Domain:** Orders

## Summary
Voided and comped items display visual stamps in the order panel with zeroed prices, strikethrough text, and waste tracking indicator.

## Visual Treatment
- **VOID stamp**: Red badge with border, item at 60% opacity, red background tint
- **COMP stamp**: Blue badge with border, item at 60% opacity, blue background tint
- **Price**: Shows $0.00 with original price struck through
- **Name**: Strikethrough with dimmed color
- **Waste indicator**: Shows "Was Made — Waste" or "Not Made — No Waste"
- **Void reason**: Displayed in details panel

## Data Pipeline
```
Schema (OrderItem.status/voidReason/wasMade)
  → API (order-response-mapper.ts)
    → Zustand store (order-store.ts loadOrder)
      → useOrderPanelItems hook
        → OrderPanelItem component
```

## Known Bug (Fixed, Needs Verification)
FloorPlanHome's `setInlineOrderItems` compatibility shim was **dropping** `status`, `voidReason`, and `wasMade` fields when syncing items from the API response to the Zustand store. The fields were mapped from the API but lost in:
1. `prevAsInline` mapping (line ~430) — didn't include the fields
2. `store.addItem()` call (line ~474) — didn't pass the fields
3. `store.updateItem()` call (line ~537) — didn't pass the fields

**Fix applied**: Added all three fields to `InlineOrderItem` interface, both API fetch mappings, `prevAsInline`, `addItem`, and `updateItem` calls.

## Files Modified
- `src/components/orders/OrderPanelItem.tsx` — VOID/COMP visual rendering
- `src/stores/order-store.ts` — Added status/voidReason/wasMade to OrderItem + LoadedOrderData
- `src/hooks/useOrderPanelItems.ts` — Pass through status fields
- `src/lib/api/order-response-mapper.ts` — Added voidReason/wasMade to response
- `src/components/floor-plan/FloorPlanHome.tsx` — Fixed shim to pass status fields
- `src/app/(pos)/orders/page.tsx` — handleCompVoidComplete reloads order

## Next Steps
- [ ] Verify VOID stamp renders on FloorPlanHome after fix
- [ ] Verify VOID stamp renders on BartenderView
- [ ] Verify VOID stamp renders on orders page
- [ ] Verify calculateTotals skips voided/comped items (currently sums all)
