# GWI POS - Domain Bridge Interfaces

## Overview

Bridges define how domains communicate. Each domain implements its side of the bridge — they never reach into each other's code.

---

## Bridge: Floor Plan ↔ Orders

This is the most critical bridge. The floor plan tells orders WHERE things are. Orders tell the floor plan WHAT's happening.

### Floor Plan → Orders (Context)

When the order system needs to know about a table/seat:

```typescript
interface FloorPlanContext {
  tableId: string;
  tableLabel: string;            // "T5" — for kitchen tickets
  roomId: string;
  roomName: string;              // "Main Dining" — for routing
  seatId: string | null;         // null = table-level order
  seatNumber: number | null;
  serverId: string;
  serverName: string;
  sectionId: string;
  groupId: string | null;
  groupIdentifier: string | null; // "Smith-8PM"
  groupColor: string | null;
  partySize: number;
  isVirtualGroup: boolean;
  allTableIdsInGroup: string[];
  allSeatIdsInGroup: string[];
  entertainmentSessionId: string | null;
}

interface FloorPlanBridgeAPI {
  getContextForTable(tableId: string): FloorPlanContext;
  getContextForSeat(seatId: string): FloorPlanContext;
  getContextForGroup(groupId: string): FloorPlanContext[];
  getAvailableSeats(tableId: string): { seatId: string; seatNumber: number; hasOpenOrder: boolean }[];
}
```

### Orders → Floor Plan (Status Updates)

The floor plan listens to order events to update table status:

```typescript
interface OrderStatusUpdate {
  tableId: string;
  hasOpenTicket: boolean;
  ticketId: string | null;
  totalItems: number;
  itemsPendingKitchen: number;
  itemsInProgress: number;
  itemsReady: number;
  itemsServed: number;
  subtotal: number;
  checkRequested: boolean;
  checkPrinted: boolean;
  isPaid: boolean;
  paymentMethod: string | null;
  tipAmount: number | null;
}

interface OrderBridgeAPI {
  getOrderStatus(tableId: string): OrderStatusUpdate;
  getOrderStatusForSeat(seatId: string): OrderStatusUpdate;
  onOrderStatusChanged(callback: (update: OrderStatusUpdate) => void): void;
}
```

### Status Mapping

The floor plan's Layer 7 (Status Engine) subscribes to order events:

```
ORDER EVENT                          → TABLE STATUS CHANGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First item added to ticket           → 'occupied' → 'ordering'
Order sent to kitchen                → 'ordering' → 'food_pending'
All items delivered                  → 'food_pending' → 'food_served'
Check requested                      → 'food_served' → 'check_requested'
Check printed                        → 'check_requested' → 'check_dropped'
Payment processed                    → 'check_dropped' → 'paid'
(auto after delay)                   → 'paid' → 'dirty'
```

### Table Merge Handling

When tables merge, orders need to know about seat renumbering:

```typescript
// Floor Plan calls this when tables merge
interface TableMergeEvent {
  groupId: string;
  tableIds: string[];
  seatRenumbering: Map<string, number>;  // seatId → new display number
  combinedCapacity: number;
}

// Orders implements
onTablesMerged(event: TableMergeEvent): void;
onTablesUnmerged(groupId: string): void;
```

---

## Bridge: Orders ↔ Menu

Orders needs menu items and pricing. Menu needs to know what's selling.

### Menu → Orders

```typescript
interface MenuItemForOrder {
  id: string;
  name: string;
  category: string;
  station: string;           // "Grill", "Fry", "Bar"
  price: number;
  taxable: boolean;
  modifierGroups: ModifierGroup[];
  prepTime: number;          // Minutes
  isAvailable: boolean;
}

interface MenuBridgeAPI {
  getMenuItem(menuItemId: string): MenuItemForOrder;
  getItemPrice(menuItemId: string, modifiers: string[]): number;
  isItemAvailable(menuItemId: string): boolean;
  searchMenuItems(query: string): MenuItemForOrder[];
}
```

### Orders → Menu

```typescript
interface ItemSalesUpdate {
  menuItemId: string;
  quantitySold: number;
  revenue: number;
  timestamp: Date;
}

interface OrdersToMenuBridgeAPI {
  recordItemSale(sale: ItemSalesUpdate): void;
  getItemSalesCount(menuItemId: string, hours?: number): number;
}
```

---

## Bridge: Orders ↔ Hardware

Orders sends things to printers, KDS, and card readers.

### Orders → Kitchen (KDS)

```typescript
interface KitchenOrderTicket {
  ticketId: string;
  ticketNumber: number;
  tableLabel: string;
  serverName: string;
  groupColor: string | null;
  groupIdentifier: string | null;
  items: KitchenItem[];
  priority: 'normal' | 'rush' | 'vip';
  firedAt: Date;
  courseFiring: boolean;
}

interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  modifiers: string[];
  specialInstructions: string;
  seatNumber: number | null;
  station: string;
  course: number;
  status: 'queued' | 'in_progress' | 'ready' | 'bumped';
}

interface KitchenBridgeAPI {
  sendToKitchen(ticket: KitchenOrderTicket): void;
  bumpItem(itemId: string): void;
  bumpTicket(ticketId: string): void;
  getKitchenQueue(station?: string): KitchenOrderTicket[];
}
```

### Orders → Receipt Printer

```typescript
interface ReceiptData {
  ticketId: string;
  ticketNumber: number;
  locationName: string;
  serverName: string;
  tableLabel: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number | null;
  total: number;
  paymentMethod: string;
  timestamp: Date;
}

interface PrinterBridgeAPI {
  printReceipt(receipt: ReceiptData, printerId: string): void;
  printCheck(check: ReceiptData, printerId: string): void;
  getAvailablePrinters(): Printer[];
}
```

---

## Bridge: Menu ↔ Inventory

Menu needs to know stock levels. Inventory tracks what's being used.

```typescript
interface InventoryCheck {
  ingredientId: string;
  currentStock: number;
  unit: string;
  isLow: boolean;
  isOut: boolean;
}

interface MenuToInventoryBridgeAPI {
  getIngredientStock(ingredientId: string): InventoryCheck;
  checkMenuItemAvailability(menuItemId: string): boolean;
  getRecipeCost(menuItemId: string): number;
}

interface InventoryDeduction {
  ingredientId: string;
  quantity: number;
  reason: 'sale' | 'waste' | 'adjustment';
  orderId: string | null;
}

interface InventoryFromOrdersBridgeAPI {
  deductIngredients(deductions: InventoryDeduction[]): void;
  onItemSold(menuItemId: string, quantity: number): void;
}
```

---

## Bridge: Employee ↔ Floor Plan

Floor Plan needs staff info for assignments.

```typescript
interface StaffInfo {
  id: string;
  name: string;
  role: 'server' | 'bartender' | 'hostess' | 'busser' | 'manager';
  pin: string;
  isActive: boolean;
  clockedIn: boolean;
}

interface EmployeeBridgeAPI {
  getActiveStaff(): StaffInfo[];
  getStaffById(staffId: string): StaffInfo;
  getStaffByRole(role: string): StaffInfo[];
  isStaffClockedIn(staffId: string): boolean;
}
```

---

## Bridge: Guest ↔ Floor Plan

Waitlist needs guest info. Guest domain tracks visit history.

```typescript
interface GuestForWaitlist {
  id: string | null;         // null = anonymous guest
  name: string;
  phone: string | null;
  email: string | null;
  vipStatus: boolean;
  visitCount: number;
  notes: string | null;
  allergens: string[];
}

interface GuestBridgeAPI {
  findGuestByPhone(phone: string): GuestForWaitlist | null;
  createAnonymousGuest(name: string, phone?: string): GuestForWaitlist;
  recordVisit(guestId: string, tableId: string): void;
}
```

---

## Bridge Status Board

```
BRIDGE                          SPEC DONE    IMPLEMENTED    TESTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Floor Plan ↔ Orders             [x]          [ ]            [ ]
Orders ↔ Menu                   [x]          [ ]            [ ]
Orders ↔ Hardware (KDS)         [x]          [ ]            [ ]
Orders ↔ Hardware (Printer)     [x]          [ ]            [ ]
Menu ↔ Inventory                [x]          [ ]            [ ]
Employee ↔ Floor Plan           [x]          [ ]            [ ]
Guest ↔ Floor Plan              [x]          [ ]            [ ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Bridge Rules

1. **Both sides implement their half.** Floor Plan implements `FloorPlanBridgeAPI`. Orders implements `OrderBridgeAPI`.
2. **Types live in `/src/shared/bridges/`.** Both domains import from there.
3. **Changes require Architect approval.** No domain can unilaterally change a bridge.
4. **Integration tests verify both sides.** A bridge isn't done until tests pass.
5. **Versioning tracks changes.** Breaking changes increment major version.

---

## File Locations

```
src/
  shared/
    bridges/
      floorplan-orders/
        types.ts           ← Shared types
        index.ts           ← Exports
        __tests__/         ← Integration tests

      orders-menu/
        types.ts
        index.ts
        __tests__/

      orders-hardware/
        types.ts
        index.ts
        __tests__/
```
