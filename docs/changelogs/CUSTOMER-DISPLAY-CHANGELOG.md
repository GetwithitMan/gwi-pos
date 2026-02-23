# Customer Display Domain Changelog

## 2026-02-23 — CFD Tip Screen Rework (Skill 413)

### Full Rework
- Order summary (subtotal, tax, total) displayed at top of screen
- Tip preset buttons (percentage or dollar amount) with visual selection state
- No Tip button + Custom tip with numeric keypad
- Confirm CTA with live total (base + tip)
- Disconnect overlay with auto-reconnect polling
- Multi-surface type updates for tip screen events

### Files Modified
- `src/components/cfd/CFDTipScreen.tsx` — Full rework
- `src/app/(cfd)/cfd/page.tsx` — CFD tip screen event integration
- `src/types/multi-surface.ts` — Tip screen event types

### Commit
- `e69d5b3` — Payment UX & Safety Wave 1

---

## 2026-02-09 — Domain Created
- Domain 21 established for Customer Display
- Covers CFD state machine, pay-at-table, tip/signature screens
- Split from Guest domain to clarify customer-facing surface ownership
- Domain doc created at `/docs/domains/CUSTOMER-DISPLAY-DOMAIN.md`
