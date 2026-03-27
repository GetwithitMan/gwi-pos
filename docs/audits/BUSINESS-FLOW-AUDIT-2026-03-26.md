# Business Flow Audit — 2026-03-26

**Scope:** 7 end-to-end business journeys traced through complete code paths
**Method:** 7 parallel agents, each reading feature docs then tracing every function call
**Finding:** 78 total gaps across all flows

---

## Findings Summary By Flow

| Flow | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Tab Lifecycle | 5 | 3 | 1 | 0 | 9 |
| Shift Close + Tips | 3 | 2 | 7 | 3 | 15 |
| Split Check | 5 | 4 | 2 | 3 | 14 |
| SAF + Offline | 5 | 4 | 6 | 0 | 15 |
| Android Sync | 2 | 5 | 4 | 4 | 15 |
| Online + Delivery | 2 | 3 | 4 | 2 | 11 |
| Entertainment + PMS + EOD | 2 | 3 | 4 | 3 | 12 |
| **Total** | **24** | **24** | **28** | **15** | **91** |

---

## TOP 15 MOST CRITICAL ISSUES (Fix Immediately)

### Financial Risk — Double Charges & Lost Revenue

| # | Flow | Issue | Impact |
|---|---|---|---|
| 1 | SAF | SAF + online retry can BOTH charge (no cross-check) | Customer charged twice |
| 2 | Tab | Fire-and-forget tip allocation — tips captured but never posted to ledger | Lost employee tips |
| 3 | Tab | No automatic walkout retry scheduler | Revenue lost when card holds expire |
| 4 | Split | `recalculateParentOrderTotals()` called but never defined | Parent totals permanently wrong |
| 5 | SAF | SAF forward succeeds at reader but fails at DB | Payment data lost |
| 6 | SAF | SAF void path NOT implemented (documented but no code) | Can't void SAF transactions |

### Data Integrity — Corrupt State

| # | Flow | Issue | Impact |
|---|---|---|---|
| 7 | Android | No transaction isolation on concurrent event ingestion | Unique constraint crashes |
| 8 | Android | Sequence gaps not detected in event replay | Corrupt order state |
| 9 | Split | Item-split doesn't re-validate order status inside FOR UPDATE | Can split closed orders |
| 10 | Shift | Pending tips checked OUTSIDE transaction (TOCTOU race) | Shift closes with $0-tip payments |

### Operational — Stuck/Lost Orders

| # | Flow | Issue | Impact |
|---|---|---|---|
| 11 | Online | Orders stuck in "received" if dispatch worker down (no timeout) | Customer never gets food |
| 12 | Online | DeliveryOrder insert failure silently swallowed | Payment taken, delivery never dispatched |
| 13 | Tab | Zombie "closing" state stuck for 60 seconds | Customer checkout blocked |
| 14 | Entertainment | No auto-expiry for timed sessions | Equipment locked indefinitely |
| 15 | Tab | Ambiguous capture state on Datacap timeout | Unknown payment status |

---

## DETAILED FINDINGS BY FLOW

### Tab Lifecycle (9 gaps)
- T1 CRITICAL: Zombie "closing" 60s threshold
- T2 CRITICAL: Ambiguous capture on timeout
- T3 CRITICAL: Fire-and-forget tip allocation
- T4 CRITICAL: Capture + allocation not atomic
- T5 CRITICAL: No auto walkout retry scheduler
- T6 HIGH: Partial card release on $0 tab
- T7 HIGH: No auto payroll scheduler
- T8 HIGH: Socket events not queued on close (outbox used at open but not close)
- T9 MEDIUM: Cloud sync divergence during outage

### Shift Close + Tips (15 gaps)
- S1 HIGH: Pending tips TOCTOU race (checked outside transaction)
- S2 HIGH: Asymmetric guards (open orders in tx, pending tips outside)
- S3 HIGH: Fire-and-forget tip allocation races with void
- S4 MED-HIGH: Tip-out rules fetched at close, not captured at open
- S5 MED-HIGH: Commissions not recalculated at close
- S6-S15: Crash recovery, ledger immutability, group orphaning, cash declarations, payroll idempotency, shift:closed event, tip debt write-off, distribution summary, cash variance audit

### Split Check (14 gaps)
- SP1 CRITICAL: recalculateParentOrderTotals() undefined
- SP2 CRITICAL: Even split itemCount=0
- SP3 CRITICAL: Donation lost on 2nd item split
- SP4 CRITICAL: Parent totals drift when items added to child
- SP5 HIGH: Item-split no status re-validation
- SP6 HIGH: Pre-auth block misses pending_auth
- SP7 HIGH: Auto-gratuity per-split not parent
- SP8 HIGH: Pay-all-splits races with individual payment
- SP9-SP14: Discount distribution, inclusive tax, Neon sync docs, parent auto-close event, unsplit capability

### SAF + Offline (15 gaps)
- SAF1 CRITICAL: SAF void not implemented
- SAF2 CRITICAL: SAF + retry double-charge
- SAF3 CRITICAL: Forward success at reader, fail at DB
- SAF4 CRITICAL: Outage queue overflow not checked at payment
- SAF5 CRITICAL: Declined SAF on forward — no recovery
- SAF6 HIGH: Duplicate forward race condition
- SAF7 HIGH: No 24-hour expiration enforcement
- SAF8 HIGH: Orders lost if queue overflows during extended outage
- SAF9 HIGH: No max offline duration enforcement
- SAF10-SAF15: Statistics silent fail, reconciliation report missing, auto-forward missing, CFD tip bypass, outage detection hysteresis, NUC restart SAF sync

### Android Sync + Event Sourcing (15 gaps)
- A1 CRITICAL: No transaction isolation on concurrent events
- A2 CRITICAL: Sequence gaps not detected
- A3 HIGH: deviceCounter hardcoded to 0
- A4 HIGH: EventID uniqueness TOCTOU race
- A5 HIGH: Closed order mutations silently ignored
- A6 HIGH: Bootstrap missing lastEventSequence
- A7 HIGH: Offline outbox events fire-and-forget (violates event-sourced invariant)
- A8-A15: Socket broadcast timing, max queue size, delta sync watermark, dedup race, permissions per-event, order number rewrite, event type count, snapshot upsert validation, bootstrap cache

### Online + Delivery (11 gaps)
- O1 CRITICAL: Orders stuck in "received" forever (no timeout)
- O2 CRITICAL: DeliveryOrder insert fails silently
- O3 HIGH: No timeout for unaccepted deliveries
- O4 HIGH: Zone matching only ZIP (no radius/polygon)
- O5 HIGH: Offline NUC delays kitchen receipt
- O6-O11: Menu sync, venue hours enforcement, address snapshot, gift card+delivery, coupon validation, alerting

### Entertainment + PMS + EOD (12 gaps)
- E1 CRITICAL: No auto-expiry cron for entertainment sessions
- E2 CRITICAL: OPERA charge succeeds but DB fails (manual reconciliation only)
- E3 HIGH: Per-minute billing not wired
- E4 HIGH: Waitlist no-show deadlock (no timeout)
- E5 HIGH: EOD batch close can miss window
- E6-E12: Selection tokens in-memory, overtime untested, session not ended on order close, EOD charge recalc, stale orders not auto-closed, EOD not reversible, monitoring gaps

---

## FIX PRIORITY

### Week 1: Financial Safety (stop bleeding money)
1. Add pending tips check INSIDE shift close transaction (S1+S2)
2. Make tip allocation durable (outage queue or in-transaction) (T3+T4)
3. Implement auto walkout retry cron (T5)
4. Fix SAF + online retry dedup (SAF2)
5. Implement SAF void path (SAF1)
6. Define recalculateParentOrderTotals (SP1)

### Week 2: Data Integrity (stop corrupt state)
7. Wrap Android event ingestion in transaction (A1)
8. Add sequence gap detection (A2)
9. Use INSERT ON CONFLICT for event idempotency (A4)
10. Add item-split status re-validation (SP5)
11. Add stuck online order timeout cron (O1)
12. Make DeliveryOrder creation transactional (O2)

### Week 3: Operational (stop stuck flows)
13. Add entertainment auto-expiry cron (E1)
14. Reduce zombie threshold to 15s (T1)
15. Add PMS auto-reconciliation (E2)
16. Add bootstrap lastEventSequence (A6)
17. Move offline outbox events into transaction (A7)
18. Add delivery order timeout (O3)
