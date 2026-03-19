# Future Enhancements — GWI POS

## Priority Queue

| # | Feature | Effort | Status | Inspired By |
|---|---------|--------|--------|-------------|
| 1 | KDS Order Accept + Live Status Tracking | ~5 days | Planned | QR ordering flow |
| 2 | AI Menu Digitization | ~8 days | Planned | MenuFoundry |
| 3 | QR Table-Side Self-Ordering | ~15 days | Planned | MenuFoundry |

---

## Feature 1: KDS Order Accept + Live Status Tracking

### Overview
When an order arrives on the KDS, the cook taps "ACCEPT" to acknowledge it. This triggers a 4-stage status pipeline visible on the Order Tracker (customer-facing display) and guest QR status page:

```
New → Accepted → In Progress → Ready
```

- **New**: Order just arrived on KDS (flashing, unacknowledged)
- **Accepted**: Cook tapped Accept — "Your order is being prepared"
- **In Progress**: Cook started marking individual items complete
- **Ready**: Final bump on last screen — "Your order is ready!"

### This Is Optional — Toggle Per Screen

**`orderBehavior.requireAccept: boolean` (default: false)**

When OFF (default): Orders arrive and go straight to the normal bump flow. No accept step. Kitchen works exactly as it does today. Order Tracker shows 2 columns (Preparing/Ready). Zero friction added.

When ON: Orders arrive as "New" (pulsing). Cook must tap Accept before bumping. Order Tracker shows 3 columns. QR guests see granular status.

**Who turns it on:**
- Takeout/counter-service venues (customers waiting, want status visibility)
- QR ordering venues (guest phone needs status updates)
- High-volume kitchens that want accountability (who accepted what, when)

**Who leaves it off:**
- Fast-paced bars (accept step slows things down)
- Small kitchens with 1 cook (everything gets seen immediately)
- Venues not using Order Tracker or QR ordering

### Why This Matters
Right now, bumping is binary — items go from "on screen" to "gone." The customer has no visibility. With accept + live tracking:
- QR ordering customers see real-time status on their phone
- Order Tracker display shows granular progress
- Servers know which orders the kitchen has acknowledged vs sitting unread
- Takeout/delivery customers get accurate "being prepared" notifications

### Schema Changes

**New field on `Order`:**
```
kdsAcceptedAt    DateTime?   // When kitchen first accepted
kdsAcceptedBy    String?     // Employee/screen who accepted
```

**New field on `OrderItem`:**
```
kdsStartedAt     DateTime?   // When cook started this item (tap-to-start)
```

**Migration `082-kds-order-accept.js`:**
- Add `kdsAcceptedAt`, `kdsAcceptedBy` to Order
- Add `kdsStartedAt` to OrderItem

### Status Pipeline Logic

| Condition | Derived Status | Tracker Shows | Socket Event |
|-----------|---------------|---------------|--------------|
| Order has items on KDS, `kdsAcceptedAt` is null | **New** | "Order Received" | (none — already on screen) |
| `kdsAcceptedAt` is set, no items completed | **Accepted** | "Preparing Your Order" | `kds:order-accepted` |
| `kdsAcceptedAt` is set, some items completed | **In Progress** | "Preparing Your Order (2/5 items)" | `kds:item-status` (existing) |
| All items completed on final screen (`kdsFinalCompleted`) | **Ready** | "Your Order is Ready!" | `kds:order-bumped` (existing) |

Status is **derived** — no new enum column. The Order Tracker and QR status page compute it from the fields.

### KDS Changes

#### Server: New Accept Endpoint

**PUT `/api/kds`** — add new action `accept`:
```typescript
action: 'accept'  // New action alongside complete/uncomplete/bump_order/resend
```

Processing:
1. Set `order.kdsAcceptedAt = now`, `order.kdsAcceptedBy = screenId or employeeId`
2. Emit `kds:order-accepted` socket event: `{ orderId, orderNumber, acceptedBy, timestamp }`
3. Fire-and-forget audit log

#### Android KDS: Accept Button (only when `requireAccept == true`)

In `OrderTicketCard.kt`, when `requireAccept` is enabled AND order is **not yet accepted** (`kdsAcceptedAt == null`):
- Show **"ACCEPT"** button (blue) instead of "BUMP ORDER"
- Once accepted: button changes to "BUMP ORDER" (green) as normal
- Visual state: unaccepted orders have a pulsing blue border/glow to grab attention

When `requireAccept` is disabled (default):
- No accept button, no pulsing state — works exactly like today
- "BUMP ORDER" shown immediately as it always has been

In `FoodKdsViewModel`:
- New `acceptOrder(orderId: String)` function
- Calls `api.bumpItems(BumpRequest(itemIds, action = "accept", screenId = ...))`
- Optimistic: locally mark order as accepted

#### Android KDS: Tap-to-Start (optional, per orderBehavior)

If `orderBehavior.tapToStart == true`:
- Tapping an item name sets `kdsStartedAt` on that item
- Visual: item row shows a small timer since start
- This is optional — most kitchens just use accept + bump

### Order Tracker Changes

#### Web (`/kds/order-tracker/page.tsx`)

**When `requireAccept` is ON** — 3 columns:
- **Received** (gray): Orders with `kdsAcceptedAt == null`
- **Preparing** (amber): Accepted, not all items complete. Shows "2 of 5 items ready" + progress bar.
- **Ready** (green): All items `kdsFinalCompleted` — auto-remove after 5 min

**When `requireAccept` is OFF** (default) — 2 columns (no change from today):
- **Preparing** (amber): Orders on KDS, not all complete
- **Ready** (green): All items complete

The Tracker reads the setting and renders 2 or 3 columns accordingly. No customer confusion.

#### Android (`OrderTrackerScreen.kt` + `OrderTrackerViewModel.kt`)
Same adaptive layout — 2 or 3 columns based on setting. Add `kdsAcceptedAt` to `TrackerOrder` model.

### Socket Events

| Event | Payload | Who listens |
|-------|---------|-------------|
| `kds:order-accepted` | `{ orderId, orderNumber, acceptedBy, timestamp }` | Order Tracker, QR guest page, POS terminals |
| `kds:item-status` (existing) | `{ orderId, itemId, status }` | Order Tracker (progress update) |
| `kds:order-bumped` (existing) | `{ orderId, allItemsServed }` | Order Tracker (move to Ready) |

### QR Guest Status Integration

When QR self-ordering is built (Feature 3), the guest's phone shows:
```
✓ Order Placed (#1234)
✓ Kitchen Accepted — preparing your food
● In Progress — 2 of 5 items ready
○ Ready for Pickup
```

The `qr:order-status` socket event carries the derived status. No additional API calls needed — guest page listens to existing events.

### API Changes

| File | Change |
|------|--------|
| `src/app/api/kds/route.ts` | Add `accept` action to PUT handler |
| `src/lib/socket-dispatch.ts` | Add `dispatchOrderAccepted()` |

### Android Changes

| File | Change |
|------|--------|
| `KdsDtos.kt` | Add `kdsAcceptedAt` to `KdsOrderDto` |
| `KdsModels.kt` | Add `kdsAcceptedAt` to `KdsOrder` |
| `FoodKdsViewModel.kt` | Add `acceptOrder()`, update `BumpAction` enum with `ACCEPT` |
| `OrderTicketCard.kt` | Accept button when unaccepted, visual states |
| `BumpControls.kt` | Accept button in controls row |
| `OrderTrackerScreen.kt` | 3-column layout (Received/Preparing/Ready) |
| `OrderTrackerViewModel.kt` | Classify into 3 buckets using `kdsAcceptedAt` |
| `SocketEvents.kt` | Add `KDS_ORDER_ACCEPTED` event name |

### New Files
| File | Purpose |
|------|---------|
| `scripts/migrations/082-kds-order-accept.js` | Add kdsAcceptedAt/By to Order, kdsStartedAt to OrderItem |

### Estimated Effort: ~5 days

### Build Order
1. Migration + schema (0.5 day)
2. Server accept action + socket event (0.5 day)
3. Android accept button + ViewModel (1 day)
4. Order Tracker 3-column update (web + Android) (1.5 days)
5. Tap-to-start (optional) (0.5 day)
6. Testing end-to-end (1 day)

### Why This Should Be Feature #1
This is the **missing link** between the KDS overhaul and the QR ordering feature. Without accept + live status, QR customers would see "Order Placed" and then nothing until "Ready." The accept step gives immediate feedback ("kitchen is on it") and progress tracking gives confidence. It also makes the Order Tracker display actually useful for takeout/counter service — right now it only has Preparing/Ready with no acknowledgment stage.

---

## Feature 2: AI Menu Digitization

### Overview
Restaurant owner uploads a PDF or photo of their existing paper menu. Claude API extracts item names, descriptions, prices, categories, and modifiers. A review UI lets them edit before batch import.

### How It Works
1. **Upload**: Admin drags PDF/JPEG/PNG into upload zone (max 10MB)
2. **AI Extract**: Claude claude-sonnet-4-20250514 vision+text extracts structured menu data
3. **Review**: Editable table with confidence scores per field (green/yellow/red)
4. **Merge**: Match against existing menu items by name, choose skip/update/create
5. **Import**: Single transaction creates Category + MenuItem + PricingOption + ModifierGroup records

### API Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/import/menu-ai/extract` | MENU_EDIT_ITEMS | Upload file, returns extraction JSON |
| POST | `/api/import/menu-ai/confirm` | MENU_EDIT_ITEMS | Accept reviewed data, batch create records |

### Extraction Output Shape
```typescript
interface ExtractionResult {
  categories: ExtractedCategory[]
  totalItems: number
  warnings: string[]
  existingMatches: { extractedName: string; existingId: string }[]
}

interface ExtractedCategory {
  name: string
  confidence: number  // 0-1
  items: ExtractedItem[]
}

interface ExtractedItem {
  name: string
  nameConfidence: number
  description: string | null
  price: number | null
  priceConfidence: number
  variants: { label: string; price: number }[]  // Small/Medium/Large
  modifierGroups: { name: string; options: { name: string; price: number | null }[] }[]
  existingMatch: { id: string; name: string } | null
  flags: string[]  // "low-confidence-price", "possible-duplicate"
}
```

### Merge Modes
- `skip_existing` — Skip if name+category match exists
- `update_prices` — Update price/description of existing, create new
- `create_all` — Always create (allows duplicates)

### Files to Create
| File | Purpose |
|------|---------|
| `src/app/api/import/menu-ai/extract/route.ts` | AI extraction endpoint |
| `src/app/api/import/menu-ai/confirm/route.ts` | Batch import endpoint |
| `src/lib/menu-ai/extraction.ts` | Claude API client, prompt, parser |
| `src/lib/menu-ai/merge.ts` | Existing menu matching + merge |
| `src/app/(admin)/menu/import-ai/page.tsx` | Upload + review UI |
| `src/components/menu/AiExtractionReview.tsx` | Editable review table |
| `src/types/menu-extraction.ts` | Shared types |

### Files to Modify
- `src/lib/settings.ts` — Add `MenuDigitizationSettings`
- `src/app/(admin)/menu/page.tsx` — Add "AI Import" button
- `package.json` — Add `@anthropic-ai/sdk`

### Dependencies
- Anthropic API key (`ANTHROPIC_API_KEY` env var)
- No new migration needed (all state client-side during review)

### Estimated Effort: ~8 days

---

## Feature 2: QR Table-Side Self-Ordering

### Overview
Each table gets a QR code. Guest scans with phone, sees menu in browser (no app download). They browse, add to cart, place order. Order goes to KDS. Guest can reorder and request check. Server handles payment as normal.

### Guest Flow
1. **Scan QR** → `/qr/{locationSlug}/{code}` in phone browser
2. **Welcome**: Venue logo, table name, "View Menu" button
3. **Menu**: Horizontal category tabs, item cards with photos/prices/dietary tags
4. **Item detail**: Bottom sheet with modifiers, variants, special notes, quantity
5. **Cart**: Floating badge, expandable drawer with line items + totals
6. **Order review**: Items, subtotal, tax, total, "Confirm Order"
7. **Status**: Real-time socket updates (Preparing → Ready), "Order More" + "Request Check"

### Schema (Migration 081)
```sql
-- QR table codes
QrTableCode { id, locationId, tableId, code (unique), isActive, scansTotal, lastScannedAt }

-- Guest sessions
QrGuestSession { id, locationId, tableId, orderId?, sessionToken (unique), guestName?, expiresAt }
```

### API Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| **Admin** | | | |
| GET | `/api/qr-ordering/codes` | Manager | List all QR codes |
| POST | `/api/qr-ordering/codes` | Manager | Generate codes for tables |
| DELETE | `/api/qr-ordering/codes/[id]` | Manager | Deactivate code |
| GET | `/api/qr-ordering/codes/print` | Manager | Printable QR sheet |
| **Public** | | | |
| GET | `/api/qr-ordering/menu` | None | Public menu (filtered, dayparted) |
| POST | `/api/qr-ordering/session` | None | Create/resume guest session |
| POST | `/api/qr-ordering/order` | Session | Place order (creates or appends) |
| GET | `/api/qr-ordering/order/[id]/status` | Session | Real-time order status |
| POST | `/api/qr-ordering/order/[id]/request-check` | Session | Notify server |

### Settings (extends existing QrOrderingSettings)
```typescript
// New fields added to existing QrOrderingSettings:
autoAcceptOrders: boolean         // Orders go straight to KDS (default: true)
requireGuestName: boolean         // Ask for name before ordering (default: false)
allowSpecialInstructions: boolean // Show notes field (default: true)
sessionTimeoutMinutes: number     // Session TTL (default: 240)
showItemPhotos: boolean           // Show item images (default: true)
brandColor: string                // Primary accent color
logoUrl: string | null            // Venue logo
welcomeMessage: string            // Top-of-menu message
notifyServerOnOrder: boolean      // Socket event to assigned server (default: true)
```

### Socket Events
| Event | Direction | Purpose |
|-------|-----------|---------|
| `qr:order-placed` | Server → Location | New QR order notification |
| `qr:check-requested` | Server → Location | Guest wants the check |
| `qr:order-status` | Server → Guest | Preparing/Ready updates |

### Key Design Decisions
- **No payment in V1** — server handles payment as normal via POS
- **Multi-guest**: Multiple phones on same table share the same order
- **Dayparting**: Reuses existing `computeIsOrderableOnline()` from online ordering
- **86'd items**: Real-time hide via stock tracking + socket refresh
- **Security**: Rate limiting, session validation, server-side pricing, max items cap
- **No app download**: Pure browser experience (PWA-like)
- **Order type**: `qr_dine_in` — distinct from `dine_in` for reporting

### Files to Create (18)
| File | Purpose |
|------|---------|
| `scripts/migrations/081-qr-ordering.js` | QrTableCode + QrGuestSession tables |
| `src/app/api/qr-ordering/codes/route.ts` | CRUD for QR codes |
| `src/app/api/qr-ordering/menu/route.ts` | Public menu endpoint |
| `src/app/api/qr-ordering/session/route.ts` | Session create/resume |
| `src/app/api/qr-ordering/order/route.ts` | Place order |
| `src/app/api/qr-ordering/order/[id]/status/route.ts` | Order status |
| `src/app/api/qr-ordering/order/[id]/request-check/route.ts` | Request check |
| `src/app/(public)/qr/[slug]/[code]/page.tsx` | Guest menu page |
| `src/app/(public)/qr/[slug]/[code]/layout.tsx` | Public layout |
| `src/components/qr-ordering/QrMenuBrowser.tsx` | Category tabs + item grid |
| `src/components/qr-ordering/QrItemDetail.tsx` | Item detail bottom sheet |
| `src/components/qr-ordering/QrCart.tsx` | Floating cart |
| `src/components/qr-ordering/QrOrderStatus.tsx` | Real-time status |
| `src/components/qr-ordering/QrHeader.tsx` | Branded header |
| `src/hooks/useQrSession.ts` | Session management |
| `src/hooks/useQrSocket.ts` | Socket for status updates |
| `src/stores/qr-cart-store.ts` | Zustand cart state |
| `src/app/(admin)/settings/qr-ordering/page.tsx` | Admin settings + code management |

### Files to Modify
- `src/lib/settings.ts` — Extend QrOrderingSettings
- `src/lib/socket-dispatch.ts` — Add QR socket events
- `prisma/schema.prisma` — Add QrTableCode + QrGuestSession models
- `docs/features/qr-ordering.md` — Update from "Planned"
- `docs/features/_INDEX.md` — Update status

### Integration Points (zero KDS changes needed)
- Orders use standard `Order` model + `emitOrderEvents()` + `dispatchNewOrder()`
- Items route to KDS via `OrderRouter.resolveRouting()` — same as POS
- Inventory deductions at order creation — same as POS
- Pricing rules apply — same engine
- Floor plan table status updates on QR order

### Estimated Effort: ~15 days

---

## Implementation Order

1. **AI Menu Digitization first** (8 days) — standalone, no schema changes, immediate value for onboarding new venues
2. **QR Self-Ordering second** (15 days) — larger scope, needs migration, but transformative for guest experience

## Not Planned (Considered and Rejected)
- **Guest payment via QR** — Datacap is card-present only. Would need a separate gateway (Stripe/PayAPI). Deferred until demand justifies.
- **Guest loyalty/rewards via QR** — Too complex for V1. Can layer on top of QR sessions later.
- **AI-generated item descriptions** — Nice-to-have during digitization but low priority.
