# GWI POS — Flow Index

> **Read a flow doc when:** you are changing any feature that touches a critical system journey. If your change is anywhere in the path below, read the full flow doc before writing code.

---

## What Is a Flow Doc?

Flow docs trace a complete system journey from trigger to final state:

**Trigger → UI → API → Event Store → Snapshot → Socket → Side Effects → Edge Cases**

They are the answer to: "What actually happens end-to-end when a bartender closes a tab?"

---

## Flow Registry

| Flow | File | Integrity Concern | Key Features |
|------|------|------------------|--------------|
| **Order Placement** | [order-placement.md](order-placement.md) | Kitchen integrity, event-sourcing | Orders, Menu, KDS, Android |
| **Card Payment** | [card-payment.md](card-payment.md) | Money integrity, reporting accuracy | Payments, Tips, Hardware, CFD |
| **Offline Payment (SAF)** | [offline-payment-saf.md](offline-payment-saf.md) | Money integrity, offline resilience | Payments, Offline Sync |
| **Tab Open → Close** | [tab-open-to-close.md](tab-open-to-close.md) | Money integrity, pre-auth lifecycle | Tabs, Payments, Tips |
| **Shift Start → Close** | [shift-start-to-close.md](shift-start-to-close.md) | Payroll integrity, tip allocation | Shifts, Tips, Employees, Time Clock |
| **Android Sync** | [android-sync.md](android-sync.md) | Sync integrity, event ordering | Android, Orders, Offline Sync |
| **KDS Bump** | [kds-bump.md](kds-bump.md) | Kitchen integrity, order status | KDS, Orders, Hardware |
| **Void vs Refund** | [void-vs-refund.md](void-vs-refund.md) | Money integrity, audit trail | Payments, Orders, Reports |
| **Employee Login** | [employee-login.md](employee-login.md) | Access control, location context | Employees, Roles, Settings |
| **Offline Recovery** | [offline-recovery.md](offline-recovery.md) | Sync integrity, data consistency | Offline Sync, Orders, Payments |
| **Gift Card Payment** | [gift-card-payment.md](gift-card-payment.md) | Money integrity | Payments, Gift Cards |
| **Discount Application** | [discount-application.md](discount-application.md) | Revenue integrity | Discounts, Orders, Roles, Reports |

---

## How Flows Relate to Each Other

```
Employee Login ──────────────────────────────────► Session active
                                                         │
                                        ┌────────────────┼────────────────┐
                                        ▼                ▼                ▼
                               Order Placement      Tab Open→Close    Shift Start
                                        │                │                │
                                        ▼                ▼                │
                                    KDS Bump        Card Payment          │
                                        │                │                │
                                        └────────────────┘                │
                                                     │                    │
                                          ┌──────────┼──────────┐        │
                                          ▼          ▼          ▼        ▼
                                    Void/Refund  Offline    Android    Shift Close
                                                Payment      Sync
                                                  SAF
                                                   │
                                                   ▼
                                            Offline Recovery
```

---

## Invariants Quick-Ref

Critical invariants that span multiple flows. If any of these break, multiple features are compromised.

| Invariant | Flows | Rule |
|-----------|-------|------|
| **Event-sourced orders** | Order Placement, Android Sync, KDS Bump | NEVER write to `db.order` without `emitOrderEvent()`. `OrderSnapshot` is the single source of truth. |
| **Datacap only** | Card Payment, Offline Payment, Void/Refund | No Stripe/Square/Braintree. All payment code in `src/lib/datacap/`. |
| **Money before receipts** | Card Payment, Tab Close | Payment record created first. Print is fire-and-forget — NEVER block a payment on the printer. |
| **Settlement determines path** | Void vs. Refund, Card Payment | `settledAt IS NULL` → void. `settledAt IS NOT NULL` → refund. NEVER cross paths. |
| **Tip immutability** | Card Payment, Shift Close, Tab Close | Tips are immutable after 24h. Shift close seals all tip allocations. |
| **Server sequence authority** | Android Sync, Order Placement | Android NEVER generates `serverSequence`. POS assigns it. Conflicts resolve to highest serverSequence. |
| **No Neon from API routes** | Offline Recovery, all mutations | `db.*` = local PG only. NEVER point NUC `DATABASE_URL` to neon.tech. |
| **Clock discipline** | All mutations | DB-generated `NOW()` only. NEVER use client timestamps. |
| **requirePermission always** | Employee Login, all routes | NEVER skip `requirePermission()`. NEVER use `{ soft: true }`. |
| **KDS from snapshot** | KDS Bump, Order Placement | KDS reads `OrderSnapshot`, never `db.order` directly. |

---

## Template

New flows must follow the standard template: `_TEMPLATE.md`

---

## Adding a New Flow

1. Copy `_TEMPLATE.md` → create `docs/flows/[flow-name].md`
2. Add it to the Flow Registry table above
3. Add any new cross-flow invariants to the Invariants Quick-Ref
4. Add it to CLAUDE.md Doc Routing Table if it covers a new area
5. Note the change in `docs/logs/LIVING-LOG.md`

---

## Maintenance Rule

When a flow changes (new API routes, new socket events, schema migrations), update the flow doc in the same PR/commit. Flow docs that are out of sync with code are worse than no flow docs.

---

*Last updated: 2026-03-03*
