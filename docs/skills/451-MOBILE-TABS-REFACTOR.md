# Skill 451: Mobile Tabs Page Refactor — Open/Closed Views + Pagination

**Date:** 2026-02-26
**Commit:** `af58ee4`
**Status:** DONE

## Overview

Complete rewrite of the mobile tabs page (`/mobile/tabs`). Replaced single-view tab list with dual open/closed views, age filters, owner scoping, closed date presets, and cursor-based pagination.

## Changes

### New Component
- `src/components/mobile/MobileOrderCard.tsx` — Unified card replacing `MobileTabCard`. Works for both open and closed orders.

### View Modes
- **Open orders**: Fetches from `/api/orders/open?summary=true`
- **Closed orders**: Fetches from `/api/orders/closed` with date range filters

### Filters (Open View)
- **Age**: All, Today, Previous Day, Declined
- **Owner**: Mine (filtered to authenticated employee) vs All
- Background fetch for previous day order count (shown as badge on filter chip)

### Filters (Closed View)
- **Date presets**: Today, Yesterday, This Week
- Cursor-based pagination (50 per page, "Load More" button)

### Socket Integration
- Debounced socket refresh prevents rapid API calls when multiple events fire
- `useRef` for orders state avoids stale closures in socket handlers

### Files Modified
| File | Change |
|------|--------|
| `src/app/(mobile)/mobile/tabs/page.tsx` | Full rewrite: +468/-100 lines |
| `src/components/mobile/MobileOrderCard.tsx` | New component |
