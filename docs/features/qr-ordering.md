# Feature: QR Code Self-Ordering

> **Status: PLANNED** — Specced in `docs/skills/SPEC-54-QR-SELF-ORDERING.md`. Do NOT implement without a planning session — requires a separate payment gateway (NOT Datacap) for guest checkout.

## Summary
Guests scan a QR code at their table with a smartphone, browse the menu, build their order, and pay — all without server interaction. Orders appear in the POS for server approval before going to the kitchen.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-54)
- **Table-specific QR codes** — each table/seat gets a unique QR
- **Mobile menu browsing** — full menu with photos and modifiers
- **Cart management** — add/remove/customize items
- **Server approval workflow** — orders hold for server review before kitchen
- **Auto-accept option** — bypass approval for trusted tables
- **Guest payment** — Apple Pay, Google Pay, card (NOT Datacap)
- **Reorder window** — scan again within 2 hours to add more
- **Split payment UI** — multiple guests pay individually

## ⚠️ Critical Note
Guest checkout uses a DIFFERENT payment gateway than Datacap (Stripe or similar for web). Do NOT attempt to route QR orders through the Datacap hardware stack.

## Dependencies (anticipated)
- **Menu** — QR menu is a mobile view of POS menu
- **Orders** — QR orders become standard POS orders
- **Payments** — SEPARATE payment processor for web checkout (not Datacap)
- **Floor Plan** — table-specific QR code generation
- **Settings** — enable/disable, auto-accept, payment configuration

## SPEC Document
`docs/skills/SPEC-54-QR-SELF-ORDERING.md`

*Last updated: 2026-03-03*
