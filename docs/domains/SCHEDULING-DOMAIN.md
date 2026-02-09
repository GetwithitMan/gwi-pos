# Scheduling Domain

**Domain ID:** 22
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Scheduling domain manages employee work schedules, shift planning, and labor forecasting. It handles:
- Weekly/monthly schedule creation and management
- Shift template management
- Employee availability tracking
- Schedule publishing and notifications
- Labor cost forecasting based on scheduled hours
- Schedule conflict detection

## Domain Trigger

```
PM Mode: Scheduling
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Schedules | Schedule CRUD and publishing | `src/app/api/schedules/` |
| Admin UI | Schedule management page | `src/app/(admin)/scheduling/page.tsx` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/scheduling/page.tsx` | Scheduling admin interface |
| `src/app/api/schedules/route.ts` | Schedule CRUD API |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/schedules` | GET/POST | Schedule CRUD |
| `/api/schedules/[id]` | PUT/DELETE | Single schedule |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 241 | Employee Scheduling | DONE |

## Integration Points

- **Employees Domain**: Employee records, roles, availability
- **Financial Domain**: Labor cost forecasting from scheduled hours
- **Reports Domain**: Scheduled vs actual hours reports
