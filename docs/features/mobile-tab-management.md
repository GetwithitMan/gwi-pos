# Feature: Mobile Tab Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Mobile Tab Management → read every listed dependency doc.

## Summary
Mobile Tab Management is a bartender/server-facing progressive web app (PWA) that runs on any phone browser. Staff authenticate via PIN, then view their open and closed tabs, see live item counts and totals, and take quick actions — close a tab, transfer a tab, or alert the manager — all without walking back to the POS terminal. Actions are sent over Socket.io from the phone directly to the bound POS terminal, which executes the operation and replies with the result. The mobile app also exposes a schedule view for the authenticated employee.

## Status
`Active`

---

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API routes, mobile web pages, socket relay, schema | Full |
| `gwi-android-register` | None — mobile web is the phone client | None |
| `gwi-cfd` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Mobile login | `/mobile/login?locationId=[id]` → `src/app/(mobile)/mobile/login/page.tsx` | Any employee with a PIN |
| Mobile tab list | `/mobile/tabs?locationId=[id]` → `src/app/(mobile)/mobile/tabs/page.tsx` | Authenticated employees |
| Mobile tab detail | `/mobile/tabs/[id]` → `src/app/(mobile)/mobile/tabs/[id]/page.tsx` | Authenticated employees |
| Mobile schedule | `/mobile/schedule?locationId=[id]` → `src/app/(mobile)/mobile/schedule/page.tsx` | Authenticated employees |

The entry URL (including `locationId`) is typically delivered via a QR code posted at the venue. The mobile route group is `src/app/(mobile)/` with its own `layout.tsx`.

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(mobile)/mobile/layout.tsx` | Mobile route group layout |
| `src/app/(mobile)/mobile/login/page.tsx` | PIN entry screen; calls `/api/mobile/device/register` |
| `src/app/(mobile)/mobile/tabs/page.tsx` | Tab list with Open/Closed toggle, Mine/All filter, age/status filters, socket-driven refresh |
| `src/app/(mobile)/mobile/tabs/[id]/page.tsx` | Tab detail view: items, cards, totals, bottle service, mounts `MobileTabActions` |
| `src/app/(mobile)/mobile/schedule/page.tsx` | Employee schedule view |
| `src/app/api/mobile/device/register/route.ts` | POST — PIN auth, creates/updates `RegisteredDevice`, creates `MobileSession`, sets httpOnly cookie |
| `src/app/api/mobile/device/auth/route.ts` | GET — validates session cookie or `x-mobile-session` header; returns `employeeId` and role |
| `src/app/api/mobile/schedule/route.ts` | GET — returns upcoming published shifts for an `employeeId` |
| `src/components/mobile/MobileTabActions.tsx` | Close / Transfer / Alert Manager action panel; emits socket events; listens for `tab:closed` and `tab:status-update` |
| `src/components/mobile/MobileOrderCard.tsx` | Order summary card for the tab list |
| `src/components/mobile/MobileTabCard.tsx` | Alternate tab card component |
| `src/types/multi-surface.ts` | Type definitions for all mobile socket events (`MOBILE_EVENTS` constants, `TabCloseRequestEvent`, `TabClosedEvent`, `TabStatusUpdateEvent`, `TabItemsUpdatedEvent`) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/mobile/device/register` | None (open — PIN is the credential) | Verifies employee PIN via bcrypt; creates/updates `RegisteredDevice`; creates `MobileSession` (8h); sets `mobile-session` httpOnly cookie |
| `GET` | `/api/mobile/device/auth` | `mobile-session` cookie or `x-mobile-session` header | Validates session; returns `employeeId`, employee name, role |
| `GET` | `/api/mobile/schedule` | Location-scoped | Returns upcoming published shifts for a given `employeeId` and `locationId` (defaults to 2 weeks ahead) |
| `GET` | `/api/orders/open` | — | Tab list page fetches open orders via this shared route with `summary=true` |
| `GET` | `/api/orders/closed` | — | Tab list page fetches closed orders via this shared route with date presets |
| `GET` | `/api/orders/[id]` | — | Tab detail page fetches full order including items and cards |

Tab actions (close, transfer, alert) are not REST calls — they are sent as socket events directly from the mobile client.

---

## Socket Events

All mobile socket events are defined in `src/types/multi-surface.ts` under `MOBILE_EVENTS`.

### Phone → POS Terminal
| Event | Constant | Payload | Trigger |
|-------|----------|---------|---------|
| `tab:close-request` | `MOBILE_EVENTS.TAB_CLOSE_REQUEST` | `{ orderId, tipMode: 'device' \| 'receipt', employeeId }` | Employee taps "Close Tab" and confirms |
| `tab:transfer-request` | `MOBILE_EVENTS.TAB_TRANSFER_REQUEST` | `{ orderId, employeeId }` | Employee taps "Transfer Tab" and confirms |
| `tab:alert-manager` | `MOBILE_EVENTS.TAB_ALERT_MANAGER` | `{ orderId, employeeId }` | Employee taps "Alert Manager" and confirms (fire-and-forget, no reply expected) |

### POS Terminal → Phone
| Event | Constant | Payload | Trigger |
|-------|----------|---------|---------|
| `tab:closed` | `MOBILE_EVENTS.TAB_CLOSED` | `{ orderId, success, amount, tipAmount?, error? }` | POS completes (or fails) tab close |
| `tab:status-update` | `MOBILE_EVENTS.TAB_STATUS_UPDATE` | `{ orderId, status, tabName?, total? }` | POS notifies phone of tab state change |
| `tab:items-updated` | `MOBILE_EVENTS.TAB_ITEMS_UPDATED` | `{ orderId, itemCount }` | Defined in types; not currently emitted from socket-server (dead code / stub for future use) |

### Tab List Socket Refresh (standard POS events)
The mobile tab list also subscribes to general POS order events to keep the list current:
| Event | Action |
|-------|--------|
| `orders:list-changed` | Delta remove if `trigger = 'paid' \| 'voided'`; else debounced full refresh |
| `order:created` | Debounced refresh |
| `order:updated` | Debounced refresh |
| `payment:processed` | Debounced refresh |
| `tab:updated` | Debounced refresh |

**Note on relay:** `tab:close-request`, `tab:transfer-request`, and `tab:alert-manager` are NOT found in `src/lib/socket-server.ts` — the socket-server does not register handlers for these events. The events are emitted from the phone but must be received by a POS terminal client that has registered its own listeners. The relay mechanism between phone and terminal is client-side (both join the same location room) rather than server-mediated.

---

## Data Model

### MobileSession
```
MobileSession {
  id            String           // cuid
  locationId    String           // Multi-tenant scope
  deviceId      String           // FK to RegisteredDevice
  employeeId    String           // FK to Employee
  sessionToken  String  @unique  // 256-bit random hex token
  expiresAt     DateTime         // 8 hours from creation
  createdAt     DateTime
  updatedAt     DateTime
  revokedAt     DateTime?        // Set on explicit revoke
  deletedAt     DateTime?
  syncedAt      DateTime?
}
```

### RegisteredDevice
```
RegisteredDevice {
  id                String           // cuid
  locationId        String
  name              String           // "Sarah's iPhone" (defaults to "Mobile Device")
  deviceType        String           // "phone" | "tablet"
  deviceFingerprint String?          // Browser fingerprint (optional)
  registeredById    String           // Employee who first registered this device
  isActive          Boolean
  lastSeenAt        DateTime
  sessions          MobileSession[]
}
```

Session tokens are stored as plain hex in the DB. The httpOnly cookie path is `/mobile`, so it does not expose to non-mobile routes.

---

## Business Logic

### Authentication Flow
1. Employee scans QR code containing `https://[nuc-ip]/mobile/login?locationId=[id]`
2. Login page renders a numeric PIN pad (4–6 digits)
3. `POST /api/mobile/device/register` is called with `{ pin, locationId }`
4. Server iterates all active employees for the location, comparing PIN via `bcrypt.compare`
5. On match:
   - `RegisteredDevice` is found by `deviceFingerprint` or created
   - `MobileSession` is created with a 256-bit random token, expires in 8 hours
   - httpOnly `mobile-session` cookie is set (path: `/mobile`)
6. Client redirects to `/mobile/tabs?locationId=[id]`

### Auth Check on Every Protected Page
Each protected mobile page (tabs list, tab detail) calls `GET /api/mobile/device/auth` on mount. If the session is missing or expired, the page immediately redirects to `/mobile/login?locationId=[id]`.

### Tab List
- Fetches open orders via `GET /api/orders/open?summary=true`
- Filters: Mine (employee match) / All, Open / Closed, age preset (All / Today / Previous Day / Declined)
- Declined = `isCaptureDeclined = true` on the order — surfaces walkout/failed-capture tabs
- Subscribes to socket events for real-time updates (debounced 300ms)
- Polling fallback at 20s intervals when socket is disconnected
- Instant refresh on tab visibility change (`document.visibilitychange`)

### Tab Detail
1. `GET /api/mobile/device/auth` to verify session, extract `employeeId`
2. `GET /api/orders/[id]` to fetch full tab data (items, cards, totals, bottle service)
3. Displays: tab name / nickname, opened time, running total, card badges, bottle service indicator, item list with modifiers, subtotal / tax / tip / authorized amount
4. Mounts `MobileTabActions` component at the bottom

### Tab Actions (MobileTabActions)
All actions follow a three-state confirmation pattern: idle → confirming → processing.

**Close Tab — Device Tip:**
- Emits `tab:close-request` with `tipMode: 'device'`
- POS terminal receives the event and initiates a tip-on-device flow

**Close Tab — Receipt Tip:**
- Emits `tab:close-request` with `tipMode: 'receipt'`
- POS terminal closes without a device tip prompt

**Transfer Tab:**
- Emits `tab:transfer-request`
- POS terminal is expected to handle re-assignment to another employee

**Alert Manager:**
- Emits `tab:alert-manager`
- Fire-and-forget — no `tab:closed` reply expected; UI resets after 1 second
- POS terminal or a manager screen is expected to surface this alert

**Response handling:**
- `tab:closed` event: filtered by `orderId`; shows success or error message for 3 seconds
- `tab:status-update` event: filtered by `orderId`; forwarded to parent page via callback

### Schedule View
- `GET /api/mobile/schedule?employeeId=[id]&locationId=[id]&weeksAhead=2`
- Returns published scheduled shifts for the employee, sorted by date
- Shows date, start/end time, break minutes, role name, and notes

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Tabs | Close and transfer actions originate from mobile |
| Employees | Session-based auth is per-employee, linked to `Employee.pin` |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Tabs | Tab data, lifecycle, and socket events drive the mobile display |
| Orders | Open/closed order list endpoints are shared with POS |
| Scheduling | Published shifts are the data source for the schedule view |
| Payments | Tab close triggers the Datacap capture flow on the terminal side |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Tabs** — does a tab lifecycle change affect socket events the mobile client listens for?
- [ ] **Auth** — does PIN hashing or employee model change affect `bcrypt.compare` in `/api/mobile/device/register`?
- [ ] **Socket events** — `tab:close-request`, `tab:transfer-request`, `tab:alert-manager` must remain stable
- [ ] **Session cookie** — `mobile-session` cookie is path-scoped to `/mobile`; do not widen the path
- [ ] **Orders API** — mobile tab list depends on `GET /api/orders/open` and `GET /api/orders/closed` response shapes

---

## Permissions Required

| Action | Requirement | Notes |
|--------|-------------|-------|
| Login to mobile | Valid employee PIN | Any active employee at the location |
| View tab list | Valid mobile session | No role-level permission beyond being an active employee |
| View tab detail | Valid mobile session | No additional permission |
| Close tab (socket) | Valid mobile session + `employeeId` | Terminal-side execution may enforce its own permission checks |
| Transfer tab (socket) | Valid mobile session + `employeeId` | Terminal-side execution enforces permissions |
| Alert manager (socket) | Valid mobile session | Fire-and-forget; no server-side permission check |
| View schedule | Valid session + `employeeId` | Filtered to the requesting employee's own shifts |

---

## Known Constraints

- **Socket relay is not server-mediated** — `tab:close-request`, `tab:transfer-request`, and `tab:alert-manager` are emitted by the phone client and received directly by POS terminal clients in the same location room. If no POS terminal is connected when the event is emitted, the event is silently lost. There is no server-side acknowledgment, queue, or retry.
- **`tab:items-updated` is not emitted** — the event type and constant are defined in `src/types/multi-surface.ts` but the event is never dispatched from `socket-server.ts` or any server-side code. It is a stub.
- **No session revocation UI** — `MobileSession.revokedAt` exists in the schema but there is no API endpoint or admin page to revoke active sessions.
- **No PIN rate limiting on mobile login** — `POST /api/mobile/device/register` does not enforce brute-force protection. An attacker with access to the login URL could attempt PINs without restriction.
- **Device fingerprint is optional** — `deviceFingerprint` is passed from the browser but is not required. If omitted, a new `RegisteredDevice` is created on each login rather than being matched to an existing one.
- **No QR code generation in the app** — the `locationId`-bearing URL must be distributed out-of-band (printed QR, shared link). There is no admin page that generates the QR code.
- **Schedule view is read-only** — employees can view their upcoming published shifts but cannot request changes, swap shifts, or clock in/out from the mobile app.
- **Tab detail uses the shared `/api/orders/[id]` endpoint** — this is not mobile-specific and returns full order data. There is no mobile-optimized or permission-trimmed tab detail endpoint.

---

## Related Docs
- **Feature doc:** `docs/features/tabs.md`
- **Socket guide:** `docs/guides/SOCKET-REALTIME.md`
- **Multi-surface types:** `src/types/multi-surface.ts`
- **Tab lifecycle flow:** `docs/flows/tab-open-to-close.md`

---

*Last updated: 2026-03-03*
