# Skill 249: Multi-Role Employees, Cash Handling & Crew Hub

**Status:** DONE (Phase 6 — Foundational Layer)
**Domain:** Employees, Payments
**Date:** 2026-02-10
**Dependencies:** Skill 01 (Employee Management), Skill 47 (Clock In/Out), Skill 50 (Shift Close)
**Related Specs:** SPEC-05-EMPLOYEES-ROLES.md, SPEC-37-DRAWER-MANAGEMENT.md

## Overview

Phase 6 of the GWI POS system implements the foundational layer for multi-role employees, cash handling modes, physical drawer management, and a non-POS Crew Hub for employees without POS access.

## Features Implemented

### 1. Multi-Role Employees (EmployeeRole Junction)

**Schema:** `EmployeeRole` model with `isPrimary` flag and soft delete support.

- Employees can hold multiple roles (e.g., Manager + Bartender)
- Primary role determines default permissions and cash handling
- At login, multi-role employees see a role picker
- Working role stored in auth store for the session

**Files:**
- `prisma/schema.prisma` — EmployeeRole model, unique constraint on employeeId+roleId
- `src/stores/auth-store.ts` — `workingRole`, `setWorkingRole`, `availableRoles`
- `src/app/api/auth/login/route.ts` — Returns `availableRoles` from EmployeeRole junction
- `src/app/(auth)/login/page.tsx` — Role picker UI, crew redirect for non-POS roles
- `src/app/(admin)/employees/page.tsx` — Multi-role checkbox UI in edit modal
- `src/app/api/employees/[id]/route.ts` — GET returns additionalRoles, PUT syncs junction

### 2. Cash Handling Modes (Per-Role)

Three cash handling modes configurable per role:

| Mode | Description | Shift Start | Shift Close |
|------|-------------|-------------|-------------|
| `drawer` | Physical drawer assigned | Select drawer + count cash | Count drawer |
| `purse` | Server carries cash | Enter starting purse amount | Count purse |
| `none` | No cash handling (barback) | Auto-start (no modal) | Skip cash step |

**Files:**
- `prisma/schema.prisma` — `Role.cashHandlingMode`, `Role.trackLaborCost`, `Role.isTipped`
- `src/app/(admin)/roles/page.tsx` — Cash handling selector, tipped/labor badges
- `src/app/api/roles/route.ts`, `roles/[id]/route.ts` — CRUD for new fields
- `src/app/api/shifts/route.ts` — POST validates mode, claims drawer if drawer mode
- `src/components/shifts/ShiftStartModal.tsx` — Three distinct UIs per mode
- `src/components/shifts/ShiftCloseoutModal.tsx` — Three closeout flows per mode

### 3. Physical Drawer Management

**Schema:** `Drawer` model with `name`, `deviceId`, `isActive`, location scoping.

- Drawers seeded per location (Bar Drawer 1, Bar Drawer 2, Register 1)
- Drawer availability check: only one open shift per drawer
- Shift claims drawer via `Shift.drawerId`
- Drawer-aware expected cash: includes ALL cash from any employee using that drawer
- Payment attribution: `resolveDrawerForPayment()` links cash payments to drawers

**Files:**
- `prisma/schema.prisma` — Drawer model, `Shift.drawerId`, `Payment.drawerId`
- `prisma/seed.ts` — 3 drawers seeded
- `src/app/api/drawers/route.ts` — GET endpoint with availability and claimedBy info
- `src/app/api/shifts/[id]/route.ts` — Drawer-aware cash calculation in `calculateShiftSummary()`
- `src/app/api/orders/[id]/pay/route.ts` — `resolveDrawerForPayment()` function

### 4. Crew Hub (Non-POS Landing Page)

Employees without `pos.access` permission get redirected to `/crew` instead of `/orders`.

**Pages:**
- `/crew` — Main hub: time clock, role picker, navigation to reports
- `/crew/shift` — Employee's own shift report
- `/crew/tips` — Employee's own tips/tip shares
- `/crew/commission` — Employee's own commission report

**Files:**
- `src/app/(pos)/crew/page.tsx` — 382 lines, full crew hub
- `src/app/(pos)/crew/shift/page.tsx` — 229 lines
- `src/app/(pos)/crew/tips/page.tsx` — 212 lines
- `src/app/(pos)/crew/commission/page.tsx` — 208 lines

### 5. Report Self-Access

Report APIs now allow employees to view their own data without admin permissions:
- Commission report: self-access bypass
- Employee shift report: self-access bypass
- Tips report: self-access bypass

**Pattern:**
```typescript
const isSelfAccess = employeeId && requestingEmployeeId && employeeId === requestingEmployeeId
if (!isSelfAccess) {
  const auth = await requirePermission(...)
}
```

### 6. Supporting Changes

- **AdminNav**: Permission-gated navigation sections
- **BartenderView/FloorPlanHome**: `onOpenTimeClock` prop, Clock Out button
- **Time Clock**: Clock-out confirmation dialog
- **ClockOutSettings**: New settings interface (requireSettledBeforeClockOut, requireTipsAdjusted, allowTransferOnClockOut)
- **Seed data**: EmployeeRole records, Barback role (PIN: 9999), Drawer records

## Schema Changes

```prisma
model EmployeeRole {
  id         String    @id @default(cuid())
  locationId String
  employeeId String
  roleId     String
  isPrimary  Boolean   @default(false)
  deletedAt  DateTime?
  syncedAt   DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  @@unique([employeeId, roleId])
}

model Drawer {
  id         String    @id @default(cuid())
  locationId String
  name       String
  deviceId   String?
  isActive   Boolean   @default(true)
  deletedAt  DateTime?
  syncedAt   DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}

// Added fields:
// Role: cashHandlingMode, trackLaborCost, isTipped
// Shift: drawerId, workingRoleId
// Payment: drawerId, shiftId, terminalId
```

## What's NOT Implemented (Future Phases)

From SPEC-05 and SPEC-37, these remain for future work:

### Employee Enhancements (SPEC-05)
- [ ] Employee photo/avatar upload
- [ ] Employment type (full-time, part-time, contractor)
- [ ] Termination workflow with reason tracking
- [ ] Pay rate per role (different hourly rate per job)
- [ ] Admin password (separate from PIN)
- [ ] Failed attempt lockout
- [ ] Emergency contact info
- [ ] Role hierarchy with cloning
- [ ] Department assignment

### Drawer Management (SPEC-37)
- [ ] Safe drops (move cash from drawer to safe)
- [ ] Paid in/out transactions
- [ ] Denomination counting (bills + coins breakdown)
- [ ] Drawer audit trail
- [ ] Blind count mode (hide expected amount)
- [ ] Manager override for drawer discrepancies
- [ ] Cash drop alerts (when drawer exceeds threshold)
- [ ] Multi-drawer support per employee

## Verification

1. Login with Manager (1234) → should see role picker (Manager + Bartender)
2. Select Bartender role → ShiftStartModal shows drawer selection
3. Select Manager role → ShiftStartModal auto-starts (none mode)
4. Login with Barback (9999) → should redirect to /crew (no POS access)
5. Crew Hub → Shift Report → should show own data without admin permission
6. Close shift with drawer → verify drawer-aware expected cash calculation
7. Admin /roles → verify cashHandlingMode selector and badges
8. Admin /employees → verify multi-role checkboxes
