# Feature: 7shifts Labor Management Integration

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find "7shifts Integration" → read every listed dependency doc.

## Summary

Bidirectional integration with 7shifts for labor cost tracking, payroll time sync, and schedule management. GWI is the source of truth for employees and time punches; 7shifts is the source of truth for published schedules.

**Three data flows (v1):**
1. **Sales push** — nightly daily receipt totals → 7shifts receipts API (for labor cost % tracking)
2. **Time punch push** — completed GWI clock-ins/outs → 7shifts time punches (for payroll accuracy)
3. **Schedule pull** — published 7shifts schedules → GWI `ScheduledShift` records

## Status
`Active` (Built — production ready pending credential setup)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API client, all routes, webhook receiver, cron, admin UI | Full |
| `gwi-android-register` | N/A — sync is server-initiated | None |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path | Who Accesses |
|-----------|------|--------------|
| Admin | `/settings/integrations/7shifts` | Managers / Admins |
| Admin | `/settings/integrations/7shifts/employees` | Managers / Admins |
| Admin | `/time-clock` | Managers / Admins |
| Admin | `/employees/[id]` → 7shifts tab | Managers / Admins |
| Admin | `/scheduling` → 7shifts import card | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/7shifts-client.ts` | Core API client: OAuth token management, retry wrapper, all API methods |
| `src/app/api/integrations/7shifts/` | All integration API routes (9 routes + _helpers.ts) |
| `src/app/api/webhooks/7shifts/route.ts` | Webhook receiver (public endpoint — no withVenue) |
| `src/app/api/cron/7shifts-sync/route.ts` | Vercel cron handler — runs 7am UTC daily |
| `src/app/(admin)/settings/integrations/7shifts/page.tsx` | Main settings + sync control page |
| `src/app/(admin)/settings/integrations/7shifts/employees/page.tsx` | Employee ↔ 7shifts user mapping |
| `src/app/(admin)/time-clock/page.tsx` | Admin punch manager (pre-sync review + edit) |
| `src/app/(admin)/employees/[id]/page.tsx` | Employee detail with 7shifts mapping tab |
| `src/app/(admin)/scheduling/page.tsx` | Scheduling page with 7shifts import card |
| `src/lib/settings.ts` | `SevenShiftsSettings` interface + defaults + merge |

---

## Data Models

### Location.settings.sevenShifts (JSON column)
```typescript
SevenShiftsSettings {
  enabled: boolean
  clientId: string
  clientSecret: string          // write-only — stripped from GET response
  companyId: number             // 7shifts numeric company ID
  companyGuid: string           // UUID — x-company-guid header on every API call
  locationId7s: number          // 7shifts location ID
  webhookSecret: string         // stripped from GET response
  environment: 'sandbox' | 'production'
  accessToken?: string          // persisted DB cache — stripped from GET response
  syncOptions: { pushSales, pushTimePunches, pullSchedule }
  lastSalesPushAt/Status/Error
  lastPunchPushAt/Status/Error
  lastSchedulePullAt/Status/Error
  webhooksRegisteredAt?: string
}
```

### Employee (new fields)
```
sevenShiftsUserId       String?  — links GWI employee to 7shifts user
sevenShiftsRoleId       String?  — for accurate role on time punches
sevenShiftsDepartmentId String?  — for accurate dept on time punches
sevenShiftsLocationId   String?  — for accurate location on time punches
```

### TimeClockEntry (new fields — idempotency)
```
sevenShiftsTimePunchId  String?   — returned punch ID; null = eligible for push/retry
sevenShiftsPushedAt     DateTime? — successful push timestamp
sevenShiftsPushError    String?   — last error message
```

### ScheduledShift (new field — upsert key)
```
sevenShiftsShiftId  String?  — stable external ID used for upsert correctness
```

### SevenShiftsDailySalesPush (new table)
```
@@unique([locationId, businessDate, revenueType])
status: 'pending' | 'pushed' | 'error'
```
Idempotency table for sales receipts. Prevents duplicate receipt pushes on cron re-runs.

---

## API Routes

### Integration Management
| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/integrations/7shifts/status` | withVenue | isConfigured/isEnabled, employeesLinked, webhooksRegistered, per-op sync status |
| POST | `/api/integrations/7shifts/test` | SETTINGS_INTEGRATIONS | Test OAuth + company GUID via getLocations() |
| GET | `/api/integrations/7shifts/users` | SETTINGS_INTEGRATIONS | 7shifts users list for mapping UI |
| POST | `/api/integrations/7shifts/link-employee` | SETTINGS_INTEGRATIONS | Save sevenShiftsUserId to Employee |
| POST | `/api/integrations/7shifts/register-webhooks` | SETTINGS_INTEGRATIONS | Idempotent webhook registration |
| GET | `/api/integrations/7shifts/pre-sync-check` | SETTINGS_INTEGRATIONS | Readiness validation (unmapped, open punches, missing rates) |

### Sync Operations
| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | `/api/integrations/7shifts/push-sales` | SETTINGS_INTEGRATIONS | Push daily receipt totals |
| POST | `/api/integrations/7shifts/push-time-punches` | SETTINGS_INTEGRATIONS | Push completed time punches |
| POST | `/api/integrations/7shifts/pull-schedule` | SETTINGS_INTEGRATIONS | Pull published shifts → upsert ScheduledShift |
| POST | `/api/integrations/7shifts/sync` | SETTINGS_INTEGRATIONS | Orchestrate all 3 operations |

### Webhook + Cron (Public / Internal)
| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | `/api/webhooks/7shifts` | HMAC signature | 7shifts events: schedule.published → schedule pull |
| GET | `/api/cron/7shifts-sync` | CRON_SECRET header | Vercel cron — daily sync at 7am UTC |

---

## Business Logic

### Token Domain
- Token endpoint: `https://app.7shifts.com/oauth2/token` (`client_credentials`)
- API endpoint: `https://api.7shifts.com/v2/...`
- 1-hour expiry; no refresh token — re-issue on expiry
- Persisted to `Location.settings.sevenShifts.accessToken` so multiple NUC processes share tokens
- Every API call requires: `Authorization: Bearer {token}` + `x-company-guid: {UUID}`

### Sales Push
- Net total = pre-tax net sales (cents), not total-with-tax
- `receipt_id` = GWI cuid (idempotency key sent to 7shifts)
- `receipt_date` = UTC ISO8601 start of business day
- Re-run safe: `SevenShiftsDailySalesPush` unique constraint prevents duplicates

### Time Punch Push
- Only pushes entries where `clockOut IS NOT NULL` (completed punches only)
- Only pushes entries where `sevenShiftsTimePunchId IS NULL` (not already pushed)
- Employees without `sevenShiftsUserId` are skipped with a warning log
- On success: `sevenShiftsTimePunchId` saved → prevents re-push on next cron
- On error: `sevenShiftsPushError` saved, `sevenShiftsTimePunchId` left null → retry eligible

### Schedule Pull
- Upsert by `sevenShiftsShiftId` (stable external ID) — creates on first pull, updates on re-pull
- Soft-deletes shifts where 7shifts reports `status: 'deleted'`
- Skips shifts for unmapped employees (no `sevenShiftsUserId`)
- Requires existing `Schedule` record for the location (create in scheduling UI first)

### Webhook Authentication
- Headers: `x-hmac-timestamp` (epoch seconds) + `x-hmac-signature` (hex HMAC-SHA256)
- HMAC key: `${timestamp}#${companyGuid}` (not just a static secret)
- Replay protection: reject if timestamp age > 5 minutes
- Timing-safe compare with hex normalization + zero-length buffer guard
- Multi-location routing: match `x-company-id` to `settings.sevenShifts.companyId`
- Single-venue fallback: only if exactly 1 location has 7shifts enabled

---

## Known Constraints

- **Employee mapping required** before time punch push or schedule pull works per employee
- **Schedule must exist** in GWI scheduling UI before schedule pull can upsert shifts
- **breaks[] deferred**: `SevenShiftsTimePunchCreate.breaks` field declared but not yet sent — confirm shape in sandbox (`{ minutes, paid?, type? }`) before wiring
- **No SAF equivalent**: 7shifts API failures on push are logged and retried next cron; no offline queue
- **Webhook multi-venue safety**: If multiple venues enabled and `x-company-id` missing → reject (ambiguous). Only one-venue deployments get the header-missing fallback.

---

## Permissions Required

| Action | Permission |
|--------|-----------|
| View integration status | `withVenue` only (no employee permission required) |
| Test connection, manage webhooks, view users, link employees, trigger sync | `SETTINGS_INTEGRATIONS` |
| Edit credentials in `/settings` page | `SETTINGS_EDIT` |

---

## Cross-Feature Dependencies

| Feature | How It Depends |
|---------|---------------|
| **Employees** | `sevenShiftsUserId` mapping required for time punch push + schedule pull |
| **Time Clock** | `TimeClockEntry` records are source for punch push; `sevenShiftsTimePunchId` is idempotency key |
| **Scheduling** | `ScheduledShift` records are written by schedule pull; `sevenShiftsShiftId` is upsert key |
| **Settings** | `SevenShiftsSettings` in `Location.settings`; token persistence; sync status fields |
| **Reports** | Net sales aggregation used for receipt `net_total` calculation |

---

## Setup Checklist

- [ ] Credentials: Client ID + Client Secret from 7shifts app registration
- [ ] Company GUID from 7shifts OAuth grant (required as `x-company-guid` header)
- [ ] 7shifts Location ID (numeric) — found in 7shifts admin
- [ ] `APP_URL` env var set (webhook registration URL construction)
- [ ] Test Connection → verify "Connected"
- [ ] Enable integration toggle
- [ ] Register Webhooks
- [ ] Map all employees with active time punches
- [ ] Run Sync Now in sandbox
- [ ] Switch to Production when verified

---

## Related Docs

- `docs/skills/SPEC-485-7SHIFTS-INTEGRATION.md` — Full technical implementation doc
- `docs/features/employees.md` — Employee model + mapping fields
- `docs/features/time-clock.md` — TimeClockEntry + push idempotency
- `docs/features/scheduling.md` — ScheduledShift + 7shifts pull section
- `docs/features/hotel-pms.md` — Parallel integration pattern reference
