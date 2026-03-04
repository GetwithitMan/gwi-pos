# Feature: Repeat Orders

> **Status: PLANNED** — Specced in `docs/skills/SPEC-47-REPEAT-ORDERS.md`. Do NOT implement without a planning session.

## Summary
One-tap reordering for high-volume bars and repeat customers. Allows servers to repeat the last item, repeat a "round" (items ordered together within a time window), or reorder specific items — with modifiers preserved.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-47)
- **Repeat last item** — one tap to re-add the most recent item with same modifiers
- **Repeat round** — re-add a group of items ordered within a 60-second window
- **Repeat selected** — choose specific items from order history to repeat
- **Quick combos** — save multi-item combinations as a single fast-access button
- **Keyboard shortcuts** — R for repeat last, Shift+R for repeat round
- **Price updates on repeat** — uses current price, not original price
- **Modifier preservation** — repeats exact modifier selections

## Dependencies (anticipated)
- **Orders** — adds items to current order
- **Menu** — verifies item still exists and is available
- **Settings** — enable/disable per location

## SPEC Document
`docs/skills/SPEC-47-REPEAT-ORDERS.md`

*Last updated: 2026-03-03*
