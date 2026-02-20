# Skill 403 — Previous Day Open Orders Panel

**Domain:** Orders / UI
**Date:** 2026-02-20
**Commits:** 4687312, (badge work in same session)
**Addresses:** "Previous Day" age filter showed 0 orders despite badge count of 3; stale orders had no visual indicator of when they were opened

---

## Overview

Three improvements to the Open Orders Panel for handling previous-day stale tabs:
1. Previous Day filter now actually fetches prior-day orders from the API (was broken client-side filter)
2. Date-started badge shows on every previous-day order card
3. Previous Day chip shows a live count badge

---

## Problem 1 — Filter Was Client-Side Only

`ageFilter === 'previous'` used to filter `orders.filter(o => o.isRolledOver)` — orders without `rolledOverAt` set (EOD not run) got filtered out entirely. And the API was excluding them too after Skill 402 fix.

**Fix:** `loadOrders` now accepts `forPreviousDay = false`. When `ageFilter === 'previous'`, it fetches `?previousDay=true` from the API. Socket refresh is blocked when `ageFilter === 'previous'` to prevent overwriting prior-day results.

## Problem 2 — No Visual Date on Stale Cards

No way to see when a previous-day tab was opened.

**Fix:** Added `formatDateStarted()` helper. A red `📅 Feb 19 · 5:33 PM` badge renders on order cards when `ageFilter === 'previous'` or `order.isRolledOver === true`. Added to both card and condensed view modes.

## Problem 3 — Chip Had No Count

"Previous Day" chip gave no indication of how many stale tabs existed.

**Fix:** Added `previousDayCount` state. Background effect fetches prior-day count on panel mount. `loadOrders(true)` also captures the count. Chip renders as `Previous Day (3)` when count > 0.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/orders/OpenOrdersPanel.tsx` | loadOrders previousDay param, socket guard, formatDateStarted, date badge, previousDayCount state + background fetch, chip label |
| `src/app/api/orders/open/route.ts` | Added previousDay param support (see Skill 402) |
