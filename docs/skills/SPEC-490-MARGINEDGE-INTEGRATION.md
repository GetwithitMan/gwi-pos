# SPEC-490: MarginEdge Integration

> **Status: DONE** — Completed 2026-03-04.
> **Feature doc:** `docs/features/marginedge-integration.md`

## What Was Built
One-way COGS integration between MarginEdge and GWI POS. MarginEdge is a restaurant accounting/invoice management platform. GWI pulls invoice data from MarginEdge to auto-import vendor invoices and keep ingredient costs current.

## Architecture Decisions
- **One-way only** — GWI never pushes data to MarginEdge. MarginEdge is the source of truth for vendor invoices.
- **Credential storage** — API key stored in `Location.settings.marginEdge.apiKey` (DB-only, never returned to frontend via API)
- **No OAuth** — MarginEdge uses Bearer token (API key) auth, no token refresh needed
- **Idempotent by design** — invoice import checks `marginEdgeInvoiceId` before creating; safe to re-run

## Files Created/Modified
| File | Action |
|------|--------|
| `src/lib/marginedge-client.ts` | CREATED — REST client (getProducts, getVendors, getCategories, getInvoices, getInvoice, testConnection) |
| `src/lib/settings.ts` | MODIFIED — MarginEdgeSettings interface + DEFAULT_MARGIN_EDGE_SETTINGS + merge in parseSettings |
| `src/app/api/integrations/marginedge/status/route.ts` | CREATED |
| `src/app/api/integrations/marginedge/test/route.ts` | CREATED |
| `src/app/api/integrations/marginedge/sync-products/route.ts` | CREATED |
| `src/app/api/integrations/marginedge/sync-invoices/route.ts` | CREATED |
| `src/app/api/integrations/marginedge/map-product/route.ts` | CREATED |
| `src/app/api/cron/marginedge-sync/route.ts` | CREATED — daily cron, syncs yesterday's invoices for all enabled locations |
| `src/app/(admin)/settings/integrations/marginedge/page.tsx` | CREATED — credentials form, sync status, product mapping UI |
| `src/app/api/invoices/route.ts` | CREATED/EXISTS — lists invoices with source filter |
| `src/app/(admin)/invoices/page.tsx` | CREATED/EXISTS — invoice list UI |
| `src/lib/cost-cascade.ts` | EXISTS — cost update logic referenced in sync-invoices |
| `vercel.json` | MODIFIED — added `{ "path": "/api/cron/marginedge-sync", "schedule": "0 8 * * *" }` |
| `scripts/nuc-pre-migrate.js` | MODIFIED — DDL for Invoice, InvoiceLineItem, MarginEdgeProductMapping, IngredientCostHistory tables |

## Schema Models Added
- `Invoice` — `source: 'marginedge'`, `marginEdgeInvoiceId String? @unique`
- `InvoiceLineItem` — `marginEdgeProductId String?`
- `MarginEdgeProductMapping` — `marginEdgeProductId`, `inventoryItemId`, `isActive`
- `IngredientCostHistory` — `source`, `invoiceId`, `oldCostPerUnit`, `newCostPerUnit`, `changePercent`

## Cost Auto-Update Logic
When `syncOptions.autoUpdateCosts = true` and a line item maps to an `InventoryItem`:
1. Compute `newCost = li.unitCost / item.unitsPerPurchase` (or `li.unitCost` if no conversion)
2. Compute `changePct = |newCost - oldCost| / oldCost * 100`
3. If `changePct >= costChangeAlertThreshold` (default 5%) OR `oldCost === 0`: update `InventoryItem.costPerUnit` and write `IngredientCostHistory`

*Last updated: 2026-03-04*
