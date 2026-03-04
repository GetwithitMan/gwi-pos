# Feature: MarginEdge Integration

> **Status: ACTIVE** — Fully built as of 2026-03-04.

## Summary
One-way COGS integration with MarginEdge. Pulls vendor invoices into GWI POS, auto-creates vendor records, maps invoice line items to inventory items, and optionally updates ingredient costs when a significant price change is detected. Runs on a daily cron at 8:00 AM UTC (yesterday's invoices) with manual sync available in settings.

## Data Flow
```
MarginEdge API  →  GWI POS
  /invoices         Invoice + InvoiceLineItem (stored in DB)
  /products         MarginEdgeProductMapping (ME product ↔ InventoryItem)
  /vendors          Vendor (auto-created if not found)
  /categories       Reference only
```
**One-way only** — GWI POS never pushes data back to MarginEdge.

## Schema Models
| Model | Purpose |
|-------|---------|
| `Invoice` | Imported invoice header (+ `source: 'marginedge'`, `marginEdgeInvoiceId`) |
| `InvoiceLineItem` | Line items linked to invoice; `marginEdgeProductId` for traceability |
| `MarginEdgeProductMapping` | Links `marginEdgeProductId` → `InventoryItem.id`; `isActive` flag |
| `Vendor` | Auto-created from `meInvoice.vendorName` if not found |
| `IngredientCostHistory` | Written when `autoUpdateCosts` is enabled and cost changed ≥ threshold |

## Settings (`settings.marginEdge`)
| Field | Type | Default |
|-------|------|---------|
| `enabled` | boolean | `false` |
| `apiKey` | string | — |
| `environment` | `'production' \| 'sandbox'` | `'production'` |
| `restaurantId` | string? | — |
| `syncOptions.syncInvoices` | boolean | `true` |
| `syncOptions.autoUpdateCosts` | boolean | `true` |
| `syncOptions.costChangeAlertThreshold` | number | `5` (%) |
| `lastSyncAt` / `lastSyncStatus` / `lastSyncError` | string | — |
| `lastProductSyncAt` / `lastInvoiceSyncAt` | string | — |

## Code Locations
| Purpose | Path |
|---------|------|
| REST client | `src/lib/marginedge-client.ts` |
| Settings interface | `src/lib/settings.ts` (`MarginEdgeSettings`, `DEFAULT_MARGIN_EDGE_SETTINGS`) |
| Admin settings UI | `src/app/(admin)/settings/integrations/marginedge/page.tsx` |
| Status API | `src/app/api/integrations/marginedge/status/route.ts` |
| Test connection API | `src/app/api/integrations/marginedge/test/route.ts` |
| Sync products API | `src/app/api/integrations/marginedge/sync-products/route.ts` |
| Sync invoices API | `src/app/api/integrations/marginedge/sync-invoices/route.ts` |
| Map product API | `src/app/api/integrations/marginedge/map-product/route.ts` |
| Cron (daily) | `src/app/api/cron/marginedge-sync/route.ts` |
| Invoices list API | `src/app/api/invoices/route.ts` |
| Invoices UI | `src/app/(admin)/invoices/page.tsx` |
| Cost cascade | `src/lib/cost-cascade.ts` |
| Integration status hub | `src/app/api/integrations/status/route.ts` |

## Cron Schedule
- Path: `/api/cron/marginedge-sync`
- Schedule: `0 8 * * *` (daily 8:00 AM UTC)
- Auth: `Authorization: Bearer {CRON_SECRET}`
- Syncs yesterday's invoices for all locations where `me.enabled && me.apiKey`

## Key Business Logic
1. **Idempotent imports** — checks `Invoice.marginEdgeInvoiceId` before creating; skips duplicates
2. **Auto vendor creation** — if `meInvoice.vendorName` doesn't match an existing `Vendor`, one is created
3. **Cost auto-update** — if `autoUpdateCosts` is enabled and a mapped line item has a cost change ≥ `costChangeAlertThreshold` %, `InventoryItem.costPerUnit` is updated and an `IngredientCostHistory` record is written
4. **Product mapping** — admin manually maps ME product IDs to GWI `InventoryItem` records via the map-product API; unmapped line items are stored but don't trigger cost updates

## Known Constraints
- Read-only from MarginEdge — GWI sales data is NOT pushed back
- Product mapping must be done manually (no auto-match by name)
- Vendor match is by exact `name` string — no fuzzy matching
- `sync-products` pulls ME product catalog for display in the mapping UI but does not import them as inventory items automatically

## Dependencies
- **Inventory** — `InventoryItem` and `IngredientCostHistory` updated by cost cascade
- **Settings** — `Location.settings.marginEdge` stores credentials and sync state
- **Vendors** — `Vendor` model auto-populated from invoice data
- **Reports** — invoice data visible in `/invoices` admin page

*Last updated: 2026-03-04*
