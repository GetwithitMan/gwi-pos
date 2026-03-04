# Feature: Commissioned Items

> **Status: PLANNED** — Specced in `docs/skills/SPEC-29-COMMISSIONED-ITEMS.md`. Skill 29 (DONE) in SKILLS-INDEX may have a basic version — verify before building.

## Summary
Commission tracking on item sales. Configure flat-dollar or percentage commissions per menu item or category, accrue them to the selling employee's commission ledger, and manage payouts through an approval workflow.

## Status
`Planned` — Skill 29 is marked DONE in the skills index but no API routes or Prisma models were found during audit. Verify actual implementation status before building.

## Key Capabilities (from SPEC-29)
- **Commission rates** — flat $ or % per item/category, tiered by volume
- **Real-time accrual** — commission posted to employee ledger at payment time
- **Approval workflow** — manager approves commission payouts
- **Commission ledger** — per-employee running balance (similar to TipLedger)
- **Payout management** — batch or individual commission payouts
- **Sales contest tracking** — leaderboard for commission-based competitions

## Dependencies (anticipated)
- **Menu** — commission rates configured per item/category
- **Employees** — ledger per employee
- **Payments** — accrual triggered at payment time
- **Reports** — commission reports, payout history
- **Roles** — who can configure rates, approve payouts

## SPEC Document
`docs/skills/SPEC-29-COMMISSIONED-ITEMS.md`

*Last updated: 2026-03-03*
