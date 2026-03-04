# Feature: KDS (Kitchen Display System)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find KDS → read every listed dependency doc.

## Summary
The Kitchen Display System displays real-time order tickets to kitchen and bar staff on dedicated screens. Items route to stations via a tag-based routing engine — each menu item/category carries route tags (e.g., "grill", "pizza", "expo") and KDS screens subscribe to specific tags. Staff bump individual items or entire orders as completed. The system uses Socket.io for sub-50ms latency updates and supports device pairing with security tokens, an entertainment KDS dashboard, and expo station with all-item visibility.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, KDS display, socket events, device pairing | Full |
| `gwi-android-register` | KDS status events, item bump status in orders | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| KDS | `/kds` → `src/app/(kds)/kds/page.tsx` | Kitchen/Bar staff |
| KDS Pair | `/kds/pair` → `src/app/(kds)/kds/pair/page.tsx` | Managers (setup) |
| Entertainment KDS | `/entertainment` → `src/app/(kds)/entertainment/page.tsx` | Entertainment staff |
| Admin | Hardware settings for KDS screen configuration | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(kds)/kds/page.tsx` | Main KDS display with auth flow |
| `src/app/(kds)/kds/pair/page.tsx` | Device pairing code entry |
| `src/app/(kds)/entertainment/page.tsx` | Entertainment KDS dashboard |
| `src/app/(kds)/layout.tsx` | KDS layout wrapper |
| `src/app/(kds)/error.tsx` | KDS error boundary |
| `src/app/api/kds/route.ts` | KDS tickets endpoint |
| `src/app/api/kds/expo/route.ts` | Expo station tickets |
| `src/app/api/hardware/kds-screens/` | KDS screen management (GET/POST) |
| `src/app/api/hardware/kds-screens/[id]/generate-code/` | Generate pairing code |
| `src/app/api/hardware/kds-screens/pair/` | Complete device pairing |
| `src/app/api/hardware/kds-screens/auth/` | Verify device token |
| `src/hooks/useKDSSockets.ts` | KDS socket hook for real-time updates |
| `src/lib/realtime/` | Socket providers and event types |
| `src/lib/socket-dispatch.ts` | `dispatchOrderBumped()` — KDS bump dispatch to expo + location |

---

## API Endpoints

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

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `kds:ticket-new` | `{ orderId, stationId, items, ... }` | New ticket sent to kitchen |
| `kds:ticket-bumped` | `{ orderId, stationId }` | Full ticket completed at station |
| `kds:item-bumped` | `{ orderId, itemId, stationId }` | Single item bumped |
| `kds:order-bumped` | `{ orderId, stationId, bumpedBy, allItemsServed }` | Order bumped from station (sent to expo + location) |

### Socket Rooms
| Room | Subscribers | Events Received |
|------|------------|-----------------|
| `tag:{tagName}` | KDS screens subscribed to that tag | `kds:ticket-new`, `kds:item-bumped`, `kds:order-bumped` |
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

---

## Business Logic

### Primary Flow — Send to Kitchen
1. Server sends order → `ORDER_SENT` event emitted
2. Routing engine evaluates each item's `routeTags` (item-level overrides category-level)
3. Tickets dispatched to KDS screens subscribed to matching tags via socket rooms
4. `kds:ticket-new` socket event sent to `tag:{tagName}` rooms

### Item Bump
1. Kitchen staff taps item on KDS screen → marks individual item as completed
2. `kds:item-bumped` emitted to tag rooms
3. When all items at a station are bumped → `kds:ticket-bumped` emitted

### Order Bump
1. When ALL items across ALL stations are completed (or staff manually bumps entire order)
2. `dispatchOrderBumped()` sends `kds:order-bumped` to both expo tags and location room
3. Order status updated to reflect completion

### Device Pairing Flow
1. Manager creates KDS screen in hardware settings → assigns station tags
2. Manager generates 6-digit pairing code via `/api/hardware/kds-screens/[id]/generate-code`
3. KDS device navigates to `/kds/pair`, enters code
4. Device receives auth token via `/api/hardware/kds-screens/pair`
5. Token stored locally, used for all subsequent API and socket auth

### Edge Cases & Business Rules
- **Tag-based routing**: Items route by tags, not just station assignment — supports complex routing (e.g., item with tags `["grill", "expo"]` appears on both)
- **Expo station**: `showAllItems = true` — sees all tickets regardless of tags
- **Print API fire-and-forget**: `printKitchenTicket()` MUST be fire-and-forget (7+ second TCP timeout if printer offline)
- **Entertainment KDS**: Separate dashboard at `/entertainment` for timed rental status
- **Modifier depth**: KDS displays modifiers with depth indentation for readability
- **30s fallback polling**: KDS uses socket-first with 30s polling safety net

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Bump status syncs back to order items |
| Entertainment | Entertainment KDS dashboard shows session status |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Send-to-kitchen triggers ticket creation |
| Hardware | Device pairing, printer routing |
| Menu | Modifier depth display, tag-based routing config |
| Roles | Station assignment permissions |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does send-to-kitchen event payload match KDS expectations?
- [ ] **Hardware** — does device pairing change affect KDS auth?
- [ ] **Menu** — does route tag change affect ticket distribution?
- [ ] **Socket** — does this change require new/updated KDS events?
- [ ] **Offline** — KDS requires socket; what fallback exists?

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
- Device token stored locally — clearing browser data requires re-pairing
- Expo station auto-shows all items regardless of tag subscription

---

## Android-Specific Notes
- Android receives KDS status events (`kds:item-bumped`, `kds:order-bumped`)
- Order detail view shows per-item bump status from KDS events
- No full KDS display on Android — KDS runs on dedicated web tablets/screens

---

## Related Docs
- **Domain doc:** `docs/domains/KDS-DOMAIN.md`
- **Socket guide:** `docs/guides/SOCKET-REALTIME.md`
- **Skills:** Skill 23, 25, 67, 98, 102, 201, 202, 203
- **Changelog:** `docs/changelogs/KDS-CHANGELOG.md`

---

*Last updated: 2026-03-03*
