# Skill 485 — 7shifts Labor Management Integration

**Status:** DONE
**Domain:** Employees / Integrations
**Dependencies:** 01 (Employee Management), 09 (Settings), 241 (Scheduling), 47 (Time Clock)
**Date:** 2026-03-04

---

## Summary

Full bidirectional v1 integration with 7shifts for labor cost tracking, time punch sync, and schedule management. GWI is the source of truth for employees and time punches; 7shifts is the source of truth for published schedules.

**Three data flows:**
1. **Sales push** — nightly daily receipt totals → 7shifts for labor cost % tracking
2. **Time punch push** — completed clock-in/out → 7shifts for payroll (idempotent via `sevenShiftsTimePunchId`)
3. **Schedule pull** — published 7shifts schedules → GWI `ScheduledShift` (upsert by `sevenShiftsShiftId`)

**Triggers:** Vercel cron (7am UTC daily), manual "Sync Now" button in admin UI, and real-time `schedule.published` webhook from 7shifts.

Credentials are stored **per-venue in `Location.settings.sevenShifts`** (not env vars). OAuth access token is persisted to the DB for safety across stateless Vercel invocations.

---

## What Was Built

### New Files (18)

| File | Purpose |
|------|---------|
| `src/lib/7shifts-client.ts` | OAuth client (token cache + DB persistence), retry wrapper, 9 API methods + `listWebhooks`/`deleteWebhook` |
| `src/app/api/integrations/7shifts/_helpers.ts` | `getBusinessDate()`, `getDateRange()`, `updateSyncStatus()` |
| `src/app/api/integrations/7shifts/status/route.ts` | GET — `isConfigured`/`isEnabled` split, `employeesLinked` count, `webhooksRegistered` flag, per-op sync status |
| `src/app/api/integrations/7shifts/test/route.ts` | POST — verify OAuth + company GUID via `getLocations()` |
| `src/app/api/integrations/7shifts/users/route.ts` | GET — 7shifts users for employee mapping UI |
| `src/app/api/integrations/7shifts/link-employee/route.ts` | POST — save `sevenShiftsUserId` + role/dept/location IDs to Employee |
| `src/app/api/integrations/7shifts/push-sales/route.ts` | POST — aggregate closed orders → `SevenShiftsDailySalesPush` → `createReceipt()` |
| `src/app/api/integrations/7shifts/push-time-punches/route.ts` | POST — push completed `TimeClockEntry` records (idempotent via `sevenShiftsTimePunchId`) |
| `src/app/api/integrations/7shifts/pull-schedule/route.ts` | POST — `listShifts()` → upsert `ScheduledShift` by `sevenShiftsShiftId` |
| `src/app/api/integrations/7shifts/register-webhooks/route.ts` | POST — idempotent: list existing → skip registered → create missing → set `webhooksRegisteredAt` |
| `src/app/api/integrations/7shifts/sync/route.ts` | POST — orchestrate all 3 operations for a business date, update per-op status |
| `src/app/api/integrations/7shifts/pre-sync-check/route.ts` | GET — readiness validation: unmapped employees with punches, open punches, missing hourly rates |
| `src/app/api/webhooks/7shifts/route.ts` | POST — HMAC verification, multi-location routing via `x-company-id`, `schedule.published` pull trigger |
| `src/app/api/cron/7shifts-sync/route.ts` | Vercel cron — 7am UTC daily, timezone-correct business date, processes all enabled locations |
| `src/app/(admin)/settings/integrations/7shifts/page.tsx` | Main settings UI — credentials, sync options, last sync status, register webhooks, sync now, readiness widget |
| `src/app/(admin)/settings/integrations/7shifts/employees/page.tsx` | Employee mapping table — link/unlink to 7shifts accounts (shows name + email to avoid mislinks) |
| `src/app/(admin)/time-clock/page.tsx` | Admin time clock manager — date/employee/status filters, row-expand punch detail, Edit Punch modal with required reason |
| `src/app/(admin)/employees/[id]/page.tsx` | Employee detail — 4 tabs: Profile, Pay & Tax, Time & Attendance (punch history + upcoming shifts + edit modal), 7shifts Mapping |

### Modified Files (9)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `Employee` (4 `sevenShifts*` fields), `TimeClockEntry` (3 idempotency fields), `ScheduledShift` (`sevenShiftsShiftId`), new `SevenShiftsDailySalesPush` model + `Location` reverse relation |
| `scripts/nuc-pre-migrate.js` | ALTER TABLE DDL for all new columns + CREATE TABLE `SevenShiftsDailySalesPush` with indexes + FK |
| `src/lib/settings.ts` | `SevenShiftsSettings` interface + `DEFAULT_SEVEN_SHIFTS_SETTINGS` + merge line in `mergeWithDefaults()`; `webhooksRegisteredAt` field; 7shifts secret stripping in GET settings route |
| `src/components/admin/SettingsNav.tsx` | 7shifts nav link under Integrations |
| `src/components/admin/AdminNav.tsx` | Time Clock link under Team section |
| `vercel.json` | Cron job: `/api/cron/7shifts-sync` at `0 7 * * *` |
| `src/app/(admin)/scheduling/page.tsx` | 7shifts import card, Pull from 7shifts button, "7s" badge on imported shifts |
| `src/components/time-clock/TimeClockModal.tsx` | Break type picker (Meal/Rest/Paid), break history, clock-out notes, compliance warning (>6h → amber, >8h → red) |
| `src/app/api/settings/route.ts` | Strip `sevenShifts.clientSecret/webhookSecret/accessToken` in GET response |

---

## Architecture

### OAuth Token Cache

```
Token endpoint: POST https://app.7shifts.com/oauth2/token  ← app. domain (NOT api.)
API calls:      https://api.7shifts.com/v2/...

Token cache:
  - In-memory: Map<locationId, { accessToken, expiresAt }>
  - DB-persisted: Location.settings.sevenShifts.accessToken/accessTokenExpiresAt
  - Refresh 5 min before expiry (TOKEN_BUFFER_MS)
  - On 401: evict cache → re-fetch → retry once; second 401 → throw auth error
  - Keyed by locationId to prevent cross-venue token pollution
```

### Required Headers on Every API Call

```
Authorization: Bearer {accessToken}
x-company-guid: {companyGuid}        ← UUID, NOT the numeric companyId
Content-Type: application/json
```

### Retry Wrapper

```
withRetry(fn, maxAttempts=3)
  Retries on: 429 (rate limit) + 5xx (server error)
  Backoff: exponential (1s, 2s, 4s) + random jitter (0–500ms)
  Does NOT retry 401/403 — surfaces credential error to admin
```

### API Methods (v2)

| Method | Endpoint | Used For |
|--------|----------|----------|
| `getCompanyUsers()` | `GET /v2/company/{id}/users` | Employee mapping UI |
| `getLocations()` | `GET /v2/company/{id}/locations` | Test/verify connection |
| `listShifts(start, end)` | `GET /v2/company/{id}/shifts` | Schedule pull (filter: published, location_id) |
| `createTimePunch(data)` | `POST /v2/company/{id}/time_punches` | Push completed clock-in/out |
| `updateTimePunch(id, data)` | `PUT /v2/company/{id}/time_punches/{id}` | Break/clock-out correction |
| `createReceipt(data)` | `POST /v2/company/{id}/receipts` | Sales push (required: receipt_id, net_total in cents, status) |
| `createWebhook(event, url)` | `POST /v2/company/{id}/webhooks` | Register webhook per event |
| `listWebhooks()` | `GET /v2/company/{id}/webhooks` | Idempotency check before registering |
| `deleteWebhook(id)` | `DELETE /v2/company/{id}/webhooks/{id}` | Clean up stale webhooks |

### Webhook Receiver — Security Architecture

```
POST /api/webhooks/7shifts
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. Read x-company-id header                                 │
  │    → Load all locations with sevenShifts.enabled            │
  │    → Match location where settings.sevenShifts.companyId    │
  │      === parseInt(x-company-id)                             │
  │    → Single-venue fallback: only if EXACTLY 1 enabled venue │
  │    → Unknown company → 200 + error log (no retry storm)     │
  │                                                             │
  │ 2. HMAC verification                                        │
  │    Headers: x-hmac-timestamp (epoch seconds) + x-hmac-sig  │
  │    Key = `${timestamp}#${companyGuid}`                      │
  │    Message = raw request body                               │
  │    Compare: timingSafeEqual(sig.trim().toLowerCase(), exp)   │
  │    Zero-length buffer guard: reject if Buffer.from → 0 bytes│
  │    Replay: reject if |now - timestamp*1000| > 5 min         │
  │    Fallback: webhookSecret-based HMAC if no timestamp header│
  │             (+ warning log to flag unexpected path)         │
  │                                                             │
  │ 3. Return 200 immediately                                   │
  │    Fire-and-forget processWebhookEvent()                    │
  │    Safe: NUC is a persistent Node.js process (not serverless│
  │                                                             │
  │ 4. processWebhookEvent() switch                             │
  │    schedule.published → triggerSchedulePull() inline        │
  │    time_punch.*       → log only (v1)                       │
  │    user.*             → log only (v1)                       │
  └─────────────────────────────────────────────────────────────┘
```

**`triggerSchedulePull()` error isolation:**
- Outer try/catch: catches setup failures (DB query, settings parse)
- Inner try/catch: catches listShifts() API errors + upsert errors
- Both paths update `lastSchedulePullAt/Status/Error` in settings
- Neither layer can crash the handler or leave silent poison state

### Idempotency Strategy

| Operation | Idempotency Key | Guard |
|-----------|----------------|-------|
| Sales push | `@@unique([locationId, businessDate, revenueType])` on `SevenShiftsDailySalesPush` | Skip if `status='pushed'` |
| Time punch push | `TimeClockEntry.sevenShiftsTimePunchId IS NULL` query filter | Save returned punch ID on success; leave null for retry on error |
| Schedule pull | `ScheduledShift.sevenShiftsShiftId` (external ID) | Upsert by external ID; soft-delete on `status='deleted'` |
| Webhook registration | `listWebhooks()` → filter by URL + method → skip existing | `webhooksRegisteredAt` persisted on full success |

### Settings Storage

Credentials stored in `Location.settings.sevenShifts` (local Postgres JSON):
- **Never** sent to Neon cloud
- **Never** in environment variables
- GET `/api/settings` strips: `clientSecret`, `webhookSecret`, `accessToken`, `accessTokenExpiresAt`
- PUT `/api/settings` preserves existing secrets when incoming value is empty

```typescript
interface SevenShiftsSettings {
  enabled: boolean
  clientId: string
  clientSecret: string         // stripped in GET response
  companyId: number            // 7shifts numeric company ID
  companyGuid: string          // UUID — x-company-guid on every API call
  locationId7s: number         // 7shifts location ID
  webhookSecret: string        // stripped in GET response
  environment: 'sandbox' | 'production'
  accessToken?: string         // stripped in GET response
  accessTokenExpiresAt?: number // epoch ms

  syncOptions: {
    pushSales: boolean
    pushTimePunches: boolean
    pullSchedule: boolean
  }

  // Per-operation sync status
  lastSalesPushAt: string | null
  lastSalesPushStatus: 'success' | 'error' | null
  lastSalesPushError: string | null
  lastPunchPushAt: string | null
  lastPunchPushStatus: 'success' | 'error' | null
  lastPunchPushError: string | null
  lastSchedulePullAt: string | null
  lastSchedulePullStatus: 'success' | 'error' | null
  lastSchedulePullError: string | null

  webhooksRegisteredAt?: string | null  // ISO timestamp, set on successful registration
}
```

### Schema Changes

```prisma
// Employee — 7shifts user mapping
Employee {
  sevenShiftsUserId       String?   // for time punch push
  sevenShiftsRoleId       String?   // accurate role on punches
  sevenShiftsDepartmentId String?   // accurate dept on punches
  sevenShiftsLocationId   String?   // accurate location on punches
}

// TimeClockEntry — punch push idempotency
TimeClockEntry {
  sevenShiftsTimePunchId  String?   // returned punch ID — prevents duplicate push
  sevenShiftsPushedAt     DateTime? // timestamp of successful push
  sevenShiftsPushError    String?   // last error if push failed; null = retry eligible
}

// ScheduledShift — upsert key for schedule pull
ScheduledShift {
  sevenShiftsShiftId  String?        // stable external ID
  @@index([sevenShiftsShiftId])
}

// New model — idempotency for sales push
model SevenShiftsDailySalesPush {
  id                   String    @id @default(cuid())
  locationId           String
  businessDate         String    // "YYYY-MM-DD" in location timezone
  revenueType          String    // "food" | "liquor" | "other" | "combined"
  sevenShiftsReceiptId String?   // returned receipt_id from 7shifts
  netTotalCents        Int
  tipsAmountCents      Int       @default(0)
  status               String    @default("pending") // pending|pushed|error
  errorMessage         String?
  pushedAt             DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  location             Location  @relation(...)
  @@unique([locationId, businessDate, revenueType])
}
```

### Cron Job

```
vercel.json: { "path": "/api/cron/7shifts-sync", "schedule": "0 7 * * *" }
// 7am UTC = 3am ET — after nightlife shift closes

Handler logic:
1. Verify Authorization: Bearer $CRON_SECRET header
2. Load all locations where sevenShifts.enabled === true
3. Compute businessDate in location.timezone (never UTC day boundary)
4. For each location (sequential, max 2 concurrent):
   - Push sales for yesterday (if syncOptions.pushSales)
   - Push time punches for yesterday (if syncOptions.pushTimePunches)
   - Pull schedule for yesterday + next 14 days (if syncOptions.pullSchedule)
   - Update per-operation lastSyncAt/Status/Error on each
5. Return JSON summary
```

---

## Sync Logic Details

### Sales Push (idempotent)
1. Compute business date in location timezone using `getDateRange()`
2. Check `SevenShiftsDailySalesPush` for `(locationId, businessDate, revenueType)` → skip if `status='pushed'`
3. Query closed Orders within business date UTC range
4. Aggregate: `net_total` = pre-tax net sales (cents), `tips` = total tips (cents)
5. `createReceipt()` — required fields: `receipt_id` (our cuid, idempotency key), `location_id`, `receipt_date` (UTC ISO8601), `net_total` (cents), `status: 'closed'`
6. On success: set `sevenShiftsReceiptId`, `status='pushed'`, `pushedAt`
7. On error: set `status='error'`, `errorMessage`

### Time Punch Push (idempotent)
1. Query `TimeClockEntry` where `clockOut IS NOT NULL` AND `sevenShiftsTimePunchId IS NULL`, clockIn within business date
2. For each: require `employee.sevenShiftsUserId` — skip + log if missing (unmapped employee)
3. Include `role_id`, `department_id`, `location_id` from employee's `sevenShifts*` fields if set
4. `createTimePunch()` — UTC timestamps
5. On success: save returned punch ID to `sevenShiftsTimePunchId`, set `sevenShiftsPushedAt`
6. On error: set `sevenShiftsPushError`, leave `sevenShiftsTimePunchId = null` → eligible for retry on next cron

### Schedule Pull (upsert by external ID)
1. `listShifts(startDate, endDate)` — filter: published, `location_id = settings.locationId7s`
2. For each shift:
   - Find `Employee` where `sevenShiftsUserId = String(shift.user_id)` — skip if not mapped
   - If `shift.status === 'deleted'`: soft-delete matching `ScheduledShift` by `sevenShiftsShiftId`
   - Otherwise: upsert by `sevenShiftsShiftId` (update times/status if exists; create with `scheduleId` if new)
3. Updates `lastSchedulePullAt/Status/Error` in settings on complete/error

---

## Admin Configuration Flow

1. Go to **Settings → Integrations → 7shifts**
2. Enter credentials: Client ID, Client Secret, Company ID (numeric), Company GUID (UUID), 7shifts Location ID, Webhook Secret
3. Set Environment: Sandbox / Production
4. Click **Save**, then **Test Connection** — verify "Connected" response
5. Enable the integration toggle
6. Configure Sync Options (pushSales, pushTimePunches, pullSchedule)
7. Click **Register Webhooks** — idempotent, safe to re-run
8. Go to **Settings → Integrations → 7shifts → Employee Mapping**
9. Link each GWI employee to their 7shifts account (dropdown shows name + email)
10. Run **Sync Now** to verify end-to-end before relying on cron

---

## Status Route Response

`GET /api/integrations/7shifts/status` returns:

```json
{
  "isConfigured": true,        // has required credentials (independent of enabled toggle)
  "isEnabled": true,           // enabled toggle
  "configured": true,          // legacy alias for isConfigured
  "employeesLinked": 12,       // live count of employees with sevenShiftsUserId set
  "webhooksRegistered": true,  // true if webhooksRegisteredAt is set
  "webhooksRegisteredAt": "2026-03-04T...",
  "lastSalesPushAt": "...",
  "lastSalesPushStatus": "success",
  "lastSalesPushError": null,
  "lastPunchPushAt": "...",
  "lastPunchPushStatus": "success",
  "lastPunchPushError": null,
  "lastSchedulePullAt": "...",
  "lastSchedulePullStatus": "success",
  "lastSchedulePullError": null,
  "syncOptions": { "pushSales": true, "pushTimePunches": true, "pullSchedule": true }
}
```

**`isConfigured` vs `isEnabled`:** Test Connection and Register Webhooks only require `isConfigured` (credentials present). The `isEnabled` toggle controls whether the cron + sync operations run.

---

## P2 / Deferred Items

| Item | Status | Notes |
|------|--------|-------|
| `breaks[]` on time punch | P2 — interface declared, not yet sent | Shape: `{ minutes, paid?, type? }` — confirm in sandbox before wiring |
| `user.modified` / `user.deactivated` webhooks | Log only (v1) | Future: emit admin alert via `alert-service.ts` |
| `time_punch.*` webhooks | Log only (v1) | Future: trigger punch reconciliation |
| Employee availability UI | Deferred sprint | `AvailabilityEntry` model exists; UI not built |

---

## Waiting On (Before Go-Live)

- [ ] 7shifts OAuth client credentials (Client ID + Client Secret)
- [ ] Company GUID from 7shifts OAuth grant
- [ ] 7shifts Location ID (numeric)
- [ ] Webhook Secret (shared secret for legacy HMAC fallback)
- [ ] Set `APP_URL` env var (used to construct webhook registration URL)
- [ ] Register webhooks in sandbox → verify `schedule.published` delivery with correct headers
- [ ] Map all employees with active time punches to 7shifts users
- [ ] Run Sync Now in sandbox and verify receipt + punch push succeed
- [ ] Switch to Production environment when verified

---

## Known Constraints

- **Time punch push**: Employees without `sevenShiftsUserId` are silently skipped. Map them first.
- **Schedule pull**: `ScheduledShift` requires an existing `Schedule` record for the location. Create a schedule in the scheduling UI before pulling.
- **Sales net_total**: Pre-tax net sales (not total including tax). Matches 7shifts' labor cost % calculation basis.
- **Token persistence**: `accessToken` is stored in `Location.settings` — a background write. If Prisma update fails (non-fatal), the next invocation will re-fetch a new token.
- **Cron timing**: 7am UTC = 3am ET. Adjust `schedule` in `vercel.json` if venue timezone requires earlier run.
- **Fire-and-forget safety**: Only reliable on NUC persistent Node process. If ever deployed serverless, switch `schedule.published` webhook to a DB job table + cron drain.
- **Webhook multi-venue**: `x-company-id` header routes to the correct venue. Single-venue fallback only activates when exactly one location has 7shifts enabled.

---

## Related Docs

- `docs/features/7shifts-integration.md` — Feature overview and UI flows
- `docs/features/scheduling.md` — ScheduledShift model + 7shifts pull section
- `docs/features/time-clock.md` — TimeClockEntry model + push section
- `docs/features/employees.md` — Employee model + sevenShifts* mapping fields
- `docs/skills/SPEC-484-ORACLE-OPERA-PMS.md` — Parallel integration pattern (token cache, settings storage)
