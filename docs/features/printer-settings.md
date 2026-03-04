# Feature: Printer Settings & Output Formatting

> **Status: PLANNED** — Specced in `docs/skills/SPEC-51-PRINTER-SETTINGS.md`. Basic print routing exists in Hardware. Full formatting configuration not built.

## Summary
Configurable print output formatting for receipts and kitchen tickets. Font size scaling, column width selection, template builders for receipt/kitchen/bar formats, and allergy highlighting rules.

## Status
`Planned` — Basic ESC/POS printing is built (`docs/features/hardware.md`). Full output formatting configuration layer not confirmed built.

## Key Capabilities (from SPEC-51)
- **Font size scaling** — 1-8 scale per section
- **Column width** — 48 or 42 character modes
- **Indentation hierarchy** — 0-3 levels for modifier nesting
- **Template builders** — separate templates for receipt / kitchen / bar tickets
- **Allergy highlighting** — inversion display (white text on black background)
- **Modifier display options** — inline, hierarchical, or collapsed
- **Custom header/footer** — per-printer text blocks

## Dependencies
- **Hardware** (`docs/features/hardware.md`) — builds on existing print infrastructure
- **Orders** — formatting applies to order tickets
- **Menu** — modifier depth affects indentation rules
- **Settings** — printer format settings stored per location/printer

## SPEC Document
`docs/skills/SPEC-51-PRINTER-SETTINGS.md`

*Last updated: 2026-03-03*
