# Feature: Reports

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Reports provides comprehensive business analytics for bar/restaurant operations. All reports read from `OrderSnapshot` (event-sourced) — never from the legacy `Order` table. Reports cover daily store summaries, sales by multiple dimensions, labor/payroll, product mix (PMIX) with food cost, tip shares, void/discount auditing, server performance, speed of service, hourly/daypart trends, liquor analysis, inventory variance, and forecasting. All reports use business day boundaries (not calendar midnight) and filter training orders by default.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API endpoints, admin report pages, print formatting | Full |
| `gwi-android-register` | None (reports are admin-only, accessed via web) | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | Aggregate reporting materialized from events | Partial |
| `gwi-mission-control` | Multi-location report rollups | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/reports` | Managers |
| Admin | `/reports/daily` | Managers |
| Admin | `/reports/sales` | Managers |
| Admin | `/reports/product-mix` | Managers |
| Admin | `/reports/labor` | Managers |
| Admin | `/reports/payroll` | Managers |
| Admin | `/reports/tips` | Managers |
| Admin | `/reports/shift` | Managers |
| Admin | `/reports/voids` | Managers |
| Admin | `/reports/employees` | Managers |
| Admin | `/reports/hourly` | Managers |
| Admin | `/reports/daypart` | Managers |
| Admin | `/reports/liquor` | Managers |
| Admin | `/reports/order-history` | Managers |
| Admin | `/reports/server-performance` | Managers |
| Admin | `/reports/speed-of-service` | Managers |
| Admin | `/reports/commission` | Managers |
| Admin | `/reports/coupons` | Managers |
| Admin | `/reports/variance` | Managers |
| Admin | `/reports/datacap` | Managers |
| Admin | `/reports/tip-adjustments` | Managers |
| Admin | `/reports/house-accounts` | Managers |
| Admin | `/reports/cash-liabilities` | Managers |
| Admin | `/reports/reservations` | Managers |
| Admin | `/reports/forecasting` | Managers |
| Admin | `/reports/trends` | Managers (includes MTD comparison option) |
| Admin | `/reports/payment-methods` | Managers |
| Admin | `/reports/flash` | Managers |
| Settings | `/settings/reports/*` (per-report config) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(admin)/reports/page.tsx` | Report dashboard / index |
| `src/app/(admin)/reports/daily/page.tsx` | Daily store report |
| `src/app/(admin)/reports/sales/page.tsx` | Sales report |
| `src/app/(admin)/reports/product-mix/page.tsx` | Product mix (PMIX) |
| `src/app/(admin)/reports/labor/page.tsx` | Labor report |
| `src/app/(admin)/reports/payroll/page.tsx` | Payroll export |
| `src/app/(admin)/reports/tips/page.tsx` | Tip report |
| `src/app/(admin)/reports/shift/page.tsx` | Shift report |
| `src/app/(admin)/reports/voids/page.tsx` | Void/discount report |
| `src/app/(admin)/reports/employees/page.tsx` | Employee report |
| `src/app/(admin)/reports/hourly/page.tsx` | Hourly sales |
| `src/app/(admin)/reports/daypart/page.tsx` | Daypart analysis |
| `src/app/(admin)/reports/liquor/page.tsx` | Liquor report |
| `src/app/(admin)/reports/order-history/page.tsx` | Order history |
| `src/app/(admin)/reports/server-performance/page.tsx` | Server performance |
| `src/app/(admin)/reports/speed-of-service/page.tsx` | Speed of service |
| `src/app/(admin)/reports/commission/page.tsx` | Commission report |
| `src/app/(admin)/reports/coupons/page.tsx` | Coupon usage |
| `src/app/(admin)/reports/variance/page.tsx` | Inventory variance |
| `src/app/(admin)/reports/datacap/page.tsx` | Datacap transactions |
| `src/app/(admin)/reports/tip-adjustments/page.tsx` | Tip adjustments |
| `src/app/(admin)/reports/house-accounts/page.tsx` | House account report |
| `src/app/(admin)/reports/cash-liabilities/page.tsx` | Cash liabilities |
| `src/app/(admin)/reports/reservations/page.tsx` | Reservation report |
| `src/app/(admin)/reports/forecasting/page.tsx` | Sales forecasting |
| `src/app/(admin)/reports/trends/page.tsx` | Trend analysis |
| `src/app/(admin)/reports/flash/page.tsx` | Flash report (real-time) |
| `src/app/api/reports/daily/route.ts` | Daily report API |
| `src/app/api/reports/sales/route.ts` | Sales API |
| `src/app/api/reports/product-mix/route.ts` | PMIX API |
| `src/app/api/reports/labor/route.ts` | Labor API |
| `src/app/api/reports/payroll/route.ts` | Payroll API |
| `src/app/api/reports/payroll-export/route.ts` | Payroll export (CSV) |
| `src/app/api/reports/tips/route.ts` | Tips API |
| `src/app/api/reports/tip-shares/route.ts` | Tip share API |
| `src/app/api/reports/tip-groups/route.ts` | Tip group API |
| `src/app/api/reports/tip-adjustment/route.ts` | Tip adjustment API |
| `src/app/api/reports/employee-shift/route.ts` | Employee shift API |
| `src/app/api/reports/voids/route.ts` | Void API |
| `src/app/api/reports/discounts/route.ts` | Discount API |
| `src/app/api/reports/employees/route.ts` | Employee report API |
| `src/app/api/reports/hourly/route.ts` | Hourly API |
| `src/app/api/reports/daypart/route.ts` | Daypart API |
| `src/app/api/reports/liquor/route.ts` | Liquor API |
| `src/app/api/reports/order-history/route.ts` | Order history API |
| `src/app/api/reports/server-performance/route.ts` | Server perf API |
| `src/app/api/reports/speed-of-service/route.ts` | Speed of service API |
| `src/app/api/reports/commission/route.ts` | Commission API |
| `src/app/api/reports/coupons/route.ts` | Coupon API |
| `src/app/api/reports/variance/route.ts` | Variance API |
| `src/app/api/reports/theoretical-usage/route.ts` | Theoretical usage API |
| `src/app/api/reports/datacap-transactions/route.ts` | Datacap API |
| `src/app/api/reports/tables/route.ts` | Table report API |
| `src/app/api/reports/customers/route.ts` | Customer report API |
| `src/app/api/reports/house-accounts/route.ts` | House account API |
| `src/app/api/reports/cash-liabilities/route.ts` | Cash liabilities API |
| `src/app/api/reports/transfers/route.ts` | Transfer report API |
| `src/app/api/reports/reservations/route.ts` | Reservation report API |
| `src/app/api/reports/forecasting/route.ts` | Forecasting API |
| `src/app/api/reports/email/route.ts` | Email report delivery |
| `src/app/api/print/daily-report/route.ts` | Print daily report |
| `src/app/api/print/shift-closeout/route.ts` | Print shift closeout |
| `src/lib/escpos/daily-report-receipt.ts` | Daily report receipt builder |
| `src/lib/escpos/shift-closeout-receipt.ts` | Shift closeout receipt builder |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/reports/daily` | Manager | Comprehensive EOD report |
| `GET` | `/api/reports/sales` | Manager | Sales by category/item/employee/table |
| `GET` | `/api/reports/product-mix` | Manager | PMIX with food cost % |
| `GET` | `/api/reports/labor` | Manager | Labor hours + cost |
| `GET` | `/api/reports/payroll` | Manager | Payroll data |
| `GET` | `/api/reports/payroll-export` | Manager | Payroll CSV export |
| `GET` | `/api/reports/tips` | Manager | Tip report |
| `GET/POST` | `/api/reports/tip-shares` | Manager | Tip shares + mark-as-paid |
| `GET` | `/api/reports/tip-groups` | Manager | Tip group report |
| `GET` | `/api/reports/tip-adjustment` | Manager | Tip adjustments |
| `GET` | `/api/reports/employee-shift` | Manager | Individual shift details |
| `GET` | `/api/reports/voids` | Manager | Void report |
| `GET` | `/api/reports/discounts` | Manager | Discount report |
| `GET` | `/api/reports/employees` | Manager | Employee performance |
| `GET` | `/api/reports/hourly` | Manager | Hourly sales breakdown |
| `GET` | `/api/reports/daypart` | Manager | Daypart analysis |
| `GET` | `/api/reports/liquor` | Manager | Liquor: pour cost %, bottle variance |
| `GET` | `/api/reports/order-history` | Manager | Full order history |
| `GET` | `/api/reports/server-performance` | Manager | Server metrics |
| `GET` | `/api/reports/speed-of-service` | Manager | Ticket time analysis |
| `GET` | `/api/reports/commission` | Manager | Commission tracking |
| `GET` | `/api/reports/coupons` | Manager | Coupon usage |
| `GET` | `/api/reports/variance` | Manager | Inventory variance |
| `GET` | `/api/reports/theoretical-usage` | Manager | Theoretical vs actual |
| `GET` | `/api/reports/datacap-transactions` | Manager | Raw Datacap transactions |
| `GET` | `/api/reports/tables` | Manager | Table performance |
| `GET` | `/api/reports/customers` | Manager | Customer report |
| `GET` | `/api/reports/house-accounts` | Manager | House account balances |
| `GET` | `/api/reports/cash-liabilities` | Manager | Outstanding cash |
| `GET` | `/api/reports/transfers` | Manager | Transfer report |
| `GET` | `/api/reports/reservations` | Manager | Reservation report |
| `GET` | `/api/reports/forecasting` | Manager | Sales forecasting |
| `POST` | `/api/reports/email` | Manager | Email report delivery |

---

## Socket Events

Reports are **read-only queries** — no socket events are emitted or consumed.

---

## Data Model

Reports read primarily from these models:

```
OrderSnapshot {
  id, locationId, employeeId, orderType, tableId, tableName
  tabName, tabStatus, guestCount, orderNumber, displayNumber
  status, hasPreAuth, isClosed, isTraining, isVoided
  subtotalCents, taxTotalCents, discountTotalCents
  tipTotalCents, totalCents, paidAmountCents
  openedAt, closedAt, createdAt
  items → OrderItemSnapshot[]
}

OrderItemSnapshot {
  id, snapshotId, locationId
  menuItemId, menuItemName, categoryName
  quantity, priceCents, status, kitchenStatus
  discountAmountCents, taxAmountCents
  modifiers (Json)
}

TipLedgerEntry {
  id, locationId, employeeId
  amountCents, type, orderId
  createdAt
}

Shift, ShiftBreak, PayrollPeriod (labor reports)
Ingredient, StockCount (inventory reports)
```

---

## Business Logic

### Report Generation Flow
1. Manager opens report page → selects date range and filters
2. API endpoint queries `OrderSnapshot` (+ joins as needed) filtered by `locationId` and business day boundaries
3. Training orders excluded by default (`isTraining: false`)
4. Results aggregated server-side, returned as JSON
5. UI renders tables, charts, and summary cards
6. Optional: print via ESC/POS or email delivery

### Business Day Boundaries
- Business day does NOT align with calendar midnight
- Configurable in location settings (e.g., business day ends at 4:00 AM)
- Orders at 1:00 AM belong to the previous business day
- All date filtering uses `openedAt` against business day boundaries

### Key Report Types
- **Daily Store Report**: Full EOD summary — sales, payments, tips, voids, discounts, labor
- **Sales**: Breakdown by category, item, employee, table, time period
- **PMIX**: Product mix with food cost percentages and theoretical vs actual
- **Labor**: Hours worked, overtime, labor cost as % of revenue
- **Tip Share**: Tip pool distribution with mark-as-paid workflow
- **Void/Discount**: Audit trail with manager approvals
- **Liquor**: Pour cost %, bottle variance, spirit tier analysis

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| None | Reports are read-only — they don't modify other features |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Sales data comes from `OrderSnapshot` |
| Payments | Payment facts feed into daily report, Datacap report |
| Tips | Tip share reports, tip group reports |
| Employees | Labor data, shift data, employee performance |
| Inventory | Food cost, variance analysis |
| Settings | Business day boundaries, report configuration |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **OrderSnapshot** — any schema changes affect all reports
- [ ] **Business day** — boundary calculation must be consistent across all reports
- [ ] **Training orders** — always filtered by default
- [ ] **Permissions** — which reports require which permission level

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View reports | `REPORTS_VIEW` | High |
| Export reports | `REPORTS_EXPORT` | High |
| Email reports | `REPORTS_EMAIL` | High |
| Mark tips as paid | `TIP_SHARE_MANAGE` | Critical |

---

## Known Constraints & Limits
- ALL reports read from `OrderSnapshot`, NEVER from legacy `Order` table
- All date ranges use business day boundaries, not calendar midnight
- Training orders filtered by default (configurable)
- Reports are read-only — no mutations, no socket events
- Payroll export generates CSV for third-party payroll systems
- Large date ranges may be slow — consider pagination for order history

---

## Android-Specific Notes
- Reports are admin-only and accessed via the web interface
- No native Android report screens
- Android staff can view their own shift summary via the shift close flow

---

## Related Docs
- **Domain doc:** `docs/domains/REPORTS-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 42 (Sales Reports), Skill 43 (Labor Reports), Skill 44 (Product Mix), Skill 45 (Void Reports), Skill 70 (Discount Reports), Skill 104 (Daily Store Report), Skill 105 (Tip Share Report), Skill 135 (Theoretical vs Actual)
- **Changelog:** `docs/changelogs/REPORTS-CHANGELOG.md`

---

*Last updated: 2026-03-03*
