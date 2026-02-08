---
skill: 230
title: Quick Pick Numbers
status: DONE
depends_on: [76, 99]
---

# Skill 230: Quick Pick Numbers

> **Status:** DONE
> **Domain:** Orders
> **Dependencies:** 76 (Course/Seat Management UI), 99 (Online Ordering Modifier Override)
> **Last Updated:** 2026-02-07

## Overview

Vertical gutter strip between the menu grid and order panel for instant quantity changes, hold/delay, and course assignment. Eliminates multi-tap quantity editing with single-tap number buttons.

## How It Works

1. Employee adds item to order -- item auto-selects in the strip
2. Tap a number (1-9) to set item quantity instantly
3. Tap 0 (red) to remove the item
4. Tap HLD to hold the item from sending to kitchen
5. Tap DLY presets (5m, 10m) to set a per-item delay
6. Tap C1-C5 to assign item to a course (when coursing enabled)
7. SEL button toggles multi-select mode for batch operations

### Multi-Select Mode

- Toggle SEL to enter multi-select
- Tap multiple items to build a selection set
- Tap a number to change quantity on ALL selected items
- Tap HLD to hold all selected items
- Selection auto-clears when items are sent or removed

### Per-Employee Setting

Quick Pick strip visibility is toggled per employee via Gear menu. Setting stored in `Employee.posLayoutSettings`.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/QuickPickStrip.tsx` | UI component (283 lines) -- vertical button strip with QTY, HLD, DLY, CRS sections |
| `src/hooks/useQuickPick.ts` | Selection state management (116 lines) -- auto-select newest item, multi-select, clear on send |
| `src/app/(pos)/orders/page.tsx` | Integration in orders page |
| `src/components/floor-plan/FloorPlanHome.tsx` | Integration in floor plan view |
| `src/components/bartender/BartenderView.tsx` | Integration in bartender view |
| `src/lib/settings.ts` | Per-employee quick pick toggle setting |

## Connected Parts

- **OrderPanel**: Selected items highlighted when quick pick is active
- **Coursing (Skill 12/76)**: Course assignment buttons (C1-C5) appear when coursing is enabled
- **Hold & Fire (Skill 13)**: HLD button toggles item hold status
- **Per-Item Delays (Skill 231)**: DLY preset buttons (5m, 10m) set delay timers
- **Order Store**: `useOrderStore` for reading/writing item quantities

## UI Details

- Width: 44px fixed
- Dark background: `rgba(15, 23, 42, 0.95)`
- Button colors: purple (numbers), amber (hold), blue (delay/course), red (zero/remove)
- Active state: colored border + background tint
- Disabled when no item selected (40% opacity)
