# Feature: Live Dashboard

> **Status: PLANNED** — Specced in `docs/skills/SPEC-22-LIVE-DASHBOARD.md`. Do NOT implement without a planning session.

## Summary
Real-time operational visibility screen — always-on display showing live sales, table status, kitchen performance, labor %, and alerts. Widget-based layout customizable per location. Can be shown on dedicated monitor or accessed on mobile.

## Status
`Planned` — Not yet built. Reports exist (`docs/features/reports.md`) but are pull-based, not live push.

## Key Capabilities (from SPEC-22)
- **Live sales counter** — running total for the business day
- **Labor %** — real-time clocked-in labor cost vs revenue
- **Table status** — open/occupied/check-dropped overview
- **Kitchen performance** — average ticket time, late tickets
- **Alert feed** — voids, manager overrides, offline events
- **Historical comparison** — "vs same day last week"
- **Widget customization** — choose which metrics to display
- **Mobile view** — owner can check on phone

## Dependencies (anticipated)
- **Reports** — reads from same data sources
- **Orders** — live order count and status
- **Payments** — running sales total
- **Employees** — clocked-in labor cost
- **KDS** — kitchen performance metrics
- **Socket** — WebSocket-driven real-time updates

## SPEC Document
`docs/skills/SPEC-22-LIVE-DASHBOARD.md`

*Last updated: 2026-03-03*
