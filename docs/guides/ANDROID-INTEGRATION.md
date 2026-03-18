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

## Tax-Inclusive Pricing (Bootstrap Fields)

Bootstrap sends these fields for Android to compute tax locally:

| SyncMeta Key | Type | Source | Purpose |
|--------------|------|--------|---------|
| `taxRate` | `Double` | `settings.tax.defaultRate / 100` | Exclusive tax rate (decimal, e.g. 0.08) |
| `inclusiveTaxRate` | `Double` | Sum of inclusive TaxRule rates | Inclusive tax rate (decimal, e.g. 0.07) |
| `taxInclusiveLiquor` | `Boolean` | Derived from TaxRules with `isInclusive` + liquor/drinks categories | Whether liquor/drinks prices include tax |
| `taxInclusiveFood` | `Boolean` | Derived from TaxRules with `isInclusive` + food/pizza/combos categories | Whether food prices include tax |

### How Android Uses These

1. **At item creation** (`AddItemUseCase`): `TaxInclusionResolver.resolve(categoryType, taxInclusiveLiquor, taxInclusiveFood)` stamps `isTaxInclusive` on the `ItemAdded` event payload
2. **In `recomputeTotals()`** (`OrderState`): `TaxSplitHelper.compute(inclSub, exclSub, discountTotal, exclRate, inclRate)` splits tax into two buckets
3. **In checkout** (`DefaultCheckoutEvaluationEngine`): Same `TaxSplitHelper` for card/cash pricing with surcharge

### Key Rules
- `isTaxInclusive` is locked at item creation — the reducer trusts the event payload, no live menu lookups
- Items with no category default to `false` (exclusive)
- `total = subtotal + exclusiveTax - discount` — inclusive tax is NOT added to total
- When inclusive flags change in bootstrap, `BootstrapWorker` triggers a one-time projection rebuild for open orders
- Rate-only changes do NOT require rebuild (rates are read fresh from SyncMeta on every order reload)

### Category Type Mapping
| Flag | Category Types | When `true` |
|------|---------------|-------------|
| `taxInclusiveLiquor` | `liquor`, `drinks` | Prices include tax |
| `taxInclusiveFood` | `food`, `pizza`, `combos` | Prices include tax |
| *(neither)* | `entertainment`, `retail` | Always exclusive |
| *(no category)* | Manual charges, open items | Always exclusive |

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

## Android Screens & Features (2026-03-03)

### MyTipsScreen

Accessible from the hamburger menu. Two tabs: **Pending Tips** and **My Tips**.

| Detail | Value |
|--------|-------|
| Route | `my_tips/{employeeId}` |
| ViewModel | `MyTipsViewModel.kt` |
| Screen | `MyTipsScreen.kt` |
| Tip entry | `TipEntrySheet.kt` |

**API endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tips/pending-tips` | GET | Unclaimed tips for employee |
| `/api/tips/recorded-tips` | GET | Previously recorded tips |
| `/api/tips/adjustments` | POST | Submit tip adjustment |

### DB Migration 34→35

- Added `tabNickname TEXT` column to `cached_orders` table
- Migration class: `MIGRATION_34_35` in `DatabaseModule.kt`
- `CachedOrderEntity` now has `tabNickname: String? = null`

### Payment Animation Overlay

`PaymentSheet.kt` now includes a full-screen animated overlay for payment feedback.

| State | Visual | Behavior |
|-------|--------|----------|
| Processing | Blue pulse animation | Shown while waiting for Datacap response |
| Approved | Green bounce animation | Auto-dismisses after 1.5s |
| Declined | Red shake animation | Tap to dismiss |

**ViewModel pattern:** Set `paymentApprovedAmountCents` or `paymentDeclineReason` instead of immediately dismissing the sheet. The overlay is controlled by `AnimatedVisibility` in `PaymentSheet.kt`.

---

## Client-Generated Item IDs (CRITICAL)

All item add requests from Android MUST include a `lineItemId` (UUID v4) in the request body. The server uses this as the OrderItem's primary key. This enables idempotent dedup between the server-created item and the client's local event.

The flow:
1. Android generates `lineItemId = UUID.randomUUID().toString()` in `AddItemUseCase`
2. Sends it in `OrderItemRequest.lineItemId` via `POST /api/orders/{id}/items`
3. NUC creates `OrderItem` with `id = lineItemId`
4. Android creates local `ITEM_ADDED` event with the same `lineItemId`
5. Socket echo arrives → `INSERT OR IGNORE` → no duplicate

**Without `lineItemId`, the server generates a cuid and the client generates a UUID — causing duplicate items.**

See `docs/guides/STABLE-ID-CONTRACT.md` for the full contract.

---

## Pizza Builder (Android Native — 2026-03-17)

Both Register and PAX have full native pizza builders.

### Bootstrap: toppingCategory Enrichment
The NUC bootstrap (`/api/sync/bootstrap`) enriches modifier data with `toppingCategory` sourced from `PizzaTopping` records. This field is stored on the local `ModifierEntity` (Room) and used to render topping category tabs in the pizza builder UI.

### pizzaConfig Format
Android sends a `pizzaConfig` JSON that supports both legacy and new formats:
- **Legacy:** `sauceId`, `cheeseId` (single string, backward compat)
- **New:** `sauces[]`, `cheeses[]` (array of `{id, name, partition}` for multi-condiment support)

The server accepts both. `buildPizzaConfig()` in `CondimentHelpers.kt` produces both fields simultaneously.

### Partition Modes
Condiments (sauces + cheeses) support partition modes: `whole`, `left`/`right` (halves), `left`/`center`/`right` (thirds). These define which portion of the pizza the condiment covers.

### Room Migrations
- Register: v51 (`toppingCategory TEXT` on modifier entity)
- PAX: v50 (`toppingCategory TEXT` on modifier entity)

---

## KDS Android App (`gwi-kds-android`)

The Kitchen Display System is a separate native Android app, distinct from the POS Register app (`gwi-android-register`).

### Project Details
| Detail | Value |
|--------|-------|
| Repo | `gwi-kds-android` |
| Path | `/Users/brianlewis/Documents/My websites/GWI-POS FULL/gwi-kds-android` |
| Modules | `:app`, `:core`, `:feature-foodkds`, `:feature-pitboss` |
| Tech | Kotlin, Jetpack Compose, Hilt DI, Retrofit 2, Socket.IO, Room DB, Moshi |
| Min SDK | 26 |
| Target SDK | 36 |

### Build Flavors
| Flavor | Application ID | Purpose |
|--------|---------------|---------|
| **FoodKDS** | `com.gwi.kds.foodkds` | Kitchen/bar ticket display, bump, routing, expo |
| **PitBoss** | `com.gwi.kds.pitboss` | Entertainment/timed rental management |

### How KDS Connects to NUC
The Android KDS app connects to the same NUC server as the Register app:
- **REST API** (Retrofit 2) — ticket fetch, bump commands, device pairing via `/api/kds/*` and `/api/hardware/kds-screens/*`
- **WebSocket** (Socket.IO) — real-time updates using device token auth (same pattern as Register)

### Socket Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `kds:order-received` | Server → KDS | New order ticket arrives |
| `kds:item-status` | KDS → Server | Item bump status update |
| `kds:order-bumped` | Bidirectional | Order bumped at a station |
| `kds:order-forwarded` | Server → KDS | Order forwarded via screen link chain |
| `kds:multi-clear` | Server → KDS | Bulk clear of completed tickets |

### KDS Overhaul Features
- Screen communication (linked screen chains with send_to_next and multi_clear)
- Display modes (configurable layout per screen)
- Per-order-type timing (different thresholds for dine-in, takeout, delivery)
- All-day counts (running item totals for the business day)
- Order tracker (visual progress through screen chain)
- Keyboard/bump bar navigation (physical input support)
- Print on bump (automatic kitchen ticket print)
- SMS on ready (customer notification at final bump)
- Forward state persistence (kdsForwardedToScreenId, kdsFinalCompleted)

### Web KDS Fallback
The web-based KDS pages at `src/app/(kds)/` still exist as a fallback for venues without Android KDS hardware. The Android app is the primary and recommended KDS client.

### Build Commands
```bash
cd /path/to/gwi-kds-android
./gradlew :app:assembleFoodkdsDebug    # FoodKDS debug APK
./gradlew :app:assemblePitbossDebug    # PitBoss debug APK
./gradlew :app:assembleFoodkdsRelease  # FoodKDS release APK
./gradlew :app:assemblePitbossRelease  # PitBoss release APK
./gradlew test                         # Run unit tests
```

### Impact on NUC Changes
When modifying NUC server code that affects KDS:
- Changes to `/api/kds/*` routes affect both Android KDS and web fallback
- Changes to socket events (`kds:*`) require corresponding updates in `gwi-kds-android`
- Changes to device pairing flow affect both KDS and Register apps
- Changes to ticket data shape require Moshi model updates in `gwi-kds-android/core/`

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
- [ ] Tax-inclusive: new items stamp `isTaxInclusive` from category + bootstrap flags
- [ ] Tax-inclusive: any new `taxTotal` write also writes `taxFromInclusive` + `taxFromExclusive`
