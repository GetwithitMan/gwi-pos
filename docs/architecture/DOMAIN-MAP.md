# GWI POS Domain Map
## Mapping Existing Files to Target Domains

**Version:** 2.0
**Date:** 2026-02-09
**Status:** ACTIVE

This document maps every significant file/folder in the current codebase to its target domain architecture (22 domains).

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `->` | Maps to domain |
| `[SPLIT]` | File needs to be split across domains |
| `[SHARED]` | Stays in shared utilities |
| `[REVIEW]` | Needs manual review |

---

## Domain Reference

| # | Domain | Code | Trigger | Description |
|---|--------|------|---------|-------------|
| 1 | Floor Plan | FP | `PM Mode: Floor Plan` | Tables, seats, sections, virtual groups, floor plan editor |
| 2 | Inventory | IN | `PM Mode: Inventory` | Stock, purchasing, waste, counts, ingredients |
| 3 | Orders | OM | `PM Mode: Orders` | Order lifecycle, items, send to kitchen, void/comp |
| 4 | Menu | MN | `PM Mode: Menu` | Items, categories, modifiers, combos |
| 5 | Employees | EM | `PM Mode: Employees` | Profiles, roles, time clock, shifts, payroll |
| 6 | KDS | KD | `PM Mode: KDS` | Kitchen display system, stations, bump bar |
| 7 | Payments | PM | `PM Mode: Payments` | Payment processing, Datacap, tips, receipts |
| 8 | Reports | RP | `PM Mode: Reports` | Sales, labor, PMIX, daily reports |
| 9 | Hardware | HW | `PM Mode: Hardware` | Terminals, printers, card readers, KDS screens |
| 10 | Settings | ST | `PM Mode: Settings` | Location settings, order types, tax rules |
| 11 | Entertainment | EN | `PM Mode: Entertainment` | Timed rentals, sessions, waitlist |
| 12 | Guest | GU | `PM Mode: Guest` | Online ordering, order ahead, bartender mobile |
| 13 | Events | EV | `PM Mode: Events` | Reservations, event ticketing |
| 14 | Financial | FN | `PM Mode: Financial` | Payroll processing, tip-outs, tip shares |
| 15 | Development-RnD | RD | `PM Mode: Development-RnD` | Prototypes, research, technical spikes |
| 16 | Error Reporting | ER | `PM Mode: Error Reporting` | Error tracking, monitoring, alerts |
| 17 | Tabs & Bottle Service | TB | `PM Mode: Tabs` | Bar tabs, pre-auth, bottle service, multi-card, walkout |
| 18 | Pizza Builder | PZ | `PM Mode: Pizza Builder` | Pizza config, visual builder, sectional printing |
| 19 | Liquor Management | LQ | `PM Mode: Liquor Management` | Spirit categories, bottles, cocktail recipes, pour cost |
| 20 | Offline & Sync | OS | `PM Mode: Offline & Sync` | Offline queue, IndexedDB, cloud sync, health checks |
| 21 | Customer Display | CD | `PM Mode: Customer Display` | CFD, pay-at-table, tip/signature screens |
| 22 | Scheduling | SC | `PM Mode: Scheduling` | Employee scheduling, shift planning |

---

## 1. App Router Pages (`src/app/`)

### 1.1 Admin Pages (`src/app/(admin)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `86/` | IN | 86'd items status |
| `combos/` | MN | Combo deals |
| `coupons/` | ST | Coupon management |
| `customers/` | GU | Customer profiles |
| `discounts/` | ST | Discount rules |
| `employees/` | EM | Employee management |
| `employees/[id]/payment/` | EM | Employee payment details |
| `events/` | EV | Event management |
| `floor-plan/` | FP | Floor plan editor |
| `gift-cards/` | PM | Gift card management |
| `house-accounts/` | PM | House accounts |
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
| `liquor-builder/` | LQ | Spirit recipes / liquor builder |
| `menu/` | MN | Menu items |
| `modifiers/` | MN | Modifier groups |
| `monitoring/` | ER | Error monitoring dashboard |
| `payroll/` | FN | Payroll management |
| `pizza/` | PZ | Pizza builder config |
| `prep-stations/` | KD | Prep station setup |
| `reservations/` | EV | Reservation management |
| `roles/` | EM | Role permissions |
| `scheduling/` | SC | Staff scheduling |
| `settings/` | ST | General settings |
| `settings/daily-counts/` | IN | Daily count config |
| `settings/hardware/` | HW | Hardware overview |
| `settings/hardware/kds-screens/` | HW | KDS pairing |
| `settings/hardware/payment-readers/` | HW | Payment readers |
| `settings/hardware/printers/` | HW | Printer setup |
| `settings/hardware/routing/` | HW | Print routing |
| `settings/hardware/terminals/` | HW | Terminal setup |
| `settings/order-types/` | ST | Order type config |
| `settings/tip-outs/` | FN | Tip-out rules |
| `tax-rules/` | ST | Tax configuration |
| `timed-rentals/` | EN | Entertainment item builder |
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
| `tabs/` | TB | Tab management |
| `pay-at-table/` | CD | Customer self-pay |

### 1.4 KDS Pages (`src/app/(kds)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `kds/` | KD | Kitchen Display |
| `kds/entertainment/` | EN | Entertainment KDS dashboard |
| `kds/pair/` | HW | KDS device pairing |

### 1.5 CFD Pages (`src/app/(cfd)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `cfd/` | CD | Customer-Facing Display |

### 1.6 Mobile Pages (`src/app/(mobile)/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `mobile/tabs/` | GU | Bartender mobile tab list |
| `mobile/tabs/[id]/` | GU | Mobile tab detail |

### 1.7 Public Pages (`src/app/(public)/`)

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

### 2.2 Order Management Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `orders/` | OM |
| `orders/[id]/` | OM |
| `orders/[id]/adjust-tip/` | OM |
| `orders/[id]/comp-void/` | OM |
| `orders/[id]/discount/` | OM |
| `orders/[id]/items/` | OM |
| `orders/[id]/items/[itemId]/` | OM |
| `orders/[id]/merge/` | OM |
| `orders/[id]/pay/` | OM |
| `orders/[id]/reopen/` | OM |
| `orders/[id]/seating/` | OM |
| `orders/[id]/send/` | OM |
| `orders/[id]/split/` | OM |
| `orders/[id]/split-tickets/` | OM |
| `orders/[id]/transfer-items/` | OM |
| `orders/[id]/void-payment/` | OM |
| `orders/open/` | OM |
| `orders/sync/` | OS |
| `orders/sync-resolution/` | OS |
| `voids/` | OM |
| `voids/remote-approval/` | OM |

### 2.3 Menu Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `menu/` | MN |
| `menu/search/` | MN |
| `menu/categories/` | MN |
| `menu/categories/[id]/` | MN |
| `menu/items/` | MN |
| `menu/items/[id]/` | MN |
| `menu/items/[id]/ingredients/` | MN |
| `menu/items/[id]/ingredients/[ingredientId]/` | MN |
| `menu/items/[id]/inventory-recipe/` | MN |
| `menu/items/[id]/modifiers/` | MN |
| `menu/items/[id]/modifier-groups/` | MN |
| `menu/items/[id]/modifier-groups/[groupId]/` | MN |
| `menu/items/[id]/modifier-groups/[groupId]/modifiers/` | MN |
| `menu/items/[id]/recipe/` | MN |
| `menu/modifiers/` | MN |
| `menu/modifiers/[id]/` | MN |
| `modifiers/` | MN |
| `modifier-templates/` | MN |

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
| `stock-alerts/` | IN |

### 2.5 Employee Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `employees/` | EM |
| `employees/[id]/` | EM |
| `employees/[id]/layout/` | EM |
| `employees/[id]/open-tabs/` | EM |
| `employees/[id]/payment/` | EM |
| `employees/[id]/preferences/` | EM |
| `employees/[id]/tips/` | EM |
| `employees/roles/` | EM |
| `roles/` | EM |
| `roles/[id]/` | EM |
| `auth/login/` | EM |
| `auth/verify-pin/` | EM |
| `time-clock/` | EM |
| `time-clock/status/` | EM |
| `breaks/` | EM |
| `shifts/` | EM |
| `shifts/[id]/` | EM |

### 2.6 KDS Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `kds/` | KD |
| `kds/expo/` | KD |
| `tickets/` | KD |
| `tickets/[id]/` | KD |
| `tickets/[id]/check-in/` | KD |
| `tickets/[id]/refund/` | KD |
| `prep-stations/` | KD |

### 2.7 Payments Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `payments/` | PM |
| `payments/sync/` | PM |
| `datacap/sale/` | PM |
| `datacap/preauth/` | PM |
| `datacap/capture/` | PM |
| `datacap/void/` | PM |
| `datacap/return/` | PM |
| `datacap/adjust/` | PM |
| `datacap/batch/` | PM |
| `datacap/collect-card/` | PM |
| `datacap/device-prompt/` | PM |
| `datacap/increment/` | PM |
| `datacap/pad-reset/` | PM |
| `datacap/param-download/` | PM |
| `datacap/walkout-retry/` | PM |
| `gift-cards/` | PM |
| `gift-cards/[id]/` | PM |
| `house-accounts/` | PM |
| `house-accounts/[id]/` | PM |

### 2.8 Reporting Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `reports/commission/` | RP |
| `reports/coupons/` | RP |
| `reports/customers/` | RP |
| `reports/daily/` | RP |
| `reports/discounts/` | RP |
| `reports/employee-shift/` | RP |
| `reports/employees/` | RP |
| `reports/labor/` | RP |
| `reports/liquor/` | RP |
| `reports/order-history/` | RP |
| `reports/payroll/` | RP |
| `reports/pmix/` | RP |
| `reports/product-mix/` | RP |
| `reports/reservations/` | RP |
| `reports/sales/` | RP |
| `reports/tables/` | RP |
| `reports/theoretical-usage/` | RP |
| `reports/tip-shares/` | RP |
| `reports/tips/` | RP |
| `reports/transfers/` | RP |
| `reports/variance/` | RP |
| `reports/voids/` | RP |
| `eod/reset/` | RP |

### 2.9 Hardware Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `hardware/printers/` | HW |
| `hardware/printers/[id]/` | HW |
| `hardware/printers/[id]/ping/` | HW |
| `hardware/printers/[id]/test/` | HW |
| `hardware/kds-screens/` | HW |
| `hardware/kds-screens/[id]/` | HW |
| `hardware/kds-screens/[id]/generate-code/` | HW |
| `hardware/kds-screens/[id]/heartbeat/` | HW |
| `hardware/kds-screens/[id]/unpair/` | HW |
| `hardware/kds-screens/auth/` | HW |
| `hardware/kds-screens/pair/` | HW |
| `hardware/payment-readers/` | HW |
| `hardware/payment-readers/[id]/` | HW |
| `hardware/payment-readers/[id]/ping/` | HW |
| `hardware/payment-readers/[id]/verify/` | HW |
| `hardware/print-routes/` | HW |
| `hardware/print-routes/[id]/` | HW |
| `hardware/print-routes/[id]/test/` | HW |
| `hardware/terminals/` | HW |
| `hardware/terminals/[id]/` | HW |
| `hardware/terminals/[id]/generate-code/` | HW |
| `hardware/terminals/[id]/unpair/` | HW |
| `hardware/terminals/heartbeat/` | HW |
| `hardware/terminals/pair/` | HW |
| `print/direct/` | HW |
| `print/kitchen/` | HW |

### 2.10 Settings Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `settings/` | ST |
| `tax-rules/` | ST |
| `tax-rules/[id]/` | ST |
| `order-types/` | ST |
| `order-types/[id]/` | ST |
| `discounts/` | ST |
| `coupons/` | ST |

### 2.11 Entertainment Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `entertainment/status/` | EN |
| `entertainment/block-time/` | EN |
| `entertainment/waitlist/` | EN |
| `entertainment/waitlist/[id]/` | EN |

### 2.12 Events Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `events/` | EV |
| `events/[id]/` | EV |
| `events/[id]/availability/` | EV |
| `events/[id]/conflicts/` | EV |
| `events/[id]/publish/` | EV |
| `events/[id]/resolve-conflicts/` | EV |
| `events/[id]/tables/` | EV |
| `events/[id]/tables/[tableId]/` | EV |
| `events/[id]/tickets/` | EV |
| `events/[id]/tickets/hold/` | EV |
| `events/[id]/tickets/purchase/` | EV |
| `events/[id]/tickets/release/` | EV |
| `events/[id]/tiers/` | EV |
| `events/[id]/tiers/[tierId]/` | EV |
| `reservations/` | EV |
| `reservations/[id]/` | EV |
| `customers/` | EV |

### 2.13 Financial Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `payroll/periods/` | FN |
| `payroll/periods/[id]/` | FN |
| `payroll/pay-stubs/[id]/pdf/` | FN |
| `tip-out-rules/` | FN |
| `tip-out-rules/[id]/` | FN |

### 2.14 Tabs Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `tabs/` | TB |

### 2.15 Pizza Builder Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `pizza/config/` | PZ |
| `pizza/sizes/` | PZ |
| `pizza/crusts/` | PZ |
| `pizza/sauces/` | PZ |
| `pizza/cheeses/` | PZ |
| `pizza/toppings/` | PZ |
| `pizza/specialties/` | PZ |

### 2.16 Liquor Management Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `liquor/categories/` | LQ |
| `liquor/bottles/` | LQ |
| `liquor/bottles/[id]/` | LQ |
| `liquor/bottles/[id]/create-menu-item/` | LQ |
| `liquor/bottles/[id]/restore-menu-item/` | LQ |
| `liquor/bottles/sync-inventory/` | LQ |
| `liquor/menu-items/` | LQ |
| `liquor/recipes/` | LQ |
| `liquor/upsells/` | LQ |

### 2.17 Offline & Sync Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `orders/sync/` | OS |
| `orders/sync-resolution/` | OS |
| `payments/sync/` | OS |
| `monitoring/health-check/` | OS |

### 2.18 Error Reporting Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `monitoring/errors/` | ER |
| `monitoring/error/` | ER |
| `monitoring/performance/` | ER |

### 2.19 Scheduling Domain APIs

| Current Path | Target Domain |
|--------------|---------------|
| `schedules/` | SC |

### 2.20 Shared/Internal APIs

| Current Path | Target Domain |
|--------------|---------------|
| `admin/sync-audit/` | OS |
| `internal/` | [SHARED] |
| `internal/socket/` | [SHARED] |
| `webhooks/` | [SHARED] |

---

## 3. Components (`src/components/`)

### 3.1 Floor Plan Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `floor-plan/FloorPlanHome.tsx` | FP | Main POS floor plan interface |
| `floor-plan/FloorPlanEditor.tsx` | FP | Admin layout editor |
| `floor-plan/FloorPlanTable.tsx` | FP | Table rendering |
| `floor-plan/FloorPlanEntertainment.tsx` | FP | Entertainment elements |
| `floor-plan/AddEntertainmentPalette.tsx` | FP | Entertainment placement |
| `floor-plan/AddRoomModal.tsx` | FP | Room management |
| `floor-plan/CategoriesBar.tsx` | FP | Category bar |
| `floor-plan/entertainment-visuals.tsx` | FP | 12 SVG visual types |
| `floor-plan/ExistingOrdersModal.tsx` | FP | |
| `floor-plan/hooks/` | FP | Floor plan hooks |
| `floor-plan/panels/` | FP | Sidebar panels |
| `floor-plan/PropertiesSidebar.tsx` | FP | |
| `floor-plan/RoomReorderModal.tsx` | FP | |
| `floor-plan/RoomTabs.tsx` | FP | |
| `floor-plan/SeatNode.tsx` | FP | Seat rendering |
| `floor-plan/SeatOrbiter.tsx` | FP | Seat positioning |
| `floor-plan/SectionSettings.tsx` | FP | |
| `floor-plan/styles/` | FP | |
| `floor-plan/table-positioning.ts` | FP | |
| `floor-plan/TableNode.tsx` | FP | |
| `floor-plan/UnifiedFloorPlan.tsx` | FP | |
| `floor-plan/use-floor-plan.ts` | FP | |
| `floor-plan/VirtualCombineBar.tsx` | FP | Virtual combine |
| `floor-plan/VirtualGroupManagerModal.tsx` | FP | |

### 3.2 Order Management Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `orders/OrderPanel.tsx` | OM | Order summary panel |
| `orders/OrderPanelActions.tsx` | OM | Totals, payment buttons |
| `orders/OrderTypeSelector.tsx` | OM | Order type selection |
| `orders/OpenOrdersPanel.tsx` | OM | Open orders list |
| `orders/CompVoidModal.tsx` | OM | Comp/void dialog |
| `orders/AdjustTipModal.tsx` | OM | Tip adjustment |
| `orders/RemoteVoidApprovalModal.tsx` | OM | Remote void |
| `orders/ReopenOrderModal.tsx` | OM | Reopen closed order |
| `orders/VoidPaymentModal.tsx` | OM | Void payment |
| `orders/EntertainmentSessionControls.tsx` | OM | Session start/stop/extend |
| `shifts/ShiftCloseoutModal.tsx` | EM | Shift closeout |
| `shifts/ShiftStartModal.tsx` | EM | Shift start |

### 3.3 Payments Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `payment/PaymentModal.tsx` | PM | Main payment flow |
| `payment/SplitCheckModal.tsx` | PM | Split check |
| `payment/GroupSummary.tsx` | PM | Group payment summary |
| `payment/DatacapPaymentProcessor.tsx` | PM | Datacap processing |
| `payment/QuickPayButton.tsx` | PM | Quick pay flow |
| `payment/ReaderStatusIndicator.tsx` | PM | Reader status |
| `payment/SignatureCapture.tsx` | PM | Signature capture |
| `payment/SwapConfirmationModal.tsx` | PM | Swap confirmation |
| `payment/TipPromptSelector.tsx` | PM | Tip prompt |
| `payment/steps/` | PM | Payment step components |

### 3.4 Tabs Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `tabs/` | TB | All tab components |
| `tabs/TabCard.tsx` | TB | Tab card display |
| `tabs/BottleServiceBanner.tsx` | TB | Bottle service progress |
| `tabs/CardFirstFlow.tsx` | TB | Card-first tab opening |
| `tabs/TabTransferModal.tsx` | TB | Tab transfer |
| `tabs/MultiCardBadges.tsx` | TB | Multi-card display |
| `tabs/PendingTabShimmer.tsx` | TB | Auth pending animation |

### 3.5 Menu Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `menu/ItemEditor.tsx` | MN | Menu item editor |
| `menu/ItemTreeView.tsx` | MN | Item hierarchy tree |
| `menu/ModifierFlowEditor.tsx` | MN | Modifier flow editor |
| `menu/RecipeBuilder.tsx` | MN | Recipe builder |
| `menu/StockBadge.tsx` | MN | Stock status badge |
| `modifiers/ModifierModal.tsx` | MN | Modifier selection modal |
| `bartender/BartenderView.tsx` | MN | Bartender POS interface |

### 3.6 Pizza Builder Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `pizza/PizzaBuilder.tsx` | PZ | Visual pizza builder |
| `pizza/PizzaBuilderModal.tsx` | PZ | Pizza builder modal |
| `pizza/PizzaQuickBuilder.tsx` | PZ | Quick pizza builder |
| `pizza/PizzaVisualBuilder.tsx` | PZ | Visual topping placement |
| `pizza/use-pizza-order.ts` | PZ | Pizza order hook |

### 3.7 Inventory Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `ingredients/IngredientLibrary.tsx` | IN | Main ingredient library |
| `ingredients/IngredientHierarchy.tsx` | IN | Hierarchy view |
| `ingredients/BulkActionBar.tsx` | IN | Bulk operations |
| `ingredients/DeletedItemsPanel.tsx` | IN | Restore deleted items |
| `ingredients/IngredientEditorModal.tsx` | IN | Editor modal |
| `ingredients/PrepItemEditor.tsx` | IN | Prep item editor |
| `ingredients/InventoryItemEditor.tsx` | IN | Inventory item editor |
| `ingredients/CategoryCard.tsx` | IN | Category display |
| `ingredients/CategoryEditorModal.tsx` | IN | Category editor |
| `ingredients/IngredientCard.tsx` | IN | Ingredient card |
| `inventory/` | IN | Inventory components |

### 3.8 Employee Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth/ManagerPinModal.tsx` | EM | Manager PIN auth |
| `time-clock/TimeClockModal.tsx` | EM | Time clock |

### 3.9 Customer Display Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `cfd/CFDIdleScreen.tsx` | CD | Idle screen |
| `cfd/CFDOrderDisplay.tsx` | CD | Live order display |
| `cfd/CFDTipScreen.tsx` | CD | Tip selection |
| `cfd/CFDSignatureScreen.tsx` | CD | Signature capture |
| `cfd/CFDApprovedScreen.tsx` | CD | Approval/decline |
| `pay-at-table/TablePayment.tsx` | CD | Pay-at-table flow |
| `pay-at-table/SplitSelector.tsx` | CD | Split check |
| `pay-at-table/TipScreen.tsx` | CD | Tip entry |

### 3.10 Guest Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `mobile/MobileTabCard.tsx` | GU | Mobile tab card |
| `mobile/MobileTabActions.tsx` | GU | Mobile tab actions |

### 3.11 Hardware Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `hardware/HardwareHealthWidget.tsx` | HW | Health monitoring |
| `hardware/PizzaPrintSettingsEditor.tsx` | HW | Pizza print settings |
| `hardware/PrinterSettingsEditor.tsx` | HW | Printer settings |
| `hardware/PrintSettingsEditor.tsx` | HW | Print settings |
| `hardware/ReceiptVisualEditor.tsx` | HW | Receipt editor |
| `hardware/TerminalFailoverManager.tsx` | HW | Terminal failover |
| `kds/ExpoScreen.tsx` | KD | Expo station |
| `kds/PitBossDashboard.tsx` | KD | Entertainment expo |
| `receipt/Receipt.tsx` | HW | Receipt template |

### 3.12 Financial Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `tips/TipAdjustmentOverlay.tsx` | FN | Tip adjustment |
| `tips/TipEntryRow.tsx` | FN | Tip entry |

### 3.13 Error Reporting Domain Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `monitoring/` | ER | Error monitoring UI |

### 3.14 POS Shared Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `pos/MenuItemContextMenu.tsx` | OM | |
| `pos/OfflineSyncIndicator.tsx` | OS | Offline indicator |
| `pos/QuickAccessBar.tsx` | OM | |
| `pos/SyncStatusIndicator.tsx` | OS | Sync status |
| `pos/TerminalPairingOverlay.tsx` | HW | |
| `search/` | MN | Menu search |

### 3.15 Admin Shared Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `admin/AdminNav.tsx` | [SHARED] | Global nav |
| `admin/AdminPageHeader.tsx` | [SHARED] | |
| `admin/AdminSubNav.tsx` | [SHARED] | |
| `admin/ManagerGroupDashboard.tsx` | EM | |
| `admin/SyncAuditLog.tsx` | OS | Sync audit log |

### 3.16 Shared UI Components

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `ui/` | [SHARED] | All ui/* stays shared |

---

## 4. Library Files (`src/lib/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth.ts` | EM | Authentication logic |
| `auth-utils.ts` | EM | |
| `batch-updates.ts` | OM | Batch order updates |
| `db.ts` | [SHARED] | Prisma client |
| `entertainment.ts` | EN | Entertainment utilities |
| `error-capture.ts` | ER | Error capture |
| `error-boundary.tsx` | ER | React error boundary |
| `escpos/` | HW | ESC/POS commands |
| `events/` | EV | Event utilities |
| `inventory-calculations.ts` | IN | Inventory deductions |
| `kds.ts` | KD | KDS logic |
| `liquor-inventory.ts` | LQ | Liquor inventory |
| `location-cache.ts` | ST | Location settings cache |
| `offline-db.ts` | OS | IndexedDB |
| `offline-manager.ts` | OS | Offline queue |
| `order-calculations.ts` | OM | Order totals, tax |
| `order-router.ts` | HW | Print routing |
| `payment-intent-manager.ts` | PM | Payment intents |
| `pizza-helpers.ts` | PZ | Pizza calculations |
| `pricing.ts` | OM | Pricing engine |
| `print-factory.ts` | HW | Print template factory |
| `printer-connection.ts` | HW | TCP printer connections |
| `realtime/` | [SHARED] | WebSocket logic |
| `scheduling.ts` | SC | Scheduling logic |
| `seat-generation.ts` | FP | Seat position algorithms |
| `seat-utils.ts` | FP | Seat utilities |
| `settings.ts` | ST | Settings helpers |
| `socket-dispatch.ts` | [SHARED] | Socket event dispatch |
| `socket-server.ts` | [SHARED] | Socket.io server |
| `stock-status.ts` | IN | Stock status helpers |
| `table-utils.ts` | FP | Table utilities |
| `timed-rentals.ts` | EN | Timed rental logic |
| `twilio.ts` | [SHARED] | SMS notifications |
| `unit-conversions.ts` | IN | Unit conversions |
| `units.ts` | IN | Unit definitions |
| `utils.ts` | [SHARED] | General utilities |
| `validations.ts` | [SHARED] | Validation helpers |
| `virtual-group-seats.ts` | FP | Virtual group numbering |
| `api/error-responses.ts` | OM | Standardized error responses |
| `datacap/` | PM | Datacap payment gateway |
| `domain/payment/` | PM | Payment domain logic |
| `payroll/` | FN | Payroll calculations |
| `services/payment-service.ts` | PM | Payment service layer |
| `floorplan/` | FP | Floor plan queries/serializers |

---

## 5. Hooks (`src/hooks/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `useActiveOrder.ts` | OM | Active order management |
| `useDatacap.ts` | PM | Payment processing |
| `useDebounce.ts` | [SHARED] | |
| `useHierarchyCache.ts` | IN | |
| `useIngredientCost.ts` | IN | |
| `useIngredientLibrary.ts` | IN | |
| `useKDSSockets.ts` | KD | |
| `useOfflineSync.ts` | OS | |
| `useOrderPanelItems.ts` | OM | Shared item mapping |
| `useOrderSettings.ts` | OM | |
| `usePaymentLock.ts` | PM | |
| `usePOSLayout.ts` | OM + FP | [SPLIT] |
| `usePricing.ts` | OM | Pricing hook |
| `useSeating.ts` | FP | |

---

## 6. Stores (`src/stores/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `auth-store.ts` | EM | |
| `order-store.ts` | OM | |
| `toast-store.ts` | [SHARED] | |

---

## 7. Types (`src/types/`)

| Current Path | Target Domain | Notes |
|--------------|---------------|-------|
| `index.ts` | [SHARED] | Global types |
| `hardware.ts` | HW | Hardware types |
| `multi-surface.ts` | CD | Multi-surface state |
| `order-types.ts` | ST | Order type definitions |
| `payment.ts` | PM | Payment types |
| `pizza-print-settings.ts` | PZ | Pizza print settings |
| `print-template-settings.ts` | HW | Print templates |
| `printer-settings.ts` | HW | Printer config |
| `public-menu.ts` | GU | Public menu contracts |
| `receipt-settings.ts` | HW | Receipt settings |
| `routing.ts` | HW | Print routing types |

---

## 8. Files That Need Splitting

These files are over 1000 lines and contain logic for multiple concerns:

| File | Lines | Current Domain | Action |
|------|-------|----------------|--------|
| `lib/timed-rentals.ts` | 3,058 | EN | Split into services |
| `components/floor-plan/FloorPlanEditor.tsx` | 2,687 | FP | Split by layer |
| `lib/kds.ts` | 2,106 | KD | Split into services |
| `app/(admin)/employees/page.tsx` | 1,965 | EM | Extract components |
| `lib/scheduling.ts` | 1,931 | SC | Split into services |
| `components/bartender/BartenderView.tsx` | ~3,000 | MN | Extract sub-components |

---

## 9. Bridge Dependencies

Files that cross domain boundaries and need bridge interfaces:

| File | Domains Involved | Bridge Needed |
|------|------------------|---------------|
| `app/(pos)/orders/page.tsx` | FP + OM | floor-to-order |
| `components/payment/PaymentModal.tsx` | OM + PM | order-to-payment |
| `lib/order-router.ts` | OM + HW | order-to-hardware |
| `app/api/orders/[id]/pay/route.ts` | OM + IN + PM | order-to-inventory-to-payment |
| `components/floor-plan/FloorPlanHome.tsx` | FP + OM | floor-to-order |
| `app/api/orders/[id]/comp-void/route.ts` | OM + IN | order-to-inventory (waste) |
| `components/bartender/BartenderView.tsx` | MN + TB + OM | bartender cross-domain |

---

## 10. Migration Priority

Based on dependencies, documentation completeness, and business impact:

| Priority | Domain | Reason |
|----------|--------|--------|
| 1 | Floor Plan (FP) | Most documented, foundational |
| 2 | Menu (MN) | Referenced by Orders |
| 3 | Orders (OM) | Core business logic |
| 4 | Payments (PM) | Revenue-critical |
| 5 | Tabs (TB) | Revenue-critical, depends on Orders + Payments |
| 6 | Inventory (IN) | Referenced by Menu and Orders |
| 7 | KDS (KD) | Referenced by Orders |
| 8 | Hardware (HW) | Referenced by Orders and KDS |
| 9 | Pizza Builder (PZ) | Specialized Menu extension |
| 10 | Liquor Management (LQ) | Specialized Menu + Inventory extension |
| 11 | Entertainment (EN) | Standalone with Floor Plan integration |
| 12 | Employee (EM) | Referenced by Floor Plan and Orders |
| 13 | Customer Display (CD) | Customer-facing surface |
| 14 | Guest (GU) | Future online ordering |
| 15 | Scheduling (SC) | Extends Employees |
| 16 | Financial (FN) | Payroll and tip distribution |
| 17 | Events (EV) | Reservations and ticketing |
| 18 | Settings (ST) | Cross-domain configuration |
| 19 | Reports (RP) | Aggregates from all domains |
| 20 | Offline & Sync (OS) | Infrastructure, touches all domains |
| 21 | Error Reporting (ER) | Infrastructure, touches all domains |
| 22 | Development-RnD (RD) | Non-production |

---

*This document will be updated as migration progresses.*
