# Skill 368: On-Screen Virtual Keyboard

## Status: DONE
## Domain: UI, Hardware
## Dependencies: 345 (Installer — kiosk context)

## Summary

NUC kiosk terminals run Chromium in kiosk mode with no physical keyboard. Added a touch-friendly `OnScreenKeyboard` component with QWERTY, numeric, and phone modes. Integrated into all text input dialogs across the POS.

## Component API

```typescript
interface OnScreenKeyboardProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  mode?: 'qwerty' | 'numeric' | 'phone'  // default: 'qwerty'
  theme?: 'dark' | 'light'                // default: 'dark'
  maxLength?: number
  submitLabel?: string                     // default: 'Done'
  className?: string
}
```

## Keyboard Modes

### QWERTY (text entry)
- 4 rows: Q-P, A-L, Shift+Z-M+Bksp, ?123+Space+Done
- Symbols toggle (?123/ABC): numbers, @#$&*()'"  -+=/?!:
- Shift: single tap = one char, double tap = caps lock, auto-unshift after typing
- Starts shifted for first-letter capitalization

### Numeric (PIN/amounts)
- 3x4 grid: 1-9, Bksp, 0, Done
- 64px key height for easy touch

### Phone (phone numbers)
- 3x4 grid + extra row: 1-9, +, 0, Bksp, -, (, )

## Theming

| Element | Dark (BartenderView) | Light (Modals) |
|---------|---------------------|----------------|
| Container | `bg-slate-800/95` | `bg-gray-100` |
| Keys | `bg-slate-700` | `bg-white shadow-sm` |
| Done/Submit | `bg-indigo-600` | `bg-blue-500` |
| Shift active | `bg-indigo-600` | `bg-blue-500` |

## Integrated Dialogs

| Dialog | File | Keyboard Mode | Theme |
|--------|------|---------------|-------|
| BartenderView New Tab | `bartender/BartenderView.tsx` | qwerty | dark |
| NewTabModal | `tabs/NewTabModal.tsx` | qwerty + numeric | light |
| OrderTypeSelector fields | `orders/OrderTypeSelector.tsx` | qwerty / phone | light |
| CustomerLookupModal | `customers/CustomerLookupModal.tsx` | qwerty + phone | light |
| AddToWaitlistModal | `entertainment/AddToWaitlistModal.tsx` | qwerty + phone | light |

## Key Design Decisions

- **Inline within modals** (not global bottom-of-screen) — modals use z-50, different themes
- **Styled `<div>` display** (not `<input>`) — prevents native keyboard on iPad PWA
- **`focusedField` state per dialog** — only one keyboard visible at a time in multi-field forms
- **52px+ key height** — exceeds 44px touch target minimum
- **framer-motion** animations: slide-up entrance, `whileTap={{ scale: 0.93 }}` key press feedback

## Key Files

| File | Purpose |
|------|---------|
| `src/components/ui/keyboard-layouts.ts` | Pure data: QWERTY, SYMBOL, NUMERIC, PHONE row definitions |
| `src/components/ui/on-screen-keyboard.tsx` | Core component with theming, shift/capslock, mode toggle |
