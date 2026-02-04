# Skill 115: Inventory & Recipe Costing System

---
skill_id: 115
name: Inventory & Recipe Costing System
status: planning
priority: critical
phase: 1
dependencies: [void-system]
estimated_effort: x-large
---

## Overview

A comprehensive inventory management system that tracks food and liquor at the ingredient level, calculates theoretical vs actual usage, and provides variance reporting. Designed to eliminate the need for third-party integrations like MarginEdge or Restaurant365, while also supporting API exports to those systems if desired.

## Key Principles

1. **Simple for end users** - Building menus shouldn't require an accounting degree
2. **Granular tracking** - Every ingredient tracked from purchase to plate
3. **Unified system** - Food and liquor in one system, but reportable separately
4. **Automatic calculations** - Theoretical usage calculated from sales automatically
5. **Actionable insights** - Variance reports that pinpoint problems

---

## Core Concepts

### 1. Inventory Items (The Building Blocks)

Everything you purchase goes into the inventory as an **Inventory Item**:

| Field | Purpose | Example |
|-------|---------|---------|
| `name` | What you call it | "Chicken Breast" |
| `itemType` | Classification | `food`, `liquor`, `supply` |
| `category` | Grouping | "Protein", "Dairy", "Whiskey" |
| `brand` | For liquor/branded items | "Tyson", "Tito's" |
| `revenueCenter` | Reporting group | "Kitchen", "Bar" |
| `purchaseUnit` | How you buy it | "case", "lb", "bottle" |
| `purchaseSize` | Size of purchase unit | 15 (for 15lb case) |
| `purchaseCost` | Cost per purchase unit | $65.00 |
| `storageUnit` | How you count/use it | "oz", "each" |
| `unitsPerPurchase` | Conversion factor | 240 (oz per 15lb case) |
| `costPerUnit` | Auto-calculated | $0.27/oz |
| `yieldPercent` | Usable after trim/cook | 75% |

### 2. Item Types & Revenue Centers

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPARTMENTS (COGS Split)                  │
├─────────────────────────────────────────────────────────────┤
│  Food      → Food COGS on P&L                               │
│  Beverage  → Beverage COGS on P&L (Liquor, Beer, Wine)     │
│  Retail    → Retail COGS (merch, to-go items)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    ITEM TYPES                                │
├─────────────────────────────────────────────────────────────┤
│  food     → Kitchen revenue center, Department: Food        │
│  liquor   → Bar revenue center, Department: Beverage        │
│  beer     → Bar revenue center, Department: Beverage        │
│  wine     → Bar revenue center, Department: Beverage        │
│  supply   → Non-COGS (napkins, to-go containers)           │
│  retail   → Retail revenue center, Department: Retail       │
│  other    → Miscellaneous                                   │
└─────────────────────────────────────────────────────────────┘

Reports can be run by:
- **Department** (Food COGS vs Beverage COGS vs Retail COGS)
- **Item type** (all food, all liquor, all beer, all wine)
- **Revenue center** (kitchen, bar)
- **Category** (proteins, dairy, whiskey, vodka)
- **Brand** (Tyson, Tito's)
- **Combined** (total COGS)

This enables standard P&L structure:
- Food Sales / Food COGS = Food Margin
- Beverage Sales / Beverage COGS = Beverage Margin
- Retail Sales / Retail COGS = Retail Margin
```

### 3. Prep Items (Derived Ingredients)

Items made from inventory items with yield tracking:

```
PREP ITEM: Shredded Chicken
├── Input: 10 lb raw chicken breast @ $3.50/lb = $35.00
├── Yield: 75% (cooking/trim loss)
├── Output: 7.5 lb shredded chicken
└── Cost: $35.00 / 7.5 lb = $4.67/lb (120 oz @ $0.29/oz)

PREP ITEM: Simple Syrup
├── Input: 4 cups sugar @ $0.15/cup = $0.60
├── Input: 4 cups water @ $0.00
├── Output: 1 quart simple syrup (32 oz)
└── Cost: $0.60 / 32 oz = $0.019/oz
```

### Costing Methods

Since ingredient prices fluctuate with each purchase, we need a method to calculate `costPerUnit`:

| Method | Description | Best For |
|--------|-------------|----------|
| **Weighted Average** (Default) | `(existing value + new purchase) / total units` | Most restaurants, simpler |
| **FIFO** (First-In, First-Out) | Oldest inventory cost used first | High-value items, accounting compliance |

**Weighted Average Example:**
```
Current: 10 lb chicken @ $3.50/lb = $35.00
New Purchase: 20 lb chicken @ $4.00/lb = $80.00
───────────────────────────────────────────
Total: 30 lb @ $115.00
Weighted Average: $115 / 30 = $3.83/lb
```

**Why Weighted Average is Default:**
- Simpler to understand and implement
- No need to track individual purchase lots
- Smooths out price volatility
- Acceptable for tax purposes in most cases

**Price Source Tracking:**
Each inventory item tracks where its current cost came from:
- `manual` - Manager entered the cost
- `invoice` - Updated from invoice entry
- `api` - Updated from vendor API/EDI

### 4. Label vs Ingredient (Modifier Classification)

When creating modifiers, distinguish between groupings and trackable items:

| Type | Purpose | Inventory Link | Example |
|------|---------|----------------|---------|
| **Label** | Groups choices | None | "Choose Your Cheese" |
| **Ingredient** | Trackable item | Yes | "Cheddar" (1 oz) |

```
MODIFIER GROUP: "Choose Your Cheese" (LABEL - no tracking)
├── Cheddar (INGREDIENT) → links to Cheddar Cheese, 1 oz
├── Swiss (INGREDIENT) → links to Swiss Cheese, 1 oz
├── Pepper Jack (INGREDIENT) → links to Pepper Jack, 1 oz
└── No Cheese (LABEL) → no link, reduces theoretical usage

MODIFIER: "Add Bacon" (INGREDIENT - directly trackable)
└── links to Bacon inventory, 0.5 oz per selection
```

### 5. Menu Item Recipes

Every menu item can have a recipe defining ingredients and quantities:

```
CHICKEN SANDWICH RECIPE
┌─────────────────────────────────────────────────────────────┐
│ Ingredient          │ Type  │ Qty  │ Unit │ Cost    │      │
├─────────────────────┼───────┼──────┼──────┼─────────┤      │
│ Shredded Chicken    │ prep  │ 4    │ oz   │ $1.17   │      │
│ Brioche Bun         │ item  │ 1    │ each │ $0.35   │      │
│ Mayo                │ item  │ 0.5  │ oz   │ $0.08   │      │
│ Pickle Chips        │ item  │ 4    │ each │ $0.05   │      │
│ Lettuce             │ item  │ 0.5  │ oz   │ $0.03   │      │
├─────────────────────┼───────┼──────┼──────┼─────────┤      │
│ TOTAL FOOD COST     │       │      │      │ $1.68   │      │
│ Menu Price          │       │      │      │ $12.99  │      │
│ Food Cost %         │       │      │      │ 12.9%   │      │
│ Gross Margin        │       │      │      │ $11.31  │      │
└─────────────────────────────────────────────────────────────┘
```

---

## Waste Tracking (Void Integration)

When an item is voided, the system asks additional questions:

### Void Flow

```
┌─────────────────────────────────────────────────────────────┐
│  VOID ITEM: Chicken Sandwich                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Void Reason:                                               │
│  ○ Customer changed mind                                    │
│  ○ Incorrect order                                          │
│  ○ Kitchen error                                            │
│  ○ Quality issue                                            │
│  ○ Comp/Manager discount                                    │
│  ○ Other: [________________]                                │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  📦 Was this item made?                                     │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │   YES ✓     │  │   NO ✗      │                          │
│  │  (Made)     │  │ (Not Made)  │                          │
│  └─────────────┘  └─────────────┘                          │
│                                                             │
│  If YES → Item counts toward ACTUAL usage (waste)          │
│  If NO  → Item does NOT count toward actual usage          │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Manager PIN: [____]  (if required by settings)            │
│                                                             │
│  [Cancel]                              [Confirm Void]       │
└─────────────────────────────────────────────────────────────┘
```

### Void Reasons (with `deductInventory` flag)

The key insight: **the void reason determines whether inventory is deducted**, not a separate question. This is cleaner UX.

| Void Reason | `deductInventory` | Description |
|-------------|-------------------|-------------|
| **Customer Changed Mind** | `false` | Caught before kitchen started |
| **Incorrect Order Entry** | `false` | Server error, caught early |
| **Kitchen Error - Made** | `true` | Kitchen made wrong item |
| **Kitchen Error - Not Made** | `false` | Kitchen caught error before cooking |
| **Quality Issue** | `true` | Food quality problem, item made |
| **Comp** | `true` | Given free, but item was made |
| **Manager Discount** | `false` | Price adjustment, not waste |
| **Training** | `true` | Training waste |

**Schema Addition (VoidReason):**
```prisma
model VoidReason {
  id              String   @id @default(cuid())
  locationId      String
  location        Location @relation(fields: [locationId], references: [id])

  name            String   // "Kitchen Error - Made"
  description     String?
  deductInventory Boolean  @default(false) // Auto-deduct from theoretical
  requiresManager Boolean  @default(false) // Requires manager PIN
  isActive        Boolean  @default(true)
  sortOrder       Int      @default(0)

  // Sync fields
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([locationId, name])
  @@index([locationId])
}
```

When a void is processed with a reason that has `deductInventory: true`, the system automatically:
1. Looks up the menu item's recipe
2. Calculates ingredient quantities
3. Creates waste log entries for each ingredient
4. Updates theoretical usage tracking

### Waste Log (Standalone)

For waste that doesn't come through voids:

```
┌─────────────────────────────────────────────────────────────┐
│  LOG WASTE                                                  │
├─────────────────────────────────────────────────────────────┤
│  Item: [ Search inventory...     🔍 ]                      │
│        Chicken Breast (raw)                                 │
│                                                             │
│  Quantity: [ 2    ] [ lb ▼ ]                               │
│                                                             │
│  Reason:                                                    │
│  ○ Spoilage / Expired                                       │
│  ○ Spill / Drop                                            │
│  ○ Overcooked / Burned                                      │
│  ○ Contamination                                            │
│  ○ Training                                                 │
│  ○ Other: [________________]                                │
│                                                             │
│  Notes: [________________________________]                  │
│                                                             │
│  Cost Impact: $7.00                                         │
│                                                             │
│  [Cancel]                              [Log Waste]          │
└─────────────────────────────────────────────────────────────┘
```

---

## Invoice Integration

### Manual Invoice Entry

```
┌─────────────────────────────────────────────────────────────┐
│  ENTER INVOICE                                              │
├─────────────────────────────────────────────────────────────┤
│  Vendor: [ Sysco                    ▼ ]                    │
│  Invoice #: [ INV-2026-0542        ]                       │
│  Invoice Date: [ 01/31/2026        📅 ]                    │
│  Due Date: [ 02/14/2026            📅 ]                    │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  LINE ITEMS                                      + Add Line │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  │ Item                 │ Qty │ Unit │ Unit Cost │ Total  │ │
│  ├──────────────────────┼─────┼──────┼───────────┼────────┤ │
│  │ Chicken Breast 40lb  │ 2   │ case │ $89.50    │ $179.00│ │
│  │ Cheddar 5lb Block    │ 4   │ each │ $18.00    │ $72.00 │ │
│  │ Bacon 15lb           │ 1   │ case │ $65.00    │ $65.00 │ │
│  └──────────────────────┴─────┴──────┴───────────┴────────┘ │
│                                                             │
│  Subtotal:    $316.00                                       │
│  Tax:         $0.00                                         │
│  Shipping:    $0.00                                         │
│  ─────────────────────────                                  │
│  TOTAL:       $316.00                                       │
│                                                             │
│  ☑ Update inventory costs from this invoice                │
│  ☑ Add quantities to inventory                              │
│                                                             │
│  [Cancel]                              [Save Invoice]       │
└─────────────────────────────────────────────────────────────┘
```

### Automatic Cost Updates

When invoice is saved with "Update inventory costs":
- System recalculates `costPerUnit` for affected items
- Menu item recipe costs auto-update
- Price alerts if food cost % exceeds threshold

### API Export (For Third-Party Systems)

```typescript
// Export to MarginEdge, Restaurant365, etc.
POST /api/integrations/export

{
  "target": "marginedge", // or "restaurant365", "quickbooks"
  "dataType": "invoices", // or "sales", "inventory"
  "dateRange": {
    "start": "2026-01-01",
    "end": "2026-01-31"
  }
}

// Response includes webhook URL or file download
```

**Supported Exports:**
- Invoices/Purchases
- Sales by item (P-mix)
- Inventory counts
- Waste log
- Theoretical vs actual reports

---

## Inventory Counts

### Count Settings (Back Office)

```
┌─────────────────────────────────────────────────────────────┐
│  INVENTORY COUNT SETTINGS                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Default Count Frequency:                                   │
│  ○ Daily                                                    │
│  ● Weekly                                                   │
│  ○ Bi-weekly                                                │
│  ○ Monthly                                                  │
│  ○ Custom schedule                                          │
│                                                             │
│  Count Reminder Day: [ Sunday ▼ ]                          │
│  Count Due Time: [ 6:00 AM ▼ ]                             │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Count Areas:                                               │
│  ☑ Walk-in Cooler                                          │
│  ☑ Dry Storage                                              │
│  ☑ Bar                                                      │
│  ☑ Liquor Room                                              │
│  ☐ Line (daily spot counts only)                           │
│  [ + Add Area ]                                             │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Permissions:                                               │
│  Who can start counts: [ Managers, Supervisors ▼ ]         │
│  Who can complete counts: [ Anyone ▼ ]                     │
│  Require manager review: ☑ Yes                             │
│  Variance threshold for alert: [ 5 ] %                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Count Types

| Type | Description | When Used |
|------|-------------|-----------|
| **Full Count** | All items in all areas | Weekly/Monthly |
| **Area Count** | All items in one area | As needed |
| **Spot Count** | Specific items only | Daily high-value |
| **Cycle Count** | Rotating subset of items | Daily |

### Mobile Count Interface

```
┌─────────────────────────────────────────────────────────────┐
│  📱 INVENTORY COUNT - Walk-in Cooler                       │
├─────────────────────────────────────────────────────────────┤
│  Progress: 12/45 items                                      │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  27%           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Chicken Breast (40lb case)                                 │
│  Expected: 2.5 cases                                        │
│                                                             │
│  Count: [     ] cases                                       │
│         [     ] lbs (partial)                               │
│                                                             │
│  [ 📷 Scan Barcode ]                                       │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [← Previous]              [Skip]              [Next →]    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Reports

### 1. Theoretical Usage Report

Shows what SHOULD have been used based on sales:

```
THEORETICAL USAGE REPORT
Period: Jan 24-30, 2026
Revenue Center: Kitchen

┌──────────────────────────────────────────────────────────────────┐
│ Item              │ Category │ Units Used │ Unit  │ Cost        │
├───────────────────┼──────────┼────────────┼───────┼─────────────┤
│ Chicken Breast    │ Protein  │ 156.5      │ lb    │ $547.75     │
│ Ground Beef       │ Protein  │ 89.2       │ lb    │ $401.40     │
│ Cheddar Cheese    │ Dairy    │ 23.5       │ lb    │ $84.60      │
│ Bacon             │ Protein  │ 12.8       │ lb    │ $55.68      │
│ Brioche Buns      │ Bread    │ 342        │ each  │ $119.70     │
│ ...               │          │            │       │             │
├───────────────────┼──────────┼────────────┼───────┼─────────────┤
│ TOTAL KITCHEN     │          │            │       │ $2,847.32   │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Actual vs Theoretical Variance Report

The money report - shows where you're losing inventory:

```
VARIANCE REPORT
Period: Jan 24-30, 2026
Revenue Center: All

┌────────────────────────────────────────────────────────────────────────────┐
│ Item              │ Theoretical │ Actual  │ Variance │ Var %  │ $ Impact  │
├───────────────────┼─────────────┼─────────┼──────────┼────────┼───────────┤
│ 🔴 Chicken Breast │ 156.5 lb    │ 168.2lb │ +11.7 lb │ +7.5%  │ -$40.95   │
│ 🔴 Tito's Vodka   │ 4.2 btl     │ 5.0 btl │ +0.8 btl │ +19%   │ -$17.60   │
│ 🟡 Ground Beef    │ 89.2 lb     │ 92.5 lb │ +3.3 lb  │ +3.7%  │ -$14.85   │
│ 🟢 Cheddar Cheese │ 23.5 lb     │ 24.0 lb │ +0.5 lb  │ +2.1%  │ -$1.80    │
│ 🟢 Bacon          │ 12.8 lb     │ 12.5 lb │ -0.3 lb  │ -2.3%  │ +$1.30    │
├───────────────────┼─────────────┼─────────┼──────────┼────────┼───────────┤
│ TOTAL VARIANCE    │             │         │          │ +4.2%  │ -$156.42  │
└────────────────────────────────────────────────────────────────────────────┘

Legend: 🔴 >5% variance  🟡 2-5% variance  🟢 <2% variance

Top Variance Drivers:
1. Chicken Breast: Investigate portioning - 11.7 lb over = ~47 sandwiches worth
2. Tito's Vodka: Possible over-pours or theft - 0.8 bottles = ~27 drinks
```

### 3. P-Mix (Product Mix) Report

What's selling and at what margin:

```
P-MIX REPORT
Period: Jan 24-30, 2026
Category: Sandwiches

┌──────────────────────────────────────────────────────────────────────────────┐
│ Item                │ Qty Sold │ % Mix │ Food Cost │ FC %  │ Margin │ Rev    │
├─────────────────────┼──────────┼───────┼───────────┼───────┼────────┼────────┤
│ Chicken Sandwich    │ 145      │ 34%   │ $1.68     │ 12.9% │ $11.31 │ $1,884 │
│ Bacon Cheeseburger  │ 132      │ 31%   │ $2.45     │ 17.5% │ $11.55 │ $1,848 │
│ Club Sandwich       │ 98       │ 23%   │ $2.12     │ 16.3% │ $10.88 │ $1,274 │
│ Grilled Cheese      │ 52       │ 12%   │ $0.89     │ 11.1% │ $7.11  │ $416   │
├─────────────────────┼──────────┼───────┼───────────┼───────┼────────┼────────┤
│ TOTAL               │ 427      │ 100%  │ Avg $1.92 │ 14.5% │ $10.49 │ $5,422 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4. Waste Report

Track all waste sources:

```
WASTE REPORT
Period: Jan 24-30, 2026

BY SOURCE:
┌────────────────────────────────────────────────────────────┐
│ Source                    │ Incidents │ Cost    │ % Total │
├───────────────────────────┼───────────┼─────────┼─────────┤
│ Voids - Made (Kitchen)    │ 23        │ $67.50  │ 42%     │
│ Voids - Made (Customer)   │ 15        │ $45.20  │ 28%     │
│ Spoilage                  │ 8         │ $32.00  │ 20%     │
│ Spills/Drops              │ 5         │ $12.30  │ 8%      │
│ Training                  │ 2         │ $3.50   │ 2%      │
├───────────────────────────┼───────────┼─────────┼─────────┤
│ TOTAL WASTE               │ 53        │ $160.50 │ 100%    │
└────────────────────────────────────────────────────────────┘

TOP WASTED ITEMS:
1. Chicken Breast - $28.00 (8 incidents)
2. Burger Patties - $22.50 (6 incidents)
3. Fries - $15.00 (12 incidents)
```

### 5. Cost Change Alert Report

When ingredient costs change significantly:

```
COST CHANGE ALERTS
Period: Jan 24-30, 2026

┌──────────────────────────────────────────────────────────────────────────────┐
│ Item              │ Old Cost  │ New Cost  │ Change  │ Menu Items Affected   │
├───────────────────┼───────────┼───────────┼─────────┼───────────────────────┤
│ 🔴 Chicken Breast │ $3.50/lb  │ $4.25/lb  │ +21%    │ 12 items              │
│ 🔴 Bacon          │ $4.33/lb  │ $5.10/lb  │ +18%    │ 8 items               │
│ 🟡 Cheddar Cheese │ $3.60/lb  │ $3.85/lb  │ +7%     │ 15 items              │
└──────────────────────────────────────────────────────────────────────────────┘

MARGIN IMPACT:
- Chicken Sandwich: FC% was 12.9%, now 15.2% (+2.3 pts)
- Bacon Cheeseburger: FC% was 17.5%, now 19.8% (+2.3 pts)

Recommended: Review pricing on affected items
```

---

## Schema Design

### New Models

```prisma
// ============================================
// INVENTORY & RECIPE COSTING
// ============================================

// Storage locations for inventory (Walk-in, Dry Storage, Bar, etc.)
model StorageLocation {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  name        String   // "Main Walk-in", "Bar Well 1", "Dry Storage"
  description String?
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)

  // Relations
  inventoryItems InventoryItemStorage[]
  inventoryCounts InventoryCount[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([locationId, name])
  @@index([locationId])
}

// Links inventory items to storage locations (item can be in multiple locations)
model InventoryItemStorage {
  id                String          @id @default(cuid())
  locationId        String
  location          Location        @relation(fields: [locationId], references: [id])
  inventoryItemId   String
  inventoryItem     InventoryItem   @relation(fields: [inventoryItemId], references: [id])
  storageLocationId String
  storageLocation   StorageLocation @relation(fields: [storageLocationId], references: [id])

  currentStock      Decimal  @default(0)  // Stock at THIS location
  parLevel          Decimal? // Par level for THIS location

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([inventoryItemId, storageLocationId])
  @@index([locationId])
  @@index([storageLocationId])
}

// Core inventory item - everything you purchase
model InventoryItem {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  // Identity
  name        String   // "Chicken Breast", "Tito's Vodka"
  sku         String?  // Optional SKU/barcode
  description String?

  // Classification - CRITICAL FOR COGS REPORTING
  department    String   // "Food", "Beverage", "Retail" - for P&L COGS split
  itemType      String   // "food", "liquor", "beer", "wine", "supply"
  revenueCenter String   // "kitchen", "bar"
  category      String   // "protein", "dairy", "whiskey", "vodka"
  subcategory   String?  // "bourbon", "scotch"
  brand         String?  // "Tyson", "Tito's"

  // Purchase info
  purchaseUnit     String   // "case", "lb", "bottle", "each"
  purchaseSize     Decimal  // 15 (for 15lb case), 1 (for single bottle)
  purchaseCost     Decimal  // $65.00 per case
  defaultVendorId  String?

  // Storage/usage unit (what you count in)
  storageUnit      String   // "oz", "each", "bottle"
  unitsPerPurchase Decimal  // 240 oz per 15lb case
  costPerUnit      Decimal  // Auto-calc: purchaseCost / unitsPerPurchase

  // Costing method & tracking
  costingMethod    String   @default("weighted_average") // "weighted_average" or "fifo"
  lastPriceUpdate  DateTime? // When cost was last updated
  priceSource      String   @default("manual") // "manual", "invoice", "api"

  // Yield (for items with waste)
  yieldPercent     Decimal  @default(100) // 75% = 25% trim/cooking loss
  yieldCostPerUnit Decimal? // Cost adjusted for yield

  // For liquor items
  spiritCategoryId String?
  spiritCategory   SpiritCategory? @relation(fields: [spiritCategoryId], references: [id])
  pourSizeOz       Decimal?  // Standard pour size (overrides location default)
  proofPercent     Decimal?  // Alcohol proof

  // Inventory levels (aggregate across all storage locations)
  currentStock     Decimal  @default(0)  // Total in storage units
  parLevel         Decimal? // Minimum to keep on hand (total)
  reorderPoint     Decimal? // When to reorder
  reorderQty       Decimal? // How much to order

  // Status
  isActive         Boolean  @default(true)
  trackInventory   Boolean  @default(true)

  // Relations
  storageLocations InventoryItemStorage[]
  prepItemInputs   PrepItemIngredient[]
  recipeUsages     MenuItemRecipeIngredient[]
  modifierLinks    ModifierInventoryLink[]
  countItems       InventoryCountItem[]
  transactions     InventoryItemTransaction[]
  invoiceLines     InvoiceLineItem[]
  wasteEntries     WasteLogEntry[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([locationId, name])
  @@index([locationId])
  @@index([department])
  @@index([itemType])
  @@index([revenueCenter])
  @@index([category])
}

// Prep items - made from inventory items
model PrepItem {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  name        String   // "Shredded Chicken", "Simple Syrup"
  description String?

  // Output specifications
  outputUnit    String   // "oz", "each", "qt"
  batchYield    Decimal  // How much one batch makes
  batchUnit     String   // Unit for batch (may differ from output)
  costPerUnit   Decimal? // Auto-calculated from ingredients

  // Shelf life
  shelfLifeHours Int?
  storageNotes   String?

  // Relations
  ingredients    PrepItemIngredient[]
  recipeUsages   MenuItemRecipeIngredient[]
  modifierLinks  ModifierInventoryLink[]

  isActive  Boolean  @default(true)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([locationId, name])
  @@index([locationId])
}

// What goes into a prep item
model PrepItemIngredient {
  id              String        @id @default(cuid())
  locationId      String
  location        Location      @relation(fields: [locationId], references: [id])
  prepItemId      String
  prepItem        PrepItem      @relation(fields: [prepItemId], references: [id], onDelete: Cascade)
  inventoryItemId String
  inventoryItem   InventoryItem @relation(fields: [inventoryItemId], references: [id])

  quantity        Decimal       // Amount used
  unit            String        // Unit (should match inventory storageUnit)

  sortOrder       Int           @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([prepItemId, inventoryItemId])
  @@index([locationId])
}

// Recipe - links menu items to ingredients
model MenuItemRecipe {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])
  menuItemId  String   @unique
  menuItem    MenuItem @relation(fields: [menuItemId], references: [id], onDelete: Cascade)

  // Calculated costs
  totalCost     Decimal?  // Sum of all ingredients
  foodCostPct   Decimal?  // totalCost / menuItem.price

  // Relations
  ingredients   MenuItemRecipeIngredient[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([menuItemId])
}

// Individual ingredient in a recipe
model MenuItemRecipeIngredient {
  id          String          @id @default(cuid())
  locationId  String
  location    Location        @relation(fields: [locationId], references: [id])
  recipeId    String
  recipe      MenuItemRecipe  @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  // Link to either inventory item OR prep item (one must be set)
  inventoryItemId String?
  inventoryItem   InventoryItem? @relation(fields: [inventoryItemId], references: [id])
  prepItemId      String?
  prepItem        PrepItem?      @relation(fields: [prepItemId], references: [id])

  quantity    Decimal  // Amount used
  unit        String   // Unit
  cost        Decimal? // Calculated cost for this ingredient

  sortOrder   Int      @default(0)
  notes       String?  // "lightly toasted", "diced"

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([recipeId])
}

// Links modifiers to inventory for tracking
model ModifierInventoryLink {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])
  modifierId  String   @unique
  modifier    Modifier @relation(fields: [modifierId], references: [id], onDelete: Cascade)

  // Link to either inventory item OR prep item
  inventoryItemId String?
  inventoryItem   InventoryItem? @relation(fields: [inventoryItemId], references: [id])
  prepItemId      String?
  prepItem        PrepItem?      @relation(fields: [prepItemId], references: [id])

  // Usage amount when modifier is selected
  usageQuantity   Decimal
  usageUnit       String
  calculatedCost  Decimal?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
}

// Inventory count session
model InventoryCount {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  countDate   DateTime @default(now())
  countType   String   // "full", "area", "spot", "cycle"
  status      String   @default("in_progress") // "in_progress", "completed", "reviewed"

  // Link to storage location (for area counts)
  // NULL = full count across all locations
  storageLocationId String?
  storageLocation   StorageLocation? @relation(fields: [storageLocationId], references: [id])

  // Who did it
  startedById   String?
  completedById String?
  reviewedById  String?

  // Totals
  expectedValue Decimal?
  countedValue  Decimal?
  varianceValue Decimal?
  variancePct   Decimal?

  notes       String?

  // Relations
  items       InventoryCountItem[]

  completedAt DateTime?
  reviewedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  syncedAt    DateTime?

  @@index([locationId])
  @@index([storageLocationId])
  @@index([countDate])
  @@index([status])
}

// Individual item in a count
model InventoryCountItem {
  id               String          @id @default(cuid())
  locationId       String
  location         Location        @relation(fields: [locationId], references: [id])
  inventoryCountId String
  inventoryCount   InventoryCount  @relation(fields: [inventoryCountId], references: [id], onDelete: Cascade)
  inventoryItemId  String
  inventoryItem    InventoryItem   @relation(fields: [inventoryItemId], references: [id])

  expectedQty      Decimal   // What system says
  countedQty       Decimal?  // What was counted
  variance         Decimal?  // countedQty - expectedQty
  varianceValue    Decimal?  // variance * costPerUnit
  variancePct      Decimal?

  countedAt        DateTime?
  notes            String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([inventoryCountId])
}

// Inventory transactions (purchases, adjustments, transfers)
model InventoryItemTransaction {
  id              String        @id @default(cuid())
  locationId      String
  location        Location      @relation(fields: [locationId], references: [id])
  inventoryItemId String
  inventoryItem   InventoryItem @relation(fields: [inventoryItemId], references: [id])

  // Transaction type
  type            String   // "purchase", "sale", "adjustment", "waste", "transfer", "count"

  // Quantities
  quantityBefore  Decimal
  quantityChange  Decimal  // Positive for additions, negative for deductions
  quantityAfter   Decimal

  // Cost info
  unitCost        Decimal?
  totalCost       Decimal?

  // Reference info
  reason          String?
  referenceType   String?  // "invoice", "order", "waste_log", "count"
  referenceId     String?  // ID of related record
  notes           String?

  // Who did it
  employeeId      String?

  createdAt DateTime  @default(now())
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([inventoryItemId])
  @@index([type])
  @@index([createdAt])
}

// Vendor management
model Vendor {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])

  name        String
  accountNum  String?
  phone       String?
  email       String?
  address     String?
  notes       String?

  // Payment terms
  paymentTerms String?  // "Net 30", "COD"

  isActive    Boolean  @default(true)

  // Relations
  invoices    Invoice[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@unique([locationId, name])
  @@index([locationId])
}

// Invoice/Purchase tracking
model Invoice {
  id          String   @id @default(cuid())
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])
  vendorId    String
  vendor      Vendor   @relation(fields: [vendorId], references: [id])

  invoiceNumber String
  invoiceDate   DateTime
  dueDate       DateTime?
  receivedDate  DateTime?

  // Totals
  subtotal      Decimal
  taxAmount     Decimal  @default(0)
  shippingCost  Decimal  @default(0)
  totalAmount   Decimal

  // Status
  status        String   @default("pending") // "pending", "received", "paid"
  paidDate      DateTime?

  // Options
  updateCosts     Boolean @default(true)  // Update item costs from invoice
  addToInventory  Boolean @default(true)  // Add quantities to inventory

  notes         String?

  // Relations
  lineItems     InvoiceLineItem[]

  // Who entered it
  enteredById   String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([vendorId])
  @@index([invoiceDate])
  @@index([status])
}

// Invoice line items
model InvoiceLineItem {
  id              String        @id @default(cuid())
  locationId      String
  location        Location      @relation(fields: [locationId], references: [id])
  invoiceId       String
  invoice         Invoice       @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  inventoryItemId String?
  inventoryItem   InventoryItem? @relation(fields: [inventoryItemId], references: [id])

  // If not linked to inventory item
  description     String?

  quantity        Decimal
  unit            String
  unitCost        Decimal
  totalCost       Decimal

  // For cost comparison
  previousCost    Decimal?  // What it cost before
  costChange      Decimal?  // Difference
  costChangePct   Decimal?  // % change

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  @@index([locationId])
  @@index([invoiceId])
}

// Waste log for non-void waste
model WasteLogEntry {
  id              String        @id @default(cuid())
  locationId      String
  location        Location      @relation(fields: [locationId], references: [id])
  inventoryItemId String
  inventoryItem   InventoryItem @relation(fields: [inventoryItemId], references: [id])

  quantity        Decimal
  unit            String
  costImpact      Decimal?

  reason          String   // "spoilage", "spill", "overcooked", "contamination", "training"
  notes           String?

  // Who logged it
  employeeId      String?

  wasteDate       DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  syncedAt        DateTime?

  @@index([locationId])
  @@index([wasteDate])
  @@index([reason])
}

// Settings for inventory management
model InventorySettings {
  id          String   @id @default(cuid())
  locationId  String   @unique
  location    Location @relation(fields: [locationId], references: [id])

  // Count settings
  defaultCountFrequency String  @default("weekly") // "daily", "weekly", "biweekly", "monthly"
  countReminderDay      String? // "sunday", "monday"
  countReminderTime     String? // "06:00"
  requireManagerReview  Boolean @default(true)
  varianceAlertPct      Decimal @default(5) // Alert if >5% variance

  // Cost settings
  costChangeAlertPct    Decimal @default(10) // Alert if cost changes >10%
  targetFoodCostPct     Decimal? // Target food cost %
  targetLiquorCostPct   Decimal? // Target liquor cost %

  // Default pour sizes (for liquor)
  defaultPourSizeOz     Decimal @default(1.5)

  // Integration settings
  exportEnabled         Boolean @default(false)
  exportTarget          String? // "marginedge", "restaurant365"
  exportApiKey          String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?
}
```

### Modifier Model Updates

```prisma
// Add to existing Modifier model:
model Modifier {
  // ... existing fields ...

  // NEW: Inventory tracking
  isLabel           Boolean  @default(false) // True = grouping only, no tracking
  inventoryLink     ModifierInventoryLink?
}
```

---

## API Endpoints

### Inventory Items
```
GET    /api/inventory/items              - List all inventory items
POST   /api/inventory/items              - Create inventory item
GET    /api/inventory/items/[id]         - Get single item
PUT    /api/inventory/items/[id]         - Update item
DELETE /api/inventory/items/[id]         - Soft delete item

GET    /api/inventory/items/low-stock    - Items below par level
GET    /api/inventory/items/by-category  - Grouped by category
```

### Prep Items
```
GET    /api/inventory/prep               - List prep items
POST   /api/inventory/prep               - Create prep item
GET    /api/inventory/prep/[id]          - Get single prep item
PUT    /api/inventory/prep/[id]          - Update prep item
DELETE /api/inventory/prep/[id]          - Soft delete
POST   /api/inventory/prep/[id]/batch    - Record batch prep
```

### Recipes
```
GET    /api/menu/items/[id]/recipe       - Get item recipe
PUT    /api/menu/items/[id]/recipe       - Save/update recipe
POST   /api/menu/items/[id]/recipe/cost  - Recalculate costs
```

### Counts
```
GET    /api/inventory/counts             - List counts
POST   /api/inventory/counts             - Start new count
GET    /api/inventory/counts/[id]        - Get count details
PUT    /api/inventory/counts/[id]        - Update count
POST   /api/inventory/counts/[id]/item   - Record item count
POST   /api/inventory/counts/[id]/complete - Complete count
POST   /api/inventory/counts/[id]/review - Manager review
```

### Invoices
```
GET    /api/inventory/invoices           - List invoices
POST   /api/inventory/invoices           - Create invoice
GET    /api/inventory/invoices/[id]      - Get invoice
PUT    /api/inventory/invoices/[id]      - Update invoice
DELETE /api/inventory/invoices/[id]      - Delete invoice
POST   /api/inventory/invoices/[id]/receive - Mark received
```

### Waste
```
GET    /api/inventory/waste              - Get waste log
POST   /api/inventory/waste              - Log waste entry
```

### Reports
```
GET    /api/reports/theoretical-usage    - Theoretical usage report
GET    /api/reports/variance             - Actual vs theoretical
GET    /api/reports/pmix                 - Product mix report
GET    /api/reports/waste                - Waste report
GET    /api/reports/cost-changes         - Cost change alerts
```

### Integrations
```
POST   /api/integrations/export          - Export to third party
GET    /api/integrations/export/status   - Check export status
```

---

## Implementation Phases

### Phase 1: Foundation (Schema + CRUD)
- [ ] Add new models to schema
- [ ] Run migration
- [ ] Create InventoryItem CRUD API
- [ ] Create PrepItem CRUD API
- [ ] Create Vendor CRUD API
- [ ] Create InventorySettings API
- [ ] Basic admin UI for inventory items

### Phase 2: Recipe Builder
- [ ] Create MenuItemRecipe API
- [ ] Recipe builder UI component
- [ ] Auto-calculate food cost %
- [ ] Link existing Modifier model to inventory

### Phase 3: Void Integration
- [ ] Update void flow with "Was it made?" question
- [ ] Add waste reasons to void
- [ ] Create waste log entries from voids
- [ ] Standalone waste log UI

### Phase 4: Invoice Entry
- [ ] Invoice entry UI
- [ ] Auto-update inventory costs
- [ ] Auto-add to inventory quantities
- [ ] Cost change alerts

### Phase 5: Inventory Counts
- [ ] Count session management
- [ ] Mobile count interface
- [ ] Manager review flow
- [ ] Auto-calculate variance

### Phase 6: Reports
- [ ] Theoretical usage calculation engine
- [ ] Variance report
- [ ] P-mix report
- [ ] Waste report
- [ ] Cost change report

### Phase 7: Integrations
- [ ] Export API for MarginEdge
- [ ] Export API for Restaurant365
- [ ] Webhook notifications

---

## UI Locations

| Feature | Location | Access |
|---------|----------|--------|
| Inventory Items | `/inventory` | Admin |
| Prep Items | `/inventory/prep` | Admin |
| Recipe Builder | `/menu/items/[id]/recipe` | Admin |
| Vendors | `/inventory/vendors` | Admin |
| Invoices | `/inventory/invoices` | Admin |
| Inventory Counts | `/inventory/counts` | Manager+ |
| Waste Log | `/inventory/waste` | All staff |
| Reports | `/reports/inventory` | Manager+ |
| Settings | `/settings/inventory` | Admin |

---

*Created: January 31, 2026*
*Status: Planning*
*Priority: Critical Foundation*
