# Skill 288: Group History & Segment Timeline

**Domain:** Tips & Tip Bank
**Status:** DONE
**Date:** 2026-02-11
**Dependencies:** 252 (Dynamic Tip Groups), 258 (Tip Reporting & Payroll Export)

---

## Overview

Timeline visualization of tip group split changes over time, added to `/settings/tips` (Section 10). Managers can select any group (active or recently closed) and see a chronological timeline of membership changes, split recalculations, and per-member earnings.

## What Was Built

### GroupHistoryTimeline Component (`src/components/tips/GroupHistoryTimeline.tsx`)

A 429-line component providing:

**Group Selector:**
- Dropdown listing active + recently closed groups (fetches from `/api/reports/tip-groups?locationId=X&limit=50`)
- Shows group ID suffix, status (active/closed), start date, member count
- On selection, loads full group detail with segments and earnings

**Summary Card:**
- 3-column grid: Status (active green dot or "Closed"), Duration (calculated from start/end), Total Members
- `calculateDuration()` helper for human-readable durations (e.g., "2h 30m")

**Vertical Timeline:**
- `buildTimeline()` function merges segments + memberships into chronological `TimelineEvent[]`
- Events sorted by timestamp with type priority as tiebreaker
- Colored dots with SVG icons:
  - **Indigo** (group_created) — Plus icon
  - **Green** (member_joined) — User-add icon
  - **Red** (member_left) — User-remove icon
  - **Blue** (segment_change) — Refresh/recalculate icon
  - **Gray** (group_closed) — X/close icon
- Split percentage badges on segment events (e.g., "Alice: 50%", "Bob: 50%")
- Timestamp on each event

**Earnings Summary Table:**
- Sorted by amount descending
- Employee name + earned amount
- Green text for positive earnings, gray for $0

**Helper Functions:**
- `buildTimeline(group)` — Merges group data into chronological timeline events
- `formatDateTime(iso)` — "Feb 11, 2:30 PM" format
- `formatDate(iso)` — "Feb 11, 2026" format
- `calculateDuration(start, end)` — "2h 30m" or "Active"
- `formatCurrencyFromCents(cents)` — "$15.00"
- `getEarningDollars(e)` — Handles both cents and dollars fields

## APIs Used (All Existing)

| API | Method | Purpose |
|-----|--------|---------|
| `/api/reports/tip-groups?locationId=X&limit=50` | GET | Group list for dropdown |
| `/api/reports/tip-groups?locationId=X&groupId=X` | GET | Full segment + earnings data |

**No new API routes were created.**

## Timeline Event Types

```typescript
interface TimelineEvent {
  timestamp: string
  type: 'group_created' | 'member_joined' | 'member_left' | 'segment_change' | 'group_closed'
  label: string
  sublabel?: string
  dotColor: 'indigo' | 'green' | 'red' | 'blue' | 'gray'
  splitJson?: Record<string, number>
}
```

**Type Priority (for same-timestamp sorting):**
1. group_created (0)
2. member_joined (1)
3. member_left (2)
4. segment_change (3)
5. group_closed (4)

## UI Patterns

- Section wrapper: `bg-white border border-gray-200 rounded-2xl shadow-sm p-6`
- Vertical timeline: `absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200` line
- Dot styles: `w-8 h-8 rounded-full` with border-2 in event color
- Split badges: `px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-600`
- Earnings table: `rounded-xl border border-gray-200 overflow-hidden`
- Props: `{ locationId: string, employeeId: string }` from parent page

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/tips/GroupHistoryTimeline.tsx` | ~429 | Section 10 component |

## Files Modified

| File | Change |
|------|--------|
| `src/app/(admin)/settings/tips/page.tsx` | Added import + conditional render after Section 9 |

## Integration

The component is rendered conditionally in the settings/tips page:
```tsx
{locationId && employee?.id && (
  <GroupHistoryTimeline locationId={locationId} employeeId={employee.id} />
)}
```

## Acceptance Criteria

- [x] Group selector dropdown lists active + closed groups
- [x] Summary card shows status, duration, total members
- [x] Vertical timeline renders chronological events
- [x] Colored dots with appropriate SVG icons per event type
- [x] Split percentage badges on segment change events
- [x] Earnings summary table sorted by amount
- [x] Empty states for no group selected and no segment data
- [x] Loading states for group list and detail
- [x] TypeScript clean (0 errors)
- [x] Production build passes
