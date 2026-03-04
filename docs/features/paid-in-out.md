# Feature: Paid In / Out

> **Status: ACTIVE** — Fully built as of 2026-03-04.

## Summary
Cash drawer adjustment tracking. Managers record cash added to (Paid In) or removed from (Paid Out) the drawer for non-sale purposes — vendor payments, change fund, cash drops, etc. Surfaced on the Live Dashboard and included in shift/drawer reports.

## Schema
`PaidInOut` model:
- `id`, `locationId`, `drawerId`, `drawerName`
- `type` — `'paid_in' | 'paid_out'`
- `amount` — Decimal
- `reason` — String (required)
- `reference` — String? (invoice #, etc.)
- `employeeId` / `employeeName` — who recorded it
- `approvedBy` / `approverName` — optional manager approval (stored, not enforced in UI)
- `createdAt`, `updatedAt`, `deletedAt`

## Code Locations
| Purpose | Path |
|---------|------|
| API (list + create) | `src/app/api/paid-in-out/route.ts` |
| API (get + soft delete) | `src/app/api/paid-in-out/[id]/route.ts` |
| Admin UI | `src/app/(admin)/cash-drawer/paid-in-out/page.tsx` |

## Key Capabilities
- **Create** — Paid In (green) or Paid Out (red) with amount, required reason, optional reference
- **List** — today's records for the location with summary (Total In / Total Out / Net)
- **Socket** — emits `drawer:paid_in_out` on creation for real-time dashboard updates
- **Live Dashboard** — `paidInTotal`, `paidOutTotal`, `paidNetTotal` surfaced on `/api/dashboard/live`
- **Soft delete** — `DELETE /api/paid-in-out/[id]`

## Business Logic
- GET scopes to today (`createdAt >= midnight`) for the requesting location
- Permission: `REPORTS_VIEW` to list; create uses same manager-level access
- Summary: `totalPaidIn`, `totalPaidOut`, `net = totalPaidIn - totalPaidOut`, `count`

## Known Constraints
- No approval workflow enforced in UI (threshold-based manager PIN not implemented)
- No voucher/receipt printing
- No photo attachment

## Dependencies
- **Cash Drawers** — `drawerId` references the active drawer
- **Employees** — `employeeId` of recording employee
- **Reports** — flows into shift cash summary and Live Dashboard
- **Roles** — permission check on create/list

*Last updated: 2026-03-04*
