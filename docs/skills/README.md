# GWI POS Skills Documentation

This directory contains documentation for major features and systems in the GWI POS project.

## Skills Index

### 200-Series: Routing & Kitchen Display

| Skill # | Name | Description | Status |
|---------|------|-------------|--------|
| 201 | [Tag-Based Routing Engine](./201-tag-based-routing.md) | Unified pub/sub routing replacing scattered printerIds | ✅ Complete |
| 202 | [Socket.io Real-Time KDS](./202-socketio-realtime-kds.md) | WebSocket-based KDS updates replacing polling | ✅ Complete |
| 203 | [Reference Items & Atomic Print](./203-reference-items-atomic-print.md) | Context items + per-element print formatting | ✅ Complete |

### Planned Features

| Feature | Description | Spec File |
|---------|-------------|-----------|
| Tip Guide Basis | Calculate tips on gross vs net total | `docs/features/tip-guide-basis.md` |

---

## Quick Reference

### Tag-Based Routing Flow

```
1. Order items added with menuItem.routeTags / category.routeTags
2. API calls OrderRouter.resolveRouting(orderId)
3. Router returns RoutingManifest[] grouped by station
4. dispatchNewOrder() sends to Socket.io rooms
5. KDS screens receive via useKDSSockets hook
6. PrintTemplateFactory builds ticket for PRINTER stations
```

### Key Files by Feature

#### Routing Engine
- `prisma/schema.prisma` - Station model
- `src/lib/order-router.ts` - OrderRouter class
- `src/types/routing.ts` - Types and constants
- `scripts/migrate-routing.ts` - Migration utility

#### Socket.io Real-Time
- `src/lib/socket-server.ts` - Server with room management
- `src/lib/socket-dispatch.ts` - Dispatch helpers
- `src/hooks/useKDSSockets.ts` - React hook
- `src/lib/events/types.ts` - Event types

#### Print Templates
- `src/lib/escpos/commands.ts` - ESC/POS commands
- `src/types/routing.ts` - AtomicPrintConfig

---

## Cross-Reference: Files → Skills

| File | Skills |
|------|--------|
| `prisma/schema.prisma` | 201, 203 |
| `src/lib/order-router.ts` | 201, 203 |
| `src/types/routing.ts` | 201, 203 |
| `src/lib/socket-server.ts` | 202 |
| `src/lib/socket-dispatch.ts` | 202 |
| `src/hooks/useKDSSockets.ts` | 202 |
| `src/lib/events/types.ts` | 202 |
| `src/app/api/orders/[id]/send/route.ts` | 201, 202 |
| `scripts/migrate-routing.ts` | 201 |

---

## Related Documentation

- **CHANGELOG:** `/CHANGELOG.md` - Session-by-session changes
- **CLAUDE.md:** `/CLAUDE.md` - Project reference for AI assistants
- **Plan Files:** `~/.claude/plans/` - Implementation plans

## Adding New Skills

When documenting a new feature:

1. Create `docs/skills/XXX-feature-name.md`
2. Use next available number in appropriate series:
   - 100s: Core POS (orders, payments, tables)
   - 200s: Routing & Kitchen Display
   - 300s: Printing & Hardware
   - 400s: Reporting & Analytics
   - 500s: Employee & Permissions
   - 600s: Inventory & Recipes

3. Include:
   - Overview with problem/solution
   - Core files table
   - Code examples
   - Related skills cross-references
   - CHANGELOG session reference

4. Update this README index
5. Add to CHANGELOG under appropriate session
