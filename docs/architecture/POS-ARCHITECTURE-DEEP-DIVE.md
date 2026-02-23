# GWI POS -- Architecture & Data Flow Deep Dive

> Reference document for the engineering team.
> Last updated: 2026-02-23 | 413 API routes | 14 domains

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Domain Map](#domain-map)
3. [Multi-Tenancy](#multi-tenancy)
4. [Real-Time Architecture](#real-time-architecture)
5. [Critical Flow A: Table Tap --> Order Panel](#critical-flow-a-table-tap----order-panel)
6. [Critical Flow B: Add Item --> Send to Kitchen](#critical-flow-b-add-item----send-to-kitchen)
7. [Critical Flow C: Pay --> Close Order](#critical-flow-c-pay----close-order)
8. [Data Ownership Matrix](#data-ownership-matrix)
9. [Feature Inventory](#feature-inventory)
10. [Caching Layer](#caching-layer)
11. [Background Workers](#background-workers)

---

## System Overview

```
                      Vercel (cloud deploy)
                      barpos.restaurant / *.ordercontrolcenter.com
                              |
              +----- middleware.ts (slug extraction, cloud auth) -----+
              |                                                       |
     Cloud Mode (admin only)                              Local Mode (full POS)
     Clerk JWT via MC                                     PIN auth, Socket.io
              |                                                       |
              +--------> withVenue() on all 413 routes <--------------+
                              |
               AsyncLocalStorage per-request context
                              |
                     Neon PostgreSQL (gwi_pos_{slug})
```

**Stack**: Next.js 16 + App Router, React 19, Prisma 6, Neon PostgreSQL, Socket.io 4, Zustand 5, TypeScript 5.9

**Custom server** (`server.ts`): wraps Next.js HTTP server to co-host Socket.io on the same port. Every incoming request is wrapped in `requestStore.run()` with the venue-scoped PrismaClient.

---

## Domain Map

| Domain | Route Group | API Routes | Client Store | Key Lib Files |
|--------|-------------|------------|-------------|---------------|
| **Floor Plan** | `(pos)` | `/api/floor-plan/*`, `/api/tables/*`, `/api/sections/*`, `/api/floor-plan-elements/*`, `/api/seats/*`, `/api/floorplan/snapshot` | `useFloorPlanStore` (hook-based) | `src/domains/floor-plan/`, `src/lib/floorplan/`, `src/lib/table-geometry.ts`, `src/lib/seat-generation.ts` |
| **Ordering** | `(pos)` | `/api/orders/*`, `/api/orders/[id]/items`, `/api/orders/[id]/send`, `/api/orders/[id]/courses`, `/api/courses/*` | `useOrderStore` | `src/lib/order-calculations.ts`, `src/lib/order-utils.ts`, `src/lib/order-router.ts` |
| **Payments** | `(pos)` | `/api/orders/[id]/pay`, `/api/orders/[id]/payments`, `/api/payments/*`, `/api/datacap/*` (20 endpoints), `/api/payment-config` | `useOrderStore.currentOrder.payments` | `src/lib/pricing.ts`, `src/lib/payment.ts`, `src/lib/datacap/*` (14 modules), `src/lib/payment-intent-manager.ts` |
| **KDS** | `(kds)` | `/api/kds/`, `/api/kds/expo/` | Socket.io rooms: `tag:{stationName}` | `src/lib/order-router.ts` (`OrderRouter` class), `src/lib/socket-dispatch.ts` |
| **Menu Builder** | `(admin)` | `/api/menu/items/[id]/*`, `/api/menu/categories/*`, `/api/modifiers/*` | None (server-side) | `src/components/menu/ItemEditor.tsx`, `src/components/modifiers/ModifierModal.tsx` |
| **Inventory** | `(admin)` | `/api/inventory/*`, `/api/ingredients/*`, `/api/prep-stations/*`, `/api/stock-alerts` | Local state | `src/lib/inventory/*` (10 modules: `index.ts`, `helpers.ts`, `order-deduction.ts`, `prep-stock.ts`, `recipe-costing.ts`, `theoretical-usage.ts`, `types.ts`, `unit-conversion.ts`, `void-waste.ts`, `__tests__/`) |
| **Tips** | `(pos)` | `/api/tips/*` (14 endpoints: adjustments, cash-declarations, group-templates, groups, integrity, ledger, payouts, transfers), `/api/tip-out-rules/*` | None (calculated at payment) | `src/lib/domain/tips/` (11 modules: `tip-allocation.ts`, `tip-chargebacks.ts`, `tip-compliance.ts`, `tip-group-templates.ts`, `tip-groups.ts`, `tip-ledger.ts`, `tip-payouts.ts`, `tip-payroll-export.ts`, `tip-recalculation.ts`, `table-ownership.ts`, `index.ts`) |
| **Reports** | `(admin)` | `/api/reports/*` (29 report types) | None (server-side) | `src/lib/order-calculations.ts`, `src/lib/inventory/theoretical-usage.ts` |
| **Hardware** | `(admin)` | `/api/hardware/*` (terminals, printers, payment-readers, print-routes, kds-screens), `/api/print/*` (kitchen, cash-drawer, direct, daily-report, shift-closeout) | None (device IDs in order metadata) | `src/lib/printer-connection.ts`, `src/lib/escpos/*`, `src/lib/print-factory.ts`, `src/lib/print-template-factory.ts` |
| **Auth** | `(auth)` | `/api/auth/login`, `/api/auth/verify-pin`, `/api/auth/cloud-session`, `/api/auth/venue-login`, `/api/auth/owner-session`, `/api/auth/validate-session`, `/api/access/*` | `useAuthStore` (persisted via Zustand) | `src/lib/auth-utils.ts`, `src/lib/cloud-auth.ts`, `src/lib/access-gate.ts`, `src/lib/clerk-verify.ts` |
| **Entertainment** | `(pos)` | `/api/entertainment/*` (block-time, status, waitlist), `/api/timed-sessions/*` | `useOrderStore` | `src/lib/entertainment-pricing.ts`, `src/lib/entertainment.ts` |
| **Settings** | `(admin)` | `/api/settings/*`, `/api/system/*`, `/api/location/*`, `/api/order-types/*`, `/api/tax-rules/*` | `useOrderSettings` (hook) | `src/lib/location-cache.ts`, `src/lib/settings.ts` |
| **Online Ordering** | `(public)` | `/api/online/menu`, `/api/online/checkout`, `/api/public/resolve-order-code` | None (server-side) | `src/lib/online-availability.ts`, `src/lib/online-order-worker.ts` |
| **Customers** | `(admin)` | `/api/customers/*`, `/api/reservations/*`, `/api/house-accounts/*` | None | `src/components/customers/` |

### Additional Sub-Domains

| Sub-Domain | API Routes | Key Files |
|------------|------------|-----------|
| **Pizza** | `/api/pizza/*` (sizes, crusts, sauces, cheeses, toppings, specialties, config) | `src/lib/pizza-helpers.ts`, `src/lib/pizza-order-utils.ts`, `src/components/pizza/PizzaBuilderModal.tsx` |
| **Combos** | `/api/combos/*` | `src/hooks/useComboBuilder.ts` |
| **Tabs** | `/api/tabs/*`, `/api/orders/[id]/open-tab`, `/api/orders/[id]/close-tab` | `src/components/tabs/TabsPanel.tsx`, `src/hooks/useCardTabFlow.ts` |
| **Shifts / Scheduling** | `/api/shifts/*`, `/api/schedules/*`, `/api/shift-swap-requests/*`, `/api/time-clock/*`, `/api/breaks/*` | `src/hooks/useShiftManagement.ts` |
| **Events / Ticketing** | `/api/events/*` (tiers, tickets, tables, publish, conflicts) | `src/lib/events/*` |
| **Payroll** | `/api/payroll/periods/*`, `/api/payroll/pay-stubs/[id]/pdf` | `src/lib/payroll/*` |
| **Gift Cards** | `/api/gift-cards/*` | -- |
| **Bottle Service** | `/api/bottle-service/tiers/*` | -- |
| **Voids / Remote Approval** | `/api/voids/remote-approval/*` (request, validate-code, managers, token-based approve/reject/status) | `src/components/orders/RemoteVoidApprovalModal.tsx` |
| **Discounts / Coupons** | `/api/discounts/*`, `/api/coupons/*` | `src/components/orders/DiscountModal.tsx` |
| **Drawers** | `/api/drawers/*` | `src/lib/cash-drawer.ts` |
| **Audit** | `/api/audit/activity` | `src/lib/access-log.ts` |

---

## Multi-Tenancy

### Database-per-Venue Isolation

```
Neon cluster
  gwi_pos_joes_bar     (venue "joes-bar")
  gwi_pos_marios_pub   (venue "marios-pub")
  gwi_pos_dev          (local development)
```

Every venue gets its own Neon PostgreSQL database named `gwi_pos_{slug}`.

### Request Routing

| Layer | File | Mechanism |
|-------|------|-----------|
| 1. Slug extraction | `src/middleware.ts` | Reads hostname, extracts slug from `{slug}.ordercontrolcenter.com` or `{slug}.barpos.restaurant`, sets `x-venue-slug` header |
| 2. PrismaClient resolution | `src/lib/db.ts:getDbForVenue()` | Maintains a `Map<string, PrismaClient>` keyed by slug, lazy-creates clients with venue-specific `DATABASE_URL` |
| 3. Per-request binding | `src/lib/request-context.ts` | `AsyncLocalStorage<RequestContext>` stores `{ slug, prisma }` per request |
| 4. Route handler wrapper | `src/lib/with-venue.ts:withVenue()` | Wraps all 413 API routes; calls `requestStore.run()` with the resolved client |
| 5. DB proxy | `src/lib/db.ts` | `db` export is a `Proxy` that delegates to `getRequestPrisma()` on every call |

### Fast Path (NUC / Local Server)

`server.ts` wraps every HTTP request in `requestStore.run()` at the HTTP layer. `withVenue()` detects this via `getRequestPrisma()` and skips the async `headers()` lookup entirely. Net cost: ~0ms overhead per request.

### Query-Level Guards

- **Soft-delete middleware**: `db.ts` uses `$extends` to inject `deletedAt: null` into all `findMany`/`findFirst`/`findUnique`/`count` queries automatically (except `Organization`, `Location`, `SyncAuditEntry`, `CloudEventQueue`)
- **locationId filtering**: enforced by convention in all queries (application-level)
- Models excluded from soft-delete filter: `Organization`, `Location`, `SyncAuditEntry`, `CloudEventQueue`

---

## Real-Time Architecture

### Socket.io Room Structure

| Room Pattern | Who Joins | Events Received |
|-------------|-----------|-----------------|
| `location:{id}` | All terminals for a venue | `orders:list-changed`, `floorplan:table-updated`, `payment:processed`, `order:created`, `menu:updated`, `sync:status` |
| `tag:{tagName}` | KDS screens subscribed to that tag | `kds:order-received`, `kds:item-bumped`, `kds:order-bumped` |
| `terminal:{id}` | Single terminal/handheld | Direct messages, `cfd:*` events |

### Dispatch Pattern (Server-Side)

```
API route (after DB write)
    |
    +-- emitToLocation(locationId, event, data)   // All terminals
    +-- emitToTags(tags[], event, data)            // Tag-matched KDS
    |
    All fire-and-forget (void + .catch(console.error))
```

Key file: `src/lib/socket-dispatch.ts` -- 16+ dispatch functions including:
- `dispatchNewOrder()` -- sends `kds:order-received` to each manifest's tags
- `dispatchItemStatus()` -- sends `kds:item-bumped` / `kds:order-bumped`
- `dispatchFloorPlanUpdate()` -- sends `floorplan:table-updated` to location
- `dispatchOrderListChanged()` -- sends `orders:list-changed` to location
- `dispatchPaymentProcessed()` -- sends `payment:processed` to location

### Client-Side Consumption

All clients use `getSharedSocket()` from `src/lib/shared-socket.ts` (singleton pattern, ref-counted). Polling is forbidden; fallback polling at 30s only when `isConnected === false`.

---

## Critical Flow A: Table Tap --> Order Panel

```
User taps table on floor plan
         |
         v
FloorPlanHome.tsx:handleTableTap()
         |
         v
POST /api/orders  (body: { tableId, status: 'draft', items: [] })
  -- withVenue() --> requestStore.run()
  -- creates Order shell in DB (status=draft, empty items)
  -- response: { data: { id, orderNumber, ... } }
  -- ~20ms round-trip on NUC
         |
         v
useOrderStore.loadOrder(orderId)
  -- Zustand set({ currentOrder })
  -- stores order ID, table info, empty items array
         |
         v
socket-dispatch: dispatchFloorPlanUpdate(locationId, tableId)
  -- emitToLocation(locationId, 'floorplan:table-updated', { tableId, status: 'occupied' })
  -- other terminals receive event, update table color/status
         |
         v
OrderPanel.tsx renders
  -- reads useOrderStore(s => s.currentOrder)
  -- empty order, menu grid visible, ready for item taps
         |
         v
Background: fetchAndMergeOrder(?view=panel)
  -- lightweight fetch for panel-specific data
  -- merges any server-side defaults (order type, server assignment)
```

### Key Files in This Flow

| Step | File | Function/Component |
|------|------|--------------------|
| Table tap | `src/components/floor-plan/FloorPlanHome.tsx` | `handleTableTap()` |
| Order creation | `src/app/api/orders/route.ts` | `POST` handler |
| Store update | `src/stores/order-store.ts` | `loadOrder()` |
| Socket dispatch | `src/lib/socket-dispatch.ts` | `dispatchFloorPlanUpdate()` |
| Panel render | `src/components/orders/OrderPanel.tsx` | -- |

---

## Critical Flow B: Add Item --> Send to Kitchen

```
User taps menu item
         |
         v
Modifier check (data from menu-cache.ts, no API call)
  -- if item has required modifier groups --> ModifierModal.tsx opens
  -- user selects modifiers, pre-modifiers (No/Lite/Extra)
  -- if no modifiers required --> skip
         |
         v
POST /api/orders/[id]/items
  -- FOR UPDATE lock on Order row (prevents concurrent writes)
  -- atomic: creates OrderItem + OrderItemModifier rows
  -- recalculates order totals via order-calculations.ts
  -- increments Order.version
  -- response: { data: { items, totals } }
         |
         v
socket-dispatch: emitToLocation(locationId, 'order:totals-updated', { orderId, totals })
  -- other terminals viewing this order see updated total
         |
         v
User taps "Send" button
         |
         v
POST /api/orders/[id]/send
  -- FOR UPDATE lock on Order row
  -- marks unsent items as sentToKitchen: true
  -- updates Order.lastSentAt
         |
         v
OrderRouter.resolveRouting(orderId)
  -- fetches order with items, modifiers, pizza data, menu item tags
  -- fetches all active Stations for location
  -- tag resolution: item.routeTags > category.routeTags > autoDetectTags()
  -- routes items to stations via tag matching
  -- expo stations receive ALL items
  -- returns RoutingResult { manifests[], unroutedItems[], routingStats }
         |
         v
socket-dispatch: dispatchNewOrder(locationId, routingResult)
  -- for each manifest: emitToTags(matchedTags, 'kds:order-received', orderEvent)
  -- emitToLocation(locationId, 'order:created', summary)
         |
         v
Fire-and-forget side effects (void + .catch):
  -- printKitchenTickets() via print-factory.ts
  -- deductPrepStock() via inventory/prep-stock.ts
  -- auditLog() via access-log.ts
```

### Tag-Based KDS Routing Detail

```
MenuItem.routeTags: ["pizza"]        --> Station "Pizza Line" (tags: ["pizza"])
Category.routeTags: ["bar"]          --> Station "Bar" (tags: ["bar"])
Auto-detect (no tags): food category --> ["kitchen"] tag
Auto-detect: liquor/drinks category  --> ["bar"] tag
Auto-detect: pizzaData present       --> ["pizza"] tag

Expo stations: isExpo=true --> receive ALL items regardless of tags
Reference items: stations with showReferenceItems=true see non-matched items grayed out
```

### Key Files in This Flow

| Step | File | Function/Component |
|------|------|--------------------|
| Menu item tap | `src/components/floor-plan/FloorPlanMenuItem.tsx` | -- |
| Modifier modal | `src/components/modifiers/ModifierModal.tsx` | -- |
| Item add API | `src/app/api/orders/[id]/items/route.ts` | `POST` handler |
| Totals calc | `src/lib/order-calculations.ts` | `calculateOrderTotals()` |
| Send API | `src/app/api/orders/[id]/send/route.ts` | `POST` handler |
| Routing engine | `src/lib/order-router.ts` | `OrderRouter.resolveRouting()` |
| Socket dispatch | `src/lib/socket-dispatch.ts` | `dispatchNewOrder()` |
| Print generation | `src/lib/print-factory.ts` | kitchen ticket rendering |
| Prep stock | `src/lib/inventory/prep-stock.ts` | `deductPrepStock()` |

---

## Critical Flow C: Pay --> Close Order

```
User taps "Pay" button
         |
         v
PaymentModal.tsx opens INSTANTLY (no blocking fetch)
  -- reads current order from useOrderStore
  -- displays totals, payment method buttons
  -- tip prompt if configured
         |
         v
POST /api/orders/[id]/pay
  -- Status guard: if order.status === 'paid' --> 409 Conflict
  -- Idempotency check: if payment with same idempotencyKey exists --> return existing
  -- FOR UPDATE lock on Order row
         |
         v
Database transaction:
  1. Create Payment row (amount, method, authCode, tip, cardLastFour)
  2. Update Order: status --> 'paid', paidAt = now(), version++
  3. If split payment: check if all splits covered
         |
         v
Fire-and-forget side effects (void + .catch):
  -- deductInventoryForOrder()  via inventory/order-deduction.ts
  -- allocateTipsForPayment()   via domain/tips/tip-allocation.ts
  -- triggerCashDrawer()        via lib/cash-drawer.ts (cash payments only)
  -- emitCloudEvent()           via lib/cloud-events.ts (HMAC-signed to backoffice)
         |
         v
Socket dispatch:
  -- emitToLocation: 'orders:list-changed'    (order list updates)
  -- emitToLocation: 'floorplan:table-updated' (table goes green/available)
  -- emitToLocation: 'payment:processed'       (receipt terminals, CFD)
         |
         v
Zustand: useOrderStore
  -- clears currentOrder
  -- OrderPanel resets to empty state
  -- Floor plan table color changes via socket listener
```

### Key Files in This Flow

| Step | File | Function/Component |
|------|------|--------------------|
| Pay button | `src/components/payment/PaymentModal.tsx` | -- |
| Pay API | `src/app/api/orders/[id]/pay/route.ts` | `POST` handler |
| Inventory deduction | `src/lib/inventory/order-deduction.ts` | `deductInventoryForOrder()` |
| Tip allocation | `src/lib/domain/tips/tip-allocation.ts` | `allocateTipsForPayment()` |
| Cash drawer | `src/lib/cash-drawer.ts` | `triggerCashDrawer()` |
| Cloud sync | `src/lib/cloud-events.ts` | `emitCloudEvent()` |
| Socket dispatch | `src/lib/socket-dispatch.ts` | multiple dispatch functions |
| Store reset | `src/stores/order-store.ts` | `clearCurrentOrder()` |

---

## Data Ownership Matrix

| Entity | DB Model | Primary API Route | Client Store | Cache Strategy |
|--------|----------|-------------------|-------------|----------------|
| Orders | `Order` | `POST/GET /api/orders` | `useOrderStore.currentOrder` | None (always fresh) |
| Order Items | `OrderItem` | `POST /api/orders/[id]/items` | `useOrderStore.currentOrder.items` | None |
| Order Item Modifiers | `OrderItemModifier` | `POST /api/orders/[id]/items` (nested) | `useOrderStore.currentOrder.items[].modifiers` | None |
| Payments | `Payment` | `POST /api/orders/[id]/pay` | None (display only) | None |
| Inventory Items | `InventoryItemStorage` | `GET/PUT /api/inventory/items/[id]` | None (reports only) | None |
| Tables | `Table` | `GET /api/tables` | `useFloorPlan` hook (component-level) | Snapshot on load (`/api/floorplan/snapshot`) |
| Seats | `Seat` | `GET /api/tables/[id]/seats` | Local component state | None |
| Menu Items | `MenuItem` | `GET /api/menu/items/bulk` | None | `menu-cache.ts` (15s TTL, per-location, invalidated on CRUD) |
| Categories | `Category` | `GET /api/menu/categories` | None | Included in menu cache |
| Tips | `TipShare`, `TipLedger` | `/api/tips/*` | None (server-side) | None |
| Employees | `Employee` | `GET /api/employees` | `useAuthStore.employee` | Persisted via Zustand middleware (`gwi-pos-auth` localStorage) |
| Stations | `Station` | `/api/hardware/kds-screens/*`, `/api/hardware/printers/*` | None | None |
| Location Settings | `Location.settings` | `GET /api/settings` | `useOrderSettings` hook | `location-cache.ts` (5-min TTL) |
| Sections | `Section` | `GET /api/sections` | Local component state | None |
| Floor Plan Elements | `FloorPlanElement` | `GET /api/floor-plan-elements` | Local component state | None |
| Reservations | `Reservation` | `/api/reservations/*` | None | None |
| Customers | `Customer` | `/api/customers/*` | None | None |
| Schedules | `Schedule`, `Shift` | `/api/schedules/*` | None | None |
| Discounts | `Discount` | `/api/discounts/*` | None | None |
| Coupons | `Coupon` | `/api/coupons/*` | None | None |
| Gift Cards | `GiftCard` | `/api/gift-cards/*` | None | None |

---

## Feature Inventory

### Ordering & Tabs (16 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Create order | `FloorPlanHome.tsx` | `POST /api/orders` | `src/stores/order-store.ts` |
| Add items | `FloorPlanMenuItem.tsx` | `POST /api/orders/[id]/items` | `src/lib/order-calculations.ts` |
| Send to kitchen | `OrderPanelActions.tsx` | `POST /api/orders/[id]/send` | `src/lib/order-router.ts` |
| Split tabs (by item) | `SplitCheckScreen.tsx` | `POST /api/orders/[id]/split` | `src/hooks/useSplitCheck.ts` |
| Split tickets (by check) | `SplitTicketsOverview.tsx` | `/api/orders/[id]/split-tickets/*` | `src/hooks/useSplitTickets.ts` |
| Pay all splits | `PayAllSplitsModal.tsx` | `POST /api/orders/[id]/pay-all-splits` | `src/lib/split-pricing.ts` |
| Transfer items | `ItemTransferModal.tsx` | `POST /api/orders/[id]/transfer-items` | -- |
| Table transfer | `TablePickerModal.tsx` | `POST /api/tables/[id]/transfer` | -- |
| Tab transfer | `TabsPanel.tsx` | `POST /api/tabs/[id]/transfer` | -- |
| Comp / void item | `CompVoidModal.tsx` | `POST /api/orders/[id]/comp-void` | `src/lib/inventory/void-waste.ts` |
| Void entire tab | -- | `POST /api/orders/[id]/void-tab` | -- |
| Discounts (order-level) | `DiscountModal.tsx` | `POST /api/orders/[id]/discount` | `src/lib/pricing.ts` |
| Discounts (item-level) | `DiscountModal.tsx` | `POST /api/orders/[id]/items/[itemId]/discount` | `src/lib/pricing.ts` |
| Open bar tab | `NewTabModal.tsx`, `CardFirstTabFlow.tsx` | `POST /api/orders/[id]/open-tab` | `src/hooks/useCardTabFlow.ts` |
| Close tab | `TabsPanel.tsx` | `POST /api/orders/[id]/close-tab` | -- |
| Bill merge | -- | `POST /api/orders/[id]/merge` | -- |

### Course Management (5 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Assign course number | `CourseSelectorDropdown.tsx` | `POST /api/orders/[id]/courses` | -- |
| Fire course | `CourseControlBar.tsx` | `POST /api/orders/[id]/fire-course` | `src/lib/order-router.ts` |
| Advance course | `CourseControlBar.tsx` | `POST /api/orders/[id]/advance-course` | -- |
| Hold items | `SeatCourseHoldControls.tsx` | `PUT /api/orders/[id]/items/[itemId]` (isHeld) | -- |
| Per-item delay | `CourseDelayControls.tsx` | `PUT /api/orders/[id]/items/[itemId]` (holdUntil) | -- |

### Payment (8 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Cash payment | `PaymentModal.tsx` | `POST /api/orders/[id]/pay` | `src/lib/payment.ts` |
| Card payment (Datacap) | `DatacapPaymentProcessor.tsx` | `/api/datacap/sale`, `/api/datacap/preauth` | `src/lib/datacap/*` |
| Pre-auth (bar tab) | `CardFirstTabFlow.tsx` | `POST /api/orders/[id]/pre-auth` | `src/lib/datacap/sequence.ts` |
| Adjust tip | `AdjustTipModal.tsx` | `POST /api/orders/[id]/adjust-tip` | `src/lib/domain/tips/tip-allocation.ts` |
| Batch adjust tips | -- | `POST /api/orders/batch-adjust-tips` | -- |
| Void payment | `VoidPaymentModal.tsx` | `POST /api/orders/[id]/void-payment` | `src/lib/datacap/void` |
| Refund payment | -- | `POST /api/orders/[id]/refund-payment` | `src/lib/datacap/refund` |
| Pay-at-table | `src/components/pay-at-table/*` | `POST /api/orders/[id]/pat-complete` | -- |

### Modifier System (6 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Modifier stacking | `ModifierModal.tsx` | `POST /api/orders/[id]/items` (quantity on modifier) | `useModifierSelections.ts` |
| Pre-modifiers (No/Lite/Extra) | `ModifierGroupSection.tsx` | Embedded in item add payload | `src/lib/order-calculations.ts` |
| Linked item modifiers (spirit upgrades) | `SpiritSelectionModal.tsx` | `Modifier.linkedMenuItemId` reference | -- |
| Nested modifier groups (unlimited depth) | `ModifierFlowEditor.tsx` | `OrderItemModifier.depth` | `src/hooks/useModifierModal.ts` |
| Per-modifier KDS/print routing | `ModifierModal.tsx` | `Modifier.printerRouting` (follow/also/only) | `src/lib/order-router.ts` |
| Ingredient modifications (swap/remove) | `SwapPicker.tsx`, `IngredientsSection.tsx` | `OrderItem.ingredientModifications` | `src/hooks/useModifierModal.ts` |

### KDS & Kitchen (4 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Tag-based KDS routing | KDS page | `POST /api/orders/[id]/send` | `src/lib/order-router.ts:OrderRouter.resolveRouting()` |
| Expo station (sees all) | KDS expo page | `/api/kds/expo/` | `src/lib/order-router.ts` (isExpo logic) |
| Printer routing | -- | `/api/print/kitchen` | `src/lib/print-factory.ts`, `src/lib/printer-connection.ts` |
| Resend to kitchen | `ResendToKitchenModal.tsx` | `POST /api/orders/[id]/send` (with itemIds) | `src/lib/order-router.ts` |

### Tip System (7 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Tip sharing (automatic) | -- | Payment triggers `allocateTipsForPayment()` | `src/lib/domain/tips/tip-allocation.ts` |
| Tip pools | `ActiveGroupManager.tsx` | `/api/tips/groups/*` | `src/lib/domain/tips/tip-groups.ts` |
| Tip group templates | `ActiveGroupManager.tsx` | `/api/tips/group-templates/*` | `src/lib/domain/tips/tip-group-templates.ts` |
| Tip bank / ledger | `TipEntryRow.tsx` | `/api/tips/ledger/*` | `src/lib/domain/tips/tip-ledger.ts` |
| Tip payouts (batch) | -- | `/api/tips/payouts/batch` | `src/lib/domain/tips/tip-payouts.ts` |
| Tip adjustments | `TipAdjustmentOverlay.tsx` | `/api/tips/adjustments` | `src/lib/domain/tips/tip-recalculation.ts` |
| Table ownership (multi-server) | `SharedOwnershipModal.tsx` | Embedded in order metadata | `src/lib/domain/tips/table-ownership.ts` |

### Entertainment (4 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Timed rentals (per-minute) | `TimedRentalStartModal.tsx` | `/api/timed-sessions/*` | `src/lib/entertainment-pricing.ts` |
| Block time (fixed duration) | `EntertainmentSessionStart.tsx` | `/api/entertainment/block-time` | `src/lib/entertainment-pricing.ts` |
| Entertainment waitlist | `WaitlistPanel.tsx`, `AddToWaitlistModal.tsx` | `/api/entertainment/waitlist/*` | `src/lib/entertainment.ts` |
| Entertainment KDS | `FloorPlanEntertainment.tsx` | `/api/entertainment/status` | `src/lib/entertainment.ts` |

### Inventory & Recipe (5 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Inventory tracking (food) | `src/components/inventory/*` | `/api/inventory/*` | `src/lib/inventory/index.ts` |
| Recipe costing | `RecipeBuilder.tsx` | -- (calculated client-side) | `src/lib/inventory/recipe-costing.ts` |
| Theoretical usage reports | -- | `/api/reports/theoretical-usage` | `src/lib/inventory/theoretical-usage.ts` |
| Auto-deduction on sale | -- | Triggered in `/api/orders/[id]/pay` | `src/lib/inventory/order-deduction.ts` |
| Void/waste tracking | -- | Triggered in `/api/orders/[id]/comp-void` | `src/lib/inventory/void-waste.ts` |

### Pizza Builder (2 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Pizza builder (visual) | `PizzaVisualBuilder.tsx` | `/api/pizza/*` (sizes, crusts, sauces, cheeses, toppings) | `src/lib/pizza-helpers.ts`, `src/lib/pizza-order-utils.ts` |
| Pizza quick builder | `PizzaQuickBuilder.tsx` | Same as above | `src/hooks/usePizzaBuilder.ts` |

### Floor Plan & Seating (4 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Interactive floor plan | `InteractiveFloorPlan.tsx`, `UnifiedFloorPlan.tsx` | `/api/floor-plan`, `/api/tables/*`, `/api/sections/*` | `src/domains/floor-plan/*` |
| Seat management | `SeatOrbiter.tsx`, `SeatNode.tsx` | `/api/tables/[id]/seats/*` | `src/lib/seat-generation.ts`, `src/lib/seat-utils.ts` |
| Floor plan editor (admin) | `FloorPlanEditorDB.tsx` | `/api/floor-plan-elements/*`, `/api/tables/bulk-update` | `src/domains/floor-plan/admin/*` |
| Section management | `SectionSettings.tsx`, `RoomTabs.tsx` | `/api/sections/*` | -- |

### Customers & Reservations (2 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Customer management | `src/components/customers/*` | `/api/customers/*` | -- |
| Reservations | -- | `/api/reservations/*` | -- |

### Online Ordering (2 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Online menu | `src/app/(public)/order/page.tsx` | `/api/online/menu` | `src/lib/online-availability.ts` |
| Online checkout | -- | `/api/online/checkout` | `src/lib/online-order-worker.ts` |

### Mobile POS (1 feature)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Mobile POS (phone/iPad) | `src/app/(mobile)/mobile/*` | Same as POS APIs | `src/components/mobile/*` |

### Shift Management (3 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Time clock (in/out) | `src/components/time-clock/*` | `/api/time-clock/*` | -- |
| Schedule builder | `src/components/shifts/*` | `/api/schedules/*`, `/api/shifts/*` | `src/hooks/useShiftManagement.ts` |
| Shift swap requests | -- | `/api/shift-swap-requests/*` (accept, reject, approve, decline) | -- |

### Reports (29 types)

| Report | API Route |
|--------|-----------|
| Daily Summary | `/api/reports/daily` |
| Sales | `/api/reports/sales` |
| Hourly | `/api/reports/hourly` |
| Product Mix | `/api/reports/product-mix` |
| Employee Performance | `/api/reports/employees` |
| Employee Shift | `/api/reports/employee-shift` |
| Server Performance | `/api/reports/server-performance` |
| Labor | `/api/reports/labor` |
| Tips | `/api/reports/tips` |
| Tip Shares | `/api/reports/tip-shares` |
| Tip Groups | `/api/reports/tip-groups` |
| Tip Adjustments | `/api/reports/tip-adjustment` |
| Payroll | `/api/reports/payroll` |
| Payroll Export | `/api/reports/payroll-export` |
| Commission | `/api/reports/commission` |
| Discounts | `/api/reports/discounts` |
| Coupons | `/api/reports/coupons` |
| Voids | `/api/reports/voids` |
| Transfers | `/api/reports/transfers` |
| Order History | `/api/reports/order-history` |
| Customers | `/api/reports/customers` |
| Tables | `/api/reports/tables` |
| Reservations | `/api/reports/reservations` |
| Theoretical Usage (Inventory) | `/api/reports/theoretical-usage` |
| Variance (Inventory) | `/api/reports/variance` |
| Liquor Usage | `/api/reports/liquor` |
| House Accounts | `/api/reports/house-accounts` |
| Datacap Transactions | `/api/reports/datacap-transactions` |
| Forecasting | `/api/reports/forecasting` |

### Multi-Terminal Sync (2 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Multi-terminal sync | `ConflictBanner.tsx` | `/api/orders/sync`, `/api/orders/sync-resolution` | `src/lib/offline-manager.ts`, `src/lib/conflict-handler.ts` |
| Offline mode | -- | Queued locally | `src/lib/offline-db.ts`, `src/lib/offline-manager.ts` |

### Hardware (5 features)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Printer management | `src/components/hardware/*` | `/api/hardware/printers/*` | `src/lib/printer-connection.ts` |
| KDS screen pairing | `src/components/hardware/*` | `/api/hardware/kds-screens/*` (pair, unpair, heartbeat, auth) | -- |
| Terminal pairing | `src/components/hardware/*` | `/api/hardware/terminals/*` (pair, unpair, heartbeat) | -- |
| Payment reader management | `src/components/hardware/*` | `/api/hardware/payment-readers/*` (scan, ping, verify, cloud process) | `src/lib/reader-health.ts` |
| Print routes (priority routing) | `src/components/hardware/*` | `/api/hardware/print-routes/*` | `src/lib/print-factory.ts` |

### Voids / Remote Approval (1 feature)

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Remote void approval (SMS/link) | `RemoteVoidApprovalModal.tsx` | `/api/voids/remote-approval/*` (request, validate-code, [token]/approve, [token]/reject) | `src/lib/twilio.ts` |

### Other Features

| Feature | Component | API Route | Core Logic File |
|---------|-----------|-----------|-----------------|
| Bottle service | `BottleServiceBanner.tsx` | `/api/orders/[id]/bottle-service/*`, `/api/bottle-service/tiers/*` | -- |
| Gift cards | -- | `/api/gift-cards/*` | -- |
| House accounts | -- | `/api/house-accounts/*` | -- |
| Customer-facing display (CFD) | `src/app/(cfd)/cfd/*` | Socket events (`cfd:*`) | -- |
| Kiosk exit zone | `KioskExitZone.tsx` | `/api/system/exit-kiosk` | -- |
| EOD cleanup | -- | `/api/orders/eod-cleanup`, `/api/system/cleanup-stale-orders` | `server.ts:startEodScheduler()` |
| Walkin retry | -- | `/api/datacap/walkout-retry` | `src/lib/datacap/use-cases.ts` |
| Reopen order | `ReopenOrderModal.tsx` | `POST /api/orders/[id]/reopen` | -- |
| Order ownership transfer | -- | `POST /api/orders/[id]/ownership` | -- |
| Order type config | `ModeSelector.tsx`, `OrderTypeSelector.tsx` | `/api/order-types/*` | `src/hooks/useOrderTypes.ts` |
| Card profiles | -- | `/api/card-profiles` | -- |
| Batch actions | -- | `/api/orders/bulk-action` | -- |
| Chargebacks | -- | `/api/chargebacks` | `src/lib/domain/tips/tip-chargebacks.ts` |
| Role management | `src/components/admin/*` | `/api/roles/*` | -- |
| Receipts | `src/components/receipt/*` | `/api/receipts`, `/api/orders/[id]/receipt` | `src/lib/escpos/*` |
| Events / Ticketing | -- | `/api/events/*` (15+ endpoints) | `src/lib/events/*` |
| Payroll periods | -- | `/api/payroll/periods/*` | `src/lib/payroll/*` |

---

## Caching Layer

| Cache | Location | TTL | Invalidation | Key Pattern |
|-------|----------|-----|-------------|-------------|
| Menu data | `src/lib/menu-cache.ts` (in-memory `Map`) | 15 seconds | `invalidateMenuCache(locationId)` called from menu CRUD routes | `{locationId}:{categoryType}:{categoryShow}` |
| Location settings | `src/lib/location-cache.ts` (in-memory `Map`) | 5 minutes | `invalidate(locationId)` called from settings routes | `{locationId}` |
| Floor plan snapshot | `/api/floorplan/snapshot` (read-through) | Loaded once per session | Socket events trigger incremental updates | -- |
| Auth state | Zustand persist middleware (localStorage) | Indefinite (until logout) | `useAuthStore.logout()` | `gwi-pos-auth` key |
| Venue DB clients | `src/lib/db.ts` (in-memory `Map`) | Indefinite (process lifetime) | Process restart | `{slug}` |

---

## Background Workers

| Worker | Start Location | Trigger | What It Does |
|--------|---------------|---------|--------------|
| EOD Scheduler | `server.ts:startEodScheduler()` | Daily at 4 AM local | Calls `/api/system/cleanup-stale-orders` to close abandoned draft orders |
| Cloud Event Queue | `server.ts:startCloudEventWorker()` | Process startup | Polls `CloudEventQueue` table, sends HMAC-signed events to backoffice API |
| Online Order Dispatch | `server.ts:startOnlineOrderDispatchWorker()` | Process startup | Processes incoming online orders from cloud, creates Order rows locally |
| Heartbeat | NUC cron (60s) | systemd timer | Sends CPU/memory/disk/localIp/posLocationId to Mission Control |
| Sync Agent | NUC process | SSE listener | Receives cloud commands (FORCE_UPDATE, KILL_SWITCH, etc.) |

---

## Appendix: File Index

### Stores (Zustand)

| Store | File | Persistence |
|-------|------|-------------|
| `useAuthStore` | `src/stores/auth-store.ts` | localStorage (`gwi-pos-auth`) |
| `useOrderStore` | `src/stores/order-store.ts` | None (session memory) |
| `toast` | `src/stores/toast-store.ts` | None |
| `useDevStore` | `src/stores/dev-store.ts` | None |

### Core Infrastructure Files

| File | Purpose |
|------|---------|
| `server.ts` | Custom HTTP server, Socket.io init, EOD scheduler, cloud event worker |
| `src/middleware.ts` | Slug extraction, cloud auth, route protection |
| `src/lib/db.ts` | PrismaClient proxy with soft-delete middleware |
| `src/lib/with-venue.ts` | Multi-tenant route handler wrapper |
| `src/lib/request-context.ts` | AsyncLocalStorage for per-request tenant context |
| `src/lib/socket-server.ts` | Socket.io server init, room management, `emitToLocation()`, `emitToTags()` |
| `src/lib/socket-dispatch.ts` | 16+ dispatch functions for server-side event emission |
| `src/lib/shared-socket.ts` | Client-side singleton socket connection (ref-counted) |
| `src/lib/order-router.ts` | `OrderRouter` class -- tag-based routing engine |
| `src/lib/order-calculations.ts` | Centralized order totals, tax, commission calculations |
| `src/lib/pricing.ts` | `roundToCents()`, dual pricing, cash discount |
| `src/lib/print-factory.ts` | Kitchen ticket / receipt generation (44KB) |
| `src/lib/settings.ts` | Location settings types and defaults (29KB) |
| `src/lib/payment-intent-manager.ts` | Datacap payment state machine (20KB) |
| `src/lib/api-client.ts` | HTTP client with retry, error handling (27KB) |
