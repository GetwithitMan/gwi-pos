# Skill 141: Menu/Liquor Builder Separation & Inventory Seeding

## Overview
Establish clear separation between food menu management and liquor inventory by filtering menu categories and seeding comprehensive bar inventory into the Liquor Builder.

## Status: ✅ Complete

## Problem

After cleaning up duplicate liquor items, the menu page still showed empty liquor categories alongside food categories, causing confusion:

```
Menu Categories:
✓ Appetizers (12 items)
✓ Entrees (24 items)
✓ Desserts (8 items)
✗ Whiskey (0 items)      ← Should not appear here
✗ Vodka (0 items)        ← Should not appear here
✗ Tequila (0 items)      ← Should not appear here
✗ Cocktails (0 items)    ← Should not appear here
```

**Issues:**
1. Menu page displayed both food AND liquor categories mixed together
2. Empty liquor categories cluttered the food menu interface
3. Unclear where to manage spirits (Menu vs Liquor Builder?)
4. Previous restore created 113 duplicate liquor items in wrong system
5. Needed comprehensive liquor inventory in the Liquor Builder

## Solution

### Part 1: Menu Page Category Filtering

Filter `/menu` page to show ONLY food-related categories, excluding all liquor/drinks.

**Implementation:**
```typescript
// src/app/(admin)/menu/page.tsx:248
if (menuResponse.ok) {
  const data = await menuResponse.json()

  // Filter out liquor and drinks categories - they belong in Liquor Builder
  const foodCategories = data.categories.filter((c: Category) =>
    c.categoryType !== 'liquor' && c.categoryType !== 'drinks'
  )
  setCategories(foodCategories)
  setItems([...data.items])
}
```

**Result:**
```
Menu Categories (after filtering):
✓ Appetizers (12 items)
✓ Entrees (24 items)
✓ Pizzas (8 items)
✓ Desserts (8 items)
✓ Entertainment (4 items)
✓ Combos (3 items)

(No liquor categories visible)
```

### Part 2: Liquor Inventory Seeding Script

Created automated script to populate Liquor Builder with complete bar inventory.

**Script Location:** `scripts/seed-liquor-inventory.ts`

**Features:**
- ✅ Checks for existing bottles to prevent duplicates
- ✅ Creates `SpiritCategory` for organization
- ✅ Creates `BottleProduct` with auto-calculated metrics
- ✅ Creates linked `InventoryItem` for unified inventory tracking
- ✅ Auto-assigns spirit tiers based on sell price
- ✅ Calculates pour costs and pours per bottle
- ✅ Handles both spirits and cocktails

**Categories Created:**

| Category | Bottles | Well | Call | Premium | Top Shelf |
|----------|---------|------|------|---------|-----------|
| Whiskey | 32 | 6 | 19 | 5 | 2 |
| Vodka | 20 | 4 | 12 | 3 | 1 |
| Rum | 16 | 5 | 9 | 1 | 1 |
| Tequila | 29 | 5 | 7 | 8 | 9 |
| Gin | 14 | 4 | 3 | 6 | 1 |
| Cocktails | 36 | 0 | 9 | 27 | 0 |
| **TOTAL** | **147** | **24** | **59** | **50** | **14** |

**Tier Assignment Logic:**
```typescript
function getTier(price: number): 'well' | 'call' | 'premium' | 'top_shelf' {
  if (price <= 6) return 'well'
  if (price <= 9) return 'call'
  if (price <= 13) return 'premium'
  return 'top_shelf'
}
```

**Bottle Defaults:**
- **Bottle Size**: 750ml (standard)
- **Pour Size**: 1.5oz (standard shot)
- **Unit Cost**: Sell price × 0.25 (estimated wholesale)
- **Low Stock Alert**: 2 bottles

**Calculated Metrics:**
```typescript
const bottleSizeOz = 750ml / 29.5735 = 25.36oz
const pourSizeMl = 1.5oz × 29.5735 = 44.36ml
const poursPerBottle = Math.floor(750 / 44.36) = 16 pours
const pourCost = unitCost / poursPerBottle
```

**Example Bottle Creation:**
```typescript
// Patron Silver - $12.00 sell price
{
  name: 'Patron Silver',
  spiritCategoryId: tequilaCategory.id,
  tier: 'premium',           // Auto-assigned ($12 = premium)
  bottleSizeMl: 750,
  bottleSizeOz: 25.36,
  unitCost: 3.00,            // $12 × 0.25
  pourSizeOz: 1.5,
  poursPerBottle: 16,
  pourCost: 0.1875,          // $3.00 / 16 pours
  currentStock: 0,
  lowStockAlert: 2,
  inventoryItemId: '...'     // Linked for unified inventory
}
```

### Part 3: Dual Inventory System

Each bottle exists in TWO places for different purposes:

**1. BottleProduct** (Liquor Builder specific):
- Spirit tier assignment (well/call/premium/top_shelf)
- Pour size configuration
- Recipe building for cocktails
- Menu item linking
- Bottle-based stock tracking

**2. InventoryItem** (Unified inventory):
- COGS reporting (department: Beverage, category: whiskey, subcategory: call)
- Ounce-based tracking for precise deductions
- Purchase order integration
- Variance reports
- Par level management

**Why Both?**
- **BottleProduct**: Bartender/bar manager view (bottles, tiers, recipes)
- **InventoryItem**: Accounting/manager view (costs, usage, COGS)

## Files Modified

### 1. Menu Page Filtering
**File:** `src/app/(admin)/menu/page.tsx`
- **Line 248**: Added category type filtering to exclude liquor/drinks
- **Logic**: `c.categoryType !== 'liquor' && c.categoryType !== 'drinks'`

### 2. Seeding Script
**File:** `scripts/seed-liquor-inventory.ts` (NEW)
- 350+ lines with complete bottle inventory
- Category definitions (6 categories)
- Bottle definitions (147 bottles)
- Automatic tier assignment
- Duplicate prevention logic
- InventoryItem creation for unified tracking

## API Endpoints Used

### Spirit Categories
```typescript
GET  /api/liquor/categories        // List categories with bottle counts
POST /api/liquor/categories        // Create new category
```

### Bottles
```typescript
GET  /api/liquor/bottles           // List all bottles
POST /api/liquor/bottles           // Create bottle + inventory item
```

## Running the Seeding Script

```bash
# From project root
cd /path/to/gwi-pos

# Run the seeding script
npx tsx scripts/seed-liquor-inventory.ts

# Output:
🍸 Seeding liquor inventory...
📍 Location: Main Bar & Grill (loc-1)

📂 Creating spirit categories...
  ✓ Category "Whiskey" already exists
  ✓ Category "Vodka" already exists
  ✓ Created category "Cocktails"

✅ 6 categories ready

🍾 Creating bottle products...
  Whiskey:
    - Blanton's (already exists)
    ✓ Bulleit Bourbon ($8.00 - call)
    ✓ Crown Royal ($8.00 - call)
    ...

✅ Created 35 new bottles
ℹ️  Skipped 102 existing bottles

🎉 Liquor inventory seeding complete!
```

## Clear Separation Established

### Menu (`/menu`)
**Purpose:** Food item management
**Categories:**
- Appetizers, Entrees, Sides, Desserts
- Pizza, Salads, Sandwiches
- Entertainment (pool tables, darts)
- Combos

**What You'll Do:**
- Add food menu items
- Configure food modifiers
- Set up combos
- Manage pizza builder
- Entertainment session pricing

### Liquor Builder (`/liquor-builder`)
**Purpose:** Bar inventory & drink management
**Categories:**
- Whiskey, Vodka, Rum, Tequila, Gin
- Cocktails, Wine, Beer

**What You'll Do:**
- Add spirit bottles with tier assignments
- Build cocktail recipes
- Configure pour sizes
- Set up spirit upgrade modifiers
- Track bar inventory

## User Impact

### Before (Confusing)
```
Manager: "I need to add a new whiskey"
Question: "Do I go to Menu or Liquor Builder?"
Result: Sometimes added in wrong place, duplicates created
```

### After (Clear)
```
Manager: "I need to add a new whiskey"
Answer: "Go to Liquor Builder - that's for ALL drinks"

Manager: "I need to add a new burger"
Answer: "Go to Menu - that's for ALL food"
```

**Mental Model:**
- 🍔 **Food** = Menu
- 🍺 **Drinks** = Liquor Builder

## Bottle List (147 Total)

### Whiskey (32 bottles)
Blanton's, Buffalo Trace, Bulleit Bourbon, Bulleit Rye, Bushmills, Crown Apple, Crown Royal, Dewar's, Eagle Rare, Evan Williams, Fireball, Gentleman Jack, Glenfiddich 12, Glenlivet 12, House Whiskey, Jack Daniels, Jack Fire, Jack Honey, Jameson, Jim Beam, Johnnie Walker Black, Johnnie Walker Red, Knob Creek, Macallan 12, Maker's Mark, Rittenhouse Rye, Sazerac Rye, Seagram's 7, Tullamore DEW, Woodford Reserve, Wild Turkey, Bulleit Bourbon Barrel

### Vodka (20 bottles)
Absolut, Absolut Citron, Absolut Vanilla, Belvedere, Chopin, Ciroc, Deep Eddy, Deep Eddy Cranberry, Deep Eddy Lemon, Deep Eddy Peach, Dripping Springs, Grey Goose, House Vodka, Ketel One, Skyy, Smirnoff, Stolichnaya, Tito's, Wheatley, Svedka

### Rum (16 bottles)
Appleton Estate, Bacardi Lime, Bacardi Mango, Bacardi Superior, Captain Morgan, Diplomatico Reserva, Havana Club 3, House Rum, Kraken, Malibu, Mount Gay, Myers's, Parrot Bay, Ron Zacapa 23, Sailor Jerry, Plantation

### Tequila (29 bottles)
1800 Anejo, 1800 Reposado, 1800 Silver, Casamigos Anejo, Casamigos Blanco, Casamigos Reposado, Clase Azul Plata, Clase Azul Reposado, Don Julio 1942 (Shot), Don Julio 1942 (Pour), Don Julio Anejo, Don Julio Blanco, Don Julio Reposado, Espolon Blanco, Espolon Reposado, Hornitos Plata, Hornitos Reposado, House Tequila, Jose Cuervo Gold, Jose Cuervo Silver, Patron Anejo, Patron Reposado, Patron Silver, Sauza Silver, Corazon Blanco, El Jimador Blanco, Milagro Silver, Olmeca Altos Plata, Tres Generaciones Reposado

### Gin (14 bottles)
Aviation, Beefeater, Bombay Sapphire, Empress 1908, Gordon's, Hendrick's, House Gin, Monkey 47, Nolet's Silver, Roku, Tanqueray, Tanqueray No. Ten, The Botanist, Plymouth

### Cocktails (36 bottles)
Amaretto Sour, Aviation, Bloody Mary, Cosmopolitan, Cuba Libre, Daiquiri, Dark & Stormy, Espresso Martini, French 75, Frozen Margarita, Gimlet, Gin & Tonic, Gin Martini, Jack & Coke, Lemon Drop, Long Island Iced Tea, Mai Tai, Manhattan, Margarita, Margarita on Rocks, Mexican Mule, Mint Julep, Mojito, Moscow Mule, Negroni, Old Fashioned, Paloma, Pina Colada, Ranch Water, Screwdriver, Tequila Sunrise, Tom Collins, Vodka Martini, Vodka Soda, Vodka Tonic, Whiskey Sour, Zombie

## Benefits

1. **No More Confusion**: Clear separation between food and drinks
2. **No Duplicates**: Liquor items can only exist in Liquor Builder
3. **Specialized Features**: Each system optimized for its purpose
4. **Clean UI**: Menu page focused on food, no liquor clutter
5. **Complete Inventory**: 147 bottles ready for use
6. **Auto-Tiered**: All bottles assigned to spirit tiers automatically
7. **COGS Ready**: Linked inventory items for accounting

## Related Skills
- Skill 118: Spirit Tier Admin
- Skill 119: Bartender View Personalization
- Skill 123: Menu Builder with Child Modifiers

## Future Enhancements
- [ ] Import spirit inventory from CSV
- [ ] Auto-generate modifier groups from spirit tiers
- [ ] Link existing cocktail menu items to bottle products
- [ ] Recipe builder for cocktails with cost calculation
- [ ] Wine and beer category seeding
