# Feature: Shifts & Payroll

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Shifts & Payroll → read every listed dependency doc.

## Summary
Shifts track an employee's working session from clock-in to close-out, encompassing sales totals, cash drawer management, tip distribution, and payroll data. A shift opens when an employee clocks in (via time clock) and closes when they complete the shift close-out process — which MUST verify no pending tips remain. Manager override is required to force-close a shift with open orders. Shift data feeds into labor reports and payroll processing.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, shift close-out UI, time clock | Full |
| `gwi-android-register` | Clock in/out, shift summary | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Payroll aggregation | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Shift Start Modal → `src/components/shifts/ShiftStartModal.tsx` | All staff |
| POS Web | Shift Closeout Modal → `src/components/shifts/ShiftCloseoutModal.tsx` | All staff / Managers |
| POS Web | Time Clock Modal → `src/components/time-clock/TimeClockModal.tsx` | All staff |
| Admin | Employee shift history | Managers |
| Android | Clock in/out screen | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/shifts/route.ts` | GET/POST shifts |
| `src/app/api/shifts/[id]/route.ts` | GET/PUT single shift (close-out) |
| `src/app/api/time-clock/route.ts` | POST clock in/out, emits `employee:clock-changed` |
| `src/app/api/time-clock/status/route.ts` | GET current clock status |
| `src/app/api/breaks/route.ts` | GET/POST break start/end |
| `src/app/api/schedules/route.ts` | GET/POST schedules |
| `src/app/api/schedules/[id]/route.ts` | Single schedule |
| `src/app/api/schedules/[id]/shifts/route.ts` | Scheduled shifts |
| `src/app/api/schedules/[id]/shifts/[shiftId]/route.ts` | Single scheduled shift |
| `src/app/api/schedules/[id]/shifts/[shiftId]/swap-requests/route.ts` | Shift swap requests |
| `src/components/shifts/ShiftStartModal.tsx` | Shift start flow with drawer selection |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Shift close-out with tip/order checks |
| `src/components/time-clock/TimeClockModal.tsx` | Time clock modal |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/shifts` | Employee PIN | List shifts (filterable by employee/date) |
| `POST` | `/api/shifts` | Employee PIN | Open new shift |
| `GET` | `/api/shifts/[id]` | Employee PIN | Shift details |
| `PUT` | `/api/shifts/[id]` | Employee PIN / Manager | Close/update shift |
| `POST` | `/api/time-clock` | Employee PIN | Clock in/out |
| `GET` | `/api/time-clock/status` | Employee PIN | Current clock status |
| `POST` | `/api/breaks` | Employee PIN | Start/end break |
| `GET/POST` | `/api/schedules` | Manager | Schedule management |
| `GET/PUT/DELETE` | `/api/schedules/[id]` | Manager | Single schedule |
| `GET/POST` | `/api/schedules/[id]/shifts` | Manager | Scheduled shifts |
| `POST` | `/api/schedules/[id]/shifts/[shiftId]/swap-requests` | Employee PIN | Shift swap requests |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `employee:clock-changed` | `{ employeeId }` | Clock in/out completed |

**Note:** `shift:opened` and `shift:closed` events are referenced in test suites but actual socket dispatch was not found in the codebase — these may be emitted as part of `employee:clock-changed` or not yet wired.

---

## Data Model

Key Prisma models:

```
Shift {
  id, locationId, employeeId
  startedAt       DateTime
  endedAt         DateTime?
  status          ShiftStatus   // open | closed

  // Cash management
  startingCash    Decimal
  expectedCash    Decimal?
  actualCash      Decimal?
  variance        Decimal?      // expectedCash - actualCash

  // Sales summary
  totalSales      Decimal?
  cashSales       Decimal?
  cardSales       Decimal?
  tipsDeclared    Decimal?

  // Tip distribution
  grossTips       Decimal?      // Total tips before distribution
  tipOutTotal     Decimal?      // Amount tipped out to others
  netTips         Decimal?      // Tips kept (gross - tipOut)

  notes           String?
  timeClockEntryId String?      // Link to time clock entry
  workingRoleId    String?      // Multi-role: which role working as
  drawerId         String?      // Physical drawer claimed (null for purse/none modes)
}

// cashHandlingMode is on the Role model (not Shift directly):
Role {
  cashHandlingMode  CashHandlingMode  // drawer | purse | none — inherited at clock-in
}

TimeClockEntry {
  id, locationId, employeeId
  clockIn         DateTime
  clockOut        DateTime?
  breakStart      DateTime?     // legacy single-break fields (superseded by Break model)
  breakEnd        DateTime?
  breakMinutes    Int           // total break minutes for this entry
  regularHours    Decimal?
  overtimeHours   Decimal?
  workingRoleId   String?       // Multi-role support
  selectedTipGroupId String?    // Tip group assigned at clock-in
  drawerCountIn   Json?         // { denominations, total }
  drawerCountOut  Json?
}

Break {
  id, locationId, employeeId
  timeClockEntryId  String      // FK to TimeClockEntry
  breakType         BreakType   // paid | unpaid | meal
  status            BreakStatus // active | completed
  startedAt         DateTime
  endedAt           DateTime?
  duration          Int?        // minutes, calculated on end
  notes             String?
}

EmployeeRole {
  id, locationId, employeeId, roleId
  isPrimary       Boolean       // Matches Employee.roleId
}
```

### Break Tracking

The `Break` model tracks individual break periods within a `TimeClockEntry`. Break types:

| Type | Description |
|------|-------------|
| `paid` | Short break — time counts toward paid hours |
| `unpaid` | Standard break — time deducted from paid hours |
| `meal` | Meal period — time deducted from paid hours |

**How breaks affect time calculations:**
- `breakMinutes` on `TimeClockEntry` accumulates total break time
- `regularHours` = (clockOut - clockIn) minus unpaid/meal break minutes
- Paid breaks are NOT deducted from `regularHours`
- Break start/end is tracked via `POST /api/breaks` (see API Endpoints)
- `duration` is calculated server-side when the break ends (not client-supplied)

**API:**
- `POST /api/breaks` with `action: "start"` → creates `Break` record with `status: active`
- `POST /api/breaks` with `action: "end"` → sets `endedAt`, calculates `duration`, updates `breakMinutes` on `TimeClockEntry`

### Cash Reconciliation

`cashHandlingMode` is configured on the employee's `Role` and determines how cash is tracked for a shift:

| Mode | Behavior |
|------|----------|
| `drawer` | Employee claims a shared physical drawer at shift start; cash counted in/out against that drawer |
| `purse` | Employee carries their own cash; no shared drawer claimed |
| `none` | Employee handles no cash (e.g., kitchen staff, card-only bar) |

**Reconciliation flow at shift close:**
1. System calculates `expectedCash` from all cash sales during the shift
2. Manager (or employee) enters `actualCash` — the physical count of bills and coins
3. `variance = expectedCash - actualCash` is stored on the `Shift` record
4. Positive variance = cash over; negative variance = cash short
5. Variance is logged and surfaced in shift reports
6. `drawerCountIn` / `drawerCountOut` on `TimeClockEntry` store denomination breakdowns as JSON (`{ denominations: {...}, total: Decimal }`)

---

## Business Logic

### Primary Flow — Shift Lifecycle
1. Employee clocks in via time clock → `TimeClockEntry` created
2. `Shift` record created, linked to `TimeClockEntry`
3. Employee selects tip group (from `TipGroupTemplate` system) at clock-in
4. Employee selects/claims physical drawer (if `cashHandlingMode = drawer`)
5. Throughout shift: sales, tips, cash tracked on `Shift` record
6. Employee initiates close-out via `ShiftCloseoutModal`

### Shift Close-Out Flow
1. System checks for pending tips (closed card payments with $0 tip)
2. **If pending tips exist → BLOCK close** (must resolve first)
3. System checks for open orders assigned to this employee
4. **If open orders exist → require Manager override** to force-close
5. Employee counts cash drawer → enters `actualCash`
6. System calculates `variance = expectedCash - actualCash`
7. Tip distribution processed (tip-outs calculated per `TipOutRule`)
8. `Shift.status` set to `closed`, `endedAt` set

### Time Clock
1. Clock-in: Creates `TimeClockEntry`, optionally selects working role and tip group
2. Clock-out: Sets `clockOut`, calculates `regularHours` and `overtimeHours`
3. Emits `employee:clock-changed` socket event on both clock-in and clock-out
4. Dashboard listens to `employee:clock-changed` for live staff count

### Edge Cases & Business Rules
- **Clock-out blocked if last member of active tip group** (409 error)
- **Clock-out blocked during active payment** processing
- **Shift close MUST check pending tips** before finalizing
- **Manager override required** to force-close with open orders
- **Multi-role support**: `workingRoleId` tracks which role employee is working as this shift
- **Drawer management**: `cashHandlingMode` on Role determines drawer behavior (drawer, purse, none)
- **Break tracking**: Break minutes deducted from regular hours calculation
- **Cash tip declarations** (Skill 259): Employees declare cash tips received during shift

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Reports | Labor reports, shift reports |
| Tips | Payout at shift close, tip distribution |
| Employees | Shift history |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Employees | Shift belongs to employee |
| Tips | Pending tips block shift close |
| Time Clock | Clock-in/out creates shift entries |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Tips** — does change affect pending tip check at close?
- [ ] **Employees** — does multi-role change affect shift/role tracking?
- [ ] **Reports** — does close-out data change affect labor reports?
- [ ] **Permissions** — does close-out require different permission levels?
- [ ] **Offline** — shift operations must work offline

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Clock in/out | `TIME_CLOCK` | Standard |
| Start shift | `SHIFT_START` | Standard |
| Close own shift | `SHIFT_CLOSE` | Standard |
| Force-close with open orders | `SHIFT_FORCE_CLOSE` | Manager |
| View all shifts | `SHIFT_VIEW_ALL` | High |
| Edit shift history | `SHIFT_EDIT` | Manager |
| Manage schedules | `SCHEDULE_MANAGE` | Manager |

---

## Known Constraints & Limits
- Shift close MUST resolve all pending tips before finalizing
- Manager override required for force-close with open orders
- Clock-out blocked if last member of active tip group (prevents orphaned tip pools)
- Break minutes tracking is manual (start/end) — no automatic enforcement
- Shift data used for payroll period calculations

---

## Android-Specific Notes
- `PinLoginScreen` supports clock-in flow
- Android can clock in/out and view current shift summary
- `MyTipsScreen` (2026-03-03): employees review pending and recorded tips via `/api/tips/pending-tips` and `/api/tips/recorded-tips`
- No full shift close-out UI on Android — managers use web POS for close-out

---

## Related Docs
- **Domain doc:** `docs/domains/EMPLOYEES-DOMAIN.md` (shifts section)
- **Tips guide:** `docs/domains/TIPS-DOMAIN.md`
- **Skills:** Skill 47, 48, 50, 241, 244
- **Changelog:** `docs/changelogs/EMPLOYEES-CHANGELOG.md`

---

*Last updated: 2026-03-03*
