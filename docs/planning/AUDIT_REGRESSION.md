# Audit Regression Guard List
**Source:** Android Bartender Audit 2026-03-03
**Purpose:** 31 invariants to re-verify after any change to payment, order, shift, tips, or permission code.

If a future PR touches the areas below, check the corresponding invariant before merging.

---

## Payment Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| P1 | Cannot pay with PENDING (unsent) kitchen items | `PayOrderUseCase.ensureOrderReadyForPayment()` + `POST /api/orders/[id]/pay` | Add item, don't send, attempt payment |
| P2 | Partial cash payment moves order to `in_progress` | `POST /api/orders/[id]/pay` (partial branch) | Pay $5 on a $20 order |
| P3 | `appliedPayments` seeded from CONFIRMED `PaymentLogEntity` on PaymentSheet open | `OrderViewModel.showPayment()` | Close + reopen PaymentSheet mid-payment |
| P4 | Item add rejected if any payment is `pending` or `completed` | `POST /api/orders/[id]/items` | Open payment sheet, attempt add item from another terminal |
| P5 | Voided payment syncs to all terminals via socket | `OrderSyncController.handlePaymentProcessed()` | Void payment on web POS → check Android terminal |

## Order Mutation Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| O1 | Comp/void blocked after any completed payment | `POST /api/orders/[id]/comp-void` + `POST /api/orders/[id]/items/[itemId]` | Pay order, attempt comp/void |
| O2 | Every order mutation emits an event via `emitOrderEvent()` | All mutation routes | Check `order_events` table after any mutation |
| O3 | Kitchen status changes are event-sourced (not direct Room writes) | `OrderSyncController.handleKdsItemStatus()` | Mark item fired in KDS → replay events → kitchen status preserved |

## Shift / Clock Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| S1 | Clock-out blocked during active card payment | `OrderViewModel.clockOut()` (isProcessingPayment guard) | Start payment, attempt clock out |
| S2 | Shift close 409 parsed into open-order count + manager override flag | `OrderViewModel.closeShift()` (Moshi parse of ShiftCloseErrorBody) | Close shift with open orders → confirm count shows in sheet |
| S3 | Shift close sheet shows pending tip count before user taps Close | `OrderViewModel.showShiftClose()` (getPendingTips call) | Have pending tips, open shift close → count visible |
| S4 | Manager override button appears when `requiresManagerOverride=true` | `ShiftCloseSheet` | Trigger 409 with open orders on an employee who needs override |

## Tips Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| T1 | Pending tips scoped to current shift in shift-close sheet | `OrderViewModel.showShiftClose()` passes `shiftId` | Tips from prior shift must NOT appear in shift-close count |
| T2 | Tip edits rejected after shift closed >24h | `POST /api/tips/adjustments` (shift.endedAt check) | Attempt tip edit on payment from shift closed yesterday |
| T3 | Tip edit UI disabled and warns on locked-shift payments | `TipEntrySheet` (shiftEditLocked) | Open TipEntrySheet for payment from old closed shift |
| T4 | Tips >50% of order total show amber warning on Android | `PaymentSheet`, `CloseTabSheet`, `TipEntrySheet` | Enter tip that exceeds half the order total |
| T5 | Tips >200% of payment base rejected server-side | `POST /api/tips/adjustments` (200% guard) | Submit extreme tip via API |

## UI / UX Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| U1 | $0 order (after comp/discount) shows "Complete / No Charge" button, hides Cash/Card/Other | `SendButtonRow` (total == 0L branch) | Apply 100% discount → payment row replaced |
| U2 | Tab list shows Open/Closed badge + balance due per row | `TabListSheet` | Open tabs with partial payments visible |
| U3 | Seat split warns when unassigned items exist | `SplitCheckSheet` (showUnassignedWarning) | Split by seat with items that have no seat number |
| U4 | Spirit dialog cannot be dismissed by tapping the scrim | `SpiritSelectionDialog` (dismissOnClickOutside=false) | Tap outside spirit dialog |
| U5 | Modifier sheet blocks swipe-down when any selection has been made | `ModifierSheet` (hasPartialSelection guard) | Make modifier selections, swipe down → blocked |
| U6 | Single-option required modifier groups auto-select on sheet open | `ModifierSheet` (LaunchedEffect) | Open modifier sheet for item with 1-option required group |
| U7 | Tab nickname capped at 30 chars with counter | `NewTabDialog` | Type >30 chars in Known As field |
| U8 | Pending tips empty state is clear in My Tips screen | `MyTipsScreen` (Pending Tips tab) | Clear all pending tips → "No pending tips / You're all set" message |
| U9 | Persistent amber banner shown when send-to-kitchen fails | `OrderMainContent` (criticalError state) | Simulate send failure → banner persists until ✕ tapped |

## Dual Pricing Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| DP1 | Android and web order panel MUST display identical cash and card totals for the same Order ID. Canonical rule: `cardTotal = cashTotal × (1 + cashDiscountPercent/100)` — surcharge is applied POST-TAX to the full cash total, not pre-tax to the subtotal. Any change to order panel price display on either platform must verify this invariant. Established: 2026-03-03. | `OrderViewModel.recalcSurcharge()` (Android); `usePricing.ts` (web) | Compare same Order ID side-by-side on Android panel and web order panel — cash totals must match, card totals must match |
| DP2 | `recalcSurcharge()` base must be `order.total` (post-tax cash total), never `subtotal - discountTotal` (pre-tax). The missing `subtotal × pct × taxRate` cross-term causes customer-visible divergence. | `OrderViewModel.recalcSurcharge()` | Order with tax: verify `surchargeTotal = cashTotal × pct/100`, not `(subtotal-discount) × pct/100` |
| DP3 | No "Card Fee", "Non-Cash Adjustment", or separate surcharge line may appear in any UI surface (Android totals, Android PaymentSheet, web order panel, web receipt) when dual pricing is active. Card price is the primary/advertised price; cash total is a secondary breakdown. Any change to totals display on either platform must verify this invariant. Established: 2026-03-03. | `OrderTotalsSection.kt` (Android); `Receipt.tsx` + `OrderPanel.tsx` (web) | Enable dual pricing, place a card order → confirm: (1) no fee/surcharge line anywhere, (2) card total shown first/prominently, (3) cash breakdown secondary. Cross-check same Order ID on Android and web. |
| DP4 | All UI surfaces that display dual-pricing totals (order panel, payment sheet, payment buttons) must derive their values from the **same shared source**: Android = `OrderUiState` fields; Web POS = props from `usePricing`. No surface may compute its own `cardTotal` or `cashTotal` from a separate data path. `"Save $X by paying with cash!"` savings message is **required** (not a DP3 violation) and must appear inside the expandable totals section when dual pricing is active. Established: 2026-03-03. | `OrderTotalsSection.kt`, `SendButtonRow.kt`, `PaymentSheet.kt` (all read from `OrderUiState`); `OrderPanelActions.tsx` (all read from `usePricing` props) | Enable dual pricing: open order panel + payment sheet side-by-side → cash and card totals must be identical across all three composables on Android, and across web panel + payment processor view. |

## Process Safety Invariants

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| PR1 | `currentOrderId` restored after process death | `OrderViewModel` (savedStateHandle) | Kill app process mid-order → reopen → active order restored |
| PR2 | Rapid item taps debounced (300ms) | `OrderViewModel.onItemClicked()` | Tap same item 5× quickly → only first tap registers within 300ms window |
| PR3 | Item quantity capped at 999 | `AddItemUseCase` (.coerceAtMost) | Tap same item 1000× → qty stops at 999 |
| PR4 | Close Tab tip field resets on every re-open | `CloseTabSheet` (remember(closeTabNonce)) | Open close-tab, enter tip, dismiss, reopen → tip field is blank |

## Permission Security Invariants

| ID | Invariant | How to verify |
|----|-----------|---------------|
| PS1 | Adding items to another employee's order requires POS_EDIT_OTHERS_ORDERS | POST /api/orders/[id]/items without permission → 403 |
| PS2 | Any item submitted with a price differing from its menu price by >$0.01 requires MGR_OPEN_ITEMS (except weight-based, pizza, and timed-rental items) | POST items with custom price without permission → 403 |
| PS3 | Editing an order item that has left 'pending' kitchen status (sent/cooking/ready/delivered) requires MGR_EDIT_SENT_ITEMS | PUT /api/orders/[id]/items/[itemId] on sent item without permission → 403 |
| PS4 | Shift close with absolute cash variance >$5 requires MGR_CASH_VARIANCE_OVERRIDE; response includes code: 'VARIANCE_OVERRIDE_REQUIRED' and variance amount | PUT /api/shifts/[id] close with large variance without permission → 403 with code |
| PS5 | Tax exemption (isTaxExempt=true) on an Order requires MGR_TAX_EXEMPT; once set, calculateOrderTotals and calculateSimpleOrderTotals both apply taxRate=0 for all subsequent recalculations | Set isTaxExempt without permission → 403; verify taxTotal=0 after setting |

## Sync & Security Hardening (2026-03-10)

> Added after comprehensive 6-agent penetration test. These invariants protect against data loss, double-charging, and auth bypass.

### Payment Safety (5)
- **PAY1**: Tip amount MUST NOT exceed 500% of payment amount — enforced in pay/route.ts post-Zod validation
- **PAY2**: Split child payments MUST NOT exceed parent order total — aggregate check against all completed sibling payments
- **PAY3**: PendingDeduction with status `succeeded` or `dead` MUST NOT be reset to `pending` on re-pay — prevents double inventory deduction
- **PAY4**: All Payment mutations on NUC (adjust-tip, refund, void) MUST set `lastMutatedBy: 'local'` — required for upstream sync replication
- **PAY5**: All Order total mutations on NUC (tip adjust, refund tip reduction, commission recalc) MUST set `lastMutatedBy: 'local'`

### Sync Safety (6)
- **SYNC1**: Downstream sync HWM (`maxSyncedAt`) MUST only advance for successfully synced rows — failed rows must retry on next cycle
- **SYNC2**: FulfillmentEvent creation in `handleCloudFulfillment` MUST check for existing events by orderId — prevents duplicate printing
- **SYNC3**: `handleCloudDeduction` MUST NOT use SELECT-before-INSERT pattern — rely solely on `ON CONFLICT ("orderId") DO NOTHING`
- **SYNC4**: Socket dispatch in downstream sync MUST emit at most one `dispatchOpenOrdersChanged` per location per sync cycle — prevents client-side event storms
- **SYNC5**: Upstream sync `syncedAt` stamps MUST be individually try/caught — one failure must not block stamping of other rows in the batch
- **SYNC6**: Shared API routes executing on both NUC and Vercel MUST use `process.env.VERCEL ? 'cloud' : 'local'` for `lastMutatedBy` — hardcoding either value causes silent sync loss in the other environment

### Cellular Auth (4)
- **AUTH1**: `CELLULAR_CLAIM_KEY` env var MUST be non-empty for cellular-exchange endpoint to function — returns 503 if unconfigured
- **AUTH2**: `isRevokedFromDb()` MUST be fail-closed — DB errors return `true` (revoked), not `false` (allowed)
- **AUTH3**: `x-device-fingerprint` header MUST be validated when JWT contains `deviceFingerprint` — omitting header = 401 rejection
- **AUTH4**: Proxy `matchesRouteList()` MUST normalize paths via `normalizePath()` — prevents path traversal bypass of HARD_BLOCKED routes

### Inventory (2)
- **INV1**: `deductInventoryForOrder()` MUST return `success: false` when a paid/closed order has 0 items — prevents false-succeeded deductions when OrderItems haven't synced yet
- **INV2**: Modifier creation API MUST return 409 (not 500) on unique constraint violation — Prisma error code P2002 check in catch block

## Tax-Inclusive Pricing Invariants (2026-03-15)

> Added after full-stack tax-inclusive implementation across 3 repos. These invariants prevent tax miscalculation for locations with tax-inclusive pricing.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| TAX1 | `isTaxInclusive` MUST be stamped on OrderItem at creation and NEVER re-resolved after — it survives splits, transfers, comps, voids | `prepareItemData()` in `item-calculations.ts`; `isItemTaxInclusive()` in `order-calculations.ts` | Enable inclusive pricing, add item, split order, transfer item → `isTaxInclusive` unchanged throughout |
| TAX2 | Items with no `categoryType` (manual charges, open items) MUST default to `isTaxInclusive: false` (exclusive) | `isItemTaxInclusive()` — returns `false` when `categoryType` is null/undefined | Add open-price item with no category on inclusive location → exclusive tax applied |
| TAX3 | `calculateSplitTax()` with `inclusiveSubtotal = 0` MUST return `taxFromInclusive = 0` (pure no-op for exclusive-only locations) | `order-calculations.ts:405` — guard `inclusiveSubtotal > 0` | All-exclusive location: verify `taxFromInclusive = 0` on every order |
| TAX4 | Every DB write of `taxTotal` MUST also write `taxFromInclusive` and `taxFromExclusive` — no path may store one without the other | All order mutation routes, split routes, comp/void operations | Audit any route that calls `tx.order.update` with `taxTotal` — both split fields must be present |
| TAX5 | `total = subtotal + taxFromExclusive - discount + tip` — inclusive tax is NEVER added to total | `calculateOrderTotals()` line 288; all split domain files; checkout engine | Place order with only inclusive items → total equals subtotal (tax backed out, not added) |
| TAX6 | `taxInclusiveLiquor` and `taxInclusiveFood` are derived from DB TaxRule records in bootstrap, not stored as user settings | `bootstrap/route.ts` lines 273-312 | Change TaxRule `isInclusive` → bootstrap returns updated flags on next device sync |
| TAX7 | Changing TaxRule.isInclusive does NOT retroactively update existing OrderItem.isTaxInclusive stamps — only new items get the new treatment | By design — `isTaxInclusive` locked at creation | Toggle inclusive flag, verify existing open order items unchanged, new items get new flag |
| TAX8 | `calculateSplitTax()` with `inclusiveTaxRate = undefined` MUST fall back to `taxRate` (backward compat for locations without separate inclusive rate) | `order-calculations.ts:404` — `inclRate = inclusiveTaxRate ?? taxRate` | Location with single tax rule: verify `calculateSplitTax` uses same rate for both |
| TAX9 | Android `TaxSplitHelper.compute()` MUST produce identical output to server `calculateSplitTax()` for the same inputs — verified by golden parity tests | `TaxSplitHelper.kt`; `order-calculations.ts` | Run same 10+ test vectors on both platforms → outputs match to the cent |
| TAX10 | Reports MUST use stored `taxFromInclusive` and `taxFromExclusive` values — NEVER recompute tax from rate for historical orders | `daily/route.ts`, `employee-shift/route.ts`, `order-history/route.ts` | Change inclusive rate, verify old order reports unchanged |
| TAX11 | Employee-shift report `grossSales` MUST subtract `taxFromInclusive` before adding `totalTax` — prevents double-counting embedded tax | `employee-shift/route.ts` — `preTaxGrossSales = adjustedGrossSales - totalTaxFromInclusive` | Place all-inclusive order, close shift, verify grossSales = subtotal - discount (not subtotal + tax) |
| TAX12 | Daily report category breakdown MUST back out inclusive tax from `gross` for inclusive categories — prevents inflated category totals | `daily/route.ts` — `inclusive_gross` SQL column + JS tax back-out | Place inclusive item, run daily report, verify category gross = item price - backed-out tax |

## Client-Generated ID Invariants (2026-03-16)

> Added after duplicate-item bug caused by server cuid vs client UUID mismatch. This invariant prevents entity duplication across all Android clients.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| CLID1 | Every `OrderItem` created by an Android client MUST have its `id` set to the client-provided `lineItemId` (UUID v4). Server MUST NOT generate a different ID. Local event MUST use the same `lineItemId`. Violation = duplicate items. | `AddItemUseCase.kt` (generates UUID), `item-operations.ts` (uses `lineItemId` as `id`), `OrderMutationRepository.kt` (passes to event) | Add item on Android → verify server `OrderItem.id` matches local `CachedOrderItem.id` matches `ITEM_ADDED` event `lineItemId` — all three identical |

See `docs/guides/STABLE-ID-CONTRACT.md` for the full contract.

## Tenant Scope Deadlock Invariant (2026-03-20)

> Added after a deadlock in `resolveTenantLocationId()` caused EVERY venue-scoped Vercel route to hang until 504 timeout. Non-scoped routes (health, cron) worked fine, masking the issue.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| TDL1 | `resolveTenantLocationId()` MUST use `$queryRawUnsafe` to look up the Location ID. It MUST NEVER call `getLocationId()`. Violation = deadlock (Promise waits for itself via inflight coalescing map). | `db-tenant-scope.ts:resolveTenantLocationId()` | Access any venue-scoped route on Vercel (e.g., `/api/menu` on `*.ordercontrolcenter.com`) — must return data, not 504 |

See `docs/guides/DATABASE-CONNECTION-RULES.md` for the full history.

## Dev Infrastructure Invariants (2026-03-16)

> Added after 4-root-cause dev server outage. These invariants prevent dev environment regressions.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| DEV1 | HSTS (`Strict-Transport-Security`) MUST only be sent in production — never on localhost dev | `next.config.ts` headers config (production guard) | Run `npm run dev`, inspect response headers on `localhost:3006` — no HSTS header present |
| DEV2 | Sentry MUST use dynamic `import()` in `instrumentation.ts` — no static imports of `@sentry/nextjs` at module top level | `src/instrumentation.ts` (`register()` function) | Run `npm run dev` — server starts without deadlock; `grep` for `import.*@sentry/nextjs` in instrumentation.ts returns zero static imports |
| DEV3 | `resolveTenantLocationId` recursion guard MUST be request-scoped (AsyncLocalStorage), never module-scoped | `src/lib/db.ts` + `src/lib/request-context.ts` | Concurrent requests to tenant-scoped routes — no infinite recursion, no cross-request interference |

## Reservation System Invariants (2026-03-17)

> Added after full reservation engine build. These invariants protect the reservation state machine, multi-tenant isolation, deposit lifecycle, customer matching, and socket dispatch timing.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| RES1 | ALL reservation status changes MUST go through `transition()` in state-machine.ts — no direct `db.reservation.update({ status })` allowed | `src/lib/reservations/state-machine.ts` — all API routes call this function | Attempt to update `status` via raw SQL or direct Prisma update — must be rejected by code review |
| RES2 | ALL `[id]` routes MUST verify `reservation.locationId === callerLocationId` before returning or modifying data | All reservation `[id]` API routes | Create reservation on location A, attempt to access from location B — must get 404 |
| RES3 | Deposit status changes MUST write ReservationEvent audit entries | `src/app/api/reservations/[id]/deposit/route.ts`, `src/app/api/public/reservations/[id]/deposit/route.ts` | Process deposit payment → verify ReservationEvent with type `deposit_*` created |
| RES4 | Socket dispatch (`dispatchReservationChanged`) MUST happen AFTER transaction commit, never inside | All `transition()` callers in API routes | Verify no `dispatchReservationChanged` calls inside `db.$transaction()` blocks |
| RES5 | Customer matching (`findOrCreateCustomer`) MUST run on every reservation creation path including waitlist bridge | `src/app/api/reservations/route.ts`, `src/app/api/public/reservations/route.ts`, waitlist bridge | Create reservation with existing customer phone — must link to existing Customer record, not create duplicate |
| RES6 | Pending reservations MUST have `holdExpiresAt` set (enforced by DB CHECK constraint) | Migration 067 CHECK constraint, `src/lib/reservations/state-machine.ts` | Attempt to create pending reservation without holdExpiresAt — DB rejects |

## Delivery Management Invariants (2026-03-17)

> Added after full delivery MVP build. These invariants protect the delivery state machine, feature gating, address immutability, tip holding ledger, and proof of delivery.

| # | Invariant | Where Enforced | Test Trigger |
|---|-----------|----------------|--------------|
| DELIV1 | `advanceDeliveryStatus()` is the ONLY way to change delivery order status. Direct SQL UPDATE on status column is forbidden. | `src/lib/delivery/state-machine.ts` — all API routes call this function | Attempt to update `deliveryStatus` via raw SQL or direct Prisma update — must be rejected by code review |
| DELIV2 | Delivery requires BOTH MC `deliveryModuleEnabled=true` AND venue `delivery.enabled=true`. Missing config = disabled (fail-closed). | `src/lib/delivery/feature-check.ts` — `isDeliveryFeatureActive()` | Disable MC flag, verify all delivery routes return 403. Disable venue flag with MC enabled, verify same. |
| DELIV3 | `addressSnapshotJson` is frozen at `assigned` state. NEVER overwritten after. Dispatch reads from snapshot only. | `advanceDeliveryStatus()` — snapshot captured on transition to `assigned` | Assign order, then update customer address — dispatch must still show original snapshot address |
| DELIV4 | Pre-assignment tips go to `system:delivery_holding:{locationId}`. Reallocated on driver assignment. Kitchen split deferred until `delivered`. | `src/lib/delivery/tip-reallocation.ts`, `src/lib/domain/tips/delivery-tip-split.ts` | Pay delivery order before driver assigned — tip must appear in holding ledger, not employee ledger. Assign driver — tip moves to driver. Mark delivered — kitchen split fires. |
| DELIV5 | One active run per driver. DB unique partial index `DeliveryRun_driver_active_unique`. Application also validates before INSERT. | Migration 066 (DB index), run creation route | Attempt to create second active run for same driver — must get 409 |
| DELIV6 | `proofMode` frozen at dispatch time. `evaluateEffectiveProofMode()` runs once. Result stored on `DeliveryOrder.proofMode`. Never re-evaluated. | `src/lib/delivery/proof-resolver.ts`, `advanceDeliveryStatus()` at `dispatched` transition | Change proof settings after dispatch — existing order must retain original proof mode |

---

## How to Use This List

1. **Before merging** any PR that touches a file in the "Where Enforced" column, manually walk through the "Test Trigger" scenario on device or in the simulator.
2. **After a schema change** to `Payment`, `Order`, `Shift`, or `TipLedgerEntry` — re-run P1–P5 and T1–T5.
3. **After any event sourcing change** — re-run O2 and O3.

The original 31 invariants cover bugs found during the Android bartender audit (2026-03-03). The 16 sync & security invariants (2026-03-10) cover vulnerabilities found during the 6-agent penetration test. The 9 tax-inclusive invariants (2026-03-15) cover the full-stack tax-inclusive pricing implementation. The 1 client-generated ID invariant (2026-03-16) prevents duplicate entities from ID mismatch. The 3 dev infrastructure invariants (2026-03-16) prevent dev environment regressions. The 6 reservation system invariants (2026-03-17) protect the reservation state machine, deposits, and customer matching. The 6 delivery management invariants (2026-03-17) protect the delivery state machine, feature gating, and tip flow. All 76 represent the highest re-regression risk.
