# Feature: Multi-Location Management

> **Status: PLANNED** — Specced in `docs/skills/SPEC-53-ENTERPRISE-MULTI-LOCATION.md`. Do NOT implement without a planning session — this is a major infrastructure change.

## Summary
Centralized management of 2-200+ locations from Mission Control. Includes menu deployment pipelines, hierarchical role access (corporate → region → district → location), settings inheritance, and cross-location reporting.

## Status
`Planned` — Single-location multi-tenancy is fully built (`locationId` on all models). Multi-location MANAGEMENT layer (menu deployment, hierarchy, cross-location reports) is not built.

## What's Built
- `locationId` on every model (full multi-tenancy support)
- Basic location CRUD in Mission Control
- Settings per location

## What's Planned (SPEC-53)
- **Menu deployment** — push menu changes to subsets of locations (replace / merge / prices-only)
- **Organization hierarchy** — LTREE path: Corporate → Region → District → Location
- **Settings inheritance** — child locations inherit parent settings, can override with locks
- **Location-specific customization limits** — e.g., prices within ±10% of corporate price
- **Employee transfer workflows** — move employees between locations
- **Cross-location reports** — comparison dashboards across fleet

## Dependencies
- **Mission Control** (`docs/features/mission-control.md`) — management layer lives here
- **Settings** — settings inheritance model
- **Menu** — menu deployment pipeline
- **Employees** — cross-location staff management
- **Reports** — cross-location analytics

## SPEC Document
`docs/skills/SPEC-53-ENTERPRISE-MULTI-LOCATION.md`

*Last updated: 2026-03-03*
