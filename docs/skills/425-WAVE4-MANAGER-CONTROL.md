# Skill 425: Wave 4 — Manager Control & Owner Visibility

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Post-Wave-3 field observation identified 10 gaps (9 active, W4-4 already done) in manager/owner tooling: no configurable approval thresholds for voids and discounts, no per-role discount limits, item deletions leave no audit trail, the manager dashboard lacks employee performance metrics, no real-time alert system, no audit log browser, several reports lack CSV export, no flash report, no speed-of-service metrics, and no food cost variance UI.

## Solution

### 9 Items Across 3 Focus Areas

| # | ID | Area | Fix Summary |
|---|-----|------|-------------|
| 1 | W4-1 | Approvals & Limits | Configurable void/discount approval thresholds in location settings, enforced in discount and comp-void routes with 403 + `requiresApproval` flag |
| 2 | W4-2 | Approvals & Limits | Per-role discount limits — non-managers capped by `defaultMaxDiscountPercent`, managers unrestricted |
| 3 | W4-3 | Approvals & Limits | Item deletion auditing — AuditLog entry with `item_removed_before_send` action on pre-send item removal |
| 4 | W4-4 | Approvals & Limits | Login/logout auditing — already implemented (login, login_failed, logout all logged to AuditLog) |
| 5 | W4-5 | Dashboard & Alerts | Dashboard v2 — per-employee performance metrics (sales, orders, voids, discounts, avg check) with risk highlighting (red for high void rate, amber for frequent discounts) |
| 6 | W4-6 | Dashboard & Alerts | Real-time alert system MVP — `checkAndDispatchAlerts()` utility, configurable thresholds in settings, dashboard alert panel with color-coded alerts, AuditLog persistence |
| 7 | W4-7 | Dashboard & Alerts | Audit log browser — full-featured page at `/admin/audit` with date range, employee, action type filters, pagination, expandable details, CSV export (538 lines) |
| 8 | W4-8 | Reporting | CSV export added to daily, labor, payroll, product-mix reports + flash report page at `/admin/reports/flash` with yesterday's key metrics and day-over-day comparison |
| 9 | W4-9 | Reporting | Speed-of-service API + report page — avg order-to-send, send-to-complete, seat-to-pay times with by-employee and by-day breakdowns, CSV export |
| 10 | W4-10 | Reporting | Food cost/variance UI at `/admin/reports/variance` — color-coded variance table (red >10%, amber 5-10%, green <5%), summary cards, CSV export |

## Files Modified

| File | IDs | Changes |
|------|-----|---------|
| `src/lib/settings.ts` | W4-1, W4-2, W4-6 | Added `ApprovalSettings` and `AlertSettings` interfaces with defaults and merge logic |
| `src/lib/alert-dispatch.ts` | W4-6 | New file (158 lines): `checkAndDispatchAlerts()` utility for threshold checking and socket dispatch |
| `src/app/api/orders/[id]/discount/route.ts` | W4-1, W4-2 | Configurable approval thresholds, per-role discount limits, manager override logging |
| `src/app/api/orders/[id]/comp-void/route.ts` | W4-1 | Configurable void approval enforcement, AuditLog entries for void/comp + manager overrides |
| `src/app/api/orders/[id]/items/[itemId]/route.ts` | W4-3 | Item deletion audit logging before send |
| `src/app/(admin)/dashboard/page.tsx` | W4-5, W4-6 | Employee performance section with risk highlighting, alert panel with real-time socket updates |
| `src/app/(admin)/audit/page.tsx` | W4-7 | New file (538 lines): audit log browser with filters, pagination, expandable details, CSV export |
| `src/app/(admin)/reports/daily/page.tsx` | W4-8 | CSV export function and Export CSV button |
| `src/app/(admin)/reports/labor/page.tsx` | W4-8 | CSV export function and Export CSV button |
| `src/app/(admin)/reports/payroll/page.tsx` | W4-8 | CSV export function and Export CSV button |
| `src/app/(admin)/reports/product-mix/page.tsx` | W4-8 | CSV export function and Export CSV button |
| `src/app/(admin)/reports/page.tsx` | W4-8, W4-9, W4-10 | Links to new flash, speed-of-service, and variance report pages |
| `src/app/(admin)/reports/flash/page.tsx` | W4-8 | New file (243 lines): flash report page with yesterday's metrics and day-over-day delta |
| `src/app/api/reports/speed-of-service/route.ts` | W4-9 | New file (208 lines): speed-of-service API with overall, by-day, by-employee, by-order-type breakdowns |
| `src/app/(admin)/reports/speed-of-service/page.tsx` | W4-9 | New file (308 lines): speed-of-service report page with summary cards, tables, CSV export |
| `src/app/(admin)/reports/variance/page.tsx` | W4-10 | New file (322 lines): food cost variance report page with color-coded table, summary cards, CSV export |

## Testing

1. **W4-1 — Discount approval** — Enable `requireDiscountApproval` in location settings. Apply a discount without `approvedById`. Verify 403 with `requiresApproval: true`.
2. **W4-2 — Role limits** — Set `defaultMaxDiscountPercent: 10`. As a server (no manager.discounts), apply 15% discount. Verify 403 with `maxPercent: 10`.
3. **W4-3 — Item deletion audit** — Remove an unsent item from an order. Check AuditLog for `item_removed_before_send` entry.
4. **W4-5 — Employee performance** — Navigate to `/admin/dashboard`. Verify per-employee sales, void rate, discount count. Check red highlighting on high void rate.
5. **W4-6 — Alerts** — Void an item above `largeVoidThreshold`. Verify alert appears on dashboard and persists in AuditLog as `alert_void`.
6. **W4-7 — Audit browser** — Navigate to `/admin/audit`. Filter by date range, employee, action type. Verify pagination. Export CSV.
7. **W4-8 — CSV exports** — On daily, labor, payroll, product-mix pages, click Export CSV. Verify file downloads with correct data.
8. **W4-8 — Flash report** — Navigate to `/admin/reports/flash`. Verify yesterday's metrics, day-over-day delta, export.
9. **W4-9 — Speed of service** — Navigate to `/admin/reports/speed-of-service`. Verify avg times, employee breakdown, day breakdown, CSV export.
10. **W4-10 — Variance** — Navigate to `/admin/reports/variance`. Verify color-coded variance table, summary cards, CSV export.
