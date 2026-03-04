# Feature: Pay-at-Table (PAT)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Pay-at-Table (PAT) is a server-facing iPad kiosk surface that lets a server bring a card reader to a table and process payment for an open order without returning to the POS terminal. The server navigates to `/pay-at-table?orderId=&readerId=&employeeId=` on an iPad, sees the order summary, optionally splits the check, selects a tip, and drives a Datacap card charge via `POST /api/datacap/sale`. When all splits are complete, the iPad calls `POST /api/orders/[id]/pat-complete` which marks the order paid, creates `Payment` records, closes the tab if the order is a bar tab, emits order events, and dispatches socket updates to all terminals. A `pat:pay-request` socket event notifies the bound POS terminal that a tableside payment is in progress; the terminal responds with a `pat:pay-result` event that the iPad listens for to advance its state machine.

## Status

`Partial` — Core flow is implemented (iPad page, split, tip, Datacap charge, pat-complete endpoint, socket handshake). The `pat:split-request` and `pat:split-result` event types are defined but not yet consumed by any handler. No admin UI exists to configure or monitor PAT devices. `SPLIT_REQUEST` / `SPLIT_RESULT` represent a future server-initiated split flow that has not been built.

---

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | iPad page, three UI components, pat-complete route, event type definitions, Datacap charge | Full |
| `gwi-android-register` | None | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |

---

## UI Entry Points

| Interface | Path | Notes |
|-----------|------|-------|
| iPad kiosk | `/pay-at-table?orderId=&readerId=&employeeId=` | Full-screen dark UI; requires query parameters. No navigation menu. |

The `/pay-at-table` route is listed in `cloud-auth.ts` as a public (unauthenticated) path — it does not require a POS session cookie. Access is controlled by the possession of valid `orderId`, `readerId`, and `employeeId` query parameters.

---

## Code Locations

### gwi-pos

| File | Purpose |
|------|---------|
| `src/app/(pos)/pay-at-table/page.tsx` | iPad page component. 6-state machine: `loading → summary → split → tip → processing → done/error`. Socket listener for `pat:pay-result`. Calls `POST /api/datacap/sale` and `POST /api/orders/[id]/pat-complete`. |
| `src/components/pay-at-table/TablePayment.tsx` | Order summary screen — displays items, subtotal, tax, total. Two actions: "Pay" and "Split". |
| `src/components/pay-at-table/SplitSelector.tsx` | Split count selection screen. |
| `src/components/pay-at-table/TipScreen.tsx` | Tip selection screen. Supports percentage chips and custom amount entry. |
| `src/app/api/orders/[id]/pat-complete/route.ts` | `POST /api/orders/[id]/pat-complete` — marks order paid, creates Payment record(s), closes bar tab if applicable, emits PAYMENT_APPLIED + ORDER_CLOSED events, dispatches socket updates. |
| `src/types/multi-surface.ts` | `PayAtTableRequestEvent`, `PayAtTableResultEvent`, `PAT_EVENTS` constant map |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/pat-complete` | `withVenue` (no permission check) | Finalise a pay-at-table payment. Body: `{ employeeId, totalPaid, tipAmount?, splits?: [{ amount, tipAmount?, authCode?, readerId? }] }`. Idempotent — returns success silently if order is already `paid`. |

The iPad also directly calls:
- `GET /api/orders/[id]` — load order summary on mount
- `POST /api/datacap/sale` — run each Datacap card charge (one per split)

---

## Socket Events

| Event | Constant | Direction | Description |
|-------|----------|-----------|-------------|
| `pat:pay-request` | `PAT_EVENTS.PAY_REQUEST` | iPad → POS terminal | Emitted when the iPad begins processing a payment. Payload: `{ orderId, readerId, tipMode, employeeId }`. Notifies the bound POS terminal that a tableside payment is in progress. |
| `pat:pay-result` | `PAT_EVENTS.PAY_RESULT` | POS terminal → iPad | Emitted by the POS terminal to report payment outcome. Payload: `{ orderId, success, amount, tipAmount?, cardLast4?, error? }`. The iPad listens for this to advance its state machine (e.g., move to next split or show done/error screen). |
| `pat:split-request` | `PAT_EVENTS.SPLIT_REQUEST` | Defined, not wired | Event type exists in `PAT_EVENTS` and `multi-surface.ts`. No handler emits or consumes it in any current route or component. |
| `pat:split-result` | `PAT_EVENTS.SPLIT_RESULT` | Defined, not wired | Same — defined only. |

The `pat:pay-request` is emitted by the iPad itself (client-side `socket.emit`). The server does not relay or intercept it. The POS terminal that receives it is expected to display a "Payment in progress at table" indicator, but no such UI is currently implemented on the terminal side.

---

## Payment Flow (Single or Split)

1. iPad loads order via `GET /api/orders/[id]` and shows `TablePayment` summary.
2. Server (employee) optionally selects a split count via `SplitSelector`.
3. For each split:
   a. `TipScreen` is shown with the per-split amount.
   b. Server selects tip. iPad emits `pat:pay-request` socket event to the terminal.
   c. iPad calls `POST /api/datacap/sale` with `{ readerId, invoiceNo: '{orderId}-{splitIndex}', amount: splitAmount + tip, tipMode: 'included' }`.
   d. If Datacap returns approved: advance to next split or proceed to step 4.
   e. If declined: show error screen. Server can retry.
4. After the last split is approved, iPad calls `POST /api/orders/[id]/pat-complete` with accumulated tip and (if splits provided) individual split records.
5. `pat-complete` route marks order `paid`, creates `Payment` rows, emits `PAYMENT_APPLIED` + `ORDER_CLOSED` order events, dispatches `orders:list-changed`, `tab:updated`, and (if table exists) `floor-plan:updated` socket events.

The `pat:pay-result` event is defined for the POS terminal to send back to the iPad (e.g., after the terminal confirms the Datacap result). In the current implementation, the iPad does not wait for `pat:pay-result` before advancing — it advances on the direct Datacap response. The socket listener for `pat:pay-result` on the iPad provides an alternative path (e.g., if a future version has the POS terminal drive the Datacap charge rather than the iPad).

---

## What Is NOT Built

The following are defined but not implemented:

- **`pat:split-request` / `pat:split-result`** — intended for a server-initiated split flow (e.g., POS terminal requests a split from the iPad). No emitter or consumer exists.
- **Terminal-side "payment in progress" indicator** — the `pat:pay-request` event has no UI handler on the POS terminal. The terminal does not currently display a notice when a tableside payment is in progress for one of its orders.
- **Admin configuration screen** — no page exists to list, pair, or monitor PAT iPads.
- **PAT-specific permission gating** — `pat-complete` requires only a valid venue session (`withVenue`). A dedicated permission key (e.g., `payments.pay_at_table`) does not exist.
- **Receipt delivery choice** — the `CFDReceiptChoiceEvent` in `multi-surface.ts` suggests a receipt delivery step on the CFD. No equivalent exists for PAT.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Creates `Payment` records via `pat-complete` route |
| Orders | Marks order `paid`, sets `paidAt`, updates `tipTotal`; emits `PAYMENT_APPLIED` + `ORDER_CLOSED` events |
| Tabs | Sets `tabStatus: 'closed'` on bar-tab orders; dispatches `tab:updated` socket event |
| Floor Plan | Dispatches `floor-plan:updated` when the order has a `tableId` |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Payments (Datacap) | PAT drives charges directly via `POST /api/datacap/sale`. Datacap offline (SAF) is not handled — PAT requires connectivity |
| Floor Plan | Order-to-table associations determine whether a floor plan update is dispatched after pat-complete |
| Hardware (Datacap readers) | `readerId` passed as query parameter to `/pay-at-table` must map to a configured Datacap reader at the location |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Event emission** — `pat-complete` must continue to emit `PAYMENT_APPLIED` and `ORDER_CLOSED` via `emitOrderEvents()`. These are MANDATORY for all payment paths (see `docs/guides/ORDER-LIFECYCLE.md`).
- [ ] **Idempotency** — `pat-complete` returns 200 silently if the order is already `paid`. Do not remove this guard; double-taps from the iPad can produce duplicate requests.
- [ ] **Split accumulation** — tip accumulates across splits using `accumulatedTipRef`. Any change to the split loop must preserve the running total to avoid undercounting tips in `pat-complete`.
- [ ] **SAF compatibility** — PAT does not use store-and-forward. If Datacap is offline, `POST /api/datacap/sale` will fail. There is no fallback path. Document this clearly to operations.

---

## Known Constraints & Limits

- No offline support. PAT requires the NUC to be reachable and Datacap to be online. A network interruption mid-payment leaves the order in an indeterminate state.
- `locationId` is passed as an empty string (`''`) in the `POST /api/datacap/sale` call from the iPad page: `locationId: '', // Will be resolved from reader`. This relies on the Datacap route resolving the location from the reader ID. Verify this assumption holds for all reader configurations.
- The iPad page does not re-authenticate the `employeeId` — it trusts the query parameter. An employee who is no longer active could still complete a payment if they have the URL.
- `pat:split-request` and `pat:split-result` are dead code. Do not build on top of them without first establishing what scenario they are intended to serve.
- No admin page exists to onboard or track PAT iPad devices. Device management (pairing a reader to an iPad session) is out of scope for the current implementation.

---

## Android-Specific Notes

Android does not participate in the PAT flow. The iPad and POS terminal communicate directly via socket events. The effects of a completed PAT payment (order marked paid, events emitted) flow to Android through the standard order event sync path.

---

## Related Docs

- **Feature doc:** `docs/features/payments.md`
- **Feature doc:** `docs/features/tabs.md`
- **Feature doc:** `docs/features/floor-plan.md`
- **Feature doc:** `docs/features/hardware.md`
- **Feature doc:** `docs/features/cfd.md` (multi-surface architecture context)
- **Guide:** `docs/guides/PAYMENTS-RULES.md`
- **Guide:** `docs/guides/ORDER-LIFECYCLE.md`
- **Guide:** `docs/guides/SOCKET-REALTIME.md`
- **Type definitions:** `src/types/multi-surface.ts`

---

*Last updated: 2026-03-03*
