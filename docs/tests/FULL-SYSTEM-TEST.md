# FULL SYSTEM TEST — Agent Team Prompt

> **Trigger:** Open Claude Code in the `gwi-pos` directory and say:
> ```
> FULL SYSTEM TEST
> ```
> Or run a single domain:
> ```
> SYSTEM TEST: Payments
> SYSTEM TEST: Tips
> SYSTEM TEST: KDS
> SYSTEM TEST: Reports
> ```

---

## The Prompt

Copy everything below the line:

---

```
PM Mode: Full System Test (Agent Team)

We are running a FULL SYSTEM TEST — a comprehensive regression test of every feature in the GWI POS system. This is run before every release to verify everything works end-to-end.

Read these files for context:
- docs/tests/TEST-REGISTRY.md (master index of all 14 test suites)
- docs/tests/TEST-LOG.md (running log — append results at the bottom)
- docs/tests/DISCOVERED-TESTS.md (self-learning discovery queue)
- CLAUDE.md (system architecture)

## SELF-LEARNING DISCOVERY RULES

Every agent is a test discoverer. While executing tests, ALL agents watch for:
- Unexpected behavior not covered by existing tests
- Edge cases (race conditions, null values, boundary amounts, empty states)
- Implicit feature dependencies that should be explicitly tested
- Missing/duplicate/delayed socket events
- Slow responses (API > 500ms, socket > 200ms)
- Data integrity gaps (totals don't add up, missing records)
- Cross-feature interactions nobody thought to test

When an agent finds something new:
1. Keep executing the current test (don't stop)
2. Append the discovery to docs/tests/DISCOVERED-TESTS.md:
   ```
   ### DIS-[next number]: [Short title]
   **Found during:** [Suite ##, Test XXX-##] on [date]
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
3. Continue with the next test

After the run, the final report includes a discovery count.
User reviews with `Review Discovered Tests` and approves into official suites.

## SELF-HEALING & INCIDENT RULES

Every test that creates an order MUST close it. If closing fails:

1. **Retry** up to 3 times with 2-second delays
2. **Diagnose** — GET the order, check status, items, balance, pre-auth, splits
3. **Alternate close** — try voiding all items, close-tab, pay children first, etc.
4. **Log incident** with full details:
   - What was tried (each attempt with response codes)
   - What worked or didn't
   - Root cause guess (real bug vs test issue)
   - Severity: CRITICAL (can't close) / HIGH (needed self-heal) / MEDIUM (retry worked) / LOW (cosmetic)
5. **Log discovery** — the failure likely means a missing test case
6. **Continue** — never block the entire test run on one stuck order

The final report includes:
- **Incident Report** — every abnormal event with full diagnosis
- **Self-Healing Log** — which orders needed intervention and what fixed them
- **Release Recommendation** — GO / WARN / NO-GO based on incident severity

## TEST TEAM (9 agents)

### ORCHESTRATOR (you — team lead)
- Spawns all agents
- Tracks progress via TodoWrite
- Compiles final report with incident details
- Appends results to TEST-LOG.md

### Agent 1: ORDER AGENT
- Reads: docs/tests/suites/01-order-lifecycle.md
- Tests: Create, update, send, reopen, cancel, transfer orders
- Endpoints: POST/GET/PUT/PATCH /api/orders/*, POST /api/orders/[id]/send, /reopen
- Verifies: DB state, socket events, cross-terminal visibility

### Agent 2: PAYMENT AGENT
- Reads: docs/tests/suites/02-payments.md
- Tests: Cash, card, split payment, gift card, house account, rounding, $0 orders
- Endpoints: POST /api/orders/[id]/pay, /api/datacap/*
- Verifies: Payment records, order status, inventory deduction, tip allocation

### Agent 3: TAB & SPLIT AGENT
- Reads: docs/tests/suites/03-bar-tabs-preauth.md + docs/tests/suites/04-splits-transfers.md
- Tests: Pre-auth, capture, void tab, walkout, even split, custom split, transfers, merge
- Endpoints: /api/orders/[id]/pre-auth, /split-tickets, /transfer-items, /close-tab
- Verifies: Split hierarchy, parent auto-close, pre-auth lifecycle

### Agent 4: VOID & DISCOUNT AGENT
- Reads: docs/tests/suites/05-voids-comps-discounts.md
- Tests: Void items, comp items, approval workflow, order/item discounts, coupons
- Endpoints: /api/orders/[id]/comp-void, /discount, /api/discounts, /api/coupons
- Verifies: VoidLog, totals recalc, inventory waste, Datacap reversal

### Agent 5: KDS & PRINT AGENT
- Reads: docs/tests/suites/06-kds-kitchen-printing.md
- Tests: Kitchen routing, status flow, bumping, courses, expo, print routing, receipts
- Endpoints: GET /api/kds, POST /api/print/*, PUT /api/orders/[id]/items/[itemId]
- Verifies: Station routing, tag matching, printer failover, ESC/POS output

### Agent 6: TIP & SHIFT AGENT
- Reads: docs/tests/suites/07-tips-shifts.md
- Tests: Tip allocation, tip groups, tip sharing rules, shift close, drawer counts
- Endpoints: /api/tips/*, /api/shifts/*, /api/time-clock
- Verifies: TipLedger records, tip group distribution, shift variance

### Agent 7: REPORT AGENT
- Reads: docs/tests/suites/08-reports.md
- Tests: All 33 report endpoints — cross-references actual DB data
- Endpoints: GET /api/reports/*
- Verifies: Totals match sum of payments, item counts match PMIX, void counts match VoidLog

### Agent 8: INFRASTRUCTURE AGENT
- Reads: docs/tests/suites/09-inventory.md + 10-sockets-sync-performance.md + 13-auth-roles-permissions.md
- Tests: Inventory deduction, socket events, sync timing, latency, cache, auth, permissions
- Verifies: All socket events fire, latency < targets, cache TTL works, role checks enforce

### Agent 9: FEATURE AGENT
- Reads: docs/tests/suites/11-floor-plan-tables.md + 12-menu-modifiers-entertainment.md + 14-customers-loyalty-online.md
- Tests: Floor plan, menu cache, modifiers, entertainment, customers, loyalty, gift cards, online orders
- Verifies: Table status sync, menu cache invalidation, modifier stacking, timer accuracy

---

## EXECUTION ORDER

### Phase 1: Setup (Agent 8 — Infrastructure)
1. Verify NUC is running (GET /api/health or similar)
2. Verify Socket.io is connected
3. Verify DB is reachable (simple query)
4. Record baseline: employee count, menu item count, table count
5. Auth test: all 3 demo PINs work (1234, 2345, 3456)

### Phase 2: Core Order Flow (Agents 1, 5 in parallel)
1. ORDER AGENT: Create → add items → send → kitchen flow
2. KDS AGENT: Verify kitchen receives, process items through status flow
3. Both record timestamps at every step

### Phase 3: Payment & Financial (Agents 2, 3, 4 in parallel)
1. PAYMENT AGENT: Pay orders from Phase 2 + create new ones for each payment scenario
2. TAB & SPLIT AGENT: Bar tab lifecycle + split check lifecycle
3. VOID & DISCOUNT AGENT: Void/comp on new orders + discount scenarios

### Phase 4: Tips & Shifts (Agent 6)
1. Verify tip allocation from Phase 3 payments
2. Test tip group creation and distribution
3. Shift close workflow with drawer counts

### Phase 5: Reports (Agent 7)
1. Pull ALL reports
2. Cross-reference every number against Phase 2-4 data
3. Flag any discrepancy

### Phase 6: Features (Agent 9)
1. Floor plan verification
2. Menu cache tests
3. Entertainment/timed rental
4. Customer/loyalty/gift card/online

### Phase 7: Final Report (Orchestrator)
1. Collect all agent results
2. Compile pass/fail table
3. Compile timing table
4. Collect all discoveries from docs/tests/DISCOVERED-TESTS.md
5. Append to TEST-LOG.md with date + build hash
6. Print summary to user including discovery count
7. Prompt: "X new test discoveries logged. Run `Review Discovered Tests` to approve them."

---

## TIMING TARGETS (mandatory measurements)

| Metric | Target | Category |
|--------|--------|----------|
| Order create → DB confirmed | < 200ms | Order |
| Order create → Socket fires | < 100ms | Socket |
| Send to kitchen → KDS receives | < 200ms | KDS |
| Item status change → Socket fires | < 100ms | Socket |
| Payment → Order status=paid | < 500ms | Payment |
| Payment → Inventory deducted | < 2000ms | Inventory |
| Payment → Tip allocated | < 1000ms | Tips |
| Payment → Table available | < 500ms | Floor Plan |
| Payment → Open orders updated | < 300ms | Socket |
| Split create → Both terminals see | < 500ms | Splits |
| Void item → Totals recalculated | < 300ms | Voids |
| Menu cache hit | < 5ms | Performance |
| Menu cache miss (DB query) | < 200ms | Performance |
| Bootstrap sync (Android) | < 3000ms | Sync |
| Delta sync (Android) | < 1000ms | Sync |
| API response (95th percentile) | < 300ms | Performance |
| Socket event delivery | < 150ms | Socket |

---

## RESULT FORMAT

Each agent returns a structured report:

```
## [Suite Name] Results
**Run:** 2026-MM-DD HH:MM
**Build:** [git hash]
**Duration:** X minutes

### Summary
- Total tests: N
- Passed: N
- Failed: N
- Skipped: N

### Failures (if any)
| # | Test | Expected | Actual | Severity |
|---|------|----------|--------|----------|

### Timing
| Metric | Target | Actual | Pass? |
|--------|--------|--------|-------|

### Notes
[Any observations, warnings, or recommendations]
```

The orchestrator compiles all agent reports into one master report and appends to TEST-LOG.md.

Start with Phase 1. Go.
```
