# Shift Management

Clock in/out, cash drawer management, and shift closeout with tip distribution.

## Overview

Shifts track employee work time, manage cash drawers, and handle end-of-shift closeout including cash counts and tip distribution.

## Starting a Shift

### Clock In
1. Enter PIN at login
2. System checks for existing shift
3. If no shift, prompts to start one
4. Click "Start Shift"

### Shift Start Modal
- Confirm starting drawer amount
- Count cash if opening drawer
- Optional: Assign section

### With Cash Drawer
1. Count starting cash
2. Enter amount
3. System records opening balance
4. Drawer ready for transactions

## During Shift

### View Shift Status
- Click clock icon in POS header
- Shows: Time clocked in, hours worked
- Break time taken
- Orders completed
- Tips earned

### Take Break
See `employees.md` for break management.

### Cash Handling
- Paid In: Add cash to drawer
- Paid Out: Remove cash from drawer
- All transactions logged

## Ending Shift

### Clock Out
1. Click clock icon
2. Select "End Shift"
3. If cash drawer, go to closeout
4. If no drawer, confirm clock out

## Shift Closeout

### Step 1: Cash Count
1. Count all cash in drawer
2. Enter denominations:
   - Bills: $100, $50, $20, $10, $5, $1
   - Coins: Quarters, Dimes, Nickels, Pennies
3. System calculates total
4. Compare to expected

### Step 2: Variance
- Shows expected vs actual
- Calculate over/short
- Enter explanation if variance

### Step 3: Tip Distribution
1. View gross tips collected
2. See auto-calculated tip-outs
3. Add custom tip shares
4. View net tips to keep

### Step 4: Complete
- Confirm all amounts
- Print closeout report
- Shift marked as closed
- Cash deposited

## Cash Drawer

### Drawer Operations

| Operation | Description |
|-----------|-------------|
| Opening | Starting cash at shift start |
| Cash Sales | Cash received from customers |
| Cash Payments | Change given |
| Paid In | Cash added (bank run, etc.) |
| Paid Out | Cash removed (vendor, tips) |
| Closing | Final cash count |

### Expected Cash Formula
```
Expected = Opening + Cash Sales - Cash Given - Paid Outs + Paid Ins
```

### Variance Handling
- Small variance: Note and continue
- Large variance: Manager approval
- Consistent issues: Review employee

## Shift Reports

### Shift Summary
- Total hours worked
- Orders completed
- Sales total
- Tips earned
- Tip-outs given
- Net tips

### Cash Report
- Opening balance
- All transactions
- Expected vs actual
- Variance explanation

## API Endpoints

### Get Current Shift
```
GET /api/shifts/current?employeeId=xxx
```

### Start Shift
```
POST /api/shifts
{
  "employeeId": "xxx",
  "locationId": "yyy",
  "openingCash": 200.00
}
```

### End Shift
```
PATCH /api/shifts/[id]/close
{
  "closingCash": 485.50,
  "cashVariance": -2.00,
  "varianceNote": "Miscounted change"
}
```

### Record Paid In/Out
```
POST /api/shifts/[id]/paid-in-out
{
  "type": "paid_out",
  "amount": 50.00,
  "reason": "Vendor payment",
  "employeeId": "xxx"
}
```

## Database Models

### Shift
```prisma
model Shift {
  id           String    @id
  employeeId   String
  locationId   String
  clockIn      DateTime
  clockOut     DateTime?
  openingCash  Decimal?
  closingCash  Decimal?
  expectedCash Decimal?
  cashVariance Decimal?
  varianceNote String?
  status       String    // active, closed
  totalSales   Decimal?
  totalTips    Decimal?
  netTips      Decimal?
}
```

### Drawer
```prisma
model Drawer {
  id          String   @id
  locationId  String
  shiftId     String?
  status      String   // open, closed
  openedAt    DateTime
  closedAt    DateTime?
  openingCash Decimal
  closingCash Decimal?
}
```

### PaidInOut
```prisma
model PaidInOut {
  id         String   @id
  shiftId    String
  locationId String
  type       String   // paid_in, paid_out
  amount     Decimal
  reason     String
  employeeId String
  createdAt  DateTime
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/components/shifts/ShiftStartModal.tsx` | Start shift UI |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Closeout wizard |
| `src/app/api/shifts/route.ts` | Shifts API |
| `src/app/api/shifts/[id]/close/route.ts` | Closeout API |
| `src/components/shifts/CashCountInput.tsx` | Denomination entry |
