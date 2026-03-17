# Feature: Audit Trail

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

The Audit Trail is a two-part observability and compliance system. The first part is the **Activity Audit Log** (`AuditLog` model) — a per-location record of employee actions taken inside the POS: logins, voids, comps, refunds, discounts, manager overrides, shift events, menu changes, and settings changes. Managers can browse, filter, and export this log from Admin → Audit. The second part is the **GWIPOS Access Log** — a separate cloud-side log (stored in Neon, not the local NUC) that records every SMS OTP access attempt to the `barpos.restaurant` cloud portal: codes sent, verifications, denials, and blocks. This is visible in Admin → GWIPOS Access and is intended for GWI operators monitoring portal security. Together they provide a forensic audit trail for loss prevention, compliance investigations, and operational accountability.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API (both logs), admin UI (both pages), `AuditLog` model | Full |
| `gwi-android-register` | None (does not write to AuditLog directly) | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | Reads GWIPOS access log via `INTERNAL_API_SECRET` bearer token | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/audit` | Managers only (`manager.shift_review` or `admin.full` permission) |
| Admin | `/gwipos-access` | GWI operators (cloud session or internal token) |

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(admin)/audit/page.tsx` | Activity Audit Log browser: date range, employee, action type filters; paginated table; CSV export |
| `src/app/(admin)/gwipos-access/page.tsx` | GWIPOS Access Log viewer: today's stats + full log; auto-refreshes every 30 seconds |
| `src/app/api/audit/activity/route.ts` | `GET /api/audit/activity` — query `AuditLog` with filters; requires `manager.shift_review` |
| `src/app/api/admin/access-log/route.ts` | `GET /api/admin/access-log` — returns `gwi_access_logs` entries + today's stats; requires cloud session cookie or `INTERNAL_API_SECRET` bearer |
| `src/lib/access-log.ts` | `logAccess()`, `getAccessLogs()`, `getAccessStats()` — Neon-direct SQL for the access log table |
| `src/lib/access-gate.ts` | `signAccessToken()` / `verifyAccessToken()` — HMAC-SHA256 JWT for the `gwi-access` cookie (email-based session, 1-hour lifetime) |

---

## API Endpoints

### Activity Audit Log

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/audit/activity` | `requirePermission(MGR_SHIFT_REVIEW)` | Query `AuditLog` for a location; supports `startDate`, `endDate` (max 31-day span, defaults to last 7 days), `actionType`, `filterEmployeeId`; paginated (`limit` max 200, `offset`) |

### GWIPOS Access Log

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/admin/access-log` | `pos-cloud-session` cookie or `Authorization: Bearer INTERNAL_API_SECRET` | Returns up to 500 `gwi_access_logs` entries (newest-first) and today's stats (total accesses, unique phones, verified count) |

---

## Socket Events

None. Both logs are read-only, query-based; no real-time socket events are emitted.

---

## Data Model

### AuditLog (local NUC Postgres, managed by Prisma)

```
AuditLog {
  id          String      @id cuid
  locationId  String      // always filter by this
  employeeId  String?     // null for system-generated events
  employee    Employee?

  action      String      // see Action Types below
  entityType  String?     // order | payment | employee | menu_item | setting | etc.
  entityId    String?     // ID of the affected record

  details     Json?       // before/after values, amounts, context

  ipAddress   String?     // terminal IP
  userAgent   String?     // browser/app user-agent string

  createdAt   DateTime    @default(now())
  deletedAt   DateTime?   // soft delete
  syncedAt    DateTime?
}
```

### gwi_access_logs (Neon cloud DB, raw SQL — no Prisma model)

```
gwi_access_logs {
  id          TEXT        PRIMARY KEY  default gen_random_uuid()
  phone_mask  TEXT        -- masked phone number (e.g., +1*****1234)
  ip          TEXT        -- requester IP address
  user_agent  TEXT        -- browser/app user-agent
  action      TEXT        -- code_sent | verified | denied | blocked
  created_at  TIMESTAMPTZ default NOW()
}
```

The `gwi_access_logs` table is created automatically on first write via `CREATE TABLE IF NOT EXISTS` in `access-log.ts`. No migration is required. The table lives in the Neon cloud DB (using `ACCESS_DATABASE_URL` env var, falling back to `DATABASE_URL`).

---

## Business Logic

### Activity Audit Log — What Triggers an Entry

The following action types are tracked in `AuditLog` and exposed in the UI filter:

| Action | Trigger |
|--------|---------|
| `login` | Successful employee PIN login |
| `logout` | Employee logs out |
| `login_failed` | Failed PIN attempt |
| `order_created` | New order opened |
| `order_sent` | Order sent to kitchen |
| `order_closed` | Order closed / paid |
| `item_voided` | Order item voided |
| `item_comped` | Order item comped |
| `payment_processed` | Payment completed |
| `payment_refunded` | Payment refunded |
| `manager_override` | Manager overrides an employee action |
| `discount_applied` | Discount applied to order or item |
| `cash_drawer_opened` | Cash drawer opened |
| `shift_started` | Employee shift begins |
| `shift_ended` | Employee shift closes |
| `menu_updated` | Menu item created, edited, or deleted |
| `settings_changed` | Location settings saved |

The `details` JSON field stores context-specific before/after values (e.g., old vs. new price, void reason, discount amount).

### Activity Audit Log — Querying

- Date range defaults to the last 7 days when no filters are applied.
- Maximum query window is 31 days; requests spanning more than 31 days return HTTP 400.
- Results are paginated: 50 entries per page, maximum 200 per request.
- Filterable by: date range, specific employee, specific action type.
- Each row is expandable in the UI to show all `details` JSON key/value pairs.
- Export: the UI generates a client-side CSV download of the current result set (all fields including details as JSON string).

### GWIPOS Access Log — What Is Logged

Every SMS OTP event on the `barpos.restaurant` portal is logged:

| Action | Meaning |
|--------|---------|
| `code_sent` | OTP code was sent to the phone number |
| `verified` | Phone number entered the correct code and gained access |
| `denied` | Code was wrong or expired |
| `blocked` | Too many failures; IP or phone was blocked |

The phone number is stored as a masked string (e.g., `+1*****1234`) — the full number is never persisted. The IP address and user-agent are stored for forensic purposes.

### GWIPOS Access Log — Stats

`getAccessStats()` returns a 24-hour rolling window summary:
- `totalToday` — total access events in the last 24 hours
- `uniquePhonesToday` — distinct masked phone numbers
- `verifiedToday` — successful verifications

The GWIPOS Access page auto-refreshes every 30 seconds.

### Access Gate — Session Token

`access-gate.ts` issues HMAC-SHA256 JWTs stored in the `gwi-access` httpOnly cookie:
- 1-hour lifetime, refreshed on each request while active.
- Payload contains: `email`, `iat`, `exp`.
- Edge-compatible (uses Web Crypto API).
- This is the **first layer** of portal protection before the `pos-cloud-session` auth takes over.

### Permission Check on Audit Page

The `/audit` page checks permissions client-side before rendering:
```
hasAccess = permissions.includes('manager.shift_review')
         || permissions.includes('admin.full')
         || permissions.includes('*')
```
The API route (`/api/audit/activity`) enforces the same check server-side via `requirePermission(MGR_SHIFT_REVIEW)`.

### Retention Policy

No automatic expiry is enforced in code. `AuditLog` entries have `deletedAt` (soft-delete) but no TTL job exists. Data is retained indefinitely until manually purged. The UI query cap of 31 days limits the visible window but does not delete older records.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| None directly | AuditLog is an append-only observer; it does not mutate other features |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Orders | `order_created`, `order_sent`, `order_closed` entries written on order mutations |
| Payments | `payment_processed`, `payment_refunded` entries written on payment events |
| Discounts | `discount_applied` entries written on discount events |
| Roles / Permissions | `manager_override`, `settings_changed` entries; access to the audit page is gated by `manager.shift_review` |
| Employees | `login`, `logout`, `login_failed`, `shift_started`, `shift_ended` entries written on employee events |
| Settings | `settings_changed` entries written when location settings are saved |
| Menu | `menu_updated` entries written on menu mutations |
| Cash Drawers | `cash_drawer_opened` entries written on drawer events |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Permissions** — audit access must remain `manager.shift_review` or higher; do not weaken to employee-level
- [ ] **Reports** — the audit log is not a financial report; changes to it do not affect revenue calculations
- [ ] **Offline** — `AuditLog` writes go to the local NUC Postgres; they must not depend on Neon connectivity. The GWIPOS access log writes to Neon but is non-fatal on failure (fire-and-forget with `console.error` on write error)
- [ ] **Socket** — no socket events; no impact
- [ ] **Date range cap** — the 31-day maximum on the activity query is a performance guard; do not remove it without adding a server-side index scan limit

---

## Permissions Required

### Activity Audit Log

| Action | Permission Key | Level |
|--------|---------------|-------|
| View audit log | `manager.shift_review` or `admin.full` | Manager |
| Export CSV | Same as view | Manager |

### GWIPOS Access Log

| Action | Permission Key | Level |
|--------|---------------|-------|
| View access log | `pos-cloud-session` cookie or `INTERNAL_API_SECRET` bearer | Admin / GWI operator only |

---

## Known Constraints & Limits

- Activity log query window: maximum 31 days per request. Default: last 7 days.
- Page size: 50 entries per page; maximum 200 per API request.
- `entityType` filter in the API is hardcoded to `{ in: ['order', 'payment'] }` — the query does not currently surface employee, menu, or settings audit entries despite those action types being valid in the UI filter. Expanding this requires removing or widening the `entityType` filter in `audit/activity/route.ts`.
- The GWIPOS access log is cloud-only (Neon). It is never synced to the NUC; offline scenarios do not affect it.
- Phone numbers in the access log are masked at write time; there is no way to recover the original number.
- No automated retention/purge job exists. Long-running locations will accumulate `AuditLog` rows indefinitely.
- CSV export is client-side only — it downloads whatever is currently paginated in the browser, not the full dataset.

---

## Android-Specific Notes

The Android register does not currently write to `AuditLog` directly. Employee actions on Android (payments, voids, discounts) may create audit entries indirectly if the corresponding POS API route writes to `AuditLog` when processing the event. Android-native events (via the event bridge) are not separately audited at the `AuditLog` level.

---

## Related Docs

- **Feature doc:** `docs/features/roles-permissions.md`
- **Feature doc:** `docs/features/employees.md`
- **Feature doc:** `docs/features/settings.md`
- **Feature doc:** `docs/features/orders.md`
- **Feature doc:** `docs/features/payments.md`
- **Architecture guide:** `docs/guides/ARCHITECTURE-RULES.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`

---

## Anti-Gaming Audit Trail (Planned — 2026-03-17)

An extended audit trail focused on loss prevention and anti-gaming is planned (AG-01 through AG-08, tracked in `MASTER-TODO.md`). This system leverages the stable `lineItemId` contract to enable birth-to-death tracking of every order item.

### Planned Components
| ID | Component | Description |
|----|-----------|-------------|
| AG-01 | DRAWER_OPENED event | Track every cash drawer open with employee, timestamp, context |
| AG-02 | Item removal reasons | Require reason code when removing items from orders |
| AG-03 | Price override tracking | Log every manual price change with before/after values |
| AG-04 | Anomaly detection reports | Statistical analysis of void/comp patterns per employee |
| AG-05 | Threshold alerts | Configurable alerts when void/comp rates exceed thresholds |
| AG-06 | Item timeline view | Full history of an individual item from creation to payment/void |
| AG-07 | Discount pattern analysis | Track discount frequency and amounts by employee |
| AG-08 | Shift-level gaming summary | Per-shift aggregate of suspicious activity indicators |

### Foundation: lineItemId
The stable client-generated `lineItemId` (see `docs/guides/STABLE-ID-CONTRACT.md`) provides a unique, immutable identifier for every item across its lifecycle. This enables:
- Tracking an item from button press to kitchen to payment to void
- Correlating events across server logs, Android events, and audit entries
- Detecting when the same item is manipulated multiple times

---

*Last updated: 2026-03-17 (added anti-gaming audit trail plan)*
