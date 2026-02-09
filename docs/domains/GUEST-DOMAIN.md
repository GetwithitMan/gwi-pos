# Guest Domain

**Domain ID:** 12
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Guest domain manages customer-facing interfaces including the Customer-Facing Display, pay-at-table, bartender mobile, and online ordering. It handles:
- Customer-Facing Display (CFD) with state machine (idle → order → tip → signature → approved)
- Pay-at-table with split check support
- Bartender mobile tab management
- Online ordering (planned)
- Order-ahead scheduling (planned)

## Domain Trigger

```
PM Mode: Guest
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| CFD | Customer-facing display | `src/app/(cfd)/cfd/`, `src/components/cfd/` |
| Pay-at-Table | Guest payment | `src/app/(pos)/pay-at-table/`, `src/components/pay-at-table/` |
| Mobile | Bartender mobile | `src/app/(mobile)/mobile/`, `src/components/mobile/` |
| Public | Public-facing pages | `src/app/(public)/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(cfd)/cfd/page.tsx` | CFD state machine (8 states) |
| `src/components/cfd/CFDIdleScreen.tsx` | Clock + welcome screen |
| `src/components/cfd/CFDOrderDisplay.tsx` | Live order display |
| `src/components/cfd/CFDTipScreen.tsx` | Tip selection |
| `src/components/cfd/CFDSignatureScreen.tsx` | Signature capture |
| `src/components/pay-at-table/TablePayment.tsx` | Pay-at-table flow |
| `src/components/mobile/MobileTabCard.tsx` | Mobile tab card |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 53 | Online Ordering | TODO |
| 54 | Order Ahead | TODO |
| 218 | Customer-Facing Display | DONE |
| 219 | Pay-at-Table | DONE |
| 220 | Bartender Mobile | DONE |

## Integration Points

- **Payments Domain**: Payment processing, tip entry
- **Orders Domain**: Order data for display
- **Menu Domain**: Online ordering modifier overrides (when built)
