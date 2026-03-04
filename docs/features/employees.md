# Feature: Employee Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Employees → read every listed dependency doc.

## Summary
Employee Management handles the full lifecycle of staff records: CRUD operations, PIN-based authentication, role assignment with granular permissions, multi-role support, payment/tax information for payroll, and POS personalization preferences. Employees authenticate via 4-6 digit PINs (hashed, never logged or exposed). Each employee has a primary role that determines their permissions, tip configuration, and cash handling mode. The system supports scheduling, availability, and time clock integration.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, auth, POS personalization | Full |
| `gwi-android-register` | PinLoginScreen, ManagerPinViewModel, MyTipsScreen | Full |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Employee sync, payroll export | Partial |
| `gwi-mission-control` | License tier employee limits | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/employees` → `src/app/(admin)/employees/page.tsx` | Managers |
| Admin | `/employees/[id]/payment` → payment info page | Managers |
| POS Web | PIN login screen | All staff |
| POS Web | Manager PIN prompt (elevated gates) | Managers |
| Android | `PinLoginScreen` | All staff |
| Android | `ManagerPinViewModel` — elevated gate prompts | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/employees/route.ts` | GET/POST employees |
| `src/app/api/employees/[id]/route.ts` | GET/PUT/DELETE single employee |
| `src/app/api/employees/[id]/preferences/route.ts` | Employee POS preferences |
| `src/app/api/employees/[id]/layout/route.ts` | POS layout preferences (bar/food mode, favorites) |
| `src/app/api/employees/[id]/payment/route.ts` | Payment/bank info for payroll |
| `src/app/api/employees/[id]/tips/route.ts` | Employee tip history |
| `src/app/api/employees/[id]/open-tabs/route.ts` | Employee's open tabs |
| `src/app/api/employees/roles/route.ts` | Employee roles listing |
| `src/app/api/roles/route.ts` | GET/POST roles |
| `src/app/api/roles/[id]/route.ts` | PUT/DELETE single role |
| `src/app/api/auth/verify-pin/` | PIN verification without full login |
| `src/app/(admin)/employees/page.tsx` | Employee management admin page |
| `src/app/(admin)/employees/[id]/payment/page.tsx` | Employee payment info page |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/employees` | Employee PIN | List employees |
| `POST` | `/api/employees` | Manager | Create employee |
| `GET` | `/api/employees/[id]` | Employee PIN | Employee details |
| `PUT` | `/api/employees/[id]` | Manager | Update employee |
| `DELETE` | `/api/employees/[id]` | Manager | Soft-delete employee |
| `GET/PUT` | `/api/employees/[id]/preferences` | Employee PIN | POS preferences |
| `GET/PUT` | `/api/employees/[id]/layout` | Employee PIN | Layout preferences |
| `GET/PUT` | `/api/employees/[id]/payment` | Manager | Payment/bank info |
| `GET` | `/api/employees/[id]/tips` | Employee PIN | Tip history |
| `GET` | `/api/employees/[id]/open-tabs` | Employee PIN | Open tabs for employee |
| `GET` | `/api/employees/roles` | Employee PIN | Roles list |
| `GET/POST` | `/api/roles` | Manager (POST) | Role CRUD |
| `PUT/DELETE` | `/api/roles/[id]` | Manager | Single role |
| `POST` | `/api/auth/verify-pin` | None | PIN verification |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `employee:clock-changed` | `{ employeeId }` | Clock in/out (from time-clock API) |

**Note:** Code emits `employees:changed` (plural) on all employee CRUD mutations — not `employee:updated` (singular). Docs and cross-ref matrix corrected to reflect actual event name.

---

## Data Model

Key Prisma models:

```
Employee {
  id, locationId, roleId
  firstName, lastName, displayName, email, phone

  // Address (for W-2 tax documents)
  address, city, state, zipCode

  // Authentication
  pin               String    // 4-6 digit PIN (hashed) — NEVER log or expose
  password          String?   // Optional for admin access (hashed)
  requiresPinChange Boolean   // True when provisioned with default PIN

  // Employment
  hourlyRate        Decimal?
  hireDate          DateTime
  isActive          Boolean

  // Tax Information (W-4 data)
  federalFilingStatus, federalAllowances, additionalFederalWithholding
  stateFilingStatus, stateAllowances, additionalStateWithholding
  isExemptFromFederalTax, isExemptFromStateTax

  // Payment Preferences
  paymentMethod     String?   // direct_deposit | check | cash
  bankName, bankRoutingNumber, bankAccountNumber, bankAccountType
  bankAccountLast4  String?   // Last 4 for display only

  // Year-to-Date Tracking (reset annually)
  ytdGrossEarnings, ytdGrossWages, ytdTips, ytdCommission
  ytdTaxesWithheld, ytdFederalTax, ytdStateTax, ytdLocalTax
  ytdSocialSecurity, ytdMedicare, ytdNetPay

  // POS Personalization
  color             String?   // Floor plan display color
  avatarUrl         String?
  posLayoutSettings Json?     // Bar/Food mode, favorites, category order
  defaultScreen     String?   // orders | bar | kds
  defaultOrderType  String?   // Pre-selected order type
  preferredRoomOrder String?  // JSON array of room IDs

  deletedAt         DateTime? // Soft delete
}

Role {
  id, locationId, name            // Server, Bartender, Manager, Admin
  permissions       Json?          // Array of permission strings
  isTipped          Boolean        // Is this a tipped position?
  tipWeight         Decimal        // Weight for role-weighted tip splits
  cashHandlingMode  CashHandlingMode // drawer | purse | none
  trackLaborCost    Boolean        // Include in labor cost reports
  roleType          String         // FOH | BOH | ADMIN (display only)
  accessLevel       String         // STAFF | MANAGER | OWNER_ADMIN (display only)
}

EmployeeRole {
  id, locationId, employeeId, roleId
  isPrimary         Boolean        // Matches Employee.roleId
  // Supports multi-role: employee can have multiple roles
}
```

---

## Business Logic

### Primary Flow — Employee CRUD
1. Manager creates employee with name, PIN, role assignment
2. PIN is hashed before storage — never stored or logged in plain text
3. `EmployeeRole` record created with `isPrimary = true`
4. Employee can log in via PIN on POS or Android

### PIN Authentication
1. Employee enters 4-6 digit PIN
2. System hashes input and compares to stored hash
3. On match: returns employee record with role and permissions
4. `requiresPinChange = true` forces PIN change on first login (default PINs)
5. `verify-pin` endpoint allows PIN check without full login (for manager gates)

### Multi-Role Support
1. Employee has one primary role (`Employee.roleId`)
2. Additional roles via `EmployeeRole` records
3. At clock-in, employee selects which role to work as (`workingRoleId`)
4. Working role determines tip pool, permissions, and labor tracking for that shift

### POS Personalization
1. Each employee can customize: default screen, layout mode (bar/food), category order
2. Preferences stored in `posLayoutSettings` JSON and `defaultScreen`/`defaultOrderType`
3. Preferences loaded on login, applied to POS UI

### Edge Cases & Business Rules
- **PIN is auth credential — NEVER log or expose** in API responses, logs, or error messages
- **Clock-out blocked if last member of active tip group** (409 error prevents orphaned tip pools)
- **Soft deletes only**: `deletedAt` set, never hard delete (preserves historical data)
- **Role assignment determines ALL permissions** — 85 explicit permission keys in registry
- **`requiresPinChange`**: Employees provisioned with default PIN must change on first login
- **Bank account numbers**: Should be encrypted in production (noted in schema)
- **Year-to-date tracking**: Reset annually, used for W-2 generation and payroll tax calculations

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Tips | Earnings tracking per employee |
| Shifts | Shift belongs to employee |
| Time Clock | Clock-in/out records per employee |
| Orders | Server assignment |
| Floor Plan | Section assignment, display color |
| Reports | Labor data |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Roles | Role assigned determines permissions |
| Settings | Max employees per license tier |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Roles** — does permission change affect employee capabilities?
- [ ] **Tips** — does employee change affect tip pool membership?
- [ ] **Shifts** — does employee deactivation affect open shifts?
- [ ] **Orders** — does server assignment change affect order ownership?
- [ ] **Auth** — does PIN handling change comply with security requirements?
- [ ] **Reports** — does labor data change affect payroll reports?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View employees | `EMPLOYEE_VIEW` | Standard |
| Create employee | `EMPLOYEE_CREATE` | High |
| Edit employee | `EMPLOYEE_EDIT` | High |
| Delete employee | `EMPLOYEE_DELETE` | Critical |
| Manage roles | `ROLE_MANAGE` | Critical |
| View payment info | `EMPLOYEE_PAYMENT_VIEW` | High |
| Edit payment info | `EMPLOYEE_PAYMENT_EDIT` | Critical |

---

## Known Constraints & Limits
- PIN must be 4-6 digits, unique per location
- Employee `displayName` is optional — `firstName lastName` used as fallback
- Bank account number should be encrypted (TODO noted in schema)
- Max employees per location determined by license tier (Mission Control)
- `roleType` and `accessLevel` on Role are display/filtering only — never used for auth decisions

---

## Android-Specific Notes
- **`PinLoginScreen`**: Primary auth screen on Android, 4-6 digit PIN entry
- **`ManagerPinViewModel`**: Elevated permission gates — prompts for manager PIN when action requires higher permissions
- **`MyTipsScreen`** (added 2026-03-03): Employees review pending and recorded tips via `/api/tips/pending-tips` and `/api/tips/recorded-tips`
- Employee preferences synced on login for POS personalization

---

## Related Docs
- **Domain doc:** `docs/domains/EMPLOYEES-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 01, 47, 48, 50, 241, 244
- **Changelog:** `docs/changelogs/EMPLOYEES-CHANGELOG.md`

---

*Last updated: 2026-03-03*
