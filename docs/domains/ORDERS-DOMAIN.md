# Orders Domain

**Domain ID:** 3
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Orders domain is the core of the POS system, managing order lifecycle from creation through payment. It handles:
- Order creation with configurable order types (dine-in, bar tab, takeout, delivery, custom)
- Item management with atomic append (POST) pattern
- Modifier handling with depth tracking
- Send-to-kitchen workflow
- Void/comp with manager approval (local PIN + remote SMS)
- Order splitting, merging, and transferring
- Entertainment session management
- Course firing and hold/fire controls
- Real-time updates via Socket.io

## Domain Trigger

```
PM Mode: Orders
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Order CRUD | Create, read, update | `src/app/api/orders/`, `src/app/api/orders/[id]/` |
| Order Items | Item management | `src/app/api/orders/[id]/items/` |
| Send to Kitchen | Kitchen dispatch | `src/app/api/orders/[id]/send/` |
| Payment | Payment processing | `src/app/api/orders/[id]/pay/` |
| Void/Comp | Void and comp operations | `src/app/api/orders/[id]/comp-void/` |
| UI | Order screen components | `src/app/(pos)/orders/`, `src/components/orders/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Main POS order screen |
| `src/components/orders/OrderPanel.tsx` | Order summary panel |
| `src/components/orders/OrderPanelActions.tsx` | Totals, payment buttons |
| `src/components/orders/OrderTypeSelector.tsx` | Order type selection |
| `src/hooks/useActiveOrder.ts` | Active order management |
| `src/hooks/useOrderPanelItems.ts` | Shared item mapping pipeline |
| `src/stores/order-store.ts` | Zustand order state |
| `src/lib/api/error-responses.ts` | Standardized error responses |
| `src/lib/api/order-response-mapper.ts` | Order response mapping |
| `src/lib/batch-updates.ts` | Batch database updates |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/orders` | GET/POST | List/create orders |
| `/api/orders/[id]` | GET/PUT | Order details / metadata update (NO items) |
| `/api/orders/[id]/items` | POST | Atomic item append (ONLY way to add items) |
| `/api/orders/[id]/items/[itemId]` | PUT | Update single item field |
| `/api/orders/[id]/send` | POST | Send to kitchen |
| `/api/orders/[id]/pay` | POST | Process payment |
| `/api/orders/[id]/comp-void` | POST | Void/comp items |
| `/api/orders/[id]/discount` | POST | Apply discount |
| `/api/orders/[id]/split` | POST | Split order |
| `/api/orders/[id]/merge` | POST | Merge orders |
| `/api/orders/[id]/transfer-items` | POST | Transfer items between orders |
| `/api/orders/[id]/seating` | GET/POST | Per-seat breakdown |

## Critical API Rules

- **PUT `/api/orders/[id]`** is metadata-only — rejects `items` array with 400
- **POST `/api/orders/[id]/items`** is the ONLY way to add/update items
- See `/docs/api/ORDER-API-CONTRACT.md` for full documentation

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 02 | Quick Order Entry | DONE |
| 07 | Send to Kitchen | DONE |
| 10 | Item Notes | DONE |
| 14 | Order Splitting | DONE |
| 15 | Order Merging | DONE |
| 34 | Comps & Voids | DONE |
| 122 | Remote Void Approval | DONE |
| 230 | Quick Pick Numbers | DONE |
| 231 | Per-Item Delays | DONE |
| 234 | Shared OrderPanel Items Hook | DONE |
| 235 | Unified BartenderView Tab Panel | DONE |
| 236 | Comp/Void from BartenderView | DONE |
| 237 | Waste Tracking (Was It Made?) | DONE |
| 238 | VOID/COMP Stamps | PARTIAL |

## Integration Points

- **Floor Plan Domain**: FloorPlanHome inline ordering, table assignment
- **Menu Domain**: Item selection, modifier modal
- **Payments Domain**: Payment processing on order close
- **KDS Domain**: Send-to-kitchen, item bump sync
- **Inventory Domain**: Auto-deduction on payment
- **Entertainment Domain**: Timed session management
