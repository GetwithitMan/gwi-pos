# Skill 373 — Forensic Audit Wave 6 (UX + Bug Fixes)

**Date:** February 18, 2026
**Domain:** Orders, Payments, Tabs, UX
**Priority:** P0

## Summary

Wave 6 of the forensic audit focused on bartender UX optimization and critical bug fixes discovered during live testing. Reduced click counts across key workflows and fixed data integrity issues with soft deletes and ingredient modifications.

## Sub-Phases

### 6A — Hook Extractions (4 hooks, 21 states)
- `usePaymentFlow.ts` — payment modal, method selection, tab cards, discounts
- `useModifierModal.ts` — modifier modal state, item selection, loading
- `useItemOperations.ts` — comp/void modal, resend flow
- `useComboBuilder.ts` — combo modal, template, selections

### 6B — Void Flow Simplification
- Auto-select first reason on Comp/Void action tap
- Auto-detect "was it made?" from `kitchenStatus` (sent/cooking/ready = yes, pending = no)
- All defaults overridable. 5-6 taps → 3.

### 6C — Quick Tab + Payment Skip + Clickable Seats
- Wired `handleQuickTab` to OpenOrdersPanel (1-tap tab creation)
- Set `initialPayMethod='credit'` when pre-auth tab cards exist
- Seat headers in OrderPanel clickable → selects seat via `useFloorPlanStore`

### 6D — Same Again + Split Evenly
- "Same Again" button on ClosedOrderActionsModal (copies items to current order)
- ÷2 quick-split button in OrderPanelActions

### 6E — Multi-Card Tab Support
- "Add Card to Tab" button (bright orange gradient) on method + card steps
- Tab cards shown on datacap_card step with "Charge •••XXXX" buttons
- `orderCardId` param on close-tab API to charge specific card
- Card fetch on Card button click path
- `onTabCardsChanged` callback for live refresh

### 6E-HF — Deleted Items Reappearing
- Root cause: Prisma `$extends` only filters top-level queries, NOT nested includes
- Fix: Added explicit `where: { deletedAt: null }` to items + modifiers includes in 5 routes
- Routes fixed: GET/orders/[id], GET/orders, GET/tabs, POST/orders/[id]/pay, GET/orders/[id]/split-tickets

### 6F — Ingredient Modifications Fix
- Root cause: GET queries included `modifiers` + `pizzaData` but not `ingredientModifications`
- Response mapper already handled the data — it was just never fetched
- Added `ingredientModifications: true` to 5 query paths across 3 files

## Files Changed

### New Files
- `src/hooks/usePaymentFlow.ts`
- `src/hooks/useModifierModal.ts`
- `src/hooks/useItemOperations.ts`
- `src/hooks/useComboBuilder.ts`

### Modified Files
- `src/app/(pos)/orders/page.tsx` — hook wiring, card fetch, seat select
- `src/components/orders/CompVoidModal.tsx` — auto-detect, auto-select
- `src/components/orders/OrderPanel.tsx` — clickable seats
- `src/components/orders/OrderPanelActions.tsx` — ÷2 button
- `src/components/orders/ClosedOrderActionsModal.tsx` — Same Again
- `src/components/payment/PaymentModal.tsx` — multi-card, Add Card button
- `src/components/bartender/BartenderView.tsx` — quick tab, Same Again wiring
- `src/app/api/orders/[id]/route.ts` — deletedAt filters, ingredientModifications
- `src/app/api/orders/[id]/close-tab/route.ts` — orderCardId param
- `src/app/api/orders/route.ts` — deletedAt filters, ingredientModifications
- `src/app/api/tabs/route.ts` — deletedAt filters, ingredientModifications
- `src/app/api/orders/[id]/pay/route.ts` — deletedAt filters
- `src/app/api/orders/[id]/split-tickets/route.ts` — deletedAt filters

## Key Lessons
1. Prisma `$extends` query extensions do NOT cascade into nested `include` — always add explicit `where: { deletedAt: null }` on nested relations
2. Response mappers can silently return empty arrays when data isn't fetched — always verify the Prisma query includes all needed relations
3. Multiple code paths to the same modal (PaymentModal) need consistent data pre-fetching
