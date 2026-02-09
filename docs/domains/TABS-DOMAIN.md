# Tabs & Bottle Service Domain

**Domain ID:** 17
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Tabs domain manages bar tab lifecycle, bottle service workflows, and multi-card payment holds. It handles:
- Tab creation with card-first pre-authorization flow
- Incremental authorization at spend thresholds (80%)
- Multi-card tab management (multiple cards on one tab)
- Bottle service tiers with deposit pre-auth and spend progress tracking
- Tab transfers between employees
- Walkout recovery with auto-retry scheduling
- Card recognition on repeat visits

## Domain Trigger

```
PM Mode: Tabs
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Tab CRUD | Tab creation, listing, close | `src/app/api/tabs/`, `src/app/(pos)/tabs/page.tsx` |
| Pre-Auth | Card pre-authorization flow | `src/app/api/datacap/preauth/`, `src/app/api/datacap/collect-card/` |
| Bottle Service | Tier management, deposits, progress | `src/components/tabs/BottleServiceBanner.tsx` |
| Multi-Card | Multiple cards per tab | `src/components/tabs/MultiCardBadges.tsx` |
| Tab Transfer | Transfer between employees | `src/components/tabs/TabTransferModal.tsx` |
| Walkout | Walkout recovery and retry | `src/app/api/datacap/walkout-retry/` |
| UI | Tab management components | `src/components/tabs/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/tabs/page.tsx` | Tab management POS page |
| `src/components/tabs/TabCard.tsx` | Individual tab card display |
| `src/components/tabs/BottleServiceBanner.tsx` | Bottle service progress tracking |
| `src/components/tabs/CardFirstFlow.tsx` | Card-first tab opening flow |
| `src/components/tabs/TabTransferModal.tsx` | Tab transfer between employees |
| `src/components/tabs/MultiCardBadges.tsx` | Multi-card display badges |
| `src/components/tabs/PendingTabShimmer.tsx` | Shimmer animation during auth |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/tabs` | GET/POST | List/create tabs |
| `/api/tabs/[id]` | GET/PUT | Tab details/close |
| `/api/datacap/preauth` | POST | Pre-authorize card for tab |
| `/api/datacap/capture` | POST | Capture final amount on close |
| `/api/datacap/increment` | POST | Incremental auth at threshold |
| `/api/datacap/collect-card` | POST | Collect card data for tab |
| `/api/datacap/walkout-retry` | POST | Retry walkout charges |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 20 | Bar Tabs | PARTIAL |
| 21 | Pre-auth | DONE |
| 22 | Tab Transfer | DONE |
| 245 | Bottle Service Tiers | DONE |

## Integration Points

- **Orders Domain**: Tabs are open-ended orders with special lifecycle
- **Payments Domain**: Pre-auth, capture, incremental auth via Datacap
- **Employees Domain**: Tab ownership and transfer
- **Guest Domain**: Bartender mobile tab management
