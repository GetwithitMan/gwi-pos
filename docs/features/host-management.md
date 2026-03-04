# Feature: Host Management

> **Status: PLANNED** — Specced in `docs/skills/SPEC-26-HOST-MANAGEMENT.md`. Do NOT implement without a planning session.

## Summary
Host stand dashboard for managing the front-of-house. Shows floor plan status, waitlist, server rotation, and table availability. Fair rotation system ensures equitable table assignments across servers.

## Status
`Planned` — Not yet built. Floor plan and table status exist; host-specific workflow layer does not.

## Key Capabilities (from SPEC-26)
- **Host dashboard** — floor plan view + waitlist + server rotation in one screen
- **Fair rotation engine** — tracks table assignments per server, balances workload
- **Wait time estimation** — based on average turn time per party size
- **Waitlist management** — add walk-ins, text when table ready
- **Section management** — temporarily open/close sections
- **Table combining** — suggest combines for large parties
- **Server rotation queue** — show whose turn is next

## Dependencies (anticipated)
- **Floor Plan** — reads table status
- **Employees** — server rotation, section assignments
- **Reservations** — honor reservations in seating queue
- **Customers** — guest profiles from waitlist

## SPEC Document
`docs/skills/SPEC-26-HOST-MANAGEMENT.md`

*Last updated: 2026-03-03*
