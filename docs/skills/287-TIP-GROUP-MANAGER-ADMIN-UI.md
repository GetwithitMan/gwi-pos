# Skill 287: Tip Group Manager Admin UI

**Domain:** Tips & Tip Bank
**Status:** DONE
**Date:** 2026-02-11
**Dependencies:** 252 (Dynamic Tip Groups), 256 (Manager Adjustments), 283 (Tip Groups Admin Page)

---

## Overview

Manager dashboard for viewing and managing active tip groups directly from `/settings/tips` (Section 9). Previously, all group management required raw API calls — this skill adds a full admin UI for group lifecycle management.

## What Was Built

### ActiveGroupManager Component (`src/components/tips/ActiveGroupManager.tsx`)

A 712-line component providing:

**Group List:**
- Expandable group cards showing status, split mode, owner, member count, and creation time
- Color-coded status: green (active), gray (closed)
- Relative time display for group age

**Member Management:**
- Member rows showing name, role, join time, split percentage
- Stale member detection: red "12h+ Active" badge for members active >12 hours (forgotten clock-outs)
- Remove member button (calls `DELETE /api/tips/groups/[id]/members?employeeId=X`)

**Pending Join Requests:**
- Amber-highlighted pending members with approve/reject buttons
- Approve calls `PUT /api/tips/groups/[id]/members` with `action: 'approve'`

**Modals:**
- **Add Member Modal** — Employee picker dropdown (fetches from `/api/employees`), calls `POST /api/tips/groups/[id]/members` with `action: 'add'`
- **Transfer Ownership Modal** — Select new owner from current members, calls `PUT /api/tips/groups/[id]` with `newOwnerId`
- **Close Group Confirm** — Confirmation dialog, calls `DELETE /api/tips/groups/[id]`
- **Manual Adjustment Modal** — Employee selection, amount (dollars), reason text. Calls `POST /api/tips/adjustments` with `adjustmentType: 'manual_override'`

**Helper Functions:**
- `isStale(joinedAt)` — Flags members active >12 hours
- `getMemberName()` — Resolves employee name from membership data
- `formatRelativeTime()` — Human-readable relative timestamps
- `getGroupDisplayName()` — Group display with owner name or ID suffix

## APIs Used (All Existing)

| API | Method | Purpose |
|-----|--------|---------|
| `/api/tips/groups?locationId=X&status=active` | GET | List active groups |
| `/api/tips/groups/[id]` | PUT | Transfer ownership, change split mode |
| `/api/tips/groups/[id]` | DELETE | Close group |
| `/api/tips/groups/[id]/members` | POST | Add member (`action: 'add'`) |
| `/api/tips/groups/[id]/members` | PUT | Approve join request |
| `/api/tips/groups/[id]/members?employeeId=X` | DELETE | Remove member |
| `/api/tips/adjustments` | POST | Manual adjustment |
| `/api/employees?locationId=X` | GET | Employee picker |

**No new API routes were created.**

## UI Patterns

- Section wrapper: `bg-white border border-gray-200 rounded-2xl shadow-sm p-6`
- Group cards: `p-4 rounded-xl border` with expand/collapse
- Status badges: green (active), amber (pending), red (stale >12h)
- Modals: `fixed inset-0 bg-black/40 backdrop-blur-sm` with white card
- Toast notifications for all mutations
- Props: `{ locationId: string, employeeId: string }` from parent page
- All API calls include `x-employee-id` header

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/tips/ActiveGroupManager.tsx` | ~712 | Section 9 component |

## Files Modified

| File | Change |
|------|--------|
| `src/app/(admin)/settings/tips/page.tsx` | Added import + conditional render after Section 8 |

## Integration

The component is rendered conditionally in the settings/tips page:
```tsx
{locationId && employee?.id && (
  <ActiveGroupManager locationId={locationId} employeeId={employee.id} />
)}
```

## Acceptance Criteria

- [x] Lists all active tip groups for the location
- [x] Expand/collapse group cards to see members
- [x] Add/remove members from groups
- [x] Transfer ownership to another member
- [x] Close groups with confirmation
- [x] Approve/reject pending join requests
- [x] Stale member warning (>12h active)
- [x] Manual tip adjustment form
- [x] Toast feedback on all actions
- [x] TypeScript clean (0 errors)
- [x] Production build passes
