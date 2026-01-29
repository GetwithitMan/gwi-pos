# Keyboard Shortcuts

POS keyboard shortcuts for faster operation.

## Overview

Keyboard shortcuts enable power users to navigate and operate the POS quickly without touching the screen.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close modal / Cancel |
| `Enter` | Confirm / Submit |
| `Tab` | Next field |
| `Shift+Tab` | Previous field |

## Navigation

| Shortcut | Action |
|----------|--------|
| `Alt+O` | Orders page |
| `Alt+K` | KDS view |
| `Alt+S` | Settings |
| `Alt+R` | Reports |
| `Alt+M` | Menu management |

## Order Operations

| Shortcut | Action |
|----------|--------|
| `F1` | New order |
| `F2` | Send to kitchen |
| `F3` | Payment |
| `F4` | Print receipt |
| `F5` | Refresh |
| `F8` | Void last item |
| `F12` | Open drawer |

## Quick Amounts (Payment)

| Shortcut | Action |
|----------|--------|
| `1` - `9` | Quick cash amounts |
| `0` | Exact amount |
| `.` | Decimal entry |
| `Enter` | Process payment |

## Category Navigation

| Shortcut | Action |
|----------|--------|
| `←` / `→` | Previous/next category |
| `1` - `9` | Select category by position |
| `Home` | First category |
| `End` | Last category |

## Item Selection

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate items |
| `Enter` | Add selected item |
| `+` | Increase quantity |
| `-` | Decrease quantity |
| `Delete` | Remove item |

## Order Panel

| Shortcut | Action |
|----------|--------|
| `Alt+↑` | Select previous item |
| `Alt+↓` | Select next item |
| `Alt+Delete` | Void selected item |
| `Alt+M` | Add modifier to selected |
| `Alt+N` | Add note to selected |

## Modifiers

| Shortcut | Action |
|----------|--------|
| `1` - `9` | Quick select modifier |
| `Enter` | Confirm modifiers |
| `Esc` | Cancel modifiers |
| `Space` | Toggle selected modifier |

## Payment Screen

| Shortcut | Action |
|----------|--------|
| `C` | Cash payment |
| `R` | Card payment |
| `S` | Split payment |
| `G` | Gift card |
| `H` | House account |
| `Enter` | Process |
| `Esc` | Cancel |

## Quick Cash

| Shortcut | Amount |
|----------|--------|
| `Numpad 1` | $1 |
| `Numpad 5` | $5 |
| `Numpad 10` | $10 |
| `Numpad 20` | $20 |
| `Numpad 50` | $50 |
| `Numpad 100` | $100 |

## Table Selection

| Shortcut | Action |
|----------|--------|
| `T` + number | Select table (T5 = Table 5) |
| `Arrow keys` | Navigate floor plan |
| `Enter` | Select highlighted table |

## Time Clock

| Shortcut | Action |
|----------|--------|
| `Alt+I` | Clock in |
| `Alt+O` | Clock out |
| `Alt+B` | Start break |

## Manager Functions

| Shortcut | Action |
|----------|--------|
| `Alt+V` | Void item (manager) |
| `Alt+D` | Apply discount |
| `Alt+X` | No sale (open drawer) |
| `Alt+P` | Price override |

## Search

| Shortcut | Action |
|----------|--------|
| `/` | Focus search box |
| `Ctrl+F` | Find item |
| `Esc` | Clear search |

## Tips for Efficiency

### Number Pad
- Use number pad for amounts
- Quick cash buttons
- Speed up checkout

### Function Keys
- Memorize F1-F12
- Most common operations
- No mouse needed

### Alt Combinations
- Navigation shortcuts
- Manager overrides
- Power user features

## Customization

### Configure Shortcuts
Currently shortcuts are fixed. Future versions may support customization.

### Disable Shortcuts
Some shortcuts can conflict with browser:
- `Ctrl+W` (close tab) - avoided
- `Ctrl+R` (refresh) - use F5 instead
- `Alt+F4` (close window) - avoided

## Touch Screen Note

When using touch screen:
- Keyboard shortcuts still work
- Connect USB keyboard for shortcuts
- Hybrid touch + keyboard workflow

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useKeyboardShortcuts.ts` | Shortcut handler |
| `src/app/(pos)/orders/page.tsx` | POS shortcuts |
| `src/components/payment/PaymentModal.tsx` | Payment shortcuts |
