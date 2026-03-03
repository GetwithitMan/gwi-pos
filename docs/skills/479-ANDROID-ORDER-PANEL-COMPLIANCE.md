# Skill 479 — Android Order Panel Compliance Audit

**Date:** 2026-03-03
**Scope:** Android `OrderTotalsSection.kt` vs Web POS `OrderPanelActions.tsx`
**Result:** 2 structural fixes applied; all DP1–DP4 invariants confirmed passing

---

## What Was Done

Full forensic audit of the Android POS order panel (tap item → order panel → tender → cash payment) against the Web POS reference implementation and Dual Pricing Invariants DP1–DP4.

### Phase 0 — Guardrail Docs
- Read `AUDIT_REGRESSION.md`, `docs/features/orders.md`, `docs/features/payments.md`, `docs/skills/SPEC-31-DUAL-PRICING.md`, `docs/planning/KNOWN-BUGS.md`
- Confirmed DP4 was missing from `AUDIT_REGRESSION.md` (added in Phase 4)

### Phase 1 — Web POS Reference Mapping
- File: `src/components/orders/OrderPanelActions.tsx` (commit cebed10)
- Dual pricing expanded row order: Subtotal (cardSub) → Discounts? → Tax (cardTax) → Card Total (bold green, borderTop) → Cash breakdown with left-indent (Cash Total + Cash Subtotal + Cash Tax) → Savings msg
- All values from `usePricing` props — no local recalculation
- Savings message INSIDE the collapsed section (only shown when expanded)

### Phase 2 — Android Forensics
- File: `ui/pos/components/OrderTotalsSection.kt`
- Inline computations: `cardTotal = total + surchargeTotal`, `cardSubtotal = cashNetSubtotal × (1 + pct/100)`, `cardTax = cardTotal - cardSubtotal`
- All read from the same `OrderUiState` (same snapshot per recomposition) — DP4 code smell but no actual divergence
- `OrderState` has no `cardTotal`/`cashTotal` fields — these are UI derivations only

### Phase 3 — Changes Applied

**File: `OrderTotalsSection.kt`**

| Change | Reason |
|--------|--------|
| Removed `HorizontalDivider` between Card Total and Cash breakdown | Web POS uses `marginTop: 8px` + left-indent padding, not a horizontal divider |
| Replaced with `Spacer(8dp)` + `padding(start = 8dp)` on Cash Total | Matches Web POS spacing/indentation |
| Cash Subtotal/Cash Tax indent: 12dp → 20dp | Matches Web POS nested indent style |
| Moved "Save $X by paying with cash!" inside `AnimatedVisibility` | Web POS only shows it when totals are expanded; previously always visible on Android |

### Phase 4 — Docs Updated
- `AUDIT_REGRESSION.md`: Added DP4 invariant (was confirmed missing)
- `docs/logs/LIVING-LOG.md`: Session entry added

---

## Mismatch Table (Final)

| # | Web POS | Android (before) | Android (after) |
|---|---------|------|------|
| D1 | Subtotal = cardSub | Subtotal = cardSubtotal | UNCHANGED — MATCH |
| D2 | Discounts (cond.) | Discounts (cond.) | UNCHANGED — MATCH |
| D3 | Tax (N%) = cardTax | Tax (N%) = cardTax | UNCHANGED — MATCH |
| D4 | Card Total (bold green, borderTop) | Card Total (bold green, HorizontalDivider above) | UNCHANGED — visual equiv |
| D5 | Cash section: left-indent, no divider | HorizontalDivider + Cash Total | FIXED — removed divider, added indent |
| D6 | Cash Total | Cash Total | UNCHANGED — MATCH |
| D7 | Cash Subtotal (8px indent) | Cash Subtotal (12dp indent) | FIXED — 20dp indent |
| D8 | Cash Tax (8px indent) | Cash Tax (12dp indent) | FIXED — 20dp indent |
| D9 | Savings msg inside expanded section | Savings msg always visible (outside AnimatedVisibility) | FIXED — moved inside |

---

## Risk Flags (Final)

| ID | Level | Status |
|---|---|---|
| R1 — Extra divider | LOW | FIXED |
| R2 — Savings msg placement | MEDIUM | FIXED |
| R3 — Inline DP4 derivations | INFO | ACCEPTED (same source, no divergence) |
| R4 — DP4 missing from registry | INFO | FIXED (added to AUDIT_REGRESSION.md) |
| R5 — False DP3 flag on savings msg | FALSE POSITIVE | DOCUMENTED |

---

## Key Files

| File | Role |
|------|------|
| `ui/pos/components/OrderTotalsSection.kt` | Android order panel totals (MODIFIED) |
| `ui/pos/components/SendButtonRow.kt` | Android payment action buttons (no changes needed) |
| `ui/pos/components/PaymentSheet.kt` | Android tender/cash sheet (no changes needed) |
| `src/components/orders/OrderPanelActions.tsx` | Web POS reference (read-only) |
| `docs/planning/AUDIT_REGRESSION.md` | DP4 added |

---

## Invariants Verified

| Invariant | Result |
|-----------|--------|
| DP1: cardTotal = cashTotal × (1 + pct/100) POST-TAX | PASS — math unchanged, verified same formula |
| DP2: surcharge base = order.total (post-tax), not subtotal | PASS — math unchanged |
| DP3: No forbidden surcharge labels | PASS — "Card Total", "Cash Total" only |
| DP4: All screens derive from same source | PASS — OrderUiState is the single source for all three composables |
