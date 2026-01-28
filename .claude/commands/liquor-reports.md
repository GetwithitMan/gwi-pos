# Liquor Reports

View comprehensive liquor and spirits reporting including sales, pour costs, and upsell performance.

## Overview

The liquor reports provide insights into:
- Spirit sales by tier
- Sales by category
- Bottle usage and pour tracking
- Pour cost analysis
- Upsell performance metrics

## Report Tabs

### 1. Overview
Summary cards and charts:
- Total pours
- Total pour cost
- Spirit revenue
- Gross margin %
- Unique bottles used
- Spirit selection count
- Sales by tier bar chart
- Category breakdown table

### 2. By Tier
Detailed tier breakdown:
- Drinks sold per tier
- Revenue per tier
- Order count per tier
- Average revenue per order

Color coding:
- Well: Gray
- Call: Blue
- Premium: Purple
- Top Shelf: Amber

### 3. Bottle Usage
Track which bottles are being used:
- Bottle name and category
- Tier badge
- Total pours
- Total cost
- Sorted by highest usage

### 4. Pour Cost Analysis
Cocktail profitability analysis:
- Cocktail name
- Sell price
- Pour cost (recipe cost)
- Profit per drink
- Margin percentage
- Ingredient count

Sorted by lowest margin first to identify potential pricing issues.

### 5. Upsells
Upsell performance metrics:
- **Summary**: Total shown, accepted, acceptance rate, revenue
- **By Tier**: Which upgrade tiers perform best
- **By Employee**: Who converts the most upsells

## API Endpoint

```
GET /api/reports/liquor?locationId=xxx&startDate=2026-01-01&endDate=2026-01-28
```

## Response Structure

```json
{
  "summary": {
    "totalPours": 245.5,
    "totalPourCost": 487.23,
    "totalSpiritRevenue": 2456.00,
    "grossMargin": 80.2,
    "uniqueBottlesUsed": 18,
    "spiritSelectionCount": 156
  },
  "byTier": [...],
  "byCategory": [...],
  "byBottle": [...],
  "pourCostAnalysis": [...],
  "upsells": {
    "summary": {...},
    "byTier": [...],
    "byEmployee": [...]
  }
}
```

## Key Metrics

### Gross Margin
```
margin = ((revenue - pourCost) / revenue) * 100
```

Target: 75-85% for cocktails

### Upsell Acceptance Rate
```
rate = (accepted / shown) * 100
```

Good performance: 20-30%

### Pour Cost Ratio
```
ratio = pourCost / sellPrice
```

Target: 15-25%

## Admin UI

Navigate to `/reports/liquor` to view reports via the UI.

## Filters

- **Date Range**: Start date and end date
- **Location**: Required (uses current location)
- **Employee**: Optional filter by server
