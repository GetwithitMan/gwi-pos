# Discovered Tests — Approval Queue

> During test runs, agents log new test ideas, edge cases, and unexpected behaviors here.
> Review and approve them to promote into official suites.
>
> **To review:** Say `Review Discovered Tests` in Claude Code.
> **To approve all:** Say `Approve All Discovered Tests`.
> **To approve specific:** Say `Approve Discovered Test DIS-###`.

---

## How Discoveries Get Here

Agents add entries during test runs when they encounter:
- **Unexpected behavior** that isn't covered by an existing test
- **Edge cases** they stumble into (race conditions, null values, boundary amounts)
- **Implicit dependencies** between features that should be explicitly tested
- **Missing coverage** — a code path exists but no test exercises it
- **Regression candidates** — a bug was found and a test should prevent recurrence
- **Performance observations** — a response was unusually slow or fast
- **Data integrity gaps** — DB state that doesn't match expected invariants

Each discovery includes:
- What happened (observation)
- Why it matters (impact)
- Suggested test (steps + verification)
- Which suite it belongs in
- Suggested priority

---

## Approval Workflow

When you say **`Review Discovered Tests`**, Claude will:
1. Read this file
2. Present each pending discovery with context
3. For each, ask: Approve (add to suite), Reject (delete), or Defer (keep for later)

When you **approve** a discovery:
1. Claude generates the full test (number, steps, verify, timing)
2. Appends it to the correct suite file in `docs/tests/suites/`
3. Updates the test count in `docs/tests/TEST-REGISTRY.md`
4. Moves the discovery from "Pending" to "Promoted" below
5. Logs: "DIS-### promoted to [SUITE]-[NUMBER] on [date]"

When you **reject** a discovery:
1. Moved to "Rejected" section with reason
2. Agents won't re-suggest the same pattern

---

## Pending Discoveries

<!-- Agents append new discoveries here using this format:

### DIS-[next number]: [Short title]
**Found during:** [Scenario X.X] on [date]
**Agent:** [which agent found it]
**Observation:** [what happened]
**Impact:** [why it matters — data loss? wrong numbers? UX issue?]
**Suggested suite:** [01-14, which suite file]
**Suggested priority:** [P0/P1/P2]
**Suggested test:**
1. [step]
2. [step]
**Verify:**
- [ ] [assertion]
- [ ] [assertion]
**Timing:** [if applicable]

-->

_No pending discoveries yet. Run a test to generate some._

---

## Promoted (approved → added to suites)

| DIS # | Promoted To | Date | Description |
|-------|-------------|------|-------------|
| | | | |

---

## Rejected

| DIS # | Date | Reason |
|-------|------|--------|
| | | |

---

## Discovery Patterns (agent reference)

Agents should look for these patterns during test runs:

### Data Integrity
- Order totals that don't equal sum of active items
- Payment amounts that don't match order balance
- Inventory deductions that don't match recipe × quantity
- Tip allocations that don't sum to payment tip amount
- Split check totals that don't sum to parent total

### Race Conditions
- Two terminals modifying the same order simultaneously
- Payment processed while items still being added
- Tab closed while another terminal is adding items
- Void request while payment is in progress
- Split created while order is being edited

### Boundary Values
- $0.01 payments (minimum)
- $99,999.99 payments (maximum)
- 0 quantity items
- Negative adjustments
- Empty modifier groups
- Orders with 50+ items (stress)
- 10+ splits on one order

### State Transitions
- Invalid status transitions (paid → open without reopen)
- Double-close (pay already-paid order)
- Void after payment vs void before payment
- Reopen → void all items → auto-cancel (reopen + cancel chain)
- Split → void all items on one split → parent recalculation

### Timing
- API responses > 500ms (flag as slow)
- Socket events > 200ms after action (flag as delayed)
- Database writes > 100ms (flag as slow query)
- Any operation that blocks the UI thread

### Missing Events
- Action completed but socket event never fired
- Socket event fired but with wrong payload
- Socket event fired twice (duplicate)
- Socket event fired to wrong room/tag

### Cross-Feature Interactions
- Discount + tip calculation
- Split + discount + tip
- Void + inventory + report
- Course firing + KDS + print routing
- Entertainment timer + payment + inventory
- Gift card + split payment + tip
- House account + credit limit + partial payment
- Pre-auth + tip adjust + capture amount mismatch
