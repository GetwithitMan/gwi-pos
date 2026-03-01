# Test Log — GWI POS

> Running log of all system test runs. Newest entries at the top.
> Each entry is appended automatically by the test orchestrator after a FULL SYSTEM TEST.

---

<!-- APPEND NEW ENTRIES ABOVE THIS LINE -->

## Template (do not edit — orchestrator copies this for each run)

```
---

## Run: YYYY-MM-DD HH:MM
**Build:** [git hash from `git rev-parse --short HEAD`]
**Branch:** [branch name]
**Trigger:** FULL SYSTEM TEST / SYSTEM TEST: [Domain]
**Duration:** X minutes
**Orchestrator:** Claude Code

### Summary

| Suite | Tests | Pass | Fail | Skip | Duration |
|-------|-------|------|------|------|----------|
| 01 Order Lifecycle | | | | | |
| 02 Payments | | | | | |
| 03 Bar Tabs & Pre-Auth | | | | | |
| 04 Splits & Transfers | | | | | |
| 05 Voids, Comps & Discounts | | | | | |
| 06 KDS, Kitchen & Printing | | | | | |
| 07 Tips & Shifts | | | | | |
| 08 Reports | | | | | |
| 09 Inventory | | | | | |
| 10 Sockets, Sync & Performance | | | | | |
| 11 Floor Plan & Tables | | | | | |
| 12 Menu, Modifiers & Entertainment | | | | | |
| 13 Auth, Roles & Permissions | | | | | |
| 14 Customers, Loyalty & Online | | | | | |
| **TOTAL** | **350** | | | | |

### Timing Report

| Metric | Target | Actual | Delta | Pass? |
|--------|--------|--------|-------|-------|
| Order create → DB | < 200ms | | | |
| Order create → Socket | < 100ms | | | |
| Send → KDS receives | < 200ms | | | |
| Payment → Order paid | < 500ms | | | |
| Payment → Inventory deducted | < 2s | | | |
| Payment → Tip allocated | < 1s | | | |
| Payment → Table available | < 500ms | | | |
| Split create → visible | < 500ms | | | |
| Void → Totals recalc | < 300ms | | | |
| Menu cache hit | < 5ms | | | |
| Bootstrap sync | < 3s | | | |
| Delta sync | < 1s | | | |
| API p95 | < 300ms | | | |
| Socket delivery | < 150ms | | | |

### Failures

| # | Suite | Test | Expected | Actual | Severity | Notes |
|---|-------|------|----------|--------|----------|-------|

### Regressions (tests that passed last run but fail now)

| # | Suite | Test | Last Passed | Notes |
|---|-------|------|-------------|-------|

### New Passes (tests that failed last run but pass now)

| # | Suite | Test | Previously Failed | Notes |
|---|-------|------|-------------------|-------|

### Known Issues (pre-existing, not blocking release)

| # | Issue | Since | Tracking |
|---|-------|-------|----------|

### Incidents

| INC # | Scenario | Order | Severity | Problem | Resolution | Bug? |
|-------|----------|-------|----------|---------|------------|------|
| | | | CRITICAL/HIGH/MEDIUM/LOW | | | YES/MAYBE/NO |

_Full incident details in the detailed report section below._

### Self-Healing Log

| Order # | Scenario | Problem | Attempts | Final Close Method | Time Spent |
|---------|----------|---------|----------|-------------------|------------|
| | | | | Normal / Void-all / Close-tab / Could not close | |

**Self-heal summary:** X orders needed intervention. X succeeded, X failed.

### Discoveries (self-learning)

| DIS # | Title | Found In | Suggested Suite | Priority | Status |
|-------|-------|----------|----------------|----------|--------|
| | | | | | pending / approved / rejected |

_Review with: `Review Discovered Tests`_

### Order Lifecycle Summary

```
Orders created:       X
Closed normally:      X (paid: X, cancelled: X)
Self-healed:          X
Could not close:      X (CRITICAL if > 0)
Tables used:          X (all available: yes/no)
```

### Release Decision

- [ ] **GO** — All P0/P1 pass, 0 critical incidents, 0 stuck orders
- [ ] **WARN** — Minor incidents, all self-healed, review before shipping
- [ ] **NO-GO** — Critical incidents, stuck orders, or P0 failures

### Notes

[Observations, warnings, environment details, anything unusual]
```
