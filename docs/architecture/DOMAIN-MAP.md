# GWI POS Domain Map
## Mapping Existing Files to Target Domains

**Version:** 1.1
**Date:** 2026-02-07
**Status:** ACTIVE

This document maps every significant file/folder in the current codebase to its target domain architecture (16 domains).

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `->` | Maps to domain |
| `[SPLIT]` | File needs to be split across domains |
| `[SHARED]` | Stays in shared utilities |
| `[DELETE]` | Can be removed (deprecated, backup, etc.) |
| `[REVIEW]` | Needs manual review |

---

## Domain Reference

| # | Domain | Code | Trigger | Description |
|---|--------|------|---------|-------------|
| 1 | Floor Plan | FP | `PM Mode: Floor Plan` | Tables, seats, groups, waitlist |
| 2 | Inventory | IN | `PM Mode: Inventory` | Stock, purchasing, waste, counts |
| 3 | Orders | OM | `PM Mode: Orders` | Tickets, items, kitchen routing |
| 4 | Menu | MN | `PM Mode: Menu` | Items, categories, modifiers, combos |
| 5 | Employees | EM | `PM Mode: Employees` | Profiles, scheduling, time clock, payroll |
| 6 | KDS | KD | `PM Mode: KDS` | Kitchen display system, stations |
| 7 | Payments | PM | `PM Mode: Payments` | Payment processing, tips, receipts |
| 8 | Reports | RP | `PM Mode: Reports` | Sales, labor, trends, exports |
| 9 | Hardware | HW | `PM Mode: Hardware` | Terminals, printers, card readers |
| 10 | Settings | ST | `PM Mode: Settings` | Location settings, order types, tax |
| 11 | Entertainment | EN | `PM Mode: Entertainment` | Timed rentals, sessions, pricing |
| 12 | Guest | GU | `PM Mode: Guest` | Profiles, loyalty, reservations |
| 13 | Events | EV | `PM Mode: Events` | Event creation, ticketing, check-in |
| 14 | Financial | FN | `PM Mode: Financial` | Gift cards, house accounts, discounts |
| 15 | Development-RnD | RD | `PM Mode: Development-RnD` | Prototypes, research, technical spikes |
| 16 | Error Reporting | ER | `PM Mode: Error Reporting` | Error tracking, monitoring, alerts |

---

## 1. App Router Pages (`src/app/`)

### 1.1 Admin Pages (`src/app/(admin)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `86/` | IN | 86'd items status |
| `combos/` | MN | Combo deals |
| `coupons/` | FN | Coupon management |
| `customers/` | GU | Customer profiles |
| `discounts/` | FN | Discount rules |
| `employees/` | EM | Employee management |
| `employees/[id]/payment/` | EM | Employee payment details |
| `events/` | EV | Event management |
| `floor-plan/` | FP | Floor plan editor |
| `gift-cards/` | FN | Gift card management |
| `house-accounts/` | FN | House accounts |
| `ingredients/` | IN | Ingredient library |
| `inventory/` | IN | Inventory dashboard |
| `inventory/beverages/` | IN | Beverage inventory |
| `inventory/counts/` | IN | Inventory counts |
| `inventory/daily-prep-counts/` | IN | Daily prep counts |
| `inventory/items/` | IN | Inventory items |
| `inventory/quick-adjust/` | IN | Quick stock adjust |
| `inventory/settings/` | IN | Inventory settings |
| `inventory/transactions/` | IN | Stock transactions |
| `inventory/vendors/` | IN | Vendor management |
| `inventory/waste/` | IN | Waste logging |
| `links/` | [SHARED] | Admin quick links |
| `liquor-builder/` | MN | Spirit recipes |
| `menu/` | MN | Menu items |
| `modifiers/` | MN | Modifier groups |
| `payroll/` | EM | Payroll management |
| `pizza/` | MN | Pizza builder config |
| `prep-stations/` | HW | Prep station setup |
| `reservations/` | GU | Reservation management |
| `roles/` | EM | Role permissions |
| `scheduling/` | EM | Staff scheduling |
| `settings/` | [SHARED] | General settings |
| `settings/daily-counts/` | IN | Daily count config |
| `settings/hardware/` | HW | Hardware overview |
| `settings/hardware/kds-screens/` | HW | KDS pairing |
| `settings/hardware/payment-readers/` | HW | Payment readers |
| `settings/hardware/printers/` | HW | Printer setup |
| `settings/hardware/routing/` | HW | Print routing |
| `settings/hardware/terminals/` | HW | Terminal setup |
| `settings/order-types/` | OM | Order type config |
| `settings/tip-outs/` | EM | Tip-out rules |
| `tax-rules/` | FN | Tax configuration |
| `timed-rentals/` | FP | Entertainment sessions (L8) |
| `virtual-groups/` | FP | Virtual table groups |

### 1.2 Reports Pages (`src/app/(admin)/reports/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `page.tsx` | RP | Reports hub |
| `commission/` | RP | Commission reports |
| `coupons/` | RP | Coupon usage |
| `daily/` | RP | Daily summary (EOD) |
| `employees/` | RP | Employee performance |
| `liquor/` | RP | Liquor reports |
| `order-history/` | RP | Order search |
| `payroll/` | RP | Payroll report |
| `product-mix/` | RP | Product mix analysis |
| `reservations/` | RP | Reservation reports |
| `sales/` | RP | Sales reports |
| `shift/` | RP | Shift reports |
| `tips/` | RP | Tips reports |
| `voids/` | RP | Void/comp reports |

### 1.3 POS Pages (`src/app/(pos)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `orders/` | OM + FP | [SPLIT] Main POS, uses Floor Plan for tables |
| `tabs/` | OM | Tab management |

### 1.4 KDS Pages (`src/app/(kds)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `kds/` | HW | Kitchen Display |
| `kds/entertainment/` | HW + FP | Entertainment KDS |
| `kds/pair/` | HW | KDS pairing |

### 1.5 Public Pages (`src/app/(public)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `approve-void/[token]/` | OM | Remote void approval |

---

## 2. API Routes (`src/app/api/`)

### 2.1 Floor Plan Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `floor-plan/` | FP |
| `floor-plan-elements/` | FP |
| `tables/` | FP |
| `tables/[id]/` | FP |
| `tables/[id]/seats/` | FP |
| `tables/[id]/seats/[seatId]/` | FP |
| `tables/[id]/seats/auto-generate/` | FP |
| `tables/[id]/seats/save-as-default/` | FP |
| `tables/[id]/split/` | FP |
| `tables/[id]/remove-from-group/` | FP |
| `tables/bulk-update/` | FP |
| `tables/reset-to-default/` | FP |
| `tables/save-default-layout/` | FP |
| `tables/virtual-combine/` | FP |
| `sections/` | FP |
| `sections/[id]/` | FP |
| `sections/reorder/` | FP |
| `entertainment/status/` | FP |
| `entertainment/waitlist/` | FP |
| `entertainment/waitlist/[id]/` | FP |

### 2.2 Order Management Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `orders/` | OM |
| `orders/[id]/` | OM |
| `orders/[id]/adjust-tip/` | OM |
| `orders/[id]/comp-void/` | OM |
| `orders/[id]/items/` | OM |
| `orders/[id]/pay/` | OM |
| `orders/[id]/reopen/` | OM |
| `orders/[id]/seating/` | OM |
| `orders/[id]/send/` | OM |
| `orders/[id]/split/` | OM |
| `orders/[id]/void-payment/` | OM |
| `orders/open/` | OM |
| `orders/sync/` | OM |
| `orders/sync-resolution/` | OM |
| `tabs/` | OM |
| `voids/` | OM |
| `payments/` | OM |

### 2.3 Menu Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `menu/` | MN |
| `menu/categories/` | MN |
| `menu/categories/[id]/` | MN |
| `menu/items/` | MN |
| `menu/items/[id]/` | MN |
| `menu/items/[id]/ingredients/` | MN |
| `menu/items/[id]/ingredients/[ingredientId]/` | MN |
| `menu/items/[id]/inventory-recipe/` | MN |
| `menu/items/[id]/modifiers/` | MN |
| `menu/items/[id]/modifier-groups/` | MN |
| `menu/modifiers/` | MN |
| `menu/modifiers/[id]/` | MN |
| `modifiers/` | MN |
| `modifier-templates/` | MN |
| `pizza/config/` | MN |
| `liquor/bottles/` | MN |
| `liquor/bottles/[id]/` | MN |
| `liquor/bottles/[id]/create-menu-item/` | MN |
| `liquor/bottles/[id]/restore-menu-item/` | MN |
| `liquor/bottles/sync-inventory/` | MN |
| `liquor/menu-items/` | MN |

### 2.4 Inventory Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `ingredients/` | IN |
| `ingredients/[id]/` | IN |
| `ingredients/[id]/cost/` | IN |
| `ingredients/[id]/hierarchy/` | IN |
| `ingredients/[id]/recipe/` | IN |
| `ingredients/[id]/recipe-cost/` | IN |
| `ingredients/bulk-move/` | IN |
| `ingredients/bulk-parent/` | IN |
| `ingredient-categories/` | IN |
| `ingredient-swap-groups/` | IN |
| `inventory/86-status/` | IN |
| `inventory/counts/` | IN |
| `inventory/daily-counts/` | IN |
| `inventory/invoices/` | IN |
| `inventory/items/` | IN |
| `inventory/prep/` | IN |
| `inventory/prep-items/` | IN |
| `inventory/prep-tray-configs/` | IN |
| `inventory/settings/` | IN |
| `inventory/stock-adjust/` | IN |
| `inventory/storage-locations/` | IN |
| `inventory/transactions/` | IN |
| `inventory/vendors/` | IN |
| `inventory/void-reasons/` | IN |
| `inventory/waste/` | IN |

### 2.5 Employee Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `employees/` | EM |
| `employees/[id]/` | EM |
| `employees/[id]/preferences/` | EM |
| `employees/roles/` | EM |
| `auth/` | EM |
| `auth/verify-pin/` | EM |

### 2.6 Reporting Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `reports/daily/` | RP |
| `reports/order-history/` | RP |
| `reports/pmix/` | RP |
| `reports/theoretical-usage/` | RP |
| `reports/variance/` | RP |
| `eod/` | RP |

### 2.7 Guest Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `customers/` | GU |
| `reservations/` | GU |

### 2.8 Hardware Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `hardware/printers/` | HW |
| `hardware/payment-readers/` | HW |
| `hardware/terminals/` | HW |
| `kds/` | HW |
| `kds/expo/` | HW |
| `print/kitchen/` | HW |
| `print/direct/` | HW |

### 2.9 Events Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `events/` | EV |
| `events/[id]/` | EV |

### 2.10 Financial Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `gift-cards/` | FN |
| `house-accounts/` | FN |
| `discounts/` | FN |
| `coupons/` | FN |
| `tax-rules/` | FN |

### 2.11 Shared/Internal APIs

| Current Path | Target Domain |
|--------------|---------------|
| `admin/sync-audit/` | [SHARED] |
| `internal/` | [SHARED] |
| `webhooks/` | [SHARED] |

---

## 3. Components (`src/components/`)

### 3.1 Floor Plan Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `floor-plan/` | FP | Main floor plan components |
| `floor-plan/AddEntertainmentPalette.tsx` | FP | L8 |
| `floor-plan/AddRoomModal.tsx` | FP | L1 |
| `floor-plan/CategoriesBar.tsx` | FP | |
| `floor-plan/entertainment-visuals.tsx` | FP | L8 |
| `floor-plan/ExistingOrdersModal.tsx` | FP | |
| `floor-plan/FloorPlanEntertainment.tsx` | FP | L8 |
| `floor-plan/FloorPlanHome.tsx` | FP | Main component |
| `floor-plan/FloorPlanTable.tsx` | FP | L2 |
| `floor-plan/hooks/` | FP | Floor plan hooks |
| `floor-plan/panels/` | FP | Sidebar panels |
| `floor-plan/PropertiesSidebar.tsx` | FP | |
| `floor-plan/RoomReorderModal.tsx` | FP | L1 |
| `floor-plan/RoomTabs.tsx` | FP | L1 |
| `floor-plan/SeatNode.tsx` | FP | L3 |
| `floor-plan/SeatOrbiter.tsx` | FP | L3 |
| `floor-plan/SectionSettings.tsx` | FP | L6 |
| `floor-plan/styles/` | FP | |
| `floor-plan/table-positioning.ts` | FP | |
| `floor-plan/TableNode.tsx` | FP | L2 |
| `floor-plan/UnifiedFloorPlan.tsx` | FP | |
| `floor-plan/use-floor-plan.ts` | FP | |
| `floor-plan/VirtualCombineBar.tsx` | FP | L4 |
| `floor-plan/VirtualGroupManagerModal.tsx` | FP | L4 |

### 3.2 Order Management Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `orders/` | OM | Order-related components |
| `orders/AdjustTipModal.tsx` | OM | |
| `orders/CompVoidModal.tsx` | OM | |
| `orders/OpenOrdersPanel.tsx` | OM | |
| `orders/OrderTypeSelector.tsx` | OM | |
| `orders/RemoteVoidApprovalModal.tsx` | OM | |
| `orders/ReopenOrderModal.tsx` | OM | |
| `orders/VoidPaymentModal.tsx` | OM | |
| `payment/` | OM | Payment components |
| `payment/DatacapPaymentProcessor.tsx` | OM | |
| `payment/GroupSummary.tsx` | OM | |
| `payment/PaymentModal.tsx` | OM | |
| `payment/ReaderStatusIndicator.tsx` | HW | [MOVE] To Hardware |
| `payment/SplitCheckModal.tsx` | OM | |
| `payment/SwapConfirmationModal.tsx` | OM | |
| `shifts/` | OM | Shift management |
| `tabs/` | OM | Tab components |

### 3.3 Menu Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `menu/` | MN | Menu builder |
| `modifiers/` | MN | Modifier components |
| `modifiers/ModifierModal.tsx` | MN | |
| `pizza/` | MN | Pizza builder |
| `pizza/PizzaBuilderModal.tsx` | MN | |
| `pizza/PizzaQuickBuilder.tsx` | MN | |
| `pizza/PizzaVisualBuilder.tsx` | MN | |
| `pizza/use-pizza-order.ts` | MN | |
| `bartender/` | MN | Bartender views |

### 3.4 Inventory Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `ingredients/` | IN | Ingredient library |
| `ingredients/BulkActionBar.tsx` | IN | |
| `ingredients/CategoryCard.tsx` | IN | |
| `ingredients/CategoryEditorModal.tsx` | IN | |
| `ingredients/DeletedItemsPanel.tsx` | IN | |
| `ingredients/IngredientCard.tsx` | IN | |
| `ingredients/IngredientEditorModal.tsx` | IN | |
| `ingredients/IngredientLibrary-refactored.tsx` | IN | |
| `ingredients/PrepItemEditor.tsx` | IN | |
| `inventory/` | IN | Inventory components |

### 3.5 Employee Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth/` | EM | Authentication |
| `auth/ManagerPinModal.tsx` | EM | |
| `time-clock/` | EM | Time clock |
| `time-clock/TimeClockModal.tsx` | EM | |

### 3.6 Hardware Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `hardware/` | HW | Hardware management |
| `hardware/HardwareHealthWidget.tsx` | HW | |
| `hardware/ReceiptVisualEditor.tsx` | HW | |
| `hardware/TerminalFailoverManager.tsx` | HW | |
| `kds/` | HW | KDS components |
| `receipt/` | HW | Receipt printing |
| `receipt/Receipt.tsx` | HW | |

### 3.7 POS Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `pos/` | OM + FP | [SPLIT] POS shared |
| `pos/MenuItemContextMenu.tsx` | OM | |
| `pos/OfflineSyncIndicator.tsx` | [SHARED] | |
| `pos/QuickAccessBar.tsx` | OM | |
| `pos/SyncStatusIndicator.tsx` | [SHARED] | |
| `pos/TerminalPairingOverlay.tsx` | HW | |

### 3.8 Admin Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `admin/AdminNav.tsx` | [SHARED] | Global nav |
| `admin/AdminPageHeader.tsx` | [SHARED] | |
| `admin/AdminSubNav.tsx` | [SHARED] | |
| `admin/ManagerGroupDashboard.tsx` | EM | |
| `admin/SyncAuditLog.tsx` | [SHARED] | |

### 3.9 Shared UI Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `ui/` | [SHARED] | shadcn components |
| `ui/button.tsx` | [SHARED] | |
| `ui/card.tsx` | [SHARED] | |
| `ui/dialog.tsx` | [SHARED] | |
| `ui/input.tsx` | [SHARED] | |
| `ui/pin-pad.tsx` | [SHARED] | |
| `ui/select.tsx` | [SHARED] | |
| `ui/ToastContainer.tsx` | [SHARED] | |
| ... | [SHARED] | All ui/* stays shared |

---

## 4. Library Files (`src/lib/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth.ts` | EM | Authentication logic |
| `auth-utils.ts` | EM | |
| `db.ts` | [SHARED] | Prisma client |
| `escpos/` | HW | ESC/POS commands |
| `events/` | EV | Event utilities |
| `inventory-calculations.ts` | IN | |
| `kds.ts` | HW | KDS logic (2,106 lines - SPLIT) |
| `offline-db.ts` | [SHARED] | |
| `offline-manager.ts` | [SHARED] | |
| `order-router.ts` | HW | Print routing |
| `payment-intent-manager.ts` | OM | |
| `print-factory.ts` | HW | |
| `realtime/` | [SHARED] | WebSocket logic |
| `scheduling.ts` | EM | (1,931 lines - SPLIT) |
| `seat-utils.ts` | FP | L3 |
| `settings.ts` | [SHARED] | |
| `socket-dispatch.ts` | [SHARED] | |
| `socket-server.ts` | [SHARED] | |
| `stock-status.ts` | IN | |
| `table-utils.ts` | FP | |
| `timed-rentals.ts` | FP | L8 (3,058 lines - SPLIT) |
| `twilio.ts` | [SHARED] | SMS notifications |
| `unit-conversions.ts` | IN | |
| `units.ts` | IN | |
| `utils.ts` | [SHARED] | |
| `validations.ts` | [SHARED] | |

---

## 5. Hooks (`src/hooks/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `useDatacap.ts` | HW | Payment processing |
| `useDebounce.ts` | [SHARED] | |
| `useHierarchyCache.ts` | IN | |
| `useIngredientCost.ts` | IN | |
| `useIngredientLibrary.ts` | IN | |
| `useKDSSockets.ts` | HW | |
| `useOfflineSync.ts` | [SHARED] | |
| `useOrderSettings.ts` | OM | |
| `usePaymentLock.ts` | OM | |
| `usePOSLayout.ts` | OM + FP | [SPLIT] |
| `useSeating.ts` | FP | L3 |

---

## 6. Stores (`src/stores/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth-store.ts` | EM | |
| `toast-store.ts` | [SHARED] | |

---

## 7. Types (`src/types/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `index.ts` | [SHARED] | Global types |
| `payment.ts` | OM | |
| `print-template-settings.ts` | HW | |
| `receipt-settings.ts` | HW | |
| `routing.ts` | HW | |

---

## 8. Contexts (`src/contexts/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| All contexts | [REVIEW] | Need to examine each |

---

## 9. Files to Delete

| Path | Reason |
|------|--------|
| `src/app/(admin)/floor-plan-v2/` | Deprecated |
| `src/components/floor-plan/FloorPlanHomeV2.tsx` | Deprecated |
| `src/components/floor-plan/FloorPlanTableV2.tsx` | Deprecated |
| `src/components/floor-plan/MenuSelectorV2.tsx` | Deprecated |
| `src/components/floor-plan/OrderPanelV2.tsx` | Deprecated |
| `src/components/floor-plan/VirtualGroupToolbar.tsx` | Deprecated |
| `src/components/floor-plan/useFloorPlanStore.ts` | Deprecated |
| `src/app/(admin)/tables/page.tsx` | Deprecated |
| `src/app/(pos)/orders/page.tsx.bak` | Backup file |
| `ZZZ just code can be deleted, /` | Temp folder |
| `txt files i used to verify code, not needed?/` | Temp folder |
| `*.txt` files in root | Temp exports |
| `test-results/` | Generated |

---

## 10. Files That Need Splitting

These files are over 1000 lines and contain logic for multiple concerns:

| File | Lines | Current Domain | Action |
|------|-------|----------------|--------|
| `lib/timed-rentals.ts` | 3,058 | FP L8 | Split into services |
| `components/floor-plan/floor-plan-editor.tsx` | 2,687 | FP | Split by layer |
| `lib/kds.ts` | 2,106 | HW | Split into services |
| `app/admin/employees/page.tsx` | 1,965 | EM | Extract components |
| `lib/scheduling.ts` | 1,931 | EM | Split into services |

---

## 11. Bridge Dependencies

Files that will need bridge interfaces because they cross domain boundaries:

| File | Domains Involved | Bridge Needed |
|------|------------------|---------------|
| `app/(pos)/orders/page.tsx` | FP + OM | floor-to-order |
| `components/payment/PaymentModal.tsx` | OM + FN | order-to-financial |
| `lib/order-router.ts` | OM + HW | order-to-hardware |
| `app/api/orders/[id]/pay/route.ts` | OM + IN | order-to-inventory |
| `components/floor-plan/FloorPlanHome.tsx` | FP + OM | floor-to-order |

---

## 12. Migration Priority

Based on dependencies and documentation, suggested migration order:

1. **Floor Plan** (L1-L9) - Most documented, foundational
2. **Menu** - Referenced by Order Management
3. **Order Management** - Core business logic
4. **Inventory** - Referenced by Menu and Orders
5. **Hardware** - Referenced by Orders
6. **Employee** - Referenced by Floor Plan and Orders
7. **Guest** - Referenced by Floor Plan
8. **Financial** - Referenced by Orders
9. **Events** - Standalone domain
10. **Reporting** - Aggregates from all domains

---

*This document will be updated as migration progresses.*
