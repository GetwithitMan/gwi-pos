# Suite 07: Tips & Shifts

**Domain:** Tip Allocation, Tip Sharing, Tip Groups, Shift Management
**Total Tests:** 24
**P0 Tests:** 7 | **P1 Tests:** 13 | **P2 Tests:** 4
**Last Updated:** 2026-02-28

---

## Section A: TIP ALLOCATION (7 tests)

### TIP-01: Cash payment with tip creates TipLedger entry
**Priority:** P0
**Prereqs:**
- Open order served by employee (serverId)
- Order total = $40.00 (subtotal + tax)

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{serverId}",
     "paymentMethod": "cash",
     "amount": 40.00,
     "tipAmount": 6.00,
     "terminalId": "{terminalId}"
   }
   ```
2. Query TipLedger for this payment:
   ```
   GET /api/tips?orderId={orderId}
   ```

**Verify:**
- [ ] Response status `200`, order `status` = `"paid"`
- [ ] `Payment.tipAmount` = 6.00
- [ ] DB: `TipLedger` entry created with:
  - `amount` = 6.00
  - `employeeId` = serverId (the order's server)
  - `paymentId` referencing this payment
  - `orderId` = the paid order
  - `type` = `"cash_tip"` (or equivalent)
- [ ] Tip appears in employee's shift tip totals
- [ ] Socket: `payment:processed` fires with tip information

**Timing:** < 200ms response time

---

### TIP-02: Card payment with tip creates TipLedger entry
**Priority:** P0
**Prereqs:**
- Open order served by employee (serverId)
- Payment reader available

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "employeeId": "{serverId}",
     "paymentMethod": "card",
     "amount": 55.00,
     "tipAmount": 10.00,
     "readerId": "{readerId}"
   }
   ```
2. Query TipLedger.

**Verify:**
- [ ] `Payment.tipAmount` = 10.00
- [ ] DB: `TipLedger` entry created with:
  - `amount` = 10.00
  - `employeeId` = serverId
  - `type` = `"card_tip"` (or equivalent)
- [ ] Datacap transaction includes tip in total capture amount ($65.00)
- [ ] Tip appears in employee's tip report

---

### TIP-03: Split payment with tip on card only
**Priority:** P1
**Prereqs:**
- Order total = $80.00
- Split payment: $40 cash (no tip) + $40 card ($8 tip)

**Steps:**
1. Pay $40 cash with $0 tip:
   ```
   POST /api/orders/{orderId}/pay
   {
     "paymentMethod": "cash",
     "amount": 40.00,
     "tipAmount": 0
   }
   ```
2. Pay remaining $40 card with $8 tip:
   ```
   POST /api/orders/{orderId}/pay
   {
     "paymentMethod": "card",
     "amount": 40.00,
     "tipAmount": 8.00,
     "readerId": "{readerId}"
   }
   ```
3. Query TipLedger.

**Verify:**
- [ ] Cash payment creates NO TipLedger entry (tip = $0)
- [ ] Card payment creates TipLedger entry with `amount` = $8.00
- [ ] Total tips for this order = $8.00
- [ ] Employee's tip total reflects only the $8.00 card tip
- [ ] Both payments sum to full order total ($80.00 + $8.00 tip)

---

### TIP-04: Tip on split check allocated to correct employee
**Priority:** P1
**Prereqs:**
- Split order (from Suite 04): child order 1 served by server A, child order 2 served by server B
- OR both children assigned to same server (parent server)

**Steps:**
1. Pay child order 1 with $5 tip:
   ```
   POST /api/orders/{childOrder1Id}/pay
   {
     "paymentMethod": "card",
     "amount": {child1Total},
     "tipAmount": 5.00,
     "readerId": "{readerId}"
   }
   ```
2. Pay child order 2 with $7 tip:
   ```
   POST /api/orders/{childOrder2Id}/pay
   {
     "paymentMethod": "card",
     "amount": {child2Total},
     "tipAmount": 7.00,
     "readerId": "{readerId}"
   }
   ```
3. Query TipLedger for each employee.

**Verify:**
- [ ] Child 1 tip ($5) allocated to the employee on child order 1
- [ ] Child 2 tip ($7) allocated to the employee on child order 2
- [ ] If same server: total tips = $12.00 in their TipLedger
- [ ] If different servers: each has their respective tip
- [ ] Parent order total tips = sum of child tips ($12.00)

---

### TIP-05: Batch tip adjustment
**Priority:** P1
**Prereqs:**
- Multiple paid orders with card tips (at least 3 orders)
- Need to adjust tips after batch close

**Steps:**
1. `POST /api/orders/batch-adjust-tips`
   ```json
   {
     "adjustments": [
       { "orderId": "{order1Id}", "newTipAmount": 8.00 },
       { "orderId": "{order2Id}", "newTipAmount": 12.00 },
       { "orderId": "{order3Id}", "newTipAmount": 0.00 }
     ],
     "employeeId": "{managerId}"
   }
   ```
2. Query TipLedger for each order.

**Verify:**
- [ ] Order 1 tip updated from original to $8.00
- [ ] Order 2 tip updated to $12.00
- [ ] Order 3 tip set to $0.00 (tip removed)
- [ ] TipLedger entries adjusted (or new adjustment entries created)
- [ ] Payment records updated with new tip amounts
- [ ] Original tip amounts preserved in audit trail
- [ ] Total tip adjustments trackable in tip adjustment report

---

### TIP-06: Tip adjust single order
**Priority:** P1
**Prereqs:**
- Paid order with card tip of $5.00

**Steps:**
1. `POST /api/orders/{orderId}/adjust-tip`
   ```json
   {
     "newTipAmount": 10.00,
     "employeeId": "{managerId}",
     "reason": "Customer left additional cash tip"
   }
   ```
2. `GET /api/orders/{orderId}` to verify.

**Verify:**
- [ ] Payment `tipAmount` updated from $5.00 to $10.00
- [ ] TipLedger entry adjusted to $10.00
- [ ] Tip adjustment reason stored
- [ ] Employee tip total reflects new amount
- [ ] Adjustment timestamp recorded
- [ ] Socket: `orders:list-changed` fires (totals changed)

---

### TIP-07: Zero tip payment creates no TipLedger entry
**Priority:** P2
**Prereqs:**
- Open order

**Steps:**
1. `POST /api/orders/{orderId}/pay`
   ```json
   {
     "paymentMethod": "cash",
     "amount": 25.00,
     "tipAmount": 0
   }
   ```
2. Query TipLedger for this order.

**Verify:**
- [ ] Payment created with `tipAmount` = 0.00
- [ ] NO `TipLedger` entry created (zero tips do not create ledger entries)
- [ ] Employee tip total for this shift not affected
- [ ] Order still shows in employee's orders (just with $0 tip)

---

## Section B: TIP SHARING (5 tests)

### TIP-08: Tip share rule distributes percentage to supporting roles
**Priority:** P0
**Prereqs:**
- Tip share rule active for location:
  - Busser gets 5% of server tips
  - Host gets 3% of server tips
- Server (serverId) has earned $100 in tips this shift
- Busser (busserId) and host (hostId) on shift

**Steps:**
1. Ensure tip share rules are configured:
   ```
   GET /api/settings/tip-outs
   ```
2. Close shift (triggers tip share calculation):
   ```
   POST /api/shifts/{shiftId}/close
   { "closingCash": 500.00, "employeeId": "{managerId}" }
   ```
3. Query TipLedger for tip shares.

**Verify:**
- [ ] Server's tips: $100.00 gross
- [ ] Busser receives TipLedger entry: $5.00 (5% of $100)
- [ ] Host receives TipLedger entry: $3.00 (3% of $100)
- [ ] Server's net tips: $92.00 ($100 - $5 - $3)
- [ ] TipLedger entries for busser/host have `type: "tip_share"` (or equivalent)
- [ ] All tip share entries reference the originating server's tips
- [ ] Tip share amounts go to payroll

---

### TIP-09: Tip share with multiple supporting roles
**Priority:** P1
**Prereqs:**
- Tip share rules:
  - Busser: 5%
  - Host: 3%
  - Barback: 2%
- Server earned $200 in tips

**Steps:**
1. Close shift.
2. Query all TipLedger entries.

**Verify:**
- [ ] Busser: $10.00 (5% of $200)
- [ ] Host: $6.00 (3% of $200)
- [ ] Barback: $4.00 (2% of $200)
- [ ] Server net: $180.00 ($200 - $10 - $6 - $4)
- [ ] Total tip-out = $20.00 (10% total)
- [ ] Each supporting role has their own TipLedger entry

---

### TIP-10: Tip share percentages sum correctly
**Priority:** P0
**Prereqs:**
- Any tip share configuration

**Steps:**
1. Run tip share calculation on completed shift.
2. Sum all tip share amounts.

**Verify:**
- [ ] Sum of all tip share amounts = original server tips * sum of share percentages
- [ ] Server net = original tips - sum of all share amounts
- [ ] No rounding errors accumulate (rounding applied per recipient, remainder to server)
- [ ] If tip shares total > 100% of tips: configuration rejected or capped
- [ ] All amounts are positive (no negative tip shares)
- [ ] Cent-level rounding: server absorbs any rounding remainder (not support staff)

---

### TIP-11: Auto-distribute at shift closeout
**Priority:** P1
**Prereqs:**
- Location setting: `tipShares.autoDistributeAtCloseout: true`
- Active shift with tips earned

**Steps:**
1. Close shift:
   ```
   POST /api/shifts/{shiftId}/close
   { "closingCash": 500.00, "employeeId": "{managerId}" }
   ```
2. Query TipLedger.

**Verify:**
- [ ] Tip shares automatically calculated and distributed at shift close
- [ ] TipLedger entries created for all supporting roles immediately
- [ ] No manual intervention required
- [ ] Shift closeout report includes tip share breakdown
- [ ] Server sees net tip amount (after shares) on their closeout slip

---

### TIP-12: Manual distribution (autoDistribute=false)
**Priority:** P2
**Prereqs:**
- Location setting: `tipShares.autoDistributeAtCloseout: false`
- Active shift with tips

**Steps:**
1. Close shift.
2. Verify tips are pooled but NOT distributed.
3. Manager manually distributes:
   ```
   POST /api/tips/distribute
   {
     "shiftId": "{shiftId}",
     "distributions": [
       { "employeeId": "{busserId}", "amount": 15.00 },
       { "employeeId": "{hostId}", "amount": 8.00 }
     ],
     "managerId": "{managerId}"
   }
   ```

**Verify:**
- [ ] At shift close: tip shares NOT automatically created
- [ ] Tips remain in server's pool until manager distributes
- [ ] Manual distribution creates TipLedger entries for each recipient
- [ ] Manager can adjust amounts (not locked to percentage rules)
- [ ] Distribution logged with manager ID for audit trail
- [ ] Cannot distribute more than total tip pool

---

## Section C: TIP GROUPS (4 tests)

### TIP-13: Create tip group
**Priority:** P1
**Prereqs:**
- Two or more employees on the same shift

**Steps:**
1. `POST /api/tip-groups`
   ```json
   {
     "name": "Bar Team Pool",
     "shiftId": "{shiftId}",
     "memberIds": ["{bartender1Id}", "{bartender2Id}"],
     "locationId": "{locationId}"
   }
   ```

**Verify:**
- [ ] Tip group created with unique ID
- [ ] Members array includes both bartenders
- [ ] Group is active for current shift
- [ ] Socket: `tip-group:updated` fires with group details
- [ ] Group visible in shift management UI

---

### TIP-14: Member joins existing tip group
**Priority:** P1
**Prereqs:**
- Active tip group (from TIP-13)
- Third employee (bartender3Id) on shift

**Steps:**
1. `POST /api/tip-groups/{groupId}/members`
   ```json
   {
     "employeeId": "{bartender3Id}"
   }
   ```

**Verify:**
- [ ] Member added to group
- [ ] Group now has 3 members
- [ ] Socket: `tip-group:updated` fires with updated member list
- [ ] New member's future tips go into group pool
- [ ] Previous tips (before joining) NOT retroactively pooled

---

### TIP-15: Tip received in group distributed evenly
**Priority:** P1
**Prereqs:**
- Active tip group with 3 members (from TIP-14)
- One member receives a $30.00 tip on their order

**Steps:**
1. Pay order with $30 tip (order served by bartender1):
   ```
   POST /api/orders/{orderId}/pay
   {
     "paymentMethod": "card",
     "amount": 50.00,
     "tipAmount": 30.00,
     "readerId": "{readerId}"
   }
   ```
2. Query TipLedger for group members.

**Verify:**
- [ ] $30.00 tip pooled into group
- [ ] Each member's share: $10.00 ($30 / 3 members)
- [ ] TipLedger entries created for each member: $10.00 each
- [ ] TipLedger entries reference the tip group
- [ ] If uneven division: remainder handled by rounding (e.g., $10.01, $10.00, $9.99 for $30)
- [ ] Group running total updated

---

### TIP-16: Close tip group -- final distribution calculated
**Priority:** P1
**Prereqs:**
- Active tip group with accumulated tips

**Steps:**
1. `POST /api/tip-groups/{groupId}/close`
   ```json
   {
     "managerId": "{managerId}"
   }
   ```
2. Query final TipLedger entries.

**Verify:**
- [ ] Tip group status = `"closed"`
- [ ] Final distribution calculated for all accumulated tips
- [ ] Each member has correct TipLedger entries for their share
- [ ] Total distributed = total tips received by group
- [ ] No tips lost in distribution (sum of shares = total pool)
- [ ] Closed group cannot receive new tips
- [ ] Socket: `tip-group:updated` fires with `status: "closed"`

---

## Section D: SHIFT MANAGEMENT (5 tests)

### TIP-17: Clock in (create shift)
**Priority:** P0
**Prereqs:**
- Authenticated employee (serverId)
- No active shift for this employee

**Steps:**
1. `POST /api/shifts`
   ```json
   {
     "employeeId": "{serverId}",
     "locationId": "{locationId}",
     "openingCash": 200.00
   }
   ```
2. `GET /api/shifts/{shiftId}` to verify.

**Verify:**
- [ ] Response status `200`
- [ ] Shift created with `status: "open"`
- [ ] `openingCash` = 200.00
- [ ] `startTime` set to current timestamp (DB-generated `NOW()`)
- [ ] `employeeId` matches requesting employee
- [ ] `locationId` set correctly
- [ ] DB: `TimeClockEntry` created with `type: "clock_in"`
- [ ] Employee can now take orders
- [ ] Socket: `shift:opened` fires (or `shifts:updated`)

**Timing:** < 200ms response time

---

### TIP-18: Clock out (close shift with drawer count)
**Priority:** P0
**Prereqs:**
- Active shift for employee (from TIP-17)
- Employee has processed some cash orders during shift

**Steps:**
1. `POST /api/shifts/{shiftId}/close`
   ```json
   {
     "closingCash": 350.00,
     "employeeId": "{managerId}"
   }
   ```
2. `GET /api/shifts/{shiftId}` to verify.

**Verify:**
- [ ] Shift `status` = `"closed"`
- [ ] `closingCash` = 350.00
- [ ] `endTime` set to current timestamp
- [ ] `variance` calculated:
  - Expected cash = openingCash + cash_payments_received - cash_paid_out
  - Variance = closingCash - expected cash
- [ ] DB: `TimeClockEntry` with `type: "clock_out"`
- [ ] Total hours calculated (`endTime - startTime`)
- [ ] Socket: `shift:closed` fires
- [ ] Employee's shift tip totals finalized

**Timing:** < 300ms response time

---

### TIP-19: Shift close report includes all orders, payments, and tips
**Priority:** P0
**Prereqs:**
- Closed shift with multiple orders and payments

**Steps:**
1. `GET /api/shifts/{shiftId}` (or `GET /api/reports/shift/{shiftId}`)

**Verify:**
- [ ] Report includes total orders served during shift
- [ ] Total sales amount (sum of all payments)
- [ ] Cash payments total
- [ ] Card payments total
- [ ] Total tips earned (cash + card)
- [ ] Tip share amounts (distributed to/from)
- [ ] Net tips after shares
- [ ] Opening cash drawer amount
- [ ] Closing cash drawer amount
- [ ] Cash variance (over/short)
- [ ] Void count and dollar amount during shift
- [ ] Comp count and dollar amount during shift
- [ ] Discount total during shift
- [ ] Hours worked

---

### TIP-20: Print shift closeout
**Priority:** P1
**Prereqs:**
- Closed shift (from TIP-18)
- Receipt printer available

**Steps:**
1. `POST /api/print/shift-closeout`
   ```json
   {
     "shiftId": "{shiftId}"
   }
   ```

**Verify:**
- [ ] Print job sent to receipt printer
- [ ] Closeout slip includes all data from TIP-19
- [ ] Formatted for thermal printer (ESC/POS)
- [ ] Employee name and shift time range shown
- [ ] Signature line printed (for tip verification)
- [ ] Print is fire-and-forget (does not block API)

---

### TIP-21: Drawer count (blind count vs full count)
**Priority:** P1
**Prereqs:**
- Active shift, employee needs to count drawer

**Steps:**
1. Full count (manager sees expected amount):
   ```
   GET /api/shifts/{shiftId}/drawer-count?type=full
   ```
2. Blind count (employee does NOT see expected amount):
   ```
   GET /api/shifts/{shiftId}/drawer-count?type=blind
   ```

**Verify:**
- [ ] Full count: response includes `expectedCash` (opening + cash in - cash out)
- [ ] Blind count: response does NOT include `expectedCash` (employee must count independently)
- [ ] Blind count enforced by permission (`employee.blind_count_only`)
- [ ] Manager can always see full count
- [ ] After count submitted: variance calculated regardless of count type
- [ ] Variance = submitted count - expected cash

---

## Section E: TIP REPORT CROSS-CHECK (3 tests)

### TIP-22: GET /api/reports/tips totals match TipLedger entries
**Priority:** P0
**Prereqs:**
- Multiple paid orders with tips from this test suite
- At least one shift closed

**Steps:**
1. `GET /api/reports/tips?startDate={today}&endDate={today}`
2. Cross-reference with TipLedger table.

**Verify:**
- [ ] Report total tips = sum of all `TipLedger.amount` entries for today
- [ ] Cash tip total matches sum of `TipLedger` entries with cash type
- [ ] Card tip total matches sum of `TipLedger` entries with card type
- [ ] Tip adjustments reflected (original amounts replaced by adjusted)
- [ ] Report grouped by employee shows correct per-employee totals
- [ ] Report includes tip share distributions (in and out)

---

### TIP-23: GET /api/reports/tip-shares matches allocation rules
**Priority:** P1
**Prereqs:**
- Tip shares distributed during shift close (from TIP-08 or TIP-09)

**Steps:**
1. `GET /api/reports/tip-shares?shiftId={shiftId}`
2. Verify against configured tip share rules.

**Verify:**
- [ ] Share amounts match configured percentages exactly
- [ ] Busser share = server tips * busser percentage
- [ ] Host share = server tips * host percentage
- [ ] Total shares = sum of all support role shares
- [ ] Server net = server gross - total shares
- [ ] Rounding handled consistently (server absorbs remainder)
- [ ] Report can filter by shift or date range

---

### TIP-24: Tip report by employee matches individual TipLedger sums
**Priority:** P1
**Prereqs:**
- Multiple employees with tips earned today

**Steps:**
1. `GET /api/reports/tips?groupBy=employee&startDate={today}&endDate={today}`
2. For each employee in report:
   - Sum their TipLedger entries independently
   - Compare to report value

**Verify:**
- [ ] Each employee's report total = sum of their TipLedger entries
- [ ] No missing entries (report accounts for all ledger records)
- [ ] No duplicate counting (shared tips not double-counted)
- [ ] Tip shares received shown separately from direct tips
- [ ] Tip shares given shown separately (deducted from gross)
- [ ] Net tips = direct tips + shares received - shares given
