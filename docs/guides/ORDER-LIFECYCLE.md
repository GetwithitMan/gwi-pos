# Order Lifecycle

Reference guide for AI agents working in the GWI POS codebase.

---

## Complete Order Flow

```
Create → Add Items → Send to Kitchen → Pay → Close
```

1. `POST /api/orders` — Create new order (assigns table, order type, server)
2. `POST /api/orders/[id]/items` — Add/update items atomically (prevents race conditions)
3. `POST /api/orders/[id]/send` — Send to kitchen (triggers KDS + print)
4. `POST /api/orders/[id]/pay` — Process payment (Datacap or cash)
5. Order auto-closes when fully paid

---

## Order API Contract (FIX-005 — Enforced Separation)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders` | POST | Create new order |
| `/api/orders/[id]` | GET | Get order details |
| `/api/orders/[id]` | PUT | **METADATA only** (tableId, orderType, notes). **REJECTS items array.** |
| `/api/orders/[id]/items` | POST | **Append/update items atomically** |
| `/api/orders/[id]/items/[itemId]` | PUT | Update single item field |
| `/api/orders/[id]/send` | POST | Send to kitchen |

> **CRITICAL:** Never send `items` in PUT to `/api/orders/[id]`. See `docs/api/ORDER-API-CONTRACT.md`.

---

## Event-Sourced Mandate

**Every Order/OrderItem mutation MUST emit domain events. No exceptions.**

The POS is migrating from direct Order table writes to a full event-sourced pipeline:

```
OrderEvent → OrderReducer → OrderSnapshot / OrderItemSnapshot
```

The `Order` and `OrderItem` tables are **LEGACY** — they will be removed. `OrderSnapshot` and `OrderItemSnapshot` are the future source of truth.

### Rules

1. **NEVER** add a `db.order.create/update/delete` or `db.orderItem.create/update/delete` without a corresponding `emitOrderEvent()` or `emitOrderEvents()` call
2. **NEVER** create new read queries against `db.order` or `db.orderItem` — use `db.orderSnapshot` / `db.orderItemSnapshot` instead
3. Event emission is **MANDATORY** for every Order/OrderItem mutation
4. Fire-and-forget pattern — events must not block the response:

```ts
void emitOrderEvent(db, { ... }).catch(console.error)
```

---

## 17 Event Types

```
ORDER_CREATED       ITEM_ADDED          ITEM_REMOVED
ITEM_UPDATED        ORDER_SENT          PAYMENT_APPLIED
PAYMENT_VOIDED      ORDER_CLOSED        ORDER_REOPENED
DISCOUNT_APPLIED    DISCOUNT_REMOVED    TAB_OPENED
TAB_CLOSED          GUEST_COUNT_CHANGED NOTE_CHANGED
ORDER_METADATA_UPDATED                  COMP_VOID_APPLIED
```

---

## Closed-Order Guard

| Category | Types |
|----------|-------|
| **Blocked when `isClosed`** (12) | ITEM_ADDED, ITEM_REMOVED, ITEM_UPDATED, ORDER_SENT, PAYMENT_APPLIED, DISCOUNT_APPLIED, DISCOUNT_REMOVED, TAB_OPENED, GUEST_COUNT_CHANGED, NOTE_CHANGED, ORDER_METADATA_UPDATED, COMP_VOID_APPLIED |
| **Always execute** (5) | ORDER_CREATED, PAYMENT_VOIDED, ORDER_CLOSED, ORDER_REOPENED, TAB_CLOSED |

---

## Snapshot Migration Status

| Phase | Description | Status |
|-------|-------------|--------|
| A | Schema fill — 46+19 fields, 11 indexes on snapshots | Done |
| B | Event emission — all write paths emit events | Done |
| C | Flip reads — 20 reads switched, ~260 remain (blocked by relations) | Partial |
| D | Kill legacy writes — guardrails added, dead code removed | In Progress |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/order-events/types.ts` | 17 event payload interfaces, OrderState, computed helpers |
| `src/lib/order-events/reducer.ts` | Pure reducer (483 lines), `guardClosed()` |
| `src/lib/order-events/projector.ts` | OrderState → Prisma snapshot projection |
| `src/lib/order-events/emitter.ts` | Fire-and-forget: persist event → assign serverSequence → socket broadcast |
| `src/lib/order-events/__tests__/reducer.test.ts` | 19 golden-master tests, 9 JSON fixtures |
| `src/app/api/order-events/batch/route.ts` | POST: batch events from Android |
| `src/app/api/sync/events/route.ts` | GET: paginated cursor-based event replay |

---

## Comp/Void Flow

- Comps and voids use `COMP_VOID_APPLIED` event type
- Endpoint: `POST /api/orders/[id]/comp-void`
- Triggers inventory reversal (fire-and-forget)
- Blocked on closed orders

---

## Split Payment Flow

- Endpoint: `POST /api/orders/[id]/split`
- Creates child orders from parent
- Each child can be paid independently
- See `docs/skills/SPEC-11-SPLITTING.md`

---

## Tab Lifecycle

1. `TAB_OPENED` — pre-auth via Datacap (hold amount on card)
2. Items added/removed during service
3. Optional: incremental auth if tab grows beyond hold
4. `TAB_CLOSED` — collect final amount
5. `PAYMENT_APPLIED` — tip applied separately

See `docs/domains/TABS-DOMAIN.md` for full tab behavior.

---

## Related Docs

- `docs/domains/ORDERS-DOMAIN.md` — Full order domain reference
- `docs/api/ORDER-API-CONTRACT.md` — API contract details
- `docs/skills/SPEC-11-SPLITTING.md` — Split payment spec
- `docs/domains/TABS-DOMAIN.md` — Tab lifecycle
