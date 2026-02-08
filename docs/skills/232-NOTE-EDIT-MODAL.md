---
skill: 232
title: Note Edit Modal
status: DONE
depends_on: []
---

# Skill 232: Note Edit Modal

> **Status:** DONE
> **Domain:** Orders
> **Dependencies:** None
> **Last Updated:** 2026-02-07

## Overview

Dark glassmorphism modal for editing kitchen notes on order items, replacing the browser's native `window.prompt()` with a touch-friendly, themed interface.

## How It Works

1. Employee taps Note icon on a pending item in OrderPanel
2. NoteEditModal opens with existing note pre-filled (if any)
3. Item name shown in purple for context
4. Employee types note in textarea (e.g., "No onions, extra pickles")
5. Save via button or Cmd+Enter; Cancel via button or Escape
6. Note saved to item's `specialNotes` field and sent with kitchen ticket

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/NoteEditModal.tsx` | Modal component (153 lines) -- textarea, save/cancel, keyboard shortcuts |
| `src/components/floor-plan/FloorPlanHome.tsx` | Renders NoteEditModal for floor plan orders |
| `src/components/bartender/BartenderView.tsx` | Renders NoteEditModal for bar orders |
| `src/hooks/useActiveOrder.ts` | Note save handler integration |

## Connected Parts

- **OrderPanel**: Note icon triggers modal open
- **Send to Kitchen (Skill 7)**: Notes included in kitchen tickets
- **KDS Display (Skill 23)**: Notes displayed on KDS tickets

## UI Details

- Background: `rgba(15, 23, 42, 0.98)` with blur backdrop
- Animated entry: scale 0.95 -> 1.0 (150ms ease-out)
- Textarea: auto-focus on open, amber border on focus
- Item name in purple (`#a78bfa`)
- Save button: amber (`#f59e0b`)
- Keyboard: Cmd+Enter saves, Escape cancels
- Placeholder: "e.g., No onions, extra pickles, allergic to nuts..."
