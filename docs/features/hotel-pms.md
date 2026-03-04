# Feature: Hotel PMS Integration

> **Status: PLANNED** — Specced in `docs/skills/SPEC-57-HOTEL-PMS.md`. Do NOT implement without a planning session.

## Summary
Connects GWI POS to hotel property management systems (Opera, Mews, Cloudbeds, etc.). Guests charge F&B to their room, the charge posts to their folio, and a daily reconciliation report closes the loop.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-57)
- **Room lookup** — type room number, verify guest identity
- **Charge posting** — post order total to room folio via PMS API
- **Automatic retry** — 3 attempts, 5-minute interval on failure
- **Failed posting queue** — manager view of failed postings with manual retry
- **Guest credit limit** — enforce PMS-set limit before posting
- **Signature capture** — capture signature for charges above threshold
- **Daily reconciliation** — report matching POS charges to PMS folio entries
- **Multi-outlet routing** — different outlet codes (REST/BAR/IRS/POOL/MINI)

## Supported PMS Platforms
Opera, Mews, Cloudbeds, Protel, StayNTouch, generic HTNG 2.0

## Dependencies (anticipated)
- **Payments** — room charge is a tender type
- **Orders** — charge applied at order close
- **Hardware** — signature capture device
- **Settings** — PMS configuration, outlet codes, credit thresholds
- **Reports** — daily reconciliation report

## SPEC Document
`docs/skills/SPEC-57-HOTEL-PMS.md`

*Last updated: 2026-03-03*
