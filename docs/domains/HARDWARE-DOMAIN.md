# Hardware Domain

**Domain ID:** 9
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Hardware domain manages physical devices including printers, card readers, KDS screens, and cash drawers. It handles:
- Printer configuration (thermal receipt, impact kitchen)
- Print route management with priority-based routing
- ESC/POS protocol for printer communication
- KDS device pairing and security
- Pizza print settings with red ribbon support
- Backup printer failover

## Domain Trigger

```
PM Mode: Hardware
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Printers | Printer configuration | `src/app/api/hardware/printers/` |
| Print Routes | Print routing rules | `src/app/api/hardware/print-routes/` |
| KDS Screens | KDS device management | `src/app/api/hardware/kds-screens/` |
| ESC/POS | Printer commands | `src/lib/escpos/` |
| UI | Hardware settings | `src/components/hardware/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/escpos/commands.ts` | ESC/POS command constants |
| `src/lib/escpos/document.ts` | Document building utilities |
| `src/lib/printer-connection.ts` | TCP socket connection to printers |
| `src/app/api/print/kitchen/route.ts` | Kitchen ticket generation |
| `src/components/hardware/PrintRouteEditor.tsx` | Route editor with live preview |
| `src/types/printer-settings.ts` | Printer settings types |
| `src/types/pizza-print-settings.ts` | Pizza print settings types |
| `src/types/print-route-settings.ts` | Route-specific settings |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 08 | Receipt Printing | DONE |
| 102 | KDS Device Security | DONE |
| 103 | Print Routing | DONE |
| 212 | Per-Modifier Print Routing | DONE (dispatch pending) |

## Integration Points

- **KDS Domain**: Device pairing, screen management
- **Orders Domain**: Ticket printing on send-to-kitchen
- **Menu Domain**: Per-modifier print routing configuration
- **Payments Domain**: Receipt printing
