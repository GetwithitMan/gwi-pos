# EMPLOYEES Domain Changelog

## 2026-02-20 — Sprint Sessions 8-14: Mobile Auth Security, Customer Notes + Order History

### T-025 — Mobile Auth Security
- Removed the `?employeeId` query parameter bypass from `/mobile/tabs` and `/mobile/tabs/[id]`.
- `checkAuth()` is now called unconditionally on both mobile tab routes — no unauthenticated shortcut path remains.
- Session cookie is required for all mobile tab access; unauthenticated requests return 401.

### Customer Notes + Order History
- Inline notes edit on the customer profile page: notes field is editable in place with auto-save.
- Order history tab on customer profile now paginates at 20 orders per page with a date-range filter.

---

## Sessions

_No sessions logged yet. This changelog was created during the 2026-02-09 codebase audit._
