# Suite 08: Reports

**Domain:** Daily Reports, Sales, Product Mix, Tips, Voids, Labor, Inventory, Financial, Cross-Checks
**Total Tests:** 40
**P0 Tests:** 13 | **P1 Tests:** 16 | **P2 Tests:** 11
**Last Updated:** 2026-02-28

---

## Section A: DAILY REPORT (6 tests)

### RPT-01: Daily report total sales = sum of completed payments
**Priority:** P0
**Prereqs:**
- Multiple paid orders from today with various payment methods
- At least 5 completed orders with known totals

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Query all payments directly:
   ```
   GET /api/reports/datacap-transactions?date={today}
   ```
3. Cross-reference totals.

**Verify:**
- [ ] Report `totalSales` = sum of all `Payment.amount` where `status: "completed"` for today
- [ ] Voided payments NOT included in total
- [ ] Pending payments NOT included in total
- [ ] Refunded amounts subtracted from total (net sales)
- [ ] Report date range covers full business day (not calendar day, respects business day cutoff)
- [ ] Total matches to the penny (no rounding discrepancy)

**Timing:** Report generation < 2s

---

### RPT-02: Daily report cash total = sum of cash payments
**Priority:** P0
**Prereqs:**
- At least 3 cash payments today

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum cash payments independently from DB.

**Verify:**
- [ ] Report `cashTotal` = sum of `Payment.amount` where `paymentMethod: "cash"` and `status: "completed"`
- [ ] Cash tips included separately (not in `cashTotal` but in `cashTipTotal`)
- [ ] Cash rounding adjustments accounted for (`Payment.roundingAdjustment` summed)
- [ ] Net cash = cashTotal + cashTipTotal + roundingAdjustments

---

### RPT-03: Daily report card total = sum of card payments
**Priority:** P0
**Prereqs:**
- At least 3 card payments today

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum card payments independently.

**Verify:**
- [ ] Report `cardTotal` = sum of `Payment.amount` where `paymentMethod: "card"` and `status: "completed"`
- [ ] Card tips included separately (`cardTipTotal`)
- [ ] Total card captures = cardTotal + cardTipTotal
- [ ] Matches Datacap batch total (within tolerance for pending captures)

---

### RPT-04: Daily report tip total = sum of Payment.tipAmount
**Priority:** P0
**Prereqs:**
- Multiple payments with tips

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum all `Payment.tipAmount` independently.

**Verify:**
- [ ] Report `tipTotal` = sum of all `Payment.tipAmount` for completed payments today
- [ ] Cash tips and card tips broken out separately
- [ ] Tip adjustments reflected (adjusted amounts, not originals)
- [ ] Zero-tip payments do not contribute to total

---

### RPT-05: Daily report void count = count of VoidLog entries
**Priority:** P0
**Prereqs:**
- Multiple voids performed today (from Suite 05)

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Count `VoidLog` entries independently.

**Verify:**
- [ ] Report `voidCount` = count of `VoidLog` entries with `action: "void"` today
- [ ] Report `voidTotal` = sum of voided item prices
- [ ] Comp count shown separately (`compCount`)
- [ ] Comp total shown separately (`compTotal`)
- [ ] Voids + comps = total loss

---

### RPT-06: Daily report discount total = sum of OrderDiscount amounts
**Priority:** P1
**Prereqs:**
- Orders with discounts applied today (from Suite 05)

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum `OrderDiscount` amounts independently.

**Verify:**
- [ ] Report `discountTotal` = sum of all active discount amounts on paid orders today
- [ ] Order-level and item-level discounts both included
- [ ] Removed/reversed discounts NOT included
- [ ] Coupon-sourced discounts included in total
- [ ] Discount percentage of gross sales calculated correctly

---

## Section B: SALES REPORTS (5 tests)

### RPT-07: Sales by category matches order items
**Priority:** P0
**Prereqs:**
- Paid orders containing items from multiple categories (food, drinks, liquor)

**Steps:**
1. `GET /api/reports/sales?date={today}&groupBy=category`
2. Manually sum OrderItem amounts by category.

**Verify:**
- [ ] Each category total = sum of `OrderItem.price * quantity` for items in that category (paid orders only)
- [ ] Voided items excluded from category totals
- [ ] Comped items shown at $0.00 (or excluded, per implementation)
- [ ] Categories with no sales still appear (with $0.00)
- [ ] Sum of all category totals = gross sales
- [ ] Modifier prices allocated to parent item's category

---

### RPT-08: Hourly breakdown totals per hour match
**Priority:** P1
**Prereqs:**
- Orders paid across multiple hours today

**Steps:**
1. `GET /api/reports/hourly?date={today}`
2. Verify each hour's total.

**Verify:**
- [ ] Each hourly bucket contains orders closed (paid) in that hour
- [ ] Hour boundaries use location timezone (not UTC)
- [ ] Sum of all hourly totals = daily total
- [ ] Empty hours shown as $0.00
- [ ] Order count per hour correct
- [ ] Average ticket size per hour = hour total / hour order count

---

### RPT-09: Daypart report (lunch/dinner split)
**Priority:** P2
**Prereqs:**
- Daypart definitions configured (e.g., lunch: 11am-3pm, dinner: 5pm-10pm)
- Orders in both dayparts

**Steps:**
1. `GET /api/reports/daypart?date={today}`

**Verify:**
- [ ] Lunch total = orders paid between 11am-3pm (local time)
- [ ] Dinner total = orders paid between 5pm-10pm (local time)
- [ ] Gap hours (3pm-5pm) either belong to a daypart or shown separately
- [ ] Each daypart shows: total sales, order count, average ticket, top items
- [ ] Sum of all dayparts = daily total

---

### RPT-10: Sales report excludes voided items
**Priority:** P0
**Prereqs:**
- Paid order with at least one voided item and one active item

**Steps:**
1. `GET /api/reports/sales?date={today}`
2. Verify voided items not in sales totals.

**Verify:**
- [ ] Voided items (`status: "voided"`) NOT included in sales totals
- [ ] Only `status: "active"` items contribute to sales
- [ ] If all items on an order were voided (cancelled order): order excluded entirely
- [ ] Gross sales = sum of active item prices only
- [ ] Category breakdown excludes voided items

---

### RPT-11: Sales report includes comped items at $0
**Priority:** P1
**Prereqs:**
- Paid order with comped item

**Steps:**
1. `GET /api/reports/sales?date={today}`

**Verify:**
- [ ] Comped items appear in item count (quantity sold)
- [ ] Comped items contribute $0.00 to sales total
- [ ] OR comped items excluded from sales but tracked in comp report
- [ ] Comp total shown as separate line on report
- [ ] Net sales = gross sales - comps - discounts

---

## Section C: PRODUCT MIX (4 tests)

### RPT-12: Product mix item quantities match OrderItem counts
**Priority:** P0
**Prereqs:**
- Multiple paid orders with known items

**Steps:**
1. `GET /api/reports/product-mix?date={today}`
2. Count OrderItems by `menuItemId` independently.

**Verify:**
- [ ] Each item's `quantitySold` = sum of `OrderItem.quantity` where `status: "active"` on paid orders
- [ ] Items sorted by quantity sold (descending) or revenue (descending)
- [ ] Each item shows: name, quantity sold, total revenue, percentage of total sales
- [ ] Revenue per item = sum of (price * quantity) for that menuItemId
- [ ] Total quantity across all items matches total items sold today

---

### RPT-13: PMIX includes modifier breakdown
**Priority:** P1
**Prereqs:**
- Items sold with various modifiers

**Steps:**
1. `GET /api/reports/product-mix?date={today}&includeModifiers=true`

**Verify:**
- [ ] Each item shows its modifier breakdown
- [ ] Modifier count = how many times that modifier was selected
- [ ] Modifier revenue = modifier price * count
- [ ] Modifiers grouped under their parent item
- [ ] Pre-modifier instructions (NO, LITE, EXTRA) tracked if applicable
- [ ] Linked item modifiers (spirit upgrades) tracked with original item reference

---

### RPT-14: PMIX excludes voided items
**Priority:** P0
**Prereqs:**
- Items that were sold AND items that were voided today

**Steps:**
1. `GET /api/reports/product-mix?date={today}`

**Verify:**
- [ ] Voided items (`status: "voided"`) NOT in product mix counts
- [ ] Only `status: "active"` items counted
- [ ] If Burger sold 10x and voided 2x: PMIX shows Burger qty = 8
- [ ] Voided items available in separate void report (Suite 05 VCD-29)

---

### RPT-15: PMIX pour size breakdown for liquor items
**Priority:** P2
**Prereqs:**
- Liquor items sold with various pour sizes (shot, double, tall)

**Steps:**
1. `GET /api/reports/product-mix?date={today}&category=liquor`

**Verify:**
- [ ] Liquor items show pour size breakdown
- [ ] Patron Silver: 5 shots, 3 doubles, 1 tall (example)
- [ ] Revenue accounts for pour multiplier (double = 2x price)
- [ ] Pour size data from `OrderItem.pourSize` and `pourMultiplier`
- [ ] Total revenue per liquor item = sum of (base price * pourMultiplier * quantity)

---

## Section D: TIP REPORTS (4 tests)

### RPT-16: Tip report matches TipLedger totals
**Priority:** P0
**Prereqs:**
- Tips earned today (from Suite 07)

**Steps:**
1. `GET /api/reports/tips?startDate={today}&endDate={today}`
2. Sum all TipLedger entries for today.

**Verify:**
- [ ] Report total = sum of all `TipLedger.amount` for today
- [ ] Cash tip subtotal matches cash-type ledger entries
- [ ] Card tip subtotal matches card-type ledger entries
- [ ] Tip share entries included (type: "tip_share")
- [ ] No discrepancy between report and raw ledger data

---

### RPT-17: Tips by employee = sum of their TipLedger entries
**Priority:** P0
**Prereqs:**
- Multiple employees with tips

**Steps:**
1. `GET /api/reports/tips?groupBy=employee&startDate={today}&endDate={today}`
2. For each employee, sum their TipLedger entries.

**Verify:**
- [ ] Per-employee total matches sum of their `TipLedger` records
- [ ] Employee with highest tips is ranked first (if sorted)
- [ ] Each employee shows: direct tips, shared tips received, shared tips given, net tips
- [ ] No double-counting of shared tips
- [ ] Sum of all employee net tips = total tips earned by location

---

### RPT-18: Tip share report matches allocation rules
**Priority:** P1
**Prereqs:**
- Tip shares distributed (from Suite 07 TIP-08/09)

**Steps:**
1. `GET /api/reports/tip-shares?date={today}`

**Verify:**
- [ ] Each server's share-out amount = their tips * configured percentage per role
- [ ] Each support role's received amount = sum of shares from all servers
- [ ] Total shared out = total shared received (balanced)
- [ ] Configured percentages match actual distribution ratios
- [ ] Report includes rule name/description for each share type

---

### RPT-19: Tip adjustment report tracks all adjustments
**Priority:** P2
**Prereqs:**
- At least one tip adjustment made (from Suite 07 TIP-05/06)

**Steps:**
1. `GET /api/reports/tip-adjustments?date={today}`

**Verify:**
- [ ] Each adjustment shows: order number, original tip, new tip, difference, employee, manager, reason
- [ ] Total adjustment amount = sum of (new - original) across all adjustments
- [ ] Adjustments timestamped
- [ ] Manager who approved adjustment recorded
- [ ] Net tip impact: adjustments correctly reflected in final tip totals

---

## Section E: VOID/COMP REPORTS (4 tests)

### RPT-20: Void report count matches VoidLog
**Priority:** P0
**Prereqs:**
- Multiple voids from Suite 05

**Steps:**
1. `GET /api/reports/voids?startDate={today}&endDate={today}`
2. Count VoidLog entries with `action: "void"`.

**Verify:**
- [ ] Report void count = DB `VoidLog` count where `action: "void"` today
- [ ] Report comp count = DB `VoidLog` count where `action: "comp"` today
- [ ] Total entries = voids + comps
- [ ] No missing entries (every VoidLog row represented in report)

---

### RPT-21: Void dollar amount = sum of voided item prices
**Priority:** P0
**Prereqs:**
- Voids with known item prices

**Steps:**
1. `GET /api/reports/voids?startDate={today}&endDate={today}`
2. Sum voided item original prices from VoidLog.

**Verify:**
- [ ] Void dollar total = sum of original prices of voided items
- [ ] Comp dollar total = sum of original prices of comped items
- [ ] Dollar amounts reflect pre-discount item prices (original menu price)
- [ ] Modifier prices included in item void total
- [ ] Total loss = void dollars + comp dollars

---

### RPT-22: Void by reason breakdown
**Priority:** P1
**Prereqs:**
- Voids with various reason codes (customer_changed_mind, wrong_item, quality)

**Steps:**
1. `GET /api/reports/voids?groupBy=reason&startDate={today}&endDate={today}`

**Verify:**
- [ ] Each reason code shows: count and dollar total
- [ ] `customer_changed_mind`: count and amount match VoidLog filtered by reason
- [ ] `wrong_item`: count and amount correct
- [ ] `quality`: count and amount correct
- [ ] Sum across all reasons = total void count and amount
- [ ] Unknown/null reasons grouped under "Other" or "Unspecified"

---

### RPT-23: Void by employee breakdown
**Priority:** P1
**Prereqs:**
- Voids performed by different employees

**Steps:**
1. `GET /api/reports/voids?groupBy=employee&startDate={today}&endDate={today}`

**Verify:**
- [ ] Each employee shows their void count and dollar total
- [ ] `managerId` (approver) shown separately from `employeeId` (requester)
- [ ] Employees with no voids either omitted or shown as 0
- [ ] Useful for tracking excessive voids per server

---

## Section F: LABOR REPORTS (4 tests)

### RPT-24: Labor hours match shift durations
**Priority:** P1
**Prereqs:**
- Multiple closed shifts from today

**Steps:**
1. `GET /api/reports/labor?date={today}`
2. Calculate shift durations independently (endTime - startTime for each shift).

**Verify:**
- [ ] Total labor hours = sum of all shift durations for today
- [ ] Each employee's hours = sum of their shift durations
- [ ] Hours displayed in decimal format (e.g., 8.5 hours, not 8h 30m)
- [ ] Break time deducted if applicable
- [ ] Open shifts (not yet clocked out) shown as "in progress" with running time

---

### RPT-25: Labor cost calculation
**Priority:** P1
**Prereqs:**
- Employee hourly rates configured
- Closed shifts

**Steps:**
1. `GET /api/reports/labor?date={today}&includePayroll=true`

**Verify:**
- [ ] Labor cost per employee = hours worked * hourly rate
- [ ] Total labor cost = sum of all employee costs
- [ ] Labor cost percentage = total labor cost / total sales * 100
- [ ] Different roles have different rates (manager vs server vs busser)
- [ ] Overtime not applied in basic calculation (see RPT-26)

---

### RPT-26: Overtime tracking
**Priority:** P2
**Prereqs:**
- Employee with 40+ hours in current pay period
- Overtime rules configured (e.g., 1.5x after 40 hours)

**Steps:**
1. `GET /api/reports/labor?period=week&includeOvertime=true`

**Verify:**
- [ ] Regular hours capped at 40 (or configured threshold)
- [ ] Overtime hours = total - 40
- [ ] Overtime rate = regular rate * 1.5 (or configured multiplier)
- [ ] Overtime cost = overtime hours * overtime rate
- [ ] Total labor cost = regular cost + overtime cost
- [ ] Daily overtime (if applicable): hours > 8 in a single day

---

### RPT-27: Payroll export generates valid CSV
**Priority:** P2
**Prereqs:**
- Completed pay period with multiple employees

**Steps:**
1. `GET /api/reports/payroll-export?startDate={weekStart}&endDate={weekEnd}&format=csv`

**Verify:**
- [ ] Response content-type = `text/csv` (or download triggered)
- [ ] CSV headers include: employee name, employee ID, hours, overtime hours, regular pay, overtime pay, tips, total
- [ ] One row per employee
- [ ] All monetary values formatted to 2 decimal places
- [ ] Hours formatted consistently
- [ ] CSV parseable by standard spreadsheet software
- [ ] Totals row at bottom (if included)

---

## Section G: INVENTORY REPORTS (3 tests)

### RPT-28: Theoretical usage matches recipe quantities sold
**Priority:** P1
**Prereqs:**
- Menu items with recipes configured (ingredients + quantities)
- Items sold today with known quantities

**Steps:**
1. `GET /api/reports/theoretical-usage?date={today}`
2. Manually calculate: for each ingredient, sum (recipe quantity * items sold)

**Verify:**
- [ ] Each ingredient's theoretical usage = sum of (recipe qty * OrderItem qty) across all sold items
- [ ] Modifier ingredient usage included (based on modifier recipes)
- [ ] Pour size multiplier applied for liquor items (double = 2x ingredient usage)
- [ ] Pre-modifier instructions affect usage (NO = 0x, LITE = 0.5x, EXTRA = 2x)
- [ ] Voided items with `wasMade: true` counted as waste (separate column)
- [ ] Voided items with `wasMade: false` NOT counted

---

### RPT-29: Variance report = theoretical - actual
**Priority:** P1
**Prereqs:**
- Theoretical usage calculated (RPT-28)
- Actual inventory counts entered (physical count or perpetual inventory)

**Steps:**
1. `GET /api/reports/variance?date={today}`

**Verify:**
- [ ] Variance per ingredient = theoretical usage - actual usage
- [ ] Positive variance = used more than expected (shrinkage/waste)
- [ ] Negative variance = used less than expected (portioning tight)
- [ ] Variance percentage = (variance / theoretical) * 100
- [ ] High-variance items flagged (> threshold, e.g., 10%)
- [ ] Dollar value of variance calculated (variance qty * ingredient cost)

---

### RPT-30: Inventory transaction log matches deduction records
**Priority:** P1
**Prereqs:**
- Inventory deductions triggered by paid orders and voids today

**Steps:**
1. `GET /api/reports/inventory-transactions?date={today}`
2. Cross-reference with `InventoryTransaction` table.

**Verify:**
- [ ] Each `InventoryTransaction` record appears in report
- [ ] Transaction types: `sale` (from paid orders), `waste` (from voids with wasMade=true)
- [ ] Transaction quantities match recipe deductions
- [ ] Timestamp matches order paid/voided time
- [ ] `orderId` reference on each transaction
- [ ] Sum of `sale` deductions = theoretical usage for sold items
- [ ] Sum of `waste` deductions = theoretical usage for voided-but-made items

---

## Section H: FINANCIAL REPORTS (5 tests)

### RPT-31: Datacap transactions match payment records
**Priority:** P0
**Prereqs:**
- Card payments processed through Datacap today

**Steps:**
1. `GET /api/reports/datacap-transactions?date={today}`
2. Cross-reference with `Payment` table for card payments.

**Verify:**
- [ ] Every card `Payment` record has a corresponding Datacap transaction
- [ ] Transaction amounts match `Payment.amount + Payment.tipAmount`
- [ ] Transaction statuses match (approved, declined, voided)
- [ ] Datacap `RecordNo` / `RefNo` stored on payment record
- [ ] Batch total = sum of all approved Datacap transactions
- [ ] Pre-auth transactions tracked separately (hold vs capture)

---

### RPT-32: Cash liabilities report
**Priority:** P1
**Prereqs:**
- Cash payments and cash drawer operations today

**Steps:**
1. `GET /api/reports/cash-liabilities?date={today}`

**Verify:**
- [ ] Starting cash = sum of all drawer opening amounts
- [ ] Cash received = sum of cash payments
- [ ] Cash paid out = sum of cash refunds/payouts
- [ ] Expected cash on hand = starting + received - paid out
- [ ] Actual cash = sum of drawer closing counts
- [ ] Variance = actual - expected
- [ ] Report can break down by shift/employee

---

### RPT-33: Commission report
**Priority:** P2
**Prereqs:**
- Commission rules configured for employees/items
- Orders with commission-eligible items

**Steps:**
1. `GET /api/reports/commission?date={today}`

**Verify:**
- [ ] Per-employee commission total matches `Order.commissionTotal` sums
- [ ] Per-item commission matches `OrderItem.commissionAmount` sums
- [ ] Commission calculation: item price * commission percentage
- [ ] Only active (not voided/comped) items earn commission
- [ ] Total commission = sum across all qualifying items

---

### RPT-34: House account activity
**Priority:** P2
**Prereqs:**
- House accounts configured with charges and payments

**Steps:**
1. `GET /api/reports/house-accounts?date={today}`

**Verify:**
- [ ] Each house account shows: charges today, payments today, running balance
- [ ] Charges = sum of orders paid via house account
- [ ] Payments = sum of house account payments received
- [ ] Balance = previous balance + charges - payments
- [ ] Aging buckets (30/60/90 day) if applicable

---

### RPT-35: Gift card report
**Priority:** P2
**Prereqs:**
- Gift card issuances and redemptions today

**Steps:**
1. `GET /api/reports/gift-cards?date={today}`

**Verify:**
- [ ] Issuances: count and total dollar value of new gift cards
- [ ] Redemptions: count and total dollar value used
- [ ] Outstanding balance = all issued - all redeemed (lifetime)
- [ ] Per-card detail available (card number, balance, transactions)
- [ ] Liability total = sum of all outstanding balances

---

## Section I: CROSS-CHECKS (5 tests)

### RPT-36: Sum of all payment methods = daily total
**Priority:** P0
**Prereqs:**
- Daily report from RPT-01

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum cash total + card total + other payment methods.

**Verify:**
- [ ] `cashTotal + cardTotal + otherTotal` = `totalSales`
- [ ] No unaccounted payment methods
- [ ] House account charges included in total (if applicable)
- [ ] Gift card redemptions included in total (if applicable)
- [ ] Discrepancy = $0.00 (exact match required)

---

### RPT-37: Net sales = gross sales - voids - comps - discounts
**Priority:** P0
**Prereqs:**
- Daily report with voids, comps, and discounts

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Calculate net sales manually.

**Verify:**
- [ ] `grossSales` = sum of all item prices (before voids/comps/discounts)
- [ ] `netSales` = grossSales - voidTotal - compTotal - discountTotal
- [ ] `netSales` matches the actual payment amounts received
- [ ] Formula is transparent in report (each component shown)
- [ ] Negative net sales impossible (would indicate more voids than sales)

---

### RPT-38: Tax collected = sum of order tax amounts on paid orders
**Priority:** P0
**Prereqs:**
- Paid orders with tax applied

**Steps:**
1. `GET /api/reports/daily?date={today}`
2. Sum `Order.taxAmount` (or `OrderSnapshot.taxAmountCents`) for all paid orders.

**Verify:**
- [ ] Report `taxCollected` = sum of tax on all paid (completed) orders
- [ ] Tax calculated on net amount (after discounts, excluding voided items)
- [ ] Tax rate applied matches location tax rate setting
- [ ] Multiple tax rates handled (if applicable): each rate shown separately
- [ ] Voided orders contribute $0 tax
- [ ] Tax amount consistent with: netSales * taxRate (within rounding tolerance of $0.01 per order)

---

### RPT-39: Speed of service report
**Priority:** P2
**Prereqs:**
- Orders with timestamps: created, sent, completed (all items delivered)

**Steps:**
1. `GET /api/reports/speed-of-service?date={today}`

**Verify:**
- [ ] Average time from order created to sent (queue time)
- [ ] Average time from sent to all items ready (kitchen time)
- [ ] Average time from ready to delivered (runner time)
- [ ] Total average: created to delivered
- [ ] Times reasonable (not negative, not > 24 hours)
- [ ] Outliers flagged or excluded (orders open for hours, e.g., bar tabs)
- [ ] Breakdown by order type (dine-in faster than delivery prep)

---

### RPT-40: Order history pagination works
**Priority:** P2
**Prereqs:**
- At least 50 orders in system

**Steps:**
1. `GET /api/reports/order-history?page=1&pageSize=20`
2. `GET /api/reports/order-history?page=2&pageSize=20`
3. `GET /api/reports/order-history?page=3&pageSize=20`

**Verify:**
- [ ] Page 1 returns 20 orders (most recent first)
- [ ] Page 2 returns next 20 orders
- [ ] Page 3 returns remaining orders (or next 20)
- [ ] No overlap between pages (no duplicate orders)
- [ ] No gaps between pages (all orders accounted for)
- [ ] Response includes `totalCount`, `totalPages`, `currentPage`
- [ ] `totalCount` = actual total orders matching filter
- [ ] Empty page returns empty array with correct metadata
- [ ] Filter by date range works with pagination
- [ ] Filter by status works with pagination (open, paid, cancelled)
- [ ] Filter by employee works with pagination
