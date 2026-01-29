# Reports

Comprehensive reporting system with sales, employee performance, tips, liquor, and operational reports.

## Overview

Access all reports via the Reports Hub at `/reports`. Reports are permission-controlled and categorized into:
- Sales & Revenue
- Team & Labor
- Operations
- Inventory & Liquor

## Reports Hub

The hub shows:
- **Today's Overview**: Quick stats (sales, orders, avg order, tips)
- **Payment Methods**: Cash vs card breakdown
- **Report Categories**: Links to detailed reports
- **My Reports**: Personal sales/commission/tips for current employee

## Available Reports

### Sales & Revenue

| Report | Route | Description | Permission |
|--------|-------|-------------|------------|
| Sales Report | `/reports/sales` | Gross/net sales, payment breakdown by day/hour | `reports.sales` |
| Product Mix | `/reports/product-mix` | Best selling items, category performance | `reports.product_mix` |
| Order History | `/reports/order-history` | Individual order details, transaction history | `reports.tabs` |

### Team & Labor

| Report | Route | Description | Permission |
|--------|-------|-------------|------------|
| Employee Performance | `/reports/employees` | Sales by server, tips, hours worked | `reports.sales_by_employee` |
| Commission Report | `/reports/commission` | Commission earnings by employee | `reports.commission` |
| Tips Report | `/reports/tips` | Tip sharing, tip-outs, banked tips | `reports.commission` |

### Operations

| Report | Route | Description | Permission |
|--------|-------|-------------|------------|
| Voids & Comps | `/reports/voids` | Voided items, comped orders tracking | `reports.voids` |
| Coupons & Discounts | `/reports/coupons` | Coupon usage, discount tracking | - |
| Reservations | `/reports/reservations` | Reservation history, no-shows | - |

### Inventory & Liquor

| Report | Route | Description | Permission |
|--------|-------|-------------|------------|
| Liquor & Spirits | `/reports/liquor` | Pour costs, spirit sales, inventory | `reports.inventory` |

## API Endpoints

All report APIs follow the pattern:
```
GET /api/reports/{report-name}?locationId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

### Common Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `locationId` | Yes | Location to report on |
| `startDate` | No | Start of date range |
| `endDate` | No | End of date range |
| `employeeId` | No | Filter to specific employee |

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/reports/sales` | Sales report data |
| `GET /api/reports/employees` | Employee performance data |
| `GET /api/reports/commission` | Commission report data |
| `GET /api/reports/tips` | Tips report data |
| `GET /api/reports/liquor` | Liquor/spirits report data |

## Sales Report

Detailed sales analysis with:
- Gross sales, discounts, net sales
- Payment method breakdown (cash/card)
- Sales by hour, day, or custom period
- Tax collected

### Response Structure
```json
{
  "summary": {
    "grossSales": 5420.00,
    "discounts": 120.00,
    "netSales": 5300.00,
    "orderCount": 87,
    "averageOrderValue": 60.92,
    "cashSales": 1800.00,
    "cardSales": 3500.00,
    "tips": 680.00,
    "taxCollected": 450.00
  },
  "byHour": [...],
  "byDay": [...],
  "byPaymentMethod": [...]
}
```

## Employee Performance Report

Per-employee metrics:
- Total sales
- Order count
- Average order value
- Tips earned
- Hours worked

### Response Structure
```json
{
  "employees": [{
    "id": "xxx",
    "name": "John D.",
    "role": "Server",
    "sales": 1250.00,
    "orderCount": 24,
    "averageOrder": 52.08,
    "tips": 180.00,
    "hours": 6.5
  }],
  "totals": {
    "sales": 5420.00,
    "orderCount": 87,
    "tips": 680.00,
    "hours": 45.5
  }
}
```

## Tips Report

Comprehensive tip tracking (see `/tip-sharing` skill for full details):
- Gross tips by employee
- Tip-outs given and received
- Net tips kept
- Banked tips pending collection
- Tip share transaction history

### Response Structure
```json
{
  "byEmployee": [{
    "employeeId": "xxx",
    "employeeName": "John D.",
    "grossTips": 156.00,
    "tipOutsGiven": 9.36,
    "tipOutsReceived": 0,
    "netTips": 146.64
  }],
  "tipShares": [...],
  "bankedTips": [...],
  "summary": {
    "totalGrossTips": 680.00,
    "totalTipOuts": 40.80,
    "totalBanked": 12.50
  }
}
```

## Commission Report

Commission earnings with:
- Sales qualifying for commission
- Commission rate per employee
- Commission earned
- Combined with tip data

## Liquor Report

Spirit and cocktail analysis (see `/liquor-reports` skill for full details):
- Sales by tier (Well/Call/Premium/Top Shelf)
- Pour cost analysis
- Bottle usage tracking
- Upsell performance
- Gross margin calculations

## Permissions

| Permission | Description |
|------------|-------------|
| `reports.view` | Access reports section |
| `reports.sales` | View sales reports |
| `reports.sales_by_employee` | View employee performance |
| `reports.labor` | View labor/timesheet reports |
| `reports.commission` | View commission & tips reports |
| `reports.product_mix` | View product mix reports |
| `reports.inventory` | View inventory reports |
| `reports.tabs` | View order history |
| `reports.voids` | View void reports |
| `reports.export` | Export report data |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/reports/page.tsx` | Reports hub |
| `src/app/(admin)/reports/sales/page.tsx` | Sales report UI |
| `src/app/(admin)/reports/employees/page.tsx` | Employee report UI |
| `src/app/(admin)/reports/commission/page.tsx` | Commission report UI |
| `src/app/(admin)/reports/tips/page.tsx` | Tips report UI |
| `src/app/(admin)/reports/liquor/page.tsx` | Liquor report UI |
| `src/app/api/reports/*.ts` | Report API endpoints |

## My Reports Section

Every employee can access personal reports:
- **My Sales** - Personal sales performance
- **My Commission** - Personal commission earnings
- **My Tips** - Personal tip history

These are pre-filtered versions of the main reports using the current employee's ID.
