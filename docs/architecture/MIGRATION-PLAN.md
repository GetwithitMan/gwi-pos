# GWI POS Migration Plan
## From Monolith to Domain Architecture

**Version:** 1.0
**Date:** 2026-02-04
**Status:** DRAFT - Awaiting Approval
**Author:** System Architect

---

## Executive Summary

This document outlines the migration strategy for restructuring GWI POS from its current monolithic structure to an 8-domain architecture. The plan prioritizes zero downtime and incremental migration.

**Current State:** 816 files, 105+ models, 294 API endpoints in flat structure
**Target State:** 10 independent domains with bridge interfaces
**Risk Level:** Medium (working system, must not break)

---

## Domain Architecture (10 Domains)

| # | Domain | Scope | Layers/Modules |
|---|--------|-------|----------------|
| 1 | Floor Plan | WHERE everything is, WHO sits where | L1-L9 |
| 2 | Order Management | WHAT was ordered, HOW it's paid | O1-O10 |
| 3 | Menu | Items, pricing, availability | M1-M7 |
| 4 | Inventory | Stock, purchasing, waste | I1-I7 |
| 5 | Employee | Profiles, scheduling, time clock | E1-E6 |
| 6 | Reporting | Sales, labor, trends | R1-R7 |
| 7 | Guest | Profiles, loyalty, reservations | G1-G7 |
| 8 | Hardware | Terminals, printers, KDS | H1-H8 |
| 9 | Events | Event creation, ticketing, check-in | EV1-EV5 |
| 10 | Financial | Gift cards, house accounts, discounts, tax | F1-F5 |

---

## Phase 0: Pre-Migration (Do First)

### 0.1 Fix Build Errors
**Priority:** CRITICAL
**Blocker:** Cannot proceed without passing build

Current error from audit:
```
TypeError: Cannot read properties of undefined (reading 'javascriptEnabled')
Location: test script in package.json
```

**Action:** Fix the test script configuration before any restructuring.

### 0.2 Create Safety Net
- [ ] Ensure git is initialized and all changes committed
- [ ] Create `pre-migration` branch as rollback point
- [ ] Document current working features with screenshots
- [ ] Export current database as backup
- [ ] Run full app manually and note all working flows

### 0.3 Establish Domain Boundaries Document
- [ ] Create `docs/architecture/DOMAIN-MAP.md`
- [ ] Map every existing file to its target domain
- [ ] Identify files that span multiple domains (split candidates)
- [ ] Flag shared utilities that stay in `lib/shared/`

---

## Phase 1: Foundation (Non-Breaking)

**Goal:** Add new structure alongside existing code. Nothing moves yet.

### 1.1 Create Domain Directory Structure

```
src/
├── domains/
│   ├── floor-plan/
│   │   ├── layers/
│   │   │   ├── L1-canvas/
│   │   │   ├── L2-objects/
│   │   │   ├── L3-seats/
│   │   │   ├── L4-groups/
│   │   │   ├── L5-persistence/
│   │   │   ├── L6-staff/
│   │   │   ├── L7-status/
│   │   │   ├── L8-entertainment/
│   │   │   └── L9-waitlist/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types/
│   │   ├── api/
│   │   └── index.ts (public API)
│   │
│   ├── order-management/
│   │   ├── O1-ticket-lifecycle/
│   │   ├── O2-item-management/
│   │   ├── O3-modifiers/
│   │   ├── O4-coursing/
│   │   ├── O5-splitting/
│   │   ├── O6-payment/
│   │   ├── O7-kitchen-routing/
│   │   ├── O8-comps-voids/
│   │   ├── O9-tabs/
│   │   └── O10-order-history/
│   │
│   ├── menu/
│   │   ├── M1-categories/
│   │   ├── M2-items/
│   │   ├── M3-modifiers/
│   │   ├── M4-pricing/
│   │   ├── M5-availability/
│   │   ├── M6-combos/
│   │   └── M7-specials/
│   │
│   ├── inventory/
│   │   ├── I1-items/
│   │   ├── I2-stock-levels/
│   │   ├── I3-purchasing/
│   │   ├── I4-receiving/
│   │   ├── I5-transfers/
│   │   ├── I6-waste/
│   │   └── I7-counts/
│   │
│   ├── employee/
│   │   ├── E1-profiles/
│   │   ├── E2-roles/
│   │   ├── E3-scheduling/
│   │   ├── E4-time-clock/
│   │   ├── E5-payroll/
│   │   └── E6-performance/
│   │
│   ├── reporting/
│   │   ├── R1-sales/
│   │   ├── R2-labor/
│   │   ├── R3-product-mix/
│   │   ├── R4-inventory/
│   │   ├── R5-employee/
│   │   ├── R6-trends/
│   │   └── R7-exports/
│   │
│   ├── guest/
│   │   ├── G1-profiles/
│   │   ├── G2-loyalty/
│   │   ├── G3-reservations/
│   │   ├── G4-preferences/
│   │   ├── G5-history/
│   │   ├── G6-feedback/
│   │   └── G7-marketing/
│   │
│   ├── hardware/
│   │   ├── H1-terminals/
│   │   ├── H2-printers/
│   │   ├── H3-card-readers/
│   │   ├── H4-kds-screens/
│   │   ├── H5-cash-drawers/
│   │   ├── H6-barcode-scanners/
│   │   ├── H7-scales/
│   │   └── H8-networking/
│   │
│   ├── events/
│   │   ├── EV1-event-management/
│   │   ├── EV2-ticketing/
│   │   ├── EV3-check-in/
│   │   ├── EV4-event-sales/
│   │   └── EV5-event-reporting/
│   │
│   └── financial/
│       ├── F1-gift-cards/
│       ├── F2-house-accounts/
│       ├── F3-discounts/
│       ├── F4-coupons/
│       └── F5-tax-rules/
│
├── bridges/
│   ├── floor-to-order.ts
│   ├── order-to-menu.ts
│   ├── order-to-inventory.ts
│   ├── order-to-hardware.ts
│   ├── order-to-financial.ts
│   ├── floor-to-guest.ts
│   ├── floor-to-events.ts
│   ├── employee-to-floor.ts
│   ├── events-to-guest.ts
│   ├── events-to-financial.ts
│   ├── financial-to-guest.ts
│   ├── reporting-aggregator.ts
│   └── index.ts
│
├── shared/
│   ├── lib/           (utilities used by multiple domains)
│   ├── types/         (shared TypeScript types)
│   ├── hooks/         (shared React hooks)
│   └── components/    (truly generic UI components)
│
└── app/               (Next.js app router - stays mostly unchanged)
```

### 1.2 Create Bridge Interface Contracts

Before any code moves, define the contracts:

```typescript
// bridges/floor-to-order.ts
export interface FloorToOrderBridge {
  // Floor Plan calls these when it needs order data
  getActiveOrderForSeat(seatId: string): Promise<Order | null>;
  getActiveOrdersForTable(tableId: string): Promise<Order[]>;
  getOrderTotalForGroup(groupId: string): Promise<number>;

  // Floor Plan emits these events
  onTableStatusChange(tableId: string, status: TableStatus): void;
  onSeatAssigned(seatId: string, guestId?: string): void;
  onGroupCreated(groupId: string, tableIds: string[]): void;
  onGroupDissolved(groupId: string): void;
}

export interface OrderToFloorBridge {
  // Order Management calls these when it needs floor data
  getTableForOrder(orderId: string): Promise<Table | null>;
  getSeatsForTable(tableId: string): Promise<Seat[]>;
  getServerForTable(tableId: string): Promise<Employee | null>;

  // Order Management emits these events
  onOrderCreated(orderId: string, tableId: string): void;
  onOrderPaid(orderId: string): void;
  onItemSentToKitchen(orderId: string, itemId: string): void;
}
```

### 1.3 Create Domain Index Files

Each domain gets a public API that other domains use:

```typescript
// domains/floor-plan/index.ts
export { FloorPlanProvider } from './components/FloorPlanProvider';
export { useFloorPlan } from './hooks/useFloorPlan';
export { useTableStatus } from './hooks/useTableStatus';
export type { Table, Seat, TableGroup, TableStatus } from './types';

// Internal implementation is NOT exported
// Other domains cannot import from ./layers/* directly
```

---

## Phase 2: Parallel Implementation (Low Risk)

**Goal:** Build new domain structure alongside existing code. Old code still works.

### 2.1 Start with Floor Plan Domain (Most Documented)

Since we have the most detailed spec for Floor Plan (9 layers), start here:

1. Create `domains/floor-plan/` structure
2. Implement L1-L9 as NEW code following the spec
3. Create new components that use the domain
4. Keep old `/components/floor-plan/` working
5. Add feature flag: `USE_NEW_FLOOR_PLAN=true`

### 2.2 Create Adapter Pattern

```typescript
// adapters/floor-plan-adapter.ts
// Translates between old data structures and new domain models

import { OldFloorPlan } from '@/components/floor-plan/types';
import { FloorPlan } from '@/domains/floor-plan/types';

export function migrateToNewFloorPlan(old: OldFloorPlan): FloorPlan {
  // Transform old structure to new
}

export function migrateToOldFloorPlan(newPlan: FloorPlan): OldFloorPlan {
  // Backwards compatibility during transition
}
```

### 2.3 Incremental Page Migration

For each page:
1. Create new version using domain imports
2. Add route with `/v2/` prefix for testing
3. Test thoroughly
4. Swap routes when ready
5. Remove old version after confirmation

---

## Phase 3: Data Migration (Medium Risk)

**Goal:** Migrate Prisma schema to support domain boundaries without losing data.

### 3.1 Schema Changes Strategy

**DO NOT** rename or delete existing tables during transition.

Instead:
1. Add new tables/columns alongside existing
2. Create migration scripts that copy data
3. Add database triggers to sync during transition
4. Remove old columns only after full migration

### 3.2 Model Ownership

| Domain | Owns These Models |
|--------|-------------------|
| Floor Plan | Room, FloorPlan, Table, Seat, TableGroup, SectionAssignment, Waitlist, TimedRental |
| Order Management | Order, OrderItem, OrderModifier, Payment, Split, Tab, Void, Comp |
| Menu | MenuItem, MenuCategory, Modifier, ModifierGroup, Combo, Special, PizzaConfig |
| Inventory | InventoryItem, Vendor, PurchaseOrder, StockTransaction, WasteLog, InventoryCount |
| Employee | Employee, Role, Permission, Schedule, Shift, TimeEntry, Payroll |
| Reporting | DailySummary, ShiftReport, SalesReport (most are views/aggregations) |
| Guest | Customer, Reservation, LoyaltyPoints |
| Hardware | Terminal, Printer, PrintJob, KDSScreen, PaymentReader |
| Events | Event, EventTicket, EventCheckIn, EventSale |
| Financial | GiftCard, HouseAccount, Discount, Coupon, TaxRule |

### 3.3 Shared Models

Some models are referenced by multiple domains. These stay in `shared/`:
- `User` (authentication)
- `Settings` (global config)
- `AuditLog` (cross-domain logging)

---

## Phase 4: API Migration (Medium Risk)

**Goal:** Reorganize API routes by domain.

### 4.1 Current API Structure
```
app/api/
├── orders/
├── tables/
├── menu/
├── inventory/
├── employees/
├── reports/
├── kds/
├── payments/
└── ... (294 total endpoints)
```

### 4.2 Target API Structure
```
app/api/
├── v2/
│   ├── floor-plan/
│   │   ├── rooms/
│   │   ├── tables/
│   │   ├── seats/
│   │   ├── groups/
│   │   ├── status/
│   │   ├── waitlist/
│   │   └── entertainment/
│   ├── orders/
│   ├── menu/
│   ├── inventory/
│   ├── employees/
│   ├── reports/
│   ├── guests/
│   └── hardware/
└── (old routes remain until migration complete)
```

### 4.3 API Versioning Strategy

1. New endpoints go under `/api/v2/`
2. Old endpoints remain functional
3. Add deprecation headers to old endpoints
4. Frontend gradually switches to v2
5. Remove v1 after 100% migration

---

## Phase 5: Component Migration (Low-Medium Risk)

**Goal:** Move UI components into domain folders.

### 5.1 Component Audit

From the audit, components currently live in:
- `components/` (flat structure)
- `components/floor-plan/`
- `components/admin/`
- `components/pos/`
- `components/kds/`
- `components/ui/` (shadcn)

### 5.2 Migration Rules

1. **Domain-specific components** → Move to `domains/[domain]/components/`
2. **Shared UI primitives** (Button, Dialog, etc.) → Stay in `components/ui/`
3. **Layout components** → Stay in `components/layout/`
4. **Components used by 2+ domains** → Evaluate: truly shared or needs split?

### 5.3 Large File Refactoring

These files are too large and need splitting during migration:

| File | Lines | Target Domain | Action |
|------|-------|---------------|--------|
| `lib/timed-rentals.ts` | 3,058 | Floor Plan L8 | Split into services |
| `components/floor-plan/floor-plan-editor.tsx` | 2,687 | Floor Plan | Split by layer |
| `lib/kds.ts` | 2,106 | Hardware H4 | Split into services |
| `app/admin/employees/page.tsx` | 1,965 | Employee | Extract components |
| `lib/scheduling.ts` | 1,931 | Employee E3 | Split into services |

---

## Phase 6: Cleanup (After Full Migration)

**Goal:** Remove old code, finalize structure.

### 6.1 Removal Checklist
- [ ] Remove old component folders
- [ ] Remove old API routes (v1)
- [ ] Remove adapter/translation code
- [ ] Remove feature flags
- [ ] Remove deprecated database columns
- [ ] Update all imports to domain paths

### 6.2 Documentation Update
- [ ] Update README with new structure
- [ ] Update CLAUDE.md with domain-aware context loading
- [ ] Create domain-specific documentation
- [ ] Update API documentation

---

## Risk Mitigation

### Rollback Strategy

At any point, we can rollback by:
1. Reverting to `pre-migration` branch
2. Restoring database backup
3. Old routes remain functional until explicitly removed

### Testing Strategy

1. **Unit Tests:** Add tests for each domain service
2. **Integration Tests:** Test bridge interfaces
3. **E2E Tests:** Expand Playwright coverage before migration
4. **Manual Testing:** Checklist for each migrated feature

### Feature Flags

```typescript
// lib/feature-flags.ts
export const FEATURE_FLAGS = {
  USE_NEW_FLOOR_PLAN: process.env.USE_NEW_FLOOR_PLAN === 'true',
  USE_NEW_ORDER_SYSTEM: process.env.USE_NEW_ORDER_SYSTEM === 'true',
  USE_V2_API: process.env.USE_V2_API === 'true',
};
```

---

## Timeline Estimate

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| Phase 0 | Pre-Migration | None |
| Phase 1 | Foundation | Phase 0 |
| Phase 2 | Parallel Implementation | Phase 1 |
| Phase 3 | Data Migration | Phase 2 |
| Phase 4 | API Migration | Phase 2 |
| Phase 5 | Component Migration | Phase 3, 4 |
| Phase 6 | Cleanup | Phase 5 |

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain Count | **10 domains** | Cleaner separation, Events and Financial are substantial |
| Events | **Separate domain** | Own UI flow, ticketing, check-in logic |
| Financial | **Separate domain** | Spans multiple domains, centralizes money flow logic |
| Migration Order | Start with Floor Plan | Most documented, foundational |
| Feature Flags | Gradual rollout | Lower risk, can rollback per domain |

---

## Next Steps (After Plan Approval)

1. Fix build error (Phase 0.1)
2. Initialize git and create safety branch (Phase 0.2)
3. Create DOMAIN-MAP.md mapping existing files to domains (Phase 0.3)
4. Begin Phase 1 directory structure

---

## Appendix A: File-to-Domain Mapping (Summary)

Full mapping will be in `DOMAIN-MAP.md`. High-level:

| Current Location | Target Domain |
|------------------|---------------|
| `components/floor-plan/*` | Floor Plan |
| `lib/timed-rentals.ts` | Floor Plan L8 |
| `app/api/orders/*` | Order Management |
| `app/api/tables/*` | Floor Plan |
| `components/pos/*` | Order Management |
| `app/admin/menu/*` | Menu |
| `app/admin/inventory/*` | Inventory |
| `app/admin/employees/*` | Employee |
| `app/admin/reports/*` | Reporting |
| `app/admin/customers/*` | Guest |
| `components/kds/*` | Hardware |
| `app/api/kds/*` | Hardware |
| `app/events/*` | Events |
| `app/api/events/*` | Events |
| `app/gift-cards/*` | Financial |
| `app/house-accounts/*` | Financial |
| `app/discounts/*` | Financial |
| `app/coupons/*` | Financial |
| `app/tax-rules/*` | Financial |

---

## Appendix B: Bridge Interface Summary

| Bridge | Domain A | Domain B | Purpose |
|--------|----------|----------|---------|
| floor-to-order | Floor Plan | Order Management | Table/seat to order mapping |
| order-to-menu | Order Management | Menu | Item lookup, pricing, availability |
| order-to-inventory | Order Management | Inventory | Stock deduction on sale |
| order-to-hardware | Order Management | Hardware | Print tickets, KDS routing |
| floor-to-guest | Floor Plan | Guest | Reservation seating, preferences |
| employee-to-floor | Employee | Floor Plan | Section assignments, permissions |
| reporting-aggregator | Reporting | All | Data collection for reports |
| order-to-financial | Order Management | Financial | Discounts, gift cards, tax |
| floor-to-events | Floor Plan | Events | Event seating, venue setup |
| events-to-guest | Events | Guest | Attendee tracking, preferences |
| events-to-financial | Events | Financial | Event ticket sales, gift cards |
| financial-to-guest | Financial | Guest | House accounts, loyalty points |

---

*This document is a living plan. Update as decisions are made.*
