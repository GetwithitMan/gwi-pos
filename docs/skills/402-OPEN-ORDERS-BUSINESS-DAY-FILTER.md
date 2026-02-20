# Skill 402 — Open Orders Business Day Filter

**Domain:** Orders / Business Day
**Date:** 2026-02-20
**Commit:** c7af5ef
**Addresses:** Open orders panel was showing all open orders regardless of date — orders from previous business days appeared in the current-day list

---

## Overview

The `/api/orders/open` route had no `createdAt` filter, meaning yesterday's unclosed tabs appeared alongside today's orders. The EOD reset used a hardcoded 24-hour window instead of the actual business day boundary. Both were fixed to use `getCurrentBusinessDay()`.

---

## Root Cause

- `GET /api/orders/open` — no date filter at all; returned every order with status 'open' or 'split'
- `src/lib/snapshot.ts` — open orders count badge had no date filter either (badge showed 3, panel showed 0)
- `src/app/api/eod/reset` — used `new Date(Date.now() - 24 * 60 * 60 * 1000)` instead of business day boundary

---

## Fix

### `/api/orders/open/route.ts`
- Import `getCurrentBusinessDay` from `@/lib/business-day`
- Fetch location settings → get `dayStartTime`
- Add `businessDayFilter`: `createdAt: { gte: businessDayStart }` for current day
- Support `?previousDay=true` param: `createdAt: { lt: businessDayStart }`
- Skip filter when `?rolledOver=true`
- Applied to both summary and full query paths

### `src/lib/snapshot.ts`
- Same business day filter on the open orders `db.order.count()`

### `src/app/api/eod/reset/route.ts`
- Replaced hardcoded 24h window with `getCurrentBusinessDay(dayStartTime).start` in both POST and GET handlers

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/orders/open/route.ts` | Added businessDayStart filter + previousDay param |
| `src/lib/snapshot.ts` | Added businessDayStart filter to count query |
| `src/app/api/eod/reset/route.ts` | Replaced hardcoded 24h with business day boundary |
