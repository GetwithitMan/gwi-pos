# Skill 237: Waste Tracking — "Was It Made?"

**Status:** DONE
**Date:** February 7, 2026
**Domain:** Orders / Inventory

## Summary
Added explicit "Was it made?" question to void flow for accurate waste/loss tracking in reports. Replaces the previous approach of guessing waste status from the void reason text.

## Problem
When voiding items, the system guessed whether the item was made (and thus a waste) based on the reason text (e.g., "kitchen_error" = waste). This was unreliable and didn't capture the actual situation.

## Solution

### UI Changes (CompVoidModal)
- After selecting void reason, user must answer "Was this item already made?"
- Two buttons: "Yes, it was made / Count as waste" and "No, not made / No waste"
- Submit button disabled until answered
- Comps always set `wasMade: true` (food was served)
- Reset wasMade when switching between comp/void actions

### Schema Changes
- Added `wasMade Boolean?` to `OrderItem` model
- Added `wasMade Boolean @default(false)` to `VoidLog` model

### API Changes (comp-void route)
- Accepts explicit `wasMade` boolean from request body
- Stores on both OrderItem and VoidLog records
- Uses explicit `wasMade` when provided, falls back to reason-based detection
- Improved error logging (returns actual error message instead of generic)

## Files Modified
- `src/components/orders/CompVoidModal.tsx` — Added wasMade UI
- `src/app/api/orders/[id]/comp-void/route.ts` — wasMade in request, stores on OrderItem + VoidLog
- `prisma/schema.prisma` — Added wasMade to OrderItem and VoidLog

## Inventory Impact
- `wasMade: true` → `deductInventoryForVoidedItem()` runs (waste transaction)
- `wasMade: false` → `restorePrepStockForVoid()` runs (prep stock restored)
- Previous behavior: guessed from reason text via `WASTE_VOID_REASONS` list
