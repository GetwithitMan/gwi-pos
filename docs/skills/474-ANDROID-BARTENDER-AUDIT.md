# Skill 474 — Android Bartender Audit v2

**Date:** 2026-03-03
**Repos affected:** `gwi-android-register`, `gwi-pos`
**Status:** DONE — findings documented, remediation completed (see Skill 478)

---

## What Was Done

Full front-end simulation audit of the Android bartender flow. 5 parallel agents walked every critical user journey: order creation, modifiers, spirits, payment, splits, tabs, shift close, and tips. 32 findings documented and triaged.

**Audit saved to:** `docs/planning/ANDROID-AUDIT-TODO.md`
**Remediation:** `docs/skills/478-ANDROID-AUDIT-REMEDIATION.md`
**Closure note:** `docs/planning/AUDIT-CLOSURE-2026-03-03.md`
**Regression guards:** `docs/planning/AUDIT_REGRESSION.md`

---

## Finding Summary

| Severity | Count | Key Issues |
|----------|-------|-----------|
| 🔴 Critical | 5 | Pay with unsent items; partial payment loss; clock-out deadlock; no force-close |
| 🟠 High | 10 | Shift close blocked; pending tips not surfaced; spirit/modifier dismiss race; missing active tab indicator |
| 🟡 Medium | 13 | $0 order; qty cap; tip cap; shift-scoped tips; edit boundary; split warnings; process death; debounce |
| ⚪ Low | 4 | Nickname cap; modifier auto-select; tips empty state; tab loading indicator |

---

## Critical Findings (C1–C5)

| ID | Title | Risk |
|----|-------|------|
| C1 | Pay order with unsent kitchen items | Customer charged without kitchen notified |
| C2 | Voided items NOT subtracted from total | (Removed — not a bug; totals recalculated correctly) |
| C3 | Half-paid cash order can be abandoned | Partial payment lost on crash/dismiss |
| C4 | Clock out with open orders = deadlock | No recovery path once deadlock occurs |
| C5 | No manager override / force close | Employees bricked; no escalation path |

---

## High Findings (H1–H10)

| ID | Title |
|----|-------|
| H1 | Pending tips and shift close disconnected |
| H2 | No active tab indicator in tab list |
| H3 | Close Tab sheet doesn't show pre-auth hold amount |
| H4 | Duplicate card detection missing |
| H5 | Spirit selection scrim-dismiss is silent |
| H6 | Modifier sheet swipe-dismiss loses work silently |
| H7 | No Edit button for unsent modified items |
| H8 | Race condition: clock-out during active card payment |
| H9 | Adding items to paid split corrupts local state |
| H10 | Shift summary shows no blockers before API rejects |

---

## Notes

- C2 removed after verification: `recomputeTotals()` fires correctly after `COMP_VOID_APPLIED`.
- M9 (multi-tier spirit stacking) deferred by design: tiers are intentionally mutually exclusive per product decision.
- All other findings implemented — see Skill 478.
