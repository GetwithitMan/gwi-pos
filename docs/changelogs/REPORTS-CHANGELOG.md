# Reports Domain Changelog

## 2026-02-24 — Daily Report & Employee Shift Fixes (`743e618`)
- **Daily report**: `cashPayoutsToday` sourced from `PAYOUT_CASH` ledger entries; subtracted from `cashDue` for accurate drawer reconciliation
- **Employee shift report**: `breakMinutes` query added; `shiftHours` calculated as gross hours minus `breaks / 60`

---

## Bugfix Sprint A+B: Report Fixes (2026-02-23)
- **B16**: Daily report surcharge derivation now pulls from pricing program instead of flat value (`daily/route.ts`)
- **B17**: Labor report date filter refactored — correct timezone-aware date boundary handling (`labor/route.ts`)
- **B18**: Product mix pairing grouped by orderId instead of timestamp — eliminates false pairings across concurrent orders (`product-mix/route.ts`)

---

## Wave 5: Owner Analytics (2026-02-23)
- **W5-4**: CSV export added to sales, shift, tips, voids, employees, hourly, liquor reports
- **W5-5**: Email report MVP — daily report email via Resend API
- **W5-6**: Cash-flow & liability rollup report — aggregated cash, house accounts, gift cards, tips
- **W5-7**: Daypart report with configurable time boundaries + trends page with period comparison

---

## Wave 4: Manager Reporting (2026-02-23)
- **W4-8**: CSV export added to daily, labor, payroll, product-mix report pages
- **W4-8**: Flash report page — yesterday's key metrics with day-over-day comparison at `/admin/reports/flash`
- **W4-9**: Speed-of-service API + report page — avg order-to-send, send-to-complete, seat-to-pay times
- **W4-10**: Food cost/variance UI — color-coded variance table at `/admin/reports/variance`

---

_Changelog created 2026-02-23._
