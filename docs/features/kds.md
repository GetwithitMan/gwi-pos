# Feature: KDS (Kitchen Display System)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find KDS → read every listed dependency doc.

## Summary
The Kitchen Display System displays real-time order tickets to kitchen and bar staff on dedicated screens. The **primary KDS client is a native Android app** (`gwi-kds-android`) built with Kotlin/Jetpack Compose. A web-based fallback still exists at `/kds` in the gwi-pos NUC server. Items route to stations via a tag-based routing engine — each menu item/category carries route tags (e.g., "grill", "pizza", "expo") and KDS screens subscribe to specific tags. Staff bump individual items or entire orders as completed. The system uses Socket.io for sub-50ms latency updates and supports device pairing with security tokens, screen-to-screen communication (linked screens), per-order-type timing, all-day counts, order tracker, keyboard/bump bar navigation, print on bump, and SMS on ready.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-kds-android` | **PRIMARY** — Native Android KDS app (FoodKDS + PitBoss) | Full |
| `gwi-pos` | NUC server API routes, socket events, device pairing, web KDS fallback | Full |
| `gwi-android-register` | KDS status events, item bump status in orders | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## Android KDS App (`gwi-kds-android`)

The KDS is a native Android application with two product flavors:

| Flavor | Application ID | Purpose |
|--------|---------------|---------|
| **FoodKDS** | `com.gwi.kds.foodkds` | Kitchen/bar ticket display, bump, routing, expo |
| **PitBoss** | `com.gwi.kds.pitboss` | Entertainment/timed rental management dashboard |

### Modules
| Module | Purpose |
|--------|---------|
| `:app` | Main application entry, Hilt DI setup, build flavor configuration |
| `:core` | Shared data layer — Retrofit 2 API client, Socket.IO client, Room DB, Moshi serialization, domain models, shared UI components |
| `:feature-foodkds` | Food KDS feature — ticket display, item/order bump, screen links, display modes, all-day counts, order tracker, keyboard navigation |
| `:feature-pitboss` | PitBoss feature — timed rental management, entertainment session tracking |

### Tech Stack
- **Language:** Kotlin
- **UI:** Jetpack Compose
- **DI:** Hilt
- **Network:** Retrofit 2 (REST) + Socket.IO (real-time)
- **Local DB:** Room
- **Serialization:** Moshi
- **Min SDK:** 26 | **Target SDK:** 36

### KDS Overhaul Features (10 Phases)
| Feature | Description |
|---------|-------------|
| **Screen Communication** | Linked screens with `send_to_next` and `multi_clear` — tickets flow through a chain of stations |
| **Display Modes** | Multiple layout modes per screen configuration |
| **Per-Order-Type Timing** | Different timing thresholds for dine-in, takeout, delivery, etc. |
| **All-Day Counts** | Running totals of items prepared across the current business day |
| **Order Tracker** | Visual order progress tracking across linked screen chains |
| **Keyboard/Bump Bar Navigation** | Physical keyboard and bump bar support for hands-free operation |
| **Print on Bump** | Automatic kitchen ticket print when an order is bumped |
| **SMS on Ready** | Send SMS notification to customer when order is ready for pickup |
| **Intermediate vs Final Bump** | Bump at a linked screen forwards to next screen; bump at final screen completes the order |
| **Forward State Persistence** | `kdsForwardedToScreenId` and `kdsFinalCompleted` fields track ticket progression |

### Socket Events (Android KDS)
| Event | Direction | Description |
|-------|-----------|-------------|
| `kds:order-received` | Server → KDS | New order/ticket arrives at this screen |
| `kds:item-status` | KDS → Server | Item bump status update |
| `kds:order-bumped` | Bidirectional | Order bumped at a station |
| `kds:order-forwarded` | Server → KDS | Order forwarded from a linked screen |
| `kds:multi-clear` | Server → KDS | Bulk clear of completed tickets across linked screens |

### Build Commands
```bash
cd /path/to/gwi-kds-android
./gradlew :app:assembleFoodkdsDebug    # FoodKDS debug APK
./gradlew :app:assemblePitbossDebug    # PitBoss debug APK
./gradlew :app:assembleFoodkdsRelease  # FoodKDS release APK
./gradlew :app:assemblePitbossRelease  # PitBoss release APK
```

---

## Web KDS Fallback (`gwi-pos`)

The web-based KDS pages still exist as a **fallback** for venues that cannot run the Android app. The Android app is the primary and recommended KDS client.

### UI Entry Points (Web Fallback)

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| KDS (web) | `/kds` → `src/app/(kds)/kds/page.tsx` | Kitchen/Bar staff (fallback only) |
| KDS Pair (web) | `/kds/pair` → `src/app/(kds)/kds/pair/page.tsx` | Managers (setup) |
| Entertainment KDS (web) | `/entertainment` → `src/app/(kds)/entertainment/page.tsx` | Entertainment staff (fallback only) |
| Admin | Hardware settings for KDS screen configuration | Managers |

---

## Code Locations

### gwi-kds-android (PRIMARY)
| Module / Directory | Purpose |
|-------------------|---------|
| `app/` | Main application, Hilt modules, build flavors |
| `core/` | Retrofit API client, Socket.IO, Room DB, domain models, shared Compose components |
| `feature-foodkds/` | FoodKDS ticket UI, bump logic, screen links, all-day counts |
| `feature-pitboss/` | PitBoss entertainment dashboard, session management |

### gwi-pos (NUC Server + Web Fallback)
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(kds)/kds/page.tsx` | Web KDS display with auth flow (fallback) |
| `src/app/(kds)/kds/pair/page.tsx` | Web device pairing code entry (fallback) |
| `src/app/(kds)/entertainment/page.tsx` | Web entertainment KDS dashboard (fallback) |
| `src/app/(kds)/layout.tsx` | KDS layout wrapper |
| `src/app/(kds)/error.tsx` | KDS error boundary |
| `src/app/api/kds/route.ts` | KDS tickets endpoint |
| `src/app/api/kds/expo/route.ts` | Expo station tickets |
| `src/app/api/hardware/kds-screens/` | KDS screen management (GET/POST) |
| `src/app/api/hardware/kds-screens/[id]/generate-code/` | Generate pairing code |
| `src/app/api/hardware/kds-screens/pair/` | Complete device pairing |
| `src/app/api/hardware/kds-screens/auth/` | Verify device token |
| `src/hooks/useKDSSockets.ts` | KDS socket hook for real-time updates (web fallback) |
| `src/lib/realtime/` | Socket providers and event types |
| `src/lib/socket-dispatch.ts` | `dispatchOrderBumped()` — KDS bump dispatch to expo + location |

---

## API Endpoints

These NUC server API endpoints are consumed by both the Android KDS app and the web fallback.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/kds/route.ts` | KDS Token | Active kitchen tickets for station |
| `GET` | `/api/kds/expo` | KDS Token | Expo station tickets (all items) |
| `GET/POST` | `/api/hardware/kds-screens` | Manager | KDS screen management |
| `POST` | `/api/hardware/kds-screens/[id]/generate-code` | Manager | Generate 6-digit pairing code |
| `POST` | `/api/hardware/kds-screens/pair` | Pairing Code | Complete device pairing, returns auth token |
| `GET` | `/api/hardware/kds-screens/auth` | KDS Token | Verify device token validity |

---

## Socket Events

### Emitted (NUC Server → KDS Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `kds:order-received` | `{ orderId, stationId, items, ... }` | New ticket sent to kitchen |
| `kds:ticket-new` | `{ orderId, stationId, items, ... }` | New ticket sent to kitchen (legacy/web) |
| `kds:ticket-bumped` | `{ orderId, stationId }` | Full ticket completed at station |
| `kds:item-bumped` | `{ orderId, itemId, stationId }` | Single item bumped |
| `kds:item-status` | `{ orderId, itemId, status }` | Item status change |
| `kds:order-bumped` | `{ orderId, stationId, bumpedBy, allItemsServed }` | Order bumped from station (sent to expo + location) |
| `kds:order-forwarded` | `{ orderId, fromScreenId, toScreenId }` | Order forwarded through screen link chain |
| `kds:multi-clear` | `{ screenId, orderIds }` | Bulk clear of completed tickets |

### Socket Rooms
| Room | Subscribers | Events Received |
|------|------------|-----------------|
| `tag:{tagName}` | KDS screens subscribed to that tag | `kds:order-received`, `kds:item-bumped`, `kds:order-bumped` |
| `tag:expo` | Expo stations | `kds:order-bumped` (all orders) |
| `location:{locationId}` | All terminals at location | `kds:order-bumped` |

---

## Data Model

Key Prisma models:

```
PrepStation {
  id, locationId, name, displayName, color
  stationType     String    // kitchen | bar | expo | prep
  showAllItems    Boolean   // Expo sees all items (true for expo stations)
  autoComplete    Int?      // Auto-complete after X seconds
  sortOrder, isActive
}

Category {
  routeTags       Json?     // Inherited by items: ["grill", "made-to-order"]
  prepStationId   String?   // Legacy station assignment
}

MenuItem {
  routeTags       Json?     // Override category's tags: ["pizza", "expo-only"]
  prepStationId   String?   // Override category station
}
```

**Note:** No `KdsScreen` or `KdsScreenItem` models were found in schema — KDS screen config is managed via `HardwareDevice` and `KDSScreenStation` relations to `PrepStation`.

### Forward State Fields
| Field | Location | Purpose |
|-------|----------|---------|
| `kdsForwardedToScreenId` | OrderItem / ticket state | Tracks which linked screen a ticket has been forwarded to |
| `kdsFinalCompleted` | OrderItem / ticket state | Marks a ticket as fully completed at the end of the screen chain |

---

## Business Logic

### Primary Flow — Send to Kitchen
1. Server sends order → `ORDER_SENT` event emitted
2. Routing engine evaluates each item's `routeTags` (item-level overrides category-level)
3. Tickets dispatched to KDS screens subscribed to matching tags via socket rooms
4. `kds:order-received` socket event sent to `tag:{tagName}` rooms
5. Android KDS app receives ticket and renders in active queue

### Item Bump
1. Kitchen staff taps item on KDS screen → marks individual item as completed
2. `kds:item-bumped` emitted to tag rooms
3. When all items at a station are bumped → `kds:ticket-bumped` emitted

### Order Bump
1. When ALL items across ALL stations are completed (or staff manually bumps entire order)
2. `dispatchOrderBumped()` sends `kds:order-bumped` to both expo tags and location room
3. Order status updated to reflect completion

### Screen Link Processing (Linked Screens)
1. Screens can be chained (e.g., Grill → Expo → Window)
2. **Intermediate bump (`send_to_next`):** Bumping at a non-final screen forwards the ticket to the next linked screen via `kds:order-forwarded`. The `kdsForwardedToScreenId` field tracks the current screen.
3. **Final bump:** Bumping at the last screen in the chain sets `kdsFinalCompleted = true` and triggers the standard completion flow (`kds:order-bumped`).
4. **Multi-clear (`multi_clear`):** Bulk clear operation that removes completed tickets from all screens in a chain simultaneously.

### Print on Bump
- When an order is bumped (intermediate or final), the system can automatically print a kitchen ticket
- Print is fire-and-forget (7+ second TCP timeout if printer offline)

### SMS on Ready
- When an order reaches final bump, an SMS notification can be sent to the customer
- Uses the customer's phone number from the order or tab
- Configured per-screen in KDS screen settings

### Device Pairing Flow
1. Manager creates KDS screen in hardware settings → assigns station tags
2. Manager generates 6-digit pairing code via `/api/hardware/kds-screens/[id]/generate-code`
3. Android KDS app enters code during setup
4. Device receives auth token via `/api/hardware/kds-screens/pair`
5. Token stored locally in Room DB, used for all subsequent API and socket auth

### Edge Cases & Business Rules
- **Tag-based routing**: Items route by tags, not just station assignment — supports complex routing (e.g., item with tags `["grill", "expo"]` appears on both)
- **Expo station**: `showAllItems = true` — sees all tickets regardless of tags
- **Print API fire-and-forget**: `printKitchenTicket()` MUST be fire-and-forget (7+ second TCP timeout if printer offline)
- **Entertainment KDS (PitBoss)**: Separate Android flavor (`com.gwi.kds.pitboss`) for timed rental status
- **Modifier depth**: KDS displays modifiers with depth indentation for readability
- **30s fallback polling**: KDS uses socket-first with 30s polling safety net
- **Per-order-type timing**: Different timing thresholds for dine-in, takeout, delivery orders
- **All-day counts**: Running item totals for the current business day
- **Keyboard/bump bar**: Physical keyboard input mapped to bump and navigation actions

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Bump status syncs back to order items |
| Entertainment | PitBoss flavor shows entertainment session status |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Send-to-kitchen triggers ticket creation |
| Hardware | Device pairing, printer routing |
| Menu | Modifier depth display, tag-based routing config |
| Roles | Station assignment permissions |
| Delivery | Delivery orders display with delivery-specific timing |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does send-to-kitchen event payload match KDS expectations?
- [ ] **Hardware** — does device pairing change affect KDS auth?
- [ ] **Menu** — does route tag change affect ticket distribution?
- [ ] **Socket** — does this change require new/updated KDS events?
- [ ] **Offline** — KDS requires socket; what fallback exists?
- [ ] **Android KDS** — does this NUC-side change require a corresponding change in `gwi-kds-android`?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View KDS | `KDS_VIEW` | Standard |
| Bump items | `KDS_BUMP` | Standard |
| Configure screens | `HARDWARE_MANAGE` | High |
| Generate pairing code | `HARDWARE_MANAGE` | High |

---

## Known Constraints & Limits
- KDS socket latency target: <50ms
- Print API TCP timeout: 7+ seconds if printer not connected
- Pairing codes are 6-digit, time-limited
- Android KDS stores device token in Room DB — factory reset requires re-pairing
- Web fallback stores token in browser localStorage — clearing browser data requires re-pairing
- Expo station auto-shows all items regardless of tag subscription
- Screen link chains have no cycle detection — do not create circular links

---

## Android-Specific Notes
- **KDS is Android-native** — the `gwi-kds-android` app is the primary KDS client
- Android Register receives KDS status events (`kds:item-bumped`, `kds:order-bumped`) for order detail display
- PitBoss flavor (`com.gwi.kds.pitboss`) replaces the web entertainment KDS dashboard
- FoodKDS flavor (`com.gwi.kds.foodkds`) replaces the web KDS at `/kds`
- Web KDS pages (`src/app/(kds)/`) remain as a fallback for venues without Android KDS hardware

---

## Related Docs
- **Domain doc:** `docs/domains/KDS-DOMAIN.md`
- **Bump flow:** `docs/flows/kds-bump.md`
- **Socket guide:** `docs/guides/SOCKET-REALTIME.md`
- **Android integration:** `docs/guides/ANDROID-INTEGRATION.md`
- **Skills:** Skill 23, 25, 67, 98, 102, 201, 202, 203
- **Changelog:** `docs/changelogs/KDS-CHANGELOG.md`

---

*Last updated: 2026-03-18*
