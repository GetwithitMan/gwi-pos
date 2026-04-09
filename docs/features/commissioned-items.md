# Feature: Commissioned Items

> **Status: ACTIVE** — Fully built as of 2026-03-04.

## Summary
Commission tracking on item sales. Configure flat-dollar or percentage commissions per menu item, accrue them to the selling employee at payment time, and view through reports and employee self-service.

## Status
`Active` — Schema, APIs, UI, and payroll integration all built. Commission is calculated at item-add time and recalculated (from active items only) at payment time to zero voided/comped items.

## Schema Fields
- `MenuItem.commissionType` — `'percent' | 'fixed' | null`
- `MenuItem.commissionValue` — Decimal rate or flat dollar amount
- `OrderItem.commissionAmount` — Calculated commission for this line item
- `Order.commissionTotal` — Sum of all active item commissions
- `PayStub.commissionTotal` — Commission included in payroll gross
- `PayrollPeriod.totalCommissions` — Period aggregate

## Key Capabilities
- **Commission rates** — flat $ or % per menu item; configured in ItemSettingsModal (Commission section)
- **Real-time accrual** — commission written to `OrderItem.commissionAmount` when item is added
- **Payment-time recalculation** — fire-and-forget in `pay/route.ts`; recalculates from active items only (zeroes voided/comped items)
- **Shift summary** — commission included in shift summary response
- **Payroll integration** — flows through `PayStub.commissionTotal` → `grossPay`
- **Manager report** — `/api/reports/commission` + `/reports/commission` UI; shows per-employee breakdown by item (name, qty, price, rate, commission)
- **Employee self-service** — `/pos/crew/commission` shows own commission for the shift

## Code Locations
| Purpose | Path |
|---------|------|
| Commission config UI | `src/components/menu/ItemSettingsModal.tsx` (Commission section) |
| Item-add accrual | `src/app/api/orders/[id]/items/route.ts` |
| Payment-time recalc | `src/app/api/orders/[id]/pay/route.ts` (fire-and-forget block) |
| Manager report API | `src/app/api/reports/commission/route.ts` |
| Manager report UI | `src/app/(admin)/reports/commission/page.tsx` |
| Employee self-service | Via Android register crew screen (web POS page removed April 2026) |
| Admin fix tool | `src/app/api/admin/fix-commissions/route.ts` |

## Business Logic
1. Commission is written at item-add time using `MenuItem.commissionType/Value`
2. At payment (order fully paid), a fire-and-forget block recalculates commission from **active items only** (`status: 'active', deletedAt: null`)
3. `Order.commissionTotal` is updated if the recalculated value differs by more than $0.001
4. Commission flows: `Order.commissionTotal` → shift summary → `PayStub.commissionTotal` → `grossPay`

## Known Constraints
- No approval workflow (commissions auto-post; payout tracking is via payroll, not a separate ledger)
- No tiered/volume-based commission rates — flat rate per item only
- No category-level commission defaults — must configure per item

## Dependencies
- **Menu** — `MenuItem.commissionType/Value` configured in ItemSettingsModal
- **Employees** — commission attributed to the employee who placed the item
- **Payments** — recalculation triggered in `pay/route.ts`
- **Payroll** — `PayStub.commissionTotal` included in gross pay
- **Reports** — commission report API + manager UI + employee self-service

*Last updated: 2026-03-04*
