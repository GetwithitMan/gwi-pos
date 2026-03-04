# Feature: Live Dashboard

> **Status: ACTIVE** — Fully built as of 2026-03-04.

## Summary
Real-time operational visibility screen — shows live sales vs. last week pacing, open tickets, voids/comps, discounts, paid in/out summary, and inventory deduction queue alerts. Socket-driven with 60-second polling fallback.

## Code Locations
| Purpose | Path |
|---------|------|
| Live metrics API | `src/app/api/dashboard/live/route.ts` |
| Dashboard page | `src/app/(admin)/dashboard/page.tsx` |

## Key Capabilities
- **Sales pacing** — net sales today vs. same-day-last-week with ▲/▼ % and day-progress bar
- **Open tickets** — count of currently open orders
- **Voids & comps** — total void amount + comp amount for the day
- **Discounts** — total discounted amount for the day
- **Paid In / Out chips** — green/red inline chips with totals; links to `/cash-drawer/paid-in-out`
- **Deduction queue alert** — red dismissible banner when failed inventory deductions exist; links to `/inventory/deductions-queue`
- **Socket-first** — subscribes to `dashboard:metrics` socket event; falls back to 60s polling

## API Response (`GET /api/dashboard/live`)
| Field | Description |
|-------|-------------|
| `netSalesToday` | Sum of `Order.totalAmount` (paid, today) |
| `netSalesLastWeek` | Same window, 7 days prior |
| `salesPacingPct` | `netSalesToday / netSalesLastWeek * 100` (null if no prior data) |
| `checksToday` | Count of paid orders today |
| `avgCheckSize` | `netSalesToday / checksToday` |
| `openTicketCount` | Count of open (unpaid) orders |
| `voidsTotalToday` | Sum of voided item amounts today |
| `compsTotalToday` | Sum of comped item amounts today |
| `discountsTotalToday` | Sum of order-level discounts today |
| `paidInTotal` | Sum of paid-in amounts today |
| `paidOutTotal` | Sum of paid-out amounts today |
| `paidNetTotal` | `paidInTotal - paidOutTotal` |
| `pendingDeductionsFailed` | Count of failed/dead deduction jobs |
| `dayFraction` | Fraction of business day elapsed (0–1) |
| `businessDate` | Today's business date (ISO) |

## Known Constraints
- No labor % (requires time-clock integration — available but not wired)
- No kitchen performance metrics (ticket time, late tickets)
- No widget customization
- No dedicated always-on display mode

## Dependencies
- **Reports** — reads same data sources (Orders, Payments)
- **Orders** — open ticket count
- **Payments** — net sales, voids, comps
- **Paid In / Out** — cash movement summary
- **Inventory Deduction Queue** — failed deduction alert
- **Socket** — `dashboard:metrics` event

*Last updated: 2026-03-04*
