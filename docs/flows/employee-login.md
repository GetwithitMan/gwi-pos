# Flow: Employee Login

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches PIN authentication, permission loading, terminal registration, or Android bootstrap, read this doc first.

---

## 1. Purpose

**Trigger:** An employee approaches a POS terminal (web browser kiosk or Android register) and enters their 4-digit PIN to begin a shift.

**Why it matters:** Reporting integrity and security — login establishes the `locationId` scope for all subsequent queries, loads the employee's permission set that gates every sensitive action, and registers the terminal in `connectedTerminals` for connectivity tracking. A login defect can either lock out staff or grant unauthorized access.

**Scope:** `gwi-pos` NUC API (authority), web POS kiosk and `gwi-android-register` (both initiators), `gwi-pos` Socket.io (terminal registration).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | None required; `requiresPinChange` flag forces PIN update on first login |
| Hardware required | NUC reachable on local WiFi; Android additionally requires paired `Terminal` record with `deviceToken` |
| Permissions required | None to log in; permissions are LOADED as a result of login |
| Online / offline state | NUC must be reachable for PIN validation. If `isUnavailablePhase = true` (10s no heartbeat), Android blocks login via `PinLoginViewModel`. Web POS shows full-screen UNAVAILABLE lock. |
| Prior state | Employee record must exist with `isActive = true`, `deletedAt = null`, and `pin` (hashed). Employee must belong to the same `locationId` as the terminal. |

---

## 3. Sequence (Happy Path)

```
1. [CLIENT]     Employee taps PIN digits on web POS PIN pad or Android PinLoginScreen.kt
                → 4-digit PIN assembled locally (never persisted, never logged)

2. [CLIENT]     Android only: Check connectivity state
                → ConnectivityWatcherImpl checks isUnavailablePhase (10s heartbeat gap)
                → If isUnavailablePhase = true → PinLoginViewModel blocks submission,
                  shows UnavailableOverlay composable
                → If Green or Amber → proceed

3. [CLIENT]     PIN submitted:
                Web: POST /api/auth/login  { pin }
                     Credential: session cookie / header
                Android: POST /api/auth/login  { pin, deviceToken }
                     Auth: Bearer deviceToken in Authorization header

4. [API]        src/app/api/auth/login/route.ts
                → withVenue() resolves locationId from session (web) or deviceToken (Android)
                → db.employee.findFirst({
                    where: { locationId, isActive: true, deletedAt: null }
                  })
                → bcrypt.compare(submittedPin, employee.pin)
                → On mismatch: increment attempt counter, return 401
                → On match: continue

5. [API]        Load employee permissions:
                → db.role.findUnique({ where: { id: employee.roleId } })
                → role.permissions (JSON array of permission key strings)
                → hasPermission() / requirePermission() logic available for all
                  subsequent API calls during this session
                → If employee.requiresPinChange = true → return 200 with
                  { requiresPinChange: true } — client redirects to PIN change screen

6. [API]        Response: employee record + role + permissions array
                → { id, firstName, lastName, displayName, roleId, permissions,
                    posLayoutSettings, defaultScreen, defaultOrderType }
                → PIN field is NEVER returned in any response

7. [CLIENT]     Web POS: session established, permissions stored in Zustand store
                → UI shows/hides actions based on permission keys
                → Employee routed to defaultScreen (orders | bar | kds)

8. [CLIENT]     Android only: BootstrapWorker runs after successful PIN auth
                → GET /api/sync/bootstrap (Bearer deviceToken)
                → Downloads: full OrderSnapshot set, open orders, menu, employees,
                  settings, floor plan, tables, CfdSettings
                → Stores to Room DB (SQLite)
                → OrderReducer.reduce() applied to existing event log
                → CachedOrderEntity populated for all open orders

9. [BROADCAST]  Socket registration (web and Android):
                Web: socket.emit('join:location', { locationId })
                Android: socket connects with { auth: { deviceToken } }
                         server.ts middleware validates deviceToken
                         → socket.join(`location:${locationId}`)
                         → connectedTerminals.set(terminalId, { socketId, locationId, lastSeenAt })

10. [BROADCAST] Server emits terminal:status_changed to location room:
                → emitToLocation(locationId, 'terminal:status_changed',
                    { terminalId, isOnline: true, lastSeenAt: NOW(), source: 'connect' })
                → /terminals page updates to show terminal as online
                → Toast notification if terminal was previously offline

11. [SIDE EFFECTS] Android heartbeat loop starts:
                → ConnectivityWatcherImpl: POST /api/hardware/terminals/heartbeat-native
                  every 30 seconds
                → Server updates Terminal.isOnline = true, Terminal.lastSeenAt = NOW()
                → If NUC response gap > 3s → Amber banner
                → If NUC response gap > 10s → isUnavailablePhase = true → UnavailableOverlay
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `terminal:status_changed` | `{ terminalId, isOnline: true, lastSeenAt, source: 'connect' }` | POS socket-server.ts | `/terminals` page, managers monitoring fleet | On socket connect (step 9) |
| `employee:clock-changed` | `{ employeeId }` | POS API (time-clock route) | Dashboard clock indicators | On clock-in (separate action after login) |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Terminal` | `isOnline: true`, `lastSeenAt: NOW()` | Step 9 (socket connect) and every heartbeat |
| `Employee` | `requiresPinChange` checked (no write on login) | Step 5 |
| Zustand store (web) | `currentEmployee`, `permissions`, `locationId` | Step 7 |
| Room DB (Android) | All `CachedOrderEntity`, menu, employees populated | Step 8 |
| `connectedTerminals` map (in-memory) | `terminalId → { socketId, locationId, lastSeenAt }` | Step 9 |

**Snapshot rebuild points:** Android `BootstrapWorker` (step 8) triggers full snapshot hydration from event log. No `OrderSnapshot` is written at login time on the NUC; that only happens when order events are processed.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Wrong PIN** | API returns 401. Attempt counter incremented (in-memory or DB). After N failures, account may be locked (409). No detail about which field was wrong is exposed to prevent enumeration. |
| **Employee not found** | Returns 401 with generic "Invalid PIN" message — never "Employee not found" (prevents user enumeration). |
| **Employee at wrong location** | `withVenue()` scopes the query to `locationId` — employee at another location simply not found. Returns 401. |
| **Employee inactive or soft-deleted** | `isActive: false` or `deletedAt != null` → not returned by query → 401. |
| **NUC unreachable (Android)** | `isUnavailablePhase = true` after 10s gap. `PinLoginViewModel` disables submit button and shows `UnavailableOverlay`. Login cannot proceed until heartbeat resumes. |
| **NUC unreachable (web)** | Web POS shows full-screen UNAVAILABLE lock via socket disconnect handler. Taps blocked. |
| **requiresPinChange = true** | API returns 200 with `{ requiresPinChange: true }`. Client redirects to PIN change screen. All other API calls remain blocked until PIN is changed. |
| **Multi-role employee** | If employee has multiple `EmployeeRole` records, login response includes all roles. Client shows role picker modal. Working role stored in session. Permissions come from selected working role ONLY (not union of all roles). |
| **Bootstrap fails on Android** | `BootstrapWorker` retries with exponential backoff. Employee can work from cached Room DB data if `lastSyncedAt` is recent. Full offline mode available for orders already in Room DB. |
| **Duplicate socket connect** | `connectedTerminals` map is keyed by `terminalId`. Second connect for same terminal overwrites previous `socketId`. No duplicate entries. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1] NEVER skip requirePermission() — never use { soft: true }.** Every API route that follows login MUST use `requirePermission(employeeId, locationId, PERMISSIONS.KEY)`. There is no advisory/soft mode. A missing permission check is a security bug, not a style issue.

- **[INVARIANT-2] PIN must be bcrypt-hashed — NEVER stored or logged as plaintext.** The `Employee.pin` field contains a bcrypt hash. The raw PIN is never written to DB, logs, error messages, or API responses. The `pin` field is never returned in any API response.

- **[INVARIANT-3] Every API route must call withVenue() to get locationId.** `getLocationId()` via `withVenue()` is the only way to resolve `locationId`. Never hardcode or accept `locationId` from client request body — the terminal's authenticated context determines it.

- **[INVARIANT-4] Login blocked during isUnavailablePhase on Android.** If `ConnectivityState.isUnavailablePhase = true` (10s without a successful NUC heartbeat), `PinLoginViewModel` MUST block the PIN submission. Allowing login when NUC is unreachable means the session cannot be validated.

- **[INVARIANT-5] Permissions come from working role, not union of all roles.** Multi-role employees select one working role at login. The permission set is exactly that role's `permissions` JSON array. Granting union permissions across all assigned roles would be a privilege escalation bug.

- **[INVARIANT-6] All queries scoped with locationId + deletedAt: null.** After login establishes `locationId`, every subsequent DB query in the session MUST include `locationId` filter and `deletedAt: null` (soft-delete filter). Omitting either allows cross-tenant data leakage or resurrection of deleted records.

- **[INVARIANT-7] roleType and accessLevel are UX-only — never used for auth decisions.** The `Role.roleType` (FOH/BOH/ADMIN) and `Role.accessLevel` (STAFF/MANAGER/OWNER_ADMIN) fields control UI visibility in the role editor. They are NEVER used to gate API access. Only `requirePermission()` against explicit permission keys gates access.

If any invariant is broken, the fix is: trace from the failing API route back to `requirePermission()` in `src/lib/api-auth.ts` and verify it is called before any sensitive DB operation.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/employees.md` | Employee model, PIN auth logic, POS personalization, requiresPinChange |
| `docs/features/roles-permissions.md` | Permission registry, hasPermission() logic, role templates, multi-role |
| `docs/features/time-clock.md` | Clock-in happens immediately after login for most staff; shares PIN auth path |
| `docs/features/hardware.md` | Terminal model, deviceToken auth, heartbeat-native, connectedTerminals tracking |
| `docs/features/offline-sync.md` | BootstrapWorker sequence on Android login, delta sync, Room DB hydration |
| `docs/guides/ARCHITECTURE-RULES.md` | Offline-first rules, withVenue() requirement, clock discipline, DB ownership |

### Features Involved
- **Employees** — PIN validation, employee record, posLayoutSettings, requiresPinChange
- **Roles & Permissions** — role loaded at login, permissions array gates all subsequent actions
- **Time Clock** — clock-in typically follows immediately after login; shares employee PIN context
- **Hardware** — terminal deviceToken auth (Android), heartbeat-native loop, connectedTerminals map, terminal:status_changed broadcast
- **Offline Sync** — Android BootstrapWorker downloads full snapshot on login; delta sync fills gaps on reconnect

---

*Last updated: 2026-03-03*
