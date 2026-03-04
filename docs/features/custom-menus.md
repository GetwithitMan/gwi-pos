# Feature: Custom Menus / Personal Layouts

> **Status: PLANNED** — Specced in `docs/skills/SPEC-43-CUSTOM-MENUS.md`. Do NOT implement without a planning session.

## Summary
Per-employee menu customization. Each server or bartender can reorder categories, pin fast-access items, hide unused menu sections, and adjust layout appearance. Syncs their personal layout across all terminals they log into.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-43)
- **Personal fast-bar** — pin most-ordered items to a quick-access row
- **Category reordering** — drag categories to preferred order
- **Item visibility** — hide items the employee never orders
- **Layout settings** — button size (S/M/L), grid density (compact/normal/spacious)
- **Quick combos** — create personal multi-item shortcut buttons
- **Template sharing** — manager can push a layout template to a group of employees
- **Layout versioning** — roll back to previous personal layout
- Syncs across terminals via employee profile

## Dependencies (anticipated)
- **Menu** — reads base menu structure; personal layouts are overlays only
- **Employees** — stored per employee profile
- **Settings** — admin enable/disable per location

## SPEC Document
`docs/skills/SPEC-43-CUSTOM-MENUS.md`

*Last updated: 2026-03-03*
