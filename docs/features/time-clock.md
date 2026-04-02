# Feature: Time Clock

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Employee clock-in/out system with break tracking, overtime calculation (8-hour threshold), tip group assignment at clock-in, buddy-punch detection, and shift lifecycle management. Clock-out is blocked if the employee is the last member of an active tip group or during an active payment.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, POS crew page, shift management | Full |
| `gwi-android-register` | Clock-in/out, break tracking | Full |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud sync of time records | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | Dashboard (clock status indicators) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/time-clock/route.ts` | POST (clock-in) + PUT (clock-out/break) |
| `src/app/api/time-clock/status/route.ts` | GET clock-in status for employee |
| `src/app/api/breaks/route.ts` | GET/POST/PUT break management |
| `src/app/api/shifts/route.ts` | GET/POST shift lifecycle |
| `src/app/api/tips/group-templates/eligible/route.ts` | GET eligible tip groups for clock-in |
| `src/lib/domain/tips/tip-groups.ts` | `findLastMemberGroup()` — clock-out guard |
| `src/lib/domain/tips/tip-group-templates.ts` | `assignEmployeeToTemplateGroup()` |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/time-clock` | Employee PIN | Clock in (with optional role + tip group) |
| `PUT` | `/api/time-clock` | Employee PIN | Clock out, start break, end break |
| `GET` | `/api/time-clock/status` | Employee PIN | Check if employee is clocked in |
| `GET` | `/api/breaks` | Employee PIN | List breaks for entry |
| `POST` | `/api/breaks` | Employee PIN | Start a break |
| `PUT` | `/api/breaks` | Employee PIN | End a break |
| `GET` | `/api/shifts` | Employee PIN | List shifts with filters |
| `POST` | `/api/shifts` | Employee PIN | Start a new shift |
| `GET` | `/api/tips/group-templates/eligible` | Employee PIN | Eligible tip groups for role |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `employee:clock-changed` | `{ employeeId }` | Clock in, clock out, or break change |

---

## Data Model

```
TimeClockEntry {
  id                   String
  locationId           String
  employeeId           String
  clockIn              DateTime
  clockOut             DateTime?         // null if still clocked in
  breakMinutes         Int               // accumulated break time
  regularHours         Decimal?          // hours up to 8
  overtimeHours        Decimal?          // hours beyond 8
  workingRoleId        String?           // multi-role support
  selectedTipGroupId   String?           // tip group assigned at clock-in
  drawerCountIn        Json?             // { denominations, total }
  drawerCountOut       Json?
  notes                String?
  deletedAt            DateTime?
}

Break {
  id                   String
  locationId           String
  timeClockEntryId     String
  employeeId           String
  breakType            Enum              // paid | unpaid | meal
  startedAt            DateTime
  endedAt              DateTime?
  duration             Int?              // minutes, calculated on end
  status               Enum              // active | completed
  deletedAt            DateTime?
}
```

---

## Business Logic

### Clock-In Flow
1. Employee enters PIN on crew page
2. If multiple roles: role picker modal shown
3. Fetch eligible tip group templates for selected role
4. If templates available: group picker modal shown
5. `POST /api/time-clock` with `employeeId`, `workingRoleId`, `selectedTipGroupTemplateId`
6. On template selection: `assignEmployeeToTemplateGroup()` runs
7. Creates/joins runtime TipGroup from template
8. Emits `employee:clock-changed` socket event
9. Emits cloud event for sync
10. Creates audit log with IP/device fingerprint (buddy-punch detection)

### Clock-Out Flow (CRITICAL GUARDS)
1. Find active tip groups where employee is sole member
2. **If found**: Return `errorCode: last_group_member` with `groupId` → **block clock-out (409)**
3. UI shows modal: "Close the group before clocking out" → redirects to `/crew/tip-group`
4. Manager can override with `force: true` (audit-logged)
5. Calculate worked hours: `totalMinutes = (now - clockIn) - breakMinutes`
6. If worked > 8 hours: split into `regularHours` + `overtimeHours`
7. Auto-end any open break
8. Emit `employee:clock-changed` socket event

### Buddy-Punch Detection
- Captures IP address from request headers
- Creates device fingerprint: `{ipAddress}|{userAgent}`
- Checks recent clock events (< 1 hour) from different IPs
- If mismatch found: dispatches location alert warning

### Edge Cases & Business Rules
- Clock-out blocked during active payment (409)
- Clock-out blocked if last member of active tip group (409)
- Clock-in assigns employee to tip group template if selected
- Overtime threshold: 8 hours regular, beyond = overtime
- Multiple breaks accumulated in `breakMinutes`
- Break auto-ended on clock-out if still active

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Shifts | Clock events generate shift records |
| Tips | Clock-in assigns tip group; clock-out blocked if last member |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Employees | Clock event belongs to employee |
| Tips | Group template assigned on clock-in |
| Payments | Active payment blocks clock-out |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Tips** — clock-out guard: last member of tip group check
- [ ] **Shifts** — shift generated from clock events
- [ ] **Employees** — employee PIN auth and role assignment
- [ ] **Payments** — active payment blocking
- [ ] **Socket** — `employee:clock-changed` event consumed by dashboard

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Clock self in/out | `staff.time_clock_self` | Standard |
| Clock others in/out | `staff.clock_others` | High |
| Force clock-out | `manager.force_clock_out` | Critical |
| Edit time records | `manager.edit_time_records` | Critical |
| View time records | `staff.view_time_records` | Standard |

---

## Known Constraints & Limits
- One active clock-in per employee (prevent duplicates)
- Overtime threshold hardcoded at 8 hours
- Buddy-punch detection checks 1-hour window
- Group assignment wrapped in try/catch — clock-in succeeds even if group fails

---

## Android-Specific Notes
- Clock-in/out via native crew screen
- Heartbeat every 30 seconds (native heartbeat endpoint)
- Break tracking with break type selection

---

## Related Docs
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Time Clock row
- **Tips domain:** `docs/domains/TIPS-DOMAIN.md`
- **Employees domain:** `docs/domains/EMPLOYEES-DOMAIN.md`
- **Skills:** Skill 47 (Employees), Skill 48 (Time Clock)

---

*Last updated: 2026-03-03*
