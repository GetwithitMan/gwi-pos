# Feature: Auto Discounts & Promotions

> **Status: PLANNED** — Specced in `docs/skills/SPEC-60-AUTO-DISCOUNTS.md`. Do NOT implement without a full planning session — this touches Discounts, Orders, Menu, and Settings broadly.

## Summary
Rule-based automatic discounts that apply to orders without server intervention. Evaluates configured rules in real-time as items are added and applies eligible promotions automatically. Complements manual discounts (`docs/features/discounts.md`).

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-60)
- **BOGO** — buy X get Y free/discounted
- **Quantity discount** — 3+ items → 10% off
- **Mix-and-match bundles** — combine items from different categories
- **Spend threshold** — order over $50 → 15% off
- **Time-based (Happy Hour)** — active during configured time windows
- Real-time rule evaluation on every item add/remove
- Rule priority ordering + stacking exclusions (can't combine happy hour + late night)
- Maximum discount caps per rule
- "Almost there" hints shown to server (e.g., "$4 more for free dessert")

## Dependencies (anticipated)
- **Discounts** — auto-discounts use the same `Discount`/`AppliedDiscount` model
- **Orders** — evaluated on every order mutation
- **Menu** — rules reference menu items/categories
- **Settings** — happy hour schedules configured here
- **Roles** — who can override or disable auto-discounts
- **Reports** — auto-discount totals in discount reports

## Existing Related Features
- Manual discounts: `docs/features/discounts.md`
- Happy Hour (time-based pricing): see `docs/skills/SPEC-16-HAPPY-HOUR.md`

## SPEC Document
`docs/skills/SPEC-60-AUTO-DISCOUNTS.md`

*Last updated: 2026-03-03*
