# Guest Domain

**Domain ID:** 12
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Guest domain manages guest-facing digital experiences: online ordering, order-ahead, bartender mobile, and public pages. It handles:
- Online ordering (planned)
- Order-ahead scheduling (planned)
- Bartender mobile tab management
- Public-facing pages (void approval links, etc.)

**Note:** Customer-Facing Display (CFD) and Pay-at-Table were moved to the **Customer Display Domain** (Domain 21) as of Feb 9, 2026.

## Domain Trigger

```
PM Mode: Guest
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Mobile | Bartender mobile | `src/app/(mobile)/mobile/`, `src/components/mobile/` |
| Public | Public-facing pages | `src/app/(public)/` |
| Online Ordering | Customer online ordering (planned) | TBD |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(mobile)/mobile/tabs/page.tsx` | Mobile tab list |
| `src/app/(mobile)/mobile/tabs/[id]/page.tsx` | Mobile tab detail |
| `src/components/mobile/MobileTabCard.tsx` | Mobile tab card |
| `src/components/mobile/MobileTabActions.tsx` | Mobile tab actions |
| `src/app/(public)/approve-void/[token]/page.tsx` | Remote void approval page |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 53 | Online Ordering | TODO |
| 54 | Order Ahead | TODO |
| 220 | Bartender Mobile | DONE |

## Integration Points

- **Customer Display Domain**: CFD and pay-at-table (moved to Domain 21)
- **Tabs Domain**: Bartender mobile tab management
- **Orders Domain**: Order data for online ordering
- **Menu Domain**: Online ordering modifier overrides (when built)
- **Payments Domain**: Online payment processing (when built)
