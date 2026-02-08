---
skill: 241
title: Employee Scheduling
status: DONE
depends_on: [01]
---

# Skill 241: Employee Scheduling

> **Status:** DONE
> **Domain:** Employees
> **Dependencies:** 01 (Employee Management)
> **Last Updated:** 2026-02-08

## Overview

Employee shift scheduling with weekly views, role-based assignments, and availability tracking. Managers create and assign shifts; employees set availability.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/scheduling/page.tsx` | Scheduling admin page |
| `src/app/api/schedules/route.ts` | Schedule CRUD API |
| `src/app/api/schedules/[id]/` | Individual schedule management |

## Schema Models

- `Schedule` -- Weekly schedule container
- `ScheduledShift` -- Individual shift assignments (employee, role, start/end time)
- `AvailabilityEntry` -- Employee availability preferences

## Connected Parts

- **Employee Management (Skill 01)**: Employees assigned to shifts
- **Roles**: Shifts can be assigned by role
- **Time Clock (Skill 47)**: Scheduled vs actual hours comparison
