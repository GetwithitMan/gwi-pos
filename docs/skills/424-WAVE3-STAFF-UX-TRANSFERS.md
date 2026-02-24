# Skill 424: Wave 3 — Frontline Usability & Transfers

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Post-Wave-2 field observation identified 14 frontline usability gaps and missing features that slow down bartenders, frustrate servers during payment failures, and block common workflows like tab transfers and order merging. Card declines leave tabs in broken states, bartenders lack search and quick-modifier buttons, there is no UI for transferring tabs or merging orders, the combo builder is unwired, virtual seats fail to hydrate on refresh, and managers have no real-time dashboard view.

## Solution

### 14 Items Across 4 Focus Areas

| # | ID | Area | Fix Summary |
|---|-----|------|-------------|
| 1 | W3-1 | Payment UX | Card decline preserves tab — verified decline→method selection flow, increased close-tab capture retry threshold |
| 2 | W3-3 | Payment UX | Increment failure visible outside modal — `toast.error` fires on `tab:updated` socket event even when PaymentModal is closed |
| 3 | W3-12 | Payment UX | Cash Exact one-tap — "Cash Exact $XX.XX" button on payment method selection screen, skips cash entry, processes immediately |
| 4 | W3-13 | Payment UX | Pay Cash Instead on decline — "Pay Cash Instead" button on DatacapPaymentProcessor decline overlay via `onPayCashInstead` callback |
| 5 | W3-5 | Bartender Speed | Tab name bypass — wired location setting through `useTabCreation.ts` so quick-tab auto-names when bypass enabled |
| 6 | W3-10 | Bartender Speed | Bartender search — expandable search input in BartenderView header, filters across all menu items regardless of category |
| 7 | W3-11 | Bartender Speed | Hot modifier buttons — common bar modifiers (Neat/Rocks/Up/Dirty/Dry/Wet/Twist) as quick-tap buttons on liquor items, fetched per-category and cached |
| 8 | W3-6 | Transfer & Merge UI | Transfer Items button — added to OrderPanelActions with `onTransferItems` callback |
| 9 | W3-7 | Transfer & Merge UI | Tab transfer — `TabTransferModal.tsx` (313 lines), socket dispatch added to API, button in OpenOrdersPanel |
| 10 | W3-8 | Transfer & Merge UI | Table transfer — entry point added to floor plan TableInfoPanel with server selection UI |
| 11 | W3-9 | Transfer & Merge UI | Merge orders — `MergeOrdersModal.tsx` (328 lines), button in OrderPanelActions with `onMergeOrders` callback |
| 12 | W3-2 | Combo/Seats & Dashboard | Seat hydration — fixed virtual/temporary seat loading on floor plan refresh |
| 13 | W3-4 | Combo/Seats & Dashboard | Combo builder wired — ComboStepFlow lazy-imported and rendered in OrderPageModals with state management and confirm handler |
| 14 | W3-14 | Combo/Seats & Dashboard | Manager dashboard v1 — new page at `/admin/dashboard` (402 lines), shows open orders with age coloring, clocked-in staff, quick stats, real-time socket updates |

---

### W3-1: Card Decline Preserves Tab — `PaymentModal.tsx`, `close-tab/route.ts`

**Problem:** When a card payment declined on a bar tab, the tab could be left in a broken state — the close-tab flow would fire prematurely or the user would lose their place in the payment flow.

**Fix:** Verified the decline→method selection flow so that a card decline returns the user to the payment method selection screen with the tab intact. Increased the close-tab capture retry threshold to prevent premature tab closure during transient declines.

### W3-3: Increment Failure Visible Outside Modal — `PaymentModal.tsx`

**Problem:** When an incremental authorization failed on a bar tab, the error was only visible inside the PaymentModal. If the modal was closed, the bartender had no indication that the increment had failed.

**Fix:** Added a `toast.error` notification that fires on the `tab:updated` socket event when the increment status indicates failure. This toast fires regardless of whether the PaymentModal is currently open, giving immediate visibility to the bartender.

### W3-12: Cash Exact One-Tap — `PaymentModal.tsx`

**Problem:** Paying the exact cash amount required navigating to the cash entry screen and manually entering the total. For quick transactions, this added unnecessary taps.

**Fix:** Added a "Cash Exact $XX.XX" button on the payment method selection screen that bypasses the cash entry step entirely. One tap processes the exact amount as a cash payment immediately.

### W3-13: Pay Cash Instead on Decline — `DatacapPaymentProcessor.tsx`

**Problem:** When a card payment declined, the only option was to retry with another card or cancel. There was no quick path to switch to cash payment from the decline screen.

**Fix:** Added a "Pay Cash Instead" button on the DatacapPaymentProcessor decline overlay. This button triggers an `onPayCashInstead` callback that switches the payment flow to cash processing without requiring the user to navigate back through the payment method selection.

### W3-5: Tab Name Bypass — `useTabCreation.ts`, `orders/page.tsx`

**Problem:** Every new bar tab required the bartender to type a customer name, even in high-volume environments where names are unnecessary. The bypass setting existed in location config but was not wired through the tab creation flow.

**Fix:** Wired the location setting through `useTabCreation.ts` so that when tab name bypass is enabled, quick-tab creation auto-generates a name (e.g., "Tab #47") and skips the name entry prompt entirely.

### W3-10: Bartender Search — `BartenderView.tsx`

**Problem:** Bartenders had to scroll through categories to find items. With large menus, finding a specific item (especially one in an unexpected category) was slow.

**Fix:** Added an expandable search input in the BartenderView header. The search filters across all menu items regardless of category, showing results as the bartender types. The input expands on tap and collapses when cleared.

### W3-11: Hot Modifier Buttons — `BartenderView.tsx`, `bartender-settings.ts`

**Problem:** Common bar modifiers like Neat, Rocks, Up, Dirty, Dry, Wet, and Twist required opening the full modifier modal for every liquor item. This added 2-3 extra taps per drink.

**Fix:** Added hot modifier quick-tap buttons that appear on liquor items. The common bar modifiers are displayed as compact buttons that apply the modifier with a single tap. Modifiers are fetched per-category from the modifier configuration and cached to avoid repeated lookups.

### W3-6: Transfer Items Button — `OrderPanelActions.tsx`

**Problem:** There was no way to transfer individual items from one order to another. Moving items between tabs required voiding and re-entering.

**Fix:** Added a "Transfer Items" button to OrderPanelActions with an `onTransferItems` callback that initiates the item transfer flow.

### W3-7: Tab Transfer — `TabTransferModal.tsx` (new), `OpenOrdersPanel.tsx`, `tabs/[id]/transfer/route.ts`

**Problem:** When a bartender's shift ended or a customer moved seats, there was no way to transfer a tab to another bartender. The tab was stuck with the original employee.

**Fix:** Created `TabTransferModal.tsx` (313 lines) providing a full tab transfer UI. The modal shows available employees and allows reassigning a tab with one tap. Socket dispatch was added to the transfer API route so all terminals see the change immediately. A transfer button was added to OpenOrdersPanel for easy access.

### W3-8: Table Transfer — `TableInfoPanel.tsx`, `FloorPlanHome.tsx`

**Problem:** Transferring a table (with its orders) to a different server required manager intervention or manual order recreation.

**Fix:** Added a table transfer entry point to the floor plan's TableInfoPanel. The UI shows a server selection list, and confirming the transfer reassigns all orders on that table to the selected server. The floor plan updates in real-time via socket events.

### W3-9: Merge Orders — `MergeOrdersModal.tsx` (new), `OrderPanelActions.tsx`

**Problem:** When two separate orders needed to be combined (e.g., customers who started separate tabs decide to pay together), there was no merge UI.

**Fix:** Created `MergeOrdersModal.tsx` (328 lines) that shows open orders and allows selecting a target order to merge into. A "Merge Orders" button was added to OrderPanelActions with an `onMergeOrders` callback. The merge consolidates items, recalculates totals, and closes the source order.

### W3-2: Seat Hydration Fix — `FloorPlanHome.tsx`, `UnifiedFloorPlan.tsx`

**Problem:** Virtual and temporary seats failed to load correctly when the floor plan was refreshed. After a page reload, seats would disappear or show incorrect data until the next socket update.

**Fix:** Fixed the seat hydration logic in the floor plan components to properly load virtual and temporary seat data from the snapshot API on initial render and page refresh.

### W3-4: Combo Builder Wired — `OrderPageModals.tsx`, `orders/page.tsx`

**Problem:** The ComboStepFlow component existed but was not connected to the ordering flow. Selecting a combo item from the menu had no effect.

**Fix:** Lazy-imported ComboStepFlow and rendered it in OrderPageModals with proper state management (open/close, selected combo item, step tracking) and a confirm handler that adds the configured combo to the current order.

### W3-14: Manager Dashboard v1 — `dashboard/page.tsx` (new)

**Problem:** Managers had no at-a-glance view of current operations. Checking open orders, staff on the clock, and order aging required navigating multiple screens.

**Fix:** Created a new page at `/admin/dashboard` (402 lines) that provides a real-time operational dashboard. Features include:
- Open orders list with age coloring (green→yellow→red based on order age)
- Clocked-in staff display
- Quick stats (total open orders, average order age, revenue today)
- Real-time socket updates — no polling required

## Files Modified

| File | IDs | Changes |
|------|-----|---------|
| `src/components/payment/PaymentModal.tsx` | W3-1, W3-3, W3-12 | Decline→method flow fix, increment failure toast on socket event, Cash Exact one-tap button |
| `src/components/payment/DatacapPaymentProcessor.tsx` | W3-13 | "Pay Cash Instead" button on decline overlay via `onPayCashInstead` callback |
| `src/app/api/orders/[id]/close-tab/route.ts` | W3-1 | Increased capture retry threshold for decline resilience |
| `src/components/bartender/BartenderView.tsx` | W3-10, W3-11 | Expandable search input in header, hot modifier quick-tap buttons for liquor items |
| `src/components/bartender/bartender-settings.ts` | W3-11 | Hot modifier configuration fetched per-category and cached |
| `src/app/(pos)/orders/page.tsx` | W3-4, W3-5 | Combo builder state management, tab name bypass wiring |
| `src/hooks/useTabCreation.ts` | W3-5 | Location setting wired for auto-naming when bypass enabled |
| `src/components/orders/OrderPanelActions.tsx` | W3-6, W3-9 | Transfer Items button + Merge Orders button with callbacks |
| `src/components/orders/OpenOrdersPanel.tsx` | W3-7 | Tab transfer button added |
| `src/components/orders/TabTransferModal.tsx` | W3-7 | New file (313 lines): full tab transfer UI with employee selection |
| `src/components/orders/MergeOrdersModal.tsx` | W3-9 | New file (328 lines): order merge UI with target order selection |
| `src/app/api/tabs/[id]/transfer/route.ts` | W3-7 | Socket dispatch added for real-time transfer updates |
| `src/components/floor-plan/TableInfoPanel.tsx` | W3-8 | Table transfer entry point with server selection UI |
| `src/components/floor-plan/FloorPlanHome.tsx` | W3-2, W3-8 | Seat hydration fix, table transfer integration |
| `src/components/floor-plan/UnifiedFloorPlan.tsx` | W3-2 | Virtual/temporary seat loading fix on refresh |
| `src/app/(pos)/orders/OrderPageModals.tsx` | W3-4 | ComboStepFlow lazy-import, rendering, and confirm handler |
| `src/app/(admin)/dashboard/page.tsx` | W3-14 | New file (402 lines): manager dashboard with real-time data |
| `src/app/api/tables/route.ts` | W3-8 | Table transfer API support |

## Testing

1. **W3-1 — Decline preserves tab** — Open bar tab, attempt card payment with a decline. Verify tab remains open and user returns to method selection.
2. **W3-3 — Increment failure toast** — Trigger an increment auth failure with PaymentModal closed. Verify toast appears.
3. **W3-12 — Cash Exact** — Open payment for a $27.50 order. Verify "Cash Exact $27.50" button appears on method selection. Tap it and verify payment completes in one tap.
4. **W3-13 — Pay Cash Instead** — Trigger a card decline. Verify "Pay Cash Instead" button appears on decline overlay. Tap it and verify cash payment flow starts.
5. **W3-5 — Tab name bypass** — Enable tab name bypass in location settings. Create a new tab. Verify auto-generated name and no name prompt.
6. **W3-10 — Bartender search** — Open bartender view, tap search. Type a partial item name. Verify results filter across all categories.
7. **W3-11 — Hot modifiers** — Select a liquor item in bartender view. Verify Neat/Rocks/Up/Dirty/Dry/Wet/Twist buttons appear. Tap one and verify modifier applied.
8. **W3-6 — Transfer Items** — Open an order with items. Verify "Transfer Items" button appears in order panel actions.
9. **W3-7 — Tab transfer** — Open a bar tab. Tap transfer in OpenOrdersPanel. Verify TabTransferModal shows employees. Transfer tab and verify it appears under new employee on all terminals.
10. **W3-8 — Table transfer** — Tap a table on floor plan. Verify transfer option in TableInfoPanel. Select a server and confirm. Verify table reassigned.
11. **W3-9 — Merge orders** — Open two orders. Tap "Merge Orders" on one. Verify MergeOrdersModal shows open orders. Merge and verify items consolidated, source order closed.
12. **W3-2 — Seat hydration** — Open a table with virtual/temporary seats. Refresh the page. Verify seats load correctly.
13. **W3-4 — Combo builder** — Add a combo item from the menu. Verify ComboStepFlow opens. Complete the steps and confirm. Verify combo added to order.
14. **W3-14 — Manager dashboard** — Navigate to `/admin/dashboard`. Verify open orders with age colors, clocked-in staff, and quick stats. Open a new order on another terminal and verify it appears in real-time.
