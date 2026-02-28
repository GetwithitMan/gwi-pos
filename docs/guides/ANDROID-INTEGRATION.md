# Android Integration Guide

> Reference for AI agents working on GWI POS. Covers Android-as-primary-client architecture, API contracts, event-sourced order flow, and UI rules.

---

## Android is the PRIMARY Client

The native Android app is the primary POS interface. The web/browser UI (Chromium kiosk) is a functional fallback only.

| Rule | Detail |
|------|--------|
| Mobile-first design | All new UI work targets Android first |
| Touch targets | Min **48×48dp** — no hover-dependent interactions |
| Performance target | Sub-50ms for all POS actions (tap → visual response) |
| Network baseline | WiFi to NUC — if it works here, it works everywhere |

When building features, verify Android behavior over WiFi to the NUC before considering web parity.

---

## API Endpoints Android Calls

| Endpoint | Purpose |
|----------|---------|
| `POST /api/sync/pair-native` | Device pairing |
| `POST /api/sync/heartbeat-native` | Device heartbeat |
| `GET /api/sync/bootstrap` | Full initial data load |
| `GET /api/sync/delta` | Incremental sync |
| `POST /api/sync/outbox` | Upload pending mutations |
| `POST /api/order-events/batch` | Batch order events (event-sourced) |
| `GET /api/sync/events` | Paginated event replay |

---

## Socket Authentication

Android authenticates sockets with `deviceToken` in `socket.handshake.auth`. The middleware that validates this lives in `server.ts`.

```ts
// server.ts — socket middleware reads:
socket.handshake.auth.deviceToken
```

---

## Event-Sourced Order Flow

All order mutations go through an append-only event log. No direct order mutation calls.

```
User action → OrderEventEntity (PENDING) → Room insert
  → Load all events → OrderReducer.reduce() → OrderState
  → OrderProjector.project() → CachedOrderEntity + CachedOrderItemEntity
  → UI observes via Room Flow
  → Background: EventSyncWorker batches PENDING → POST /api/order-events/batch
  → NUC assigns serverSequence, broadcasts order:event via socket
  → Other devices: ingestRemoteEvent → INSERT IGNORE → replayAndProject
  → Reconnect: catchUpOrderEvents (paginated) fills gaps
```

### 17 Event Types

```
ORDER_CREATED        ITEM_ADDED           ITEM_REMOVED
ITEM_UPDATED         ORDER_SENT           PAYMENT_APPLIED
PAYMENT_VOIDED       ORDER_CLOSED         ORDER_REOPENED
DISCOUNT_APPLIED     DISCOUNT_REMOVED     TAB_OPENED
TAB_CLOSED           GUEST_COUNT_CHANGED  NOTE_CHANGED
ORDER_METADATA_UPDATED                    COMP_VOID_APPLIED
```

Shared type definitions: `src/lib/order-events/types.ts`

---

## Outbox Pattern

| Principle | Implementation |
|-----------|---------------|
| Per-order sequencing | Events are sequenced within each order, not globally |
| Upsert-then-prune | DAOs use upsert for idempotent writes, prune old synced events |
| Batch sync | `EventSyncWorker` collects `PENDING` events → single `POST /api/order-events/batch` |

---

## Dual Pricing Alignment

**Critical:** Stored prices are cash prices. Never subtract surcharge from them.

```
cashTotal = order.total          // stored price IS the cash price
cardTotal = order.total + surcharge
```

The web POS `PaymentModal` sends `amount: remainingBeforeTip` for cash — that equals `order.total` (the cash price). Android must match this exactly.

**Wrong pattern (do not do this):**
```kotlin
// BAD — double-discount
val cashTotal = order.total - surcharge
```

**Correct pattern:**
```kotlin
val cashTotal = order.total
val cardTotal = order.total + surcharge
```

---

## Touch & UI Rules

- Min **48×48dp** touch targets everywhere
- No hover-dependent interactions (no tooltips, no hover menus)
- All lists support pull-to-refresh
- Offline indicators must be prominent and immediate
- `SharedFlow` buffers: capacity = 64, overflow = `DROP_OLDEST`

---

## APK Self-Update via GitHub Releases

- App checks `GitHub releases/latest` on every login
- Mission Control can push `FORCE_UPDATE_APK` via socket to force immediate update on all devices

| Repo | Commit |
|------|--------|
| POS | `e53e27b` |
| Android | `8224966` |
| Mission Control | `3da5852` |

---

## Key Files in POS Repo (Android depends on)

| File | Purpose |
|------|---------|
| `src/app/api/sync/bootstrap/route.ts` | Initial data load |
| `src/app/api/sync/delta/route.ts` | Incremental sync |
| `src/app/api/sync/outbox/route.ts` | Mutation upload |
| `src/app/api/order-events/batch/route.ts` | Event-sourced order sync |
| `src/app/api/sync/events/route.ts` | Event replay (paginated) |
| `src/app/api/sync/pair-native/route.ts` | Device pairing |
| `src/app/api/sync/heartbeat-native/route.ts` | Heartbeat |
| `src/lib/order-events/types.ts` | Shared event type definitions |
| `src/lib/order-events/emitter.ts` | `serverSequence` assignment |
| `server.ts` | Socket auth middleware (`deviceToken`) |

---

## Checklist: Adding a New Feature with Android Impact

- [ ] Touch targets ≥ 48×48dp
- [ ] No hover interactions
- [ ] Dual pricing: `cashTotal = order.total`, `cardTotal = order.total + surcharge`
- [ ] New order mutations go through event types (not direct writes)
- [ ] New event types added to `src/lib/order-events/types.ts` and 17-type list above
- [ ] New sync endpoints documented in the API table above
- [ ] Socket events scoped by `locationId` (never global broadcast)
- [ ] Offline behavior tested (outbox queues, not drops)
