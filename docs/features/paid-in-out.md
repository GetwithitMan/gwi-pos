# Feature: Paid In / Paid Out

> **Status: PLANNED** — Specced in `docs/skills/SPEC-46-PAID-IN-OUT.md`. Skill 49 (Cash Drawer) is DONE and may include basic paid-in/out — verify before building.

## Summary
Track non-sale cash movements in and out of the register. Covers vendor COD payments, employee advances, petty cash, tip cash-outs, and miscellaneous refunds. Every movement requires a reason, optional receipt, and approval above configurable thresholds.

## Status
`Planned` — Basic cash drawer support exists. Full paid-in/out workflow with approval and reporting not confirmed built.

## Key Capabilities (from SPEC-46)
- **Paid Out types:** vendor COD, petty cash, employee advance, tip cash-out
- **Paid In types:** cash drops, loan returns, over-ring corrections
- **Approval rules** — amounts above threshold require manager PIN
- **Receipt tracking** — attach photo/notes to each transaction
- **Voucher printing** — ESC/POS receipt for employee/vendor
- **AR/vendor reporting** — track what was paid to which vendor
- **Shift reconciliation** — paid-in/out included in end-of-shift cash count

## Dependencies
- **Cash Drawers** (`docs/features/cash-drawers.md`) — all movements go through drawer
- **Shifts** — paid-in/out included in shift close reconciliation
- **Roles** — threshold-based approval permissions
- **Reports** — paid-in/out line items in cash reports
- **Hardware** — voucher printing

## SPEC Document
`docs/skills/SPEC-46-PAID-IN-OUT.md`

*Last updated: 2026-03-03*
