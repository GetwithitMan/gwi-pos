# Skill 353: Order Panel UI Hardening

**Status:** DONE
**Domain:** Orders
**Created:** 2026-02-16
**Commits:** `65821a9`, `5d1cd8e`, `0ad18fd`, `dac0e18`
**Dependencies:** Skill 349 (Per-Seat Check Cards)

## Summary

Fixed multiple UI bugs in the order panel: eliminated bare "0" rendering on sent items caused by React's falsy-number gotcha, fixed selection collapse preventing Resend/Comp/Void access on sent items, tightened layout with inline action buttons, and resolved two TypeScript build errors blocking Vercel deployment.

## Problems Fixed

### 1. Bare "0" Rendering on Sent Items (CRITICAL)

**Symptom:** Every sent item showed a bare "0" between the "Sent" badge and the price.

**Root Cause:** Three instances of the React falsy-number gotcha where `{numericValue && <JSX>}` renders the literal number `0` when the value is `0`:

| Location | Expression | Fix |
|----------|-----------|-----|
| Line 458 (seat badge wrapper) | `{item.seatNumber \|\| ...}` | `{item.seatNumber != null && item.seatNumber > 0 \|\| ...}` |
| Line 579 (resend count badge) | `{item.resendCount && item.resendCount > 0 && ...}` | `{item.resendCount != null && item.resendCount > 0 && ...}` |
| Line 532 (seat picker clear) | `{item.seatNumber && ...}` | `{item.seatNumber != null && item.seatNumber > 0 && ...}` |

The **primary culprit** was `resendCount` — the API returns `resendCount: 0` for all sent items, and the guard `{0 && ...}` renders "0".

### 2. Selection Collapse on Sent Items

**Symptom:** Tapping a sent item briefly showed Resend/Comp/Void buttons, then they immediately collapsed.

**Root Cause:** `useQuickPick.ts` lines 42-54 had a cleanup effect that filtered out selected items with `sentToKitchen === true`. Selecting a sent item worked for one frame, then the effect deselected it on the next render.

**Fix:** Changed cleanup to only remove items that no longer exist in the items array (removed from order), not items that have been sent:
```typescript
// BEFORE: filtered by sentToKitchen (broke sent item selection)
if (item && !item.sentToKitchen) validIds.add(id)

// AFTER: only filter items removed from order
const itemIds = new Set(items.map(i => i.id))
if (itemIds.has(id)) validIds.add(id)
```

### 3. Layout Tightening

- Inline print/delete buttons in item row instead of separate row
- Hide action controls until item is selected
- Sent items show pointer cursor when `onSelect` is provided

### 4. TypeScript Build Errors (Vercel Deployment)

Two type errors blocked Vercel deployment:

| File | Error | Fix |
|------|-------|-----|
| `TableNode.tsx:394` | `'round'` not in shape union type | Removed dead `case 'round'` and `case 'oval'` — `'circle'` already handles round shapes |
| `OpenOrdersPanel.tsx:213` | `'split'` comparison unreachable inside `'paid'\|'voided'` block | Removed redundant `trigger === 'split'` — `isSplitChild` check already handles it |

## Key Files

| File | Changes |
|------|---------|
| `src/components/orders/OrderPanelItem.tsx` | Fixed 3 falsy-number guards, cursor for sent items, inline layout |
| `src/hooks/useQuickPick.ts` | Fixed selection cleanup to allow sent item selection |
| `src/components/floor-plan/TableNode.tsx` | Removed invalid shape cases |
| `src/components/orders/OpenOrdersPanel.tsx` | Removed unreachable type comparison |

## Lesson: React Falsy-Number Gotcha

In React JSX, `{0 && <Component />}` renders the number `0` in the DOM. This is because `0` is falsy but is NOT `null`, `undefined`, or `false` — the three values React skips.

**Rule:** Never use `{numericValue && ...}` for conditional rendering. Always use:
- `{numericValue != null && numericValue > 0 && ...}` for positive numbers
- `{numericValue != null && ...}` if zero is valid
- `{!!numericValue && ...}` to coerce to boolean

## Related Skills

- **Skill 349**: Per-Seat Check Cards (seat badge rendering)
- **Skill 231**: Per-Item Delays (delay badge rendering)
- **Skill 238**: VOID/COMP Stamps (status badge rendering)
