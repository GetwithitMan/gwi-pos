# Tabs & Bottle Service Domain Changelog

## 2026-02-18 — Multi-Card Tab Support + Bug Fixes

### New Features
- **Multi-card tabs**: Tabs can hold multiple cards. "Add Card to Tab" button (bright orange) on payment method and card steps
- **Card picker**: When closing tab with 2+ cards, choose which to charge
- **Quick tab**: 1-tap tab creation wired to OpenOrdersPanel in BartenderView

### Bug Fixes
- **Deleted items reappearing**: Added `where: { deletedAt: null }` to tab list API items include
- **Ingredient modifications not showing**: Added `ingredientModifications: true` to tab list items include
- **Tab cards not showing on Credit click**: Added card fetch to Card button handler path

---

## Session: February 17, 2026 — Bar Send Tab Name Prompt + On-Screen Keyboard (Skills 368-369)

### Summary
Fixed bar send flow to prompt for tab name with on-screen keyboard instead of silently failing. Added virtual keyboard to all tab-related input dialogs for kiosk terminals.

### What Changed

#### Skill 368: On-Screen Keyboard
- `OnScreenKeyboard` component with QWERTY, numeric, and phone modes
- Dark theme for BartenderView, light theme for NewTabModal
- Integrated into BartenderView New Tab modal and NewTabModal (tab name + card last 4)

#### Skill 369: Bar Send Tab Name Prompt
- `handleSend` now shows tab name modal when no tab selected (was silently creating nameless tab or dead button)
- `pendingSendAfterTabRef` tracks send-triggered modals → auto-sends items after tab creation
- Extracted `sendItemsToTab()` shared helper

### Files Modified
| File | Changes |
|------|---------|
| `src/components/bartender/BartenderView.tsx` | Tab name prompt on send, keyboard, sendItemsToTab |
| `src/components/tabs/NewTabModal.tsx` | Keyboard for tab name + card last 4 |
| `src/components/ui/on-screen-keyboard.tsx` | NEW — virtual keyboard |
| `src/components/ui/keyboard-layouts.ts` | NEW — key layout data |

### Skill Docs
- `docs/skills/368-ON-SCREEN-KEYBOARD.md`
- `docs/skills/369-BAR-SEND-TAB-NAME-PROMPT.md`

---

## 2026-02-09 — Domain Created
- Domain 17 established for Tabs & Bottle Service
- Separated from Orders domain due to distinct lifecycle (pre-auth, incremental auth, multi-card, bottle service)
- Domain doc created at `/docs/domains/TABS-DOMAIN.md`
