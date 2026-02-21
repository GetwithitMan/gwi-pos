# Skill 416 — Shift Swap Requests

## Overview

Employees can request to swap a scheduled shift with another employee via the mobile schedule screen. The target employee receives the offer and can accept or decline it. After the target employee accepts, a manager must approve the swap, which atomically reassigns the shift in the database. The system enforces that only one active swap request can exist for a given shift at a time, and it cancels any remaining pending requests for that shift once a swap is approved.

## Schema Changes

### `ShiftSwapRequest` model (new)

```prisma
model ShiftSwapRequest {
  id                      String           @id @default(cuid())
  locationId              String
  location                Location         @relation(fields: [locationId], references: [id])
  shiftId                 String
  shift                   ScheduledShift   @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  requestedByEmployeeId   String
  requestedByEmployee     Employee         @relation("SwapInitiator", fields: [requestedByEmployeeId], references: [id])
  requestedToEmployeeId   String?
  requestedToEmployee     Employee?        @relation("SwapTarget", fields: [requestedToEmployeeId], references: [id])
  status                  String           @default("pending") // pending | accepted | approved | rejected | cancelled
  respondedAt             DateTime?
  approvedAt              DateTime?
  approvedByEmployeeId    String?
  approvedByEmployee      Employee?        @relation("SwapApprover", fields: [approvedByEmployeeId], references: [id])
  expiresAt               DateTime?
  notes                   String?
  declineReason           String?
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt
  deletedAt               DateTime?
  syncedAt                DateTime?

  @@index([locationId])
  @@index([shiftId])
  @@index([requestedByEmployeeId])
  @@index([requestedToEmployeeId])
  @@index([status])
}
```

### `ScheduledShift` model — swap tracking fields (existing)

```prisma
originalEmployeeId  String?    // Populated on approve: who was originally scheduled
swappedAt           DateTime?  // When the swap was approved and executed
swapApprovedBy      String?    // Manager employeeId who approved
```

## Key Files

| File | Role |
|------|------|
| `prisma/schema.prisma` | `ShiftSwapRequest` model + `ScheduledShift` swap tracking fields |
| `src/app/api/schedules/[id]/shifts/[shiftId]/swap-requests/route.ts` | `GET` (list shift's requests) + `POST` (create request) |
| `src/app/api/shift-swap-requests/route.ts` | `GET` (list by location/status/employee) |
| `src/app/api/shift-swap-requests/[requestId]/route.ts` | `DELETE` (employee cancels pending request) |
| `src/app/api/shift-swap-requests/[requestId]/accept/route.ts` | `POST` — target employee accepts |
| `src/app/api/shift-swap-requests/[requestId]/decline/route.ts` | `POST` — target employee declines |
| `src/app/api/shift-swap-requests/[requestId]/approve/route.ts` | `POST` — manager approves (executes swap) |
| `src/app/api/shift-swap-requests/[requestId]/reject/route.ts` | `POST` — manager rejects |
| `src/app/(admin)/scheduling/page.tsx` | Admin scheduling page with swap request management UI |
| `src/app/(mobile)/mobile/schedule/page.tsx` | Mobile schedule view with swap request/respond flow |

## How It Works

### Status lifecycle

```
PENDING
  ├─→ ACCEPTED      (target employee agrees)
  │     └─→ APPROVED    (manager executes swap — shift reassigned)
  │     └─→ REJECTED    (manager rejects after acceptance)
  ├─→ REJECTED      (target employee declines — stored as 'rejected')
  └─→ CANCELLED     (initiator cancels via DELETE, or auto-cancelled when another request on same shift is approved)
```

The `status` field uses string values: `"pending"`, `"accepted"`, `"approved"`, `"rejected"`, `"cancelled"`.

### API routes

#### Create a swap request
`POST /api/schedules/{scheduleId}/shifts/{shiftId}/swap-requests`

Body:
```json
{
  "locationId": "...",
  "requestedByEmployeeId": "...",
  "requestedToEmployeeId": "...",  // optional — open offer if omitted
  "notes": "...",                  // optional
  "expiresInDays": 7               // optional, defaults to 7
}
```

Validation: shift must exist, belong to the schedule and location, not be deleted. Rejects with `409` if an active (pending or accepted) swap request already exists for the shift.

#### List swap requests (for admin or incoming offers)
`GET /api/shift-swap-requests?locationId=...&status=pending&employeeId=...`

`employeeId` filters by `requestedToEmployeeId` — i.e., requests targeting a specific employee (used on mobile to show incoming swap offers).

#### Target employee responds

- `POST /api/shift-swap-requests/{requestId}/accept` — moves status `pending` → `accepted`, sets `respondedAt`
- `POST /api/shift-swap-requests/{requestId}/decline` — moves status `pending` → `rejected`, sets `respondedAt` + optional `declineReason`

Both require `{ locationId }` in body. Both guard against non-`pending` status.

#### Manager approval (executes the swap)
`POST /api/shift-swap-requests/{requestId}/approve`

Body: `{ locationId, approvedByEmployeeId }`

Requires status `"accepted"` (employee must accept before manager can approve). Runs a `db.$transaction`:
1. Updates `ShiftSwapRequest` → status `"approved"`, sets `approvedAt` + `approvedByEmployeeId`
2. Updates `ScheduledShift` → sets `employeeId` to `requestedToEmployeeId`, sets `originalEmployeeId`, `swappedAt`, `swapApprovedBy`

After the transaction, cancels all other `pending` requests for the same shift via `updateMany`.

#### Manager rejection
`POST /api/shift-swap-requests/{requestId}/reject`

Moves any `accepted` request back to `rejected`. Requires `{ locationId }` in body, optional `reason`.

#### Employee cancels
`DELETE /api/shift-swap-requests/{requestId}?locationId=...`

Soft-deletes the request (`deletedAt: new Date()`). Only works while status is `"pending"`.

### Admin UI

The admin scheduling page (`src/app/(admin)/scheduling/page.tsx`) shows all swap requests for the location, grouped by status. Managers can see pending/accepted requests and use Approve/Reject buttons, which call the respective API routes.

### Mobile UI

The mobile schedule page (`src/app/(mobile)/mobile/schedule/page.tsx`) provides:

- **Request Swap** button on each shift card (visible for `scheduled` or `confirmed` shifts). Tapping opens a bottom-sheet dialog where the employee can add optional notes before submitting. Submits to `POST /api/schedules/{scheduleId}/shifts/{shiftId}/swap-requests`.
- **Swap Requests For You** section (bottom of page) — loads incoming pending requests targeting the logged-in employee via `GET /api/shift-swap-requests?employeeId=...&status=pending`. Shows a badge count. Each offer card has Accept and Decline buttons.
- Auth is checked unconditionally on mount via `GET /api/mobile/device/auth` (same pattern as the tabs page).

## Configuration / Usage

No special configuration is required. The feature is available to all employees with mobile access. Manager approval requires a manager-level PIN session on the admin scheduling page.

To create a swap request from mobile:
1. Navigate to `/mobile/schedule`
2. Tap "Request Swap" on any eligible shift
3. Optionally add notes, tap "Send Request"
4. The target employee (if specified) will see the offer in their "Swap Requests For You" section
5. Target accepts → manager approves on the scheduling admin page

## Notes

- `requestedToEmployeeId` is optional. A null value creates an open offer (any employee can accept, though the mobile UI currently only shows targeted offers).
- Requests expire via `expiresAt` (default 7 days from creation). Expiry is not currently enforced by a background job — the `expiresAt` field is stored for future cron enforcement.
- Notifications are toast-based (`toast.success` / `toast.error` from `@/stores/toast-store`). There is no Socket.io event emitted for swap request state changes in the current implementation.
- The approve endpoint guards that `status === 'accepted'` — a manager cannot approve a swap that the target employee has not yet accepted.
- Soft deletes (`deletedAt`) are used throughout; no hard deletes are performed.
- The `ScheduledShift.swapApprovedBy` field stores the manager's `employeeId` (a string FK), not the full Employee object.
