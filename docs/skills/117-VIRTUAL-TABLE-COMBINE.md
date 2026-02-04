# Skill 117: Virtual Table Combine

## Overview

Virtual Table Combine allows servers to logically group multiple tables together without physically moving them. This is essential for large parties spanning multiple tables where each table maintains its position but shares a single order.

## Why This Matters

| Benefit | Description |
|---------|-------------|
| **Operational Accuracy** | Tables stay in actual positions - runners/bussers find food easily |
| **Split Check Efficiency** | "Split by Table" lets servers split a 12-top across 3 tables in one click |
| **T-S Notation** | Industry-standard for fine dining - ensures right food hits right person |
| **Financial Integrity** | `status: 'merged'` prevents double-counting in EOD reports |

## Key Differences from Physical Combine

| Aspect | Physical Combine (Existing) | Virtual Combine (New) |
|--------|---------------------------|----------------------|
| Position | Tables move together | Tables stay in place |
| Seat Numbers | Renumbered sequentially (S1, S2...) | Keep per-table numbers (T2-S1, T3-S2) |
| Visual | Dashed border + "+N" badge | **Pulsing glow** + chain icon |
| Initiation | Drag table onto another | Long-press → tap to select |

## Database Schema

### Table Model Additions

```prisma
// Virtual Table Combine
virtualGroupId        String?   // UUID shared by all tables in group
virtualGroupPrimary   Boolean   @default(false)  // Is this the primary table?
virtualGroupColor     String?   // Hex color for matching glow
virtualGroupCreatedAt DateTime? // When group was created (for EOD cleanup)
```

### OrderItem Model Addition

```prisma
sourceTableId  String?  // Which table this item was ordered from (for T2-S3 notation)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tables/virtual-combine` | POST | Create virtual group from selected tables |
| `/api/tables/virtual-combine/active` | GET | Get all active virtual groups (manager dashboard) |
| `/api/tables/virtual-combine/[groupId]` | GET | Get group details with per-table financials |
| `/api/tables/virtual-combine/[groupId]/add` | POST | Add table to existing group |
| `/api/tables/virtual-combine/[groupId]/remove` | POST | Remove table from group |
| `/api/tables/virtual-combine/[groupId]/dissolve` | POST | Dissolve group (optionally split by table) |
| `/api/tables/virtual-combine/[groupId]/set-primary` | POST | Change primary table mid-order |
| `/api/tables/virtual-combine/[groupId]/transfer` | POST | Transfer group to new server |
| `/api/eod/reset` | POST | EOD cleanup for orphaned virtual groups |

## User Flow

1. **Long-press** on any table → enters "virtual combine mode"
2. **UI dims** except tables (prevents accidental order entry)
3. **Tap other tables** to add/remove them from the group (checkmarks shown)
4. **Floating bar** appears with: "3 tables selected" + Cancel + Confirm
5. **Confirm** creates the virtual group with matching **pulsing** glow colors
6. **Tapping any table in group** opens the Primary Table's order panel
7. **Order panel header** shows: "Group: T4 (Primary), T5, T6"
8. **Order items** are tagged with source table-seat (T2-S3)

## UI Components

### VirtualCombineBar.tsx
Floating bar at bottom of screen when combine mode is active:
- Selected table count
- Primary table indicator (clickable to change)
- Cancel/Confirm buttons
- Animation on enter/exit

### ExistingOrdersModal.tsx
Handles merging when combining tables that have open orders:
- Lists each table with order total and item count
- Toggle between "Add to Group" (merge) or "Close Out"
- Merged orders marked as `status: 'merged'` to prevent double-counting

### GroupSummary.tsx
Checkout view for virtual groups:
- Per-table breakdown with expandable item lists
- Grand total across all tables
- Payment progress bar
- "Pay Entire Group" or "Pay This Table Only" options

### ManagerGroupDashboard.tsx
Admin view at `/virtual-groups`:
- Summary stats (total groups, tables linked, group spend)
- Group cards with pacing, server, spend concentration
- High-risk warnings for groups over $500
- Server transfer and dissolve actions

## Real-time Events

```typescript
// table-events.ts
tableEvents.virtualGroupCreated(event)
tableEvents.virtualGroupDissolved(event)
tableEvents.virtualGroupMemberAdded(event)
tableEvents.virtualGroupMemberRemoved(event)
tableEvents.virtualGroupPrimaryChanged(event)
```

## Color Palette

Distinct pulsing glow colors for virtual groups:

```typescript
const VIRTUAL_GROUP_COLORS = [
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f472b6', // pink
  '#a855f7', // purple
  '#fb923c', // orange
  '#34d399', // emerald
]
```

## EOD Self-Healing

The `/api/eod/reset` endpoint cleans up orphaned virtual groups:
- Clears `virtualGroupId`, `virtualGroupPrimary`, `virtualGroupColor`, `virtualGroupCreatedAt`
- Resets table statuses to 'available' (except those with open orders)
- Detects stale orders open > 24 hours
- Creates audit log of all cleanup actions

## Permissions

| Role | Permissions |
|------|-------------|
| Servers & Managers | Can initiate virtual combine (long-press triggers mode) |
| Bussers | View-only - see pulsing glow to know tables are related, cannot initiate |
| Managers Only | Manual dissolve without payment, group transfer |

## Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `src/app/api/tables/virtual-combine/route.ts` | Create virtual group |
| `src/app/api/tables/virtual-combine/active/route.ts` | Get active groups |
| `src/app/api/tables/virtual-combine/[groupId]/route.ts` | Get group financials |
| `src/app/api/tables/virtual-combine/[groupId]/add/route.ts` | Add table to group |
| `src/app/api/tables/virtual-combine/[groupId]/remove/route.ts` | Remove table |
| `src/app/api/tables/virtual-combine/[groupId]/dissolve/route.ts` | Dissolve group |
| `src/app/api/tables/virtual-combine/[groupId]/set-primary/route.ts` | Change primary |
| `src/app/api/tables/virtual-combine/[groupId]/transfer/route.ts` | Server transfer |
| `src/app/api/eod/reset/route.ts` | EOD cleanup |
| `src/components/floor-plan/VirtualCombineBar.tsx` | Selection mode UI |
| `src/components/floor-plan/ExistingOrdersModal.tsx` | Order merge handling |
| `src/components/payment/GroupSummary.tsx` | Group checkout view |
| `src/components/admin/ManagerGroupDashboard.tsx` | Admin dashboard |
| `src/app/(admin)/virtual-groups/page.tsx` | Admin page |

### Modified Files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Virtual group fields on Table, sourceTableId on OrderItem |
| `src/components/floor-plan/use-floor-plan.ts` | Virtual combine mode state |
| `src/components/floor-plan/TableNode.tsx` | Pulsing glow + selection checkmark |
| `src/components/floor-plan/FloorPlanHome.tsx` | Long-press handling + mode UI |
| `src/app/api/orders/[id]/pay/route.ts` | Auto-dissolve group on payment |
| `src/app/api/reports/daily/route.ts` | Exclude 'merged' orders |
| `src/lib/realtime/table-events.ts` | Virtual group events |
| `src/components/payment/types.ts` | Group financial types |

## Verification Checklist

- [ ] Long-press table → enters combine mode with UI dim
- [ ] Tap tables to select → checkmarks appear
- [ ] Confirm → pulsing glow + chain icon on grouped tables
- [ ] Tap any grouped table → Primary table's order opens
- [ ] Order panel shows "Group: T4 (Primary), T5, T6"
- [ ] Add items from different tables → T-S notation displays
- [ ] Kitchen print → T2-S3 format on ticket
- [ ] Combine tables with orders → ExistingOrdersModal appears
- [ ] "Add to Group" → order marked as 'merged'
- [ ] EOD Report → merged orders not double-counted
- [ ] Pay group → virtual group auto-dissolves
- [ ] `/virtual-groups` → manager dashboard works
- [ ] Server transfer → group moves to new server

## Known Issues & Patterns

### Stale Closure Prevention (tablesRef Pattern)

When working with table data in `useCallback` hooks, use the `tablesRef` pattern to avoid stale closures:

```typescript
// FloorPlanHome.tsx
const tablesRef = useRef(tables)
tablesRef.current = tables  // Update on every render

// In callbacks, use tablesRef.current instead of tables
const handleTableCombine = useCallback(async (...) => {
  // WRONG: tables could be stale
  // const data = tables.map(t => ({...}))

  // CORRECT: tablesRef.current is always fresh
  const data = tablesRef.current.map(t => ({...}))
}, [locationId])  // Note: no 'tables' dependency
```

**Why this matters:**
- When tables are combined, `loadFloorPlanData()` fetches new data
- If a callback closes over old `tables` state, it sees pre-combine data
- This causes wrong seat counts (e.g., 5 instead of 13 for combined tables)
- Using the ref ensures callbacks always access latest state

**Callbacks using this pattern:**
- `handleTableCombine` - for sending table positions to API
- `handleConfirmVirtualCombine` - for checking virtual group status
- `handleTableTap` - for resolving combined table primaries
- `handleSeatTap` - for seat selection on combined tables
- `handlePointerMove` - for drag target detection
- `getVirtualGroupTables` - for gathering virtual group members
- `getTotalSeats` - for calculating combined seat counts

## Dependencies

- Skill 106: Interactive Floor Plan (SVG)
- Skill 107: Table Combine/Split
- Skill 16: Table Layout
- Skill 02: Quick Order Entry
- Skill 30: Payment Processing

## Related Skills

- **Skill 201**: Tag-Based Routing Engine - Routes orders to stations, includes T-S notation in RoutingManifest
- **Skill 202**: Socket.io Real-Time KDS - Delivers virtual group updates to KDS screens instantly
- **Skill 203**: Reference Items & Atomic Print - sourceTable field displays T-S notation on tickets
