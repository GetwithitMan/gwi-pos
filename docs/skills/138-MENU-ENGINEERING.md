# Skill 138: Menu Engineering Matrix

## Overview
Classify menu items by profitability and popularity to optimize menu decisions.

## Status: Planned

## Problem
Managers make menu decisions without data:
- Which items to promote?
- Which items to remove?
- Where to adjust pricing?
- What's the optimal menu mix?

## Solution

### The Menu Engineering Matrix
Classic 4-quadrant analysis based on:
- **Profitability**: Contribution margin vs average
- **Popularity**: Units sold vs average

```
                    HIGH PROFIT
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       │    PUZZLES      │     STARS       │
       │   High margin   │   High margin   │
       │   Low sales     │   High sales    │
  LOW  │                 │                 │  HIGH
 SALES │─────────────────┼─────────────────│ SALES
       │                 │                 │
       │     DOGS        │   PLOW HORSES   │
       │   Low margin    │   Low margin    │
       │   Low sales     │   High sales    │
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    LOW PROFIT
```

### Category Strategies

**⭐ STARS** (High profit, High sales)
- Your best items - protect and maintain
- Keep recipe consistent
- Prime menu placement
- Don't discount

**🧩 PUZZLES** (High profit, Low sales)
- Hidden gems with potential
- Increase visibility
- Train staff to suggest
- Consider renaming/repositioning

**🐴 PLOW HORSES** (Low profit, High sales)
- Customer favorites that don't pay well
- Try to increase price slightly
- Reduce portion or cost
- Bundle with high-margin items

**🐕 DOGS** (Low profit, Low sales)
- Candidates for removal
- Consider if required for menu completeness
- May need complete rework
- Free up menu space for better items

### UI - Matrix View
```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 MENU ENGINEERING MATRIX               Category: [All Items ▼]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│         HIGH PROFIT                                             │
│              │                                                  │
│  ┌───────────┼───────────┐                                     │
│  │ PUZZLES   │   STARS   │                                     │
│  │           │           │                                     │
│  │ • Calzone │ • Lg Pep  │                                     │
│  │ • Stromb  │ • Wings   │                                     │
│  │   3 items │ • Combo   │                                     │
│  │           │   8 items │                                     │
│  │───────────┼───────────│                                     │
│  │   DOGS    │  PLOWS    │                                     │
│  │           │           │                                     │
│  │ • Side    │ • Cheese  │                                     │
│  │   Salad   │   Pizza   │                                     │
│  │ • Bread   │ • Burger  │                                     │
│  │   5 items │   6 items │                                     │
│  └───────────┼───────────┘                                     │
│              │                                                  │
│         LOW PROFIT                                              │
│                                                                 │
│ Click a quadrant to see item details                           │
└─────────────────────────────────────────────────────────────────┘
```

### UI - Item Detail View
```
┌─────────────────────────────────────────────────────────────────┐
│ ⭐ STARS - Your Best Performers                                 │
├─────────────────────────────────────────────────────────────────┤
│ Item              Sold    Margin   CM $     Total CM   Status   │
│ ─────────────────────────────────────────────────────────────── │
│ Large Pepperoni   245     68.2%    $9.15    $2,242     ⭐       │
│ Buffalo Wings     198     61.8%    $6.79    $1,344     ⭐       │
│ Family Combo      87      72.4%    $18.20   $1,583     ⭐       │
│ BBQ Chicken Pz    156     65.1%    $10.40   $1,622     ⭐       │
│                                                                 │
│ 💡 Strategy: Maintain quality, keep prominent placement         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🧩 PUZZLES - High Margin, Need More Sales                       │
├─────────────────────────────────────────────────────────────────┤
│ Item              Sold    Margin   CM $     Total CM   Action   │
│ ─────────────────────────────────────────────────────────────── │
│ Stromboli         23      71.2%    $8.50    $196       Promote  │
│ Calzone           31      69.8%    $7.90    $245       Promote  │
│ Loaded Fries      18      74.5%    $5.20    $94        Promote  │
│                                                                 │
│ 💡 Strategy: Feature in specials, train servers to suggest      │
└─────────────────────────────────────────────────────────────────┘
```

### Calculations
```typescript
// For each menu item in period:
contributionMargin = menuPrice - foodCost  // CM in dollars
marginPercent = (contributionMargin / menuPrice) * 100
totalCM = contributionMargin * unitsSold

// Category averages:
avgMarginPercent = sum(marginPercent) / itemCount
avgUnitsSold = totalUnitsSold / itemCount

// Classification:
if (marginPercent >= avgMarginPercent && unitsSold >= avgUnitsSold) → STAR
if (marginPercent >= avgMarginPercent && unitsSold < avgUnitsSold) → PUZZLE
if (marginPercent < avgMarginPercent && unitsSold >= avgUnitsSold) → PLOW_HORSE
if (marginPercent < avgMarginPercent && unitsSold < avgUnitsSold) → DOG
```

### API Endpoints
- `GET /api/reports/menu-engineering?from=&to=` - Full matrix data
- `GET /api/reports/menu-engineering/[category]` - By menu category
- `GET /api/menu/items/[id]/performance` - Single item analysis

### Route
`/reports/menu-engineering`

## Related Skills
- Skill 131: Food Cost Dashboard
- Skill 135: Theoretical vs Actual Usage
