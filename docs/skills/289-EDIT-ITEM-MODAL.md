# Skill 289: Edit Item Modal (ItemSettingsModal)

**Domain:** Menu
**Status:** DONE
**Date:** February 11, 2026
**Dependencies:** Skill 217 (Legacy ItemModal Cleanup)

## Problem

When Skill 217 removed the legacy ItemModal (1,141 lines), no replacement editing UI was provided. Items created in the Menu Builder were stuck as "New Item" at $0.00 with no way to change name, price, description, or any other settings.

## Solution

Created `ItemSettingsModal` — a comprehensive Edit Item modal accessible from the ItemEditor header.

### Features

**5 Tabs:**
| Tab | Fields |
|-----|--------|
| Basics | Name, Price, Card Price (read-only), Description, SKU, Image upload, Active toggle, **Ingredient Cost Breakdown** (collapsible) |
| Display & Channels | Kitchen Chit Name, Show on POS, Show on Online Ordering |
| Kitchen & Print | Prep Time, Default Course # |
| Availability | Time window (from/to), Available days |
| Tax & Commission | Tax rate override, Tax exempt, Commission type/value |

**Ingredient Cost Breakdown (read-only, collapsible):**
- Lists all included ingredients with per-ingredient cost
- Shows total cost, food cost %, gross profit when cost data available
- Collapsed by default — header shows total cost or ingredient count
- Fetches from `/api/menu/items/[id]/inventory-recipe` first, falls back to `/api/menu/items/[id]/ingredients` + per-ingredient `/api/ingredients/[id]/cost`
- Gracefully handles missing cost data with placeholder dashes

**Card Price:**
- Read-only display (auto-calculated from cash discount settings)
- Not editable — prevents manual override conflicts
- As of commit `8394777`, the Basics tab shows the actual calculated card price (e.g., "$10.40") instead of the previous "Auto from cash discount" placeholder text. Weight-based price also shows its card equivalent.

**Image Upload:**
- Drag-and-drop or click to select
- JPEG, PNG, WebP, GIF supported (max 5MB)
- UUID filenames prevent collisions
- Preview with remove button

**Auto-open for new items:**
- When item name is "New Item" and price is 0, modal opens automatically

**Live sync:**
- After save, `onSaved` callback triggers `loadMenu()` which refreshes the menu
- useEffect in menu/page.tsx syncs `selectedItemForEditor` when items array updates

## Files Created
- `src/components/menu/ItemSettingsModal.tsx` — Edit Item modal component (~420 lines)
- `src/app/api/upload/route.ts` — Image upload API endpoint
- `public/uploads/menu-items/` — Upload directory

## Files Modified
- `src/components/menu/ItemEditor.tsx` — Added "Edit Item" button + modal render + auto-open logic
- `src/app/api/menu/items/[id]/route.ts` — Extended GET/PUT with all item fields
- `src/app/(admin)/menu/page.tsx` — Added useEffect to sync selectedItemForEditor on items refresh

## API Changes

**GET `/api/menu/items/[id]`** — Now returns:
- `displayName`, `sku`, `imageUrl`, `showOnPOS`, `showOnline`
- `taxRate`, `isTaxExempt`, `prepTime`, `courseNumber`
- `commissionType`, `commissionValue`
- `availableFrom`, `availableTo`, `availableDays`

**PUT `/api/menu/items/[id]`** — Now accepts all above fields

**POST `/api/upload`** — New endpoint:
- Accepts FormData with `file` field
- Returns `{ url: '/uploads/menu-items/uuid.ext' }`
