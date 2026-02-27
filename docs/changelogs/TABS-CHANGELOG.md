# Tabs & Bottle Service Domain Changelog

## 2026-02-26 — Mobile Tabs Page Refactor (`af58ee4`)

### View Modes
- **Open/Closed toggle**: Switch between open orders and closed/paid orders
- **Age filters** (open view): All, Today, Previous Day, Declined
- **Owner filter**: Mine vs All (scoped to authenticated employee)
- **Closed date presets**: Today, Yesterday, This Week

### New Component
- `MobileOrderCard` replaces `MobileTabCard` — unified card for both open and closed orders

### Pagination
- Cursor-based pagination for closed orders (50 per page, "Load More" button)
- Background fetch for previous day count (badge on filter chip)

### Socket Integration
- Debounced socket refresh (prevents rapid API calls on multiple events)
- `useRef` for orders state to avoid stale closures in socket handlers

---

## 2026-02-23 — Start Tab & Add To Tab UX (Skill 413)

### Start Tab — Inline Status
- Inline "Authorizing card..." text replaces full-screen modal blocker
- 15s slow-reader timeout warning (doesn't abort)
- Success: green "Visa ...1234 authorized" flash
- Decline: prominent red error text with retry option

### Add To Tab — Background Indicator
- Socket listener for `tab:updated` events in PaymentModal
- `increment_failed`: amber "Card limit reached" banner
- `incremented`: silently update authorized amount display

### Backend Safety
- close-tab: double-capture prevention guard (returns early if already paid)
- open-tab: timeout recovery (`pending_auth` -> `open`, prevents stuck orders)

### Commit
- `e69d5b3` — Payment UX & Safety Wave 1

---

## 2026-02-20 — Card Re-Entry by Token, Real-Time TabsPanel, Speed Optimizations (Skills 382–384)

### New Features

- **Card re-entry by Datacap token**: When a guest's card is swiped for a new tab, the system checks `RecordNo` (Datacap vault token) against existing open tabs. If match found, bartender is prompted to open the existing tab — no duplicate tab, no double hold.
  - Stage 1: checked before `EMVPreAuth` (zero new hold for returning cards)
  - Stage 2: checked after `EMVPreAuth` if Stage 1 missed — new hold voided immediately
  - `CardFirstTabFlow`: new `existing_tab_found` state with "Open Tab" / "Different Card" UI

- **Real-time TabsPanel**: Tab list now subscribes to `tab:updated` + `orders:list-changed` socket events via `useEvents()`. Tabs appear and disappear across all bartender terminals instantly without manual refresh.

- **Instant new-tab modal**: Tapping "+ New Tab" now opens the card reader modal immediately (shows "Preparing Tab…" spinner) while the order shell is created in the background. Previously blocked ~400ms before modal appeared.

- **Fire-and-forget Start Tab**: Sending items to an existing tab now clears the UI instantly with an optimistic toast. All network operations (verify card, append items, send to kitchen, auto-increment) run in the background.

- **MultiCardBadges redesign**: Full cardholder name, DC4 token (truncated), auth hold amount, and brand-specific dark color theming (Visa=blue-950, MC=red-950, AMEX=emerald-950, Discover=orange-950). Three display modes: compact, default, full.

### Bug Fixes

| Fix | Impact |
|-----|--------|
| `void-tab` missing `dispatchTabUpdated` | Voided tabs now disappear in real time on all terminals |
| Tab list only refreshed via `refreshTrigger` | Now also socket-driven — no stale lists across terminals |

### Schema

- `OrderCard`: added `@@index([recordNo])` for fast token lookup

### Files Modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `@@index([recordNo])` on `OrderCard` |
| `src/app/api/orders/[id]/open-tab/route.ts` | Two-stage RecordNo detection |
| `src/components/tabs/CardFirstTabFlow.tsx` | `existing_tab_found` state, null orderId, "Preparing" spinner |
| `src/app/(pos)/orders/page.tsx` | Fire-and-forget start tab, instant new-tab modal, existing-tab handler |
| `src/app/(pos)/orders/OrderPageModals.tsx` | Render gate no longer requires `cardTabOrderId` |
| `src/components/tabs/TabsPanel.tsx` | Socket subscriptions via `useEvents()` |
| `src/app/api/orders/[id]/void-tab/route.ts` | Added missing `dispatchTabUpdated` |
| `src/components/tabs/MultiCardBadges.tsx` | Full redesign — brand palette, 3 modes, token display |
| `src/app/api/tabs/route.ts` | Returns `OrderCard[]`, `tabStatus`, `tabNickname`, `isBottleService` |
| `src/hooks/useCardTabFlow.ts` | Added `recordNo`, `authAmount` to `tabCardInfo` |
| `src/components/tabs/TabNamePromptModal.tsx` | Shows auth hold + DC4 token |

### Skill Docs

- `docs/skills/382-MULTICARD-BADGES-CARD-PILL.md`
- `docs/skills/383-BARTENDER-SPEED-OPTIMIZATIONS.md`
- `docs/skills/384-CARD-REENTRY-BY-TOKEN.md`

---

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
