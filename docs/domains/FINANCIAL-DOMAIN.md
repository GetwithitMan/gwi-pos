# Financial Domain

**Domain ID:** 14
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Financial domain manages payroll, tip distribution, and financial reporting. It handles:
- Payroll processing and pay stub generation
- Tax calculations for payroll
- Tip-out rules (automatic role-based distribution)
- Tip share tracking and payout management
- Tip pools and banked tips

## Domain Trigger

```
PM Mode: Financial
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Payroll | Pay processing | `src/app/api/payroll/`, `src/lib/payroll/` |
| Tip-Outs | Tip distribution rules | `src/app/api/tip-out-rules/` |
| Tips | Tip management | `src/components/tips/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/payroll/tax-calculator.ts` | Payroll tax calculations |
| `src/lib/payroll/pay-stub-pdf.ts` | Pay stub PDF generation |
| `src/app/api/tip-out-rules/route.ts` | Tip-out rule CRUD |
| `src/app/(admin)/settings/tip-outs/page.tsx` | Tip-out rules admin page |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/payroll` | GET/POST | Payroll processing |
| `/api/tip-out-rules` | GET/POST | Tip-out rule CRUD |
| `/api/tip-out-rules/[id]` | PUT/DELETE | Single tip-out rule |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 06 | Tipping | DONE |
| 105 | Tip Share Report | DONE |
| 244 | Payroll System | DONE |

## Integration Points

- **Employees Domain**: Employee records, shift data for payroll
- **Payments Domain**: Tip data from payments
- **Reports Domain**: Tip share reports, daily store report tip section
