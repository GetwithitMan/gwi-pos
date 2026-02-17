# Skill 369: Bar Send Tab Name Prompt

## Status: DONE
## Domain: Orders, Tabs
## Dependencies: 20 (Bar Tabs), 368 (On-Screen Keyboard)

## Summary

When sending items from bar mode without a selected tab, the POS now shows a tab name modal with on-screen keyboard instead of silently creating a nameless tab (or doing nothing).

## Problem

`handleSend` in BartenderView tried to silently `POST /api/tabs` with `tabName: null` when no tab was selected. If `requireNameWithoutCard` was true, it would fail silently — the send button appeared completely dead with no feedback.

## Solution

1. **`handleSend`** now checks `if (!selectedTabId)` → sets `pendingSendAfterTabRef = true` → opens tab name modal
2. **`handleCreateTab`** checks `pendingSendAfterTabRef` after creating the tab → if true, calls `sendItemsToTab(newTabId)` to send all pending items to kitchen
3. **`sendItemsToTab()`** extracted as shared helper — used by both direct send (existing tab) and post-tab-creation send

## Flow

```
Add items → Send → No tab? → Tab Name Modal + Keyboard
  → Type name → "Start Tab" → Create tab → Send items → Toast "Order sent"
  → Clear order → Ready for next customer
```

## Key File

- `src/components/bartender/BartenderView.tsx`
  - `sendItemsToTab()` — shared send logic (lines ~945-985)
  - `handleCreateTab()` — creates tab, optionally sends items (lines ~987-1030)
  - `handleSend()` — shows modal if no tab, or sends directly (lines ~1060-1078)
  - `pendingSendAfterTabRef` — tracks whether send triggered the modal
