---
skill: 104
title: Daily Store Report
status: DONE
depends_on: [42, 43, 50]
---

# Skill 104: Daily Store Report

> **Status:** DONE
> **Dependencies:** Skills 42, 43, 50
> **Last Updated:** 2026-01-30

## Overview

Comprehensive end-of-day reporting system including daily store reports, employee shift reports, and a standalone tip share report with configurable payout methods.

## Reports

### Daily Store Report

**Endpoint:** `GET /api/reports/daily`

**Parameters:**
- `locationId` (required) - Location ID
- `date` (optional) - YYYY-MM-DD format, defaults to today

**Response Sections:**

| Section | Description |
|---------|-------------|
| `revenue` | Sales totals, discounts, tax, tips, refunds |
| `payments` | By method (cash, credit, gift, house account) with credit card breakdown |
| `cash` | Cash reconciliation with tip shares |
| `paidInOut` | Paid in/out summary |
| `salesByCategory` | Units, gross, net, voids by category |
| `salesByOrderType` | Count, gross, net by order type |
| `voids` | Ticket/item voids, by reason, void percentage |
| `discounts` | By discount type |
| `labor` | FOH/BOH hours, cost, labor percentage |
| `giftCards` | Loads, redemptions, net liability |
| `tipShares` | Distributed tips by giver |
| `tipBank` | Informational totals |
| `stats` | Checks, covers, averages |

**Cash Reconciliation Formula:**
```
cashDue = cashReceived + cashIn - cashOut + tipSharesIn
```

All tip shares go to payroll, so `tipSharesIn` increases cash due (house holds for payroll).

---

### Employee Shift Report

**Endpoint:** `GET /api/reports/employee-shift`

**Parameters:**
- `locationId` (required)
- `employeeId` (required)
- `date` (optional) - YYYY-MM-DD, defaults to today

**Response:**

```json
{
  "employee": { "id", "name", "role" },
  "shift": { "clockIn", "clockOut", "regularHours", "overtimeHours", "breakMinutes" },
  "sales": { "orderCount", "itemCount", "grossSales", "discounts", "netSales" },
  "tips": { "cashTips", "creditTips", "totalTips" },
  "tipShares": {
    "earned": 100.00,           // From orders (subject to tip-out)
    "given": { "total": 15.00, "shares": [...] },
    "received": { "total": 5.00, "pending": 5.00, "collected": 0, "shares": [...] },
    "netTips": 90.00            // earned - given + received
  }
}
```

**Key Distinction:**
- `tips.earned` = Tips from orders this employee served (subject to tip-out rules)
- `tipShares.received` = Tips from other employees (NOT subject to tip-out)

---

### Tip Share Report

**Endpoint:** `GET /api/reports/tip-shares`

**Parameters:**
- `locationId` (required)
- `startDate` (optional) - YYYY-MM-DD, defaults to 14 days ago
- `endDate` (optional) - YYYY-MM-DD, defaults to today
- `employeeId` (optional) - Filter by giver or receiver
- `status` (optional) - pending, accepted, paid_out, all

**Response:**

```json
{
  "reportPeriod": { "start", "end" },
  "settings": { "payoutMethod": "payroll" | "manual" },
  "summary": {
    "totalShares": 25,
    "totalAmount": 450.00,
    "pending": 200.00,
    "accepted": 150.00,
    "paidOut": 100.00,
    "awaitingPayout": 350.00
  },
  "byRecipient": [
    {
      "employeeId": "...",
      "employeeName": "Mike B.",
      "role": "Busser",
      "pending": 50.00,
      "accepted": 30.00,
      "paidOut": 20.00,
      "total": 100.00,
      "shares": [...]
    }
  ],
  "byGiver": [
    {
      "employeeId": "...",
      "employeeName": "Sarah J.",
      "role": "Server",
      "totalGiven": 75.00,
      "shares": [...]
    }
  ],
  "allShares": [...]
}
```

**POST Actions:**

Mark as paid (for manual payout mode):
```json
POST /api/reports/tip-shares
{
  "locationId": "...",
  "action": "mark_paid",
  "tipShareIds": ["id1", "id2"]
}
```

Mark all for employee:
```json
{
  "action": "mark_paid_all",
  "employeeId": "..."
}
```

---

## Tip Share Settings

**Location:** `settings.tipShares`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `payoutMethod` | string | 'payroll' | 'payroll' or 'manual' |
| `autoTipOutEnabled` | boolean | true | Enable automatic role-based tip-outs |
| `requireTipOutAcknowledgment` | boolean | true | Server must acknowledge tip-out |
| `showTipSharesOnReceipt` | boolean | true | Show on shift receipt |

**Payout Methods:**

| Method | Description |
|--------|-------------|
| `payroll` | All tip shares go to payroll automatically. No cash handoffs. |
| `manual` | Use tip share report to track and pay out manually. Mark as paid when distributed. |

---

## Simplified Tip Share Cash Flow

### Problem Solved
Previously, timing of clock-outs affected whether tips were banked or paid directly:
- If Server clocks out first → Busser gets tip marked 'pending'
- If Busser clocks out first → Tip gets banked

### Solution
ALL tip shares go to payroll, regardless of timing.

**Flow:**
1. Server closes shift → tips out to busser, bartender, etc.
2. Server gives ALL tip-out cash to house
3. House holds the cash
4. ALL recipients receive via payroll

**Benefits:**
- No timing dependency
- No same-day cash handoffs between employees
- Simple cash tracking (all tip shares increase cash due)
- Clear audit trail

---

## Database Models

### TipShare Status Values

| Status | Description |
|--------|-------------|
| `pending` | Tip share created, awaiting acknowledgment |
| `banked` | Recipient was absent, held for payroll |
| `accepted` | Employee acknowledged the tip share |
| `paid_out` | Manually paid out (for manual mode) |

### Key Fields

**TipShare:**
- `fromEmployeeId` - Employee who gave the tip
- `toEmployeeId` - Employee who receives the tip
- `amount` - Tip share amount
- `shareType` - 'automatic' (from rules) or 'manual'
- `ruleId` - Reference to TipOutRule if automatic
- `status` - Current status
- `collectedAt` - When accepted/paid out

---

## UI Integration

### TimeClockModal

Shows informational notification for pending tip shares:
- "You have tip shares for payroll!"
- Lists tips with from employee and amount
- Shows total
- "Will be added to your next payroll"
- Dismiss button only

### Daily Report Page (Future)

Recommended sections:
1. Revenue summary cards
2. Payment breakdown chart
3. Cash reconciliation table
4. Sales by category/order type charts
5. Tip shares section
6. Labor and stats

---

## Related Files

| File | Purpose |
|------|---------|
| `src/app/api/reports/daily/route.ts` | Daily report API |
| `src/app/api/reports/employee-shift/route.ts` | Employee shift report API |
| `src/app/api/reports/tip-shares/route.ts` | Tip share report API |
| `src/lib/settings.ts` | TipShareSettings interface |
| `src/app/api/settings/route.ts` | Settings API |
| `src/components/time-clock/TimeClockModal.tsx` | Tip notification UI |

---

## Related Skills

| Skill | Relation |
|-------|----------|
| 42 | Sales Reports - Foundation for daily report |
| 43 | Labor Reports - Labor section |
| 47 | Clock In/Out - Shift data |
| 50 | Shift Close - End of day flow |
| - | Tip Sharing System - Tip share data |
