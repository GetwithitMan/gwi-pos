# Feature: Scheduling

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Scheduling → read every listed dependency doc.

## Summary
Scheduling manages the planned work calendar for employees. It is distinct from the time clock (actual clock-in/out) and from the `Shift` record (the financial work session). A `Schedule` is a weekly plan (Monday–Sunday) that a manager drafts, populates with `ScheduledShift` entries, and publishes so employees can see their upcoming shifts. Employees can submit availability preferences via `AvailabilityEntry` and request to swap a scheduled shift with a coworker via `ShiftSwapRequest`. The scheduling system is read-only to employees once published; managers control create/edit/delete. Scheduled shifts are not automatically linked to actual `TimeClockEntry` records — that connection is managed separately at clock-in time.

## Status
`Active` (Built — verify before extending)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, schedule management UI | Full |
| `gwi-android-register` | Mobile schedule view, swap request submission | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | Scheduling section — weekly schedule grid | Managers |
| Admin | Employee availability calendar | Managers |
| Admin | Shift swap request review | Managers |
| POS Web | Employee schedule view (own shifts) | All staff |
| Android | Schedule view screen | All staff |
| Android | Shift swap request screen | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/schedules/route.ts` | GET list schedules; POST create schedule |
| `src/app/api/schedules/[id]/route.ts` | GET schedule detail; PUT publish/archive/draft; DELETE (draft only) |
| `src/app/api/schedules/[id]/shifts/route.ts` | POST add shift to schedule; PUT bulk-upsert shifts |
| `src/app/api/schedules/[id]/shifts/[shiftId]/route.ts` | PUT update individual shift; DELETE soft-delete individual shift |
| `src/app/api/schedules/[id]/shifts/[shiftId]/swap-requests/route.ts` | GET requests for a shift; POST create shift request (swap/cover/drop) |
| `src/app/api/shift-swap-requests/route.ts` | GET all shift requests for location (filterable by status, employee, type) |
| `src/app/api/shift-swap-requests/[requestId]/route.ts` | DELETE cancel a pending request (soft delete) |
| `src/app/api/shift-swap-requests/[requestId]/accept/route.ts` | POST employee accepts a request |
| `src/app/api/shift-swap-requests/[requestId]/decline/route.ts` | POST employee declines a request |
| `src/app/api/shift-swap-requests/[requestId]/approve/route.ts` | POST manager approves (executes swap/cover/drop) |
| `src/app/api/shift-swap-requests/[requestId]/reject/route.ts` | POST manager rejects a request |
| `src/app/api/shift-requests/route.ts` | Unified GET list + POST create shift requests |
| `src/app/api/shift-requests/[id]/route.ts` | Unified PUT (accept/decline/approve/reject) + DELETE cancel |
| `src/app/(admin)/scheduling/requests/page.tsx` | Dedicated admin page for managing all shift requests |

---

## API Endpoints

### Schedules
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/schedules` | Manager | List schedules for a location; filterable by `weekStart` and `status`; returns up to 20, ordered by weekStart desc |
| `POST` | `/api/schedules` | Manager | Create a new weekly schedule; requires `locationId` and `weekStart`; prevents duplicate schedules for same week |
| `GET` | `/api/schedules/[id]` | Manager | Get full schedule detail including all shifts grouped by date; includes summary (totalShifts, totalHours, totalLaborCost) |
| `PUT` | `/api/schedules/[id]` | Manager | Update schedule — actions: `publish` (sets status + publishedAt), `archive`, `draft` (reverts to draft); also accepts `notes` update |
| `DELETE` | `/api/schedules/[id]` | Manager | Soft-delete schedule; only allowed when `status = draft` |

### Scheduled Shifts
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/schedules/[id]/shifts` | Manager | Add a single shift to a schedule; requires `employeeId`, `date`, `startTime`, `endTime`; prevents duplicate employee/date/schedule |
| `PUT` | `/api/schedules/[id]/shifts` | Manager | Bulk upsert shifts for a schedule — deletes shifts not in the submitted array, upserts the rest |
| `PUT` | `/api/schedules/[id]/shifts/[shiftId]` | Manager | Update an individual shift (employee, date, times, role, breakMinutes, notes) |
| `DELETE` | `/api/schedules/[id]/shifts/[shiftId]` | Manager | Soft-delete an individual shift |

### Shift Requests (swap, cover, drop)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/schedules/[id]/shifts/[shiftId]/swap-requests` | Employee PIN | List requests for a specific shift |
| `POST` | `/api/schedules/[id]/shifts/[shiftId]/swap-requests` | Employee PIN | Create a shift request (swap/cover/drop); requires `requestedByEmployeeId`, `type`; optionally `requestedToEmployeeId`, `reason`, `notes` |
| `GET` | `/api/shift-swap-requests` | Manager / Employee PIN | List all shift requests for location; filterable by `status`, `employeeId`, `requestedByEmployeeId`, `type` |
| `DELETE` | `/api/shift-swap-requests/[requestId]` | Employee PIN | Cancel a pending request (soft-delete + status → cancelled) |
| `POST` | `/api/shift-swap-requests/[requestId]/accept` | Employee PIN | Employee accepts a request (status → accepted); for cover with no target, accepting employee becomes the target |
| `POST` | `/api/shift-swap-requests/[requestId]/decline` | Employee PIN | Employee declines a request (status → rejected) |
| `POST` | `/api/shift-swap-requests/[requestId]/approve` | Manager | Manager approves: swaps/covers reassign shift; drops mark shift as called_off; cancels other pending requests on same shift |
| `POST` | `/api/shift-swap-requests/[requestId]/reject` | Manager | Manager rejects a request; accepts `managerNote` |
| `GET` | `/api/shift-requests` | Manager / Employee PIN | Unified list endpoint (filterable by status, type, employeeId) |
| `POST` | `/api/shift-requests` | Employee PIN | Unified create endpoint (swap/cover/drop) |
| `PUT` | `/api/shift-requests/[id]` | Manager / Employee | Unified action endpoint (action: approve/reject/accept/decline) |
| `DELETE` | `/api/shift-requests/[id]` | Employee PIN | Cancel a pending request |

---

## Socket Events

| Event | Payload | When |
|-------|---------|------|
| `shift-request:updated` | `{ action, requestId, type, requestedByEmployeeId, requestedToEmployeeId?, shiftId }` | Shift request created, accepted, declined, approved, rejected, or cancelled |

Socket events are dispatched via `dispatchShiftRequestUpdate()` in `src/lib/socket-dispatch.ts`. Enables real-time UI refresh on admin scheduling pages and mobile schedule views.

---

## Data Model

### Schedule (weekly plan container)
```
Schedule {
  id          String
  locationId  String          // always filter by this
  weekStart   DateTime        // Monday of the week
  weekEnd     DateTime        // Sunday of the week
  status      ScheduleStatus  // draft | published | archived
  publishedAt DateTime?
  publishedBy String?         // employeeId of manager who published
  notes       String?
  deletedAt   DateTime?       // soft delete
  syncedAt    DateTime?

  shifts      ScheduledShift[]

  @@unique([locationId, weekStart])
}
```

### ScheduledShift (individual shift assignment within a schedule)
```
ScheduledShift {
  id          String
  locationId  String
  scheduleId  String                     // parent Schedule
  employeeId  String                     // assigned employee
  date        DateTime                   // date of the shift
  startTime   String                     // "09:00" (24h format)
  endTime     String                     // "17:00" (24h format)
  breakMinutes Int    @default(0)

  roleId      String?                    // role/position for this shift (may differ from primary role)
  sectionId   String?                    // floor section assignment

  status      ScheduledShiftStatus       // scheduled | confirmed | no_show | called_off | worked

  // Actuals (filled after shift completes)
  actualStartTime  DateTime?
  actualEndTime    DateTime?
  actualHours      Decimal?

  // Swap tracking
  originalEmployeeId String?             // if swapped, who was originally scheduled
  swappedAt          DateTime?
  swapApprovedBy     String?             // manager who approved swap

  notes       String?
  deletedAt   DateTime?                  // soft delete
  syncedAt    DateTime?

  swapRequests ShiftSwapRequest[]
}
```

### AvailabilityEntry (employee weekly availability preferences)
```
AvailabilityEntry {
  id          String
  locationId  String
  employeeId  String

  // Recurring weekly pattern
  dayOfWeek     Int       // 0-6 (Sunday=0, Saturday=6)
  availableFrom String?   // "09:00" or null (not available)
  availableTo   String?   // "17:00" or null (not available)
  isAvailable   Boolean   @default(true)

  // Preference level
  preference    String    @default("available")
                          // "preferred" | "available" | "if_needed" | "unavailable"

  // Effective date range (for temporary changes)
  effectiveFrom DateTime?
  effectiveTo   DateTime?

  notes         String?
  deletedAt     DateTime? // soft delete
  syncedAt      DateTime?

  @@unique([employeeId, dayOfWeek, effectiveFrom])
}
```

### ShiftSwapRequest (shift swap/cover/drop workflow)
```
ShiftSwapRequest {
  id                    String
  locationId            String
  shiftId               String                  // the ScheduledShift being swapped/covered/dropped
  requestedByEmployeeId String                  // Employee A (initiator)
  requestedToEmployeeId String?                 // Employee B (target; null = open request or drop)
  type                  ShiftRequestType        // swap | cover | drop (default: swap)
  status                ShiftSwapRequestStatus  // pending | accepted | approved | rejected | cancelled
  reason                String?                 // employee's reason for the request
  managerNote           String?                 // manager's note on approval/denial
  respondedAt           DateTime?               // when Employee B accepted/declined
  approvedAt            DateTime?               // when manager approved
  approvedByEmployeeId  String?                 // manager who approved
  expiresAt             DateTime?               // auto-expires (default: 7 days after creation)
  notes                 String?
  declineReason         String?
  deletedAt             DateTime?               // soft delete (used for employee-cancel)
  syncedAt              DateTime?
}
```

---

## Business Logic

### Schedule Lifecycle
1. Manager creates a schedule for a specific week: `POST /api/schedules { locationId, weekStart }`
   - Only one schedule allowed per location per week (`@@unique([locationId, weekStart])`)
   - Created with `status: draft`
2. Manager populates the schedule with shifts, either one at a time (`POST /schedules/[id]/shifts`) or in bulk (`PUT /schedules/[id]/shifts`)
   - Each shift requires employee, date, startTime, endTime
   - One shift per employee per day per schedule (conflict check enforced)
3. Manager reviews and publishes: `PUT /schedules/[id] { action: 'publish' }`
   - Sets `status: published`, records `publishedAt` + `publishedBy`
   - Published schedules are visible to employees
4. Schedule can be reverted to draft (`action: 'draft'`) or archived (`action: 'archive'`) at any time
5. Draft schedules can be deleted (soft-delete); published/archived schedules cannot

### Scheduled Shift Status Lifecycle
```
scheduled → confirmed (employee acknowledges)
scheduled → no_show   (employee did not show up)
scheduled → called_off (employee called off)
scheduled/confirmed → worked (shift completed)
```
Status transitions are updated via `PUT /schedules/[id]/shifts/[shiftId]` — no dedicated status-transition endpoints exist; managers set status directly.

### Employee Availability
- Employees submit weekly recurring availability via `AvailabilityEntry`
- Each entry is per day-of-week (0–6) with `availableFrom`/`availableTo` times and a preference level
- Preference levels: `preferred` > `available` > `if_needed` > `unavailable`
- Temporary availability changes use `effectiveFrom`/`effectiveTo` date range fields
- Availability is advisory — managers are not blocked from scheduling an employee outside their availability

### Shift Request Types
Three request types are supported: **swap**, **cover**, and **drop**.

#### Swap Request Flow
1. Employee A creates a swap request:
   `POST /schedules/[id]/shifts/[shiftId]/swap-requests { type: 'swap', requestedByEmployeeId, requestedToEmployeeId?, reason?, notes? }`
   - Only one active request (`pending` or `accepted`) allowed per shift at a time
   - Request expires in 7 days by default (configurable via `expiresInDays`)
2. Employee B (if targeted) accepts or declines:
   - `POST /shift-swap-requests/[id]/accept` → status: `accepted`, respondedAt set
   - `POST /shift-swap-requests/[id]/decline` → status: `rejected`, respondedAt + declineReason set
3. Manager approves or rejects:
   - `POST /shift-swap-requests/[id]/approve` → status: `approved`; shift reassigned to Employee B; `originalEmployeeId` preserved; `swappedAt` set; other pending requests cancelled
   - `POST /shift-swap-requests/[id]/reject` → status: `rejected`; accepts `managerNote`
4. Employee A can cancel their pending request:
   `DELETE /shift-swap-requests/[id]` — soft-deletes + status → `cancelled`

#### Cover Request Flow
1. Employee A creates a cover request (open or targeted):
   `POST /schedules/[id]/shifts/[shiftId]/swap-requests { type: 'cover', requestedByEmployeeId, requestedToEmployeeId?, reason? }`
2. Any eligible employee (or the target) accepts — becomes the covering employee:
   - `POST /shift-swap-requests/[id]/accept { employeeId }` — if no target was set, the accepting employee becomes `requestedToEmployeeId`
3. Manager approves → shift reassigned to covering employee (same as swap approval)
4. Employee A can cancel while still pending

#### Drop Request Flow
1. Employee A creates a drop request:
   `POST /schedules/[id]/shifts/[shiftId]/swap-requests { type: 'drop', requestedByEmployeeId, reason? }`
   - Drop requests cannot have a `requestedToEmployeeId`
2. Manager can approve directly from `pending` (no employee acceptance needed):
   - `POST /shift-swap-requests/[id]/approve` → shift status set to `called_off`; other pending requests cancelled
   - `POST /shift-swap-requests/[id]/reject` → request rejected with optional `managerNote`
3. Employee A can cancel while still pending

### Schedule Summary Calculation
The `GET /schedules/[id]` response includes a `summary` object:
- `totalShifts` — count of shifts in the schedule
- `totalHours` — sum of (endTime - startTime - breakMinutes) per shift
- `totalLaborCost` — sum of hours × employee `hourlyRate` per shift

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Shifts | Scheduled shifts provide the planned context that actual time-clock shifts should match; swap tracking on ScheduledShift links to the actual Shift after clock-in |
| Employees | Schedule views filter by employee; availability entries belong to employees |
| Reports | Labor cost projections use scheduled hours + hourlyRate |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Employees | Employee records provide hourlyRate for cost calculations; employee roles drive section/position assignment |
| Roles & Permissions | `roleId` on ScheduledShift determines what role an employee is working; managers control schedule creation |
| Time Clock | When an employee clocks in, the system may link to a ScheduledShift (future integration) |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Shifts** — does the change affect how scheduled shifts link to actual worked shifts?
- [ ] **Employees** — does the change affect employee availability or multi-role support?
- [ ] **Reports** — does the change affect labor cost calculations?
- [ ] **Permissions** — does the change expose schedule data to employees who should not see it?
- [ ] **Offline** — scheduling is manager-side and admin-heavy; offline support is lower priority but verify

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View own schedule | `TIME_CLOCK` or authenticated employee | Standard |
| View all schedules | `SCHEDULE_MANAGE` | Manager |
| Create schedule | `SCHEDULE_MANAGE` | Manager |
| Add / edit shifts | `SCHEDULE_MANAGE` | Manager |
| Delete shifts | `SCHEDULE_MANAGE` | Manager |
| Publish schedule | `SCHEDULE_MANAGE` | Manager |
| Submit availability | Employee PIN | Standard |
| Request shift swap | Employee PIN | Standard |
| Cancel own swap request | Employee PIN | Standard |
| Approve swap requests | `SCHEDULE_MANAGE` | Manager |

---

## Known Constraints & Limits
- **One schedule per week per location** — enforced by `@@unique([locationId, weekStart])`; attempting to create a duplicate returns 400
- **Draft-only deletion** — published and archived schedules cannot be hard- or soft-deleted; only drafts can be deleted
- **Bulk shift upsert deletes non-submitted shifts** — `PUT /schedules/[id]/shifts` deletes any existing shift whose ID is not in the submitted array; use with caution on live schedules
- **One active swap per shift** — only one `pending` or `accepted` swap request is allowed per shift at a time (409 returned on duplicate)
- **Swap cancellation restricted to pending status** — once a swap is `accepted` or beyond, it cannot be cancelled by the employee via the API
- **Availability is advisory** — the system does not block a manager from scheduling an employee on a day marked `unavailable`
- **No socket events** — schedule changes are not pushed in real time; clients must refresh
- **Schedule list limit** — `GET /api/schedules` returns at most 20 schedules, ordered by weekStart descending
- **ScheduledShift does not auto-link to TimeClockEntry** — the `actualStartTime`, `actualEndTime`, `actualHours` fields must be filled in manually or via a future integration

---

## Android-Specific Notes
- Android displays the employee's own upcoming scheduled shifts from the published schedule
- Employees can submit swap requests from Android via the swap request screen
- Availability entry management may be admin-only (web) — verify Android coverage before building mobile availability UI
- No shift close-out flow on Android for scheduling; that is handled by the time clock and shift close-out on web POS

---

## 7shifts Integration

Scheduled shifts can be imported from 7shifts using the pull-schedule sync operation.

### Schedule Pull
- Triggered by: `POST /api/integrations/7shifts/pull-schedule`, Vercel cron, or `schedule.published` webhook
- Upserts `ScheduledShift` records by `sevenShiftsShiftId` (external ID — never creates duplicates)
- Soft-deletes shifts where 7shifts reports `status: 'deleted'`
- Skips shifts for employees not yet mapped (no `sevenShiftsUserId`)
- Updates `lastSchedulePullAt/Status/Error` in location settings on complete

### Employee Mapping Requirement
Shifts can only be imported for employees with a `sevenShiftsUserId` set. Map employees at:
**Settings → Integrations → 7shifts → Employee Mapping**

### Scheduling UI Import Panel
The scheduling admin page (`/scheduling`) shows a 7shifts import card with:
- Pull from 7shifts button (fires pull-schedule for current week + next 14 days)
- Last sync status + timestamp
- "7s" badge on ScheduledShift records that originated from 7shifts

### Key Files Added
| File | Purpose |
|------|---------|
| `src/app/api/integrations/7shifts/pull-schedule/route.ts` | Schedule pull API — calls listShifts(), upserts ScheduledShift |
| `src/app/api/webhooks/7shifts/route.ts` | Webhook receiver — schedule.published triggers pull inline |
| `src/app/(admin)/settings/integrations/7shifts/employees/page.tsx` | Employee mapping UI |

---

## Related Docs
- **Shifts feature:** `docs/features/shifts.md`
- **Time Clock feature:** `docs/features/time-clock.md`
- **Employees feature:** `docs/features/employees.md`
- **Roles & Permissions feature:** `docs/features/roles-permissions.md`
- **Domain doc:** `docs/domains/EMPLOYEES-DOMAIN.md`
- **Changelog:** `docs/changelogs/EMPLOYEES-CHANGELOG.md`

---

*Last updated: 2026-03-14*
