# Skill 133: Quick Pricing Update

## Overview
Batch update ingredient costs from a single page - perfect for processing invoices quickly.

## Status: Planned

## Problem
When an invoice arrives, managers need to update multiple ingredient costs:
- Currently requires editing each ingredient individually
- Time consuming for invoices with 20+ items
- Easy to miss items or make entry errors

## Solution

### UI - Quick Pricing Page
```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 QUICK PRICING UPDATE                    Invoice Date: [____] │
├─────────────────────────────────────────────────────────────────┤
│ Search: [_______________]  Filter: [All Categories ▼]           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Item                    Current     New Cost    Change          │
│ ─────────────────────────────────────────────────────────────── │
│ ☑ Chicken Wings         $2.40/lb    [$2.69  ]   +12.1% ⚠️      │
│ ☑ All-Purpose Flour     $0.42/lb    [$0.46  ]   +9.5%          │
│ ☐ Mozzarella Cheese     $3.20/lb    [       ]   —              │
│ ☐ Pepperoni             $4.50/lb    [       ]   —              │
│ ☐ Pizza Sauce           $0.85/can   [       ]   —              │
│                                                                 │
│ [Tab] to move between fields                                    │
├─────────────────────────────────────────────────────────────────┤
│ 2 items changed | Total impact: +$127/week (estimated)          │
│                                                                 │
│ [Cancel]                              [Preview Impact] [Save]   │
└─────────────────────────────────────────────────────────────────┘
```

### Features
- **Keyboard-Friendly**: Tab between fields, Enter to save
- **Change Highlighting**: Show % change with color coding
- **Impact Preview**: Estimate weekly cost impact before saving
- **Bulk Selection**: Select multiple items for same % increase
- **Invoice Link**: Optionally link updates to invoice record
- **Auto-History**: Each update creates price history entry

### Bulk Actions
```
┌─────────────────────────────────────────┐
│ BULK ACTION                             │
│ Apply [+5%] increase to selected items  │
│ [Apply to 12 selected]                  │
└─────────────────────────────────────────┘
```

### API Endpoints
- `POST /api/inventory/bulk-price-update` - Update multiple prices at once
- `GET /api/inventory/price-impact-preview` - Calculate impact before saving

### Route
`/inventory/quick-pricing` or `/inventory/pricing`

## Related Skills
- Skill 130: Historical Cost Tracking
- Skill 131: Food Cost Dashboard
- Skill 132: Alerts System
