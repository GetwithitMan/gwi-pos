# Cross-Terminal Integration Test — Agent Team Prompt

> **How to use:** Open a new Claude Code session in the `gwi-pos` directory and paste the prompt below.
> Run after any sync/socket/order flow changes to verify everything still works end-to-end.

---

## The Prompt

Copy everything below the line and paste it:

---

```
PM Mode: Cross-Terminal Integration Test (Agent Team)

We are running a full cross-terminal integration test of the GWI POS system. This tests that actions on one terminal (Android, Web UI, KDS) propagate correctly to all other terminals, the NUC server records them accurately, and reports reflect reality.

Read these files first for context:
- gwi-pos/CLAUDE.md (system architecture, API conventions, socket events)
- gwi-pos/docs/guides/INTEGRATION-TEST-PROMPT.md (this test plan with all scenarios)

## CRITICAL RULE: SELF-LEARNING DISCOVERY

**Every agent is a test discoverer.** While executing test steps, ALL agents must watch for:
- Unexpected behavior not covered by any existing test
- Edge cases (race conditions, null values, boundary amounts, empty states)
- Implicit dependencies between features that should be explicitly tested
- Missing socket events, wrong payloads, duplicates
- API responses > 500ms, socket events > 200ms after action
- Data integrity gaps (totals don't add up, missing records, stale state)
- Cross-feature interactions nobody thought to test (e.g., discount + split + tip)

**When an agent discovers something new:**
1. Keep executing the current test (don't stop)
2. Log the discovery to `docs/tests/DISCOVERED-TESTS.md` using this format:
   ```
   ### DIS-[next number]: [Short title]
   **Found during:** Scenario [X.X] on [date]
   **Agent:** [agent name]
   **Observation:** [what happened]
   **Impact:** [why it matters]
   **Suggested suite:** [01-14]
   **Suggested priority:** [P0/P1/P2]
   **Suggested test:**
   1. [step]
   2. [step]
   **Verify:**
   - [ ] [assertion]
   ```
3. Continue with the next test step

**After the test run**, the final report includes a "Discoveries" section listing all new DIS-### entries.
The user reviews them later with `Review Discovered Tests` and approves, rejects, or defers each one.
Approved discoveries get promoted into the official suite files automatically.

---

## CRITICAL RULE: CLOSE EVERY ORDER (with self-healing)

**Every order created during this test MUST reach a terminal state before the scenario ends.**
Terminal states: `paid`, `cancelled`, or `closed`.

- If a scenario creates an order to test something (modifiers, courses, transfers, etc.), it MUST pay or void the order at the end.
- If a scenario splits an order, ALL splits MUST be paid.
- If a scenario reopens an order, it MUST be re-paid at the end.
- If a scenario transfers items, BOTH orders MUST be paid.
- The REPORT AGENT verifies at the end: `GET /api/orders/open` returns ZERO orders created by this test run.

Track every orderId created in a shared list: `testOrderIds[]`.

### When an Order Won't Close — Self-Healing Protocol

If a payment or close operation **fails**, the agent MUST:

1. **Don't skip it.** Retry the close attempt up to 3 times with 2-second delays.
2. **Diagnose.** After 3 failures, investigate WHY:
   - `GET /api/orders/[id]` — what status is it stuck in?
   - Check for validation errors in the response body
   - Check if items are in an unexpected state (e.g., still `pending` kitchenStatus when `sent` was expected)
   - Check if a pre-auth is blocking (needs capture, not direct pay)
   - Check if split parent is preventing close (siblings not all paid)
   - Check if there's a balance mismatch (totals changed between item add and pay)
3. **Attempt alternate close path:**
   - If pay fails → try voiding all items (triggers auto-cancel)
   - If void fails → try POST /api/orders/[id]/comp-void on each item individually
   - If order is split → find and pay/void each child first
   - If order has pre-auth → try POST /api/orders/[id]/close-tab instead of /pay
4. **Log an incident** (see Incident Report format below) with:
   - The orderId and orderNumber
   - What the agent tried (each attempt with response codes/errors)
   - What ultimately worked (or didn't)
   - Root cause analysis (agent's best guess at why it failed)
   - Whether it was a test environment issue or a real bug
5. **Log a discovery** in `docs/tests/DISCOVERED-TESTS.md` — the failure is likely a missing test case.
6. **Continue to next scenario** — never block the entire test run on one stuck order.

### Final Cleanup Sweep (Phase 5)

After ALL scenarios, the NUC VERIFIER runs:
```sql
SELECT id, "orderNumber", status FROM "Order"
WHERE status NOT IN ('paid', 'cancelled', 'closed')
AND "createdAt" > '[test_start_timestamp]'
```

For EACH orphaned order found:
1. Log it as an incident
2. Attempt self-healing close (void all items → auto-cancel)
3. Record whether the self-heal succeeded
4. If self-heal fails, leave the order and flag it as **CRITICAL** in the report

Result categories:
- **All closed normally** → PASS
- **Some required self-healing** → WARN (with incident details)
- **Some could not be closed at all** → FAIL (with full diagnosis)

## TEAM STRUCTURE (7 agents)

### Agent 1: ANDROID TERMINAL
Role: Simulates the Android register sending orders via the sync API.
Tools: Bash (curl commands to NUC API), general-purpose (read response data)
Endpoints it uses:
- POST /api/sync/outbox (push orders to NUC)
- POST /api/order-events/batch (when event-sourced — use if endpoint exists, fall back to outbox)
- POST /api/orders (create order directly as fallback)
- POST /api/orders/[id]/items (add items)
- POST /api/orders/[id]/send (send to kitchen)
- POST /api/orders/[id]/pay (process payment)
- POST /api/orders/[id]/pre-auth (start bar tab)
- POST /api/orders/[id]/comp-void (void items)
- POST /api/orders/[id]/split-tickets (split check)

On every action: record the timestamp (Date.now()) and include it in your report.
**Track every orderId created in a list. Every order MUST be closed by end of test.**

### Agent 2: WEB UI TERMINAL
Role: Simulates a second terminal (browser/kiosk) checking that Android actions appear.
Also originates its own actions for backward testing.
Tools: Bash (curl commands to same NUC API)
Endpoints it reads:
- GET /api/orders/open?summary=true (open orders list)
- GET /api/orders/[id] (order detail)
- GET /api/floorplan/snapshot (floor plan with order counts)
- GET /api/orders/[id]/payments (payment records)

On every check: record the timestamp and compare to when the action was sent.
Report: "Web UI saw order X at T2, Android sent at T1, delta = T2-T1 ms"
**Track every orderId created in a list. Every order MUST be closed by end of test.**

### Agent 3: NUC SERVER VERIFIER
Role: Verifies database state directly after each action. Runs Prisma queries.
Tools: Bash (npx prisma queries or direct psql), general-purpose
What it checks after each scenario:
- Order record: status, totals, timestamps, tableId, employeeId
- OrderItem records: price, quantity, kitchenStatus, seatNumber, courseNumber
- OrderItemModifier records: name, price, preModifier, depth
- Payment records: amount, tipAmount, method, status, cardLast4
- VoidLog records (after voids)
- InventoryItemTransaction records (after payment — type='sale')
- TipLedger records (after payment with tip)
- Table status (available vs occupied)

On every check: record timestamp, compare to action timestamp.
Report: "DB confirmed order X paid at T3, pay request sent at T1, delta = T3-T1 ms"

**FINAL CHECK: After Phase 4 completes, query for any open orders created after test_start_timestamp. Report as FAIL if any found.**

### Agent 4: KDS AGENT
Role: Simulates the Kitchen Display System receiving and processing orders.
Tools: Bash (curl commands)
Endpoints:
- GET /api/kds?locationId={LOC}&stationId={STATION} (poll KDS orders)
- PUT /api/orders/[id]/items/[itemId] (update kitchenStatus to cooking/ready/delivered)
- POST /api/kds/bump (bump order from station)

After Android or Web sends to kitchen:
1. Poll GET /api/kds until the order appears — record how long it took
2. Mark items cooking → ready → delivered
3. Verify socket events kds:item-status and kds:order-bumped fire

### Agent 5: SOCKET WATCHER
Role: Connects to Socket.io and logs every event with timestamps.
Tools: Bash (node script that connects to socket.io and logs events)
What it watches:
- order:created — new order appeared
- order:item-added — items added
- orders:list-changed — open orders list changed (trigger: created/paid/voided/sent)
- order:totals-updated — totals changed
- payment:processed — payment completed
- kds:order-received — order sent to kitchen
- kds:item-status — item status changed
- kds:order-bumped — order bumped from KDS
- floor-plan:updated — table status changed
- table:status-changed — table occupied/available
- tab:updated — bar tab status change
- void:approval-update — void approved/rejected
- entertainment:session-update — entertainment timer

For EACH event: log { eventName, timestamp, payload, latencyFromAction }
Report any MISSING events (action happened but socket never fired).
Report any DUPLICATE events.
Report any OUT-OF-ORDER events.

### Agent 6: PAYMENT AGENT
Role: Handles all payment scenarios and verifies financial accuracy.
Tools: Bash (curl commands)
Scenarios it runs:
- Exact cash payment (amount = order total)
- Overpayment with change due
- Split payment (half cash, half card)
- Pre-auth bar tab → add items → capture with tip
- Comp item after payment
- Void item after payment (with Datacap reversal check)
- $0 order (all items voided before payment)
- Rounding adjustment verification

For each: verify Payment record amounts, order totals, tip allocation.
**Every order this agent creates MUST be paid or cancelled by end of its scenario.**

### Agent 7: REPORT AGENT
Role: After all scenarios complete, pulls reports and verifies numbers match.
Tools: Bash (curl commands)
Reports to pull:
- GET /api/reports/daily (daily summary — verify total sales match sum of payments)
- GET /api/reports/sales (sales by category — verify item counts)
- GET /api/reports/tips (tip report — verify tip totals)
- GET /api/reports/voids (void report — verify void counts and reasons)
- GET /api/reports/product-mix (PMIX — verify item quantities sold)
- GET /api/reports/datacap-transactions (verify card transaction records)

Cross-reference: sum of all Payment.amount should equal daily report total.
Flag any discrepancy.

**FINAL GATE: Verify GET /api/orders/open returns ZERO test orders. If any test order is still open, the entire run is FAIL.**

---

## TEST SCENARIOS (run in order)

### PHASE 1: FORWARD FLOW (Android → NUC → Web → KDS)

**Scenario 1.1: Basic Order Flow → Full Close**
1. ANDROID: Create order on Table 1 with 2 items (e.g., Burger $12, Beer $6)
2. SOCKET WATCHER: Verify order:created fires within 200ms
3. WEB UI: GET /api/orders/open — verify new order appears, correct items/totals
4. NUC VERIFIER: Check Order record (status=open, subtotal=$18, correct tableId)
5. ANDROID: Send to kitchen
6. KDS: Poll until order appears — record latency
7. SOCKET WATCHER: Verify kds:order-received fires
8. WEB UI: GET /api/orders/[id] — verify kitchenStatus=pending on items
9. KDS: Mark items cooking → ready → delivered (with delays between each)
10. SOCKET WATCHER: Verify kds:item-status fires for each status change
11. WEB UI: Verify kitchenStatus updates visible
12. **CLOSE: PAYMENT AGENT pays order (cash, exact amount $18)**
13. **VERIFY: Order.status=paid, Table.status=available, order GONE from open list**

**Scenario 1.2: Payment Verification (uses order from 1.1)**
1. NUC VERIFIER: Check Order.status=paid, Payment.status=completed, Payment.amount=$18
2. NUC VERIFIER: Check InventoryItemTransaction exists (type=sale)
3. NUC VERIFIER: Check Table.status=available
4. SOCKET WATCHER: Confirm payment:processed + orders:list-changed (trigger=paid) fired
5. WEB UI: GET /api/orders/open — verify order GONE from open list
6. Record all timestamps and deltas
7. **VERIFY: Order is in terminal state (paid). Done.**

**Scenario 1.3: Bar Tab Flow → Full Close**
1. ANDROID: Create bar tab order (no table)
2. ANDROID: POST /api/orders/[id]/pre-auth (simulate card swipe)
3. SOCKET WATCHER: Verify tab:updated fires
4. ANDROID: Add 3 more items over time (3 separate POST /items calls)
5. WEB UI: After each add, verify order totals update
6. SOCKET WATCHER: Verify order:item-added fires each time
7. **CLOSE: PAYMENT AGENT pays order (POST /api/orders/[id]/pay, capture with $5 tip)**
8. NUC VERIFIER: Verify Payment.tipAmount=$5, TipLedger entry created
9. SOCKET WATCHER: Verify payment:processed fires
10. **VERIFY: Order.status=paid. Tab closed. Done.**

**Scenario 1.4: Void/Comp Flow → Pay Remaining**
1. ANDROID: Create order with 3 items ($10 + $8 + $15 = $33)
2. ANDROID: Send to kitchen
3. ANDROID: Void item 2 (reason: customer_changed_mind)
4. SOCKET WATCHER: Verify order:totals-updated fires with new total ($25)
5. WEB UI: Verify order total changed, item 2 shows status=voided
6. NUC VERIFIER: Check VoidLog record exists with correct reason
7. NUC VERIFIER: Verify Order.total recalculated (excludes voided item)
8. **CLOSE: PAYMENT AGENT pays remaining $25 (cash)**
9. NUC VERIFIER: Verify InventoryItemTransaction only for items 1 and 3 (not voided item 2)
10. **VERIFY: Order.status=paid. Done.**

**Scenario 1.5: Split Check Flow → Pay ALL Splits**
1. ANDROID: Create order with 4 items ($10 + $12 + $8 + $15 = $45)
2. ANDROID: POST /api/orders/[id]/split-tickets (split into 2 checks)
3. WEB UI: Verify parent order status=split, 2 child orders visible
4. **CLOSE: PAYMENT AGENT pays child order 1 (cash)**
5. NUC VERIFIER: Child 1 status=paid, parent still status=split
6. SOCKET WATCHER: Verify orders:list-changed (trigger=paid) for child 1
7. **CLOSE: PAYMENT AGENT pays child order 2 (card)**
8. NUC VERIFIER: Child 2 status=paid, parent NOW status=paid (auto-close)
9. SOCKET WATCHER: Verify parent order:updated fires
10. **VERIFY: Parent.status=paid, Child1.status=paid, Child2.status=paid. All closed. Done.**

### PHASE 2: BACKWARD FLOW (Web UI → NUC → Android)

**Scenario 2.1: Web Creates, Android Verifies → Full Close**
1. WEB UI: POST /api/orders (create order on Table 5, 2 items)
2. SOCKET WATCHER: Verify order:created fires
3. ANDROID: GET /api/sync/delta?since=... — verify new order appears in delta
4. NUC VERIFIER: Confirm order exists with correct data
5. WEB UI: Send to kitchen
6. KDS: Verify order appears, mark items cooking → ready → delivered
7. **CLOSE: WEB UI pays order (POST /api/orders/[id]/pay, cash)**
8. ANDROID: GET /api/sync/delta — verify order now shows status=paid
9. **VERIFY: Order.status=paid. Done.**

**Scenario 2.2: Web Splits, Android Sees → Pay ALL Splits**
1. WEB UI: Create order with 3 items ($8 + $12 + $10 = $30), send to kitchen
2. KDS: Mark all items delivered
3. WEB UI: Split into 3 checks
4. ANDROID: Delta sync — verify split orders appear
5. **CLOSE: WEB UI pays check 1 (cash)**
6. ANDROID: Delta sync — verify check 1 paid, others still open
7. WEB UI: Void item on check 2
8. ANDROID: Delta sync — verify item voided, totals updated
9. **CLOSE: WEB UI pays check 2 remainder (cash)**
10. **CLOSE: WEB UI pays check 3 (card)**
11. **VERIFY: All 3 checks paid, parent auto-closed. Done.**

**Scenario 2.3: Web Transfers Items → Pay BOTH Orders**
1. WEB UI: Create 2 orders (Order A on Table 1 with 2 items, Order B on Table 2 with 1 item)
2. WEB UI: Send both to kitchen
3. KDS: Mark all items delivered on both orders
4. WEB UI: POST /api/orders/[orderA]/transfer-items (move 1 item to Order B)
5. SOCKET WATCHER: Verify orders:list-changed fires for both orders
6. NUC VERIFIER: Item now belongs to Order B, totals recalculated on both
7. ANDROID: Delta sync — verify both orders reflect the transfer
8. **CLOSE: WEB UI pays Order A (cash)**
9. **CLOSE: WEB UI pays Order B (card)**
10. **VERIFY: OrderA.status=paid, OrderB.status=paid. Both tables available. Done.**

### PHASE 3: CONCURRENT OPERATIONS (stress test)

**Scenario 3.1: Two Terminals Add Items Simultaneously → Full Close**
1. WEB UI: Create order on Table 3
2. ANDROID: POST /api/orders/[id]/items (add Burger) — record timestamp T1
3. WEB UI: POST /api/orders/[id]/items (add Beer) — sent within 100ms of step 2, record T2
4. NUC VERIFIER: BOTH items exist on the order (no lost writes)
5. SOCKET WATCHER: Verify 2 separate order:item-added events
6. NUC VERIFIER: Order total includes both items
7. WEB UI: Send to kitchen
8. KDS: Mark all items delivered
9. **CLOSE: PAYMENT AGENT pays order (cash, full amount)**
10. **VERIFY: Order.status=paid. Done.**

**Scenario 3.2: Edit Lock Conflict → Full Close**
1. WEB UI: Create order on Table 4 with 2 items
2. ANDROID: Open order for editing (socket emits order:editing)
3. WEB UI: Try to open same order for editing
4. SOCKET WATCHER: Verify order:editing event shows Android's terminalId
5. WEB UI: Should see "being edited by [Android terminal]" warning
6. ANDROID: Release edit lock (socket emits order:editing-released)
7. WEB UI: Send to kitchen
8. KDS: Mark all items delivered
9. **CLOSE: WEB UI pays order (cash)**
10. **VERIFY: Order.status=paid. Done.**

**Scenario 3.3: Pay Race Condition → Verify Single Payment**
1. WEB UI: Create order on Table 6 with 1 item ($15)
2. WEB UI: Send to kitchen
3. KDS: Mark item delivered
4. ANDROID: POST /api/orders/[id]/pay (attempt 1, idempotencyKey=ABC)
5. WEB UI: POST /api/orders/[id]/pay (attempt 2, same idempotencyKey=ABC)
6. NUC VERIFIER: Only ONE Payment record exists (idempotency check)
7. Verify both responses return success (second returns existing payment)
8. **VERIFY: Order.status=paid, exactly 1 Payment record. Done.**

### PHASE 4: EDGE CASES

**Scenario 4.1: $0 Order (all items voided) → Auto-Cancelled**
1. ANDROID: Create order on Table 7 with 1 item ($10)
2. ANDROID: Void the item (reason: wrong_item)
3. NUC VERIFIER: Order auto-cancelled (status=cancelled, total=$0)
4. SOCKET WATCHER: Verify orders:list-changed (trigger=voided)
5. WEB UI: Order should NOT appear in open orders
6. **VERIFY: Order.status=cancelled. Terminal state reached. Done.**

**Scenario 4.2: Modifier Stacking → Full Close**
1. ANDROID: Create order on Table 8 with item + modifier (allowStacking=true, tap 3x)
2. NUC VERIFIER: OrderItemModifier.quantity=3, correct price calculation
3. WEB UI: Verify modifier shows "3x" in order detail
4. ANDROID: Send to kitchen
5. KDS: Mark items delivered
6. **CLOSE: PAYMENT AGENT pays order (cash, full amount including 3x modifier price)**
7. **VERIFY: Order.status=paid. Done.**

**Scenario 4.3: Course Firing → Full Close**
1. WEB UI: Create order on Table 9 with items on courses 1, 2, 3
2. WEB UI: Fire course 1
3. KDS: Only course 1 items appear — mark them delivered
4. WEB UI: Fire course 2
5. KDS: Course 2 items now appear — mark them delivered
6. SOCKET WATCHER: Verify kds:order-received fires per course fire
7. WEB UI: Fire course 3
8. KDS: Course 3 items appear — mark them delivered
9. **CLOSE: WEB UI pays order (cash, full amount)**
10. **VERIFY: Order.status=paid. All courses fired and delivered. Done.**

**Scenario 4.4: Order Reopen → Re-Pay**
1. WEB UI: Create order on Table 10 with 2 items ($10 + $12 = $22)
2. WEB UI: Send to kitchen
3. KDS: Mark all items delivered
4. **CLOSE: WEB UI pays order (cash, $22)**
5. VERIFY: Order.status=paid
6. WEB UI: POST /api/orders/[id]/reopen
7. SOCKET WATCHER: Verify orders:list-changed (trigger=reopened)
8. NUC VERIFIER: Order.status=open, paidAt cleared
9. ANDROID: Delta sync — verify order reappears as open
10. **RE-CLOSE: WEB UI pays order again (cash, $22)**
11. **VERIFY: Order.status=paid. Terminal state reached. Done.**

---

## PHASE 5: CLEANUP, SELF-HEALING & INCIDENT REPORT

After ALL scenarios complete, before the Report Agent runs:

### Step 1: Orphan Detection
NUC VERIFIER runs:
```sql
SELECT id, "orderNumber", status FROM "Order"
WHERE status NOT IN ('paid', 'cancelled', 'closed')
AND "createdAt" > '[test_start_timestamp]'
```

### Step 2: Self-Healing Sweep
For EACH orphaned order:
1. Fetch full order: `GET /api/orders/[id]`
2. Determine close strategy:
   - If `status=draft` or `status=open` → void all items (triggers auto-cancel)
   - If `status=sent` or `status=in_progress` → void all items
   - If `status=split` → find children, close each child first, then parent auto-closes
   - If has pre-auth → `POST /api/orders/[id]/close-tab` (capture for $0 + void)
3. Execute close strategy
4. Verify order reached terminal state
5. Log incident with full details

### Step 3: Table Status Check
```sql
SELECT id, name, status FROM "Table"
WHERE status != 'available'
AND "locationId" = '[test_locationId]'
```
For any occupied table: reset to available and log incident.

### Step 4: Order Count Summary
```
Test Run Summary:
- Orders created: X
- Closed normally (paid): X
- Closed normally (cancelled/voided): X
- Required self-healing: X (see incidents below)
- Could not close: X (CRITICAL)
- Tables used: X (all returned to available: yes/no)
```

### Step 5: Financial Reconciliation (REPORT AGENT)
- Sum of all Payment.amount for test orders = daily report total contribution
- Void count matches VoidLog entries
- Tip total matches TipLedger entries
- Inventory deductions match paid item quantities

---

## INCIDENT REPORT FORMAT

Every abnormal event during the test run gets logged as an incident. The final report includes ALL incidents in a dedicated section.

```
### INCIDENT [INC-###]: [Short title]
**Scenario:** [which scenario, e.g., 1.3 Bar Tab Flow]
**Order:** [orderId] (#[orderNumber])
**Severity:** CRITICAL / HIGH / MEDIUM / LOW
**Agent:** [which agent encountered it]

**What Happened:**
[Describe exactly what went wrong — the action attempted, the expected result, the actual result]

**Error Details:**
- API Response: [HTTP status code + error message]
- Order State: [current status, items, totals at time of failure]
- Socket Events: [any relevant events that fired or didn't fire]

**Investigation:**
[What the agent checked to diagnose the problem]
- Checked: [what was checked]
- Found: [what was found]
- Root Cause: [agent's best guess — bug? race condition? test environment? bad data?]

**Resolution:**
- Attempt 1: [what was tried] → [result]
- Attempt 2: [what was tried] → [result]
- Attempt 3: [what was tried] → [result]
- Self-heal: [alternate close path tried] → [succeeded/failed]
- Final state: [order status after all attempts]

**Is This a Bug?**
- [ ] YES — Real product bug (needs fix before release)
- [ ] MAYBE — Could be a bug or test environment issue (needs investigation)
- [ ] NO — Test environment issue only (data setup, timing, etc.)

**Discovery Logged:** DIS-### (if a new test was suggested)
**Time Lost:** [how long the agent spent on this incident]
```

Incidents are categorized in the summary:

| Category | Meaning | Action |
|----------|---------|--------|
| **CRITICAL** | Order could NOT be closed even with self-healing | Block release. Investigate immediately. |
| **HIGH** | Order required self-healing to close | File bug. Likely a real product issue. |
| **MEDIUM** | Unexpected behavior but order closed normally after retry | Log discovery. May need a new test. |
| **LOW** | Minor timing issue or cosmetic problem | Log discovery. Fix when convenient. |

---

## TIMING REQUIREMENTS

Every agent MUST record timestamps for their actions and observations.
At the end, compile a timing report:

| Metric | Target | Actual |
|--------|--------|--------|
| Order created → Socket event | < 100ms | ? |
| Order created → Web UI sees it (API poll) | < 500ms | ? |
| Order created → Android delta sync sees it | < 1000ms | ? |
| Send to kitchen → KDS receives | < 200ms | ? |
| Payment processed → Order disappears from open list | < 300ms | ? |
| Item voided → Totals update on other terminal | < 500ms | ? |
| Split created → Both terminals see splits | < 500ms | ? |
| Concurrent item adds → Both items present | 100% | ? |

Any metric that MISSES the target is a bug to investigate.

---

## FINAL REPORT FORMAT

After all scenarios complete, compile this report in order:

### Section 1: Executive Summary
```
TEST RUN: [date] [time]
BUILD: [git hash]
DURATION: [X minutes]
RESULT: PASS / WARN / FAIL

Orders: X created → X paid, X cancelled, X self-healed, X stuck
Tests: X passed, X failed, X skipped
Incidents: X total (X critical, X high, X medium, X low)
Discoveries: X new test ideas logged
```

### Section 2: Scenario Results
| # | Scenario | Result | Orders Created | Orders Closed | Incidents | Notes |
|---|----------|--------|----------------|---------------|-----------|-------|
For each of the 13 scenarios. Every order accounted for.

### Section 3: Timing Table
| Metric | Target | Actual | Pass? |
For all 8 timing metrics. Flag any misses.

### Section 4: Incident Report
Full incident details for EVERY abnormal event using the INC-### format above.
Grouped by severity: CRITICAL first, then HIGH, MEDIUM, LOW.

### Section 5: Self-Healing Log
| Order | Scenario | Problem | What Was Tried | Result | Time Spent |
For every order that required intervention beyond the normal happy path.

### Section 6: Socket Event Audit
- Missing events (action happened, socket never fired)
- Duplicate events
- Out-of-order events
- Slow events (> 200ms)

### Section 7: Data Integrity Check
- Order totals vs sum of active items
- Payment totals vs order balance
- Report totals vs sum of payments
- Inventory deductions vs recipes × quantities
- Tip allocations vs payment tip amounts

### Section 8: Discoveries
| DIS # | Title | Found In | Suggested Suite | Priority |
List of all new discoveries logged during this run.
"Run `Review Discovered Tests` to approve X new test ideas."

### Section 9: Release Recommendation
Based on all the above:
- **GO** — All P0/P1 pass, no critical incidents, no stuck orders
- **WARN** — Minor issues found, all orders self-healed, review incidents
- **NO-GO** — Critical incidents, stuck orders, or P0 failures

Start with Phase 1, Scenario 1.1. Go.
```

---
```

---
