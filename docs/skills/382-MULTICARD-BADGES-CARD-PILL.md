# Skill 382 — MultiCardBadges: Card Pill Bells & Whistles

**Domain:** Tabs & Payments
**Date:** 2026-02-20
**Commit:** (see Living Log)

---

## Overview

Complete redesign of the card pill display components in the Tabs panel. Added full cardholder name, Datacap DC4 token (truncated), auth hold amount, and brand-specific color theming across three display modes.

---

## Components Changed

### `src/components/tabs/MultiCardBadges.tsx`

Three display modes:

| Mode | Use | Shows |
|------|-----|-------|
| `compact` | Tab list rows | Brand logo chip + •••• last4 + status dot |
| `default` | Medium pills | Name + masked PAN + auth amount + status dot |
| `full` | Selected tab header | All fields including DC4 token |

**Brand palette (dark bg for dark modal surfaces):**
```ts
visa:       { bg: 'bg-blue-950',   text: 'text-blue-200',   logo: 'VISA'  }
mastercard: { bg: 'bg-red-950',    text: 'text-red-200',    logo: 'MC'    }
amex:       { bg: 'bg-emerald-950',text: 'text-emerald-200',logo: 'AMEX'  }
discover:   { bg: 'bg-orange-950', text: 'text-orange-200', logo: 'DISC'  }
unknown:    { bg: 'bg-gray-900',   text: 'text-gray-300',   logo: 'CARD'  }
```

**Status dots:** `authorized=green-400`, `captured=blue-400`, `declined=red-500`, `voided=gray-500`

**DC4 token truncation:** `DC4:ABCD1234…` (strip "DC4:" prefix, show first 8 chars)

**Name formatting:** Datacap returns `"LAST/FIRST"` — `formatName()` converts to `"First Last"`

### `src/hooks/useCardTabFlow.ts`

Added `recordNo` and `authAmount` to `tabCardInfo` state type.

### `src/components/tabs/TabNamePromptModal.tsx`

Updated `cardInfo` prop to include `recordNo` and `authAmount`. Success banner shows auth hold + truncated DC4 token.

### `src/components/tabs/TabsPanel.tsx`

Added `recordNo?: string | null` to `TabCard` interface. Single-card tabs show cardholder name + hold amount under the card pill.

### `src/app/api/tabs/route.ts`

GET now includes full `OrderCard` data (`cards[]`) per tab, plus `tabStatus`, `tabNickname`, `isBottleService`, `bottleServiceTierName`, `bottleServiceTierColor`.

---

## Key Patterns

```ts
// Compact pill in tab list
<MultiCardBadges cards={tab.cards} compact />

// Full card in selected tab view
<MultiCardBadges cards={tab.cards} full />

// Single card convenience wrapper
<CardPill card={card} />
```
