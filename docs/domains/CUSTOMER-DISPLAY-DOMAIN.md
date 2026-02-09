# Customer Display Domain

**Domain ID:** 21
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Customer Display domain manages customer-facing screens and surfaces that are separate from the employee POS interface. It handles:
- Customer-Facing Display (CFD) with 8-state state machine (idle, order, subtotal, tip, signature, processing, approved, declined)
- Pay-at-table with split check support
- Tip selection interface for customers
- Signature capture on customer screen
- Multi-surface state synchronization between POS terminal and customer display

## Domain Trigger

```
PM Mode: Customer Display
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| CFD State Machine | 8-state display flow | `src/app/(cfd)/cfd/page.tsx` |
| Idle Screen | Clock + welcome branding | `src/components/cfd/CFDIdleScreen.tsx` |
| Order Display | Live order view for customer | `src/components/cfd/CFDOrderDisplay.tsx` |
| Tip Screen | Tip selection buttons | `src/components/cfd/CFDTipScreen.tsx` |
| Signature | Signature capture canvas | `src/components/cfd/CFDSignatureScreen.tsx` |
| Approval | Approved/declined screens | `src/components/cfd/CFDApprovedScreen.tsx` |
| Pay-at-Table | Guest self-pay interface | `src/app/(pos)/pay-at-table/`, `src/components/pay-at-table/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(cfd)/cfd/page.tsx` | CFD state machine (8 states) |
| `src/components/cfd/CFDIdleScreen.tsx` | Clock + welcome screen |
| `src/components/cfd/CFDOrderDisplay.tsx` | Live order display |
| `src/components/cfd/CFDTipScreen.tsx` | Tip selection |
| `src/components/cfd/CFDSignatureScreen.tsx` | Signature capture |
| `src/components/cfd/CFDApprovedScreen.tsx` | Approval/decline screens |
| `src/components/pay-at-table/TablePayment.tsx` | Pay-at-table flow |
| `src/components/pay-at-table/SplitSelector.tsx` | Split check selector |
| `src/components/pay-at-table/TipScreen.tsx` | Pay-at-table tip entry |
| `src/types/multi-surface.ts` | Multi-surface state types |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 218 | Customer-Facing Display | DONE |
| 219 | Pay-at-Table | DONE |

## Integration Points

- **Payments Domain**: Payment processing, tip entry, signature capture
- **Orders Domain**: Order data for live display
- **Settings Domain**: CFD branding and configuration
- **Hardware Domain**: Display device management
