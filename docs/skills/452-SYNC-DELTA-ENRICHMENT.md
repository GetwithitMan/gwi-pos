# Skill 452: Sync Delta Enrichment — Payments, Discounts, Decimal→Number

**Date:** 2026-02-26
**Commit:** `723f316`
**Status:** DONE

## Overview

Enriched the `/api/sync/delta` response so Android clients get complete order data without extra API calls. Filters orders to active statuses only and converts all Decimal fields to Number.

## Changes

### Order Filtering
- Added `status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] }` and `deletedAt: null`
- Previously returned ALL orders updated since `since` timestamp, including paid/closed

### Includes Added
- `payments: true` — full payment records per order
- `itemDiscounts: true` — per-item discount records

### Decimal→Number Conversions
| Field | Before | After |
|-------|--------|-------|
| `order.subtotal` | `Number(x) \| null` | `Number(x ?? 0)` |
| `order.taxTotal` | `Number(x) \| null` | `Number(x ?? 0)` |
| `order.tipTotal` | missing | `Number(x ?? 0)` |
| `order.discountTotal` | missing | `Number(x ?? 0)` |
| `order.total` | `Number(x) \| null` | `Number(x ?? 0)` |
| `order.paidAmount` | missing | Computed from payments sum |
| `item.price` | `Number(x) \| null` | `Number(x ?? 0)` |
| `item.itemTotal` | missing | `Number(x ?? 0)` |
| `modifier.price` | missing | `Number(x ?? 0)` |
| `itemDiscount.amount` | N/A | `Number(x ?? 0)` |
| `itemDiscount.percent` | N/A | `Number(x) \| null` |
| `payment.amount` | N/A | `Number(x ?? 0)` |
| `payment.tipAmount` | N/A | `Number(x ?? 0)` |
| `payment.totalAmount` | N/A | `Number(x ?? 0)` |

### File Modified
- `src/app/api/sync/delta/route.ts` — +25/-5 lines
