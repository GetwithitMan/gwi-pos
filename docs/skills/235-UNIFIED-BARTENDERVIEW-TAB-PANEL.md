# Skill 235: Unified BartenderView Tab Panel

**Status:** DONE
**Date:** February 7, 2026
**Domain:** Orders

## Summary
Replaced BartenderView's custom tab list implementation (~450 lines) with the shared OpenOrdersPanel component. Both the orders screen and bar tab view now use the same expanded card grid.

## Problem
Two separate tab/order list implementations existed:
1. **OpenOrdersPanel** — Used on `/orders` page with expanded card grid, closed orders, search, filters, sort, reopened badges
2. **BartenderView custom tab list** — Custom implementation with similar but different features

## Solution
- Deleted entire custom tab panel section from BartenderView
- Deleted: `loadTabs` function, `Tab`/`TabItem` types, `TabSortOption`/`TabViewMode` types, `tabs` state, `searchInputRef`, `selectedTab` useMemo, 3-second polling interval
- Replaced with `<OpenOrdersPanel>` component
- Added `forceDark` prop to OpenOrdersPanel for BartenderView dark theme
- Added `employeePermissions` prop pass-through from orders/page.tsx to BartenderView
- Replaced selectedTab-based item loading with direct API fetch when selectedTabId changes

## Files Modified
- `src/components/bartender/BartenderView.tsx` — Major deletion + OpenOrdersPanel integration
- `src/app/(pos)/orders/page.tsx` — Pass employeePermissions to BartenderView
- `src/components/orders/OpenOrdersPanel.tsx` — Added `forceDark` prop

## Dependencies
- OpenOrdersPanel (existing)
