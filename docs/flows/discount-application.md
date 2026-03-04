# Flow: Discount Application

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** A server or manager applies a discount to an open order (order-level) or to an individual item (item-level) via the POS web UI or Android register.

**Why it matters:** Revenue integrity and reporting accuracy. A discount reduces the payment total, so a miscalculated or permission-bypassed discount directly reduces revenue. All discounts must be traced to an employee, stored as immutable records (never modifying item prices), and reflected consistently in OrderSnapshot, reports, and all connected terminals.

**Scope:** `gwi-pos` (discount route, order totals, event emitter, socket dispatch), `gwi-android-register` (`ApplyDiscountUseCase`). CFD is not involved in discount application.

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `requireDiscountApproval` and `discountApprovalThreshold` in `Location.settings.approvals` govern when manager override is required |
| Hardware required | None — discount application is software-only |
| Permissions required | `manager.discounts` (`PERMISSIONS.MGR_DISCOUNTS`) — required on every apply and remove operation. Employees without this permission who exceed `defaultMaxDiscountPercent` are blocked with a 403. |
| Online / offline state | NUC must be reachable. Discount application is an online-only mutation — there is no outbox path for discounts. |
| Prior state | An open `Order` with `status: 'open'` or `'in_progress'` and `isClosed: false`; the employee must have `manager.discounts` permission or be within the `defaultMaxDiscountPercent` threshold |

---

## 3. Sequence (Happy Path)

```
1.  [CLIENT]      Server selects item(s) in order panel or selects order
                  Taps "Discount" button
                  Chooses discount type:
                    a) Preset rule (from DiscountRule list)
                    b) Custom: type = 'percent' | 'fixed', value, name, reason
                  If approval required (above threshold or requireDiscountApproval):
                    Manager enters PIN → approvedById sent with request

2.  [API]         POST /api/orders/[id]/discount
                  Body: { discountRuleId?, type?, value?, name?, reason?,
                           employeeId, approvedById? }
                  → withVenue() — resolves locationId
                  → requirePermission(employeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
                     (return 403 if unauthorized)
                  → load Order with discounts (where deletedAt: null) + location
                  → verify order.status === 'open' | 'in_progress'
                  → parseSettings(location.settings) → approvalSettings

3.  [API]         Toggle check (preset rule path only):
                  If discountRuleId already applied to this order:
                    → soft-delete existing OrderDiscount (deletedAt: now())
                    → recalculate totals without that discount
                    → update Order.discountTotal, taxTotal, total
                    → emitOrderEvent 'DISCOUNT_REMOVED' (fire-and-forget)
                    → socket dispatches (fire-and-forget)
                    → return { toggled: 'off' } — STOP, do not apply new discount

4.  [API]         Validation (apply path):
                  → rule.isActive check (preset rules)
                  → rule.maxPerOrder check (prevent over-application)
                  → rule.isStackable check (reject if false and other discounts exist)
                  → calculate discountAmount:
                       percent: subtotal × (value / 100), capped at rule.maxAmount
                       fixed: value
                  → per-role limit: if employee lacks manager.discounts and
                       discountPercent > defaultMaxDiscountPercent → 403
                  → approval check: if requiresApproval and !approvedById → 403
                  → approver validation: requirePermission(approvedById, ...) if provided
                  → cap: discountAmount capped at (subtotal − currentDiscountTotal)
                  → reject if discountAmount <= 0

5.  [DB]          db.orderDiscount.create {
                    locationId, orderId, discountRuleId,
                    name, amount: discountAmount,
                    percent: discountPercent | null,
                    appliedBy: employeeId,
                    isAutomatic: false,
                    reason
                  }

6.  [DB]          If approvedById present:
                  void db.auditLog.create {
                    action: 'discount_override',
                    entityType: 'order', entityId: orderId,
                    details: { discountId, discountName, discountAmount,
                               discountPercent, requestedBy, approvedBy, reason }
                  }.catch(err => console.error('[AuditLog] ...'))

7.  [DB]          Order totals recalculated:
                  newDiscountTotal = currentDiscountTotal + discountAmount
                  calculateSimpleOrderTotals(subtotal, newDiscountTotal, settings)
                  db.order.update {
                    discountTotal, taxTotal, total,
                    version: { increment: 1 }
                  }

8.  [EVENTS]      void emitOrderEvent(locationId, orderId, 'DISCOUNT_APPLIED', {
                    discountId, type: 'percent'|'fixed',
                    value: discountPercent ?? discountAmount,
                    amountCents: discountAmount * 100,
                    reason
                  }).catch(console.error)

9.  [SNAPSHOT]    Reducer applies DISCOUNT_APPLIED →
                  OrderSnapshot { discountTotalCents += amountCents,
                    totalCents recalculated, lastEventSequence: N }

10. [BROADCAST]   void dispatchOrderTotalsUpdate(locationId, orderId, {
                    subtotal, taxTotal, tipTotal, discountTotal, total,
                    commissionTotal
                  }).catch()
                  void dispatchOpenOrdersChanged(locationId, { orderId }).catch()
                  void dispatchOrderSummaryUpdated(locationId, summary).catch()
                  → 'order:event' socket emitted to all terminals in location room
                  → 'order:summary-updated' emitted for Android cross-terminal sync

11. [SIDE EFFECTS — all fire-and-forget]
                  KDS: discount changes are reflected in OrderSnapshot that KDS reads
                  Reports: OrderDiscount records feed GET /api/reports/discounts
                  Android: receives 'order:event' DISCOUNT_APPLIED → rebuilds local snapshot
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `DISCOUNT_APPLIED` (OrderEvent) | `{ discountId, type: 'percent'\|'fixed', value, amountCents, reason? }` | `emitter.ts` | Android, POS UI, reports | After OrderDiscount record created and order totals updated |
| `DISCOUNT_REMOVED` (OrderEvent) | `{ discountId, lineItemId?: null }` | `emitter.ts` | Android, POS UI, reports | Toggle path: after soft-delete of OrderDiscount |
| `order:event` (socket) | `{ type: 'DISCOUNT_APPLIED'\|'DISCOUNT_REMOVED', orderId, serverSequence, ... }` | `emitter.ts` | All terminals in location room | After DB persist |
| `order:totals-updated` (socket) | `{ orderId, subtotal, discountTotal, taxTotal, total }` | `socket-dispatch.ts` | All terminals | After order totals recalculated |
| `order:summary-updated` (socket) | `{ orderId, discountTotalCents, totalCents, ... }` | `socket-dispatch.ts` | Android terminals | After snapshot update |
| `orders:changed` (socket) | `{ trigger: 'created', orderId }` | `socket-dispatch.ts` | POS order list | After totals update |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderDiscount` | New row: `amount`, `percent`, `name`, `appliedBy`, `discountRuleId`, `reason` | Step 5 |
| `AuditLog` | New row: `action: 'discount_override'`, `details.approvedBy` | Step 6 (only when `approvedById` present) |
| `Order` | `discountTotal`, `taxTotal`, `total`, `version: +1` | Step 7 |
| `OrderEvent` | New row: `type: 'DISCOUNT_APPLIED'`, `serverSequence` | Step 8 |
| `OrderSnapshot` | `discountTotalCents`, `totalCents` recalculated, `lastEventSequence` | Step 9 |

**Toggle path (same rule applied twice):**
| Record | Fields Changed | When |
|--------|---------------|------|
| `OrderDiscount` | `deletedAt: now()` (soft delete) | Step 3 |
| `Order` | `discountTotal`, `taxTotal`, `total`, `version: +1` | Step 3 |
| `OrderEvent` | New row: `type: 'DISCOUNT_REMOVED'` | Step 3 |
| `OrderSnapshot` | `discountTotalCents` reduced, `totalCents` recalculated | After DISCOUNT_REMOVED |

**Snapshot rebuild points:** Step 9 — after `DISCOUNT_APPLIED` event. Also on toggle path after `DISCOUNT_REMOVED` event.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Permission denied** | `requirePermission()` returns 403 before any DB work. OrderDiscount is never created. Client receives `{ error: 'Unauthorized' }`. |
| **Discount exceeds employee's per-role limit** | If `discountPercent > defaultMaxDiscountPercent` and employee lacks `manager.discounts`, API returns 403: `{ error: 'Discount exceeds your limit. Manager approval required.', requiresApproval: true, maxPercent: N }`. Client prompts for manager PIN. |
| **Manager approval required but not provided** | `requiresApproval` is true but `approvedById` is absent. API returns 403: `{ error: 'Manager approval required', requiresApproval: true }`. Client prompts for manager PIN and resends with `approvedById`. |
| **Approver PIN lacks permission** | `requirePermission(approvedById, ...)` fails → 403: "Approver does not have discount permission". |
| **Toggle behavior (same preset rule applied twice)** | If `discountRuleId` already exists in active `OrderDiscount` records, the route soft-deletes it (toggle off) and returns `{ toggled: 'off' }` instead of creating a second discount. |
| **Non-stackable rule with existing discounts** | If `rule.isStackable === false` and `order.discounts.length > 0`, API returns 400: "This discount cannot be combined with other discounts". |
| **maxPerOrder exceeded** | If `order.discounts.filter(d => d.discountRuleId === rule.id).length >= rule.maxPerOrder`, API returns 400. |
| **Discount would exceed subtotal** | `discountAmount` is capped at `subtotal − currentDiscountTotal`. If cap results in `discountAmount <= 0`, API returns 400: "No discount amount to apply". Discount never makes total negative. |
| **Order not open** | `order.status !== 'open' && order.status !== 'in_progress'` → 400: "Cannot add discount to a closed order". |
| **Manager approval for off-site manager** | Remote approval (6-digit SMS code via `docs/features/remote-void-approval.md`) — same approval code flow used for voids. Manager receives SMS, provides code, `approvedById` is set to the remote manager's employee ID. |
| **Auto-discounts (happy hour, time-based)** | Automatic discounts set `isAutomatic: true` and `appliedBy: null`. They are triggered by a separate scheduler, not this flow. See `docs/features/auto-discounts.md` (planned). |
| **Coupon code discount** | Coupon codes use `Coupon` + `CouponRedemption` model. Applied via a separate coupon-redemption path; the result flows into the same `OrderDiscount` record structure with `discountRuleId: null` and `isAutomatic: false`. |
| **Item-level discount** | `POST /api/orders/[id]/items/[itemId]/discount` — same permission gates, same event type (`DISCOUNT_APPLIED` with `lineItemId`), creates `OrderItemDiscount` instead of `OrderDiscount`. Amount calculated from `orderItem.total`, not `order.subtotal`. |
| **Remove a discount** | `DELETE /api/orders/[id]/discount?discountId=X&employeeId=Y` — requires `manager.discounts`. Soft-deletes `OrderDiscount`, writes `AuditLog` with `action: 'discount_removed'`, recalculates totals, emits `DISCOUNT_REMOVED`. |
| **Comp (100% discount)** | Uses `POST /api/orders/[id]/comp-void` with `action: 'comp'`, not this route. Requires `manager.void_items` permission. Emits `COMP_VOID_APPLIED` event. Creates `VoidLog` entry. See `docs/features/discounts.md` §Comp/Void. |
| **Reconnect race** | Discount is server-side complete. On reconnect, `order:event` replay brings snapshot current. No partial state possible — `DISCOUNT_APPLIED` event is the source of truth. |
| **Android (offline)** | Android applies discount via `ApplyDiscountUseCase` which calls the same POS API. If NUC is unreachable, discount cannot be applied — there is no outbox for discounts. |

---

## 7. Invariants (Never Break These)

- **[INVARIANT-1]** Discounts NEVER directly modify `OrderItem.priceCents` or any item price field. All discounts are stored as separate `OrderDiscount` or `OrderItemDiscount` records. Item prices are immutable after creation.
- **[INVARIANT-2]** `requirePermission(employeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)` MUST run before any DB write. NEVER skip this check. NEVER use `{ soft: true }` on a discount permission check.
- **[INVARIANT-3]** Discount amounts are always calculated from the ORIGINAL item or order subtotal, never from an already-discounted price. There is no cascading discount math.
- **[INVARIANT-4]** Discount total can NEVER exceed order subtotal. The cap is enforced before `db.orderDiscount.create`. NEVER allow `Order.total` to go negative.
- **[INVARIANT-5]** Every discount applied with manager override (`approvedById` present) MUST create an `AuditLog` row with `action: 'discount_override'`. NEVER apply a manager-overridden discount without audit logging it.
- **[INVARIANT-6]** Every discount apply and remove MUST emit `DISCOUNT_APPLIED` or `DISCOUNT_REMOVED` via `emitOrderEvent()`. NEVER modify `Order.discountTotal` without a corresponding OrderEvent.
- **[INVARIANT-7]** OrderDiscount records are NEVER hard-deleted. Use soft delete (`deletedAt: new Date()`). This preserves the audit trail and report accuracy for all historical discounts.
- **[INVARIANT-8]** `isStackable: false` discount rules cannot coexist with other discounts on the same order. The stackability check MUST run before `db.orderDiscount.create`. NEVER bypass this check.

If you break an invariant, the fix is: check `OrderEvent` records for `DISCOUNT_APPLIED` / `DISCOUNT_REMOVED` to reconstruct the intended discount history; recalculate `Order.discountTotal` from active `OrderDiscount` records; rebuild `OrderSnapshot` from the full event log; and add a compensating `DISCOUNT_REMOVED` event if a discount was applied without being recorded.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/discounts.md` | Full discount feature: data models, business rules, approval settings, comp/void, reporting |
| `docs/features/roles-permissions.md` | `manager.discounts` and `manager.void_items` permission keys; `defaultMaxDiscountPercent` threshold |
| `docs/features/orders.md` | Order status lifecycle; `OrderSnapshot` as source of truth; event sourcing model |
| `docs/features/reports.md` | `GET /api/reports/discounts` — discount records feed this report directly |
| `docs/features/remote-void-approval.md` | SMS-based remote manager approval for above-threshold discounts |
| `docs/guides/ORDER-LIFECYCLE.md` | `DISCOUNT_APPLIED` / `DISCOUNT_REMOVED` event sourcing; snapshot rebuild rules |
| `docs/guides/CODING-STANDARDS.md` | Fire-and-forget pattern for socket dispatches; `void doWork().catch(console.error)` |

### Features Involved
- **Discounts** — `DiscountRule`, `OrderDiscount`, `OrderItemDiscount` models; approval workflow; toggle behavior; stackability; comp/void as related operation
- **Orders** — `DISCOUNT_APPLIED` / `DISCOUNT_REMOVED` events; `OrderSnapshot.discountTotalCents` recalculation; order total update; event sourcing
- **Roles & Permissions** — `manager.discounts` gate; per-role `defaultMaxDiscountPercent` limit; manager override with `AuditLog`
- **Reports** — `OrderDiscount` records feed discount usage report; `byEmployee`, `byRule`, `byDay` breakdowns
- **Android** — `ApplyDiscountUseCase` calls this API; receives `DISCOUNT_APPLIED` event via `order:event` socket

---

*Last updated: 2026-03-03*
