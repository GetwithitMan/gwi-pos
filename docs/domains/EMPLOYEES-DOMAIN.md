# Employees Domain

**Domain ID:** 5
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Employees domain manages employee records, roles, permissions, time clock, breaks, shifts, and scheduling. It handles:
- Employee CRUD with PIN-based authentication
- Role definitions and permission management
- Clock in/out with break tracking
- Shift management and cash drawer reconciliation
- Employee scheduling and availability

## Domain Trigger

```
PM Mode: Employees
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Employee CRUD | Employee records | `src/app/api/employees/` |
| Roles | Role definitions | `src/app/api/roles/` |
| Permissions | Permission management | Role-based in employee API |
| Time Clock | Clock in/out | `src/app/api/time-clock/` |
| Shifts | Shift management | `src/app/api/shifts/` |
| Scheduling | Employee schedules | `src/app/api/schedules/` |
| UI | Employee management | `src/app/(admin)/employees/`, `src/components/shifts/`, `src/components/time-clock/` |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/employees` | GET/POST | List/create employees |
| `/api/employees/[id]` | GET/PUT/DELETE | Single employee CRUD |
| `/api/roles` | GET/POST | Role CRUD |
| `/api/roles/[id]` | PUT/DELETE | Single role |
| `/api/auth/verify-pin` | POST | PIN verification without full login |
| `/api/time-clock` | GET/POST | Clock in/out |
| `/api/breaks` | GET/POST | Break start/end |
| `/api/shifts` | GET/POST | Shift management |
| `/api/schedules` | GET/POST | Employee scheduling |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 01 | Employee Management | DONE |
| 47 | Clock In/Out | DONE |
| 48 | Breaks | DONE |
| 50 | Shift Close | DONE |
| 241 | Employee Scheduling | DONE |
| 244 | Payroll System | DONE |

## Integration Points

- **Orders Domain**: Employee assignment to orders, server tracking
- **Reports Domain**: Labor reports, shift reports, tip share reports
- **Payments Domain**: Tip tracking per employee
- **Financial Domain**: Payroll processing, tip-out rules
