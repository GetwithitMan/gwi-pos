# Skill 236: Comp/Void from BartenderView

**Status:** DONE
**Date:** February 7, 2026
**Domain:** Orders

## Summary
Enabled comp/void functionality from the BartenderView. Previously showed a "coming soon" toast.

## Problem
BartenderView's `handleCompVoidItem` was a TODO stub that showed a toast message instead of opening the CompVoidModal.

## Solution
- Added `onOpenCompVoid` callback prop to BartenderView
- Wired it in orders/page.tsx to set `compVoidItem` state and open CompVoidModal
- BartenderView's `handleCompVoidItem` now calls `onOpenCompVoid` with item data

## Files Modified
- `src/components/bartender/BartenderView.tsx` — Added `onOpenCompVoid` prop, rewrote handleCompVoidItem
- `src/app/(pos)/orders/page.tsx` — Added onOpenCompVoid callback to BartenderView

## Dependencies
- Skill 235 (Unified BartenderView Tab Panel)
- CompVoidModal (existing)
