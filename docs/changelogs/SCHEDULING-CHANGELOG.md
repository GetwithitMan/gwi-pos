# Scheduling Domain Changelog

## 2026-02-20 — Sprint Sessions 8-14: Shift Swap System, Schedule Edit/Delete, Mobile Schedule View

### Shift Swap System
- New `ShiftSwapRequest` Prisma model: tracks `requesterId`, `targetId`, `approverId`, and a `status` lifecycle (`pending | approved | rejected | cancelled`).
- `POST /api/scheduling/swap-requests` — employee submits a swap request targeting another employee's shift.
- `PUT /api/scheduling/swap-requests/[id]` — approver (manager or target employee) updates status.
- Admin swap-request list page with filter by date and status.
- Mobile swap request page at `/mobile/schedule/swap` for employees to initiate and respond to requests.

### Scheduling Edit/Delete + Mobile View
- Admin scheduling page now supports editing and deleting existing shifts inline.
- New mobile page at `/mobile/schedule` showing the authenticated employee's upcoming shifts with date filter.

---

## 2026-02-09 — Domain Created
- Domain 22 established for Scheduling
- Covers employee scheduling, shift planning, availability
- Domain doc created at `/docs/domains/SCHEDULING-DOMAIN.md`
