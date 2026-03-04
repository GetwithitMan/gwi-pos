# Feature: Staff Training Mode

> **Status: PLANNED** — Specced in `docs/skills/SPEC-21-STAFF-TRAINING.md`. Note: Training orders are partially supported (isTraining flag on Order, filtered from reports). Full training mode sandbox not built.

## Summary
Safe sandbox environment for employee training. All actions look real but are flagged as training — orders don't affect inventory, payments are simulated, and tips don't post to ledgers. Includes guided tutorials and skill assessments.

## Status
`Planned` — `Order.isTraining` flag exists and training orders are filtered from reports. Full training mode UI, tutorials, and assessment engine not built.

## Key Capabilities (from SPEC-21)
- **Training mode toggle** — manager enables per-terminal or per-session
- **Guided tutorials** — step-by-step workflows for new employees
- **Skill assessments** — test employee knowledge with scoring
- **Certification tracking** — record when employees pass training milestones
- **Safe simulation** — orders, payments, tips all simulated (no real effects)
- **Manager oversight** — view trainee progress in real time

## Existing Partial Implementation
- `Order.isTraining` flag exists in Prisma schema
- Training orders excluded from reports by default
- Simulated payment reader: `/api/simulated-reader/*` (test mode)

## Dependencies (anticipated)
- **Orders** — isTraining flag must propagate through all order mutations
- **Payments** — simulated payment mode
- **Settings** — enable/disable training mode per location
- **Employees** — certification records per employee

## SPEC Document
`docs/skills/SPEC-21-STAFF-TRAINING.md`

*Last updated: 2026-03-03*
