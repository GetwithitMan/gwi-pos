# Reports Domain

**Domain ID:** 8
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Reports domain provides comprehensive business analytics including sales, labor, inventory, and financial reports. It handles:
- Daily store report (EOD comprehensive)
- Sales reports by category, item, employee, table, time period
- Labor reports with hours, overtime, and cost analysis
- Product mix (PMIX) with food cost percentages
- Tip share reports with mark-as-paid workflow
- Void and discount reports
- Inventory variance (theoretical vs actual)

## Domain Trigger

```
PM Mode: Reports
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Daily | Daily store report | `src/app/api/reports/daily/` |
| Shift | Employee shift reports | `src/app/api/reports/employee-shift/` |
| Tips | Tip share reports | `src/app/api/reports/tip-shares/` |
| Sales | Sales analytics | `src/app/api/reports/sales/` |
| PMIX | Product mix + food cost | `src/app/api/reports/pmix/` |
| UI | Report pages | `src/app/(admin)/reports/` |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/reports/daily` | GET | Comprehensive EOD report |
| `/api/reports/employee-shift` | GET | Individual shift details |
| `/api/reports/tip-shares` | GET/POST | Tip shares with mark-as-paid |
| `/api/reports/sales` | GET | Sales by various dimensions |
| `/api/reports/pmix` | GET | Product mix with food cost |
| `/api/reports/inventory` | GET | Inventory variance |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 42 | Sales Reports | DONE |
| 43 | Labor Reports | DONE |
| 44 | Product Mix | DONE |
| 45 | Void Reports | DONE |
| 70 | Discount Reports | DONE |
| 104 | Daily Store Report | DONE |
| 105 | Tip Share Report | DONE |
| 135 | Theoretical vs Actual | DONE |

## Integration Points

- **Orders Domain**: Order data for sales analysis
- **Employees Domain**: Labor hours, shift data
- **Payments Domain**: Payment and tip data
- **Inventory Domain**: Stock data for variance analysis
