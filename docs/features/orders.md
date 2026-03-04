# Feature: Orders

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Orders → read every listed dependency doc.

## Summary
Orders are the central transaction entity in GWI POS. Every sale, bar tab, takeout, and delivery flows through the order system. Orders are **event-sourced**: every mutation emits an immutable event via `emitOrderEvent()`, and the canonical read model is `OrderSnapshot` (not the legacy `Order` table). The system supports dine-in, takeout, delivery, bar tabs, bottle service, timed rentals, split checks, coursing, and offline creation.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, POS UI, event engine | Full |
| `gwi-android-register` | Primary client — order creation, item add, send, pay | Full |
| `gwi-cfd` | Order summary display during payment | Partial |
| `gwi-backoffice` | Event ingestion, aggregate reporting | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | `/orders` | All FOH staff |
| POS Web | Floor plan → table tap → order | Servers, Bartenders |
| Android | `OrderScreen` / `OrderViewModel` | All FOH staff |
| Admin | `/reports` (order history) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/orders/route.ts` | POST (create), GET (list) |
| `src/app/api/orders/[id]/route.ts` | GET (detail), PUT (metadata only) |
| `src/app/api/orders/[id]/items/route.ts` | POST — atomic item append (ONLY way to add items) |
| `src/app/api/orders/[id]/items/[itemId]/route.ts` | PUT — update single item field |
| `src/app/api/orders/[id]/send/route.ts` | POST — send to kitchen |
| `src/app/api/orders/[id]/pay/route.ts` | POST — process payment |
| `src/app/api/orders/[id]/comp-void/route.ts` | POST — comp/void items |
| `src/app/api/orders/[id]/discount/route.ts` | POST/GET/DELETE — order-level discounts |
| `src/app/api/orders/[id]/split/route.ts` | POST — split order |
| `src/app/api/orders/[id]/reopen/route.ts` | POST — reopen closed order |
| `src/app/api/orders/[id]/open-tab/route.ts` | POST — open bar tab with pre-auth |
| `src/app/api/orders/[id]/close-tab/route.ts` | POST — close tab and capture |
| `src/app/api/orders/[id]/seating/route.ts` | GET/POST — per-seat breakdown |
| `src/app/api/orders/[id]/courses/route.ts` | GET/POST — course management |
| `src/app/api/orders/[id]/merge/route.ts` | POST — merge orders |
| `src/app/api/orders/[id]/transfer-items/route.ts` | POST — transfer items between orders |
| `src/app/api/orders/[id]/ownership/route.ts` | POST — shared table ownership |
| `src/app/api/orders/[id]/adjust-tip/route.ts` | POST — adjust tip after payment |
| `src/app/api/orders/[id]/mark-walkout/route.ts` | POST — mark as walkout |
| `src/app/api/orders/[id]/retry-capture/route.ts` | POST — retry failed capture |
| `src/app/api/orders/[id]/timeline/route.ts` | GET — event timeline |
| `src/app/api/orders/[id]/receipt/route.ts` | GET — receipt data |
| `src/app/api/orders/open/route.ts` | GET — list open orders |
| `src/app/api/orders/closed/route.ts` | GET — list closed orders |
| `src/app/api/orders/batch-adjust-tips/route.ts` | POST — batch tip adjustments |
| `src/app/api/orders/bulk-action/route.ts` | POST — bulk close/void |
| `src/app/api/orders/eod-cleanup/route.ts` | POST — end-of-day cleanup |
| `src/app/api/orders/sync/route.ts` | POST — sync offline orders |
| `src/lib/order-events/emitter.ts` | `emitOrderEvent()` — append event + socket broadcast |
| `src/lib/order-events/reducer.ts` | Pure state machine (17 event types) |
| `src/lib/order-events/projector.ts` | OrderState → OrderSnapshot conversion |
| `src/lib/order-events/ingester.ts` | Receive event, apply reducer, project snapshot |
| `src/lib/order-events/types.ts` | Event types, payloads, state interfaces, helpers |
| `src/lib/socket-dispatch.ts` | `dispatchNewOrder()`, `dispatchPaymentProcessed()`, etc. |
| `src/stores/order-store.ts` | Zustand store for current order in POS UI |

### gwi-android-register
| File | Purpose |
|------|---------|
| `ui/order/OrderScreen.kt` | Order entry screen |
| `ui/order/OrderViewModel.kt` | Order state management (900+ lines) |
| `repository/OrderMutationRepository.kt` | API calls for order mutations |
| `usecase/AddItemUseCase.kt` | Add item to order |
| `usecase/CreateOrderUseCase.kt` | Create new order |
| `usecase/PayOrderUseCase.kt` | Process payment |
| `usecase/SendToKitchenUseCase.kt` | Send order to kitchen |
| `usecase/SplitCheckUseCase.kt` | Split check |
| `usecase/ApplyDiscountUseCase.kt` | Apply discount |
| `usecase/CompVoidUseCase.kt` | Comp/void items |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders` | Employee PIN | Create order shell |
| `GET` | `/api/orders` | Employee PIN | List orders (filtered) |
| `GET` | `/api/orders/[id]` | Employee PIN | Order detail with items |
| `PUT` | `/api/orders/[id]` | Employee PIN | Update metadata only (rejects items array) |
| `POST` | `/api/orders/[id]/items` | Employee PIN | Atomic item append |
| `PUT` | `/api/orders/[id]/items/[itemId]` | Employee PIN | Update single item field |
| `POST` | `/api/orders/[id]/send` | Employee PIN | Send to kitchen (selective fire) |
| `POST` | `/api/orders/[id]/pay` | Employee PIN | Process payment |
| `POST` | `/api/orders/[id]/comp-void` | `manager.void_items` | Comp or void item |
| `POST` | `/api/orders/[id]/discount` | `manager.discounts` | Apply/toggle order discount |
| `POST` | `/api/orders/[id]/split` | `pos.split_checks` | Split order |
| `POST` | `/api/orders/[id]/reopen` | Manager | Reopen closed order |
| `POST` | `/api/orders/[id]/open-tab` | Employee PIN | Open bar tab (pre-auth) |
| `POST` | `/api/orders/[id]/close-tab` | Employee PIN | Close tab (capture + pay) |
| `POST` | `/api/orders/[id]/merge` | Employee PIN | Merge orders |
| `POST` | `/api/orders/[id]/transfer-items` | `manager.transfer_checks` | Transfer items |
| `GET` | `/api/orders/open` | Employee PIN | List open orders |
| `GET` | `/api/orders/closed` | Employee PIN | List closed orders |
| `POST` | `/api/orders/sync` | Employee PIN | Sync offline orders |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `order:event` | `{ eventId, orderId, serverSequence, type, payload, deviceId }` | Every `emitOrderEvent()` call |
| `order:created` | `{ orderId, orderNumber, orderType, tableName, employeeName }` | New order + send to kitchen |
| `kds:order-received` | Full order event for KDS routing | Send to kitchen (tag-routed) |
| `kds:item-status` | `{ orderId, itemId, kitchenStatus }` | Item bump, comp/void |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `order:editing` | Android / POS | Lock order for editing |
| `order:editing-released` | Android / POS | Release edit lock |

---

## Data Model

### OrderEvent (append-only event log)
```
id              String    @id
eventId         String    @unique     // ULID/UUID from device
orderId         String                // which order
locationId      String                // multi-tenant
deviceId        String                // originating device
deviceCounter   Int                   // monotonic per device
serverSequence  Int       @unique     // canonical ordering via PG SEQUENCE
type            String                // 17 event types
payloadJson     Json                  // typed payload
schemaVersion   Int       @default(1)
```

### OrderSnapshot (event-sourced read model — SOURCE OF TRUTH)
```
id                  String    // same as orderId
locationId          String
employeeId          String
orderType           String    @default("dine_in")
tableId             String?
status              String
subtotalCents       Int
discountTotalCents  Int
taxTotalCents       Int
tipTotalCents       Int
totalCents          Int
paidAmountCents     Int
itemCount           Int
hasHeldItems        Boolean
isClosed            Boolean
lastEventSequence   Int       // last serverSequence processed
items               OrderItemSnapshot[]
```

### 17 Event Types
| Event | Blocked on Closed | Description |
|-------|-------------------|-------------|
| `ORDER_CREATED` | No | Initial order creation |
| `ITEM_ADDED` | Yes | Atomic item append |
| `ITEM_REMOVED` | Yes | Remove item |
| `ITEM_UPDATED` | Yes | Update item field |
| `ORDER_SENT` | Yes | Send to kitchen |
| `PAYMENT_APPLIED` | Yes | Payment processed |
| `PAYMENT_VOIDED` | No | Void payment (always allowed) |
| `ORDER_CLOSED` | No | Close order |
| `ORDER_REOPENED` | No | Reopen closed order |
| `DISCOUNT_APPLIED` | Yes | Apply discount |
| `DISCOUNT_REMOVED` | Yes | Remove discount |
| `TAB_OPENED` | Yes | Open bar tab |
| `TAB_CLOSED` | No | Close bar tab |
| `GUEST_COUNT_CHANGED` | Yes | Change guest count |
| `NOTE_CHANGED` | Yes | Change order notes |
| `ORDER_METADATA_UPDATED` | Yes | Update table, server, etc. |
| `COMP_VOID_APPLIED` | Yes | Comp or void item |

---

## Business Logic

### Primary Flow
1. Employee taps table or "New Order" → `POST /api/orders` creates shell
2. Items added via `POST /api/orders/[id]/items` (atomic append)
3. Employee taps "Send" → `POST /api/orders/[id]/send` fires to kitchen
4. KDS displays ticket, kitchen prepares, bumps when done
5. Payment via `POST /api/orders/[id]/pay` → order closes
6. Each step emits an OrderEvent, reducer updates OrderSnapshot

### Atomic Item Append Pattern
- `POST /api/orders/[id]/items` is the **ONLY** way to add items
- `PUT /api/orders/[id]` is metadata-only — rejects `{ items: [...] }` with 400
- Prevents race conditions from concurrent item additions

### Event Emission Pattern
```typescript
// All write routes follow this pattern:
const updated = await db.order.update(...)
void emitOrderEvent(locationId, orderId, 'EVENT_TYPE', payload).catch(console.error)
return NextResponse.json(updated)
```

### Edge Cases & Business Rules
- **Closed-order guard:** 12 event types blocked on closed orders, 5 always execute
- **Offline orders:** Created with `offlineId` for deduplication on sync
- **Business day:** Orders at 1 AM belong to previous business day (`businessDayDate`)
- **Split orders:** `parentOrderId` + `splitIndex` for "31-1", "31-2" display
- **Coursing:** `currentCourse` + `courseMode` control fire-by-course
- **Optimistic locking:** `version` field prevents concurrent mutation conflicts
- **Print is fire-and-forget:** `printKitchenTicket()` has 7+ second TCP timeout — never await

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Payments | Order is the payment target — `orderId` FK on Payment |
| Tips | Order ownership determines tip recipient |
| KDS | Send-to-kitchen creates KDS tickets |
| Inventory | Payment triggers fire-and-forget deductions |
| Reports | OrderSnapshot is the source for all sales reports |
| Discounts | Discounts applied to order/items |
| Entertainment | Entertainment items create timed sessions |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Item selection, pricing, modifiers |
| Floor Plan | Table assignment drives order grouping |
| Settings | Order types, tax rules, business day config |
| Employees | Server assignment, shared ownership |
| Offline Sync | Offline mutations queued and synced |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does this change affect payment calculations?
- [ ] **Tips** — does this change affect tip allocation or order ownership?
- [ ] **KDS** — does this change affect kitchen ticket routing?
- [ ] **Reports** — does this change affect OrderSnapshot fields used by reports?
- [ ] **Permissions** — does this action need a permission gate?
- [ ] **Offline** — does this mutation work offline?
- [ ] **Socket** — does this change need new/updated socket events?
- [ ] **Event Sourcing** — does this mutation emit an event via `emitOrderEvent()`?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Create order | `pos.access` | Standard |
| Add items | `pos.access` | Standard |
| Send to kitchen | `pos.access` | Standard |
| View others' orders | `pos.view_others_orders` | Medium |
| Edit others' orders | `pos.edit_others_orders` | Medium |
| Split check | `pos.split_checks` | Medium |
| Change table | `pos.change_table` | Medium |
| Change server | `pos.change_server` | Medium |
| Transfer checks | `manager.transfer_checks` | High |
| Void items | `manager.void_items` | High |
| Void orders | `manager.void_orders` | High |
| Apply discounts | `manager.discounts` | High |
| Edit sent items | `manager.edit_sent_items` | High |
| Reopen order | `manager.void_orders` | High |
| Bulk operations | `manager.bulk_operations` | High |

---

## Known Constraints & Limits
- **Event sequence:** PG SEQUENCE `order_event_server_seq` provides canonical ordering
- **Reducer is pure:** No side effects — identical input always produces identical output
- **19 golden-master tests** with 9 JSON fixtures ensure reducer parity with Android
- **OrderSnapshot has 50+ fields** (bridge fields added for legacy migration)
- **ORDER_CREATED payload** must include: locationId, employeeId, orderType, guestCount, orderNumber

---

## Android-Specific Notes
- `OrderViewModel` is 900+ lines — manages full order lifecycle
- 7 dedicated use cases for clean architecture separation
- Android sends events with `deviceId` + `deviceCounter` — server assigns `serverSequence`
- Reducer is a Kotlin port of the TypeScript reducer — golden-master tests ensure parity
- Offline orders created with `offlineId` UUID for deduplication on sync

---

## Related Docs
- **Domain doc:** `docs/domains/ORDERS-DOMAIN.md`
- **Architecture guide:** `docs/guides/ORDER-LIFECYCLE.md`
- **Coding standards:** `docs/guides/CODING-STANDARDS.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Skills:** Skills 1–15, 65, 76, 121, 253 (see `docs/skills/SKILLS-INDEX.md`)

---

*Last updated: 2026-03-03*
